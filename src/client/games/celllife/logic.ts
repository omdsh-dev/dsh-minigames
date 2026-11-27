/**
 * 生命播种 CellLife 纯逻辑：Conway 生命游戏（B3/S23）反向求解谜题。
 * 8x8 盘面、中心 NxN 起始区摆细胞、空格逐步进化；目标是恰好 K 步后
 * 的图案与目标图案完全一致（不多不少）。关卡由注入的 mulberry32 种子
 * 确定性生成：先在起始区随机摆出起始图案，正向演化 K 步取快照作为
 * 目标——生成器构造上天然可解（起始图案本身就是一份解）。无 DOM、
 * 无副作用，全部函数可直接在 vitest 中验证。
 */

/** 网格单元：列 x、行 y，均从 0 起。 */
export interface Cell {
  x: number
  y: number
}

/** 盘面：GRID*GRID 个格子的存活标志（下标 y*GRID+x），盘外视为死亡。 */
export type Board = boolean[]

/** 盘面边长（8x8）。 */
export const GRID = 8

/** 总关卡数。 */
export const LEVEL_COUNT = 5

/** 一关的生成结果：步数预算、起始区、目标图案与一份已知解。 */
export interface LevelData {
  /** 0 起的关卡下标。 */
  level: number
  /** 进化步数预算 K（恰好 K 步后须等于目标）。 */
  steps: number
  /** 起始区边长 N（中心 NxN）。 */
  zone: number
  /** 起始区左上角单元。 */
  zoneOrigin: Cell
  /** 目标图案（K 步后应出现的细胞集合）。 */
  target: Cell[]
  /** 一份已知解：摆这些细胞并进化 K 步即达到目标（全部位于起始区内）。 */
  solution: Cell[]
}

/** 游戏进行态（index 层持有，逻辑层提供操作函数）。 */
export interface GameState {
  /** 当前关卡数据。 */
  data: LevelData
  /** 当前盘面。 */
  board: Board
  /** 已执行的进化步数。 */
  steps: number
  /** 本关重摆次数（计分用）。 */
  resets: number
  /** play 进行中 / won 恰好 K 步达成 / failed 步数用尽未达成。 */
  phase: 'play' | 'won' | 'failed'
}

/** 关卡规格（内部使用）：步数、起始区、随机起始细胞数与目标细胞数范围。 */
interface LevelSpec {
  steps: number
  zone: number
  minStart: number
  maxStart: number
  targetMin: number
  targetMax: number
}

/** 5 关递进：K=2→5 步、目标 3→8 细胞、起始区 3x3→4x4。 */
const SPECS: LevelSpec[] = [
  { steps: 2, zone: 3, minStart: 3, maxStart: 5, targetMin: 3, targetMax: 5 },
  { steps: 3, zone: 3, minStart: 3, maxStart: 6, targetMin: 3, targetMax: 5 },
  { steps: 4, zone: 3, minStart: 3, maxStart: 7, targetMin: 3, targetMax: 6 },
  { steps: 4, zone: 4, minStart: 3, maxStart: 8, targetMin: 3, targetMax: 7 },
  { steps: 5, zone: 4, minStart: 3, maxStart: 9, targetMin: 3, targetMax: 8 },
]

/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供生成与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 单元转下标。
 * @param c - 网格单元。
 * @returns y*GRID+x。
 */
export function cellIndex(c: Cell): number {
  return c.y * GRID + c.x
}

/**
 * 某格的存活邻居数（8 邻域，盘外一律按死亡计）。
 * @param board - 盘面。
 * @param x - 列。
 * @param y - 行。
 * @returns 0-8。
 */
export function neighborCount(board: Board, x: number, y: number): number {
  let n = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
      if (board[ny * GRID + nx] === true) n += 1
    }
  }
  return n
}

/**
 * Conway 生命游戏一步演化（B3/S23：恰好 3 邻居出生，2 或 3 邻居存活）。
 * 盘外视为死亡，演化不会越界扩散。
 * @param board - 当前盘面。
 * @returns 新盘面（新数组，入参不变）。
 */
export function evolveStep(board: Board): Board {
  const next: Board = new Array(GRID * GRID).fill(false)
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const alive = board[y * GRID + x] === true
      const n = neighborCount(board, x, y)
      next[y * GRID + x] = alive ? (n === 2 || n === 3) : n === 3
    }
  }
  return next
}

/**
 * 两个盘面是否逐格一致。
 * @param a - 盘面一。
 * @param b - 盘面二。
 * @returns 一致返回 true。
 */
export function boardsEqual(a: Board, b: Board): boolean {
  for (let i = 0; i < GRID * GRID; i += 1) {
    if ((a[i] === true) !== (b[i] === true)) return false
  }
  return true
}

/**
 * 细胞集合转盘面（越界忽略，重复合并）。
 * @param cells - 细胞集合。
 * @returns 盘面。
 */
export function cellsToBoard(cells: Cell[]): Board {
  const board: Board = new Array(GRID * GRID).fill(false)
  for (const c of cells) {
    if (c.x >= 0 && c.y >= 0 && c.x < GRID && c.y < GRID) board[cellIndex(c)] = true
  }
  return board
}

/**
 * 盘面转细胞集合（按 (y,x) 字典序）。
 * @param board - 盘面。
 * @returns 存活细胞列表。
 */
export function boardToCells(board: Board): Cell[] {
  const cells: Cell[] = []
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (board[y * GRID + x] === true) cells.push({ x, y })
    }
  }
  return cells
}

/**
 * 单元是否位于本关起始区（中心 NxN）内。
 * @param data - 关卡数据。
 * @param c - 待测单元。
 * @returns 区内返回 true。
 */
export function inZone(data: LevelData, c: Cell): boolean {
  const o = data.zoneOrigin
  return c.x >= o.x && c.y >= o.y && c.x < o.x + data.zone && c.y < o.y + data.zone
}

function zoneOriginFor(zone: number): Cell {
  const o = Math.floor((GRID - zone) / 2)
  return { x: o, y: o }
}

function sampleZoneCells(rng: () => number, zone: number, count: number): Cell[] {
  const o = zoneOriginFor(zone)
  const pool: Cell[] = []
  for (let y = 0; y < zone; y += 1) {
    for (let x = 0; x < zone; x += 1) pool.push({ x: o.x + x, y: o.y + y })
  }
  // 部分 Fisher-Yates：抽 count 个不重复单元。
  for (let i = 0; i < count && i < pool.length; i += 1) {
    const j = i + Math.floor(rng() * (pool.length - i))
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool.slice(0, count).sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * 生成一关：反复在起始区抽随机起始图案、正向演化 K 步，取目标细胞数
 * 落在规格区间内的快照为目标。快照本身就是正向演化的结果，因此关卡
 * 天然可解（起始图案即一份解）；重试只影响目标观感，不影响可解性。
 * 超过重试上限时接受最后一次尝试（可解性仍然成立）。
 * @param level - 0 起的关卡下标（0-4）。
 * @param seed - 种子。
 * @returns 关卡数据。
 */
export function buildLevel(level: number, seed: number): LevelData {
  const idx = Math.min(Math.max(level, 0), SPECS.length - 1)
  const spec = SPECS[idx]!
  const rng = mulberry32((seed ^ Math.imul(idx + 1, 0x9e3779b9)) >>> 0)
  const origin = zoneOriginFor(spec.zone)
  let chosen: { start: Cell[]; target: Cell[] } | null = null
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const count = spec.minStart + Math.floor(rng() * (spec.maxStart - spec.minStart + 1))
    const start = sampleZoneCells(rng, spec.zone, count)
    let board = cellsToBoard(start)
    for (let i = 0; i < spec.steps; i += 1) board = evolveStep(board)
    const target = boardToCells(board)
    chosen = { start, target }
    if (target.length >= spec.targetMin && target.length <= spec.targetMax) break
  }
  const picked = chosen!
  return {
    level: idx,
    steps: spec.steps,
    zone: spec.zone,
    zoneOrigin: origin,
    target: picked.target,
    solution: picked.start,
  }
}

/**
 * 开局（或进入新关）：空盘面、0 步、进行中。重摆次数沿用入参（跨关
 * 清零、同关重摆累加由调用方决定）。
 * @param data - 关卡数据。
 * @param resets - 初始重摆次数（一般传 0）。
 * @returns 初始游戏状态。
 */
export function newGame(data: LevelData, resets = 0): GameState {
  return {
    data,
    board: new Array(GRID * GRID).fill(false),
    steps: 0,
    resets,
    phase: 'play',
  }
}

/**
 * 摆放阶段（尚未进化）内切换一个细胞的生死。仅当进行中、未进化过且
 * 单元位于起始区内时生效。
 * @param state - 游戏状态。
 * @param c - 目标单元。
 * @returns 切换成功返回 true。
 */
export function toggleCell(state: GameState, c: Cell): boolean {
  if (state.phase !== 'play' || state.steps > 0) return false
  if (!inZone(state.data, c)) return false
  const i = cellIndex(c)
  state.board[i] = !(state.board[i] === true)
  return true
}

/**
 * 重摆：清空盘面回到摆放阶段（目标与步数预算不变）。
 * @param state - 游戏状态（原地修改）。
 */
export function resetPlacement(state: GameState): void {
  state.board = new Array(GRID * GRID).fill(false)
  state.steps = 0
  state.phase = 'play'
}

/**
 * 进化一步：推进盘面并计步。恰好用完 K 步时判定胜负——等于目标为
 * won，否则 failed；未到 K 步不判定（提前长得像也不算，必须不多不少）。
 * @param state - 游戏状态（原地修改）。
 * @returns 本步结果：'evolved' 仍在进行、'won' 达成、'failed' 用尽未达成。
 */
export function evolveOnce(state: GameState): 'evolved' | 'won' | 'failed' {
  if (state.phase !== 'play') return state.phase === 'won' ? 'won' : 'failed'
  if (state.steps >= state.data.steps) return 'failed'
  state.board = evolveStep(state.board)
  state.steps += 1
  if (state.steps >= state.data.steps) {
    const targetBoard = cellsToBoard(state.data.target)
    state.phase = boardsEqual(state.board, targetBoard) ? 'won' : 'failed'
  }
  return state.phase === 'won' ? 'won' : state.phase === 'failed' ? 'failed' : 'evolved'
}

/**
 * 预览（T 键）：当前盘面再进化一步的结果，不改动状态。
 * @param state - 游戏状态。
 * @returns 预览盘面。
 */
export function previewNext(state: GameState): Board {
  return evolveStep(state.board)
}

/**
 * 过关计分：基础分随关卡上升，重摆次数扣分，下限 100。
 * @param level - 1 起的关卡序号。
 * @param resets - 本关重摆次数。
 * @returns 得分。
 */
export function computeScore(level: number, resets: number): number {
  const base = 360 + level * 140
  return Math.max(100, base - resets * 25)
}
