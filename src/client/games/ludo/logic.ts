/**
 * 飞行棋（Ludo）纯逻辑：52 格环形跑道 + 各色 6 格终点直线（第 6 格即
 * 终点），每方 4 架飞机初始停机场。支持 2/3/4 人：玩家固定执红
 * （you），其余 1-3 家为 AI（ai 黄、blue 蓝、green 绿），经典四色布局
 * 起飞格红 40 / 黄 1 / 蓝 14 / 绿 27（各隔 13 格），安全格 = 各自起飞
 * 格 + 前方 8 步星格。掷 6 才能起飞（起飞后额外再掷一次）；棋子沿跑
 * 道按点数前进；落点若有敌子（非安全格）则将其全部送回机场；进入终点
 * 直线需精确点数到达第 6 格，超出部分原路反弹。
 *
 * 胜负：2 人制保留 3 局 2 胜；3/4 人单局定胜负——先让 4 架全部到终的
 * 方获胜即整场结束，其余名次按到终数量与剩余进度排序（standings）。
 * 轮换按经典逆时针 红→黄→蓝→绿，跳过已全部到终（获胜）的方。
 *
 * AI 为一层贪心 + 启发式（捕获 > 起飞 > 冲线 > 推进进度），候选打分
 * 混入 seed 派生的确定性噪声。所有随机（掷骰、AI 噪声）均由 seed
 * （mulberry32）派生：同一 seed 与同一操作序列必然得到同一状态。
 */

/** 一方标识：you 红方（玩家）/ ai 黄方 / blue 蓝方 / green 绿方（后三者为 AI）。 */
export type Side = 'you' | 'ai' | 'blue' | 'green'

/** 阶段：待掷骰 / 待行子 / 一局结束 / 整场结束。 */
export type LudoPhase = 'roll' | 'move' | 'roundOver' | 'matchOver'

/** 经典逆时针行棋顺序（红→黄→蓝→绿）。 */
export const SIDE_ORDER: readonly Side[] = ['you', 'ai', 'blue', 'green']

/** 一场比赛的参战方（SIDE_ORDER 前 playerCount 个，you 恒在首位）。 */
export type PlaySides = readonly Side[]

/** 一步棋：piece 己方第几架（0-3），from/to 为棋子位置编码。 */
export interface LudoMove {
  piece: number
  from: number
  to: number
  /** 是否为起飞（从机场进入起飞格）。 */
  takeoff: boolean
  /** 被送回机场的敌机编号（相对其所属方数组下标）。 */
  captured: number[]
  /** 与 captured 平行：每架被捕获敌机的所属方。 */
  capturedSides: Side[]
}

/** 一场比赛的完整可测状态（JSON 可序列化纯数据）。 */
export interface LudoState {
  seed: number
  /** 参战人数（2/3/4）。 */
  playerCount: number
  /** 参战方列表（行棋顺序）。 */
  sides: Side[]
  /** 局号（从 1 起；2 人制最多 3 局，多人制恒为 1）。 */
  round: number
  phase: LudoPhase
  turn: Side
  /** 本场掷骰次数（掷骰随机流的确定性计数器）。 */
  rollNo: number
  /** 每方 4 架飞机的位置编码：-1 机场；0-50 跑道（相对己方起飞格的步数）；51-56 终点直线（56 = 终点）。 */
  pieces: Record<Side, number[]>
  /** 最近一次掷出的骰面（待行子阶段非 null）。 */
  dice: number | null
  /** 本回合掷出的是否为 6（行子后额外再掷）。 */
  rolledSix: boolean
  /** 最近一步落定的棋（渲染回程动画用）。 */
  lastMove: LudoMove | null
  /** 本局胜者（roundOver / matchOver 时非 null）。 */
  roundWinner: Side | null
  roundWinsYou: number
  roundWinsAi: number
  matchWinner: Side | null
  message: string
}

/** 环形跑道长度。 */
export const RING_LEN = 52
/** 终点直线长度（第 6 格即终点）。 */
export const HOME_LEN = 6
/** 跑道上最后一格的步数（0-50 共 51 格）。 */
export const RING_LAST = 50
/** 终点格的位置编码。 */
export const GOAL_POS = RING_LAST + HOME_LEN
/** 每方飞机数。 */
export const PLANES = 4
/** 2 人制夺冠所需局数（3 局 2 胜）。 */
export const ROUNDS_TO_WIN = 2
/** 己方起飞格在环上的绝对下标（红 40 / 黄 1 / 蓝 14 / 绿 27）。 */
export const START_INDEX: Record<Side, number> = { you: 40, ai: 1, blue: 14, green: 27 }
/** 己方安全格（起飞格 + 己色星格，即起飞格前方 8 步）的绝对下标集合。 */
export const SAFE_CELLS: Record<Side, number[]> = { you: [40, 48], ai: [1, 9], blue: [14, 22], green: [27, 35] }
/** 未参战两色的安全格下标——该对局无人使用，作普通格。 */
export const NEUTRAL_SAFE_CELLS = [14, 22, 27, 35]

/** 各方中文名（消息文案用）。 */
export const SIDE_NAME: Record<Side, string> = { you: '你', ai: '黄方', blue: '蓝方', green: '绿方' }

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

/**
 * 棋子在步数 s（0-50）时所处的环上下标（相对己方起飞格顺时针）。
 * @param side - 哪一方。
 * @param s - 跑道步数（0-50）。
 * @returns 环上绝对下标（0-51）。
 */
export function ringIndexFor(side: Side, s: number): number {
  return (START_INDEX[side] + s) % RING_LEN
}

/**
 * 安全格归属：只统计参战方（active）的安全格，未参战色的格作普通格。
 * @param ringIdx - 环上绝对下标。
 * @param active - 参战方列表；缺省按经典 2 人制（红/黄）。
 * @returns 归属方，普通格返回 null。
 */
export function safeOwner(ringIdx: number, active: PlaySides = ['you', 'ai']): Side | null {
  for (const side of active) {
    if (SAFE_CELLS[side].includes(ringIdx)) return side
  }
  return null
}

/**
 * 新建一整场比赛的初始状态（第 1 局、红方先行、全部飞机在机场）。
 * @param seed - 32 位随机种子。
 * @param playerCount - 参战人数（2/3/4，缺省 2 与经典红黄对局一致）。
 * @returns 初始 LudoState。
 */
export function createLudo(seed: number, playerCount = 2): LudoState {
  const count = playerCount === 3 || playerCount === 4 ? playerCount : 2
  const sides = SIDE_ORDER.slice(0, count)
  const pieces: Record<Side, number[]> = {
    you: [-1, -1, -1, -1],
    ai: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
  }
  return {
    seed: seed >>> 0,
    playerCount: count,
    sides,
    round: 1,
    phase: 'roll',
    turn: 'you',
    rollNo: 0,
    pieces,
    dice: null,
    rolledSix: false,
    lastMove: null,
    roundWinner: null,
    roundWinsYou: 0,
    roundWinsAi: 0,
    matchWinner: null,
    message: count === 2 ? '掷出 6 才能起飞！按空格或点骰子掷骰。' : count + ' 人混战，掷出 6 才能起飞！',
  }
}

/**
 * 下一行棋方：按 sides 顺序循环，跳过已全部到终（获胜）的方。
 * @param state - 当前比赛状态（不修改）。
 * @param from - 当前行棋方。
 * @returns 下一个应行棋的方。
 */
export function nextTurnSide(state: LudoState, from: Side): Side {
  const n = state.sides.length
  let idx = state.sides.indexOf(from)
  if (idx < 0) idx = 0
  for (let k = 1; k <= n; k += 1) {
    const cand = state.sides[(idx + k) % n]!
    if (finishedCount(state, cand) < PLANES) return cand
  }
  return from
}

/**
 * 掷骰：由 seed 与 rollNo 确定性生成骰面，进入待行子阶段；若掷完
 * 无任何合法着法则直接过手（骰面与原因写入 message）。
 * @param state - 就地修改的比赛状态（须处于 roll 阶段）。
 * @returns 掷出的骰面（1-6）。
 */
export function rollFor(state: LudoState): number {
  if (state.phase !== 'roll') return state.dice ?? 0
  const rng = mulberry32(state.seed ^ Math.imul(state.rollNo + 1, 0x9e3779b9))
  const die = 1 + Math.floor(rng() * 6)
  state.rollNo += 1
  state.dice = die
  state.rolledSix = die === 6
  const moves = legalMovesFor(state, state.turn, die)
  if (moves.length === 0) {
    const who = SIDE_NAME[state.turn]
    state.message = who + '掷出 ' + die + '，无子可动，跳过回合'
    state.dice = null
    state.turn = nextTurnSide(state, state.turn)
    return die
  }
  state.phase = 'move'
  state.message = state.turn === 'you' ? '掷出 ' + die + '，点高亮飞机移动' : SIDE_NAME[state.turn] + '掷出 ' + die
  return die
}

/**
 * 指定骰面下一方的全部合法着法：机场机需 6 起飞；落点为己方安全格
 * 或终点直线恒合法；落点为敌方安全格非法；落点为普通跑道格时若有
 * 敌机（任意参战敌方的飞机）则全部捕获。终点第 6 格需精确到达，超
 * 出反弹（112 - 目标）。
 * @param state - 当前比赛状态（不修改）。
 * @param side - 行子方。
 * @param die - 骰面（1-6）。
 * @returns 合法着法列表。
 */
export function legalMovesFor(state: LudoState, side: Side, die: number): LudoMove[] {
  const enemies = state.sides.filter(s => s !== side)
  const moves: LudoMove[] = []
  for (let i = 0; i < PLANES; i += 1) {
    const pos = state.pieces[side][i]!
    if (pos === GOAL_POS) continue
    let to: number
    let takeoff = false
    if (pos === -1) {
      if (die !== 6) continue
      to = 0
      takeoff = true
    } else {
      to = pos + die
      if (to > GOAL_POS) to = 2 * GOAL_POS - to
    }
    const captured: number[] = []
    const capturedSides: Side[] = []
    if (!takeoff && to <= RING_LAST) {
      const idx = ringIndexFor(side, to)
      const owner = safeOwner(idx, state.sides)
      if (owner !== null && owner !== side) continue
      if (owner === null) {
        for (const enemy of enemies) {
          for (let j = 0; j < PLANES; j += 1) {
            const e = state.pieces[enemy][j]!
            if (e >= 0 && e <= RING_LAST && ringIndexFor(enemy, e) === idx) {
              captured.push(j)
              capturedSides.push(enemy)
            }
          }
        }
      }
    }
    moves.push({ piece: i, from: pos, to, takeoff, captured, capturedSides })
  }
  return moves
}

/**
 * 落实一步棋（就地修改）：起飞或前移、捕获敌机回机场、检查该局与
 * 整场胜负；掷 6（含起飞）行子后同一方额外再掷，否则按经典逆时针
 * 轮换（跳过已获胜方）。2 人制保留 3 局 2 胜；多人制先全部到终者
 * 直接赢下整场。
 * @param state - 比赛状态（须处于 move 阶段且 move 合法）。
 * @param side - 行子方。
 * @param move - 要落实的着法（captured 与 capturedSides 平行）。
 */
export function applyPieceMove(state: LudoState, side: Side, move: LudoMove): void {
  state.pieces[side][move.piece] = move.to
  for (let k = 0; k < move.captured.length; k += 1) {
    const victim = move.capturedSides[k] ?? (side === 'you' ? 'ai' : 'you')
    state.pieces[victim][move.captured[k]!] = -1
  }
  state.lastMove = { ...move, captured: [...move.captured], capturedSides: [...move.capturedSides] }
  state.dice = null
  const finished = finishedCount(state, side)
  const who = SIDE_NAME[side]
  if (finished === PLANES) {
    state.roundWinner = side
    if (state.playerCount === 2) {
      if (side === 'you') state.roundWinsYou += 1
      else state.roundWinsAi += 1
      if (state.roundWinsYou >= ROUNDS_TO_WIN || state.roundWinsAi >= ROUNDS_TO_WIN) {
        state.matchWinner = side
        state.phase = 'matchOver'
        state.message = side === 'you' ? '你赢下整场！' : SIDE_NAME[side] + '赢下整场。'
      } else {
        state.phase = 'roundOver'
        state.message = who + '拿下了第 ' + state.round + ' 局！'
      }
    } else {
      state.matchWinner = side
      state.phase = 'matchOver'
      state.message = who + '4 架全部到终点，赢下整场！'
    }
    return
  }
  if (move.captured.length > 0) {
    state.message = who + '踩掉敌机 ' + move.captured.length + ' 架！'
  } else if (move.to === GOAL_POS) {
    state.message = who + '一架飞机到达终点！'
  } else if (move.takeoff) {
    state.message = who + '起飞成功，再掷一次'
  }
  state.phase = 'roll'
  if (!state.rolledSix) state.turn = nextTurnSide(state, side)
}

/** 一方已到达终点（位置 56）的飞机数。 */
export function finishedCount(state: LudoState, side: Side): number {
  let n = 0
  for (const p of state.pieces[side]) if (p === GOAL_POS) n += 1
  return n
}

/** 一方总进度（各机位置编码 + 1 求和；到终 56 计 57、机场计 0）。 */
export function progressOf(state: LudoState, side: Side): number {
  let n = 0
  for (const p of state.pieces[side]) n += p === -1 ? 0 : p + 1
  return n
}

/**
 * 名次排序：先按到终架数降序，再按总进度降序（matchWinner 恒居首）。
 * @param state - 当前比赛状态。
 * @returns 参战方按名次排序的列表。
 */
export function standings(state: LudoState): Side[] {
  return [...state.sides].sort((a, b) => {
    const fa = finishedCount(state, a)
    const fb = finishedCount(state, b)
    if (fa !== fb) return fb - fa
    return progressOf(state, b) - progressOf(state, a)
  })
}

/**
 * 通用贪心选步（玩家按空格自动走、AI 均用此函数）：打分 = 捕获 100 +
 * 冲线 80 + 起飞 60 + 推进进度 40 * to/56 + 入终点直线 20，叠加由
 * (seed, rollNo, piece) 派生的确定性噪声（幅度 6）。
 * @param state - 比赛状态（须处于 move 阶段）。
 * @param side - 行子方。
 * @returns 打分最高的合法着法，无合法着法返回 null。
 */
export function chooseMove(state: LudoState, side: Side): LudoMove | null {
  if (state.phase !== 'move' || state.dice === null) return null
  const moves = legalMovesFor(state, side, state.dice)
  if (moves.length === 0) return null
  let best: LudoMove | null = null
  let bestScore = -Infinity
  for (const m of moves) {
    let score = 0
    if (m.captured.length > 0) score += 100 + m.captured.length * 10
    if (m.to === GOAL_POS) score += 80
    if (m.takeoff) score += 60
    score += (40 * m.to) / GOAL_POS
    if (m.to > RING_LAST && !m.takeoff) score += 20
    const noiseRng = mulberry32(state.seed ^ Math.imul(state.rollNo * 31 + m.piece + 1, 0x85ebca6b))
    score += noiseRng() * 6
    if (score > bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

/** AI 选步：与 {@link chooseMove} 相同，固定取当前回合方。 */
export function aiChooseMove(state: LudoState): LudoMove | null {
  return chooseMove(state, state.turn)
}

/**
 * 一局结束后开下一局（仅 2 人制会进入 roundOver）：清空棋子、局号加
 * 一、先手在两方间交替（第 1 局红先、第 2 局黄先、第 3 局红先）。
 * @param state - 处于 roundOver 的比赛状态（就地修改）。
 */
export function nextRound(state: LudoState): void {
  if (state.phase !== 'roundOver') return
  state.round += 1
  state.pieces = {
    you: [-1, -1, -1, -1],
    ai: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
  }
  state.turn = state.round % 2 === 1 ? 'you' : 'ai'
  state.phase = 'roll'
  state.dice = null
  state.rolledSix = false
  state.lastMove = null
  state.roundWinner = null
  state.message = '第 ' + state.round + ' 局开始：' + (state.turn === 'you' ? '你先掷骰' : '黄方先掷骰')
}
