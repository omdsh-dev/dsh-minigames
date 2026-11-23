/**
 * 青蛙过河（FrogSwap）纯逻辑：经典青蛙互换谜题（Frog Leap）。一排
 * 2f+1 个荷叶位，左半 f 只绿蛙朝右、中间空位、右半 f 只黄蛙朝左；绿蛙
 * 只能向右、黄蛙只能向左，每步滑入相邻空位或跳过恰好一只异色蛙落入
 * 其后的空位，不可跳两只、不可后退，目标是两侧青蛙完全互换。逻辑与
 * 渲染完全解耦：随机数全部来自注入种子的 mulberry32，装饰数据确定
 * 性可测；种子只影响水波纹相位等装饰，不影响谜题本身。
 */
/** 荷叶位内容：绿蛙（朝右）/ 黄蛙（朝左）/ 空。 */
export type CellValue = 'G' | 'Y' | null;
/** 一局青蛙过河的全部可测状态。 */
export interface FrogSwapState {
    /** 荷叶位数组，长度 2f+1。 */
    cells: CellValue[];
    /** 每侧青蛙数 f（关卡 2..6）。 */
    frogCount: number;
    /** 关卡序号 1..5（f = level + 1）。 */
    level: number;
    /** 已用步数。 */
    moves: number;
    /** 撤销栈：每步记录 {from, to}。 */
    history: {
        from: number;
        to: number;
    }[];
    /** 是否达成互换。 */
    won: boolean;
    /** 装饰随机序列（水波纹相位等，仅渲染用）。 */
    deco: number[];
}
/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 32 位无符号种子。
 * @returns 返回 [0,1) 随机数的函数，同种子序列完全一致。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 构造一局：左 f 绿、中间空、右 f 黄。
 * @param level - 关卡序号 1..5（每侧青蛙数 f = level + 1）。
 * @param seed - 注入种子，只驱动装饰随机序列。
 * @returns 初始状态（步数 0、未胜利）。
 */
export declare function createFrogSwap(level: number, seed: number): FrogSwapState;
/**
 * 一步的类别：滑入相邻空位 / 跳过一只异色蛙 / 不合法。
 * @param cells - 荷叶位数组。
 * @param from - 起点下标。
 * @param to - 终点下标。
 * @returns 'slide'、'hop' 或 null（不合法）。
 */
export declare function moveKind(cells: CellValue[], from: number, to: number): 'slide' | 'hop' | null;
/**
 * 一只蛙的全部合法终点（按从小到大排序）。
 * @param state - 当前状态。
 * @param from - 起点下标。
 * @returns 合法终点下标数组（最多 2 个：滑 + 跳）。
 */
export declare function legalTargets(state: FrogSwapState, from: number): number[];
/**
 * 是否存在任何可动蛙（死局检测：无可动蛙且未达成互换时提示撤销）。
 * @param state - 当前状态。
 * @returns true 表示至少还有一步合法着法。
 */
export declare function canAnyMove(state: FrogSwapState): boolean;
/**
 * 死局：未胜利且无任何合法着法。
 * @param state - 当前状态。
 * @returns true 表示陷入死局（需要撤销）。
 */
export declare function isDeadlocked(state: FrogSwapState): boolean;
/**
 * 是否达成互换：左半全黄、右半全绿（中间必为空）。
 * @param state - 当前状态。
 * @returns true 表示两侧青蛙已完全互换。
 */
export declare function isSolved(state: FrogSwapState): boolean;
/**
 * 执行一步（就地修改）：合法则移动青蛙、压入撤销栈、更新胜利标记。
 * @param state - 当前状态。
 * @param from - 起点下标。
 * @param to - 终点下标。
 * @returns 合法返回 true；不合法不改动并返回 false。
 */
export declare function applyMove(state: FrogSwapState, from: number, to: number): boolean;
/**
 * 撤销最后一步（就地修改）。
 * @param state - 当前状态。
 * @returns 有步可撤返回 true；步数为 0 返回 false。
 */
export declare function undoMove(state: FrogSwapState): boolean;
/**
 * 最优步数闭式：每侧 f 只蛙时为 f*(f+2)（f=2→8、f=3→15、f=4→24、
 * f=5→35、f=6→48）。与 BFS 对拍见测试。
 * @param f - 每侧青蛙数。
 * @returns 最少步数。
 */
export declare function optimalMoveCount(f: number): number;
/**
 * BFS 求给定局面的最少步数（测试对拍与死局佐证用；f≤6 状态空间
 * C(2f+1, f)·C(f+1, f) 最多约 13.5 万，毫秒级）。
 * @param cells - 荷叶位数组。
 * @returns 到达成互换的最少步数；无解返回 -1。
 */
export declare function bfsOptimal(cells: CellValue[]): number;
/**
 * 效率百分比：最优步数 / 已用步数（封顶 100）。
 * @param optimal - 最优步数。
 * @param moves - 已用步数。
 * @returns 0..100 的整数百分比。
 */
export declare function efficiency(optimal: number, moves: number): number;
