/**
 * 数和 (Kakuro) pure logic. White cell runs (segments) between black cells
 * each carry a target sum; fill every white cell with 1-9 so no digit
 * repeats within a segment and every segment sums exactly to its clue.
 *
 * Generation: a seeded black-cell pattern (border black, interior random
 * with every white run length 2..9) is filled by a randomized no-repeat
 * DFS, the clues come from that fill, and a budgeted deterministic solver
 * counts fills up to two — a level ships only when exactly one fill
 * exists, else the seed advances; after the attempt cap the first solvable
 * roll ships with a 多解 badge (the flow pattern).
 */

/** Board edge lengths of the five levels. */
export const LEVEL_SIZES = [6, 7, 8, 9, 9] as const

/** A generated level. */
export interface KakuroPuzzle {
  /** Board edge length in cells. */
  size: number
  /** black[r][c]: block cells (first row/column all black). */
  black: readonly (readonly boolean[])[]
  /** Across clues keyed by the block cell that starts the run. */
  across: ReadonlyMap<number, number>
  /** Down clues keyed by the block cell that starts the run. */
  down: ReadonlyMap<number, number>
  /** The generating fill (white cells only; black cells carry 0). */
  solution: readonly (readonly number[])[]
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

/** Pattern validity: every maximal white run, across and down, has length 2..9. */
export function patternOk(size: number, black: readonly (readonly boolean[])[]): boolean {
  for (let r = 0; r < size; r += 1) {
    let run = 0
    for (let c = 0; c <= size; c += 1) {
      const white = c < size && !black[r]![c]
      if (white) run += 1
      else {
        if (run === 1) return false
        run = 0
      }
    }
  }
  for (let c = 0; c < size; c += 1) {
    let run = 0
    for (let r = 0; r <= size; r += 1) {
      const white = r < size && !black[r]![c]
      if (white) run += 1
      else {
        if (run === 1) return false
        run = 0
      }
    }
  }
  return true
}

/** Segment boundaries: for every black cell, the across run [c+1, end). */
function acrossRun(size: number, black: readonly (readonly boolean[])[], r: number, c: number): number {
  let end = c + 1
  while (end < size && !black[r]![end]!) end += 1
  return end
}

/** Segment boundaries: for every black cell, the down run [r+1, end). */
function downRun(size: number, black: readonly (readonly boolean[])[], r: number, c: number): number {
  let end = r + 1
  while (end < size && !black[end]![c]!) end += 1
  return end
}

/** Win: every white cell filled 1-9, segments sum-exact with no repeats. */
export function isWon(puzzle: KakuroPuzzle, grid: readonly (readonly number[])[]): boolean {
  const { size, black, across, down } = puzzle
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (black[r]![c]) continue
      if (grid[r]![c]! < 1) return false
    }
  }
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!black[r]![c]) continue
      const endA = acrossRun(size, black, r, c)
      if (endA > c + 1) {
        const target = across.get(r * size + c)
        if (target === undefined) return false
        let sum = 0
        const seen = new Set<number>()
        for (let i = c + 1; i < endA; i += 1) {
          const v = grid[r]![i]!
          if (seen.has(v)) return false
          seen.add(v)
          sum += v
        }
        if (sum !== target) return false
      }
      const endD = downRun(size, black, r, c)
      if (endD > r + 1) {
        const target = down.get(r * size + c)
        if (target === undefined) return false
        let sum = 0
        const seen = new Set<number>()
        for (let i = r + 1; i < endD; i += 1) {
          const v = grid[i]![c]!
          if (seen.has(v)) return false
          seen.add(v)
          sum += v
        }
        if (sum !== target) return false
      }
    }
  }
  return true
}

/** Solver outcome: fills found (capped at 2), budget status, nodes. */
export interface SolveResult {
  solutions: number
  /** True when the node budget ran out before the search space closed. */
  exhausted: boolean
  nodes: number
}

const STOP = -1

/**
 * Count valid fills up to two via DFS over white cells in row-major order.
 * Every placement keeps its across/down segments repeat-free and the
 * remaining cells reachable-sum range around the target. Returns count
 * with budget status.
 */
export function solveCount(puzzle: KakuroPuzzle, maxNodes = 120_000): SolveResult {
  const { size, black, across, down } = puzzle
  const grid: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  let nodes = 0
  let solutions = 0
  let exhausted = false

  /** Can the partial sum reach target with slots distinct digits left? */
  const rangeOk = (partial: number, slots: number, target: number): boolean => {
    if (slots === 0) return partial === target
    if (partial >= target) return false
    let maxAdd = 0
    let minAdd = 0
    for (let d = 9; d > 9 - slots; d -= 1) maxAdd += d
    for (let d = 1; d <= slots; d += 1) minAdd += d
    return partial + minAdd <= target && target <= partial + maxAdd
  }

  /** Feasibility of placing v at white cell (r, c). */
  const fits = (r: number, c: number, v: number): boolean => {
    const endA = acrossRun(size, black, r, c - 1 >= 0 && black[r]![c - 1]! ? c - 1 : c)
    // The anchor is the black cell starting this cell's across run.
    let a = c
    while (a > 0 && !black[r]![a - 1]!) a -= 1
    a -= 1
    if (a >= 0) {
      const target = across.get(r * size + a)
      if (target !== undefined) {
        let sum = 0
        let slots = 0
        for (let i = a + 1; i < endA; i += 1) {
          if (i === c) { sum += v; continue }
          const x = grid[r]![i]!
          if (x === v) return false
          if (x === 0) slots += 1
          else sum += x
        }
        const total = endA - a - 1
        if (!rangeOk(sum, slots, target)) return false
        void total
      }
    }
    let d = r
    while (d > 0 && !black[d - 1]![c]!) d -= 1
    d -= 1
    if (d >= 0) {
      const endD = downRun(size, black, d, c)
      const target = down.get(d * size + c)
      if (target !== undefined) {
        let sum = 0
        let slots = 0
        for (let i = d + 1; i < endD; i += 1) {
          if (i === r) { sum += v; continue }
          const x = grid[i]![c]!
          if (x === v) return false
          if (x === 0) slots += 1
          else sum += x
        }
        if (!rangeOk(sum, slots, target)) return false
      }
    }
    return true
  }

  const whites: number[] = []
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (!black[r]![c]) whites.push(r * size + c)
  }

  const dfs = (idx: number): number => {
    if (idx === whites.length) {
      solutions += 1
      return solutions >= 2 ? STOP : 0
    }
    nodes += 1
    if (nodes > maxNodes) {
      exhausted = true
      return STOP
    }
    const cell = whites[idx]!
    const r = Math.floor(cell / size)
    const c = cell % size
    for (let v = 1; v <= 9; v += 1) {
      if (!fits(r, c, v)) continue
      grid[r]![c] = v
      const done = dfs(idx + 1)
      grid[r]![c] = 0
      if (done !== 0) return done
    }
    return 0
  }

  const done = dfs(0)
  void done
  return { solutions, exhausted, nodes }
}

/** Generation attempts per puzzle. */
export function attemptCap(size: number): number {
  return size <= 7 ? 20 : 10
}

/**
 * Generate a puzzle deterministically from seed. Re-rolls until the solver
 * proves exactly one fill; after the attempt cap the first solvable roll
 * ships with unique: false. Returns null when no roll worked.
 */
export function puzzleFromSeed(seed: number, size: number): KakuroPuzzle | null {
  let fallback: KakuroPuzzle | null = null
  const attempts = attemptCap(size)
  for (let s = 0; s < attempts; s += 1) {
    const roll = tryGenerate((seed + s * 0x9e3779b9) >>> 0, size)
    if (roll === null) continue
    if (fallback === null) fallback = roll
    const { solutions, exhausted } = solveCount(roll)
    if (!exhausted && solutions === 1) return { ...roll, unique: true }
  }
  return fallback
}

/**
 * One attempt: random interior black pattern (density ~0.28, border black,
 * runs validated), randomized no-repeat fill, clues from the fill.
 */
function tryGenerate(seed: number, size: number): KakuroPuzzle | null {
  const rng = mulberry32(seed)
  const black: boolean[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => r === 0 || c === 0 || rng() < 0.28))
  // Repair to patternOk: blacken length-1 white runs, split runs longer than
  // 9 (both directions), repeat until stable — monotone blackening converges.
  for (let pass = 0; pass < size * size; pass += 1) {
    let changed = false
    for (let r = 0; r < size; r += 1) {
      let c = 1
      while (c < size) {
        if (!black[r]![c]) {
          let end = c
          while (end < size && !black[r]![end]!) end += 1
          const len = end - c
          if (len === 1) { black[r]![c] = true; changed = true }
          else if (len > 9) { black[r]![Math.floor((c + end) / 2)]! = true; changed = true }
          c = end
        } else c += 1
      }
    }
    for (let c = 0; c < size; c += 1) {
      let r = 1
      while (r < size) {
        if (!black[r]![c]) {
          let end = r
          while (end < size && !black[end]![c]!) end += 1
          const len = end - r
          if (len === 1) { black[r]![c] = true; changed = true }
          else if (len > 9) { black[Math.floor((r + end) / 2)]![c]! = true; changed = true }
          r = end
        } else r += 1
      }
    }
    if (!changed) break
  }
  if (!patternOk(size, black)) return null
  const grid: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const fitsNoRepeat = (r: number, c: number, v: number): boolean => {
    let a = c
    while (a > 0 && !black[r]![a - 1]!) a -= 1
    for (let i = a; i < size && !black[r]![i]!; i += 1) {
      if (i !== c && grid[r]![i]! === v) return false
    }
    let d = r
    while (d > 0 && !black[d - 1]![c]!) d -= 1
    for (let i = d; i < size && !black[i]![c]!; i += 1) {
      if (i !== r && grid[i]![c]! === v) return false
    }
    return true
  }
  const whites: number[] = []
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (!black[r]![c]) whites.push(r * size + c)
  }
  const fill = (idx: number): boolean => {
    if (idx === whites.length) return true
    const cell = whites[idx]!
    const r = Math.floor(cell / size)
    const c = cell % size
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    for (let i = digits.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      ;[digits[i], digits[j]] = [digits[j]!, digits[i]!]
    }
    for (const v of digits) {
      if (!fitsNoRepeat(r, c, v)) continue
      grid[r]![c] = v
      if (fill(idx + 1)) return true
      grid[r]![c] = 0
    }
    return false
  }
  if (!fill(0)) return null
  const across = new Map<number, number>()
  const down = new Map<number, number>()
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!black[r]![c]) continue
      const endA = acrossRun(size, black, r, c)
      if (endA > c + 1) {
        let sum = 0
        for (let i = c + 1; i < endA; i += 1) sum += grid[r]![i]!
        across.set(r * size + c, sum)
      }
      const endD = downRun(size, black, r, c)
      if (endD > r + 1) {
        let sum = 0
        for (let i = r + 1; i < endD; i += 1) sum += grid[i]![c]!
        down.set(r * size + c, sum)
      }
    }
  }
  return { size, black, across, down, solution: grid, unique: false }
}
