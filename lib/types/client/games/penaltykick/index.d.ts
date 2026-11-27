/**
 * 点球大战 PenaltyKick 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：罚球阶段点击球门六格选落点（←→↑↓ 可调）、拖动滑条或 W/S 调
 * 力度、空格射门；扑救阶段看 1 秒站位预读（金框热区）后点击一格扑救
 * （到时自动按提示扑）；R 重开整场 · P 暂停。胜场累计为等级（AI 更狡
 * 猾），level-progress 持久化。帧循环 continuous（守门员/足球动画、预
 * 读脉冲）；挂载时先立即渲染一帧再启动循环，帧回调 try-catch 包裹
 * （渲染异常只记录不中断 rAF 链）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 点球大战：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const penaltykickGame: MiniGameDefinition;
