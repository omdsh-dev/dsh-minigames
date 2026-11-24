/**
 * 骰子地牢游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点骰子选中、
 * 点槽卡片分配（非法组合直接被 logic 拒绝并提示），结束回合由敌人模
 * 式机结算；强化阶段点三选一卡片。R 重开（新种子）、P 暂停、H 或「说
 * 明」按钮开合帮助面板（任何阶段 / 暂停均可用，画面最上层）。回合制、
 * dirty 调度：静止零重绘，粒子存活窗口内逐帧 markDirty。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const dicedungeonGame: MiniGameDefinition;
