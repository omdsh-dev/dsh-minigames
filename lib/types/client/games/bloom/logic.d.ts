/**
 * 开花连消 Bloom 纯逻辑：8×8 花田、同色四邻连锁绽放、石头格阻挡、
 * 限定点击数内全田开花、计分（每次连锁规模 × 连锁规模）。所有随机都
 * 来自注入 seed 的 mulberry32，同一 (关卡, seed) 生成完全一致的盘面，
 * 纯函数可测、可重放。
 *
 * 连锁规则：点击一个花苞，它与其四邻同色花苞组成第 0 波「开放组」；
 * 此后任何已绽放的花（开局已开、此前点击开出的都算）都会把它四邻中
 * 与本次新绽放同色的花苞卷入下一波，逐层递归扩散（涟漪）。因此先开
 * 出的每朵花都是后续连锁的放大器——点击顺序决定连锁规模。
 */
/** 网格边长（8×8）。 */
export declare const GRID = 8;
/** 格子总数。 */
export declare const CELLS: number;
/** 关卡数。 */
export declare const LEVEL_COUNT = 5;
/** 一格：花苞（未开）、已绽放的花、石头（不可开花、不传导）。 */
export type Cell = {
    kind: 'bud';
    color: number;
} | {
    kind: 'bloom';
    color: number;
} | {
    kind: 'stone';
    color: number;
};
/** 关卡参数：颜色数、开局已开的花数、石头数、点击预算冗余。 */
export interface LevelConfig {
    /** 花苞颜色种数。 */
    colors: number;
    /** 开局已绽放的花的数量（连锁放大器）。 */
    preBloomed: number;
    /** 石头格数量。 */
    stones: number;
    /** 点击预算 = 贪心解点击数 + slack（高关卡收紧到 0）。 */
    slack: number;
}
/** 五关：颜色更多、石头更多、点击更紧。 */
export declare const LEVELS: readonly LevelConfig[];
/** 对局状态（纯数据，可整体拷贝重放）。 */
export interface BloomState {
    /** 关卡号（1..LEVEL_COUNT）。 */
    level: number;
    /** 盘面（长度 64，行主序）。 */
    grid: Cell[];
    /** 已用点击数。 */
    clicksUsed: number;
    /** 剩余点击数。 */
    clicksLeft: number;
    /** 累计得分。 */
    score: number;
    /** 进行中 / 已过关（全田绽放）/ 已失败（点击用尽仍有花苞）。 */
    status: 'playing' | 'won' | 'lost';
}
/** 连锁中的一步：哪格在哪一波绽放（涟漪动画与统计共用）。 */
export interface ChainStep {
    /** 格子下标（行主序）。 */
    index: number;
    /** 波次：0 = 点击的开放组，越大越晚。 */
    layer: number;
}
/** 一次点击的结果。 */
export interface ClickResult {
    /** 连锁步骤（按波次顺序）。 */
    steps: ChainStep[];
    /** 连锁规模（本次新开花朵数，含被点花苞）。 */
    chainSize: number;
    /** 本次得分 = chainSize × chainSize。 */
    gained: number;
    /** 是否达成全田绽放。 */
    won: boolean;
    /** 是否因点击用尽而失败。 */
    lost: boolean;
}
/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 任意 32 位整数。
 * @returns 返回 [0, 1) 随机数的函数；同 seed 序列完全一致。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 某格的四邻下标（不越界；石头/异色只是不传导，邻接关系本身存在）。
 * @param index - 格子下标（行主序）。
 * @returns 四邻下标数组（顺序：上、下、左、右）。
 */
export declare function neighborsOf(index: number): number[];
/**
 * 纯函数：从某花苞出发的一次连锁（不改盘面）。
 * 第 0 波 = 点击的花苞与其四邻同色花苞；此后每波把「与任一已绽放花
 * 四邻相邻且同本次颜色的花苞」卷入——开局已开与此前点击开出的花都是
 * 连锁源，故连锁规模随已开网络增长。
 * @param grid - 盘面。
 * @param index - 点击的花苞下标。
 * @returns 连锁步骤（按波次）；点击非花苞返回空数组。
 */
export declare function computeChain(grid: Cell[], index: number): ChainStep[];
/**
 * 把连锁步骤落到盘面（花苞 → 已绽放，颜色保留）。
 * @param grid - 盘面（就地修改）。
 * @param steps - computeChain 的结果。
 */
export declare function applyChain(grid: Cell[], steps: ChainStep[]): void;
/**
 * 剩余花苞数。
 * @param grid - 盘面。
 * @returns 未开花苞数量。
 */
export declare function countBuds(grid: Cell[]): number;
/**
 * 是否全田绽放（无花苞）。
 * @param grid - 盘面。
 */
export declare function isCleared(grid: Cell[]): boolean;
/**
 * 执行一次点击：连锁绽放、计分（连锁²）、扣点击、判定胜负。
 * @param state - 对局状态（就地修改）。
 * @param index - 点击的花苞下标。
 * @returns 点击结果；对局已结束或点击非花苞时返回 null（状态不变）。
 */
export declare function clickCell(state: BloomState, index: number): ClickResult | null;
/** 贪心求解结果。 */
export interface GreedySolve {
    /** 清空花田所需的点击数。 */
    clicks: number;
    /** 按此顺序点击的总得分。 */
    score: number;
    /** 点击下标序列（每步选当前连锁最大的花苞，平局取最小下标）。 */
    path: number[];
}
/**
 * 贪心求解：每步点当前连锁规模最大的花苞直到全田绽放。确定性（平局
 * 取最小下标），用于生成器推导点击预算并保证可解性。
 * @param state - 对局状态（只读，求解在拷贝上进行）。
 * @returns 点击数、总分与点击序列。
 */
export declare function solveGreedy(state: BloomState): GreedySolve;
/**
 * 用手工盘面构造对局（测试与教学场景；不做生成与预算推导）。
 * @param level - 关卡号（仅展示用，不校验范围）。
 * @param grid - 长度必须为 GRID*GRID 的盘面。
 * @param clicksLeft - 初始剩余点击数。
 * @returns 初始对局状态。
 */
export declare function createState(level: number, grid: Cell[], clicksLeft: number): BloomState;
/**
 * 生成一关盘面：石头格、开局已开的花、随机颜色花苞；点击预算 =
 * 贪心解点击数 + 关卡 slack（贪心解必可清场，故预算内必可过关）。
 * @param level - 关卡号（1..LEVEL_COUNT）。
 * @param seed - 随机种子。
 * @returns 初始对局状态；关卡号越界返回 null。
 */
export declare function generateBoard(level: number, seed: number): BloomState | null;
