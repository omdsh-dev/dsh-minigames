import { type GalconState } from './logic.ts';
/** 渲染器句柄。 */
export interface GalconRenderer {
    /** 绘制一帧完整场景（含 HUD 与 overlay）。 */
    draw(ctx: CanvasRenderingContext2D, state: GalconState, paused: boolean): void;
    /** 在某点触发占领 / 击退爆点粒子。 */
    burst(x: number, y: number, color?: string): void;
}
/**
 * 创建渲染器（星空按 seed 缓存一份）。
 * @param seed - 与逻辑侧相同的注入种子。
 * @returns 渲染器句柄。
 */
export declare function createGalconRenderer(seed: number): GalconRenderer;
