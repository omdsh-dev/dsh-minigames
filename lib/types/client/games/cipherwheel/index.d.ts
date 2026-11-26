/**
 * 密码转盘接线：把纯逻辑挂进 MiniGameInstance——鼠标拖动黄铜转轮（角度
 * 步进）或点击字母环直接对齐，数字键两位缓冲自动应用偏移；Enter 提交、
 * H 提示、R 重开（同 seed 重放）、P 暂停。帮助面板任何阶段可开合，
 * 打开时拦截其它交互。dirty 渲染：转轮/提示/过关才重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const cipherwheelGame: MiniGameDefinition;
