/**
 * 兔子育种 BunnyBreed 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点两只兔选亲本 → 「配种」（每窝 4 仔、空位不足 4 时须先放归）；
 * 点 1 只兔选中后「放归」腾位；R 重开本关；P 暂停；说明按钮任何阶段
 * 可开合。目标达成过关（onScore 计分、level-progress 持久化），代数
 * 用尽判负。每关固定种子（重开同一窝序可复放）。帧循环 dirty 按需重绘；
 * 挂载时先立即渲染一帧再启动循环，帧回调 try-catch 包裹（渲染异常只
 * 记录不中断 rAF 链）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 兔子育种：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const bunnybreedGame: MiniGameDefinition;
