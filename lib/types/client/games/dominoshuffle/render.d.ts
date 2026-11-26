/**
 * 骨牌对对渲染层：一排象牙色数字骨牌（上半点数阵 / 下半大数字，中
 * 缝分线），锁定骨牌罩灰并画小挂锁，选中金框发光，已就位绿边，提示
 * 对金色虚线框 + 双向箭头；HUD 显示分数 / 关卡 / 剩余交换 / 步数预
 * 算，下方步数预算进度条；交换与过关迸发粒子；暂停与结算遮罩；渲染
 * 函数末尾最上层画「说明」按钮与 15px 大字帮助面板（任何阶段可开
 * 合，展开时遮住场面）。拖拽中的骨牌以半透明幽灵跟随指针。
 */
import type { DominoShuffleState } from './logic.ts';
/**
 * 是否有存活粒子（脏渲染模式下决定是否需要按帧重绘）。
 * @returns 有粒子返回 true。
 */
export declare function dominoParticlesActive(): boolean;
/**
 * 渲染一帧：背景、状态行、骨牌行（含提示箭头与拖拽幽灵）、步数预
 * 算条、粒子、HUD、遮罩，最后最上层画说明按钮与帮助面板。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 * @param paused - 是否显示暂停遮罩。
 * @param helpOpen - 帮助面板是否展开。
 * @param drag - 拖拽中骨牌的槽位与指针逻辑坐标（非拖拽为 null）。
 * @param dtMs - 粒子推进时长 ms。
 */
export declare function renderDominoShuffle(ctx: CanvasRenderingContext2D, state: DominoShuffleState, paused: boolean, helpOpen: boolean, drag: {
    index: number;
    x: number;
    y: number;
} | null, dtMs: number): void;
