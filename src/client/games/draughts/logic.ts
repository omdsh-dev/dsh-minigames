/**
 * 国际跳棋（English Draughts）纯逻辑：8x8 盘面只用深色格，每方 12 子
 * 占前三排深色格。普通子只能斜前走一格；吃子为跳过相邻敌子落到其后
 * 空格，且必须连跳到底（每条吃法枚举为一条完整终局序列）；有吃必吃，
 * 多条吃法任选；到达对方底线立即升王，王可沿四个斜向走动与连跳；吃
 * 光对方或令对方无子可动者胜。跳吃过程中被吃棋子留在原位（不能二次
 * 跳过同一敌子），全部落定后才移除。AI 为 2 层极小极大 + 子力评估
 * （王=1.5 普通子 + 推进加权）+ mulberry32 种子噪声，同种子决策确定。
 * simulateGame 用种子驱动 AI 对 AI 完整对局，返回的走法序列可逐手重放。
 */

/** 一方：r = 红方（玩家，向上，升王行 0）；b = 黑方（AI，向下，升王行 7）。 */
export type Side = 'r' | 'b'

/** 一格内容：空串、普通子（小写）或王（大写）。 */
export type Piece = '' | 'r' | 'R' | 'b' | 'B'

/** 一条完整走法：起点、终点与沿途被吃的格子（静走时为空数组）。 */
export interface DraughtsMove {
  from: number
  to: number
  captures: number[]
}

/** 一局局面：64 格一维棋盘（行优先，sq = 行*8+列）与行动方。 */
export interface DraughtsPosition {
  board: Piece[]
  turn: Side
}

/** 终局判定：进行中，或某方胜（吃光对方 / 对方无子可动）。 */
export type DraughtsOutcome = { kind: 'playing' } | { kind: 'win'; winner: Side }

/** AI 搜索层数（极小极大，2 = AI 一步 + 对方最佳应手后评估）。 */
export const AI_DEPTH = 2

/** 深色格判定：只在此类格上行子。 */
export function isDark(sq: number): boolean {
  return (((sq >> 3) + (sq & 7)) & 1) === 1
}

/** 棋子所属方；空格返回 null。 */
export function sideOfPiece(p: Piece): Side | null {
  if (p === 'r' || p === 'R') return 'r'
  if (p === 'b' || p === 'B') return 'b'
  return null
}

/** 是否为王。 */
export function isKing(p: Piece): boolean {
  return p === 'R' || p === 'B'
}

/** 某方的升王行（红 0 / 黑 7）。 */
function promoRow(side: Side): number {
  return side === 'r' ? 0 : 7
}

function other(side: Side): Side {
  return side === 'r' ? 'b' : 'r'
}

const RED_DIRS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [-1, 1]]
const BLACK_DIRS: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1]]
const ALL_DIRS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]]

/**
 * 初始局面：黑方（AI）占第 0-2 排深色格，红方（玩家）占第 5-7 排深色格。
 */
export function createStartPosition(): DraughtsPosition {
  const board: Piece[] = new Array(64).fill('')
  for (let sq = 0; sq < 64; sq += 1) {
    if (!isDark(sq)) continue
    const row = sq >> 3
    if (row <= 2) board[sq] = 'b'
    else if (row >= 5) board[sq] = 'r'
  }
  return { board, turn: 'r' }
}

/**
 * 从 origin 出发的连跳 DFS：沿每个可跳方向递归，普通子抵达升王行立即
 * 终止该序列（升王即停），无后续跳且已吃过子时记录一条终局序列。
 * @param board 已移除起始子的工作棋盘（被吃子留在原位，靠 caps 去重）。
 * @param from  当前虚拟所在格。
 * @param origin 序列起点（记录到结果里）。
 * @param piece 正在行进的棋子。
 * @param caps  沿途已跳过的敌子格。
 * @param out   收集终局序列。
 */
function jumpSequences(
  board: Piece[], from: number, origin: number, piece: Piece,
  caps: number[], out: DraughtsMove[],
): void {
  const side = sideOfPiece(piece)!
  const king = isKing(piece)
  const dirs = king ? ALL_DIRS : side === 'r' ? RED_DIRS : BLACK_DIRS
  const r = from >> 3
  const c = from & 7
  let extended = false
  for (const d of dirs) {
    const mr = r + d[0]
    const mc = c + d[1]
    const lr = r + 2 * d[0]
    const lc = c + 2 * d[1]
    if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue
    const mid = mr * 8 + mc
    const mp = board[mid]!
    if (mp === '' || sideOfPiece(mp) === side) continue
    if (caps.includes(mid)) continue
    const land = lr * 8 + lc
    if (board[land] !== '') continue
    const nextCaps = [...caps, mid]
    if (!king && lr === promoRow(side)) {
      out.push({ from: origin, to: land, captures: nextCaps })
      extended = true
      continue
    }
    const before = out.length
    jumpSequences(board, land, origin, piece, nextCaps, out)
    if (out.length > before) extended = true
  }
  if (!extended && caps.length > 0) out.push({ from: origin, to: from, captures: caps.slice() })
}

/**
 * 生成 side 在 board 上的全部合法走法：存在任一吃法时只返回完整吃法
 * 序列（有吃必吃），否则返回全部单步静走。
 */
export function movesForBoard(board: Piece[], side: Side): DraughtsMove[] {
  const jumps: DraughtsMove[] = []
  const quiet: DraughtsMove[] = []
  for (let sq = 0; sq < 64; sq += 1) {
    const p = board[sq]!
    if (p === '' || sideOfPiece(p) !== side) continue
    const work = board.slice()
    work[sq] = ''
    jumpSequences(work, sq, sq, p, [], jumps)
    const king = isKing(p)
    const dirs = king ? ALL_DIRS : side === 'r' ? RED_DIRS : BLACK_DIRS
    const r = sq >> 3
    const c = sq & 7
    for (const d of dirs) {
      const nr = r + d[0]
      const nc = c + d[1]
      if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue
      if (board[nr * 8 + nc] !== '') continue
      quiet.push({ from: sq, to: nr * 8 + nc, captures: [] })
    }
  }
  return jumps.length > 0 ? jumps : quiet
}

/**
 * 当前行动方的全部合法走法（含强制吃过滤）。
 */
export function legalMoves(pos: DraughtsPosition): DraughtsMove[] {
  return movesForBoard(pos.board, pos.turn)
}

/**
 * 把一条合法走法落到棋盘上：移除被吃子、移动棋子、终点抵达升王行则
 * 升王，并轮换行动方。前置条件：move 来自 legalMoves（不重新校验）。
 */
function applyToBoard(board: Piece[], m: DraughtsMove, side: Side): Piece[] {
  const nb = board.slice()
  const piece = nb[m.from]!
  for (const cap of m.captures) nb[cap] = ''
  nb[m.from] = ''
  let placed = piece
  const toRow = m.to >> 3
  if (!isKing(piece) && toRow === promoRow(side)) {
    placed = side === 'r' ? 'R' : 'B'
  }
  nb[m.to] = placed
  return nb
}

/**
 * 应用走法并轮到对方；前置条件：move ∈ legalMoves(pos)。
 * @returns 新局面（原局面不变）。
 */
export function applyMove(pos: DraughtsPosition, m: DraughtsMove): DraughtsPosition {
  return { board: applyToBoard(pos.board, m, pos.turn), turn: other(pos.turn) }
}

/**
 * 终局判定：轮到走的一方无子或无合法走法，则判另一方胜。
 */
export function status(pos: DraughtsPosition): DraughtsOutcome {
  let pieces = 0
  for (let sq = 0; sq < 64; sq += 1) {
    if (sideOfPiece(pos.board[sq]!) === pos.turn) pieces += 1
  }
  if (pieces === 0) return { kind: 'win', winner: other(pos.turn) }
  if (movesForBoard(pos.board, pos.turn).length === 0) {
    return { kind: 'win', winner: other(pos.turn) }
  }
  return { kind: 'playing' }
}

/**
 * mulberry32 确定性伪随机源：同种子产生同一序列（注入 AI 噪声用）。
 * @param seed 32 位种子。
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
 * 子力评估（黑方视角）：普通子 1、王 1.5，普通子按推进深度加 0.02/行。
 * @returns 正值利黑方，负值利红方。
 */
export function evaluate(board: Piece[]): number {
  let score = 0
  for (let sq = 0; sq < 64; sq += 1) {
    const p = board[sq]!
    if (p === '') continue
    const row = sq >> 3
    if (p === 'b') score += 1 + row * 0.02
    else if (p === 'B') score += 1.5
    else if (p === 'r') score -= 1 + (7 - row) * 0.02
    else score -= 1.5
  }
  return score
}

/**
 * 极小极大（negamax 形式）：无子可动 = 当前方立刻输（-1000）。
 * @param board 局面棋盘。
 * @param side 即将行动的一方。
 * @param depth 剩余层数，0 时返回 side 视角的静态评估。
 * @returns side 视角的最佳分值。
 */
function negamax(board: Piece[], side: Side, depth: number): number {
  const moves = movesForBoard(board, side)
  if (moves.length === 0) return -1000
  if (depth <= 0) {
    const e = evaluate(board)
    return side === 'b' ? e : -e
  }
  let best = -Infinity
  for (const m of moves) {
    const v = -negamax(applyToBoard(board, m, side), other(side), depth - 1)
    if (v > best) best = v
  }
  return best
}

/**
 * AI 选步：对每个根走法做 depth-1 层对手搜索，附加种子噪声打破平分
 * （同种子决策确定，不同种子可产生不同选择）。
 * @param pos 当前局面（轮到 AI）。
 * @param seed 噪声种子。
 * @returns 最佳走法，无合法走法时返回 null。
 */
export function chooseMove(pos: DraughtsPosition, seed: number): DraughtsMove | null {
  const moves = legalMoves(pos)
  if (moves.length === 0) return null
  const prng = mulberry32(seed)
  let best = moves[0]!
  let bestV = -Infinity
  for (const m of moves) {
    const nb = applyToBoard(pos.board, m, pos.turn)
    let v = -negamax(nb, other(pos.turn), AI_DEPTH - 1) + prng() * 0.01
    if (v > bestV) {
      bestV = v
      best = m
    }
  }
  return best
}

/** 一场 AI 对 AI 模拟对局的结果。 */
export interface SimulatedGame {
  /** 胜方；步数耗尽按子力优势判定，接近均势判 'draw'。 */
  winner: Side | 'draw'
  /** 完整走法序列（可用 applyMove 逐手重放）。 */
  moves: DraughtsMove[]
  /** 终局面。 */
  final: DraughtsPosition
}

/**
 * 种子驱动的完整对局模拟：每手用 seed+手数 派生种子调 chooseMove，
 * 同 seed 结果完全一致；步数耗尽按 evaluate 的子力差（>0.75）定胜负。
 * @param seed 对局种子。
 * @param maxPlies 步数上限（防长将循环，默认 400）。
 */
export function simulateGame(seed: number, maxPlies = 400): SimulatedGame {
  let pos = createStartPosition()
  const moves: DraughtsMove[] = []
  while (moves.length < maxPlies) {
    const plySeed = (seed ^ Math.imul(moves.length, 0x9e3779b1)) >>> 0
    const m = chooseMove(pos, plySeed)
    if (m === null) break
    pos = applyMove(pos, m)
    moves.push(m)
    const st = status(pos)
    if (st.kind === 'win') return { winner: st.winner, moves, final: pos }
  }
  const e = evaluate(pos.board)
  return { winner: e > 0.75 ? 'b' : e < -0.75 ? 'r' : 'draw', moves, final: pos }
}
