/**
 * 转盘密码 canvas 渲染：黄铜密码盘风格——同心环上铜块挡板与暗孔空缺、
 * 选中层高亮、层号标注、径向光束逐层绿通/红断、旋转补间动画、目标角
 * 三角标记与度数、关卡/步数/目标 HUD、说明按钮与大字帮助面板（渲染函
 * 数末尾最上层）、暂停/过关 overlay 与过关光束射出特效。使用共享视觉
 * 套件（../theme.ts）。文件内不使用模板字符串。
 */
import type { RotationState } from './logic.ts';
/** 固定逻辑画布尺寸。 */
export declare const LOGICAL_W = 480;
export declare const LOGICAL_H = 540;
/** 顶部 HUD 高度。 */
export declare const HUD_H = 44;
/** 盘面圆心与半径。 */
export declare const CX = 240;
export declare const CY = 262;
export declare const BOARD_R = 186;
/** 最内层环带内缘半径（中心光珠区外沿）。 */
export declare const RING_START = 26;
/** 中心光珠半径。 */
export declare const PEARL_R = 13;
/** 说明按钮矩形（点击开合帮助面板，任何阶段可用）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染侧视图选项。 */
export interface RotationView {
    paused: boolean;
}
/** 点击命中层下标：落在环带内返回 0..n-1，否则 null。 */
export declare function ringIndexAt(x: number, y: number, layerCount: number): number | null;
/** 点击是否命中说明按钮。 */
export declare function helpButtonAt(x: number, y: number): boolean;
/** 开/关帮助面板（任何阶段可开合）。 */
export declare function toggleHelp(): void;
/** 关闭帮助面板（Escape）。 */
export declare function closeHelp(): void;
/** 旋转补间是否仍在进行（进行中时调用方应持续重绘）。 */
export declare function isAnimating(): boolean;
/** 画一帧。 */
export declare function renderRotation(ctx: CanvasRenderingContext2D, state: RotationState, view: RotationView): void;
