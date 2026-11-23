/**
 * 牛头王 TakeSix 游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点击手牌
 * 出牌（与 AI 暗牌同时翻开，小牌先放）、被迫收行时点击行、空格开下一局、
 * R 重开（换新种子）、P 暂停；右上角「说明」按钮任何阶段可弹帮助面板。
 * dirty 帧循环：输入、亮牌动画与粒子期间重绘；局分经 onScore 上报
 * （每局 100 分，夺冠再奖 300）。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const takesixGame: MiniGameDefinition;
