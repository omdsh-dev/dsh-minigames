/**
 * 达芬奇密码游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点牌堆
 * 摸牌、点己方牌位选插入点、点对方牌位弹数值面板猜数、空格结束回合 /
 * 下一局、R 重开（换新种子）、P 暂停。回合制 dirty 帧循环：输入、AI
 * 思考倒计时与翻开动画期间重绘；局分经 onScore 上报（每局 100 分，
 * 夺冠再奖 300）。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const davinciGame: MiniGameDefinition;
