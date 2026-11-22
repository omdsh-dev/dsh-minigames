/**
 * 「像素地牢」游戏定义：把纯逻辑（./logic.ts）与像素渲染（./render.ts）
 * 接成 {@link MiniGameInstance}。方向键 / WASD 回合制移动，R 重开
 * （死亡后金币减半传承），P 暂停。回合制盘面用 dirty 渲染——只在
 * 移动 / 拾取 / 胜负 / 浮动数字未消失时重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 「像素地牢」定义：回合制 roguelike 地牢爬行。 */
export declare const dungeonGame: MiniGameDefinition;
