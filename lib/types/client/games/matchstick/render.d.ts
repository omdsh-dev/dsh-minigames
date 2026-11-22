import { type MatchstickState, type Seg } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const W = 720;
export declare const H = 430;
/** 字格布局结果：每格左上角 x、格宽与段矩形几何参数。 */
export interface CellLayout {
    xs: number[];
    cw: number;
    ch: number;
    t: number;
}
/**
 * 计算 n 格等式的居中布局：字格宽度按总宽自适应（不超过基准宽），
 * 整体在 [EQ_MARGIN, W-EQ_MARGIN] 内水平居中。
 * @param n - 字格总数。
 */
export declare function layoutCells(n: number): CellLayout;
/**
 * 某格某段的火柴矩形（含中心线几何：横段贴 y 行、竖段贴 x 列）。
 * @param layout - 布局。
 * @param cell - 格下标。
 * @param seg - 段名。
 */
export declare function segRect(layout: CellLayout, cell: number, seg: Seg): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 命中某根在场火柴（按矩形外扩 HIT_PAD 判定）。
 * @param cells - 题面字元序列。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中的 {cell, seg}；未命中返回 null。
 */
export declare function hitStick(cells: string, x: number, y: number): {
    cell: number;
    seg: Seg;
} | null;
/**
 * 命中一个可放置空位（该格该段当前为空且补后仍是合法字型）。
 * @param cells - 题面字元序列。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中的 {cell, seg}；未命中返回 null。
 */
export declare function hitSlot(cells: string, x: number, y: number): {
    cell: number;
    seg: Seg;
} | null;
/**
 * 命中备用匣。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 */
export declare function hitTray(x: number, y: number): boolean;
/** 渲染视图参数。 */
export interface MatchstickView {
    state: MatchstickState;
    paused: boolean;
    /** 悬停火柴（来自 pointermove 命中）。 */
    hover: {
        cell: number;
        seg: Seg;
    } | null;
    /** 「不成立，已还原」闪红剩余秒数。 */
    flashWrong: number;
    /** 解题成功闪绿剩余秒数。 */
    flashRight: number;
}
/**
 * 整帧绘制：背景、木纹桌面、等式火柴、空位提示、HUD、备用匣与
 * 遮罩。绘制只读 view，不产生副作用。
 * @param ctx - 画布上下文。
 * @param view - 渲染视图。
 */
export declare function renderMatchstick(ctx: CanvasRenderingContext2D, view: MatchstickView): void;
