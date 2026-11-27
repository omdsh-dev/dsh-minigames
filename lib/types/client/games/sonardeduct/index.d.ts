/**
 * 「声呐探物 SonarDeduct」游戏定义：把纯逻辑接成 MiniGameInstance。
 * 左键按模式发声呐 / 插旗拔旗，E 切换模式，R 用同一 seed 重开本关
 * （海域完全一致），P 暂停；点击右上「说明」开合帮助面板（任何阶段
 * 可用，渲染层画在最后）。基础 dirty 模式：波纹 / 鱼群 / 粒子活跃时
 * 逐帧 markDirty 重绘，静止时零重绘；挂载时先立即渲染一帧再启动循环，
 * 帧回调 try-catch 包裹（渲染异常只记录不中断循环）。过关遮罩下点
 * 网格或按 E 进入下一关；第 5 关完成即整场通关。onScore 在过关时上报
 * 跨关累计分。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 注册表用的「声呐探物」定义。 */
export declare const sonardeductGame: MiniGameDefinition;
