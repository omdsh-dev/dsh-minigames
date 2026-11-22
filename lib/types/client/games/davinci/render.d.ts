/**
 * 达芬奇密码渲染器：木桌面、对方一列暗牌（翻开亮显金框）、己方一列明
 * 牌（白/黑底色 + 短横线标记）、公共牌堆（可点击摸牌）、待插牌与插入
 * 箭头、数值猜测选择面板、AI 思考提示、局分 HUD、猜错揭示翻面动画、
 * 一局结束面板与胜负遮罩。全部为纯 canvas 绘制，状态由 index.ts 传入
 * （见 DavinciView）。
 */
import { sortKey, type DavinciState } from './logic.ts';
/** 逻辑画布宽度 px。 */
export declare const W = 780;
/** 逻辑画布高度 px。 */
export declare const H = 580;
/** 牌宽 px。 */
export declare const CARD_W = 56;
/** 牌高 px。 */
export declare const CARD_H = 72;
/** 对方牌行顶 y。 */
export declare const AI_Y = 70;
/** 己方牌行顶 y。 */
export declare const MY_Y = 300;
/** 牌堆矩形。 */
export declare const PILE_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 说明按钮矩形（右下角）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 命中区域：牌堆 / 对方牌位 / 插入槽 / 数值按钮 / 下一局。 */
export type HitRegion = {
    kind: 'help';
} | {
    kind: 'pile';
} | {
    kind: 'aiCard';
    index: number;
} | {
    kind: 'insert';
    index: number;
} | {
    kind: 'insertEnd';
} | {
    kind: 'value';
    value: number;
} | {
    kind: 'next';
};
/** 一次渲染所需的全部状态。 */
export interface DavinciView {
    state: DavinciState;
    /** 正在猜的对方牌位（null 关闭面板）。 */
    picking: number | null;
    /** 翻面动画进度 0-1。 */
    reveal: number;
    /** AI 是否思考中（驱动提示与动画点）。 */
    aiThinking: boolean;
    paused: boolean;
}
/** 一行牌的各张矩形（水平居中）。 */
export declare function handRects(count: number, y: number): {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
/**
 * 命中测试：按优先级返回选择面板 > 下一局 > 牌堆 / 对方牌位 / 插入槽。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @param view - 当前渲染状态。
 * @returns 命中区域或 null。
 */
export declare function hitTest(x: number, y: number, view: DavinciView): HitRegion | null;
/**
 * 整帧渲染。
 * @param ctx - 画布上下文（逻辑坐标系）。
 * @param view - 渲染状态。
 */
export declare function renderDavinci(ctx: CanvasRenderingContext2D, helpOpen: boolean, view: DavinciView): void;
/** 排序键重导出（渲染层插入箭头校验用）。 */
export { sortKey };
