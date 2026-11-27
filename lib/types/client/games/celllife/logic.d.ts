/**
 * 生命播种 CellLife 纯逻辑：Conway 生命游戏（B3/S23）反向求解谜题。
 * 8x8 盘面、中心 NxN 起始区摆细胞、空格逐步进化；目标是恰好 K 步后
 * 的图案与目标图案完全一致（不多不少）。关卡由注入的 mulberry32 种子
 * 确定性生成：先在起始区随机摆出起始图案，正向演化 K 步取快照作为
 * 目标——生成器构造上天然可解（起始图案本身就是一份解）。无 DOM、
 * 无副作用，全部函数可直接在 vitest 中验证。
 */
/** 网格单元：列 x、行 y，均从 0 起。 */
export interface Cell {
    x: number;
    y: number;
}
/** 盘面：GRID*GRID 个格子的存活标志（下标 y*GRID+x），盘外视为死亡。 */
export type Board = boolean[];
/** 盘面边长（8x8）。 */
export declare const GRID = 8;
/** 总关卡数。 */
export declare const LEVEL_COUNT = 5;
/** 一关的生成结果：步数预算、起始区、目标图案与一份已知解。 */
export interface LevelData {
    /** 0 起的关卡下标。 */
    level: number;
    /** 进化步数预算 K（恰好 K 步后须等于目标）。 */
    steps: number;
    /** 起始区边长 N（中心 NxN）。 */
    zone: number;
    /** 起始区左上角单元。 */
    zoneOrigin: Cell;
    /** 目标图案（K 步后应出现的细胞集合）。 */
    target: Cell[];
    /** 一份已知解：摆这些细胞并进化 K 步即达到目标（全部位于起始区内）。 */
    solution: Cell[];
}
/** 游戏进行态（index 层持有，逻辑层提供操作函数）。 */
export interface GameState {
    /** 当前关卡数据。 */
    data: LevelData;
    /** 当前盘面。 */
    board: Board;
    /** 已执行的进化步数。 */
    steps: number;
    /** 本关重摆次数（计分用）。 */
    resets: number;
    /** play 进行中 / won 恰好 K 步达成 / failed 步数用尽未达成。 */
    phase: 'play' | 'won' | 'failed';
}
/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供生成与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 单元转下标。
 * @param c - 网格单元。
 * @returns y*GRID+x。
 */
export declare function cellIndex(c: Cell): number;
/**
 * 某格的存活邻居数（8 邻域，盘外一律按死亡计）。
 * @param board - 盘面。
 * @param x - 列。
 * @param y - 行。
 * @returns 0-8。
 */
export declare function neighborCount(board: Board, x: number, y: number): number;
/**
 * Conway 生命游戏一步演化（B3/S23：恰好 3 邻居出生，2 或 3 邻居存活）。
 * 盘外视为死亡，演化不会越界扩散。
 * @param board - 当前盘面。
 * @returns 新盘面（新数组，入参不变）。
 */
export declare function evolveStep(board: Board): Board;
/**
 * 两个盘面是否逐格一致。
 * @param a - 盘面一。
 * @param b - 盘面二。
 * @returns 一致返回 true。
 */
export declare function boardsEqual(a: Board, b: Board): boolean;
/**
 * 细胞集合转盘面（越界忽略，重复合并）。
 * @param cells - 细胞集合。
 * @returns 盘面。
 */
export declare function cellsToBoard(cells: Cell[]): Board;
/**
 * 盘面转细胞集合（按 (y,x) 字典序）。
 * @param board - 盘面。
 * @returns 存活细胞列表。
 */
export declare function boardToCells(board: Board): Cell[];
/**
 * 单元是否位于本关起始区（中心 NxN）内。
 * @param data - 关卡数据。
 * @param c - 待测单元。
 * @returns 区内返回 true。
 */
export declare function inZone(data: LevelData, c: Cell): boolean;
/**
 * 生成一关：反复在起始区抽随机起始图案、正向演化 K 步，取目标细胞数
 * 落在规格区间内的快照为目标。快照本身就是正向演化的结果，因此关卡
 * 天然可解（起始图案即一份解）；重试只影响目标观感，不影响可解性。
 * 超过重试上限时接受最后一次尝试（可解性仍然成立）。
 * @param level - 0 起的关卡下标（0-4）。
 * @param seed - 种子。
 * @returns 关卡数据。
 */
export declare function buildLevel(level: number, seed: number): LevelData;
/**
 * 开局（或进入新关）：空盘面、0 步、进行中。重摆次数沿用入参（跨关
 * 清零、同关重摆累加由调用方决定）。
 * @param data - 关卡数据。
 * @param resets - 初始重摆次数（一般传 0）。
 * @returns 初始游戏状态。
 */
export declare function newGame(data: LevelData, resets?: number): GameState;
/**
 * 摆放阶段（尚未进化）内切换一个细胞的生死。仅当进行中、未进化过且
 * 单元位于起始区内时生效。
 * @param state - 游戏状态。
 * @param c - 目标单元。
 * @returns 切换成功返回 true。
 */
export declare function toggleCell(state: GameState, c: Cell): boolean;
/**
 * 重摆：清空盘面回到摆放阶段（目标与步数预算不变）。
 * @param state - 游戏状态（原地修改）。
 */
export declare function resetPlacement(state: GameState): void;
/**
 * 进化一步：推进盘面并计步。恰好用完 K 步时判定胜负——等于目标为
 * won，否则 failed；未到 K 步不判定（提前长得像也不算，必须不多不少）。
 * @param state - 游戏状态（原地修改）。
 * @returns 本步结果：'evolved' 仍在进行、'won' 达成、'failed' 用尽未达成。
 */
export declare function evolveOnce(state: GameState): 'evolved' | 'won' | 'failed';
/**
 * 预览（T 键）：当前盘面再进化一步的结果，不改动状态。
 * @param state - 游戏状态。
 * @returns 预览盘面。
 */
export declare function previewNext(state: GameState): Board;
/**
 * 过关计分：基础分随关卡上升，重摆次数扣分，下限 100。
 * @param level - 1 起的关卡序号。
 * @param resets - 本关重摆次数。
 * @returns 得分。
 */
export declare function computeScore(level: number, resets: number): number;
