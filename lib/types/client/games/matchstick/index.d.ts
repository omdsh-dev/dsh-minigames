/**
 * 火柴算式游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点在场火柴
 * 拿起（再点原段放回），点空位放下完成一次修改；后期关可点备用匣取
 * 新柴或把手中火柴丢入匣中；不成立的修改自动还原。U 放回手中火柴、
 * R 重开（按重开次数偏移换新题库）、P 暂停。回合制 dirty 帧循环：
 * 仅输入、判定闪烁、粒子与整秒倒计时变化时重绘；分数变化经 onScore
 * 上报。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const matchstickGame: MiniGameDefinition;
