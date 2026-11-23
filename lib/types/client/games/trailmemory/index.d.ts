/**
 * 记忆路径 TrailMemory 游戏定义：把纯逻辑与渲染接成 MiniGameInstance。
 * 闪现与计时全部由帧循环注入 dt 推进（暂停即停帧，天然冻结）；
 * 点击复现、空格重看、R 重开、P 暂停、H / 右下角按钮开合帮助面板
 * （任何阶段可看）。dirty 模式按需重绘，闪现/停顿/错闪/粒子期间逐帧。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const trailmemoryGame: MiniGameDefinition;
