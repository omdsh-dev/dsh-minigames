/**
 * 字母雨 TypeFall 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 字母键接住下落字母（焦点内才响应并 preventDefault）、R 重开（新种子）、
 * P 暂停、H 或右上角「说明」按钮开合帮助面板（任何阶段可用）。continuous
 * 帧循环驱动 dt 模拟，溅落事件转为粒子爆发，分数变化时上报 onScore。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const typefallGame: MiniGameDefinition;
