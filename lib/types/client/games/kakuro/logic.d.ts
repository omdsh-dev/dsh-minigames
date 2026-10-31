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
export declare const LEVEL_SIZES: readonly [6, 7, 8, 9, 9];
/** A generated level. */
export interface KakuroPuzzle {
    /** Board edge length in cells. */
    size: number;
    /** black[r][c]: block cells (first row/column all black). */
    black: readonly (readonly boolean[])[];
    /** Across clues keyed by the block cell that starts the run. */
    across: ReadonlyMap<number, number>;
    /** Down clues keyed by the block cell that starts the run. */
    down: ReadonlyMap<number, number>;
    /** The generating fill (white cells only; black cells carry 0). */
    solution: readonly (readonly number[])[];
    /** Whether the solver proved exactly one solution. */
    unique: boolean;
}
/** mulberry32 PRNG: small, fast, deterministic per seed. */
export declare function mulberry32(seed: number): () => number;
/** Board edge length of a 1-based level (levels wrap after the 5th). */
export declare function levelSize(level: number): number;
/** Win score: base 100×level plus a time bonus that decays 5/second. */
export declare function computeScore(level: number, seconds: number): number;
/** Pattern validity: every maximal white run, across and down, has length 2..9. */
export declare function patternOk(size: number, black: readonly (readonly boolean[])[]): boolean;
/** Win: every white cell filled 1-9, segments sum-exact with no repeats. */
export declare function isWon(puzzle: KakuroPuzzle, grid: readonly (readonly number[])[]): boolean;
/** Solver outcome: fills found (capped at 2), budget status, nodes. */
export interface SolveResult {
    solutions: number;
    /** True when the node budget ran out before the search space closed. */
    exhausted: boolean;
    nodes: number;
}
/**
 * Count valid fills up to two via DFS over white cells in row-major order.
 * Every placement keeps its across/down segments repeat-free and the
 * remaining cells reachable-sum range around the target. Returns count
 * with budget status.
 */
export declare function solveCount(puzzle: KakuroPuzzle, maxNodes?: number): SolveResult;
/** Generation attempts per puzzle. */
export declare function attemptCap(size: number): number;
/**
 * Generate a puzzle deterministically from seed. Re-rolls until the solver
 * proves exactly one fill; after the attempt cap the first solvable roll
 * ships with unique: false. Returns null when no roll worked.
 */
export declare function puzzleFromSeed(seed: number, size: number): KakuroPuzzle | null;
