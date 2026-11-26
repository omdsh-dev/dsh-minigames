/**
 * 层叠塔 TowerBuild 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 空格 / 点击放块，R 重开本关、P 暂停、H 或右下角按钮开合帮助面板
 * （任何阶段可看）。连续帧循环（吊索摆动 + 倒塌散块动画），分数变化
 * 时上报 onScore，过关自动进入下一关，失败 / 通关由空格或 R 重开。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const towerbuildGame: MiniGameDefinition;
