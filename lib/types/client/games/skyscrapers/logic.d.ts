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
export declare const LEVEL_SIZES: readonly [4, 5, 5, 6, 6];
/** A generated level: the four edge clue arrays plus one valid grid. */
export interface SkyPuzzle {
    /** Board edge length in cells. */
    size: number;
    /** top[c]: visible count scanning column c downward; bottom[c]: upward. */
    top: readonly number[];
    bottom: readonly number[];
    /** left[r]: visible count scanning row r left→right; right[r]: the reverse. */
    left: readonly number[];
    right: readonly number[];
    /** The generating Latin square (values 1..size). */
    solution: readonly number[][];
    /** Revealed cells (cell index → value) that ship prefilled and locked. */
    givens: ReadonlyMap<number, number>;
    /** Whether the solver proved exactly one solution. */
    unique: boolean;
}
/** mulberry32 PRNG: small, fast, deterministic per seed. */
export declare function mulberry32(seed: number): () => number;
/** Board edge length of a 1-based level (levels wrap after the 5th). */
export declare function levelSize(level: number): number;
/** Win score: base 100×level plus a time bonus that decays 5/second. */
export declare function computeScore(level: number, seconds: number): number;
/** How many values are visible scanning a sequence (strictly increasing max). */
export declare function visibleCount(vals: readonly number[]): number;
/**
 * Latin-square check: every row and column holds each of 1..size exactly
 * once. Empty cells (0) fail.
 */
export declare function isLatin(size: number, grid: readonly (readonly number[])[]): boolean;
/** Win: Latin square AND every edge clue matches. */
export declare function isWon(puzzle: SkyPuzzle, grid: readonly (readonly number[])[]): boolean;
/** Solver outcome: grids found (capped at 2), budget status, nodes. */
export interface SolveResult {
    solutions: number;
    /** True when the node budget ran out before the search space closed. */
    exhausted: boolean;
    nodes: number;
}
/**
 * Count clue-satisfying Latin squares up to two. Row candidates are the
 * permutations of 1..n matching that row's left/right clues; rows are
 * stacked in order with a column-duplicate check after every placement
 * (top/bottom clues are checked at the end). Returns count with budget
 * status.
 */
export declare function solveCount(puzzle: SkyPuzzle, maxNodes?: number): SolveResult;
/** Generation attempts per puzzle: uniqueness re-rolls. */
export declare function attemptCap(size: number): number;
/**
 * Generate a puzzle deterministically from seed.
 *
 * Re-rolls derived seeds until the solver proves exactly one grid; after
 * the attempt cap the first roll ships with unique: false (always solvable
 * — clues are derived from a concrete Latin square).
 */
export declare function puzzleFromSeed(seed: number, size: number): SkyPuzzle;
