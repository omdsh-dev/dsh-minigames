/**
 * 开花连消 Bloom 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 点击花苞触发同色连锁绽放（涟漪动画逐层展开），方向键 + 回车也可
 * 触发；R 重开本关、P 暂停、H 或右下角按钮随时开合帮助面板。过关
 * 自动进入下一关（进度走 level-progress 持久化），胜利时全田绽放
 * 粒子庆祝并上报 onScore。dirty 模式按需重绘，涟漪动画期间逐帧。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const bloomGame: MiniGameDefinition;
