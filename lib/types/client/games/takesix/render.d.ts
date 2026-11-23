/**
 * 牛头王 TakeSix 渲染层：牌卡风格的四行牌列（牛头角标）、中段同时亮牌
 * 区、底部手牌扇形、罚分/局分 HUD；说明按钮与帮助面板画在渲染函数
 * 末尾（最上层，任何阶段/暂停可开合）。状态与动画进度由调用方持有，
 * 渲染器无状态。
 */
import { type TakeSixState } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const W = 560;
export declare const H = 430;
/** 说明按钮（右上角 60x24；HUD 右列止于 430，与按钮间隔 58px）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染视图：状态 + 动画/交互标志（全部由 index 持有）。 */
export interface TakeSixView {
    state: TakeSixState;
    /** 亮牌动画进度 0..1（1 = 完全亮出）。 */
    reveal: number;
    paused: boolean;
    helpOpen: boolean;
    /** 悬停抬升的手牌下标，或 null。 */
    hover: number | null;
}
/** 点击区域：说明按钮 / 手牌 / 收行选择的行 / 下一局按钮。 */
export type TakeSixHit = {
    kind: 'help';
} | {
    kind: 'hand';
    index: number;
} | {
    kind: 'row';
    row: number;
} | {
    kind: 'next';
};
/** 手牌第 index 张的矩形（扇形：中间高、两端下垂 10px）。 */
export declare function handCardRect(n: number, index: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 收行动画的粒子迸发点（第 row 行牌列中心）。 */
export declare function rowBurstPos(row: number): {
    x: number;
    y: number;
};
/**
 * 画一帧完整画面（含暂停/结算/终局覆盖层；说明按钮与帮助面板在最末，
 * 任何阶段/暂停都保持在最上层）。
 * @param ctx - 画布上下文。
 * @param view - 渲染视图。
 */
export declare function renderTakeSix(ctx: CanvasRenderingContext2D, view: TakeSixView): void;
/**
 * 命中测试：说明按钮永远可点；手牌仅在 pick 阶段、行仅在 chooseRow
 * 阶段、下一局按钮仅在 roundOver 阶段返回。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @param view - 渲染视图（取 state.phase 与手牌数）。
 * @returns 命中区域或 null。
 */
export declare function hitTest(x: number, y: number, view: TakeSixView): TakeSixHit | null;
