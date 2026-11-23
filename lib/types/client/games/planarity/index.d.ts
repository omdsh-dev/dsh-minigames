/**
 * 解绳谜题 Planarity 游戏定义：把纯逻辑与渲染器接成 MiniGameInstance。
 * 指针拖动顶点（拖动跟随、实时交叉复查），R 重开本关（同 baseSeed，
 * 同一盘题），P 暂停 / 继续，H 或点击「说明」开关帮助面板（任何阶段
 * 可开合，打开时暂停计时）。过关时顶点平滑归位到理想布局 + 粒子庆祝，
 * 动画结束后自动进入下一关；全部通关后 R 开新的一局（新种子）。
 * 渲染走 dirty 模式：静止盘面零重绘，拖拽 / 计时秒变 / 动画 / 粒子
 * 才标记重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const planarityGame: MiniGameDefinition;
