/**
 * 骨牌对对游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点击选中
 * 再点相邻骨牌交换（或按住拖到相邻格松手）、点锁定骨牌给红色反馈，
 * H 提示、R 重开本关（通关后再按回到第 1 关）、P 暂停；脏标记按需
 * 渲染（有粒子或拖拽时逐帧），说明按钮开合帮助面板（展开时点击优先
 * 收起），分数经 onScore 上报（最高分由面板管理）。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const dominoshuffleGame: MiniGameDefinition;
