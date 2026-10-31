/**
 * 数回 canvas renderer: the n×n grid with numbered island anchors (white
 * cells with the island size), player-shaded sea cells, a cursor ring, and
 * win/pause overlays. Stateless — state is caller-owned; uses the shared
 * visual kit (../theme.ts).
 */
import type { NuriPuzzle } from './logic.ts';
export declare const HUD_H = 32;
export declare const GAP = 6;
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
/** Which cell a logical-space point lands on, or -1. */
export declare function cellAt(size: number, x: number, y: number): number;
/** Center of a cell in logical space (particle bursts). */
export declare function cellCenter(size: number, cellIdx: number): {
    x: number;
    y: number;
};
/**
 * Draw one frame.
 * @param blacks - player-shaded cells.
 * @param cursor - focused cell, or -1 to hide the ring.
 * @param paused - show the pause overlay.
 * @param winText - level-clear overlay subtitle, or null while playing.
 */
export declare function renderNuri(ctx: CanvasRenderingContext2D, puzzle: NuriPuzzle, blacks: ReadonlySet<number>, cursor: number, paused: boolean, winText: string | null): void;
