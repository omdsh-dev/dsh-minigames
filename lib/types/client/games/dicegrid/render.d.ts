import { type DiceGameState } from './logic.ts';
/** 逻辑画布宽。 */
export declare const LOGICAL_W = 480;
/** 逻辑画布高。 */
export declare const LOGICAL_H = 560;
/** 渲染层视图状态（index 维护）。 */
export interface DiceGridView {
    selected: number | null;
    paused: boolean;
    helpOpen: boolean;
    /** 短暂提示文案（下一次交互清除）。 */
    flash: string;
}
/**
 * 命中测试：逻辑坐标 → 彩窗格（行、列），未命中返回 null。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 */
export declare function gridCellAt(x: number, y: number): {
    r: number;
    c: number;
} | null;
/**
 * 命中测试：逻辑坐标 → 候选骰架索引，未命中返回 null。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 * @param count - 当前骰架上的骰子数。
 */
export declare function rackDieAt(x: number, y: number, count: number): number | null;
/** 逻辑坐标是否点中弃骰按钮。 */
export declare function inDiscardBtn(x: number, y: number): boolean;
/** 逻辑坐标是否点中说明按钮。 */
export declare function inHelpBtn(x: number, y: number): boolean;
/**
 * 全量重绘：背景 → HUD → 彩窗 → 骰架 → 弃骰按钮 → 提示 → 过关/暂停
 * overlay → 帮助面板 + 说明按钮（渲染函数末尾，永远最上层）。
 * @param ctx - 画布上下文。
 * @param state - 逻辑状态。
 * @param view - 视图状态。
 */
export declare function renderDiceGrid(ctx: CanvasRenderingContext2D, state: DiceGameState, view: DiceGridView): void;
