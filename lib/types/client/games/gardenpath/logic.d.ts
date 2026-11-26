/**
 * 花径寻踪 GardenPath 纯逻辑：数字约束种植谜题（独立支配集谜题）。盘面
 * 三种格——空地（可种花或留草）、岩石（不可种）、数字提示格（不可种；
 * 数字 N 表示其上下左右四邻中恰有 N 朵花）。一个合法整体解满足四条
 * 约束：①每条提示的四邻花数精确匹配；②任意两朵花八向不相邻（横竖斜
 * 都算）；③岩石与提示格不可种；④覆盖（花径）：每块留草的空地必须
 * 紧挨着至少一朵花（八向），花要「铺满」整座花园的路径。
 *
 * 生成器先随机铺岩石与一版随机完整解（贪心独立支配集），再随机放 6-8
 * 个初始提示，随后「定向挖洞」：求解器给出两个不同解，找一个能把两个
 * 解区分开的提示格（四邻花数在两解下不同）钉上去，重复到全盘恰有唯一
 * 解。求解器带三条传播规则（花逼邻草、唯一掩护格逼花、提示精确计数逼
 * 迫），大至 12×12 也是毫秒级。一切随机走注入 seed 的 mulberry32，同
 * seed 必然得到同一张盘，确定性可测。
 */
/** 五个关卡的盘面边长（8×8 → 12×12）。 */
export declare const LEVEL_SIZES: readonly [8, 9, 10, 11, 12];
/** 关卡总数。 */
export declare const LEVEL_COUNT: 5;
/** 空地标记（可种花，也可留草）。 */
export declare const CELL_EMPTY = 0;
/** 岩石标记（不可种）。 */
export declare const CELL_ROCK = 1;
/** 数字提示格标记（不可种）。 */
export declare const CELL_CLUE = 2;
/** 玩家标记：留草。 */
export declare const MARK_GRASS = 0;
/** 玩家标记：花。 */
export declare const MARK_FLOWER = 1;
/** 一张花径盘面。 */
export interface GardenPathPuzzle {
    /** 盘面边长（格）。 */
    size: number;
    /** 每格种类：CELL_EMPTY / CELL_ROCK / CELL_CLUE。 */
    cells: Uint8Array;
    /** 提示数字：仅 CELL_CLUE 格有效（0-4），其余为 -1。 */
    clueNumbers: Int8Array;
    /** 生成时的唯一完整解：1 = 该空地是花，其余为 0。 */
    solution: Uint8Array;
}
/** mulberry32 伪随机数发生器：小而快，同 seed 序列确定。 */
export declare function mulberry32(seed: number): () => number;
/**
 * 1 基关卡对应的盘面边长（超过关卡总数后循环）。
 * @param level - 1 基关卡号。
 * @returns 该关的盘面边长。
 */
export declare function levelSize(level: number): number;
/**
 * 两格是否八向相邻（横竖斜都算）。
 * @param size - 盘面边长。
 * @param a - 第一格。
 * @param b - 第二格。
 */
export declare function flowersAdjacent(size: number, a: number, b: number): boolean;
/** 求解结果：完整解列表（封顶于 cap）与是否因节点预算耗尽提前放弃。 */
export interface SolveResult {
    /** 找到的完整解（每格 1=花 / 0=草）。 */
    solutions: Uint8Array[];
    exhausted: boolean;
}
/**
 * 传播式回溯求解器：数一盘面在四约束下的完整解。三条传播规则——
 * A 花逼邻草（八向邻格若未定则定为草）；B 唯一掩护（留草格仅剩一个
 * 未定掩护格时它必是花）；C 提示精确计数（差值=0 逼草 / 差值=余量逼
 * 花）。分支选掩护最紧（pot 最小、邻提示最多）的未定格，花先草后。
 * @param size - 盘面边长。
 * @param cells - 格种类数组。
 * @param clueNumbers - 提示数字数组。
 * @param cap - 数到该解数即停（唯一性验证用 2）。
 * @param nodeBudget - 最大分支节点数，超出置 exhausted。
 * @returns 完整解列表（≤ cap）与 exhausted 标志。
 */
export declare function solveBoard(size: number, cells: Uint8Array, clueNumbers: Int8Array, cap?: number, nodeBudget?: number): SolveResult;
/**
 * 数一盘面的完整解数（封顶 cap，通常传 2 做唯一性验证）。
 * @returns 解数与 exhausted 标志。
 */
export declare function countSolutions(size: number, cells: Uint8Array, clueNumbers: Int8Array, cap?: number, nodeBudget?: number): {
    solutions: number;
    exhausted: boolean;
};
/**
 * 从 seed 确定性生成某一关的盘面（唯一解保证）。
 * @param seed - 注入的随机种子。
 * @param level - 1 基关卡号。
 * @returns 盘面；内部最多重试 60 次，全部失败才返回 null（实践中不会发生）。
 */
export declare function puzzleFromSeed(seed: number, level: number): GardenPathPuzzle | null;
/**
 * 某提示格四邻中当前的花数。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @param cell - 提示格。
 */
export declare function clueFlowerCount(puzzle: GardenPathPuzzle, marks: Uint8Array, cell: number): number;
/**
 * 当前与数字不符的提示格（红显反馈用；含不足与超额）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @returns 不符的提示格下标列表。
 */
export declare function unsatisfiedClues(puzzle: GardenPathPuzzle, marks: Uint8Array): number[];
/**
 * 八向相邻的花格（双方都列出，红圈反馈用）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @returns 存在相邻花的格下标列表。
 */
export declare function adjacencyConflicts(puzzle: GardenPathPuzzle, marks: Uint8Array): number[];
/**
 * 未被花覆盖的空地（既非花、八向也无花；进度与过关判定用）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @returns 未覆盖空地下标列表。
 */
export declare function uncoveredCells(puzzle: GardenPathPuzzle, marks: Uint8Array): number[];
/**
 * 该格是否可种（空地）。
 * @param puzzle - 盘面。
 * @param cell - 格下标。
 */
export declare function canPlant(puzzle: GardenPathPuzzle, cell: number): boolean;
/**
 * 点击循环：空地在花与草之间切换。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记（原地修改）。
 * @param cell - 格下标。
 * @returns 是否真的切换了（岩石/提示格返回 false）。
 */
export declare function toggleMark(puzzle: GardenPathPuzzle, marks: Uint8Array, cell: number): boolean;
/**
 * 过关判定：玩家整体标记满足全部四条约束（提示精确、花八向不邻、花只
 * 在空地、每块草都被花覆盖）。由唯一解保证，满足即与生成解完全一致。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 */
export declare function isWon(puzzle: GardenPathPuzzle, marks: Uint8Array): boolean;
/**
 * 提示：挑一个与正解不一致的空格（优先挨着不符提示的），返回该格；
 * 标记已与正解一致时返回 -1。确定顺序，可测。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 */
export declare function hintCell(puzzle: GardenPathPuzzle, marks: Uint8Array): number;
/**
 * 过关分数：关卡底分 + 时间奖励（每秒衰减）- 提示罚分，下限 50。
 * @param level - 1 基关卡号。
 * @param seconds - 用时（秒）。
 * @param hints - 已用提示次数（0-2）。
 */
export declare function computeScore(level: number, seconds: number, hints: number): number;
