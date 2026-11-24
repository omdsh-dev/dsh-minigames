/**
 * 像素画家 PixelPainter 渲染层：左侧参考图（带格线）+ 右侧画布（涂对
 * 微亮 / 涂错红框）+ 底部调色板色块（选中高亮）+ 顶部 HUD（关卡/提示/
 * 步数/错格/完成度，右锚定防错位）+ 说明按钮与帮助面板（drawHelp 由
 * index 层在渲染函数最末调用，覆盖一切 overlay）。纯绘制无状态；布局
 * 常量集中声明：HUD 行基线 y26（左 16/150 起、右 500/596/704 右锚），
 * 图区标签基线 y60，左右面板 70-430，调色板托盘 442-526，操作提示基线
 * y548，说明按钮 644-704 x 532-556，帮助面板 90-630 x 110-430，均在
 * 720x560 逻辑画布内互不重叠。
 */
import type { Cell } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 720;
export declare const LOGICAL_H = 560;
/** 矩形区域（逻辑坐标）。 */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 网格盘面布局：左上角与单元边长（含居中边距）。 */
export interface Layout {
    ox: number;
    oy: number;
    cell: number;
}
/** 左侧参考图面板区域。 */
export declare const LEFT_PANEL: Rect;
/** 右侧画布面板区域。 */
export declare const RIGHT_PANEL: Rect;
/**
 * 在区域内为 grid x grid 网格求自适应布局（单元取整、整体居中含边距）。
 * @param area - 允许占用的矩形区域。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export declare function layoutFor(area: Rect, grid: number): Layout;
/**
 * 命中测试：把逻辑坐标换算为网格单元，越界返回 null。
 * @param layout - 盘面布局。
 * @param grid - 网格边长。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的网格单元，或 null。
 */
export declare function cellFromPoint(layout: Layout, grid: number, px: number, py: number): Cell | null;
/**
 * 调色板第 i 个色块矩形（按色数整行居中）。
 * @param i - 色块下标。
 * @param count - 色块总数。
 * @returns 色块矩形。
 */
export declare function paletteSwatchRect(i: number, count: number): Rect;
/**
 * 调色板命中测试。
 * @param count - 色块总数。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 色块下标，未命中返回 -1。
 */
export declare function paletteSwatchAt(count: number, px: number, py: number): number;
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    /** 参考图（-1 空、否则颜色下标）。 */
    reference: number[];
    /** 玩家画布（同编码）。 */
    canvas: number[];
    /** 网格边长。 */
    grid: number;
    /** 颜色下标到十六进制色值。 */
    colors: string[];
    /** 调色板色块顺序（颜色下标）。 */
    palette: number[];
    /** 选中的调色板槽位，-1 未选。 */
    selected: number;
    /** 涂改步数。 */
    steps: number;
    /** 错格数。 */
    wrong: number;
    /** 完成度百分比。 */
    pct: number;
    /** 0 起的关卡下标。 */
    level: number;
    /** 总关卡数。 */
    levelCount: number;
    /** 剩余提示次数。 */
    hintsLeft: number;
    /** 过关闪亮脉冲 0-1。 */
    flash: number;
}
/**
 * 整帧绘制：背景 + HUD + 双面板（参考图/画布）+ 调色板 + 过关闪亮。
 * 说明按钮与帮助面板在 drawHelp（index 层渲染函数最末调用，最上层）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView): void;
/** 说明按钮矩形（右下角，60x24）。 */
export declare const HELP_BTN: Rect;
/**
 * 说明按钮 + 帮助面板：必须由 index 层在渲染函数最末调用，保证画在
 * 一切场景与 overlay 之上（暂停/过关中也可开合）。
 * @param ctx - 画布上下文。
 * @param helpOpen - 帮助面板是否展开。
 */
export declare function drawHelp(ctx: CanvasRenderingContext2D, helpOpen: boolean): void;
