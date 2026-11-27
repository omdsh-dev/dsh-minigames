/**
 * 生命播种 CellLife 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：摆放阶段点击起始区切换细胞；空格进化一步（进入观察阶段后不
 * 能再摆）；T 开关下一步预览；R 重摆本关；P 暂停。恰好 K 步后等于
 * 目标图案过关（onScore 计分、level-progress 持久化），步数用尽未达
 * 标判负可重摆。帧循环 dirty 按需重绘 + 进化动画逐帧；挂载时先立即
 * 渲染一帧再启动循环，帧回调 try-catch 包裹（渲染异常只记录不中断）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 生命播种：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const celllifeGame: MiniGameDefinition;
