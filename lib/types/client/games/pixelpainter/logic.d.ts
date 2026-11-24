/**
 * 像素画家 PixelPainter 纯逻辑：内置 14 幅像素图案（8x8 到 12x12，含
 * 4-6 色），按注入的 mulberry32 种子确定性地为 5 个递进关卡选图并打乱
 * 调色板顺序。提供画布着色/清除、参考图实时比对（对/错格计数与错格
 * 列表）、完成度、提示（自动修正一个错格）、过关判定与计分。无 DOM、
 * 无副作用，同一种子序列完全一致，可在 vitest 中直接复放验证。
 */
/** 一种图案颜色：字符与其十六进制色值（点号恒为空格，不入列）。 */
export interface PatternColor {
    char: string;
    color: string;
}
/** 一幅内置像素图案：grid x grid 字符画 + 颜色表。 */
export interface PatternDef {
    id: string;
    name: string;
    grid: number;
    rows: string[];
    colors: PatternColor[];
}
/** 网格坐标：列 x、行 y，均从 0 起。 */
export interface Cell {
    x: number;
    y: number;
}
/** 一关内容：选定的图案、展平的参考图（-1 空、否则颜色下标）、打乱后的调色板。 */
export interface PainterLevel {
    pattern: PatternDef;
    reference: number[];
    palette: number[];
}
/** 比对结果。 */
export interface CompareResult {
    correct: number;
    wrong: number;
    total: number;
    /** 全部错格（画布与参考不一致的格子，含多涂与漏涂）。 */
    wrongCells: Cell[];
}
/** 总关卡数。 */
export declare const LEVEL_COUNT = 5;
/** 每关可用提示次数。 */
export declare const HINTS_PER_LEVEL = 2;
/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供生成与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/** 内置图案库：14 幅，尺寸 8-12，每幅 3-5 色（加空格共 4-6 色）。 */
export declare const PATTERN_LIBRARY: PatternDef[];
/**
 * 第 level 关（0 起）允许的图案边长范围：5 关从 8x8 递进到 12x12。
 * @param level - 0 起的关卡下标（0-4）。
 * @returns [最小边长, 最大边长]。
 */
export declare function levelGridRange(level: number): [number, number];
/**
 * 第 level 关可用的图案列表（边长落在该关范围内）。
 * @param level - 0 起的关卡下标。
 * @returns 图案子集（至少 2 幅）。
 */
export declare function eligiblePatterns(level: number): PatternDef[];
/**
 * 把图案字符画展平为参考图数组：-1 表示空格，否则为 colors 下标。
 * @param pattern - 图案。
 * @returns 长度 grid*grid 的颜色下标数组。
 */
export declare function referenceCells(pattern: PatternDef): number[];
/**
 * 生成第 level 关：按种子确定性选图，并把颜色下标打乱为调色板顺序。
 * @param level - 0 起的关卡下标（0-4）。
 * @param seed - 种子（同关卡同种子产出完全一致）。
 * @returns 关卡内容。
 */
export declare function buildLevel(level: number, seed: number): PainterLevel;
/**
 * 新建空画布（全部 -1）。
 * @param grid - 网格边长。
 * @returns 长度 grid*grid 的数组。
 */
export declare function createCanvas(grid: number): number[];
/**
 * 在画布一格涂色（颜色未变化时不算涂改）。
 * @param cells - 画布数组（原地修改）。
 * @param grid - 网格边长。
 * @param x - 列。
 * @param y - 行。
 * @param colorIdx - 颜色下标（-1 视为清除）。
 * @returns 发生了涂改返回 true。
 */
export declare function paintCell(cells: number[], grid: number, x: number, y: number, colorIdx: number): boolean;
/**
 * 清除画布一格（已为空时不算涂改）。
 * @param cells - 画布数组（原地修改）。
 * @param grid - 网格边长。
 * @param x - 列。
 * @param y - 行。
 * @returns 发生了清除返回 true。
 */
export declare function eraseCell(cells: number[], grid: number, x: number, y: number): boolean;
/**
 * 实时比对画布与参考图：统计涂对/涂错格数并给出全部错格。
 * @param reference - 参考图数组。
 * @param canvas - 画布数组。
 * @param grid - 网格边长。
 * @returns 比对结果。
 */
export declare function compareCells(reference: number[], canvas: number[], grid: number): CompareResult;
/**
 * 完成度百分比（涂对格数占比，四舍五入到整数）。
 * @param result - 比对结果。
 * @returns 0-100。
 */
export declare function completionPct(result: CompareResult): number;
/**
 * 过关判定：全格一致。
 * @param result - 比对结果。
 * @returns 无错格返回 true。
 */
export declare function isSolved(result: CompareResult): boolean;
/**
 * 提示：把第一个错格自动修正为参考值（原地修改画布，不计步数）。
 * @param reference - 参考图数组。
 * @param canvas - 画布数组（原地修改）。
 * @param grid - 网格边长。
 * @returns 被修正的格子，已无错格时返回 null。
 */
export declare function applyHint(reference: number[], canvas: number[], grid: number): Cell | null;
/**
 * 过关计分：基础分随关卡上升，步数（涂改次数）与已用提示扣分，下限 100。
 * @param level - 1 起的关卡序号。
 * @param steps - 本关涂改步数。
 * @param hintsUsed - 已用提示次数。
 * @returns 得分。
 */
export declare function computeScore(level: number, steps: number, hintsUsed: number): number;
