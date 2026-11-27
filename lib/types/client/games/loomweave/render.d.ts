/**
 * 织机穿梭 LoomWeave 渲染层：纺织工坊风——织机面板（经线竖线、已织
 * 行逐行堆叠的 over/under 色格、错色格红框对照）、下方「下一行」预览
 * 条（over 亮实 / under 暗沉小格）、右栏图案卡 / 色线篮 / 起始偏移钮、
 * HUD 与说明按钮 + 帮助面板（渲染末尾最上层）。
 * 布局核算（逻辑画布 720x560，两两不相交、不越界；同水平带 fillText
 * 净距 ≥20px）：HUD 带 y26——左「关卡」x16（约至 x98）、中题「织机穿梭」
 * x360 居中（约 330-390）、右「误差」x704 右锚（约 640-704），净距
 * ≥230px；织机面板 16-460 x 48-432；预览条 16-460 x 440-484（内文三段：
 * 「下一行」x28（至约 x80）、预览格 x100 起（≤x254）、「第 r/M 行」x448
 * 右锚（约 378-448），净距 ≥94px）；图案卡 480-704 x 48-298；色线篮
 * 480-704 x 306-390；偏移钮 480-704 x 398-484（钮内数字 x 相距 48px）；
 * 底部提示带 y510 居中单条；说明按钮 644-704 x 528-552；帮助面板
 * 80-640 x 344-540（最上层覆盖层，行距 22px）。格子绘制按显式状态分支：
 * 织机格三态——未织（经线竖线）/ 已织 over（纬色实块+亮顶边）/ 已织
 * under（经色暗底+竖线残留）；预览格两态——preview over / preview
 * under；互不串道。无反引号模板字符串。
 */
import { type LevelData, type Phase, type RowChoice } from './logic.ts';
import { type ParticleSystem } from '../theme.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 720;
export declare const LOGICAL_H = 560;
/** 说明按钮矩形（右下角，60x24）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 织机格自适应布局（居中含边距）。 */
interface ClothLayout {
    ox: number;
    oy: number;
    cell: number;
}
/**
 * 织机网格布局：在织机面板内按 cols×rows 自适应取整并居中。
 * @param data - 关卡数据。
 * @returns 网格布局。
 */
export declare function clothLayout(data: LevelData): ClothLayout;
/**
 * 命中测试：色线篮里的色线索引（点中色块返回 0..colors-1）。
 * @param data - 关卡数据（取色数）。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 * @returns 色索引，或 null。
 */
export declare function threadFromPoint(data: LevelData, x: number, y: number): number | null;
/**
 * 命中测试：起始偏移钮（点中返回 0..3）。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 * @returns 偏移值，或 null。
 */
export declare function offsetFromPoint(x: number, y: number): number | null;
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    /** 关卡数据。 */
    data: LevelData;
    /** 已织入各行的选择（自上而下）。 */
    woven: RowChoice[];
    /** 已织入各行的视觉色（clothColors 计算）。 */
    cloth: number[][];
    /** 当前选中的纬线色。 */
    selectedColor: number;
    /** 当前起始偏移（0..3）。 */
    offset: number;
    /** 阶段。 */
    phase: Phase;
    /** 是否暂停。 */
    paused: boolean;
    /** HUD 关卡值（如 '1/5'）。 */
    hudLevel: string;
    /** 当前误差格数（已织部分）。 */
    error: number;
}
/**
 * 渲染一帧完整场景。末尾按最上层顺序：遮罩（暂停/过关/未达标）→ 粒子
 * → 说明按钮 + 帮助面板（任何阶段可开合）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param particles - 粒子系统（过关礼花）。
 * @param dtMs - 粒子推进毫秒。
 * @param helpOpen - 帮助面板是否展开。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, particles: ParticleSystem, dtMs: number, helpOpen: boolean): void;
export {};
