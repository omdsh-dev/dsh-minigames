/**
 * 织机穿梭 LoomWeave 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点色线篮选纬线色、点 0-3 起始偏移钮（预览条即时反映），回车织
 * 入一行，Z 拆最上一行（未达标阶段也可拆了重织），R 重开本关，P 暂停，
 * 说明按钮任何阶段可开合。过关 onScore 计分、level-progress 持久化。
 * 帧循环 dirty 按需重绘；挂载时先立即渲染一帧再启动循环（防黑屏事故），
 * 帧回调 try-catch 包裹（渲染异常只记录不中断 rAF 链）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 织机穿梭：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const loomweaveGame: MiniGameDefinition;
