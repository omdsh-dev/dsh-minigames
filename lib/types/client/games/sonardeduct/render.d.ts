import type { ParticleSystem } from '../theme.ts';
import { type SonarDeductState } from './logic.ts';
/** 单格边长（px）。 */
export declare const CELL = 46;
/** 顶部 HUD 高度（px）。 */
export declare const HUD_H = 48;
/** 网格左上角（含边距）。 */
export declare const GRID_X = 24;
export declare const GRID_Y = 56;
/** 逻辑画布尺寸（9×9 网格 + 边距）。 */
export declare const LOGICAL_W: number;
export declare const LOGICAL_H: number;
/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 鼠标交互模式（index 维护）。 */
export type Mode = 'ping' | 'mark';
/** 一次声呐波纹（index 在 ping 成功时压入，逐帧推进）。 */
export interface Ripple {
    /** 网格坐标（格中心像素）。 */
    x: number;
    y: number;
    /** 已持续毫秒。 */
    age: number;
}
/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface SonarDeductView {
    paused: boolean;
    helpOpen: boolean;
    /** 鼠标悬停格（逻辑格坐标），无则 null。 */
    hover: {
        r: number;
        c: number;
    } | null;
    mode: Mode;
    /** 活跃波纹列表。 */
    ripples: Ripple[];
    particles: ParticleSystem;
    /** 距上帧毫秒（推进粒子）。 */
    dtMs: number;
}
/** 格中心像素坐标。 */
export declare function cellCenter(r: number, c: number): {
    px: number;
    py: number;
};
/** 像素坐标 → 逻辑格坐标（越界返回 null）。 */
export declare function cellAt(px: number, py: number): {
    r: number;
    c: number;
} | null;
/**
 * 渲染一帧。调用顺序：背景 → HUD → 网格底盘 →（按格显式分支：声呐格
 * 画回声 / 插旗格画旗 / 空格留底）→ 悬停高亮 → 波纹 → 鱼群 → 粒子 →
 * 失败复盘红叉 → 胜负/暂停遮罩 → 帮助面板与「说明」按钮（最后，
 * 最上层）。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 当前局面。
 * @param view 视图状态。
 */
export declare function renderSonar(ctx: CanvasRenderingContext2D, state: SonarDeductState, view: SonarDeductView): void;
