/**
 * 装箱谜题 BinPack 纯逻辑：一维装箱优化谜题的核心规则与求解器。
 * 每关由生成器「先构造装箱、再打乱」产出物品，保证恰好用最优箱数装完
 * 一定可行；玩家点击物品、点击箱子放入或取出，任意时刻箱内体积和不得
 * 超过容量。全部随机走注入 seed 的 mulberry32，不含任何 DOM / canvas
 * 依赖，可直接单测。
 */
/** mulberry32 伪随机数发生器：小而快，同 seed 序列确定。 */
export declare function mulberry32(seed: number): () => number;
/** 一关的固定参数：容量、构造用箱数、每箱物品数。 */
export interface BinPackLevelConfig {
    /** 单箱容量 C。 */
    capacity: number;
    /** 构造装箱使用的箱数（即最优箱数）。 */
    bins: number;
    /** 每箱构造出的物品个数（体积 1-9）。 */
    perBin: number;
}
/** 五关递进：物品更多、容量更紧。 */
export declare const LEVELS: readonly BinPackLevelConfig[];
/** 关卡总数。 */
export declare const LEVEL_COUNT: number;
/** 生成出来的一关：物品体积列表 + 元信息。 */
export interface BinPackLevel {
    /** 1 起的关卡号。 */
    level: number;
    /** 单箱容量。 */
    capacity: number;
    /** 最优（构造）箱数。 */
    optimal: number;
    /** 物品体积列表（已打乱，体积 1-9）。 */
    items: number[];
}
/**
 * 生成一关：每箱按 randomSplit 构造恰好装满的装箱，再整体 Fisher-Yates
 * 打乱。因为总体积 = bins * capacity，任何装法的箱数 ≥ ceil(总体积 / C)
 * = bins，而构造解恰好用 bins 个箱，故 optimal = bins 一定可达成。
 * @param level - 1 起的关卡号（1-5）。
 * @param seedOverride - 覆盖默认种子（测试 / 重放用）。
 * @returns 关卡数据；level 越界返回 null。
 */
export declare function generateLevel(level: number, seedOverride?: number): BinPackLevel | null;
/** 对局状态：物品归属（-1 = 未放入），箱位固定 optimal + 2 个。 */
export interface BinPackState {
    /** 所属关卡。 */
    level: BinPackLevel;
    /** 每个物品当前所在箱；-1 表示还在待装区。 */
    binOf: number[];
    /** 可见箱总数（含空箱）。 */
    binCount: number;
    /** 当前选中的物品下标；-1 表示未选中。 */
    selected: number;
    /** 已用的步数（放入 / 取出各计 1 步）。 */
    steps: number;
}
/**
 * 由关卡创建对局状态。
 * @param level - 生成好的关卡。
 * @returns 全部物品待装、未选中、0 步的初始状态。
 */
export declare function createState(level: BinPackLevel): BinPackState;
/**
 * 某个箱当前装载的体积和。
 * @param state - 对局状态。
 * @param bin - 箱下标。
 * @returns 该箱体积和。
 */
export declare function binLoad(state: BinPackState, bin: number): number;
/**
 * 物品能否放入目标箱（不超容量，且物品确实不在该箱里）。
 * @param state - 对局状态。
 * @param item - 物品下标。
 * @param bin - 目标箱下标。
 * @returns 合法返回 true。
 */
export declare function canPlace(state: BinPackState, item: number, bin: number): boolean;
/**
 * 把物品放入目标箱（含从一个箱挪到另一个箱）；非法放置直接忽略。
 * @param state - 对局状态（就地修改）。
 * @param item - 物品下标。
 * @param bin - 目标箱下标。
 */
export declare function placeItem(state: BinPackState, item: number, bin: number): void;
/**
 * 把已放入的物品取出回待装区。
 * @param state - 对局状态（就地修改）。
 * @param item - 物品下标。
 */
export declare function takeOut(state: BinPackState, item: number): void;
/**
 * 当前实际用到的箱数（至少有一个物品的箱）。
 * @param state - 对局状态。
 * @returns 已用箱数。
 */
export declare function usedBins(state: BinPackState): number;
/**
 * 是否所有物品都已装箱。
 * @param state - 对局状态。
 * @returns 全部装完返回 true。
 */
export declare function allPlaced(state: BinPackState): boolean;
/**
 * 过关判定：全部装完且用箱数 ≤ 最优。
 * @param state - 对局状态。
 * @returns 过关返回 true。
 */
export declare function isWon(state: BinPackState): boolean;
/**
 * FFD（首次适应递减）启发式装箱。
 * @param sizes - 物品体积列表。
 * @param capacity - 容量。
 * @returns FFD 使用的箱数（恒 ≥ 最优）。
 */
export declare function ffd(sizes: number[], capacity: number): number;
/**
 * 精确最优装箱数（子集 DP，n ≤ 20 可承受；f[mask] = 最少箱数 + 末箱最小
 * 余量，按字典序取最小）。
 * @param sizes - 物品体积列表（长度 ≤ 20）。
 * @param capacity - 容量。
 * @returns 精确最优箱数；物品为空返回 0。
 */
export declare function exactBins(sizes: number[], capacity: number): number;
/**
 * 过关得分：关数为主、步数为辅（放入取出都计步，步数越少分越高）。
 * @param level - 1 起的关卡号。
 * @param steps - 总步数。
 * @returns 得分（> 0）。
 */
export declare function computeScore(level: number, steps: number): number;
