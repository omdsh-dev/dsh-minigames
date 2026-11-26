/**
 * 云中播种 game definition：把纯逻辑接进 MiniGameInstance——点击天空/
 * 云朵格播种（种子沿风矢量动画飘行），空格对悬停格试放轨迹预览（不消
 * 耗种子），R 重开本关（同 seed 重放），P 暂停，说明按钮随时开合。过关
 * 上报 onScore 后 1.5s 自动进下一关；种子用尽判负。dirty 帧循环 + 流场
 * 与云朵动画期间逐帧重绘，静止（暂停/无动画）时零重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const cloudseedsGame: MiniGameDefinition;
