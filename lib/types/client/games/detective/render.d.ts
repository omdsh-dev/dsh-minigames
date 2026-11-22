/**
 * 侦探推理画布渲染：庄园 3×3 房间俯视（中央大厅为指认室）+ 侦探棋子、
 * 骰子与步数状态条、玩家 9 张手牌卡、三列记事排除格（自动标记）、盘问
 * 弹层（选嫌疑人 + 凶器）、指认弹层（三要素）、AI 应答横幅与胜负/暂停
 * 覆盖层。共享 theme 视觉件；全部为纯绘制与命中检测，无游戏状态。
 */
import { type NoteMark } from './logic.ts';
export declare const LOGICAL_W = 480;
export declare const LOGICAL_H = 660;
export declare const HUD_H = 30;
/** 渲染所需的全部游戏视图状态（index.ts 持有并传入）。 */
export interface DetectiveView {
    pos: number;
    die: number;
    steps: number;
    /** 骰子动画中显示的滚动面值（0 = 定格）。 */
    diceFace: number;
    reachable: number[];
    hand: number[];
    notes: NoteMark[];
    /** 'idle' 待掷 / 'move' 待移动 / 'suggest' 盘问弹层 / 'accuse' 指认弹层。 */
    phase: 'idle' | 'move' | 'suggest' | 'accuse';
    /** 弹层内已选：嫌疑人 / 凶器 / 房间（-1 未选）。 */
    pickSuspect: number;
    pickWeapon: number;
    pickRoom: number;
    /** AI 应答横幅（空串隐藏）。 */
    banner: string;
    bannerGood: boolean;
    toast: string;
    status: 'playing' | 'won' | 'lost';
    /** 败局揭示底牌文本（won/lost 覆盖层用）。 */
    reveal: string;
    streak: number;
    paused: boolean;
}
/**
 * 棋盘命中检测。
 * @returns 房间号 0..8，未命中返回 -1。
 */
export declare function roomAt(x: number, y: number): number;
/** 盘问弹层命中：{type, index} 筹码 / 'ok' / 'cancel' / null。 */
export declare function suggestHit(x: number, y: number): {
    type: 'suspect' | 'weapon';
    index: number;
} | 'ok' | 'cancel' | null;
/** 指认弹层命中：{type, index} 筹码 / 'ok' / 'cancel' / null。 */
export declare function accuseHit(x: number, y: number): {
    type: 'suspect' | 'weapon' | 'room';
    index: number;
} | 'ok' | 'cancel' | null;
/**
 * 绘制一帧：背景 → HUD → 速览条 → 棋盘 → 状态条 → 手牌 → 记事板 →
 * AI 应答横幅 → 弹层 → 胜负/暂停覆盖层。
 */
export declare function renderDetective(ctx: CanvasRenderingContext2D, view: DetectiveView): void;
