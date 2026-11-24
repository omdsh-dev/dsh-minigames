/**
 * 飞行棋 Ludo 游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 空格/
 * 点按钮掷骰，点击发光飞机移动（唯一合法着法自动落子，空格也可交给贪
 * 心自动走）；对方 AI 自动掷骰行子；踩子触发回程幽灵动画与粒子；3 局
 * 2 胜，R 重开整场、P 暂停、H 或「说明」按钮随时开关帮助面板。骰子
 * 滚动与 AI 回合期间逐帧重绘，静态盘面按脏标记按需重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const ludoGame: MiniGameDefinition;
