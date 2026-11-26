/**
 * 蜂群算法 canvas 渲染：深色巢穴风——蜂为带朝向的金色小菱形、邻居连线
 * 淡显（D 调试开关）、红色障碍区脉冲、金色目标圆区、三滑杆调参面板、
 * 指标进度条、关卡 HUD、说明按钮与大字帮助面板（渲染函数末尾最上层）、
 * 暂停/过关/超时/通关 overlay 与过关粒子。使用共享视觉套件（../theme.ts）。
 * 文件内不使用模板字符串。
 */
import type { HiveMindState } from './logic.ts';
/** 固定逻辑画布尺寸（与 logic 的 W/H 一致）。 */
export declare const LOGICAL_W = 480;
export declare const LOGICAL_H = 600;
/** 顶部 HUD 高度。 */
export declare const HUD_H = 30;
/** 说明按钮矩形（点击开合帮助面板，任何阶段可用）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 三条滑杆的轨道几何（trackY 为轨道上缘，h 为轨道高）。 */
export interface SliderTrack {
    /** 参数键。 */
    key: 'sep' | 'ali' | 'coh';
    /** 左侧中文短标。 */
    label: string;
    /** 轨道 x。 */
    x: number;
    /** 轨道 y。 */
    y: number;
    /** 轨道宽。 */
    w: number;
    /** 轨道高。 */
    h: number;
}
/** 渲染侧视图选项。 */
export interface HiveMindView {
    /** 暂停中（画暂停 overlay，不推进模拟由调用方控制）。 */
    paused: boolean;
    /** 是否淡显邻居连线（D 键切换）。 */
    showLinks: boolean;
    /** 本帧 dt（ms），驱动粒子与脉冲动画。 */
    dtMs: number;
}
/** 点击是否命中说明按钮。 */
export declare function helpButtonAt(x: number, y: number): boolean;
/** 开/关帮助面板（任何阶段可开合）。 */
export declare function toggleHelp(): void;
/** 关闭帮助面板（Escape）。 */
export declare function closeHelp(): void;
/** 帮助面板当前是否打开。 */
export declare function isHelpOpen(): boolean;
/** 命中哪条滑杆（命中区为轨道上下各扩 10px 的矩形）。 */
export declare function sliderAt(x: number, y: number): 'sep' | 'ali' | 'coh' | null;
/** 滑杆轨道上横坐标 x 对应的参数值（0-2，越界钳制）。 */
export declare function sliderValueAt(key: 'sep' | 'ali' | 'coh', x: number): number;
/** 主渲染入口：整帧绘制（帮助面板最后画，位于最上层）。 */
export declare function renderHiveMind(ctx: CanvasRenderingContext2D, state: HiveMindState, view: HiveMindView): void;
