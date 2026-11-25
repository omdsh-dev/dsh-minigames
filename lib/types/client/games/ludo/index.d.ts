/**
 * 飞行棋 Ludo 游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 开局
 * overlay 选 2/3/4 人（玩家恒执红，其余为 AI）；空格/点按钮掷骰，点
 * 击发光飞机移动（唯一合法着法自动落子，空格也可交给贪心自动走），
 * 悬停可动飞机时预览高亮落点；AI 各色自动掷骰行子；踩子触发回程幽灵
 * 动画与粒子；2 人 3 局 2 胜、多人单局定胜负，R 重开整场（保留人
 * 数）、P 暂停、H 或「说明」按钮随时开关帮助面板。骰子滚动与 AI 回
 * 合期间逐帧重绘，静态盘面按脏标记按需重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const ludoGame: MiniGameDefinition;
