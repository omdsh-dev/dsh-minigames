/**
 * 摩天楼 canvas renderer: the n×n grid framed by the four clue strips
 * (top/bottom per column, left/right per row), prefilled givens locked in
 * accent color, a cursor ring, conflict highlight, and win/pause overlays.
 * Stateless — all state is caller-owned; uses the shared visual kit
 * (../theme.ts).
 */
import type { SkyPuzzle } from './logic.ts';
export declare const HUD_H = 32;
export declare const GAP = 6;
/** Cell edge shrinks with board size so the whole field fits the canvas. */
export declare function cellSize(size: number): number;
/** Clue strip width on each of the four sides. */
export declare const CLUE = 30;
export declare function boardW(size: number): number;
export declare function logicalW(size: number): number;
export declare function logicalH(size: number): number;
/** Top-left corner of cell (r, c) in logical space. */
export declare function cellOrigin(size: number, r: number, c: number): {
    x: number;
    y: number;
};
/** Which cell a logical-space point lands on, or null. */
export declare function cellAt(size: number, x: number, y: number): {
    r: number;
    c: number;
} | null;
/** Center of a cell in logical space (particle bursts). */
export declare function cellCenter(size: number, r: number, c: number): {
    x: number;
    y: number;
};
/** Cells conflicting with a same-value peer in their row or column. */
export declare function findConflicts(size: number, grid: readonly (readonly number[])[]): Set<number>;
/**
 * Draw one frame.
 * @param grid - player values (0 = empty).
 * @param cursor - focused cell, or null.
 * @param paused - show the pause overlay.
 * @param winText - level-clear overlay subtitle, or null while playing.
 */
export declare function renderSky(ctx: CanvasRenderingContext2D, puzzle: SkyPuzzle, grid: readonly (readonly number[])[], cursor: {
    r: number;
    c: number;
} | null, paused: boolean, winText: string | null): void;
