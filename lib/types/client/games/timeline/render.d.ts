/**
 * 时间线 Timeline 渲染层：横向卷轴时间轴（锚点旗标）、领域色边手牌卡、
 * 选中/拖拽时的插入位高亮、提交判定动画（锁定绿勾 + 错误红框回手提示）、
 * HUD（关卡/得分/错误/限时）、说明按钮与帮助面板（渲染函数末尾最上层，
 * 任意阶段与暂停态均可开合）、过关/超时/暂停 overlay。命中检测函数与
 * 绘制共用同一套布局矩形。所有动态文本右锚或居中，字号定宽防错位。
 */
import { type ParticleSystem } from '../theme.ts';
import type { TimelineState } from './logic.ts';
export declare const LOGICAL_W = 900;
export declare const LOGICAL_H = 560;
/** 提交按钮矩形（手牌区上方右侧）。 */
export declare const SUBMIT_RECT: {
    readonly x: number;
    readonly y: 280;
    readonly w: 96;
    readonly h: 30;
};
/** 说明按钮矩形（画布右上角，渲染最上层）。 */
export declare const HELP_RECT: {
    readonly x: number;
    readonly y: 12;
    readonly w: 60;
    readonly h: 24;
};
/** 渲染层需要的交互/动效快照（由 index 维护）。 */
export interface TimelineUi {
    selectedHandId: number | null;
    drag: {
        id: number;
        x: number;
        y: number;
    } | null;
    hoverSlot: number | null;
    /** 最近一次判定锁定/错误的卡 id（闪显动画用）。 */
    flashLockedIds: number[];
    flashWrongIds: number[];
    /** 最近一次判定距今的毫秒数。 */
    flashAgeMs: number;
    paused: boolean;
    helpOpen: boolean;
    /** 5 关全部通关。 */
    finished: boolean;
    totalScore: number;
}
/** 时间轴上第 slot 个插入位的 x 中心（含居中边距，随卡数自适应）。 */
export declare function slotCenterX(state: TimelineState, slot: number): number;
/** 时间轴上第 i 张已放置卡的矩形。 */
export declare function placedRect(state: TimelineState, i: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 手牌第 i 张卡的矩形（两行网格，行内间距充足）。 */
export declare function handRect(i: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 命中时间轴带内的插入位（0..k），不在带内或离所有空位都太远返回 null。 */
export declare function slotAt(x: number, y: number, state: TimelineState): number | null;
/** 命中一张已放置卡（不含插入空隙）。 */
export declare function placedAt(x: number, y: number, state: TimelineState): number | null;
/** 命中一张手牌。 */
export declare function handAt(x: number, y: number, state: TimelineState): number | null;
/** 点是否落在按钮矩形内。 */
export declare function inRect(x: number, y: number, r: {
    x: number;
    y: number;
    w: number;
    h: number;
}): boolean;
/** 主渲染入口：场景 → 粒子 → 阶段 overlay → 说明按钮/帮助面板（最上层）。 */
export declare function renderTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, state: TimelineState, ui: TimelineUi, particles: ParticleSystem): void;
export { LOGICAL_W as TIMELINE_W, LOGICAL_H as TIMELINE_H };
