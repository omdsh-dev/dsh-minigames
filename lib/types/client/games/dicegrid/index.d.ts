/**
 * 骰子彩窗 DiceGrid 装配：纯逻辑接进面板生命周期。
 *
 * 交互：点候选骰选中 → 点彩窗空格放置（非法则提示）；选中后可点「弃骰」
 * 丢弃；R 同 seed 重开本关；P 暂停；任何阶段（含暂停/过关）可点「说明」
 * 开合帮助面板。过关后点击进入下一关（5 关循环）。dirty 渲染：仅状态
 * 变化时重绘。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const dicegridGame: MiniGameDefinition;
