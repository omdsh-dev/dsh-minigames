/**
 * 韦恩图谜题渲染：淡彩半透明交叠圆（重叠处自然加深）、数字卡池、区域
 * 高亮与谓词提示、错放红框、步数/限时 HUD、过关与暂停 overlay。全部
 * 纯 canvas 绘制，布局常量导出供 index 命中测试共用。
 */
import { type VennGameState } from './logic.ts';
import { type ParticleSystem } from '../theme.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 640;
export declare const LOGICAL_H = 580;
/** 韦恩图板区域（含圆外空白放置带）。 */
export declare const BOARD_TOP = 56;
export declare const BOARD_BOTTOM = 424;
/** 数字卡尺寸与池布局。 */
export declare const CARD_W = 44;
export declare const CARD_H = 32;
/** 池中第 i 张卡的矩形（i 为 pool 下标）。
 * @param i - 卡池下标。
 * @returns 矩形。
 */
export declare function cardRect(i: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 命中数字卡。
 * @param x - 逻辑 x。 @param y - 逻辑 y。 @param poolLen - 当前卡池长度。
 * @returns 卡池下标或 null。
 */
export declare function poolCardAt(x: number, y: number, poolLen: number): number | null;
/** 点是否在卡池面板内（用于「拖回卡池 = 取消」判定）。
 * @param y - 逻辑 y。
 * @returns 是否在池面板竖直范围。
 */
export declare function inPoolBand(y: number): boolean;
/** 点是否在韦恩图放置区（含圆外空白）。 */
export declare function inBoard(y: number): boolean;
/** 每个区域掩码的展示锚点（已放置数字在此排开）。
 * @param mask - 区域掩码。 @param circleCount - 圆数量。
 * @returns 锚点坐标。
 */
export declare function anchorForMask(mask: number, circleCount: 2 | 3): {
    x: number;
    y: number;
};
/** 圆 i 的谓词标签位置（圆顶上方，避开交叠区与 HUD）。
 * @param i - 圆下标。 @param circleCount - 圆数量。
 * @returns 标签锚点（文字底边中心）。
 */
export declare function circleLabelPos(i: number, circleCount: 2 | 3): {
    x: number;
    y: number;
};
/** 渲染附加视图状态（index 维护）。 */
export interface VennView {
    paused: boolean;
    /** 当前指针逻辑坐标（null = 移出画布）。 */
    pointer: {
        x: number;
        y: number;
    } | null;
    /** 拿起的数字（null = 未拿）。 */
    held: number | null;
    /** 错放红框（x,y 为放置点，ms 为剩余闪烁毫秒）。 */
    wrongFlash: {
        x: number;
        y: number;
        ms: number;
    } | null;
    /** 粒子系统（由 createVennParticles 创建）。 */
    particles: ParticleSystem;
}
/** 本游戏粒子系统包装。 @returns 粒子系统。 */
export declare function createVennParticles(): ParticleSystem;
/** 主渲染入口：整帧绘制。
 * @param ctx - 画布上下文。 @param state - 游戏状态。 @param view - 视图状态。 @param dtMs - 帧毫秒（推进粒子）。
 */
export declare function renderVennGame(ctx: CanvasRenderingContext2D, state: VennGameState, view: VennView, dtMs: number): void;
