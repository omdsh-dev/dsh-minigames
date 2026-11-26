/**
 * 云中播种渲染：农田天空风画面——天空流场箭头（沿风向漂移动画）、
 * 云朵飘浮（加速 » / 减速 «）、山剪影、田地格（浇灌后变深绿+水珠）、
 * 种子飘行轨迹虚线、飞行种子光点、浇灌水滴粒子、HUD 进度、说明按钮
 * 与帮助面板。纯绘制 + 布局导出（index.ts 用同一份布局做点击命中，
 * 杜绝绘制与命中错位）。说明按钮与帮助面板画在整个渲染函数的最末尾，
 * 保证盖在棋盘与 overlay 之上；任何阶段都可开合。
 */
import { type CloudSeedsLevel, type SeedFlight, type SeedOutcome } from './logic.ts';
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
export interface CloudLayout {
    /** 棋盘整体矩形（含四周留白已扣除）。 */
    board: Rect;
    /** 单格边长。 */
    cell: number;
    /** 说明按钮（60×24，右下角）。 */
    helpButton: Rect;
}
/**
 * 计算整幅布局（绘制与命中共用）：格边长按盘面自适应，棋盘居中。
 * @param level - 盘面。
 * @returns 完整布局矩形。
 */
export declare function computeLayout(level: CloudSeedsLevel): CloudLayout;
/**
 * 命中棋盘格。
 * @param layout - 布局。
 * @param level - 盘面。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格下标，未命中返回 -1。
 */
export declare function cellAt(layout: CloudLayout, level: CloudSeedsLevel, x: number, y: number): number;
/**
 * 某格中心点（轨迹/粒子/高亮定位用）。
 * @param layout - 布局。
 * @param level - 盘面。
 * @param cell - 格下标。
 */
export declare function cellCenter(layout: CloudLayout, level: CloudSeedsLevel, cell: number): {
    x: number;
    y: number;
};
/**
 * 说明按钮是否被点中。
 * @param layout - 布局。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 */
export declare function helpButtonHit(layout: CloudLayout, x: number, y: number): boolean;
/** 已完成的一次飘行轨迹（渲染历史虚线）。 */
export interface SeedTrail {
    /** 途经格（含起点）。 */
    path: number[];
    /** 结果。 */
    outcome: SeedOutcome;
    /** 新浇灌的田数（0 表示白丢一颗）。 */
    wateredCount: number;
}
/** 渲染选项：进度、悬停、预览、飞行、历史轨迹与阶段标志。 */
export interface RenderOptions {
    /** 关卡显示号（1 基）。 */
    level: number;
    /** 剩余种子。 */
    seedsLeft: number;
    /** 已浇灌田数。 */
    wateredTotal: number;
    /** 田地总数。 */
    fieldsTotal: number;
    /** 已浇灌标记（行主序）。 */
    watered: Uint8Array;
    /** 悬停格（-1 无）。 */
    hover: number;
    /** 空格试放的轨迹预览（不消耗种子）。 */
    preview: SeedFlight | null;
    /** 飞行中的种子（含进度 t∈[0,1]）。 */
    flying: {
        flight: SeedFlight;
        t: number;
    } | null;
    /** 历史轨迹。 */
    trails: SeedTrail[];
    /** 暂停中。 */
    paused: boolean;
    /** 已过关。 */
    won: boolean;
    /** 已失败（种子用尽）。 */
    lost: boolean;
    /** 过关文案。 */
    winText: string | null;
    /** 说明面板是否展开。 */
    helpOpen: boolean;
    /** 动画时钟（秒，流场与云朵漂移）。 */
    timeSec: number;
}
/**
 * 整幅渲染：背景 → HUD → 棋盘（天空流场/云/山/田/悬停/历史轨迹/预览/
 * 飞行种子）→ 底部提示 → 粒子 → 暂停/过关/失败 overlay → 说明按钮 →
 * 帮助面板（最后两步永远最上层）。
 * @param ctx - 画布上下文（fitCanvas 变换后的逻辑坐标）。
 * @param level - 盘面。
 * @param opts - 渲染选项。
 * @param particles - 可选粒子系统（浇灌时 index.ts 注入）。
 * @param dtMs - 粒子推进毫秒。
 */
export declare function renderCloudSeeds(ctx: CanvasRenderingContext2D, level: CloudSeedsLevel, opts: RenderOptions, particles?: {
    tick(ctx: CanvasRenderingContext2D, dtMs: number): void;
}, dtMs?: number): void;
