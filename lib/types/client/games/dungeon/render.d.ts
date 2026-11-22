/**
 * 「像素地牢」画布渲染：深色石墙 + 火把光晕迷雾（可见全亮 / 走过
 * 微亮 / 未知纯黑），矩形拼出的像素角色与怪物，血条 / 攻 / 层 / 金币
 * HUD，战斗浮动数字与死亡 / 通关 / 暂停 overlay。共享视觉件见
 * ../theme.ts；所有绘制都基于 logic.ts 的纯状态，不持有游戏逻辑。
 */
import { type DungeonState, type GameEvent } from './logic.ts';
/** 单格逻辑像素。 */
export declare const CELL = 34;
/** 顶部 HUD 高度。 */
export declare const HUD_H = 54;
/** 网格外边距（水平居中 + 上下留白）。 */
export declare const MARGIN = 8;
export declare const LOGICAL_W: number;
export declare const LOGICAL_H: number;
/** 网格左上角原点（固定 12×10，含边距居中）。 */
export declare const OX = 8;
export declare const OY: number;
/** 一条浮动战斗数字（出生在格子中心，向上漂并淡出）。 */
export interface FloatText {
    x: number;
    y: number;
    text: string;
    color: string;
    age: number;
}
/** 浮动数字存活时长（ms）。 */
export declare const FLOAT_MS = 700;
/** 本帧渲染输入。 */
export interface DungeonView {
    /** 火把可见格（logic.computeVisible）。 */
    visible: Uint8Array;
    /** 活动中的浮动数字。 */
    floats: FloatText[];
    /** 暂停 overlay。 */
    paused: boolean;
    /** 自上一帧的毫秒数（浮动数字 / 粒子推进）。 */
    dtMs: number;
}
/** 格子中心像素坐标。 */
export declare function cellCenter(x: number, y: number): {
    px: number;
    py: number;
};
/** 事件 → 浮动数字（index 层在每回合调用）。 */
export declare function floatFromEvent(event: GameEvent): FloatText | null;
/** 在像素坐标爆一团粒子。 */
export declare function burstAt(px: number, py: number, color: string, count?: number): void;
/** 粒子是否仍在活动（index 层据此保持 dirty 渲染）。 */
export declare function particlesActive(): boolean;
/** 绘制一帧。 */
export declare function renderDungeon(ctx: CanvasRenderingContext2D, state: DungeonState, view: DungeonView): void;
