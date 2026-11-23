/**
 * 装箱谜题 BinPack 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 点击物品选中、点击箱放入、点击箱内选中物品取出重放；R 重开本关、
 * P 暂停、H 或右下角按钮开合帮助面板（任何阶段可看）。过关（用箱数
 * ≤ 最优）上报 onScore 并自动进入下一关。dirty 模式按需重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const binpackGame: MiniGameDefinition;
