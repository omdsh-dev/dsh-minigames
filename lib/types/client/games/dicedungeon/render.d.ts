/**
 * 骰子地牢画布渲染：暗色地牢风——顶部 HUD（层数 / 生命 / 护盾 / 回合）、
 * 敌人立绘牌（HP 条 + 意图 + 灼烧图标）、大点数骰子行、三 / 四张槽卡片、
 * 强化三选一卡片、结束回合按钮、帮助按钮 + 帮助面板（渲染函数末尾最上
 * 层绘制，任何阶段与暂停均可开合）、死亡 / 通关 / 暂停 overlay。全部使用
 * 共享视觉套件（../theme.ts）。所有交互矩形由本模块统一导出，index 层
 * 命中测试与绘制共用同一份几何，杜绝错位。
 */
import type { DieView, DungeonView, SlotKind } from './logic.ts';
export declare const LOGICAL_W = 640;
export declare const LOGICAL_H = 420;
/** 帮助按钮（60×24，左下角）。 */
export declare const HELP_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 结束回合按钮（战斗阶段右下角）。 */
export declare const END_TURN_RECT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 按实测宽度把文案贪心折成最多 maxLines 行（CJK 友好：逐字断行，
 * 不依赖空格）。渲染层用 ctx.measureText 做宽度函数，测试可用
 * 固定字宽桩验证断行逻辑。超过 maxLines 时末行截断加省略号。
 * @param text 待折行文案
 * @param maxWidth 单行最大宽度（px，含省略号占用）
 * @param measureWidth 以目标字体测量字符串宽度的函数
 * @param maxLines 最大行数（至少 1）
 * @returns 折行结果（至少 1 行，均不超过 maxWidth，除非单个字形本身超宽）
 */
export declare function wrapTextByMeasure(text: string, maxWidth: number, measureWidth: (s: string) => number, maxLines?: number): string[];
/** 当前已解锁槽列表（火球 / 吸血随层数解锁）。 */
export declare function unlockedSlots(v: DungeonView): SlotKind[];
/** 每颗骰子的命中矩形（与绘制共用几何）。 */
export declare function diceRects(dice: DieView[]): {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
/** 每张槽卡片的命中矩形。 */
export declare function slotRects(slots: SlotKind[]): {
    x: number;
    y: number;
    w: number;
    h: number;
    slot: SlotKind;
}[];
/** 三张强化卡片的命中矩形。 */
export declare function upgradeRects(): {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
/** 粒子是否仍在存活（index 层据此逐帧 markDirty）。 */
export declare function dicedungeonParticlesActive(): boolean;
/** 在逻辑坐标迸发一簇粒子。 */
export declare function dicedungeonBurst(x: number, y: number, color: string, count: number): void;
/** 渲染一帧（index 层在 dirty 帧调用）。 */
export declare function renderDiceDungeon(ctx: CanvasRenderingContext2D, v: DungeonView, ui: {
    selectedDieId: number | null;
    showHelp: boolean;
    paused: boolean;
    slotOfDie: Record<number, SlotKind>;
}, dtMs: number): void;
