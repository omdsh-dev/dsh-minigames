import { type BinPackState } from './logic.ts';
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
/** 布局：待装区物品块、箱矩形、箱内物品块、说明按钮。 */
export interface BinPackLayout {
    /** 待装区每个物品的矩形（index = 物品下标）。 */
    tray: Rect[];
    /** 每个箱的矩形（index = 箱下标）。 */
    bins: Rect[];
    /** 箱内物品矩形，第一维箱下标、第二维按绘制顺序。 */
    binItems: Rect[][];
    /** 说明按钮（60x24，右下角）。 */
    helpButton: Rect;
}
/**
 * 计算整幅布局（绘制与命中共用）。
 * @param state - 对局状态。
 * @returns 完整布局矩形。
 */
export declare function computeLayout(state: BinPackState): BinPackLayout;
/**
 * 命中待装区物品。
 * @returns 物品下标，未命中返回 -1。
 */
export declare function trayItemAt(layout: BinPackLayout, state: BinPackState, x: number, y: number): number;
/**
 * 命中箱内物品。
 * @returns 物品下标，未命中返回 -1。
 */
export declare function binItemAt(layout: BinPackLayout, state: BinPackState, x: number, y: number): number;
/**
 * 命中箱矩形。
 * @returns 箱下标，未命中返回 -1。
 */
export declare function binAt(layout: BinPackLayout, x: number, y: number): number;
/** 说明按钮是否被点中。 */
export declare function helpButtonHit(layout: BinPackLayout, x: number, y: number): boolean;
/** 渲染选项：阶段标志、悬停箱、帮助面板、粒子。 */
export interface RenderOptions {
    paused: boolean;
    won: boolean;
    /** 胜利文案（won 时展示）。 */
    winText: string | null;
    /** 鼠标悬停的箱下标（-1 无），用于溢出红显。 */
    hoveredBin: number;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
}
/**
 * 整幅渲染：背景 → HUD → 待装区 → 箱区 → 底部提示 → 粒子 → 暂停 /
 * 过关 overlay → 说明按钮 → 帮助面板（最后两步永远最上层）。
 */
export declare function renderBinPack(ctx: CanvasRenderingContext2D, state: BinPackState, opts: RenderOptions, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
