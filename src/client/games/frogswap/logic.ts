/**
 * 青蛙过河（FrogSwap）纯逻辑：经典青蛙互换谜题（Frog Leap）。一排
 * 2f+1 个荷叶位，左半 f 只绿蛙朝右、中间空位、右半 f 只黄蛙朝左；绿蛙
 * 只能向右、黄蛙只能向左，每步滑入相邻空位或跳过恰好一只异色蛙落入
 * 其后的空位，不可跳两只、不可后退，目标是两侧青蛙完全互换。逻辑与
 * 渲染完全解耦：随机数全部来自注入种子的 mulberry32，装饰数据确定
 * 性可测；种子只影响水波纹相位等装饰，不影响谜题本身。
 */

/** 荷叶位内容：绿蛙（朝右）/ 黄蛙（朝左）/ 空。 */
export type CellValue = 'G' | 'Y' | null

/** 一局青蛙过河的全部可测状态。 */
export interface FrogSwapState {
  /** 荷叶位数组，长度 2f+1。 */
  cells: CellValue[]
  /** 每侧青蛙数 f（关卡 2..6）。 */
  frogCount: number
  /** 关卡序号 1..5（f = level + 1）。 */
  level: number
  /** 已用步数。 */
  moves: number
  /** 撤销栈：每步记录 {from, to}。 */
  history: { from: number; to: number }[]
  /** 是否达成互换。 */
  won: boolean
  /** 装饰随机序列（水波纹相位等，仅渲染用）。 */
  deco: number[]
}

/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 32 位无符号种子。
 * @returns 返回 [0,1) 随机数的函数，同种子序列完全一致。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 构造一局：左 f 绿、中间空、右 f 黄。
 * @param level - 关卡序号 1..5（每侧青蛙数 f = level + 1）。
 * @param seed - 注入种子，只驱动装饰随机序列。
 * @returns 初始状态（步数 0、未胜利）。
 */
export function createFrogSwap(level: number, seed: number): FrogSwapState {
  const f = level + 1
  const cells: CellValue[] = []
  for (let i = 0; i < f; i += 1) cells.push('G')
  cells.push(null)
  for (let i = 0; i < f; i += 1) cells.push('Y')
  const rng = mulberry32(seed)
  const deco: number[] = []
  for (let i = 0; i < cells.length * 3; i += 1) deco.push(rng())
  return { cells, frogCount: f, level, moves: 0, history: [], won: false, deco }
}

/**
 * 一步的类别：滑入相邻空位 / 跳过一只异色蛙 / 不合法。
 * @param cells - 荷叶位数组。
 * @param from - 起点下标。
 * @param to - 终点下标。
 * @returns 'slide'、'hop' 或 null（不合法）。
 */
export function moveKind(cells: CellValue[], from: number, to: number): 'slide' | 'hop' | null {
  const frog = cells[from]
  if (frog === null || frog === undefined) return null
  if (from === to) return null
  const dir = frog === 'G' ? 1 : -1
  const delta = (to - from) * dir
  if (delta !== 1 && delta !== 2) return null
  if (to < 0 || to >= cells.length) return null
  if (cells[to] !== null) return null
  if (delta === 1) return 'slide'
  const mid = cells[from + dir]
  // 跳跃必须越过恰好一只异色蛙（不可跳两只、不可跳空位或同色）。
  if (mid === null || mid === undefined || mid === frog) return null
  return 'hop'
}

/**
 * 一只蛙的全部合法终点（按从小到大排序）。
 * @param state - 当前状态。
 * @param from - 起点下标。
 * @returns 合法终点下标数组（最多 2 个：滑 + 跳）。
 */
export function legalTargets(state: FrogSwapState, from: number): number[] {
  const out: number[] = []
  for (let to = 0; to < state.cells.length; to += 1) {
    if (moveKind(state.cells, from, to) !== null) out.push(to)
  }
  return out
}

/**
 * 是否存在任何可动蛙（死局检测：无可动蛙且未达成互换时提示撤销）。
 * @param state - 当前状态。
 * @returns true 表示至少还有一步合法着法。
 */
export function canAnyMove(state: FrogSwapState): boolean {
  for (let i = 0; i < state.cells.length; i += 1) {
    if (legalTargets(state, i).length > 0) return true
  }
  return false
}

/**
 * 死局：未胜利且无任何合法着法。
 * @param state - 当前状态。
 * @returns true 表示陷入死局（需要撤销）。
 */
export function isDeadlocked(state: FrogSwapState): boolean {
  return !state.won && !canAnyMove(state)
}

/**
 * 是否达成互换：左半全黄、右半全绿（中间必为空）。
 * @param state - 当前状态。
 * @returns true 表示两侧青蛙已完全互换。
 */
export function isSolved(state: FrogSwapState): boolean {
  const f = state.frogCount
  for (let i = 0; i < f; i += 1) {
    if (state.cells[i] !== 'Y') return false
  }
  if (state.cells[f] !== null) return false
  for (let i = f + 1; i < 2 * f + 1; i += 1) {
    if (state.cells[i] !== 'G') return false
  }
  return true
}

/**
 * 执行一步（就地修改）：合法则移动青蛙、压入撤销栈、更新胜利标记。
 * @param state - 当前状态。
 * @param from - 起点下标。
 * @param to - 终点下标。
 * @returns 合法返回 true；不合法不改动并返回 false。
 */
export function applyMove(state: FrogSwapState, from: number, to: number): boolean {
  if (moveKind(state.cells, from, to) === null) return false
  state.cells[to] = state.cells[from]!
  state.cells[from] = null
  state.history.push({ from, to })
  state.moves += 1
  if (isSolved(state)) state.won = true
  return true
}

/**
 * 撤销最后一步（就地修改）。
 * @param state - 当前状态。
 * @returns 有步可撤返回 true；步数为 0 返回 false。
 */
export function undoMove(state: FrogSwapState): boolean {
  const last = state.history.pop()
  if (last === undefined) return false
  state.cells[last.from] = state.cells[last.to]!
  state.cells[last.to] = null
  state.moves -= 1
  state.won = false
  return true
}

/**
 * 最优步数闭式：每侧 f 只蛙时为 f*(f+2)（f=2→8、f=3→15、f=4→24、
 * f=5→35、f=6→48）。与 BFS 对拍见测试。
 * @param f - 每侧青蛙数。
 * @returns 最少步数。
 */
export function optimalMoveCount(f: number): number {
  return f * (f + 2)
}

/**
 * BFS 求给定局面的最少步数（测试对拍与死局佐证用；f≤6 状态空间
 * C(2f+1, f)·C(f+1, f) 最多约 13.5 万，毫秒级）。
 * @param cells - 荷叶位数组。
 * @returns 到达成互换的最少步数；无解返回 -1。
 */
export function bfsOptimal(cells: CellValue[]): number {
  const f = (cells.length - 1) / 2
  const keyOf = (c: CellValue[]): string => c.map(v => (v === null ? '_' : v)).join('')
  const goal: CellValue[] = []
  for (let i = 0; i < f; i += 1) goal.push('Y')
  goal.push(null)
  for (let i = 0; i < f; i += 1) goal.push('G')
  const goalKey = keyOf(goal)
  const start = keyOf(cells)
  if (start === goalKey) return 0
  const seen = new Set<string>([start])
  let frontier: CellValue[][] = [cells.map(v => v)]
  let depth = 0
  while (frontier.length > 0) {
    depth += 1
    const next: CellValue[][] = []
    for (const board of frontier) {
      for (let from = 0; from < board.length; from += 1) {
        for (let to = 0; to < board.length; to += 1) {
          if (moveKind(board, from, to) === null) continue
          const child = board.map(v => v)
          child[to] = child[from]!
          child[from] = null
          const k = keyOf(child)
          if (k === goalKey) return depth
          if (seen.has(k)) continue
          seen.add(k)
          next.push(child)
        }
      }
    }
    frontier = next
  }
  return -1
}

/**
 * 效率百分比：最优步数 / 已用步数（封顶 100）。
 * @param optimal - 最优步数。
 * @param moves - 已用步数。
 * @returns 0..100 的整数百分比。
 */
export function efficiency(optimal: number, moves: number): number {
  if (moves <= 0) return 100
  return Math.min(100, Math.round((optimal / moves) * 100))
}
