import type { FrogSwapState } from './logic.ts';
/** 逻辑画布宽度 px。 */
export declare const LOGICAL_W = 780;
/** 逻辑画布高度 px。 */
export declare const LOGICAL_H = 440;
/** 说明按钮矩形（右下角，60x24，画在渲染末尾最上层）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 命中区域：说明按钮 / 下一关按钮 / 荷叶位（蛙或空目标）。 */
export type HitRegion = {
    kind: 'help';
} | {
    kind: 'next';
} | {
    kind: 'cell';
    index: number;
};
/** 一次渲染所需的全部状态。 */
export interface FrogSwapView {
    state: FrogSwapState;
    /** 选中的蛙下标（null 未选中）。 */
    selected: number | null;
    /** 帮助面板开关。 */
    helpOpen: boolean;
    paused: boolean;
}
/**
 * 各荷叶位的椭圆矩形（水平居中，随位数自适应收窄）。
 * @param count - 荷叶位数（2f+1）。
 * @returns 每格的 {x,y,w,h}，h 略扁呈荷叶形。
 */
export declare function padRects(count: number): {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
/**
 * 命中检测：坐标转说明按钮 / 下一关按钮 / 荷叶位。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @param view - 当前视图状态。
 * @returns 命中区域或 null。
 */
export declare function hitTest(x: number, y: number, view: FrogSwapView): HitRegion | null;
/**
 * 渲染一帧完整画面（说明按钮与帮助面板固定画在最上层）。
 * @param ctx - 逻辑坐标系下的画布上下文。
 * @param view - 视图状态。
 */
export declare function renderFrogSwap(ctx: CanvasRenderingContext2D, view: FrogSwapView): void;
