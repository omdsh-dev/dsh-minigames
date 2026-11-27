/**
 * 烟花编排 FireworksShow 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点击发射位选中→右栏配方按钮选配方→点/拖延时滑条（0-5 秒，1
 * 秒粒度）；空格或「点火」按钮点火，演出按 0.1s tick 回放并逐帧渲染；
 * 谱项全中过关（onScore 计分、level-progress 持久化），未中判负可 R
 * 重开。帧循环 dirty 按需重绘 + 燃放期间逐帧；挂载时先立即渲染一帧再
 * 启动循环，帧回调 try-catch 包裹（渲染异常只记录不中断）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 烟花编排：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const fireworksGame: MiniGameDefinition;
