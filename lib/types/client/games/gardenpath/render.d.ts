import { type GardenPathPuzzle } from './logic.ts';
/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export declare const LOGICAL_W = 960;
export declare const LOGICAL_H = 580;
/** 一个矩形（逻辑坐标）。 */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 布局：棋盘矩形、格边长、说明按钮。 */
export interface GardenLayout {
    /** 棋盘整体矩形（含四周留白已扣除）。 */
    board: Rect;
    /** 单格边长。 */
    cell: number;
    /** 说明按钮（60x24，右下角）。 */
    helpButton: Rect;
}
/**
 * 计算整幅布局（绘制与命中共用）：格边长按盘面边长自适应，棋盘居中。
 * @param puzzle - 盘面。
 * @returns 完整布局矩形。
 */
export declare function computeLayout(puzzle: GardenPathPuzzle): GardenLayout;
/**
 * 命中棋盘格。
 * @param layout - 布局。
 * @param puzzle - 盘面。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格下标，未命中返回 -1。
 */
export declare function cellAt(layout: GardenLayout, puzzle: GardenPathPuzzle, x: number, y: number): number;
/**
 * 某格中心点（粒子/高亮定位用）。
 * @param layout - 布局。
 * @param puzzle - 盘面。
 * @param cell - 格下标。
 */
export declare function cellCenter(layout: GardenLayout, puzzle: GardenPathPuzzle, cell: number): {
    x: number;
    y: number;
};
/** 说明按钮是否被点中。 */
export declare function helpButtonHit(layout: GardenLayout, x: number, y: number): boolean;
/** 渲染选项：悬停/提示格、错误反馈集合、阶段标志、帮助面板。 */
export interface RenderOptions {
    /** 悬停的空地下标（-1 无）。 */
    hovered: number;
    /** 提示点亮格（-1 无，短暂显示金色高亮）。 */
    hintCell: number;
    /** 与数字不符的提示格列表（红显）。 */
    badClues: number[];
    /** 八向相邻的花格列表（红圈）。 */
    conflicts: number[];
    /** 关卡显示号（1 基）。 */
    level: number;
    /** 步数（点击切换次数）。 */
    steps: number;
    /** 已满足的提示数。 */
    cluesSat: number;
    /** 提示总数。 */
    cluesTotal: number;
    /** 暂停中。 */
    paused: boolean;
    /** 已过关。 */
    won: boolean;
    /** 过关文案。 */
    winText: string | null;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
}
/**
 * 整幅渲染：背景 → HUD → 棋盘（草地/岩石/提示/花/反馈/悬停）→ 底部
 * 提示条 → 粒子 → 暂停/过关 overlay → 说明按钮 → 帮助面板（最后两步
 * 永远最上层）。
 * @param ctx - 画布上下文（fitCanvas 变换后的逻辑坐标）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @param opts - 渲染选项。
 * @param particles - 可选粒子系统（过关时 index.ts 注入）。
 * @param dtMs - 粒子推进毫秒。
 */
export declare function renderGardenPath(ctx: CanvasRenderingContext2D, puzzle: GardenPathPuzzle, marks: Uint8Array, opts: RenderOptions, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
