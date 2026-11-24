/**
 * 像素画家 PixelPainter 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点击调色板换色；左键点画布涂色、右键清除；H 提示（自动修正
 * 一个错格，每关限 2 次）；R 重开本关（同种子同图案）；P 暂停/继续。
 * 实时比对驱动错格红框与完成度，全格一致过关计分上报 onScore，进度经
 * level-progress 持久化。帧循环 dirty 按需重绘；说明按钮与帮助面板由
 * 渲染函数末尾的 drawHelp 画在最上层，任何阶段/暂停均可开合。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 像素画家：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export declare const pixelpainterGame: MiniGameDefinition;
