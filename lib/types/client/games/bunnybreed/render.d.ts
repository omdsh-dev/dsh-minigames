/**
 * 兔子育种 BunnyBreed 渲染层：农场兔舍 4x2 卡位（兔头+基因型徽章、
 * 选中高亮连线、达标金环）、右上育种目标与 Punnett 子代概率预览
 * （按选中数 0/1/2 显式分支）、容量/代数 HUD、配种/放归按钮与说明
 * 按钮 + 帮助面板（渲染末尾最上层）。纯绘制，无状态。
 *
 * 布局核算（720x560 逻辑画布，两两不相交、不越界）：
 * - HUD 行基线 y26：左「关卡」x16 左锚、中「容量」x246 居中、右「剩余」
 *   x704 右锚，三段文本净距 ≥120px。
 * - 兔舍面板 16-476 x 48-500；兔卡 4x2（卡 105x214、列距 8、行距 8，
 *   卡中心横距 113px，卡内居中文本宽 ≤90px，同带相邻卡净距 ≥23px；
 *   基因型徽章（卡顶+152 基线）与表现型文本（卡顶+184）不同水平带。
 * - 目标面板 480-704 x 48-180；Punnett 预览面板 480-704 x 192-484
 *   （行内基因型 x492 左锚、概率 x692 右锚，净距 ≥100px）。
 * - 底部按钮带 y520-548：配种 16-104、放归 112-200；提示文本居中 x400
 *   （约 300-500，与按钮矩形净距 ≥100px）；说明按钮 644-704 x 528-552。
 * - 帮助面板 80-640 x 250-530（仅打开时叠加，最上层）。
 * 无反引号模板字符串。
 */
import type { LevelData, OffspringStat, Rabbit } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 720;
export declare const LOGICAL_H = 560;
/** 配种按钮矩形（左下）。 */
export declare const BREED_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 放归按钮矩形（配种按钮右侧）。 */
export declare const RELEASE_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 说明按钮矩形（右下角，60x24）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    /** 关卡数据（容量、目标）。 */
    data: LevelData;
    /** 在场兔子（槽位顺序）。 */
    rabbits: Rabbit[];
    /** 已选亲本 id 列表（0-2 个）。 */
    selected: number[];
    /** 选中亲本数量（预览面板按 0/1/2 显式分支）。 */
    selectedCount: number;
    /** 两亲本已选时的子代概率表（否则 null）。 */
    punnett: OffspringStat[] | null;
    /** HUD 关卡值（如 1/5）。 */
    hudLevel: string;
    /** 在场兔数。 */
    count: number;
    /** 剩余代数。 */
    genLeft: number;
    /** 配种按钮是否可用（2 亲本 + 空位足 + 进行中）。 */
    breedEnabled: boolean;
    /** 放归按钮是否可用（恰好 1 只选中 + 进行中）。 */
    releaseEnabled: boolean;
    /** 兔子是否匹配目标（含双目标任一条），与兔一一对应。 */
    matchFlags: boolean[];
}
/**
 * 命中测试：逻辑坐标转兔卡槽位。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的槽位下标（未命中为 null）。
 */
export declare function rabbitSlotAt(px: number, py: number): number | null;
/**
 * 整帧绘制：背景 + HUD + 兔舍兔卡 + 选中连线 + 目标/预览面板 + 底部
 * 按钮/提示 + 说明按钮与帮助面板（末尾最上层）。overlay 由 index 层
 * 随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen?: boolean): void;
