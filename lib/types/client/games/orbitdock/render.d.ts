import type { ParticleSystem } from '../theme.ts';
import { type DockState } from './logic.ts';
/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface OrbitDockView {
    /** 模拟是否推进中（false = 规划态）。 */
    running: boolean;
    /** P 暂停遮罩。 */
    paused: boolean;
    /** 帮助面板是否展开。 */
    helpOpen: boolean;
    /** 粒子系统（index 持有，此处只按帧推进）。 */
    particles: ParticleSystem;
    /** 距上帧毫秒。 */
    dtMs: number;
    /** 星点背景（seed 生成一次）。 */
    stars: {
        x: number;
        y: number;
        r: number;
        a: number;
    }[];
    /** 拖拽中的 ΔV 矢量（px/s；null = 无拖拽）。 */
    drag: {
        x: number;
        y: number;
    } | null;
}
/**
 * 渲染一帧。状态分支（渲染 dispatch 按状态字段显式分支）：
 * - status playing & running：飞行态——轨迹 / 飞船 / 读数全部实时。
 * - status playing & !running：规划态——在飞行态画面之上叠 ΔV 箭头。
 * - status docked：过关遮罩（下一关待流转）。
 * - status failed：失败遮罩（原因文案 + R 重开）。
 * - status allClear：通关遮罩（总分 + R 重开）。
 * 帮助面板最后画，盖过一切遮罩。
 * @param ctx - 画布上下文（已套逻辑坐标变换）。
 * @param state - 当前局面。
 * @param view - 视图状态。
 */
export declare function renderOrbitDock(ctx: CanvasRenderingContext2D, state: DockState, view: OrbitDockView): void;
