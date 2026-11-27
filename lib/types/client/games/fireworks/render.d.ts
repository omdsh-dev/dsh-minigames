/**
 * 烟花编排 FireworksShow 渲染层：夜空庆典（星点闪烁、发射架位、升空
 * 轨迹、按配方形状的绽放粒子）、目标谱清单（pending/hit/miss 三态打勾）、
 * 配方选择面板 + 延时滑条（0-5 秒，1 秒粒度）、点火按钮、说明按钮与
 * 帮助面板（渲染末尾最上层）。纯绘制无状态，布局常量集中声明并核算
 * 互不遮挡：HUD 行 y26 左 x16 / 中 x233 / 右 x704（三段净距 ≥150px）；
 * 夜空 16-450 x 36-380；发射位排 16-450 x 388-436；点火按钮 16-126 x
 * 444-470；底提示文案 (233, 496) 与说明按钮 644-704 x 528-552 同带净距
 * ≥400px；右栏目标谱 460-704 x 36-300、编辑器 460-704 x 312-516；全部
 * 在 720x560 逻辑画布内。无反引号模板字符串。
 */
import { type GameState, type ItemState, type LevelData } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 720;
export declare const LOGICAL_H = 560;
/** 点火按钮。 */
export declare const IGNITE_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 说明按钮（右下角，60x24）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 发射位卡片矩形：发射位排在 PADS 区域内均分（间隙 6px，自适应关卡位数）。
 * @param padCount - 发射位数量。
 * @param index - 发射位下标。
 * @returns 卡片矩形。
 */
export declare function padRect(padCount: number, index: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 命中发射位（发射架位区域）。运行阶段不可选。
 * @param padCount - 发射位数量。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 发射位下标，未命中返回 null。
 */
export declare function padFromPoint(padCount: number, px: number, py: number): number | null;
/**
 * 编辑器里的配方按钮矩形（3x3 网格，行 = 形状分组无关，仅布局）。
 * @param index - 配方下标（0-8）。
 * @returns 按钮矩形。
 */
export declare function recipeBtnRect(index: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 命中编辑器配方按钮。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 配方下标，未命中返回 null。
 */
export declare function recipeBtnFromPoint(px: number, py: number): number | null;
/**
 * 延时滑条取值：轨道 x → 0-5 秒（钳制）。
 * @param px - 逻辑 x。
 * @returns 延时秒（0-5 整数）。
 */
export declare function sliderValueFromPoint(px: number): number;
/**
 * 是否点在延时滑条轨道热区（上下扩 14px 便于拖拽）。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 是否命中。
 */
export declare function sliderHit(px: number, py: number): boolean;
/** 是否点在点火按钮。 */
export declare function igniteHit(px: number, py: number): boolean;
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    /** 游戏状态。 */
    state: GameState;
    /** 当前关卡。 */
    level: LevelData;
    /** HUD 关卡值（如 '1/5'）。 */
    hudLevel: string;
    /** HUD 右栏值（setup=点火次数，running=回放时刻，done=得分）。 */
    hudRight: string;
    /** HUD 右栏标签。 */
    hudRightLabel: string;
    /** 谱项三态（与关卡 items 一一对应）。 */
    itemStates: ItemState[];
}
/**
 * 整帧绘制：背景 + HUD + 夜空 + 发射位排 + 点火按钮 + 底提示 + 右栏
 * 目标谱/编辑器 + 说明按钮 + 帮助面板（末尾最上层）。overlay 由 index
 * 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen?: boolean): void;
