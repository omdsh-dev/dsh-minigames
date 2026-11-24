/**
 * 螺栓分拣游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点螺母
 * 选中、再点工位投放（或按住拖拽到工位），空格按住加速传送带，
 * continuous 帧循环推进模拟与渲染，R 重开（换局号）、P 暂停；说明
 * 按钮开合帮助面板（展开时点击优先收起），分数经 onScore 上报（最高
 * 分由面板管理）。挂载即采用连续 60 秒模式。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const screwsortGame: MiniGameDefinition;
