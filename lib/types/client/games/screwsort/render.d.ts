/**
 * 螺栓分拣渲染层：工厂流水线风——自右向左滚动的传送带（滚轮反向旋转、
 * 左端红色斜纹漏检口）、环形螺母（颜色环体 + 内孔 + 内螺纹齿 + 选中金
 * 虚线圈）、四个螺栓工位（规格标签 M6/M10、孔径标尺、六角螺栓头色环、
 * 带螺纹的杆身、拧紧时六角螺母旋杆而下的动画 + 进度条、错配红闪）、
 * 得分 / 漏检 / 时间（关卡目标）HUD、飘字、粒子迸发、暂停与结算遮罩；
 * 渲染函数末尾最上层画「说明」按钮与 15px 大字帮助面板（任何阶段可
 * 开合，展开时遮住场面）。拖拽中的螺母以半透明幽灵跟随指针。
 */
import type { ScrewSortState } from './logic.ts';
/**
 * 渲染一帧：背景、传送带、螺母（含拖拽幽灵）、工位、飘字、粒子、
 * HUD、遮罩，最后最上层画说明按钮与帮助面板。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 * @param paused - 是否显示暂停遮罩。
 * @param helpOpen - 帮助面板是否展开。
 * @param drag - 拖拽指针的逻辑坐标（非拖拽为 null）。
 */
export declare function renderScrewSort(ctx: CanvasRenderingContext2D, state: ScrewSortState, paused: boolean, helpOpen: boolean, drag: {
    x: number;
    y: number;
} | null): void;
