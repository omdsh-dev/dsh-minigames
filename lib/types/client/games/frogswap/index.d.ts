/**
 * 青蛙过河游戏定义：把确定性 FrogSwap 逻辑接成 {@link MiniGameInstance}
 * ——点蛙选中、点目标落子、U 撤销、R 重开（换种子）、P 暂停、过关后
 * 空格/按钮进下一关；说明按钮任何阶段可开合。回合制 dirty 帧循环：
 * 仅交互与过关粒子期间重绘；分数按已完成关卡的效率累计，经 onScore
 * 上报（每关满分 100，按最优步数比例折算）。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const frogswapGame: MiniGameDefinition;
