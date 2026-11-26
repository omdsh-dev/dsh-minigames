import type { ParticleSystem } from '../theme.ts';
import { type LamplightState } from './logic.ts';
/** 单格边长（px）。 */
export declare const CELL = 32;
/** 顶部 HUD 高度（px）。 */
export declare const HUD_H = 48;
/** 最大关卡盘面（19×15）决定逻辑画布尺寸；小盘面居中。 */
export declare const MAX_COLS = 19;
export declare const MAX_ROWS = 15;
export declare const LOGICAL_W: number;
export declare const LOGICAL_H: number;
/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface LamplightView {
    /** 暂停中（画暂停遮罩）。 */
    paused: boolean;
    /** 帮助面板是否展开。 */
    helpOpen: boolean;
    /** 粒子系统（由 index 持有，此处只负责按帧推进）。 */
    particles: ParticleSystem;
    /** 距上帧毫秒（推进粒子）。 */
    dtMs: number;
}
/** 盘面左上角（按当前关尺寸在最大画布内居中，含 HUD 边距）。 */
export declare function gridOffset(state: LamplightState): {
    ox: number;
    oy: number;
};
/** 格中心像素坐标。 */
export declare function cellCenter(state: LamplightState, x: number, y: number): {
    px: number;
    py: number;
};
/**
 * 渲染一帧。调用顺序：背景 → HUD → 记忆地板/建筑 → 光源（油灯 + 路灯）
 * → 路灯立柱/油瓶/暗影/玩家 → 粒子 → 胜负/暂停遮罩 → 帮助面板与
 * 「说明」按钮（最后，最上层）。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 当前局面。
 * @param view 视图状态。
 */
export declare function renderLamplight(ctx: CanvasRenderingContext2D, state: LamplightState, view: LamplightView): void;
