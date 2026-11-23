/**
 * 翻棋暗战游戏接线：把纯逻辑与渲染拼成 MiniGameInstance。
 * 交互：点暗子翻开、点亮子选中再点落点走子；AI 黑方在帧循环内决策；
 * 三局两胜，R 重开整场，P 暂停，「说明」按钮随时开关帮助面板。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const banqiGame: MiniGameDefinition;
