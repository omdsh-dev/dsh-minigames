import { type LudoState, type Side } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 700;
export declare const LOGICAL_H = 560;
/** 盘面：15x15 网格，格边 34px，左上角 (12,25)。 */
export declare const CELL = 34;
export declare const BOARD_X = 12;
export declare const BOARD_Y = 25;
/** 环形跑道 52 格的网格坐标 [col,row]（顺时针，下标即环上下标）。 */
export declare const RING_PATH: ReadonlyArray<readonly [number, number]>;
/**
 * 棋子（编号 piece）在其当前位置编码下的像素中心。
 * @param side - 哪一方。
 * @param pos - 位置编码（-1 机场 / 0-50 跑道 / 51-56 终点直线）。
 * @param piece - 飞机编号（机场停机位用）。
 * @returns 像素中心坐标。
 */
export declare function posToCenter(side: Side, pos: number, piece: number): {
    x: number;
    y: number;
};
/** 渲染视图：index 每帧组装的纯快照。 */
export interface LudoView {
    state: LudoState;
    /** 玩家当前可动的飞机编号（高亮 + 命中）。 */
    movable: number[];
    /** 骰子滚动中。 */
    rolling: boolean;
    /** 滚动动画当前显示面。 */
    rollingFace: number;
    /** 最近捕获（跑道绝对下标 + 触发时刻），驱动回程幽灵动画。 */
    capture: {
        cells: number[];
        at: number;
        victim: Side;
    } | null;
    userPaused: boolean;
    paused: boolean;
    helpOpen: boolean;
    now: number;
}
/** 掷骰按钮是否被点中。 */
export declare function rollButtonAt(x: number, y: number): boolean;
/** 说明按钮是否被点中。 */
export declare function helpButtonAt(x: number, y: number): boolean;
/**
 * 命中检测：玩家可动飞机中距 (x,y) 最近且在 20px 内的编号。
 * @param state - 当前比赛状态。
 * @param movable - 可动飞机编号列表。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 命中的飞机编号，未命中返回 null。
 */
export declare function planeAt(state: LudoState, movable: number[], x: number, y: number): number | null;
/**
 * 整帧渲染：背景 → 盘面 → 棋子 → 回程幽灵 → HUD → 底部提示 → 暂停/
 * 胜负 overlay → 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 已按逻辑坐标变换的 2d 上下文。
 * @param view - 本帧视图快照。
 */
export declare function renderLudo(ctx: CanvasRenderingContext2D, view: LudoView): void;
