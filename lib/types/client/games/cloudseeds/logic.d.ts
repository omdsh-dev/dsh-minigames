/**
 * 云中播种 CloudSeeds 纯逻辑：风向播种谜题的核心规则——盘面生成（注入
 * seed 的 mulberry32，保证同 seed 重放一致）、恒定风矢量逐格传播积分、
 * 云层格变速（1.5×/0.5×）、落点 3×3 浇灌、种子预算与过关判负判定。
 * 渲染层与测试只依赖这里的确定性输出，不引入任何其它随机源。
 */
/** 天空格。 */
export declare const CELL_SKY = 0;
/** 加速云：种子经过时消耗预算 ×1.5（飞得更近）。 */
export declare const CELL_CLOUD_FAST = 1;
/** 减速云：种子经过时消耗预算 ×0.5（飞得更远）。 */
export declare const CELL_CLOUD_SLOW = 2;
/** 山障碍格：种子撞上即损失。 */
export declare const CELL_MOUNTAIN = 3;
/** 田地格：被浇灌的目标。 */
export declare const CELL_FIELD = 4;
/** 关卡总数（风向与布局难度递进）。 */
export declare const LEVEL_COUNT = 5;
/** 一关的完整盘面。 */
export interface CloudSeedsLevel {
    /** 关卡号（0 基）。 */
    level: number;
    /** 列数。 */
    cols: number;
    /** 行数。 */
    rows: number;
    /** 格子种类（行主序，下标 = row * cols + col）。 */
    cells: Uint8Array;
    /** 本关恒定风向量。 */
    wind: {
        dx: number;
        dy: number;
    };
    /** 飞行预算（格）。 */
    flight: number;
    /** 种子预算。 */
    seeds: number;
    /** 生成所用 seed（重放依据）。 */
    seed: number;
}
/** 一颗种子的飘行结果。 */
export type SeedOutcome = 'landed' | 'out' | 'mountain';
/** 一次飘行的完整轨迹（渲染虚线与飞行动画共用）。 */
export interface SeedFlight {
    /** 途经格（含起点格与落点/撞点）。 */
    path: number[];
    /** 落点格下标（非 landed 时为 -1）。 */
    landing: number;
    /** 结果：落地 / 出界 / 撞山。 */
    outcome: SeedOutcome;
    /** 消耗的飞行预算。 */
    spent: number;
}
/**
 * 注入式随机源（mulberry32）：同 seed 产生完全相同的 [0,1) 序列。
 * @param seed - 非负整数种子。
 * @returns 产生 [0,1) 均匀随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 格子的预算消耗倍率（进入该格时生效）。
 * @param kind - 格子种类。
 * @returns 倍率：天空 1、加速云 1.5、减速云 0.5、田地 1、山 2（山在到达前已判撞）。
 */
export declare function multiplierOf(kind: number): number;
/**
 * 该格是否可以播种（天空与云可，田地/山不可）。
 * @param kind - 格子种类。
 */
export declare function isPlantable(kind: number): boolean;
/**
 * 种子飘行模拟：从 launch 出发沿恒定风矢量逐格积分——每进入一格按其
 * 倍率消耗飞行预算，预算耗尽即落在当前格；进入山格=撞山损失，走出盘
 * 面=出界损失。
 * @param level - 盘面。
 * @param launch - 播种格下标（须为可播格）。
 * @returns 完整轨迹与结果。
 */
export declare function simulate(level: CloudSeedsLevel, launch: number): SeedFlight;
/**
 * 落点 3×3 浇灌：把落点周围切比雪夫距离 ≤1 的田地格标记为已浇灌。
 * @param level - 盘面。
 * @param watered - 已浇灌标记（行主序），就地修改。
 * @param landing - 落点格下标。
 * @returns 本次新浇灌的田地格数。
 */
export declare function irrigate(level: CloudSeedsLevel, watered: Uint8Array, landing: number): number;
/**
 * 全部田地是否都已浇灌。
 * @param level - 盘面。
 * @param watered - 已浇灌标记。
 */
export declare function isWon(level: CloudSeedsLevel, watered: Uint8Array): boolean;
/**
 * 失败判定：种子用尽且仍有未浇灌的田。
 * @param level - 盘面。
 * @param seedsLeft - 剩余种子数。
 * @param watered - 已浇灌标记。
 */
export declare function hasLost(level: CloudSeedsLevel, seedsLeft: number, watered: Uint8Array): boolean;
/**
 * 田地格总数。
 * @param level - 盘面。
 */
export declare function countFields(level: CloudSeedsLevel): number;
/**
 * 反向求解：找一个播种格，使种子恰好落在能覆盖 target（3×3）的位置。
 * 从 target 周围的候选落点沿逆风向回走，校验正向积分的首次耗尽点。
 * @param level - 盘面。
 * @param target - 目标田地格下标。
 * @returns 可行播种格下标，找不到返回 -1。
 */
export declare function findWaterableLaunch(level: CloudSeedsLevel, target: number): number;
/**
 * 贪心自动求解（生成期可解性验证与测试共用）：每轮枚举全部可播格，
 * 选模拟落点能新浇灌最多田的一颗，直到浇完。
 * @param level - 盘面。
 * @returns 播种格序列（空数组表示无解）。
 */
export declare function solveSeeds(level: CloudSeedsLevel): number[];
/**
 * 计分：关卡越深、剩余种子越多、用时越短分越高。
 * @param levelIndex - 关卡号（0 基）。
 * @param seedsLeft - 过关时剩余种子。
 * @param secs - 本关用时（秒）。
 * @returns 分数。
 */
export declare function computeScore(levelIndex: number, seedsLeft: number, secs: number): number;
/**
 * 按注入 seed 生成一关（最多 80 次布局尝试，全部失败返回 null）。
 * @param seed - 随机种子（同一 seed 重放得到完全相同的盘面）。
 * @param levelIndex - 关卡号（0 基，越界按边界钳制）。
 * @returns 盘面，或生成失败的 null。
 */
export declare function levelFromSeed(seed: number, levelIndex: number): CloudSeedsLevel | null;
/**
 * 生成一关并在失败时抛错（渲染入口用，杜绝静默降级）。
 * @param seed - 随机种子。
 * @param levelIndex - 关卡号（0 基）。
 * @returns 盘面。
 */
export declare function mustLevel(seed: number, levelIndex: number): CloudSeedsLevel;
