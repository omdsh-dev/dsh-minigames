import { type PlanarityState } from './logic.ts';
/** 顶点绘制半径（命中半径略大，见 index 层）。 */
export declare const VERTEX_R = 9;
/** 说明按钮矩形（右下角，60x24）。 */
export declare const HELP_BTN: {
    readonly x: number;
    readonly y: number;
    readonly w: 60;
    readonly h: 24;
};
/** 渲染视图选项（index 层传入的瞬态 UI 状态）。 */
export interface PlanarityView {
    /** 暂停中（叠加暂停 overlay，帮助面板仍画在其上）。 */
    paused: boolean;
    /** 帮助面板打开。 */
    helpOpen: boolean;
    /** 过关归位动画进度 [0,1]，< 0 表示未在动画。 */
    winAnimT: number;
}
/**
 * 渲染器句柄：draw 为整帧绘制（含末尾最上层的说明按钮 / 帮助面板与
 * 各 overlay），burst 在过关时喷发庆祝粒子。
 */
export interface PlanarityRenderer {
    /** 绘制一帧完整场景。 */
    draw(ctx: CanvasRenderingContext2D, state: PlanarityState, view: PlanarityView): void;
    /** 在某点喷发庆祝粒子。 */
    burst(x: number, y: number, color?: string): void;
    /** 是否仍有存活粒子（决定是否继续重绘）。 */
    busy(): boolean;
}
/**
 * 创建渲染器（每画布一个粒子系统实例）。
 * @returns 渲染器句柄。 */
export declare function createPlanarityRenderer(): PlanarityRenderer;
