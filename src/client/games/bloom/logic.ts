/**
 * 开花连消 Bloom 纯逻辑：8×8 花田、同色四邻连锁绽放、石头格阻挡、
 * 限定点击数内全田开花、计分（每次连锁规模 × 连锁规模）。所有随机都
 * 来自注入 seed 的 mulberry32，同一 (关卡, seed) 生成完全一致的盘面，
 * 纯函数可测、可重放。
 *
 * 连锁规则：点击一个花苞，它与其四邻同色花苞组成第 0 波「开放组」；
 * 此后任何已绽放的花（开局已开、此前点击开出的都算）都会把它四邻中
 * 与本次新绽放同色的花苞卷入下一波，逐层递归扩散（涟漪）。因此先开
 * 出的每朵花都是后续连锁的放大器——点击顺序决定连锁规模。
 */
/** 网格边长（8×8）。 */
export const GRID = 8
/** 格子总数。 */
export const CELLS = GRID * GRID
/** 关卡数。 */
export const LEVEL_COUNT = 5

/** 一格：花苞（未开）、已绽放的花、石头（不可开花、不传导）。 */
export type Cell =
  | { kind: 'bud'; color: number }
  | { kind: 'bloom'; color: number }
  | { kind: 'stone'; color: number }

/** 关卡参数：颜色数、开局已开的花数、石头数、点击预算冗余。 */
export interface LevelConfig {
  /** 花苞颜色种数。 */
  colors: number
  /** 开局已绽放的花的数量（连锁放大器）。 */
  preBloomed: number
  /** 石头格数量。 */
  stones: number
  /** 点击预算 = 贪心解点击数 + slack（高关卡收紧到 0）。 */
  slack: number
}

/** 五关：颜色更多、石头更多、点击更紧。 */
export const LEVELS: readonly LevelConfig[] = [
  { colors: 4, preBloomed: 5, stones: 0, slack: 3 },
  { colors: 4, preBloomed: 4, stones: 4, slack: 2 },
  { colors: 5, preBloomed: 3, stones: 5, slack: 2 },
  { colors: 5, preBloomed: 2, stones: 7, slack: 1 },
  { colors: 5, preBloomed: 2, stones: 9, slack: 0 },
]

/** 对局状态（纯数据，可整体拷贝重放）。 */
export interface BloomState {
  /** 关卡号（1..LEVEL_COUNT）。 */
  level: number
  /** 盘面（长度 64，行主序）。 */
  grid: Cell[]
  /** 已用点击数。 */
  clicksUsed: number
  /** 剩余点击数。 */
  clicksLeft: number
  /** 累计得分。 */
  score: number
  /** 进行中 / 已过关（全田绽放）/ 已失败（点击用尽仍有花苞）。 */
  status: 'playing' | 'won' | 'lost'
}

/** 连锁中的一步：哪格在哪一波绽放（涟漪动画与统计共用）。 */
export interface ChainStep {
  /** 格子下标（行主序）。 */
  index: number
  /** 波次：0 = 点击的开放组，越大越晚。 */
  layer: number
}

/** 一次点击的结果。 */
export interface ClickResult {
  /** 连锁步骤（按波次顺序）。 */
  steps: ChainStep[]
  /** 连锁规模（本次新开花朵数，含被点花苞）。 */
  chainSize: number
  /** 本次得分 = chainSize × chainSize。 */
  gained: number
  /** 是否达成全田绽放。 */
  won: boolean
  /** 是否因点击用尽而失败。 */
  lost: boolean
}

/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 任意 32 位整数。
 * @returns 返回 [0, 1) 随机数的函数；同 seed 序列完全一致。
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
 * 某格的四邻下标（不越界；石头/异色只是不传导，邻接关系本身存在）。
 * @param index - 格子下标（行主序）。
 * @returns 四邻下标数组（顺序：上、下、左、右）。
 */
export function neighborsOf(index: number): number[] {
  const r = Math.floor(index / GRID)
  const c = index % GRID
  const out: number[] = []
  if (r > 0) out.push(index - GRID)
  if (r < GRID - 1) out.push(index + GRID)
  if (c > 0) out.push(index - 1)
  if (c < GRID - 1) out.push(index + 1)
  return out
}

/**
 * 纯函数：从某花苞出发的一次连锁（不改盘面）。
 * 第 0 波 = 点击的花苞与其四邻同色花苞；此后每波把「与任一已绽放花
 * 四邻相邻且同本次颜色的花苞」卷入——开局已开与此前点击开出的花都是
 * 连锁源，故连锁规模随已开网络增长。
 * @param grid - 盘面。
 * @param index - 点击的花苞下标。
 * @returns 连锁步骤（按波次）；点击非花苞返回空数组。
 */
export function computeChain(grid: Cell[], index: number): ChainStep[] {
  const cell = grid[index]!
  if (cell.kind !== 'bud') return []
  const color = cell.color
  const steps: ChainStep[] = []
  const visited = new Array<boolean>(CELLS).fill(false)
  const enqueue = (i: number, layer: number): boolean => {
    const c = grid[i]!
    if (c.kind !== 'bud' || c.color !== color || visited[i]) return false
    visited[i] = true
    steps.push({ index: i, layer })
    return true
  }
  // 第 0 波：开放组 = 点击花苞 + 其四邻同色花苞。
  enqueue(index, 0)
  for (const n of neighborsOf(index)) enqueue(n, 0)
  let frontier = steps.map((s) => s.index)
  let layer = 0
  // 已绽放的花（开局已开 + 此前点击开出）是常驻连锁源，第 1 波即触发。
  const bloomedSources: number[] = []
  for (let i = 0; i < CELLS; i += 1) {
    if (grid[i]!.kind === 'bloom') bloomedSources.push(i)
  }
  while (frontier.length > 0) {
    const next: number[] = []
    for (const f of frontier) {
      for (const n of neighborsOf(f)) {
        if (enqueue(n, layer + 1)) next.push(n)
      }
    }
    if (layer === 0) {
      for (const p of bloomedSources) {
        for (const n of neighborsOf(p)) {
          if (enqueue(n, layer + 1)) next.push(n)
        }
      }
    }
    frontier = next
    layer += 1
  }
  return steps
}

/**
 * 把连锁步骤落到盘面（花苞 → 已绽放，颜色保留）。
 * @param grid - 盘面（就地修改）。
 * @param steps - computeChain 的结果。
 */
export function applyChain(grid: Cell[], steps: ChainStep[]): void {
  for (const s of steps) {
    const c = grid[s.index]!
    if (c.kind === 'bud') grid[s.index] = { kind: 'bloom', color: c.color }
  }
}

/**
 * 剩余花苞数。
 * @param grid - 盘面。
 * @returns 未开花苞数量。
 */
export function countBuds(grid: Cell[]): number {
  let n = 0
  for (let i = 0; i < grid.length; i += 1) if (grid[i]!.kind === 'bud') n += 1
  return n
}

/**
 * 是否全田绽放（无花苞）。
 * @param grid - 盘面。
 */
export function isCleared(grid: Cell[]): boolean {
  return countBuds(grid) === 0
}

/**
 * 执行一次点击：连锁绽放、计分（连锁²）、扣点击、判定胜负。
 * @param state - 对局状态（就地修改）。
 * @param index - 点击的花苞下标。
 * @returns 点击结果；对局已结束或点击非花苞时返回 null（状态不变）。
 */
export function clickCell(state: BloomState, index: number): ClickResult | null {
  if (state.status !== 'playing') return null
  if (state.grid[index]!.kind !== 'bud') return null
  const steps = computeChain(state.grid, index)
  if (steps.length === 0) return null
  applyChain(state.grid, steps)
  const gained = steps.length * steps.length
  state.score += gained
  state.clicksUsed += 1
  state.clicksLeft -= 1
  const won = isCleared(state.grid)
  state.status = won ? 'won' : state.clicksLeft <= 0 ? 'lost' : 'playing'
  return { steps, chainSize: steps.length, gained, won, lost: state.status === 'lost' }
}

/** 盘面深拷贝（格子对象逐个复制，互不共享）。 */
function cloneGrid(grid: Cell[]): Cell[] {
  return grid.map((c) => ({ kind: c.kind, color: c.color }))
}

/** 贪心求解结果。 */
export interface GreedySolve {
  /** 清空花田所需的点击数。 */
  clicks: number
  /** 按此顺序点击的总得分。 */
  score: number
  /** 点击下标序列（每步选当前连锁最大的花苞，平局取最小下标）。 */
  path: number[]
}

/**
 * 贪心求解：每步点当前连锁规模最大的花苞直到全田绽放。确定性（平局
 * 取最小下标），用于生成器推导点击预算并保证可解性。
 * @param state - 对局状态（只读，求解在拷贝上进行）。
 * @returns 点击数、总分与点击序列。
 */
export function solveGreedy(state: BloomState): GreedySolve {
  const grid = cloneGrid(state.grid)
  const path: number[] = []
  let score = 0
  while (!isCleared(grid)) {
    let best = -1
    let bestSize = 0
    for (let i = 0; i < CELLS; i += 1) {
      if (grid[i]!.kind !== 'bud') continue
      const size = computeChain(grid, i).length
      if (size > bestSize) {
        bestSize = size
        best = i
      }
    }
    if (best < 0) break
    const steps = computeChain(grid, best)
    applyChain(grid, steps)
    score += steps.length * steps.length
    path.push(best)
  }
  return { clicks: path.length, score, path }
}

/**
 * 用手工盘面构造对局（测试与教学场景；不做生成与预算推导）。
 * @param level - 关卡号（仅展示用，不校验范围）。
 * @param grid - 长度必须为 GRID*GRID 的盘面。
 * @param clicksLeft - 初始剩余点击数。
 * @returns 初始对局状态。
 */
export function createState(level: number, grid: Cell[], clicksLeft: number): BloomState {
  if (grid.length !== CELLS) {
    throw new Error('bloom: grid length must be ' + CELLS)
  }
  return { level, grid, clicksUsed: 0, clicksLeft, score: 0, status: 'playing' }
}

/** Fisher-Yates 洗牌（rng 注入，确定性）。 */
function shuffle(order: number[], rng: () => number): number[] {
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const t = order[i]!
    order[i] = order[j]!
    order[j] = t
  }
  return order
}

/**
 * 生成一关盘面：石头格、开局已开的花、随机颜色花苞；点击预算 =
 * 贪心解点击数 + 关卡 slack（贪心解必可清场，故预算内必可过关）。
 * @param level - 关卡号（1..LEVEL_COUNT）。
 * @param seed - 随机种子。
 * @returns 初始对局状态；关卡号越界返回 null。
 */
export function generateBoard(level: number, seed: number): BloomState | null {
  if (level < 1 || level > LEVEL_COUNT) return null
  const cfg = LEVELS[level - 1]!
  const rng = mulberry32((seed ^ Math.imul(level, 0x9e3779b9)) >>> 0)
  const grid: Cell[] = new Array<Cell>(CELLS)
  for (let i = 0; i < CELLS; i += 1) {
    grid[i] = { kind: 'bud', color: Math.floor(rng() * cfg.colors) }
  }
  // 石头与已开的花从打乱的下标里顺序取，互不重叠。
  const order = shuffle(
    Array.from({ length: CELLS }, (_, i) => i),
    rng,
  )
  let taken = 0
  for (let k = 0; k < cfg.stones; k += 1) {
    grid[order[taken]!] = { kind: 'stone', color: 0 }
    taken += 1
  }
  for (let k = 0; k < cfg.preBloomed; k += 1) {
    const i = order[taken]!
    grid[i] = { kind: 'bloom', color: grid[i]!.color }
    taken += 1
  }
  const state = createState(level, grid, 0)
  const greedy = solveGreedy(state)
  state.clicksLeft = greedy.clicks + cfg.slack
  return state
}
