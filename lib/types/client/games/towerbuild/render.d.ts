import { type TowerBuildState } from './logic.ts';
/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export declare const LOGICAL_W = 960;
export declare const LOGICAL_H = 580;
/** 一个矩形（逻辑坐标）。 */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 说明按钮（60x24，右下角；渲染最上层，点击命中由 index.ts 复用）。 */
export declare const HELP_BUTTON: Rect;
/** 说明按钮是否被点中。 */
export declare function helpButtonHit(x: number, y: number): boolean;
/** 渲染选项（阶段之外的展示标志）。 */
export interface RenderOptions {
    /** 暂停（面板或 P 键）。 */
    paused: boolean;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
}
/**
 * 整幅渲染：背景 → HUD → 工地结构 → 警示带 → 塔与基座 → 重心投影 →
 * 吊索与吊挂块 → 散块 → 风旗 → 粒子 → 暂停 / 过关 / 失败 overlay →
 * 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 画布上下文（fitCanvas 已含逻辑坐标变换）。
 * @param state - 对局状态。
 * @param opts - 展示标志。
 * @param particles - 可选粒子系统（过关 / 放置成功时 burst）。
 * @param dtMs - 本帧毫秒（粒子推进用）。
 */
export declare function renderTower(ctx: CanvasRenderingContext2D, state: TowerBuildState, opts: RenderOptions, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
