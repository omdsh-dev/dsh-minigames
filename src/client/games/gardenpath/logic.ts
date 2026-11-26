/**
 * 花径寻踪 GardenPath 纯逻辑：数字约束种植谜题（独立支配集谜题）。盘面
 * 三种格——空地（可种花或留草）、岩石（不可种）、数字提示格（不可种；
 * 数字 N 表示其上下左右四邻中恰有 N 朵花）。一个合法整体解满足四条
 * 约束：①每条提示的四邻花数精确匹配；②任意两朵花八向不相邻（横竖斜
 * 都算）；③岩石与提示格不可种；④覆盖（花径）：每块留草的空地必须
 * 紧挨着至少一朵花（八向），花要「铺满」整座花园的路径。
 *
 * 生成器先随机铺岩石与一版随机完整解（贪心独立支配集），再随机放 6-8
 * 个初始提示，随后「定向挖洞」：求解器给出两个不同解，找一个能把两个
 * 解区分开的提示格（四邻花数在两解下不同）钉上去，重复到全盘恰有唯一
 * 解。求解器带三条传播规则（花逼邻草、唯一掩护格逼花、提示精确计数逼
 * 迫），大至 12×12 也是毫秒级。一切随机走注入 seed 的 mulberry32，同
 * seed 必然得到同一张盘，确定性可测。
 */

/** 五个关卡的盘面边长（8×8 → 12×12）。 */
export const LEVEL_SIZES = [8, 9, 10, 11, 12] as const

/** 关卡总数。 */
export const LEVEL_COUNT = LEVEL_SIZES.length

/** 空地标记（可种花，也可留草）。 */
export const CELL_EMPTY = 0
/** 岩石标记（不可种）。 */
export const CELL_ROCK = 1
/** 数字提示格标记（不可种）。 */
export const CELL_CLUE = 2

/** 玩家标记：留草。 */
export const MARK_GRASS = 0
/** 玩家标记：花。 */
export const MARK_FLOWER = 1

/** 一张花径盘面。 */
export interface GardenPathPuzzle {
  /** 盘面边长（格）。 */
  size: number
  /** 每格种类：CELL_EMPTY / CELL_ROCK / CELL_CLUE。 */
  cells: Uint8Array
  /** 提示数字：仅 CELL_CLUE 格有效（0-4），其余为 -1。 */
  clueNumbers: Int8Array
  /** 生成时的唯一完整解：1 = 该空地是花，其余为 0。 */
  solution: Uint8Array
}

/** mulberry32 伪随机数发生器：小而快，同 seed 序列确定。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x9e3779f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 1 基关卡对应的盘面边长（超过关卡总数后循环）。
 * @param level - 1 基关卡号。
 * @returns 该关的盘面边长。
 */
export function levelSize(level: number): number {
  return LEVEL_SIZES[(level - 1) % LEVEL_COUNT]!
}

/** 用 Fisher-Yates 洗牌（确定性，走注入的 rand）。 */
function shuffledIndices(rand: () => number, n: number): number[] {
  const arr: number[] = []
  for (let i = 0; i < n; i += 1) arr.push(i)
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

/** cell 的上下左右四邻（不出盘）。 */
function orthNeighbors(size: number, cell: number): number[] {
  const r = Math.floor(cell / size)
  const c = cell % size
  const out: number[] = []
  if (r > 0) out.push(cell - size)
  if (r < size - 1) out.push(cell + size)
  if (c > 0) out.push(cell - 1)
  if (c < size - 1) out.push(cell + 1)
  return out
}

/** cell 的八邻（横竖斜，不出盘）。 */
function neighbors8(size: number, cell: number): number[] {
  const r = Math.floor(cell / size)
  const c = cell % size
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
      out.push(nr * size + nc)
    }
  }
  return out
}

/**
 * 两格是否八向相邻（横竖斜都算）。
 * @param size - 盘面边长。
 * @param a - 第一格。
 * @param b - 第二格。
 */
export function flowersAdjacent(size: number, a: number, b: number): boolean {
  const dr = Math.abs(Math.floor(a / size) - Math.floor(b / size))
  const dc = Math.abs((a % size) - (b % size))
  return dr <= 1 && dc <= 1 && dr + dc > 0
}

/** 求解结果：完整解列表（封顶于 cap）与是否因节点预算耗尽提前放弃。 */
export interface SolveResult {
  /** 找到的完整解（每格 1=花 / 0=草）。 */
  solutions: Uint8Array[]
  exhausted: boolean
}

/**
 * 传播式回溯求解器：数一盘面在四约束下的完整解。三条传播规则——
 * A 花逼邻草（八向邻格若未定则定为草）；B 唯一掩护（留草格仅剩一个
 * 未定掩护格时它必是花）；C 提示精确计数（差值=0 逼草 / 差值=余量逼
 * 花）。分支选掩护最紧（pot 最小、邻提示最多）的未定格，花先草后。
 * @param size - 盘面边长。
 * @param cells - 格种类数组。
 * @param clueNumbers - 提示数字数组。
 * @param cap - 数到该解数即停（唯一性验证用 2）。
 * @param nodeBudget - 最大分支节点数，超出置 exhausted。
 * @returns 完整解列表（≤ cap）与 exhausted 标志。
 */
export function solveBoard(
  size: number,
  cells: Uint8Array,
  clueNumbers: Int8Array,
  cap = 2,
  nodeBudget = 2_000_000,
): SolveResult {
  const n = size * size
  const clueIndexByCell = new Int32Array(n).fill(-1)
  const clueCells: number[] = []
  for (let i = 0; i < n; i += 1) {
    if (cells[i] === CELL_CLUE) {
      clueIndexByCell[i] = clueCells.length
      clueCells.push(i)
    }
  }
  const n8: number[][] = []
  const orth: number[][] = []
  const clueOf: number[][] = []
  const sharedEmpty: number[] = []
  const state = new Int8Array(n).fill(-1)
  for (let i = 0; i < n; i += 1) {
    n8.push(neighbors8(size, i))
    orth.push(orthNeighbors(size, i))
    if (cells[i] !== CELL_EMPTY) {
      state[i] = 0
      clueOf.push(sharedEmpty)
      continue
    }
    const list: number[] = []
    for (const nb of orth[i]!) {
      if (clueIndexByCell[nb]! >= 0) list.push(clueIndexByCell[nb]!)
    }
    clueOf.push(list.length === 0 ? sharedEmpty : list)
  }
  const need: number[] = []
  const have: number[] = []
  const und: number[] = []
  for (let ci = 0; ci < clueCells.length; ci += 1) {
    const cell = clueCells[ci]!
    need.push(clueNumbers[cell]!)
    have.push(0)
    let u = 0
    for (const nb of orth[cell]!) {
      if (cells[nb] === CELL_EMPTY) u += 1
    }
    und.push(u)
  }
  // 覆盖记账：pot = 未定掩护格数（自身 + 空地八邻），fl = 已是花的掩护数。
  const pot = new Int32Array(n)
  const fl = new Int32Array(n)
  for (let i = 0; i < n; i += 1) {
    if (cells[i] !== CELL_EMPTY) continue
    pot[i] = 1 + n8[i]!.filter(nb => cells[nb] === CELL_EMPTY).length
    fl[i] = 0
  }

  const trail: number[] = []
  let nodes = 0
  let exhausted = false

  /** 提交一格赋值并增量更新全部计数；冲突返回 false（赋值仍留在栈上）。 */
  const assign = (cell: number, val: number): boolean => {
    if (state[cell] !== -1) return state[cell] === val
    state[cell] = val
    trail.push(cell)
    if (val === 1) {
      for (const nb of n8[cell]!) {
        if (state[nb] === 1) return false
      }
    }
    if (cells[cell] === CELL_EMPTY) {
      pot[cell] = pot[cell]! - 1
      if (val === 1) fl[cell] = fl[cell]! + 1
    }
    for (const nb of n8[cell]!) {
      if (cells[nb] === CELL_EMPTY) {
        pot[nb] = pot[nb]! - 1
        if (val === 1) fl[nb] = fl[nb]! + 1
      }
    }
    for (const ci of clueOf[cell]!) {
      if (val === 1) have[ci] = have[ci]! + 1
      und[ci] = und[ci]! - 1
    }
    return validAfter(cell)
  }

  /** 赋值后的局部约束检查（提示上下界 + 受影响格的覆盖可行性）。 */
  const validAfter = (cell: number): boolean => {
    for (const ci of clueOf[cell]!) {
      if (have[ci]! > need[ci]! || have[ci]! + und[ci]! < need[ci]!) return false
    }
    const check = (i: number): boolean => {
      if (cells[i] !== CELL_EMPTY || state[i] === 1) return true
      return fl[i]! > 0 || pot[i]! > 0
    }
    if (!check(cell)) return false
    for (const nb of n8[cell]!) {
      if (!check(nb)) return false
    }
    return true
  }

  /** 回滚到分支点（trail 反向恢复，与 assign 严格对称）。 */
  const undoTo = (mark: number): void => {
    while (trail.length > mark) {
      const cell = trail.pop()!
      const val = state[cell]!
      state[cell] = -1
      if (cells[cell] === CELL_EMPTY) {
        pot[cell] = pot[cell]! + 1
        if (val === 1) fl[cell] = fl[cell]! - 1
      }
      for (const nb of n8[cell]!) {
        if (cells[nb] === CELL_EMPTY) {
          pot[nb] = pot[nb]! + 1
          if (val === 1) fl[nb] = fl[nb]! - 1
        }
      }
      for (const ci of clueOf[cell]!) {
        if (val === 1) have[ci]! -= 1
        und[ci] = und[ci]! + 1
      }
    }
  }

  /** 传播到不动点：返回 false 表示当前分支矛盾。 */
  const propagate = (): boolean => {
    for (;;) {
      let progress = false
      // 规则 A：花逼邻草。
      for (let i = 0; i < n; i += 1) {
        if (cells[i] !== CELL_EMPTY || state[i] !== 1) continue
        for (const nb of n8[i]!) {
          if (cells[nb] === CELL_EMPTY && state[nb] === -1) {
            if (!assign(nb, 0)) return false
            progress = true
          }
        }
      }
      // 规则 B：唯一掩护格逼花。
      for (let i = 0; i < n; i += 1) {
        if (cells[i] !== CELL_EMPTY || state[i] === 1) continue
        if (fl[i]! > 0 || pot[i]! > 1) continue
        let target = -1
        let count = 0
        for (const p of [i, ...n8[i]!]) {
          if (cells[p] === CELL_EMPTY && state[p] === -1) {
            target = p
            count += 1
          }
        }
        if (count !== 1) continue
        if (!assign(target, 1)) return false
        progress = true
      }
      // 规则 C：提示精确计数逼迫。
      for (let ci = 0; ci < clueCells.length; ci += 1) {
        const cell = clueCells[ci]!
        const rem = need[ci]! - have[ci]!
        if (rem === 0 && und[ci]! > 0) {
          for (const nb of orth[cell]!) {
            if (cells[nb] === CELL_EMPTY && state[nb] === -1) {
              if (!assign(nb, 0)) return false
              progress = true
            }
          }
        } else if (rem === und[ci]! && und[ci]! > 0) {
          for (const nb of orth[cell]!) {
            if (cells[nb] === CELL_EMPTY && state[nb] === -1) {
              if (!assign(nb, 1)) return false
              progress = true
            }
          }
        }
      }
      if (!progress) return true
    }
  }

  /** 分支格：未定空地里掩护最紧、邻提示最多的。 */
  const pick = (): number => {
    let best = -1
    let bestScore = Infinity
    for (let i = 0; i < n; i += 1) {
      if (cells[i] !== CELL_EMPTY || state[i] !== -1) continue
      const score = pot[i]! * 4 - clueOf[i]!.length * 3
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  const found: Uint8Array[] = []
  const dfs = (): void => {
    if (exhausted || found.length >= cap) return
    const cell = pick()
    if (cell === -1) {
      found.push(new Uint8Array(state))
      return
    }
    nodes += 1
    if (nodes > nodeBudget) {
      exhausted = true
      return
    }
    const mark = trail.length
    if (assign(cell, 1) && propagate()) dfs()
    undoTo(mark)
    if (exhausted || found.length >= cap) return
    if (assign(cell, 0) && propagate()) dfs()
    undoTo(mark)
  }

  if (!propagate()) return { solutions: [], exhausted: false }
  dfs()
  return { solutions: found, exhausted }
}

/**
 * 数一盘面的完整解数（封顶 cap，通常传 2 做唯一性验证）。
 * @returns 解数与 exhausted 标志。
 */
export function countSolutions(
  size: number,
  cells: Uint8Array,
  clueNumbers: Int8Array,
  cap = 2,
  nodeBudget = 2_000_000,
): { solutions: number, exhausted: boolean } {
  const r = solveBoard(size, cells, clueNumbers, cap, nodeBudget)
  return { solutions: r.solutions.length, exhausted: r.exhausted }
}

/** 生成一版随机完整解：贪心独立支配集（随机顺序 + 随机跳格 + 补覆盖）。 */
function randomSolution(
  rand: () => number,
  size: number,
  rocks: Set<number>,
): Set<number> | null {
  const n = size * size
  const flowers = new Set<number>()
  const clash = (cell: number): boolean => {
    for (const nb of neighbors8(size, cell)) {
      if (flowers.has(nb)) return true
    }
    return false
  }
  for (const cell of shuffledIndices(rand, n)) {
    if (rocks.has(cell)) continue
    if (rand() < 0.1) continue
    if (!clash(cell)) flowers.add(cell)
  }
  if (flowers.size < Math.floor(n / 10)) return null
  // 补覆盖：每个未掩护空地在自身/邻域里随机补一朵可达的花。
  for (let cell = 0; cell < n; cell += 1) {
    if (rocks.has(cell)) continue
    let covered = flowers.has(cell)
    if (!covered) {
      for (const nb of neighbors8(size, cell)) {
        if (flowers.has(nb)) { covered = true; break }
      }
    }
    if (covered) continue
    const spots = [cell, ...neighbors8(size, cell)].filter(
      c => !rocks.has(c) && !flowers.has(c) && !clash(c),
    )
    if (spots.length === 0) return null
    flowers.add(spots[Math.floor(rand() * spots.length)]!)
  }
  return flowers
}

/** 单次生成尝试：铺岩石 → 随机完整解 → 初始提示 → 定向挖洞到唯一解。 */
function generateAttempt(rand: () => number, size: number, level: number): GardenPathPuzzle | null {
  const n = size * size
  const cells = new Uint8Array(n)
  const clueNumbers = new Int8Array(n).fill(-1)
  const solution = new Uint8Array(n)

  // 岩石：边长越大越多（8→4 块，12→5 块）。
  const rockCount = 2 + Math.floor(size / 4)
  const rocks = new Set<number>()
  for (const cell of shuffledIndices(rand, n)) {
    if (rocks.size >= rockCount) break
    rocks.add(cell)
    cells[cell] = CELL_ROCK
  }

  const flowers = randomSolution(rand, size, rocks)
  if (flowers === null) return null
  for (const cell of flowers) solution[cell] = 1

  const countUnder = (cell: number, sol: Uint8Array): number => {
    let k = 0
    for (const nb of orthNeighbors(size, cell)) {
      if (sol[nb] === 1) k += 1
    }
    return k
  }
  const addClue = (cell: number): void => {
    cells[cell] = CELL_CLUE
    clueNumbers[cell] = countUnder(cell, solution)
  }

  // 初始随机提示（非岩石非花格）：6-8 个，关卡更深起点略少。
  const initial = Math.max(5, 8 - Math.floor(level / 2)) + Math.floor(rand() * 2)
  const cands = shuffledIndices(rand, n).filter(cell => !rocks.has(cell) && !flowers.has(cell))
  if (cands.length < initial + 4) return null
  let used = 0
  for (const cell of cands) {
    if (used >= initial) break
    addClue(cell)
    used += 1
  }

  // 定向挖洞：求出两个解，钉上能区分它们的提示，直到唯一。
  for (let guard = 0; guard < 200; guard += 1) {
    const r = solveBoard(size, cells, clueNumbers, 2)
    if (r.exhausted) return null
    if (r.solutions.length <= 1) return { size, cells, clueNumbers, solution }
    const alt = r.solutions.find(s => {
      for (let i = 0; i < n; i += 1) {
        if (s[i] !== solution[i]) return true
      }
      return false
    })
    if (alt === undefined) return { size, cells, clueNumbers, solution }
    let added = false
    for (const cell of shuffledIndices(rand, n)) {
      if (cells[cell] !== CELL_EMPTY || solution[cell] === 1) continue
      if (countUnder(cell, solution) !== countUnder(cell, alt)) {
        addClue(cell)
        used += 1
        added = true
        break
      }
    }
    if (!added) return null
    if (used > Math.floor(n * 0.6)) return null
  }
  return null
}

/**
 * 从 seed 确定性生成某一关的盘面（唯一解保证）。
 * @param seed - 注入的随机种子。
 * @param level - 1 基关卡号。
 * @returns 盘面；内部最多重试 60 次，全部失败才返回 null（实践中不会发生）。
 */
export function puzzleFromSeed(seed: number, level: number): GardenPathPuzzle | null {
  const size = levelSize(level)
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rand = mulberry32((seed + attempt * 0x9e3779b9) >>> 0)
    const puzzle = generateAttempt(rand, size, level)
    if (puzzle !== null) return puzzle
  }
  return null
}

/**
 * 某提示格四邻中当前的花数。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @param cell - 提示格。
 */
export function clueFlowerCount(puzzle: GardenPathPuzzle, marks: Uint8Array, cell: number): number {
  let count = 0
  for (const nb of orthNeighbors(puzzle.size, cell)) {
    if (marks[nb] === MARK_FLOWER) count += 1
  }
  return count
}

/**
 * 当前与数字不符的提示格（红显反馈用；含不足与超额）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @returns 不符的提示格下标列表。
 */
export function unsatisfiedClues(puzzle: GardenPathPuzzle, marks: Uint8Array): number[] {
  const out: number[] = []
  const n = puzzle.size * puzzle.size
  for (let i = 0; i < n; i += 1) {
    if (puzzle.cells[i] !== CELL_CLUE) continue
    if (clueFlowerCount(puzzle, marks, i) !== puzzle.clueNumbers[i]) out.push(i)
  }
  return out
}

/** 玩家当前的花格集合。 */
function flowerSet(puzzle: GardenPathPuzzle, marks: Uint8Array): Set<number> {
  const out = new Set<number>()
  const n = puzzle.size * puzzle.size
  for (let i = 0; i < n; i += 1) {
    if (marks[i] === MARK_FLOWER) out.add(i)
  }
  return out
}

/**
 * 八向相邻的花格（双方都列出，红圈反馈用）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @returns 存在相邻花的格下标列表。
 */
export function adjacencyConflicts(puzzle: GardenPathPuzzle, marks: Uint8Array): number[] {
  const out: number[] = []
  const flowers = flowerSet(puzzle, marks)
  const n = puzzle.size * puzzle.size
  for (let i = 0; i < n; i += 1) {
    if (marks[i] !== MARK_FLOWER) continue
    for (const nb of neighbors8(puzzle.size, i)) {
      if (flowers.has(nb)) {
        out.push(i)
        break
      }
    }
  }
  return out
}

/**
 * 未被花覆盖的空地（既非花、八向也无花；进度与过关判定用）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @returns 未覆盖空地下标列表。
 */
export function uncoveredCells(puzzle: GardenPathPuzzle, marks: Uint8Array): number[] {
  const out: number[] = []
  const flowers = flowerSet(puzzle, marks)
  const n = puzzle.size * puzzle.size
  for (let i = 0; i < n; i += 1) {
    if (puzzle.cells[i] !== CELL_EMPTY || flowers.has(i)) continue
    let covered = false
    for (const nb of neighbors8(puzzle.size, i)) {
      if (flowers.has(nb)) { covered = true; break }
    }
    if (!covered) out.push(i)
  }
  return out
}

/**
 * 该格是否可种（空地）。
 * @param puzzle - 盘面。
 * @param cell - 格下标。
 */
export function canPlant(puzzle: GardenPathPuzzle, cell: number): boolean {
  return cell >= 0 && cell < puzzle.cells.length && puzzle.cells[cell] === CELL_EMPTY
}

/**
 * 点击循环：空地在花与草之间切换。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记（原地修改）。
 * @param cell - 格下标。
 * @returns 是否真的切换了（岩石/提示格返回 false）。
 */
export function toggleMark(puzzle: GardenPathPuzzle, marks: Uint8Array, cell: number): boolean {
  if (!canPlant(puzzle, cell)) return false
  marks[cell] = marks[cell] === MARK_FLOWER ? MARK_GRASS : MARK_FLOWER
  return true
}

/**
 * 过关判定：玩家整体标记满足全部四条约束（提示精确、花八向不邻、花只
 * 在空地、每块草都被花覆盖）。由唯一解保证，满足即与生成解完全一致。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 */
export function isWon(puzzle: GardenPathPuzzle, marks: Uint8Array): boolean {
  const n = puzzle.size * puzzle.size
  if (marks.length !== n) return false
  for (let i = 0; i < n; i += 1) {
    if (marks[i] === MARK_FLOWER && puzzle.cells[i] !== CELL_EMPTY) return false
  }
  if (adjacencyConflicts(puzzle, marks).length > 0) return false
  if (unsatisfiedClues(puzzle, marks).length > 0) return false
  return uncoveredCells(puzzle, marks).length === 0
}

/**
 * 提示：挑一个与正解不一致的空格（优先挨着不符提示的），返回该格；
 * 标记已与正解一致时返回 -1。确定顺序，可测。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 */
export function hintCell(puzzle: GardenPathPuzzle, marks: Uint8Array): number {
  const n = puzzle.size * puzzle.size
  const badClues = new Set(unsatisfiedClues(puzzle, marks))
  let fallback = -1
  for (let i = 0; i < n; i += 1) {
    if (puzzle.cells[i] !== CELL_EMPTY) continue
    if (marks[i] === puzzle.solution[i]) continue
    if (fallback < 0) fallback = i
    for (const nb of orthNeighbors(puzzle.size, i)) {
      if (badClues.has(nb)) return i
    }
  }
  return fallback
}

/**
 * 过关分数：关卡底分 + 时间奖励（每秒衰减）- 提示罚分，下限 50。
 * @param level - 1 基关卡号。
 * @param seconds - 用时（秒）。
 * @param hints - 已用提示次数（0-2）。
 */
export function computeScore(level: number, seconds: number, hints: number): number {
  const base = 100 * level
  const timeBonus = Math.max(0, 2400 - Math.floor(seconds) * 4)
  return Math.max(50, base + timeBonus - hints * 250)
}
