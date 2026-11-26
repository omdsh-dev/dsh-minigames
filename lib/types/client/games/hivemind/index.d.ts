/**
 * 蜂群算法游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 拖三滑杆
 * 实时调分离/对齐/聚合权重、空格或 P 暂停、D 切邻居连线（调试）、
 * R 重开本关、H/说明按钮开合帮助面板（任何阶段）、过关后 N 进下一关。
 * 蜂群连续模拟，frame-scheduler 走 continuous 模式每帧重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const hivemindGame: MiniGameDefinition;
