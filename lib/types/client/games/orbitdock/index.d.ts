/**
 * 「轨道交会 OrbitDock」游戏定义：把纯逻辑接成 MiniGameInstance。
 * 暂停（未推进）时从飞船拖出箭头设定 ΔV，空格执行脉冲并继续模拟，
 * 再按空格暂停规划第二脉冲；P 暂停遮罩、R 同 seed 重开本关、H 或点
 * 「说明」开合帮助面板（任何阶段可用，渲染层画在最后）。continuous
 * 帧循环（轨迹渐隐与读数逐帧刷新）；挂载时立即渲染一帧（不依赖 rAF
 * 首帧），帧回调 try-catch 包裹，渲染异常只记录不中断循环。过关后
 * 空格 / R 进入下一关；第 5 关对接为整场通关。onScore 在每次过关时
 * 上报累计总分（关卡 ×1000 + 剩余 ΔV 折算）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 注册表用的「轨道交会」定义。 */
export declare const orbitdockGame: MiniGameDefinition;
