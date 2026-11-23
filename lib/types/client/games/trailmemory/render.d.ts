import { type TrailMemoryState } from './logic.ts';
/** 逻辑画布尺寸（自适应缩放交给 fitCanvas 变换）。 */
export declare const LOGICAL_W = 520;
export declare const LOGICAL_H = 600;
/** 一个逻辑坐标矩形。 */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 说明按钮（60x24，右下角）。 */
export declare const HELP_BUTTON: Rect;
/**
 * 格下标（0..35）的绘制矩形。
 * @param cell - 格下标 = 行 × 6 + 列。
 * @returns 该格的逻辑矩形。
 */
export declare function cellRect(cell: number): Rect;
/**
 * 逻辑坐标点命中的格下标。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格下标 0..35，未命中返回 -1。
 */
export declare function cellAt(x: number, y: number): number;
/**
 * 说明按钮是否被点中。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns true 表示命中按钮矩形。
 */
export declare function helpButtonHit(x: number, y: number): boolean;
/** 渲染选项：阶段与动效标志（由 index.ts 持有）。 */
export interface RenderOptions {
    paused: boolean;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
    /** 过关停顿期：刚走完的旧路径绿闪庆祝（null 表示非停顿期）。 */
    settleCells: number[] | null;
    /** 最近错点格（红闪计时器 > 0 时非空）。 */
    wrongCell: number | null;
}
/**
 * 整幅渲染：背景 → HUD → 网格 → 阶段高亮 → 底部提示 → 粒子 →
 * 暂停/结束 overlay → 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 画布上下文（已带逻辑坐标变换）。
 * @param state - 对局状态。
 * @param opts - 阶段与动效标志。
 * @param particles - 可选粒子系统（过关庆祝）。
 * @param dtMs - 粒子推进毫秒。
 */
export declare function renderTrailMemory(ctx: CanvasRenderingContext2D, state: TrailMemoryState, opts: RenderOptions, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
