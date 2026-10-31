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
export declare const LEVEL_SIZES: readonly [6, 7, 8, 9, 10];
export declare const LEVEL_ISLANDS: readonly [4, 5, 6, 7, 8];
/** A generated level: numbered cells plus the generating solution. */
export interface NuriPuzzle {
    /** Board edge length in cells. */
    size: number;
    /** Island anchor cells (cell = r * size + c) → island size. */
    numbers: ReadonlyMap<number, number>;
    /** The generating solution: true = white (island), false = black (sea). */
    whites: readonly boolean[];
    /** Whether the solver proved exactly one solution. */
    unique: boolean;
}
/** mulberry32 PRNG: small, fast, deterministic per seed. */
export declare function mulberry32(seed: number): () => number;
/** Board edge length of a 1-based level (levels wrap after the 5th). */
export declare function levelSize(level: number): number;
/** Island count of a 1-based level. */
export declare function levelIslands(level: number): number;
/** Win score: base 100×level plus a time bonus that decays 5/second. */
export declare function computeScore(level: number, seconds: number): number;
/** Orthogonal neighbors of a cell (grid edges only). */
export declare function neighbors(size: number, cell: number): number[];
/**
 * Full rule check for a complete board (all cells decided): every number's
 * island is exactly its size with no other number inside, islands do not
 * touch, the sea is one connected region, and no 2×2 black block.
 */
export declare function isWon(puzzle: NuriPuzzle, blacks: ReadonlySet<number>): boolean;
/** Solver outcome: boards found (capped at 2), budget status, nodes. */
export interface SolveResult {
    solutions: number;
    /** True when the node budget ran out before the search space closed. */
    exhausted: boolean;
    nodes: number;
}
/**
 * Count rule-satisfying boards up to two via DFS over undecided cells.
 * Each branch colors the first undecided cell white then black with sound
 * pruning: an island reaching its number must stop, islands may not touch
 * across colors, the partial sea must stay connectable (every black cell
 * reaches every other through blacks + undecideds), and no 2×2 black block.
 */
export declare function solveCount(puzzle: NuriPuzzle, maxNodes?: number): SolveResult;
/** Generation attempts per puzzle: big boards rarely prove unique, so the
 * re-roll loop is short there to bound generation time. */
export declare function attemptCap(size: number): number;
/**
 * Generate a puzzle deterministically from seed.
 *
 * Re-rolls until the solver proves exactly one board; after the attempt
 * cap the first solvable roll ships with unique: false. Returns null when
 * no roll produced a valid island layout at all.
 */
export declare function puzzleFromSeed(seed: number, size: number, islands: number): NuriPuzzle | null;
