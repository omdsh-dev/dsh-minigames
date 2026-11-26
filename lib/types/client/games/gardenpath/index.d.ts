/**
 * 花径寻踪 game definition：把纯逻辑接进 MiniGameInstance——点击空地
 * 在花/草间循环（非法格忽略），H 给提示（每关限 2 次，直接落正解子），
 * R 重开本关，P 暂停，[ ] 在已到达关卡间切换。过关即整体标记满足全部
 * 约束（唯一解保证与生成解一致），onScore 上报后 1.5s 自动进下一关；
 * 进度走 level-progress 持久化。dirty 帧循环：静止时零重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const gardenpathGame: MiniGameDefinition;
