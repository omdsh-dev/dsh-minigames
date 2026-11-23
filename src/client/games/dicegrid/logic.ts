/**
 * 骰子彩窗 DiceGrid 纯逻辑：Sagrada 式骰子放置谜题（简化版）。
 *
 * 盘面 4×4 彩窗网格；seed 注入（mulberry32）先生成一张合法满盘作为
 * 隐藏解，再从解出发派生预置约束（色点/数字/奇偶/≥4），保证盘面必定
 * 可解——测试可用 solutionPlacements 回放整条放置序列验证。骰子袋由
 * 解骰 + 填充骰洗混而成，逐轮发出 3-4 颗候选；放不进可弃骰（扣分），
 * 因此永无死局。全部随机走注入 seed，不含 DOM / canvas 依赖。
 *
 * 冲突规则（注意易误解点）：点数看整行整列（数独式不重复）；颜色只看
 * 上下左右正交相邻格（Sagrada 式）。若颜色也按整行整列不重复，则
 * 4 格的行需要 4 种互异颜色，2-3 色关卡在数学上无解。
 */

/** 逻辑盘面边长（4×4 固定）。 */
export const GRID = 4
/** 总格数。 */
export const CELLS = GRID * GRID
/** 关卡总数。 */
export const LEVEL_COUNT = 5
/** 骰子最大点数。 */
export const MAX_VALUE = 6

/** 一颗骰子：颜色索引（0 起，映射见渲染层）+ 点数（1-6）。 */
export interface Die {
  color: number
  value: number
}

/** 预置约束：该格只接受满足条件的骰子。 */
export type Constraint =
  | { kind: 'color'; color: number }
  | { kind: 'value'; value: number }
  | { kind: 'odd' }
  | { kind: 'even' }
  | { kind: 'gt3' }

/** 一个彩窗格：预置约束（可空）与已放骰子（可空）。 */
export interface Cell {
  constraint: Constraint | null
  die: Die | null
}

/** 关卡难度参数。 */
export interface LevelConfig {
  /** 本关骰子颜色种数（2 → 3 → 4 递进）。 */
  colors: number
  /** 预置约束格数量（逐关增多）。 */
  fixedCells: number
  /** 每轮发出的候选骰数量（3-4）。 */
  rackSize: number
}

/** 一局游戏的完整可变状态（逻辑层视角，渲染层另持 UI 态）。 */
export interface DiceGameState {
  level: number
  seed: number
  board: Cell[][]
  /** 隐藏解（generateBoard 生成，保证可行）。 */
  solution: Die[][]
  /** 骰子袋（ upcoming 顺序）。 */
  bag: Die[]
  /** 当前候选骰架。 */
  rack: Die[]
  discarded: number
  placed: number
  won: boolean
  /** 发骰随机源（由 seed + 关卡派生，进程内确定性）。 */
  rng: () => number
}

/**
 * mulberry32 种子随机数发生器（确定性，[0, 1)）。
 * @param seed - 非负整数种子。
 * @returns 产生同 seed 下同一 [0,1) 序列的函数。
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
 * 关卡难度表：颜色 2,2,3,3,4；约束格 3→7；每轮候选 3→4。
 * @param level - 1 起的关卡号（1..LEVEL_COUNT，越界取边界值）。
 * @returns 该关的颜色数 / 约束格数 / 候选数。
 */
export function levelConfig(level: number): LevelConfig {
  const table: LevelConfig[] = [
    { colors: 2, fixedCells: 3, rackSize: 3 },
    { colors: 2, fixedCells: 4, rackSize: 3 },
    { colors: 3, fixedCells: 5, rackSize: 4 },
    { colors: 3, fixedCells: 6, rackSize: 4 },
    { colors: 4, fixedCells: 7, rackSize: 4 },
  ]
  const i = Math.min(Math.max(level, 1), LEVEL_COUNT) - 1
  return table[i]!
}

/**
 * 约束求值：骰子是否满足预置条件。
 * @param constraint - 预置约束。
 * @param die - 待检查骰子。
 * @returns 满足返回 true。
 */
export function satisfiesConstraint(constraint: Constraint, die: Die): boolean {
  switch (constraint.kind) {
    case 'color':
      return die.color === constraint.color
    case 'value':
      return die.value === constraint.value
    case 'odd':
      return die.value % 2 === 1
    case 'even':
      return die.value % 2 === 0
    case 'gt3':
      return die.value > 3
  }
}

const shuffle = <T,>(items: T[], rng: () => number): T[] => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

/**
 * 随机骰子（不检查任何约束）。
 * @param rng - 随机源。
 * @param colors - 颜色种数。
 * @returns 一颗随机骰。
 */
export function randomDie(rng: () => number, colors: number): Die {
  return { color: Math.floor(rng() * colors), value: 1 + Math.floor(rng() * MAX_VALUE) }
}

/**
 * 位置取骰访问器：满盘生成用 (Die|null) 网格，对局判定用 Cell 网格，
 * 两者共用同一套冲突检测。
 */
type DieAt = (r: number, c: number) => Die | null

/** 点数冲突：同一行或同一列已出现同点数骰。 */
const valueConflicts = (dieAt: DieAt, r: number, c: number, die: Die): boolean => {
  for (let i = 0; i < GRID; i += 1) {
    const rowDie = dieAt(r, i)
    if (rowDie !== null && rowDie.value === die.value) return true
    const colDie = dieAt(i, c)
    if (colDie !== null && colDie.value === die.value) return true
  }
  return false
}

/** 颜色冲突：上下左右正交相邻格已出现同色骰。 */
const colorConflicts = (dieAt: DieAt, r: number, c: number, die: Die): boolean => {
  const neighbors: [number, number][] = []
  if (r > 0) neighbors.push([r - 1, c])
  if (r < GRID - 1) neighbors.push([r + 1, c])
  if (c > 0) neighbors.push([r, c - 1])
  if (c < GRID - 1) neighbors.push([r, c + 1])
  for (const [nr, nc] of neighbors) {
    const n = dieAt(nr, nc)
    if (n !== null && n.color === die.color) return true
  }
  return false
}

/** 满盘合法判定（不含预置约束）：行/列点数互异 + 正交相邻颜色互异。 */
const fitsSolution = (dieAt: DieAt, r: number, c: number, die: Die): boolean =>
  !valueConflicts(dieAt, r, c, die) && !colorConflicts(dieAt, r, c, die)

/**
 * 随机回溯生成一张合法满盘（隐藏解）。随机候选顺序注入 rng，4×4 小盘
 * 必然成功（颜色种数 ≥ 2 时棋盘式染色即可满足相邻颜色约束）。
 * @param rng - 随机源。
 * @param colors - 颜色种数。
 * @returns 4×4 满盘 Die 矩阵。
 */
function generateSolution(rng: () => number, colors: number): Die[][] {
  const grid: (Die | null)[][] = []
  for (let r = 0; r < GRID; r += 1) {
    grid.push([null, null, null, null])
  }
  const all: Die[] = []
  for (let color = 0; color < colors; color += 1) {
    for (let value = 1; value <= MAX_VALUE; value += 1) all.push({ color, value })
  }
  const solve = (r: number, c: number): boolean => {
    if (r === GRID) return true
    const nextR = c === GRID - 1 ? r + 1 : r
    const nextC = c === GRID - 1 ? 0 : c + 1
    const candidates = shuffle([...all], rng)
    const gridAt: DieAt = (rr: number, cc: number): Die | null => grid[rr]![cc]!
    for (const die of candidates) {
      if (!fitsSolution(gridAt, r, c, die)) continue
      grid[r]![c] = die
      if (solve(nextR, nextC)) return true
      grid[r]![c] = null
    }
    return false
  }
  if (!solve(0, 0)) throw new Error('dicegrid: 4x4 解盘生成失败（不可能分支）')
  return grid as Die[][]
}

/**
 * 生成一关：先造隐藏解，再挑 fixedCells 个格子派生与解一致的预置约束，
 * 最后把 16 颗解骰 + 填充骰洗混成骰子袋。同 (level, seed) 结果确定。
 * @param level - 关卡号（1 起）。
 * @param seed - 种子。
 * @returns 尚未发候选的初始状态（需再调 dealRound）。
 */
export function generateBoard(level: number, seed: number): DiceGameState {
  const cfg = levelConfig(level)
  const rng = mulberry32((seed ^ 0x1f123bb5) + level * 6151)
  const solution = generateSolution(rng, cfg.colors)
  const board: Cell[][] = []
  for (let r = 0; r < GRID; r += 1) {
    const row: Cell[] = []
    for (let c = 0; c < GRID; c += 1) row.push({ constraint: null, die: null })
    board.push(row)
  }
  const cellOrder = shuffle([...Array(CELLS).keys()], rng)
  for (let i = 0; i < cfg.fixedCells; i += 1) {
    const index = cellOrder[i]!
    const r = Math.floor(index / GRID)
    const c = index % GRID
    const die = solution[r]![c]!
    const options: Constraint[] = [
      { kind: 'color', color: die.color },
      { kind: 'value', value: die.value },
      die.value % 2 === 1 ? { kind: 'odd' } : { kind: 'even' },
    ]
    if (die.value > 3) options.push({ kind: 'gt3' })
    board[r]![c]!.constraint = options[Math.floor(rng() * options.length)]!
  }
  const bag: Die[] = []
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) bag.push({ ...solution[r]![c]! })
  }
  const filler = 8 + cfg.fixedCells
  for (let i = 0; i < filler; i += 1) bag.push(randomDie(rng, cfg.colors))
  shuffle(bag, rng)
  return { level, seed, board, solution, bag, rack: [], discarded: 0, placed: 0, won: false, rng }
}

/**
 * 创建一局并发出第一轮候选。
 * @param level - 关卡号（1 起）。
 * @param seed - 种子。
 * @returns 就绪状态。
 */
export function createGame(level: number, seed: number): DiceGameState {
  const state = generateBoard(level, seed)
  dealRound(state)
  return state
}

/**
 * 发一轮候选骰：从骰子袋取 rackSize 颗；袋存量不足时先补 10 颗随机骰，
 * 因此永远发得出（弃骰永远可用，游戏无死局）。
 * @param state - 游戏状态（原地修改 rack/bag）。
 */
export function dealRound(state: DiceGameState): void {
  const cfg = levelConfig(state.level)
  if (state.bag.length < cfg.rackSize) {
    for (let i = 0; i < 10; i += 1) state.bag.push(randomDie(state.rng, cfg.colors))
  }
  state.rack = state.bag.splice(0, cfg.rackSize)
}

/**
 * 合法放置判定：空格 + 预置约束满足 + 整行整列无同点数 + 正交相邻无同色。
 * @param state - 游戏状态。
 * @param r - 行（0 起）。
 * @param c - 列（0 起）。
 * @param die - 待放骰子。
 * @returns 可放返回 true。
 */
export function canPlaceDie(state: DiceGameState, r: number, c: number, die: Die): boolean {
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return false
  const cell = state.board[r]![c]!
  if (cell.die !== null) return false
  if (cell.constraint !== null && !satisfiesConstraint(cell.constraint, die)) return false
  const boardAt: DieAt = (rr: number, cc: number): Die | null => state.board[rr]![cc]!.die
  return fitsSolution(boardAt, r, c, die)
}

/**
 * 放置候选骰架上的第 rackIndex 颗骰子。
 * @param state - 游戏状态（原地修改）。
 * @param rackIndex - 候选索引（0 起）。
 * @param r - 目标行。
 * @param c - 目标列。
 * @returns 非法放置返回 false；成功放置消耗候选，放满 16 格判胜，
 * 骰架空则自动补发一轮。
 */
export function placeDie(state: DiceGameState, rackIndex: number, r: number, c: number): boolean {
  const die = state.rack[rackIndex]
  if (die === undefined) return false
  if (!canPlaceDie(state, r, c, die)) return false
  state.board[r]![c]!.die = die
  state.rack.splice(rackIndex, 1)
  state.placed += 1
  if (state.placed === CELLS) state.won = true
  else if (state.rack.length === 0) dealRound(state)
  return true
}

/**
 * 弃掉候选骰架上的第 rackIndex 颗骰子（计分惩罚；骰架空自动补发）。
 * @param state - 游戏状态（原地修改）。
 * @param rackIndex - 候选索引（0 起）。
 * @returns 越界返回 false。
 */
export function discardDie(state: DiceGameState, rackIndex: number): boolean {
  if (rackIndex < 0 || rackIndex >= state.rack.length) return false
  state.rack.splice(rackIndex, 1)
  state.discarded += 1
  if (state.rack.length === 0) dealRound(state)
  return true
}

/**
 * 隐藏解的可行放置序列（行优先顺序）：因为整张解盘全局一致，任意子集
 * 也一致，按此序列逐颗放置必然每步合法直至放满。
 * @param solution - generateBoard 返回的解盘。
 * @returns 逐格放置步骤（含行、列、骰）。
 */
export function solutionPlacements(solution: Die[][]): { r: number; c: number; die: Die }[] {
  const steps: { r: number; c: number; die: Die }[] = []
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) steps.push({ r, c, die: solution[r]![c]! })
  }
  return steps
}

/**
 * 过关得分：基础分 + 关卡加成 − 弃骰惩罚（每颗 3 分，下限 0）。
 * @param level - 关卡号。
 * @param discarded - 弃骰数。
 * @returns 得分。
 */
export function computeScore(level: number, discarded: number): number {
  return Math.max(0, 60 + level * 15 - discarded * 3)
}
