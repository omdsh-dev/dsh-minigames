/**
 * 磁极谜题 canvas renderer：极简纸面风——多米诺双格合并圆角块与边界、
 * + / - 大字（红 / 蓝）、绝缘灰格；四周行列提示 +/− 双数字（超标转红），
 * 同极相邻与超标格红框、提示格金点；HUD 与过关 / 暂停 overlay。无状态，
 * 全部状态由调用方持有，视觉件复用 ../theme.ts。
 */
import type { MagnetsPuzzle } from './logic.ts';
export declare const HUD_H = 32;
export declare const GAP = 6;
export declare const TOP_CLUE_H = 36;
export declare const LEFT_CLUE_W = 44;
export declare const BOTTOM_H = 20;
/** 格边长随盘面收缩，保证整盘含边距不越界。 */
export declare function cellSize(size: number): number;
export declare function boardW(size: number): number;
export declare function logicalW(size: number): number;
export declare function logicalH(size: number): number;
export declare const BOARD_X: number;
export declare const BOARD_Y: number;
/** 格左上角逻辑坐标。 */
export declare function cellOrigin(size: number, r: number, c: number): {
    x: number;
    y: number;
};
/** 逻辑坐标命中哪一格，界外返回 -1。 */
export declare function cellAt(size: number, x: number, y: number): number;
/** 格中心逻辑坐标（粒子爆发）。 */
export declare function cellCenter(size: number, cellIdx: number): {
    x: number;
    y: number;
};
/** HUD 行数据。 */
export interface MagnetsHud {
    level: number;
    levelTotal: number;
    hintsLeft: number;
    time: string;
}
/**
 * 绘制一帧。
 * @param marks - 玩家标注数组（0 空 1 正 2 负 3 中性）。
 * @param conflicts - 冲突格（红框）。
 * @param revealed - 提示揭示过的格（金点）。
 * @param hud - HUD 行数据。
 * @param paused - 暂停 overlay。
 * @param winText - 过关 overlay 副标题，进行中为 null。
 */
export declare function renderMagnets(ctx: CanvasRenderingContext2D, puzzle: MagnetsPuzzle, marks: readonly number[], conflicts: readonly number[], revealed: readonly number[], hud: MagnetsHud, paused: boolean, winText: string | null): void;
