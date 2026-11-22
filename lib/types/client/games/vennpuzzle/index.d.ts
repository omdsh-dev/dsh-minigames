/**
 * 韦恩图谜题定义：把纯逻辑接成 {@link MiniGameInstance}——点击或拖拽
 * 数字卡到韦恩图区域放置（点击空白 = 圆外），放对入区、放错红框并计
 * 步；R 重开、P 暂停。棋盘静态，走 dirty 按需帧循环（限时关每秒标脏）。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const vennpuzzleGame: MiniGameDefinition;
