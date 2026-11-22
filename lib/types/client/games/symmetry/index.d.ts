/**
 * 对称补全 Symmetry 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点构件盘选中构件，点盘面放置（对位绿显锁定，错位红显可取回，
 * 右键或再点错件取回）；第 4-5 关混入对称轴计数选择题（点选项作答，
 * 答错红显可再答）。R 重开本关，P 暂停/继续；每关限时 LEVEL_SECONDS，
 * 超时判负可 R 重开。过关按关卡/步数/用时计分上报 onScore，进度经
 * level-progress 持久化。帧循环 dirty 按需重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 对称补全：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const symmetryGame: MiniGameDefinition;
