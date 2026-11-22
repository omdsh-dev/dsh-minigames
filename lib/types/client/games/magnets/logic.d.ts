/**
 * 磁极谜题（Magnets，Nikoli）纯逻辑：矩形盘面被划分为若干双格磁铁
 * 多米诺与少量单格绝缘块；每块磁铁必为一端 +、一端 -，同极 orth 相邻
 * 禁止，每行 / 列的 + 与 - 数量须与四周提示完全一致。生成器基于注入
 * seed 的 mulberry32：随机多米诺划分 → 随机化回溯搜一组合法极性 →
 * 推导行列提示 → 带剪枝的计数求解器验证唯一解（数到 2 即剪枝）。
 * 全部函数确定性可测，无 DOM、无随机外泄。
 */
/** 玩家标注：0 空、1 正极、2 负极、3 中性（绝缘推测）。 */
export type Mark = 0 | 1 | 2 | 3;
export declare const EMPTY = 0;
export declare const PLUS = 1;
export declare const MINUS = 2;
export declare const NEUTRAL = 3;
/** 关卡总数（尺寸 6×6 → 10×10 递进）。 */
export declare const LEVEL_COUNT = 5;
/** 一道生成完毕的谜题；solution 为唯一解（1 正 / 2 负，绝缘块 0）。 */
export interface MagnetsPuzzle {
    size: number;
    /** 同一多米诺的另一半格；绝缘块为 -1。 */
    partner: number[];
    /** 固定单格绝缘块（不可交互、无极性）。 */
    insulator: boolean[];
    rowPlus: number[];
    rowMinus: number[];
    colPlus: number[];
    colMinus: number[];
    solution: number[];
}
/** 注入式确定性随机源（mulberry32）。 */
export declare function mulberry32(seed: number): () => number;
/** 关卡（1 起）对应的盘面边长。 */
export declare function levelSize(level: number): number;
/** cell 的上下左右邻居（界内）。 */
export declare function orthNeighbors(size: number, cell: number): number[];
/** 多米诺划分结果：partner 对 + 绝缘块标记。 */
export interface Tiling {
    partner: number[];
    insulator: boolean[];
}
/**
 * 随机划分盘面：未分配格随机与一个未分配邻居配对，或按概率成为单格
 * 绝缘块（无邻居可配时也落绝缘）。
 * @param rng - 注入随机源。
 * @param size - 盘面边长。
 * @param insulatorChance - 单格绝缘概率（0-1）。
 */
export declare function dominoTiling(rng: () => number, size: number, insulatorChance: number): Tiling;
/** 盘面上的磁铁多米诺列表（每项 [a, b]，a < b，行优先序）。 */
export declare function dominoesOf(partner: readonly number[]): [number, number][];
/** 极性数组：0 无极（绝缘 / 未置），1 正，2 负。 */
type Poles = number[];
/**
 * 随机化回溯为全部多米诺找一组合法极性（同极不相邻）；找不到返回
 * null。选项顺序与多米诺顺序均由 rng 搅动，保证同盘面可重复采样。
 */
export declare function assignPolarity(rng: () => number, size: number, partner: readonly number[]): Poles | null;
/** 解计数结果：solutions 为找到的解数（上限 limit 提前停时 exhausted 为 false）。 */
export interface SolveCount {
    solutions: number;
    exhausted: boolean;
}
/**
 * 计数求解器：多米诺两格必为一正一负，同极 orth 相邻剪枝，行列 +/-
 * 计数上界剪枝；数到 limit 个解即提前返回。
 */
export declare function solveCount(puzzle: MagnetsPuzzle, limit: number): SolveCount;
/**
 * 从 seed 生成一道唯一解谜题：反复采样划分与极性，直到解计数恰为 1；
 * 300 次尝试后放弃（返回 null）。
 * @param seed - 注入种子（同一 seed 完全可复现）。
 * @param size - 盘面边长（6-10）。
 * @param insulatorChance - 单格绝缘概率，默认 0.12。
 */
export declare function puzzleFromSeed(seed: number, size: number, insulatorChance?: number): MagnetsPuzzle | null;
/** 点击循环：空 → + → - → 中性 → 空。 */
export declare function cycleMark(mark: Mark): Mark;
/**
 * 点击一格（原位修改 marks）：绝缘块不可交互返回 null，否则返回新标注。
 */
export declare function applyClick(puzzle: MagnetsPuzzle, marks: number[], cell: number): Mark | null;
/** 行列 + / - 计数（按玩家标注）。 */
export declare function countsOf(puzzle: MagnetsPuzzle, marks: readonly number[]): {
    rowPlus: number[];
    rowMinus: number[];
    colPlus: number[];
    colMinus: number[];
};
/** 同极 orth 相邻的冲突格（去重升序）。 */
export declare function samePoleConflicts(puzzle: MagnetsPuzzle, marks: readonly number[]): number[];
/** 行 / 列某极计数超标的磁格（提示红显反馈）。 */
export declare function overflowCells(puzzle: MagnetsPuzzle, marks: readonly number[]): number[];
/** 全部冲突格并集（同极相邻 + 计数超标），供渲染红框。 */
export declare function findConflictCells(puzzle: MagnetsPuzzle, marks: readonly number[]): number[];
/** 是否获胜：磁格全为 +/-、同极不相邻、行列计数精确吻合。 */
export declare function isWon(puzzle: MagnetsPuzzle, marks: readonly number[]): boolean;
/**
 * 提示：返回第一个与唯一解不符的磁格下标（调用方据此置为解值），
 * 已全部符合时返回 -1。
 */
export declare function hintCell(puzzle: MagnetsPuzzle, marks: readonly number[]): number;
/**
 * 过关得分：基础分随关卡上升，时间（秒）与提示次数扣减，下限 100。
 */
export declare function computeScore(level: number, secs: number, hints: number): number;
export {};
