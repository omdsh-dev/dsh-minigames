/**
 * 翻棋暗战（Banqi）纯逻辑：4×8 半盘、红黑各 16 子全部暗扣。
 * 本模块无 DOM、无随机全局态——所有随机经注入的 mulberry32 种子驱动，
 * 因此洗牌、AI 决策与整局重放全部确定性可测。
 */

/** 棋手阵营：红方为人类，黑方为 AI。 */
export type Side = 'red' | 'black'

/** 棋子牌型（帅/仕/相/车/马/炮/兵）。 */
export type PieceType = 'shuai' | 'shi' | 'xiang' | 'che' | 'ma' | 'pao' | 'bing'

/** 一枚棋子：阵营 + 牌型 + 是否已翻开。 */
export interface Piece {
  side: Side
  type: PieceType
  revealed: boolean
}

/** 一局棋的全部可变状态。board 按 index = row * 8 + col 存 32 格。 */
export interface BanqiState {
  board: (Piece | null)[]
  /** 当前行棋方。 */
  turn: Side
  /** 已分出胜负时的胜方，否则 null。 */
  winner: Side | null
  /** 已执行的动作数（含双方），用于复盘与动画节拍。 */
  ply: number
}

/** 一手棋：翻开 index 处的暗子，或把 from 的亮子走到 to。 */
export type BanqiAction =
  | { kind: 'flip'; index: number }
  | { kind: 'move'; from: number; to: number }

/** mulberry32：32 位种子 → [0,1) 确定性随机流。 */
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

/** 盘面常量：8 列 × 4 行。 */
export const COLS = 8
export const ROWS = 4
export const CELLS = COLS * ROWS

/** 各牌型吃子等级：帅>仕>相>车>马>兵；炮不入级（只可跳吃）。 */
export const RANK: Record<PieceType, number> = {
  shuai: 7, shi: 6, xiang: 5, che: 4, ma: 2, bing: 1, pao: 0,
}

/** 各牌型价值（AI 评估用）。 */
export const PIECE_VALUE: Record<PieceType, number> = {
  shuai: 100, shi: 55, xiang: 45, che: 40, ma: 32, pao: 36, bing: 20,
}

/** 每方牌型数量（共 16 子）。 */
export const SIDE_COUNTS: Record<PieceType, number> = {
  shuai: 1, shi: 2, xiang: 2, che: 2, ma: 2, pao: 2, bing: 5,
}

/** 各牌型 × 阵营的显示汉字。 */
export const PIECE_CHAR: Record<Side, Record<PieceType, string>> = {
  red: { shuai: '帅', shi: '仕', xiang: '相', che: '车', ma: '马', pao: '炮', bing: '兵' },
  black: { shuai: '将', shi: '士', xiang: '象', che: '車', ma: '馬', pao: '砲', bing: '卒' },
}

function buildDeck(): Piece[] {
  const deck: Piece[] = []
  for (const side of ['red', 'black'] as const) {
    for (const type of Object.keys(SIDE_COUNTS) as PieceType[]) {
      for (let i = 0; i < SIDE_COUNTS[type]; i += 1) deck.push({ side, type, revealed: false })
    }
  }
  return deck
}

/**
 * 建立一局新棋：32 枚暗子按种子洗混后铺满 4×8 盘，红方先行。
 * @param seed 洗牌种子。
 * @returns 初始 BanqiState。
 */
export function createBanqiState(seed: number): BanqiState {
  const rand = mulberry32(seed)
  const deck = buildDeck()
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = deck[i]!
    deck[i] = deck[j]!
    deck[j] = tmp
  }
  return { board: deck, turn: 'red', winner: null, ply: 0 }
}

/** index 的行号（0-3）。 */
export function rowOf(index: number): number {
  return Math.floor(index / COLS)
}

/** index 的列号（0-7）。 */
export function colOf(index: number): number {
  return index % COLS
}

function inBoard(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS
}

/** index 的四个正交邻格（不出盘）。 */
export function orthogonalNeighbors(index: number): number[] {
  const r = rowOf(index)
  const c = colOf(index)
  const out: number[] = []
  if (r > 0) out.push(index - COLS)
  if (r < ROWS - 1) out.push(index + COLS)
  if (c > 0) out.push(index - 1)
  if (c < COLS - 1) out.push(index + 1)
  return out
}

/**
 * 亮子吃子判定（炮的跳吃另行处理，不走本函数）。
 * 大吃小、同级互吃；例外：兵可吃帅、帅不可吃兵。
 * @param attacker 进攻方棋子。
 * @param defender 防守方棋子。
 * @returns 是否合法吃子。
 */
export function canCapture(attacker: Piece, defender: Piece): boolean {
  if (attacker.side === defender.side) return false
  if (attacker.type === 'bing' && defender.type === 'shuai') return true
  if (attacker.type === 'shuai' && defender.type === 'bing') return false
  return RANK[attacker.type] >= RANK[defender.type]
}

/**
 * 一枚亮子的所有落点：正交一步进空格；非炮棋子可按等级邻近吃子；
 * 炮可隔恰好一子（任意阵营、含暗子）沿直线跳吃其后第一枚敌方亮子。
 * @param state 当前局面。
 * @param from 出发格。
 * @returns 可落到的目标格 index 数组（含吃子格）。
 */
export function moveTargets(state: BanqiState, from: number): number[] {
  const piece = state.board[from]
  if (piece == null || !piece.revealed) return []
  const out: number[] = []
  for (const to of orthogonalNeighbors(from)) {
    const target = state.board[to]
    if (target == null) {
      out.push(to)
      continue
    }
    if (target.revealed && piece.type !== 'pao' && canCapture(piece, target)) out.push(to)
  }
  if (piece.type === 'pao') {
    // 四个正交方向按固定增量直线扫描：先找炮架，再找炮架后第一枚子。
    const r0 = rowOf(from)
    const c0 = colOf(from)
    const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    for (const [dr, dc] of dirs) {
      let r = r0 + dr
      let c = c0 + dc
      while (inBoard(r, c) && state.board[r * COLS + c] === null) { r += dr; c += dc }
      if (!inBoard(r, c)) continue // 此方向无任何子作炮架。
      r += dr
      c += dc
      while (inBoard(r, c) && state.board[r * COLS + c] === null) { r += dr; c += dc }
      if (!inBoard(r, c)) continue // 炮架之后再无子。
      const target = state.board[r * COLS + c]
      if (target != null && target.revealed && target.side !== piece.side) out.push(r * COLS + c)
    }
  }
  return out
}

/**
 * side 在当前局面下的全部合法动作：翻开任意暗子 + 己方亮子的全部落点。
 * @param state 当前局面。
 * @param side 行棋方。
 * @returns 动作数组，顺序确定（先全部翻子格，再按格序走子）。
 */
export function legalActions(state: BanqiState, side: Side): BanqiAction[] {
  if (state.winner !== null || state.turn !== side) return []
  const out: BanqiAction[] = []
  for (let i = 0; i < CELLS; i += 1) {
    const piece = state.board[i]
    if (piece == null) continue
    if (!piece.revealed) {
      out.push({ kind: 'flip', index: i })
      continue
    }
    if (piece.side !== side) continue
    for (const to of moveTargets(state, i)) out.push({ kind: 'move', from: i, to })
  }
  return out
}

/** side 是否还有任意合法动作：盘上有暗子则必有翻子，否则看有无走点。 */
function hasAnyAction(state: BanqiState, side: Side): boolean {
  for (let i = 0; i < CELLS; i += 1) {
    const piece = state.board[i]
    if (piece != null && !piece.revealed) return true
  }
  for (let i = 0; i < CELLS; i += 1) {
    const piece = state.board[i]
    if (piece != null && piece.revealed && piece.side === side && moveTargets(state, i).length > 0) return true
  }
  return false
}

/** side 在盘上的已知子数（暗子归属未知，不计入）。 */
export function knownPieces(state: BanqiState, side: Side): number {
  let n = 0
  for (const piece of state.board) if (piece !== null && piece.revealed && piece.side === side) n += 1
  return n
}

/**
 * 执行一手棋（就地修改 state）：翻子或走子，随后换手并判定胜负。
 * 胜负判据：轮到的一方无任何合法动作（含被吃光）即负。
 * @param state 局面。
 * @param action 合法动作（调用方保证；非法动作返回 false 不改盘）。
 * @returns 动作是否被接受。
 */
export function applyAction(state: BanqiState, action: BanqiAction): boolean {
  if (state.winner !== null) return false
  if (action.kind === 'flip') {
    const piece = state.board[action.index]
    if (piece == null || piece.revealed) return false
    piece.revealed = true
  } else {
    const mover = state.board[action.from]
    if (mover == null || !mover.revealed || mover.side !== state.turn) return false
    if (!moveTargets(state, action.from).includes(action.to)) return false
    state.board[action.to] = mover
    state.board[action.from] = null
  }
  const moverSide = state.turn
  state.turn = moverSide === 'red' ? 'black' : 'red'
  state.ply += 1
  if (!hasAnyAction(state, state.turn)) state.winner = moverSide
  return true
}

/** idx 是否被 bySide 的任一亮子攻击（可吃到）。 */
function isAttacked(state: BanqiState, idx: number, bySide: Side): boolean {
  const victim = state.board[idx]
  if (victim == null) return false
  for (let i = 0; i < CELLS; i += 1) {
    const piece = state.board[i]
    if (piece == null || !piece.revealed || piece.side !== bySide) continue
    if (moveTargets(state, i).includes(idx)) return true
  }
  return false
}

/**
 * AI 决策（黑方）：枚举全部合法动作，按"安全吃 / 躲避 / 保守翻"打分，
 * 分值并列由种子噪声打破——同一局面 + 同一种子必然得到同一手棋。
 * @param state 当前局面（轮到黑方）。
 * @param seed AI 随机种子。
 * @returns 选中的动作；无动作时返回 null。
 */
export function aiChooseAction(state: BanqiState, seed: number): BanqiAction | null {
  const actions = legalActions(state, 'black')
  if (actions.length === 0) return null
  const rand = mulberry32(seed ^ (state.ply * 0x9e3779b1))
  let best: BanqiAction | null = null
  let bestScore = -Infinity
  for (const action of actions) {
    let score = 0
    if (action.kind === 'flip') {
      score = 2 + rand() * 2
    } else {
      const mover = state.board[action.from]!
      const target = state.board[action.to]
      if (target != null) score += PIECE_VALUE[target.type] * 10
      const fromAtt = isAttacked(state, action.from, 'red')
      const toAtt = isAttacked(state, action.to, 'red')
      if (fromAtt && !toAtt) score += PIECE_VALUE[mover.type] * 6
      else if (!fromAtt && toAtt) score -= PIECE_VALUE[mover.type] * 8
      else if (fromAtt && toAtt) score -= PIECE_VALUE[mover.type] * 2
      score += rand() * 1.5
    }
    if (score > bestScore) {
      bestScore = score
      best = action
    }
  }
  return best
}

/** 复制整个局面（深拷贝棋子），用于重放对比与预测。 */
export function cloneState(state: BanqiState): BanqiState {
  return {
    board: state.board.map((p) => (p === null ? null : { ...p })),
    turn: state.turn,
    winner: state.winner,
    ply: state.ply,
  }
}
