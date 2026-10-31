/**
 * 摩天楼 (Skyscrapers) pure logic. An n×n grid holds buildings 1..n, one of
 * each height per row and column (a Latin square). Each edge clue gives how
 * many buildings are visible scanning that row/column from that side (a
 * building is visible when taller than every building before it).
 *
 * Generation: shuffle a cyclic Latin square (row permutation, column
 * permutation, symbol permutation — all seeded), derive the 4n clues from
 * it, then verify with a budgeted solver that counts Latin squares
 * satisfying all clues (row permutations with incremental column checks).
 * A roll that stays non-unique gets givens revealed from its solution
 * (deterministic order, one at a time) until the solver proves exactly one
 * grid — so every level ships unique; only budget exhaustion falls back to
 * a 多解 badge (the flow pattern).
 */

/** Board edge lengths of the five levels. */
export const LEVEL_SIZES = [4, 5, 5, 6, 6] as const

/** A generated level: the four edge clue arrays plus one valid grid. */
export interface SkyPuzzle {
  /** Board edge length in cells. */
  size: number
  /** top[c]: visible count scanning column c downward; bottom[c]: upward. */
  top: readonly number[]
  bottom: readonly number[]
  /** left[r]: visible count scanning row r left→right; right[r]: the reverse. */
  left: readonly number[]
  right: readonly number[]
  /** The generating Latin square (values 1..size). */
  solution: readonly number[][]
  /** Revealed cells (cell index → value) that ship prefilled and locked. */
  givens: ReadonlyMap<number, number>
  /** Whether the solver proved exactly one solution. */
  unique: boolean
}

/** mulberry32 PRNG: small, fast, deterministic per seed. */
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

/** Board edge length of a 1-based level (levels wrap after the 5th). */
export function levelSize(level: number): number {
  return LEVEL_SIZES[(level - 1) % LEVEL_SIZES.length]!
}

/** Win score: base 100×level plus a time bonus that decays 5/second. */
export function computeScore(level: number, seconds: number): number {
  return 100 * level + Math.max(0, 3000 - Math.floor(seconds) * 5)
}

/** How many values are visible scanning a sequence (strictly increasing max). */
export function visibleCount(vals: readonly number[]): number {
  let max = 0
  let count = 0
  for (const v of vals) {
    if (v > max) {
      max = v
      count += 1
    }
  }
  return count
}

/**
 * Latin-square check: every row and column holds each of 1..size exactly
 * once. Empty cells (0) fail.
 */
export function isLatin(size: number, grid: readonly (readonly number[])[]): boolean {
  for (let r = 0; r < size; r += 1) {
    const seen = new Set<number>()
    for (let c = 0; c < size; c += 1) {
      const v = grid[r]![c]!
      if (v < 1 || v > size || seen.has(v)) return false
      seen.add(v)
    }
  }
  for (let c = 0; c < size; c += 1) {
    const seen = new Set<number>()
    for (let r = 0; r < size; r += 1) {
      const v = grid[r]![c]!
      if (seen.has(v)) return false
      seen.add(v)
    }
  }
  return true
}

/** Win: Latin square AND every edge clue matches. */
export function isWon(puzzle: SkyPuzzle, grid: readonly (readonly number[])[]): boolean {
  const size = puzzle.size
  if (!isLatin(size, grid)) return false
  for (let c = 0; c < size; c += 1) {
    const col = Array.from({ length: size }, (_, r) => grid[r]![c]!)
    if (visibleCount(col) !== puzzle.top[c]) return false
    if (visibleCount([...col].reverse()) !== puzzle.bottom[c]) return false
  }
  for (let r = 0; r < size; r += 1) {
    if (visibleCount(grid[r]!) !== puzzle.left[r]) return false
    if (visibleCount([...grid[r]!].reverse()) !== puzzle.right[r]) return false
  }
  return true
}

/** Solver outcome: grids found (capped at 2), budget status, nodes. */
export interface SolveResult {
  solutions: number
  /** True when the node budget ran out before the search space closed. */
  exhausted: boolean
  nodes: number
}

const STOP = -1

/**
 * Count clue-satisfying Latin squares up to two. Row candidates are the
 * permutations of 1..n matching that row's left/right clues; rows are
 * stacked in order with a column-duplicate check after every placement
 * (top/bottom clues are checked at the end). Returns count with budget
 * status.
 */
export function solveCount(puzzle: SkyPuzzle, maxNodes = 200_000): SolveResult {
  const { size } = puzzle
  const perms: number[][] = []
  const permOf = (prefix: number[]): void => {
    if (prefix.length === size) {
      perms.push([...prefix])
      return
    }
    for (let v = 1; v <= size; v += 1) {
      if (!prefix.includes(v)) permOf([...prefix, v])
    }
  }
  permOf([])
  const rowCands: number[][][] = Array.from({ length: size }, (_, r) =>
    perms.filter(p =>
      visibleCount(p) === puzzle.left[r]!
      && visibleCount([...p].reverse()) === puzzle.right[r]!
      && [...puzzle.givens].every(([cell, v]) => Math.floor(cell / size) !== r || p[cell % size] === v)))
  let nodes = 0
  let solutions = 0
  let exhausted = false
  const stack: number[][] = []

  const columnsOk = (rowIdx: number, row: readonly number[]): boolean => {
    for (let c = 0; c < size; c += 1) {
      for (let r = 0; r < rowIdx; r += 1) {
        if (stack[r]![c] === row[c]) return false
      }
    }
    return true
  }

  const cluesOk = (): boolean => {
    for (let c = 0; c < size; c += 1) {
      const col = Array.from({ length: size }, (_, r) => stack[r]![c]!)
      if (visibleCount(col) !== puzzle.top[c]) return false
      if (visibleCount([...col].reverse()) !== puzzle.bottom[c]) return false
    }
    return true
  }

  const dfs = (r: number): number => {
    if (r === size) {
      if (cluesOk()) {
        solutions += 1
        return solutions >= 2 ? STOP : 0
      }
      return 0
    }
    for (const cand of rowCands[r]!) {
      nodes += 1
      if (nodes > maxNodes) {
        exhausted = true
        return STOP
      }
      if (!columnsOk(r, cand)) continue
      stack.push(cand)
      const done = dfs(r + 1)
      stack.pop()
      if (done !== 0) return done
    }
    return 0
  }

  const done = dfs(0)
  void done
  return { solutions, exhausted, nodes }
}

/** Generation attempts per puzzle: uniqueness re-rolls. */
export function attemptCap(size: number): number {
  return size <= 5 ? 20 : 12
}

/**
 * Generate a puzzle deterministically from seed.
 *
 * Re-rolls derived seeds until the solver proves exactly one grid; after
 * the attempt cap the first roll ships with unique: false (always solvable
 * — clues are derived from a concrete Latin square).
 */
export function puzzleFromSeed(seed: number, size: number): SkyPuzzle {
  let fallback: SkyPuzzle | null = null
  const attempts = attemptCap(size)
  for (let s = 0; s < attempts; s += 1) {
    const roll = tryGenerate((seed + s * 0x9e3779b9) >>> 0, size)
    if (fallback === null) fallback = roll
    const budget = size <= 5 ? 200_000 : 1_500_000
    const plain = solveCount(roll, budget)
    if (!plain.exhausted && plain.solutions === 1) return { ...roll, givens: new Map(), unique: true }
    // Non-unique: reveal givens from the solution in seeded order until the
    // solver proves exactly one grid (bounded to size cells).
    const rng = mulberry32((seed + s * 0x9e3779b9) >>> 0)
    const order = Array.from({ length: size * size }, (_, i) => i)
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
    const givens = new Map<number, number>()
    for (const cell of order.slice(0, size + 3)) {
      givens.set(cell, roll.solution[Math.floor(cell / size)]![cell % size]!)
      const withGivens = { ...roll, givens }
      const r = solveCount(withGivens, budget)
      if (r.exhausted) break
      if (r.solutions === 1) return { ...withGivens, unique: true }
    }
  }
  return { ...fallback!, givens: new Map() }
}

/** One roll: shuffle the cyclic Latin square three ways, derive clues. */
function tryGenerate(seed: number, size: number): SkyPuzzle {
  const rng = mulberry32(seed)
  const shuffled = (arr: number[]): number[] => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
    }
    return arr
  }
  const rowPerm = shuffled(Array.from({ length: size }, (_, i) => i))
  const colPerm = shuffled(Array.from({ length: size }, (_, i) => i))
  const symPerm = shuffled(Array.from({ length: size }, (_, i) => i + 1))
  const grid: number[][] = []
  for (let r = 0; r < size; r += 1) {
    const row: number[] = []
    for (let c = 0; c < size; c += 1) {
      // Cyclic Latin square (r + c) mod size, through all three permutations.
      row.push(symPerm[(rowPerm[r]! + colPerm[c]!) % size]!)
    }
    grid.push(row)
  }
  const top: number[] = []
  const bottom: number[] = []
  for (let c = 0; c < size; c += 1) {
    const col = Array.from({ length: size }, (_, r) => grid[r]![c]!)
    top.push(visibleCount(col))
    bottom.push(visibleCount([...col].reverse()))
  }
  const left = grid.map(row => visibleCount(row))
  const right = grid.map(row => visibleCount([...row].reverse()))
  return { size, top, bottom, left, right, solution: grid, givens: new Map(), unique: false }
}
