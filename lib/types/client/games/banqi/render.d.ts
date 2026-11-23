import type { ParticleSystem } from '../theme.ts';
import { type BanqiState } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 472;
export declare const LOGICAL_H = 320;
/** 单格边长。 */
export declare const CELL = 52;
/** 棋盘左上角（棋盘 416×208，水平居中）。 */
export declare const BOARD_X = 28;
export declare const BOARD_Y = 52;
/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface BanqiView {
    /** 选中的己方亮子格，null 未选。 */
    selected: number | null;
    /** 选中子的合法落点。 */
    targets: number[];
    /** 翻面动画：格 index 与 0→1 进度。 */
    flip: {
        index: number;
        progress: number;
    } | null;
    /** 局分（三局两胜）。 */
    matchRed: number;
    matchBlack: number;
    /** 顶部右侧状态短句（右锚显示）。 */
    status: string;
    /** 是否分出本局胜负。 */
    winnerLabel: string | null;
    /** 暂停中。 */
    paused: boolean;
    /** 帮助面板是否展开。 */
    helpOpen: boolean;
    /** 粒子系统（由 index 持有，此处只负责按帧推进）。 */
    particles: ParticleSystem;
}
/**
 * 渲染一帧。调用顺序：背景 → HUD → 棋盘棋子 → 状态行 → 粒子 →
 * 胜负遮罩 → 帮助面板与「说明」按钮（最后，最上层）。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 当前局面。
 * @param view 视图状态。
 * @param dtMs 距上帧毫秒（推进粒子）。
 */
export declare function renderBanqi(ctx: CanvasRenderingContext2D, state: BanqiState, view: BanqiView, dtMs: number): void;
