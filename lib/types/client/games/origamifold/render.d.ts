import { type FoldMove, type FoldState, type Stack } from './logic.ts';
/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export declare const LOGICAL_W = 960;
export declare const LOGICAL_H = 600;
/** 纸格边长（最大 6×6 = 420px，居中含上下边距）。 */
export declare const CELL = 70;
/** 一个矩形（逻辑坐标）。 */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 「说明」按钮矩形（60×24，右下角；渲染在最上层，index.ts 复用命中）。 */
export declare const HELP_BUTTON: Rect;
/** 折叠动画时长（秒）。 */
export declare const ANIM_S = 0.25;
/** 颜色 id -> 纸面颜色（取色板中彼此拉开色相的三个）。 */
export declare function paperColor(id: number): string;
/** 折叠动画：index.ts 推进 t（秒）；期间按旧盘面 + 翻转变换绘制。 */
export interface FoldAnim {
    /** 本次折叠。 */
    move: FoldMove;
    /** 折前行数。 */
    oldRows: number;
    /** 折前列数。 */
    oldCols: number;
    /** 折前层叠网格（快照）。 */
    oldCells: Stack[][];
    /** 已播放秒数。 */
    t: number;
}
/** 渲染选项：暂停、帮助面板、悬停折线、折叠动画、过关文案。 */
export interface OrigamiView {
    paused: boolean;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
    /** 悬停的折叠（null 无）。 */
    hover: FoldMove | null;
    /** 进行中的折叠动画（null 无）。 */
    anim: FoldAnim | null;
    /** 过关遮罩副标题（null 用默认文案）。 */
    winText: string | null;
}
/**
 * 当前尺寸的盘面矩形（居中含边距，尺寸自适应）。
 * @param rows - 当前行数。
 * @param cols - 当前列数。
 */
export declare function boardRect(rows: number, cols: number): Rect;
/**
 * 命中测试：坐标是否点在某条合法折线附近（±12px），并按点击在线的
 * 哪一侧决定翻折侧（点哪侧、哪侧折过去）。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @param rows - 当前行数。
 * @param cols - 当前列数。
 * @returns 折叠；不在任何合法折线附近返回 null。
 */
export declare function foldLineAt(x: number, y: number, rows: number, cols: number): FoldMove | null;
/**
 * 说明按钮是否被点中。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 */
export declare function helpButtonHit(x: number, y: number): boolean;
/**
 * 整幅渲染：背景 → HUD（含目标/当前徽章）→ 盘面（静止或折叠动画中）
 * → 折线指示与悬停蒙版 → 粒子 → 暂停/过关/卡死遮罩 → 说明按钮 →
 * 帮助面板（最后两步永远最上层，任何阶段可开合）。
 * @param ctx - 画布上下文（fitCanvas 已做逻辑坐标变换）。
 * @param state - 对局状态。
 * @param view - 渲染选项。
 * @param particles - 可选粒子系统（过关庆祝）。
 * @param dtMs - 本帧毫秒（粒子推进用）。
 */
export declare function renderOrigami(ctx: CanvasRenderingContext2D, state: FoldState, view: OrigamiView, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
