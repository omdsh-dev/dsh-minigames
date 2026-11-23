/**
 * 牛头王 TakeSix（6 nimmt! 简化，1v1 对 AI）纯逻辑：104 张牌面值 1-104，
 * 由注入 seed（mulberry32）确定性抽 24 张——双方各 10 张手牌 + 4 张开行
 * 首牌。每回合双方各出一张暗牌同时翻开，牌面小者先放：放入「行尾小于
 * 该牌且最接近」的行；行内已有 5 张时再放入第 6 张则整行收走计罚分、
 * 该牌单独开新行；若牌比所有行尾都小，出牌方自选一行收走、该牌开新
 * 行。10 回合后本局罚分少者胜，3 局积分定胜负。
 *
 * 所有操作直接修改传入 state（全部字段为 JSON 可序列化纯数据）；随机
 * 源全部由 seed 派生，同一 seed 与同一操作序列必然得到同一状态，可脱离
 * DOM 直接模拟与序列化重放。
 */

/** 行数（开行首牌固定 4 张）。 */
export const ROW_COUNT = 4
/** 行内已有的牌数上限；再放一张（第 6 张）即整行收走。 */
export const ROW_FULL = 5
/** 每方每局手牌数（也是每局回合数）。 */
export const HAND_SIZE = 10
/** 整场比赛局数。 */
export const ROUND_COUNT = 3
/** 牌面最大值（牌面 1-104）。 */
export const DECK_MAX = 104

/** 一方标识：you 玩家 / ai 电脑。 */
export type Side = 'you' | 'ai'

/** 对局阶段：出牌 / 玩家选收行 / 一局结束 / 比赛结束。 */
export type TakeSixPhase = 'pick' | 'chooseRow' | 'roundOver' | 'matchOver'

/** 一张牌落位的结果：追加 / 触发整行收走 / 需要出牌方自选收行。 */
export type PlaceOutcome =
  | { kind: 'placed'; row: number }
  | { kind: 'collect'; row: number; heads: number }
  | { kind: 'choose' }

/** 渲染动画用事件（每次出牌/选行后整体替换或追加）。 */
export type TakeSixEvent =
  | { kind: 'reveal'; youCard: number; aiCard: number }
  | { kind: 'placed'; side: Side; row: number; card: number }
  | { kind: 'collect'; side: Side; row: number; cards: number[]; heads: number }

/** 一场比赛的完整可测状态（纯数据，可 JSON 序列化重放）。 */
export interface TakeSixState {
  /** 基础种子（R 重开换种子；各局由局号派生洗牌种子）。 */
  seed: number
  /** 局号，1..ROUND_COUNT。 */
  round: number
  phase: TakeSixPhase
  /** 本局回合序号（0 起，已完成的回合数）。 */
  turn: number
  /** 4 行牌列，行内严格递增。 */
  rows: number[][]
  /** 玩家剩余手牌（升序）。 */
  yourHand: number[]
  /** AI 剩余手牌（升序）。 */
  aiHand: number[]
  /** 本局双方罚分（牛头数累计）。 */
  penaltyYou: number
  penaltyAi: number
  /** 三局累计罚分（总局数平局时破同）。 */
  totalYou: number
  totalAi: number
  /** 已赢局数。 */
  roundWinsYou: number
  roundWinsAi: number
  /** 上一局胜者（罚分打平为 null）。 */
  roundWinner: Side | null
  /** 比赛胜者（未结束或全平为 null）。 */
  matchWinner: Side | null
  /** chooseRow 阶段待落位的玩家牌。 */
  pendingYouCard: number | null
  /** 本回合已翻开的双方牌面（选行/动画用）。 */
  revealedYou: number | null
  revealedAi: number | null
  /** 本回合 AI 的牌是否已落位（chooseRow 补结算用）。 */
  aiSettled: boolean
  /** 最近一次动作产生的事件序列（动画定位用）。 */
  events: TakeSixEvent[]
}

/**
  * mulberry32 确定性随机数发生器：同 seed 产生同一 [0,1) 序列。
  * @param seed - 32 位整数种子。
  * @returns 返回 [0,1) 随机数的函数。
  */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
  * 一张牌的牛头数：55=7；双同数（11/22/…/99）=5；10 的倍数=3；
  * 其余 5 的倍数=2；其他=1。
  * @param card - 牌面 1-104。
  * @returns 牛头数。
  */
export function bullheads(card: number): number {
  if (card === 55) return 7
  if (card % 11 === 0) return 5
  if (card % 10 === 0) return 3
  if (card % 5 === 0) return 2
  return 1
}

/**
  * 一行牌的牛头总数。
  * @param row - 行内牌面数组。
  * @returns 牛头数之和。
  */
export function rowHeads(row: number[]): number {
  let sum = 0
  for (const c of row) sum += bullheads(c)
  return sum
}

/**
  * 各行行尾（最后一张）牌面。
  * @param rows - 行牌列。
  * @returns 每行的行尾牌面。
  */
export function rowEnds(rows: number[][]): number[] {
  return rows.map(row => row[row.length - 1]!)
}

/**
  * 牌的目标行：行尾小于该牌的行里行尾最大（最接近）的一行。
  * @param rows - 行牌列。
  * @param card - 待放置牌面。
  * @returns 行下标；比所有行尾都小则为 null。
  */
export function targetRow(rows: number[][], card: number): number | null {
  let best: number | null = null
  let bestEnd = -1
  for (let i = 0; i < rows.length; i += 1) {
    const end = rows[i]![rows[i]!.length - 1]!
    if (end < card && end > bestEnd) {
      best = i
      bestEnd = end
    }
  }
  return best
}

/**
  * AI 被迫收行时的行选择：牛头最少优先，平局取牌更多（拆掉危险长行），
  * 再平局取下标小（完全确定，无随机）。
  * @param rows - 行牌列。
  * @returns 收走的行下标。
  */
export function aiChooseRow(rows: number[][]): number {
  let best = 0
  for (let i = 1; i < rows.length; i += 1) {
    const headsI = rowHeads(rows[i]!)
    const headsB = rowHeads(rows[best]!)
    if (headsI < headsB || (headsI === headsB && rows[i]!.length > rows[best]!.length)) best = i
  }
  return best
}

/** 派生第 round 局的洗牌种子。 */
function seedForRound(seed: number, round: number): number {
  return (Math.imul(round, 0x9e3779b9) ^ seed) >>> 0
}

/** 派生 AI 在第 round 局第 turn 回合的决策噪声种子。 */
function aiNoiseSeed(seed: number, round: number, turn: number): number {
  return (Math.imul(round, 7654321) ^ Math.imul(turn + 1, 123457) ^ seed) >>> 0
}

/**
  * 洗一局牌：mulberry32(seedForRound) Fisher–Yates 抽 24 张——前 4 张
  * 各开一行、随后 10 张玩家手牌、再 10 张 AI 手牌（各自升序）。
  * @param state - 就地重置本局牌面的状态。
  */
function dealRound(state: TakeSixState): void {
  const rng = mulberry32(seedForRound(state.seed, state.round))
  const deck: number[] = []
  for (let v = 1; v <= DECK_MAX; v += 1) deck.push(v)
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const t = deck[i]!
    deck[i] = deck[j]!
    deck[j] = t
  }
  state.rows = [deck.slice(0, 1), deck.slice(1, 2), deck.slice(2, 3), deck.slice(3, 4)]
  state.yourHand = deck.slice(4, 4 + HAND_SIZE).sort((a, b) => a - b)
  state.aiHand = deck.slice(4 + HAND_SIZE, 4 + HAND_SIZE * 2).sort((a, b) => a - b)
}

/**
  * 开一场新比赛。
  * @param seed - 基础种子。
  * @returns 第 1 局就绪的初始状态。
  */
export function createGame(seed: number): TakeSixState {
  const state: TakeSixState = {
    seed,
    round: 1,
    phase: 'pick',
    turn: 0,
    rows: [[], [], [], []],
    yourHand: [],
    aiHand: [],
    penaltyYou: 0,
    penaltyAi: 0,
    totalYou: 0,
    totalAi: 0,
    roundWinsYou: 0,
    roundWinsAi: 0,
    roundWinner: null,
    matchWinner: null,
    pendingYouCard: null,
    revealedYou: null,
    revealedAi: null,
    aiSettled: false,
    events: [],
  }
  dealRound(state)
  return state
}

/**
  * AI 出牌决策（贪心 + seed 噪声）：模拟每张手牌的落位代价——安全
  * 追加 0 分；踩满 5 张的行或比所有行尾小按对应行牛头计；把行正好
  * 填到 5 张（给对手埋雷）小减分。噪声由 seed 派生，同状态必同选。
  * @param state - 当前状态（不修改）。
  * @returns AI 手牌中的一张。
  */
export function aiPickCard(state: TakeSixState): number {
  const rng = mulberry32(aiNoiseSeed(state.seed, state.round, state.turn))
  let best = state.aiHand[0]!
  let bestScore = Number.POSITIVE_INFINITY
  for (const card of state.aiHand) {
    const t = targetRow(state.rows, card)
    let cost: number
    let trap = 0
    if (t === null) {
      cost = rowHeads(state.rows[aiChooseRow(state.rows)]!)
    } else if (state.rows[t]!.length >= ROW_FULL) {
      cost = rowHeads(state.rows[t]!)
    } else {
      cost = 0
      if (state.rows[t]!.length + 1 === ROW_FULL) trap = 1
    }
    const score = cost * 3 - trap + rng() * 1.5
    if (score < bestScore) {
      bestScore = score
      best = card
    }
  }
  return best
}

/**
  * 落位一张牌（choose 之外的就地生效）：追加到目标行尾；目标行已满
  * 5 张则整行收走、罚分累加、该牌开新行。
  * @param state - 就地修改的状态。
  * @param side - 出牌方（罚分归属）。
  * @param card - 牌面。
  * @returns 落位结果；kind 为 choose 时不修改任何牌面。
  */
function placeCard(state: TakeSixState, side: Side, card: number): PlaceOutcome {
  const t = targetRow(state.rows, card)
  if (t === null) return { kind: 'choose' }
  const row = state.rows[t]!
  if (row.length >= ROW_FULL) {
    const heads = rowHeads(row)
    state.events.push({ kind: 'collect', side, row: t, cards: [...row], heads })
    if (side === 'you') {
      state.penaltyYou += heads
      state.totalYou += heads
    } else {
      state.penaltyAi += heads
      state.totalAi += heads
    }
    state.rows[t] = [card]
    return { kind: 'collect', row: t, heads }
  }
  row.push(card)
  state.events.push({ kind: 'placed', side, row: t, card })
  return { kind: 'placed', row: t }
}

/** AI 牌的结算：选行场景立即按 aiChooseRow 收走，否则 placeCard。 */
function settleAi(state: TakeSixState): void {
  const card = state.revealedAi
  if (card === null || state.aiSettled) return
  state.aiSettled = true
  const outcome = placeCard(state, 'ai', card)
  if (outcome.kind === 'choose') {
    const row = aiChooseRow(state.rows)
    const cards = state.rows[row]!
    const heads = rowHeads(cards)
    state.events.push({ kind: 'collect', side: 'ai', row, cards: [...cards], heads })
    state.penaltyAi += heads
    state.totalAi += heads
    state.rows[row] = [card]
  }
}

/** 回合收尾：回合号推进；手牌出空则结算本局并推进比赛阶段。 */
function finishTurn(state: TakeSixState): void {
  state.turn += 1
  if (state.yourHand.length > 0 || state.aiHand.length > 0) {
    state.phase = 'pick'
    return
  }
  state.roundWinner = state.penaltyYou < state.penaltyAi
    ? 'you'
    : state.penaltyAi < state.penaltyYou ? 'ai' : null
  if (state.roundWinner === 'you') state.roundWinsYou += 1
  if (state.roundWinner === 'ai') state.roundWinsAi += 1
  if (state.round >= ROUND_COUNT) {
    state.phase = 'matchOver'
    state.matchWinner = state.roundWinsYou > state.roundWinsAi
      ? 'you'
      : state.roundWinsAi > state.roundWinsYou
        ? 'ai'
        : state.totalYou === state.totalAi
          ? null
          : state.totalYou < state.totalAi ? 'you' : 'ai'
  } else {
    state.phase = 'roundOver'
  }
}

/**
  * 玩家从手牌出一张牌：同时计算 AI 的暗牌，双方牌一起翻开，牌面小者
  * 先落位。若玩家的牌需要自选收行，状态停在 chooseRow（pendingYouCard
  * 记牌、aiSettled 记 AI 是否已放），其选行后在 chooseRow 里补完。
  * @param state - 就地修改的状态。
  * @param card - 玩家手牌中的一张。
  */
export function playCard(state: TakeSixState, card: number): void {
  if (state.phase !== 'pick') throw new Error('takesix: 不是出牌阶段')
  const yi = state.yourHand.indexOf(card)
  if (yi < 0) throw new Error('takesix: 该牌不在手牌中')
  const aiCard = aiPickCard(state)
  const aiIndex = state.aiHand.indexOf(aiCard)
  state.yourHand.splice(yi, 1)
  state.aiHand.splice(aiIndex, 1)
  state.revealedYou = card
  state.revealedAi = aiCard
  state.events = [{ kind: 'reveal', youCard: card, aiCard }]
  state.aiSettled = false
  state.pendingYouCard = null
  // 牌面小者先放；牌面互不相同，不会并列。
  const playerFirst = card < aiCard
  if (playerFirst) {
    if (placeCard(state, 'you', card).kind === 'choose') {
      state.pendingYouCard = card
      state.phase = 'chooseRow'
      return
    }
    settleAi(state)
  } else {
    settleAi(state)
    if (placeCard(state, 'you', card).kind === 'choose') {
      state.pendingYouCard = card
      state.phase = 'chooseRow'
      return
    }
  }
  finishTurn(state)
}

/**
  * chooseRow 阶段玩家选定收走的行：该行牛头计入罚分，待落位的玩家牌
  * 开新行；若 AI 本回合尚未落位（玩家先放场景）则随后补完并收尾。
  * @param state - 就地修改的状态。
  * @param row - 收走的行下标 0-3。
  */
export function chooseRow(state: TakeSixState, row: number): void {
  if (state.phase !== 'chooseRow') throw new Error('takesix: 不是选行阶段')
  if (state.pendingYouCard === null) throw new Error('takesix: 无待落位的牌')
  if (row < 0 || row >= ROW_COUNT) throw new Error('takesix: 行下标越界')
  const taken = state.rows[row]!
  const heads = rowHeads(taken)
  state.events.push({ kind: 'collect', side: 'you', row, cards: [...taken], heads })
  state.penaltyYou += heads
  state.totalYou += heads
  state.rows[row] = [state.pendingYouCard]
  state.pendingYouCard = null
  settleAi(state)
  finishTurn(state)
}

/**
  * roundOver 后开下一局：本局罚分清零、重抽 24 张。
  * @param state - 就地修改的状态。
  */
export function startNextRound(state: TakeSixState): void {
  if (state.phase !== 'roundOver') throw new Error('takesix: 不是局间阶段')
  state.round += 1
  state.phase = 'pick'
  state.turn = 0
  state.penaltyYou = 0
  state.penaltyAi = 0
  state.pendingYouCard = null
  state.revealedYou = null
  state.revealedAi = null
  state.aiSettled = false
  state.events = []
  state.roundWinner = null
  dealRound(state)
}
