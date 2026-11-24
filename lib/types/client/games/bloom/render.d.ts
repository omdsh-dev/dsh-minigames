import { type BloomState, type ChainStep } from './logic.ts';
/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export declare const LOGICAL_W = 960;
export declare const LOGICAL_H = 600;
/** 网格布局：58px 格 + 6px 缝，居中含边距。 */
export declare const CELL = 58;
export declare const GAP = 6;
export declare const BOARD_X: number;
export declare const BOARD_Y = 76;
/** 一个矩形（逻辑坐标）。 */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 「说明」按钮矩形（60×24，右下角；渲染在最上层，index.ts 复用命中）。 */
export declare const HELP_BUTTON: Rect;
/** 连锁涟漪动画（index.ts 推进 t，秒）。 */
export interface RippleAnim {
    /** 连锁步骤（含波次）。 */
    steps: ChainStep[];
    /** 动画已播放秒数。 */
    t: number;
}
/** 渲染选项：暂停、帮助面板、悬停/键盘光标、涟漪动画、过关文案。 */
export interface BloomView {
    paused: boolean;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
    /** 鼠标悬停格（-1 无）。 */
    hoverIndex: number;
    /** 键盘光标格（-1 无）。 */
    cursorIndex: number;
    /** 进行中的连锁涟漪（null 无）。 */
    anim: RippleAnim | null;
    /** 过关遮罩副标题（null 用默认文案）。 */
    winText: string | null;
}
/**
 * 逻辑坐标落在哪个格（含缝隙归入邻近格，宽松命中）。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格子下标（行主序），盘面外返回 -1。
 */
export declare function gridCellAt(x: number, y: number): number;
/**
 * 说明按钮是否被点中。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 */
export declare function helpButtonHit(x: number, y: number): boolean;
/**
 * 整幅渲染：背景 → HUD → 盘面（槽、石头、花苞/花、涟漪）→ 连锁浮字
 * → 粒子 → 暂停/过关/失败遮罩 → 说明按钮 → 帮助面板（最后两步永远
 * 最上层，任何阶段可开合）。
 * @param ctx - 画布上下文（fitCanvas 已做逻辑坐标变换）。
 * @param state - 对局状态。
 * @param view - 渲染选项。
 * @param particles - 可选粒子系统（过关庆祝）。
 * @param dtMs - 本帧毫秒（粒子推进用）。
 */
export declare function renderBloom(ctx: CanvasRenderingContext2D, state: BloomState, view: BloomView, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
