/**
 * 生命播种 CellLife 渲染层：培养皿风 8x8 盘面（细胞圆点辉光、起始区
 * 虚线框）、右侧目标图案与下一步预览小图对照、进化动画（死亡红点淡出、
 * 新生绿点闪现）、步数 HUD 与说明按钮 + 帮助面板（渲染末尾最上层）。
 * 纯绘制，无状态；布局常量集中声明并核算互不遮挡（HUD 行 y26：左侧
 * 关卡 x16、中题 x246 居中、右剩步 x704 右锚，三段净距 ≥130px；盘面
 * 38-454 x 50-466；目标面板 480-704 x 48-268；预览面板 480-704 x
 * 284-504；底部提示带 y530 与说明按钮 644-704 x 528-552，均在 720x560
 * 逻辑画布内）。无反引号模板字符串。
 */
import type { Board, Cell, LevelData } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 720;
export declare const LOGICAL_H = 560;
/** 网格盘面布局：左上角与单元边长（含居中边距）。 */
export interface Layout {
    ox: number;
    oy: number;
    cell: number;
}
/** 说明按钮矩形（右下角，60x24）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 主盘面布局：8x8 网格在盘面区域内自适应（单元取整、整体居中含边距）。
 * @returns 盘面布局。
 */
export declare function boardLayout(): Layout;
/**
 * 命中测试：逻辑坐标转网格单元，越界返回 null。
 * @param layout - 盘面布局。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的网格单元，或 null。
 */
export declare function cellFromPoint(layout: Layout, px: number, py: number): Cell | null;
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    /** 当前关卡数据（K、起始区、目标）。 */
    data: LevelData;
    /** 当前盘面。 */
    board: Board;
    /** 进化动画的前一帧盘面（null 表示无动画）。 */
    prevBoard: Board | null;
    /** 进化动画进度：1 起衰减到 0，0 表示无动画。 */
    anim: number;
    /** 是否处于摆放阶段（未进化，可点击摆格）。 */
    placing: boolean;
    /** T 预览是否开启。 */
    previewOn: boolean;
    /** 预览盘面（index 层由 previewNext 计算，关闭时为 null）。 */
    previewBoard: Board | null;
    /** HUD 关卡值（如 '1/5'）。 */
    hudLevel: string;
    /** 已进化步数。 */
    steps: number;
}
/**
 * 整帧绘制：背景 + HUD + 培养皿盘面 + 右栏目标/预览小图 + 底部提示 +
 * 说明按钮与帮助面板（末尾最上层）。overlay 由 index 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen?: boolean): void;
