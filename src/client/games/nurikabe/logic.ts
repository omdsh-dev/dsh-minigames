/**
 * 数回 (Nurikabe) pure logic. Numbered cells anchor white islands: each
 * island is a connected white region containing exactly one number equal to
 * its size; every other cell is black (the sea), the sea is one connected
 * region, and no 2×2 block is all black.
 *
 * Generation: seeded island seeds grow simultaneously into connected white
 * regions (most-constrained head first) without touching foreign islands;
 * each island's number is its final size. The leftover cells form the sea —
 * a roll ships only when the sea is connected and 2×2-free, else re-roll.
 * A budgeted solver counts solutions (branch on undecided cells with island
 * size / sea connectivity pruning); a level ships unique-only after the
 * attempt cap falls back to a 多解 badge (the flow pattern).
 */

/** Board edge lengths and island counts of the five levels. */
export const LEVEL_SIZES = [6, 7, 8, 9, 10] as const
export const LEVEL_ISLANDS = [4, 5, 6, 7, 8] as const

/** A generated level: numbered cells plus the generating solution. */
export interface NuriPuzzle {
  /** Board edge length in cells. */
  size: number
  /** Island anchor cells (cell = r * size + c) → island size. */
  numbers: ReadonlyMap<number, number>
  /** The generating solution: true = white (island), false = black (sea). */
  whites: readonly boolean[]
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

/** Island count of a 1-based level. */
export function levelIslands(level: number): number {
  return LEVEL_ISLANDS[(level - 1) % LEVEL_ISLANDS.length]!
}

/** Win score: base 100×level plus a time bonus that decays 5/second. */
export function computeScore(level: number, seconds: number): number {
  return 100 * level + Math.max(0, 3000 - Math.floor(seconds) * 5)
}

/** Orthogonal neighbors of a cell (grid edges only). */
export function neighbors(size: number, cell: number): number[] {
  const r = Math.floor(cell / size)
  const c = cell % size
  const out: number[] = []
  if (r > 0) out.push(cell - size)
  if (r < size - 1) out.push(cell + size)
  if (c > 0) out.push(cell - 1)
  if (c < size - 1) out.push(cell + 1)
  return out
}

/** Cells of the connected region containing cell (values filtered by isMember). */
function region(size: number, cell: number, isMember: (c: number) => boolean): number[] {
  const seen = new Set<number>([cell])
  const stack = [cell]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const n of neighbors(size, cur)) {
      if (!seen.has(n) && isMember(n)) {
        seen.add(n)
        stack.push(n)
      }
    }
  }
  return [...seen]
}

/** True when no 2×2 block of cells is entirely member. */
function noSquareBlock(size: number, isMember: (c: number) => boolean): boolean {
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      if (isMember(r * size + c) && isMember(r * size + c + 1)
        && isMember((r + 1) * size + c) && isMember((r + 1) * size + c + 1)) return false
    }
  }
  return true
}

/**
 * Full rule check for a complete board (all cells decided): every number's
 * island is exactly its size with no other number inside, islands do not
 * touch, the sea is one connected region, and no 2×2 black block.
 */
export function isWon(puzzle: NuriPuzzle, blacks: ReadonlySet<number>): boolean {
  const size = puzzle.size
  const total = size * size
  if (blacks.has(-1)) return false
  const isWhite = (c: number) => !blacks.has(c)
  // Every numbered cell sits on a white island of exactly its size.
  const visited = new Set<number>()
  for (const [anchor, want] of puzzle.numbers) {
    if (blacks.has(anchor)) return false
    const island = region(size, anchor, isWhite)
    if (island.length !== want) return false
    for (const cell of island) {
      if (visited.has(cell)) return false
      visited.add(cell)
      const other = puzzle.numbers.get(cell)
      if (other !== undefined && cell !== anchor) return false
    }
  }
  // Every white cell belongs to some numbered island.
  let whiteCount = 0
  for (let c = 0; c < total; c += 1) if (isWhite(c)) whiteCount += 1
  if (visited.size !== whiteCount) return false
  // The sea is one connected region with no 2×2 block.
  const sea = [...blacks].filter(c => c >= 0 && c < total)
  if (sea.length === 0) return false
  const seaSet = new Set(sea)
  if (region(size, sea[0]!, c => seaSet.has(c)).length !== sea.length) return false
  return noSquareBlock(size, c => seaSet.has(c))
}

/** Solver outcome: boards found (capped at 2), budget status, nodes. */
export interface SolveResult {
  solutions: number
  /** True when the node budget ran out before the search space closed. */
  exhausted: boolean
  nodes: number
}

const STOP = -1

/**
 * Count rule-satisfying boards up to two via DFS over undecided cells.
 * Each branch colors the first undecided cell white then black with sound
 * pruning: an island reaching its number must stop, islands may not touch
 * across colors, the partial sea must stay connectable (every black cell
 * reaches every other through blacks + undecideds), and no 2×2 black block.
 */
export function solveCount(puzzle: NuriPuzzle, maxNodes = 60_000): SolveResult {
  const { size, numbers } = puzzle
  const total = size * size
  // color: 0 undecided, 1 white, -1 black; numbered cells start white.
  const color = new Int8Array(total)
  for (const anchor of numbers.keys()) color[anchor] = 1
  let nodes = 0
  let solutions = 0
  let exhausted = false

  /** Exact structural check of a complete coloring. */
  const complete = (): boolean => {
    const blacks = new Set<number>()
    for (let c = 0; c < total; c += 1) if (color[c] === -1) blacks.add(c)
    return isWon({ size, numbers, whites: [], unique: false }, blacks)
  }

  const dfs = (): number => {
    let cell = -1
    for (let i = 0; i < total; i += 1) {
      if (color[i] === 0) { cell = i; break }
    }
    if (cell === -1) {
      if (complete()) {
        solutions += 1
        return solutions >= 2 ? STOP : 0
      }
      return 0
    }
    nodes += 1
    if (nodes > maxNodes) {
      exhausted = true
      return STOP
    }
    for (const choice of [1, -1] as const) {
      color[cell] = choice
      if (pruneOk()) {
        const done = dfs()
        if (done !== 0) {
          color[cell] = 0
          return done
        }
      }
      color[cell] = 0
    }
    return 0
  }

  /** Sound necessary conditions after the latest placement. */
  const pruneOk = (): boolean => {
    // Island sizes: each numbered island's white region ≤ its number and,
    // when it cannot grow (all neighbors decided non-white), exactly equal.
    const seen = new Uint8Array(total)
    for (const [anchor, want] of numbers) {
      if (seen[anchor] === 1) continue
      const island: number[] = []
      const stack = [anchor]
      seen[anchor] = 1
      let otherNumber = false
      let canGrow = false
      while (stack.length > 0) {
        const cur = stack.pop()!
        island.push(cur)
        for (const n of neighbors(size, cur)) {
          if (color[n] === 1 && numbers.has(n) && n !== anchor) otherNumber = true
          if (color[n] === 1 && seen[n] === 0) {
            seen[n] = 1
            stack.push(n)
          } else if (color[n] === 0) canGrow = true
        }
      }
      if (otherNumber) return false
      if (island.length > want) return false
      if (!canGrow && island.length < want) return false
    }
    // No 2×2 black block already formed.
    for (let r = 0; r < size - 1; r += 1) {
      for (let c = 0; c < size - 1; c += 1) {
        if (color[r * size + c] === -1 && color[r * size + c + 1] === -1
          && color[(r + 1) * size + c] === -1 && color[(r + 1) * size + c + 1] === -1) return false
      }
    }
    // Partial sea connectivity: all blacks connect through blacks + undecided.
    const passable = (c: number): boolean => (color[c] ?? 1) <= 0
    const blacks: number[] = []
    for (let i = 0; i < total; i += 1) if (color[i] === -1) blacks.push(i)
    if (blacks.length > 0) {
      const reach = new Set(region(size, blacks[0]!, passable))
      for (const b of blacks) {
        if (!reach.has(b)) return false
      }
    }
    return true
  }

  const done = dfs()
  void done
  return { solutions, exhausted, nodes }
}

/** Generation attempts per puzzle: big boards rarely prove unique, so the
 * re-roll loop is short there to bound generation time. */
export function attemptCap(size: number): number {
  return size <= 6 ? 20 : size <= 8 ? 6 : 4
}

/**
 * Generate a puzzle deterministically from seed.
 *
 * Re-rolls until the solver proves exactly one board; after the attempt
 * cap the first solvable roll ships with unique: false. Returns null when
 * no roll produced a valid island layout at all.
 */
export function puzzleFromSeed(seed: number, size: number, islands: number): NuriPuzzle | null {
  let fallback: NuriPuzzle | null = null
  const attempts = attemptCap(size)
  for (let s = 0; s < attempts; s += 1) {
    const roll = tryGenerate((seed + s * 0x9e3779b9) >>> 0, size, islands)
    if (roll === null) continue
    if (fallback === null) fallback = roll
    const { solutions, exhausted } = solveCount(roll, size <= 6 ? 60_000 : 25_000)
    if (!exhausted && solutions === 1) return { ...roll, unique: true }
  }
  return fallback
}

/**
 * One generation attempt: spread seeds (Chebyshev ≥ 2), grow islands
 * simultaneously to seeded target sizes (2..5) without touching foreign
 * islands; leftover cells become the sea. Null when the sea is
 * disconnected or contains a 2×2 block.
 */
function tryGenerate(seed: number, size: number, islandCount: number): NuriPuzzle | null {
  const rng = mulberry32(seed)
  const total = size * size
  const cells: number[] = []
  for (let i = 0; i < total; i += 1) cells.push(i)
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[cells[i], cells[j]] = [cells[j]!, cells[i]!]
  }
  const anchors: number[] = []
  for (const c of cells) {
    const far = anchors.every(s => {
      const dr = Math.abs(Math.floor(s / size) - Math.floor(c / size))
      const dc = Math.abs((s % size) - (c % size))
      return Math.max(dr, dc) >= 2
    })
    if (far) anchors.push(c)
    if (anchors.length === islandCount) break
  }
  if (anchors.length < islandCount) return null
  const owner = new Array<number>(total).fill(-1)
  anchors.forEach((a, i) => { owner[a] = i })
  const targets = anchors.map(() => 2 + Math.floor(rng() * 3))
  const have = (): number[] => {
    const counts = new Array<number>(islandCount).fill(0)
    for (const o of owner) if (o >= 0) counts[o]! += 1
    return counts
  }
  /** All still-free cells connected through free cells? (Sea stayalive.) */
  const freeConnected = (): boolean => {
    const free: number[] = []
    const freeSet = new Set<number>()
    for (let c = 0; c < total; c += 1) if (owner[c] === -1) { free.push(c); freeSet.add(c) }
    if (free.length === 0) return true
    const seen = new Set<number>([free[0]!])
    const stack = [free[0]!]
    while (stack.length > 0) {
      const cur = stack.pop()!
      for (const n of neighbors(size, cur)) {
        if (freeSet.has(n) && !seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    return seen.size === free.length
  }
  // Round-robin growth: each island claims one free orthogonal neighbor per
  // turn until its target size or a deadlock. Claims must not touch a
  // foreign island and must keep the remaining free cells connected (the
  // future sea); otherwise the island stops growing early.
  let growing = true
  while (growing) {
    growing = false
    for (let i = 0; i < islandCount; i += 1) {
      const counts = have()
      if (counts[i]! >= targets[i]!) continue
      const own = new Set<number>()
      for (let c = 0; c < total; c += 1) if (owner[c] === i) own.add(c)
      const options = [...new Set<number>()]
      for (const c of own) {
        for (const n of neighbors(size, c)) {
          if (owner[n] !== -1) continue
          if (neighbors(size, n).some(m => owner[m] !== -1 && owner[m] !== i)) continue
          options.push(n)
        }
      }
      while (options.length > 0) {
        const idx = Math.floor(rng() * options.length)
        const pick = options[idx]!
        owner[pick] = i
        if (freeConnected()) { growing = true; break }
        owner[pick] = -1
        options.splice(idx, 1)
      }
    }
  }
  // Islands may not touch foreign islands (the claim guard ensures this;
  // kept as an invariant assertion).
  for (let cell = 0; cell < total; cell += 1) {
    const o = owner[cell]
    if (o === -1) continue
    for (const n of neighbors(size, cell)) {
      if (owner[n] !== -1 && owner[n] !== o) return null
    }
  }
  // 2×2 all-sea repair: absorb one cell of every all-free 2×2 block into a
  // touch-safe adjacent island (keeping free cells connected); reject only
  // when no absorption is possible.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const block = [r * size + c, r * size + c + 1, (r + 1) * size + c, (r + 1) * size + c + 1]
      if (block.some(cell => owner[cell] !== -1)) continue
      let fixed = false
      for (const cell of block) {
        for (const n of neighbors(size, cell)) {
          const island = owner[n]!
          if (island === -1) continue
          if (neighbors(size, cell).some(m => owner[m] !== -1 && owner[m] !== island)) continue
          owner[cell] = island
          if (freeConnected()) { fixed = true; break }
          owner[cell] = -1
        }
        if (fixed) break
      }
      if (!fixed) return null
    }
  }
  const sea: number[] = []
  for (let c = 0; c < total; c += 1) if (owner[c] === -1) sea.push(c)
  if (sea.length === 0) return null
  const seaSet = new Set(sea)
  if (region(size, sea[0]!, c => seaSet.has(c)).length !== sea.length) return null
  if (!noSquareBlock(size, c => seaSet.has(c))) return null
  const numbers = new Map<number, number>()
  const whites: boolean[] = []
  for (let c = 0; c < total; c += 1) whites.push(owner[c] !== -1)
  for (let i = 0; i < islandCount; i += 1) {
    const sizeOf = owner.filter(o => o === i).length
    if (sizeOf < 1) return null
    numbers.set(anchors[i]!, sizeOf)
  }
  // Every white cell must be on some island by construction (owner !== -1).
  return { size, numbers, whites, unique: false }
}
