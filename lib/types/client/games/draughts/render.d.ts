import { type DraughtsMove, type DraughtsPosition } from './logic.ts';
/** 逻辑画布宽（px）。 */
export declare const LOGICAL_W = 560;
/** 逻辑画布高（px）。 */
export declare const LOGICAL_H = 608;
/** 「说明」按钮矩形（渲染末尾绘制、命中检测复用）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染一帧所需的全部展示状态（index.ts 组装）。 */
export interface DraughtsView {
    pos: DraughtsPosition;
    selected: number;
    targets: Set<number>;
    /** 有吃必吃时，全部可吃子的起点集合（红圈警示）。 */
    captureFroms: Set<number>;
    lastMove: DraughtsMove | null;
    youWins: number;
    aiWins: number;
    round: number;
    statusText: string;
    statusColor: string;
    /** 胜负 / 暂停遮罩；null 表示不画。 */
    overlay: {
        text: string;
        sub: string;
        color: string;
    } | null;
    helpOpen: boolean;
}
/**
 * 逻辑坐标 → 棋盘格（0-63）；棋盘外返回 -1。
 * @param x 逻辑 x。
 * @param y 逻辑 y。
 */
export declare function squareAt(x: number, y: number): number;
/**
 * 逻辑坐标是否命中「说明」按钮。
 */
export declare function pointInHelp(x: number, y: number): boolean;
/**
 * 某格中心点（粒子爆发等定位用）。
 * @param sq 格号 0-63。
 */
export declare function squareCenter(sq: number): [number, number];
/**
 * 渲染一帧：背景 → HUD → 棋盘与标记 → 棋子 → 底部状态 → 遮罩 →
 * 说明按钮 →（打开时）帮助面板（最上层）。
 * @param ctx 已应用逻辑坐标变换的 2d 上下文。
 * @param view 展示状态。
 */
export declare function renderDraughts(ctx: CanvasRenderingContext2D, view: DraughtsView): void;
