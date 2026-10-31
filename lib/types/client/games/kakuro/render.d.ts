/**
 * 数和 Kakuro canvas renderer: black clue cells split by a top-left to
 * bottom-right diagonal (the down sum upper-right, the across sum
 * lower-left), white entry cells with centered digits, a cursor ring, and
 * win/pause overlays. Stateless — all state is caller-owned; uses the shared
 * visual kit (../theme.ts).
 */
import type { KakuroPuzzle } from './logic.ts';
export declare const HUD_H = 32;
export declare const GAP = 4;
/** Cell edge shrinks with board size so the whole field fits the canvas. */
export declare function cellSize(size: number): number;
export declare function boardW(size: number): number;
export declare function logicalW(size: number): number;
export declare function logicalH(size: number): number;
/** Top-left corner of cell (r, c) in logical space. */
export declare function cellOrigin(size: number, r: number, c: number): {
    x: number;
    y: number;
};
/** Which white cell a logical-space point lands on, or null (black cells too). */
export declare function cellAt(size: number, black: readonly (readonly boolean[])[], x: number, y: number): {
    r: number;
    c: number;
} | null;
/** Center of a cell in logical space (particle bursts). */
export declare function cellCenter(size: number, r: number, c: number): {
    x: number;
    y: number;
};
/**
 * Draw one frame.
 * @param grid - player values (0 = empty; black cells ignored).
 * @param cursor - focused white cell, or null.
 * @param paused - show the pause overlay.
 * @param winText - level-clear overlay subtitle, or null while playing.
 */
export declare function renderKakuro(ctx: CanvasRenderingContext2D, puzzle: KakuroPuzzle, grid: readonly (readonly number[])[], cursor: {
    r: number;
    c: number;
} | null, paused: boolean, winText: string | null): void;
