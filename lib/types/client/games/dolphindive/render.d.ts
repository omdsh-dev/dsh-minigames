/**
 * 海豚跃浪渲染层：日落渐变天、太阳、动画波浪线、贝塞尔海豚（跟随
 * 速度方向 + 空翻旋转）、漂移水母、入水水花（越陡越高）、蓄力条与
 * 角度、连击火花、轮次/得分/风速 HUD、暂停/结束遮罩，以及最上层的
 * 「说明」按钮与帮助面板。纯绘制，不持有游戏逻辑状态。
 */
import { type DolphinDiveState } from './logic.ts';
import type { ParticleSystem } from '../theme.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 520;
export declare const LOGICAL_H = 340;
/** 「说明」按钮矩形（渲染在最上层，index.ts 点击命中复用本常量）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染层视图状态（index.ts 维护）。 */
export interface DolphinView {
    /** 帮助面板是否展开。 */
    helpOpen: boolean;
    /** 暂停中。 */
    paused: boolean;
    /** 波浪动画累计毫秒。 */
    timeMs: number;
    /** 粒子系统（index 持有，渲染时推进）。 */
    particles: ParticleSystem;
}
/**
 * 渲染一帧。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 游戏局面。
 * @param view 视图状态。
 * @param dtMs 距上帧毫秒（推进粒子与波浪）。
 */
export declare function renderDolphinDive(ctx: CanvasRenderingContext2D, state: DolphinDiveState, view: DolphinView, dtMs: number): void;
