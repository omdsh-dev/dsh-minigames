/**
 * 「提灯人 Lamplight」游戏定义：把纯逻辑接成 MiniGameInstance。
 * 方向键/WASD 移动（回合制：一步 = 移动 + 耗油 + 暗影行动），R 用同一
 * seed 重开本关（地形完全一致），P 暂停；点击右上「说明」开合帮助面板
 * （任何阶段可用，渲染层画在最后）。灯焰动画逐帧重绘（continuous 模式）；
 * 过关遮罩下按任意方向键进入下一关；第 5 关全亮为整场通关。onScore 在
 * 每次过关时上报当前关卡号。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 注册表用的「提灯人」定义。 */
export declare const lamplightGame: MiniGameDefinition;
