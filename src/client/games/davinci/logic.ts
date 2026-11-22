/**
 * 达芬奇密码（Davinci Code，1v1 对 AI）纯逻辑：数字牌 0-11 各白/黑两张
 * 共 24 张（黑 0 带短横线与白 0 区分），mulberry32 确定性洗牌后各摸 4 张
 * 按升序排成一列（同值白在黑前、短横在后），其余入公共牌堆。回合可选
 * 摸一张按序插入，再猜对手某个位置的数值：猜对翻开该牌并可继续行动，
 * 猜错自己翻开一张与所猜数值最接近的牌并结束回合；一方整手牌全部被
 * 翻开即输掉一局，3 局 2 胜。AI 记忆双方已翻开的牌，按排除法从候选集
 * 里挑选目标（局数越高越充分利用邻居牌的排序边界收窄候选）。
 *
 * 所有操作直接修改传入 state；随机源全部由 seed 派生，同一 seed 与同一
 * 操作序列必然得到同一状态，可脱离 DOM 直接模拟与序列化重放。
 */

/** 每方起始手牌数。 */
export const START_HAND = 4
/** 夺冠所需局数（3 局 2 胜）。 */
export const ROUNDS_TO_WIN = 2

/** 牌色：w 白 / b 黑。 */
export type CardColor = 'w' | 'b'

/** 一张数字牌：0-11 各白黑两张，黑 0 带短横线（dash）。 */
export interface DavinciCard {
  /** 数值 0-11。 */
  value: number
  /** 颜色：w 白 / b 黑。 */
  color: CardColor
  /** 是否短横牌（仅黑 0 为 true）。 */
  dash: boolean
}

/** 一方标识：you 玩家 / ai 电脑。 */
export type Side = 'you' | 'ai'

/** 阶段：对局中 / 一局结束 / 比赛结束。 */
export type DavinciPhase = 'playing' | 'roundOver' | 'matchOver'

/** 日志条目：摸牌 / 猜测（含猜错时的被迫揭示）。 */
export type DavinciLogEntry =
  | { kind: 'draw'; by: Side }
  | { kind: 'guess'; by: Side; index: number; value: number; correct: boolean }

/** 最近一次翻开事件（供渲染动画定位）。 */
export interface RevealEvent {
  /** 被翻开的牌属于哪一方。 */
  side: Side
  /** 手牌中的位置。 */
  index: number
  /** 翻开原因：猜对 target / 猜错被迫揭示 penalty。 */
  reason: 'target' | 'penalty'
}

/** 一场比赛的完整可测状态（全部为 JSON 可序列化的纯数据）。 */
export interface DavinciState {
  seed: number
  /** 局号（从 1 起）。 */
  round: number
  phase: DavinciPhase
  turn: Side
  /** 本局先手（奇数局你、偶数局对方）。 */
  roundStarter: Side
  /** 己方手牌（恒为升序）。 */
  yourHand: DavinciCard[]
  /** 对方手牌（对玩家保密，翻开后可见）。 */
  aiHand: DavinciCard[]
  /** 己方手牌翻开标记（与 yourHand 平行）。 */
  revealedYou: boolean[]
  /** 对方手牌翻开标记（与 aiHand 平行）。 */
  revealedAi: boolean[]
  /** 公共牌堆（背面，顺序由洗牌决定）。 */
  pile: DavinciCard[]
  roundWinsYou: number
  roundWinsAi: number
  /** 比赛冠军（仅 matchOver 时非 null）。 */
  matchWinner: Side | null
  /** 本回合已摸牌的一方。 */
  drew: Side | null
  /** 已摸出待插入的牌（仅玩家侧使用）。 */
  pending: DavinciCard | null
  log: DavinciLogEntry[]
  /** 最近一次翻开（供动画）。 */
  lastReveal: RevealEvent | null
  message: string
}

/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 32 位种子。
 * @returns 返回 [0,1) 随机数的函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 局号混合进种子：同 seed 不同局得到独立洗牌序列。 */
function roundSeed(seed: number, round: number): number {
  return (seed ^ Math.imul(round, 0x9e3779b9)) >>> 0
}

/**
 * 牌的排序键：数值升序，同值白在黑前，短横牌（黑 0）在白 0 之后。
 * @param card - 牌。
 * @returns 全序比较键（牌组内两两不同）。
 */
export function sortKey(card: DavinciCard): number {
  return card.value * 4 + (card.color === 'w' ? 0 : 2) + (card.dash ? 1 : 0)
}

/** 牌的身份键（牌组内唯一：白 11 < … < 黑 0 短横）。 */
function idKey(card: DavinciCard): number {
  return card.value * 2 + (card.color === 'w' ? 0 : 1)
}

/**
 * 构造整副牌：0-11 各白黑两张共 24 张，黑 0 带短横线。
 * @returns 新建的牌组（按序排列）。
 */
export function buildDeck(): DavinciCard[] {
  const deck: DavinciCard[] = []
  for (let v = 0; v <= 11; v += 1) {
    deck.push({ value: v, color: 'w', dash: false })
    deck.push({ value: v, color: 'b', dash: v === 0 })
  }
  return deck
}

/**
 * 原地升序排列一手牌（同值白在黑前、短横在后）。
 * @param cards - 手牌数组（原地修改）。
 */
export function sortHand(cards: DavinciCard[]): void {
  cards.sort((a, b) => sortKey(a) - sortKey(b))
}

/**
 * 洗牌（Fisher-Yates，按传入 rng 顺序）。
 * @param rng - 随机源。
 * @param cards - 数组（原地打乱）。
 */
export function shuffle(rng: () => number, cards: DavinciCard[]): void {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const t = cards[i]!
    cards[i] = cards[j]!
    cards[j] = t
  }
}

/**
 * 把牌插入手牌的合法位置集合：保持升序（含同值白前黑后）的全部下标。
 * @param hand - 已升序的手牌。
 * @param card - 待插入牌。
 * @returns 合法插入下标升序数组。
 */
export function legalInsertPositions(hand: readonly DavinciCard[], card: DavinciCard): number[] {
  const k = sortKey(card)
  const out: number[] = []
  for (let p = 0; p <= hand.length; p += 1) {
    const okLeft = p === 0 || sortKey(hand[p - 1]!) <= k
    const okRight = p === hand.length || k <= sortKey(hand[p]!)
    if (okLeft && okRight) out.push(p)
  }
  return out
}

/**
 * 开新比赛：第 1 局、双方各摸 4 张升序排列、其余 16 张入牌堆、你先手。
 * @param seed - 基础种子。
 */
export function createDavinci(seed: number): DavinciState {
  const state: DavinciState = {
    seed,
    round: 1,
    phase: 'playing',
    turn: 'you',
    roundStarter: 'you',
    yourHand: [],
    aiHand: [],
    revealedYou: [],
    revealedAi: [],
    pile: [],
    roundWinsYou: 0,
    roundWinsAi: 0,
    matchWinner: null,
    drew: null,
    pending: null,
    log: [],
    lastReveal: null,
    message: '第 1 局 · 摸牌或直接猜对方一张',
  }
  dealRound(state)
  return state
}

/** 洗牌发一局：双方各摸 START_HAND 张升序，其余入牌堆。 */
function dealRound(state: DavinciState): void {
  const rng = mulberry32(roundSeed(state.seed, state.round))
  const deck = buildDeck()
  shuffle(rng, deck)
  state.yourHand = deck.slice(0, START_HAND)
  state.aiHand = deck.slice(START_HAND, START_HAND * 2)
  state.pile = deck.slice(START_HAND * 2)
  sortHand(state.yourHand)
  sortHand(state.aiHand)
  state.revealedYou = state.yourHand.map(() => false)
  state.revealedAi = state.aiHand.map(() => false)
  state.drew = null
  state.pending = null
  state.lastReveal = null
}

function handOf(state: DavinciState, side: Side): DavinciCard[] {
  return side === 'you' ? state.yourHand : state.aiHand
}

function revealedOf(state: DavinciState, side: Side): boolean[] {
  return side === 'you' ? state.revealedYou : state.revealedAi
}

function other(side: Side): Side {
  return side === 'you' ? 'ai' : 'you'
}

/**
 * 玩家摸牌：从牌堆顶摸出一张挂到 pending，等待选择插入位置。
 * @param state - 当前状态。
 * @returns 条件不满足（非玩家回合 / 本回合已摸 / 牌堆空 / 非对局中）为 false。
 */
export function playerDraw(state: DavinciState): boolean {
  if (state.phase !== 'playing' || state.turn !== 'you') return false
  if (state.drew === 'you' || state.pending !== null) return false
  if (state.pile.length === 0) return false
  state.pending = state.pile.pop()!
  state.drew = 'you'
  state.log.push({ kind: 'draw', by: 'you' })
  state.message = '点击手牌插入位置（须保持升序）'
  return true
}

/**
 * 把 pending 牌插入玩家手牌指定位置（校验合法性）。
 * @param state - 当前状态。
 * @param pos - 插入下标。
 * @returns 位置非法或无待插入牌为 false。
 */
export function playerInsert(state: DavinciState, pos: number): boolean {
  if (state.pending === null) return false
  if (!legalInsertPositions(state.yourHand, state.pending).includes(pos)) return false
  state.yourHand.splice(pos, 0, state.pending)
  state.revealedYou.splice(pos, 0, false)
  state.pending = null
  state.message = '猜对方一张：点牌位选数值'
  return true
}

/**
 * 摸牌并插入（测试与 AI 便捷路径）。
 * @param state - 当前状态。
 * @param side - 摸牌方。
 * @param pos - 插入下标（须为该牌的合法插入位置）。
 * @returns 任何一步非法为 false。
 */
export function drawAndInsert(state: DavinciState, side: Side, pos: number): boolean {
  if (state.phase !== 'playing' || state.turn !== side) return false
  if (state.drew === side || state.pile.length === 0) return false
  const card = state.pile.pop()!
  const hand = handOf(state, side)
  if (!legalInsertPositions(hand, card).includes(pos)) return false
  hand.splice(pos, 0, card)
  revealedOf(state, side).splice(pos, 0, false)
  state.drew = side
  state.log.push({ kind: 'draw', by: side })
  return true
}

/**
 * 猜测一方手牌中对手指定位置的数值（只比数值，不比颜色）。
 * 猜对：翻开该牌、保留回合并可继续猜；猜错：翻开自己一张与所猜数值最
 * 接近的未翻开牌（同距取最靠前/最小者），回合交出。
 * @param state - 当前状态。
 * @param side - 猜测方。
 * @param index - 对手手牌位置。
 * @param value - 所猜数值 0-11。
 * @returns null 非法；true 猜对；false 猜错。
 */
export function guess(state: DavinciState, side: Side, index: number, value: number): boolean | null {
  if (state.phase !== 'playing' || state.turn !== side) return null
  if (!Number.isInteger(index) || !Number.isInteger(value) || value < 0 || value > 11) return null
  const target = other(side)
  const hand = handOf(state, target)
  const revealed = revealedOf(state, target)
  if (index < 0 || index >= hand.length || revealed[index]) return null
  const card = hand[index]!
  const correct = card.value === value
  state.log.push({ kind: 'guess', by: side, index, value, correct })
  if (correct) {
    revealed[index] = true
    state.lastReveal = { side: target, index, reason: 'target' }
    if (revealed.every(Boolean)) {
      endRound(state, side)
      return true
    }
    state.message = '猜对了！可继续猜，或空格结束回合'
    return true
  }
  const penalty = closestHiddenIndex(state, side, value)
  if (penalty === null) return null
  revealedOf(state, side)[penalty] = true
  state.lastReveal = { side, index: penalty, reason: 'penalty' }
  if (revealedOf(state, side).every(Boolean)) {
    endRound(state, other(side))
    return false
  }
  passTurn(state)
  state.message = '猜错：翻开你最接近 ' + value + ' 的牌，对方行动'
  return false
}

/**
 * 自己未翻开牌中与所猜数值最接近者的下标（同距取最靠前者，即排序最
 * 小的一张）。
 * @param state - 当前状态。
 * @param side - 被迫揭示的一方。
 * @param value - 所猜数值。
 * @returns 下标；无未翻开牌（不可能存活到此时）为 null。
 */
export function closestHiddenIndex(state: DavinciState, side: Side, value: number): number | null {
  const hand = handOf(state, side)
  const revealed = revealedOf(state, side)
  let best = -1
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < hand.length; i += 1) {
    if (revealed[i]) continue
    const d = Math.abs(hand[i]!.value - value)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best >= 0 ? best : null
}

/**
 * 主动结束己方回合（猜对后可选择不再猜）。
 * @param state - 当前状态。
 * @param side - 结束方。
 * @returns 非该方回合或非对局中为 false。
 */
export function endTurn(state: DavinciState, side: Side): boolean {
  if (state.phase !== 'playing' || state.turn !== side) return false
  passTurn(state)
  state.message = side === 'you' ? '对方思考中…' : '轮到你：摸牌或直接猜'
  return true
}

/** 交出回合并清空摸牌状态。 */
function passTurn(state: DavinciState): void {
  state.turn = other(state.turn)
  state.drew = null
  state.pending = null
}

/** 结束一局：记局分，2 胜定比赛，否则进入 roundOver。 */
function endRound(state: DavinciState, winner: Side): void {
  if (winner === 'you') state.roundWinsYou += 1
  else state.roundWinsAi += 1
  if (state.roundWinsYou >= ROUNDS_TO_WIN || state.roundWinsAi >= ROUNDS_TO_WIN) {
    state.phase = 'matchOver'
    state.matchWinner = winner
    state.message = winner === 'you' ? '比赛胜利！R 重开' : '比赛失利 · R 重开'
  } else {
    state.phase = 'roundOver'
    state.message = (winner === 'you' ? '你拿下本局' : '对方拿下本局') + ' · 空格下一局'
  }
  state.turn = winner
}

/**
 * 开下一局：重新洗牌发牌、先手交替。
 * @param state - 当前状态。
 * @returns 非一局结束阶段为 false。
 */
export function startNextRound(state: DavinciState): boolean {
  if (state.phase !== 'roundOver') return false
  state.round += 1
  state.roundStarter = state.round % 2 === 1 ? 'you' : 'ai'
  state.turn = state.roundStarter
  state.phase = 'playing'
  dealRound(state)
  state.message = '第 ' + state.round + ' 局 · ' + (state.turn === 'you' ? '你先手' : '对方先手')
  return true
}

/**
 * AI 视角的候选集：整副牌排除己方手牌与双方已翻开的牌，strict 时进一
 * 步用对手该位置两侧最近翻开牌的排序边界收窄（牌组内排序键两两不同，
 * 边界为严格不等号）。
 * @param state - 当前状态。
 * @param index - 对手（玩家）手牌位置。
 * @param strict - 是否应用邻居排序边界。
 * @returns 候选牌数组（按排序键升序）。
 */
export function aiCandidates(state: DavinciState, index: number, strict: boolean): DavinciCard[] {
  const known = new Set<number>()
  for (const c of state.aiHand) known.add(idKey(c))
  for (let i = 0; i < state.yourHand.length; i += 1) {
    if (state.revealedYou[i]) known.add(idKey(state.yourHand[i]!))
  }
  let lo = Number.NEGATIVE_INFINITY
  let hi = Number.POSITIVE_INFINITY
  if (strict) {
    for (let i = 0; i < index; i += 1) {
      if (state.revealedYou[i]) lo = Math.max(lo, sortKey(state.yourHand[i]!))
    }
    for (let i = index + 1; i < state.yourHand.length; i += 1) {
      if (state.revealedYou[i]) hi = Math.min(hi, sortKey(state.yourHand[i]!))
    }
  }
  return buildDeck().filter(c => !known.has(idKey(c)) && sortKey(c) > lo && sortKey(c) < hi)
}

/**
 * AI 一次猜测决策（纯函数）：未翻开位置中选一个目标再从候选集里按
 * seed 噪声取数值。第 1 局宽候选（不利用排序边界）；第 2 局起应用边
 * 界；第 3 局起选候选最少的位置（信息量最大）。
 * @param state - 当前状态。
 * @returns 目标位置与所猜数值。
 */
export function aiDecide(state: DavinciState): { index: number; value: number } {
  const rng = mulberry32((state.seed ^ Math.imul(state.round, 0x9e3779b9) ^ Math.imul(state.log.length + 7, 0x85ebca6b)) >>> 0)
  const r1 = rng()
  const r2 = rng()
  const positions: number[] = []
  for (let i = 0; i < state.yourHand.length; i += 1) {
    if (!state.revealedYou[i]) positions.push(i)
  }
  if (positions.length === 0) return { index: 0, value: 0 }
  const strict = state.round >= 2
  let index = positions[Math.floor(r1 * positions.length)]!
  if (state.round >= 3) {
    let bestCount = Number.POSITIVE_INFINITY
    for (const p of positions) {
      const n = aiCandidates(state, p, true).length
      if (n < bestCount) {
        bestCount = n
        index = p
      }
    }
  }
  const cands = aiCandidates(state, index, strict)
  if (cands.length === 0) return { index, value: 0 }
  const pick = cands[Math.floor(r2 * cands.length)]!
  return { index, value: pick.value }
}

/**
 * AI 执行整个回合：约半数时候先摸牌插入中间合法位，随后反复猜测直到
 * 猜错、局终或噪声决定收手；全部随机由 seed 派生，可重放。
 * @param state - 当前状态。
 * @returns 是否执行了行动（非对方回合为 false）。
 */
export function aiTakeTurn(state: DavinciState): boolean {
  if (state.phase !== 'playing' || state.turn !== 'ai') return false
  const rng = mulberry32((state.seed ^ Math.imul(state.round, 0x45d9f3b) ^ Math.imul(state.log.length, 0x9e3779b9)) >>> 0)
  if (state.pile.length > 0 && rng() < 0.5) {
    const card = state.pile.pop()!
    const positions = legalInsertPositions(state.aiHand, card)
    const pos = positions[Math.floor(positions.length / 2)] ?? state.aiHand.length
    state.aiHand.splice(pos, 0, card)
    state.revealedAi.splice(pos, 0, false)
    state.drew = 'ai'
    state.log.push({ kind: 'draw', by: 'ai' })
  }
  let guard = 0
  while (state.phase === 'playing' && state.turn === 'ai' && guard < 12) {
    guard += 1
    const decision = aiDecide(state)
    const correct = guess(state, 'ai', decision.index, decision.value)
    if (correct !== true) break
    if (rng() < 0.6) {
      endTurn(state, 'ai')
      break
    }
  }
  if (state.phase === 'playing' && state.turn === 'ai') endTurn(state, 'ai')
  return true
}

/**
 * 序列化整场比赛状态（纯 JSON）。
 * @param state - 当前状态。
 */
export function serializeState(state: DavinciState): string {
  return JSON.stringify(state)
}

/**
 * 反序列化状态：与 serializeState 互逆，用于克隆与重放。
 * @param json - serializeState 的输出。
 * @returns 重建的状态。
 */
export function deserializeState(json: string): DavinciState {
  return JSON.parse(json) as DavinciState
}
