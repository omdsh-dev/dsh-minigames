/**
 * 折纸成方 OrigamiFold 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 点击折线附近选择翻折侧执行折叠（250ms 翻折动画），R 重开本关、P 暂停、
 * H 或右下角按钮随时开合帮助面板。过关自动进入下一关（循环回到第 1 关
 * 时清零累计分），胜利时粒子庆祝并上报 onScore；dirty 模式按需重绘，
 * 折叠动画与粒子期间逐帧。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const origamifoldGame: MiniGameDefinition;
