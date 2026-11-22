/**
 * 侦探推理游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 空格掷骰、
 * 点击高亮房间移动；进入房间自动弹盘问层（选嫌疑人 + 凶器，证人 AI 按
 * 发牌顺序亮一张匹配卡或无匹配触发锁定推断）；到中央大厅点击自身开启
 * 指认层（三要素，一局一次）；记事板自动维护排除/锁定标记。R 换种子
 * 重开、P 暂停、胜负后空格/点击再来一局；连胜经 onScore 上报。脏标记
 * 渲染：静止盘面零重绘，骰面动画与粒子期间逐帧。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const detectiveGame: MiniGameDefinition;
