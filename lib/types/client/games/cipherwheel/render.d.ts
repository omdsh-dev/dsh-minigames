/**
 * 密码转盘画布渲染：黄铜双环转轮（外环密文字母、内环随偏移转动的明文
 * 环）、密文卷轴（提示揭示的字母绿色显示）、频率直方图（密文频率 vs
 * 英文常见频率金色刻度）、解码预览框、密钥参数行、关卡/提示/得分 HUD、
 * 提交与提示按钮、说明按钮 + 帮助面板（渲染末尾最上层）与结束遮罩。
 * 全部为无状态绘制：闪烁与帮助开关由调用方（index.ts）传入。
 */
import type { CipherWheelState } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 680;
export declare const LOGICAL_H = 520;
/** 渲染所需的运行时输入（由 index.ts 持有）。 */
export interface CipherRenderOpts {
    paused: boolean;
    /** 提交反馈闪烁：'none' 无，'good' 绿，'bad' 红。 */
    flash: 'none' | 'good' | 'bad';
    /** 帮助面板是否打开（任何阶段可开合）。 */
    helpOpen: boolean;
    /** 是否正在拖动转轮（高亮转轮边缘）。 */
    dragging: boolean;
}
/** 命中转轮面板（拖动调整偏移）。 */
export declare function wheelAt(x: number, y: number): boolean;
/** 命中转轮外环字母带，返回字母序号（0..25），未命中为 null。 */
export declare function wheelLetterAt(x: number, y: number): number | null;
/** 命中维吉尼亚密钥槽，返回槽索引，未命中为 null。 */
export declare function slotAt(x: number, y: number, slotCount: number): number | null;
/** 命中仿射乘数芯片，返回芯片下标，未命中为 null。 */
export declare function aChipAt(x: number, y: number): number | null;
/** 命中提交按钮。 */
export declare function submitAt(x: number, y: number): boolean;
/** 命中提示按钮。 */
export declare function hintAt(x: number, y: number): boolean;
/** 命中说明按钮（60x24）。 */
export declare function helpAt(x: number, y: number): boolean;
/**
 * 绘制一帧。
 * @param ctx - 画布上下文（逻辑坐标已由 fitCanvas 变换）。
 * @param state - 游戏状态。
 * @param opts - 运行时渲染输入。
 */
export declare function renderCipherWheel(ctx: CanvasRenderingContext2D, state: CipherWheelState, opts: CipherRenderOpts): void;
