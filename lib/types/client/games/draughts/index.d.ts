/**
 * 国际跳棋游戏定义：把纯规则与 2 层极小极大 AI 组装成 MiniGameInstance。
 * 玩家执红（向上），点击选子 / 走子；AI 执黑延迟应手；有吃必吃由
 * legalMoves 直接保证。U 悔棋、R 重开本局、P 暂停；3 局 2 胜，胜负
 * 与必吃警示经渲染层展示，「说明」面板任何阶段可开合。AI 种子由
 * 局号 + 手数派生，同一局完全确定。dirty 模式按需重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const draughtsGame: MiniGameDefinition;
