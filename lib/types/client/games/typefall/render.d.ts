import { type TypeFallState } from './logic.ts';
/** 逻辑画布宽（px）。 */
export declare const LOGICAL_W = 480;
/** 逻辑画布高（px）。 */
export declare const LOGICAL_H = 560;
/** 说明按钮矩形（渲染最末尾绘制；60x24）。 */
export declare const HELP_RECT: {
    readonly x: 406;
    readonly y: 8;
    readonly w: 60;
    readonly h: 24;
};
/** 说明按钮是否被点中（逻辑坐标）。 */
export declare function helpButtonHit(x: number, y: number): boolean;
/** 渲染选项：暂停标志与帮助面板开合。 */
export interface RenderOptions {
    paused: boolean;
    helpOpen: boolean;
}
/**
 * 绘制整帧：背景 → 星点 → 地面 → 单词槽 → 下落字母 → HUD → 横幅 →
 * 遮罩 → 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 逻辑坐标系已就位的 2d 上下文。
 * @param state - 当前游戏状态。
 * @param opts - 暂停与帮助面板标志。
 */
export declare function renderTypeFall(ctx: CanvasRenderingContext2D, state: TypeFallState, opts: RenderOptions): void;
