/**
 * 对称补全 Symmetry 渲染层：方格纸盘面、左半彩色图形、金色对称轴虚线、
 * 构件盘（选中态 + 拖放提示）、对位绿显 / 错位红显、步数与限时 HUD、
 * 选择题与轮次通过闪亮。纯绘制，无状态；布局常量集中声明并核算互不
 * 遮挡（HUD 行 y26、速览行 y48、盘面 60-432、题面 104-368、选项行
 * 388-430、构件盘 444-536，均在 720x560 逻辑画布内）。
 */
import type { Cell, Piece, PieceKind, Round } from './logic.ts';
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
/**
 * 在区域内为 grid x grid 网格求自适应布局（单元取整、整体居中含边距）。
 * @param area - 允许占用的矩形区域。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export declare function layoutFor(area: Rect, grid: number): Layout;
/**
 * 拼图回合盘面布局。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export declare function boardLayout(grid: number): Layout;
/**
 * 选择题图形布局。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export declare function quizLayout(grid: number): Layout;
/**
 * 单元中心点（逻辑坐标）。
 * @param layout - 盘面布局。
 * @param c - 网格单元。
 * @returns 中心坐标。
 */
export declare function cellCenter(layout: Layout, c: Cell): {
    x: number;
    y: number;
};
/**
 * 命中测试：把逻辑坐标四舍五入到最近网格单元（即半格吸附容差），越界
 * 返回 null。
 * @param layout - 盘面布局。
 * @param grid - 网格边长。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的网格单元，或 null。
 */
export declare function cellFromPoint(layout: Layout, grid: number, px: number, py: number): Cell | null;
/**
 * 构件盘第 i 个槽位的矩形（按剩余构件数整行居中）。
 * @param i - 槽位下标。
 * @param count - 当前构件总数。
 * @returns 槽位矩形。
 */
export declare function paletteSlotRect(i: number, count: number): Rect;
/**
 * 构件盘命中测试。
 * @param count - 当前构件总数。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 槽位下标，未命中返回 -1。
 */
export declare function paletteSlotAt(count: number, px: number, py: number): number;
/**
 * 选择题第 i 个选项按钮矩形（4 个按钮整行居中，总宽 528）。
 * @param i - 选项下标。
 * @returns 按钮矩形。
 */
export declare function quizOptionRect(i: number): Rect;
/**
 * 选择题按钮命中测试。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 选项下标，未命中返回 -1。
 */
export declare function quizOptionAt(px: number, py: number): number;
/** 已放置构件的可绘制视图（单元为绝对网格单元）。 */
export interface PieceView {
    /** 稳定色相索引（从构件盘到落位颜色一致，不随槽位洗牌漂移）。 */
    hue: number;
    kind: PieceKind;
    cells: Cell[];
}
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    round: Round;
    /** 拼图回合：已正确补上的构件（绿色）。 */
    placedCorrect: PieceView[];
    /** 拼图回合：错放的构件（红色，可取回）。 */
    wrong: PieceView[];
    /** 构件盘当前剩余的构件（已补上的从盘中移除）。 */
    palette: Piece[];
    /** 构件盘每个构件的稳定色相索引（与 palette 平行）。 */
    paletteHues: number[];
    /** 构件盘选中下标，-1 未选。 */
    selected: number;
    /** 选择题已点选项下标，-1 未点。 */
    quizPicked: number;
    /** HUD 左侧值（如 '3/5 · 轮 2/3'）。 */
    hudLevel: string;
    /** 步数。 */
    steps: number;
    /** 剩余秒数。 */
    secondsLeft: number;
    /** 轮次通过亮度脉冲 0-1。 */
    flash: number;
}
/**
 * 整帧绘制：背景 + HUD + 常驻速览 + 当前回合 + 闪亮脉冲。overlay 由
 * index 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView): void;
