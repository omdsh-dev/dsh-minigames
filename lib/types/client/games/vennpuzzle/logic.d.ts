/**
 * 韦恩图谜题（VennPuzzle）纯逻辑：谓词库、圆几何、区域掩码、关卡生成
 * 与放置判定。一个数字的合法位置由它的「满足掩码」唯一决定——恰好满足
 * 该区域所属的全部圆谓词、且不满足其余圆谓词（圆外 = 全不满足）。所有
 * 随机经注入的 mulberry32(seed) 驱动，同 seed 重放一致，判定全部为
 * 纯函数，可脱离 DOM 测试。
 */
/** 确定性伪随机数生成器（同 seed 序列一致，供测试重放）。
 * @param seed - 32 位非负整数种子。
 * @returns 返回 [0,1) 均匀浮点的随机函数。
 */
export declare function mulberry32(seed: number): () => number;
/** 区域谓词：一个数字是否属于某个圆。 */
export interface Predicate {
    /** 稳定 id（测试与去重用）。 */
    id: string;
    /** 展示给玩家的中文标签，如「偶数」。 */
    label: string;
    /** 谓词求值。 */
    test: (n: number) => boolean;
}
/** 谓词库：生成器从中不重复抽取，每关每个圆一条。 */
export declare const PREDICATES: Predicate[];
/** 按 id 查谓词。 @param id - 谓词 id。 @returns 谓词或 undefined。 */
export declare function predicateById(id: string): Predicate | undefined;
/** 一个圆的逻辑几何（与渲染共用，保证命中测试一致）。 */
export interface Circle {
    x: number;
    y: number;
    r: number;
}
/** 各关卡数的圆几何（纯数据，逻辑命中测试与渲染共用）。
 * @param circleCount - 圆数量（2 或 3）。
 * @returns 圆数组（从左到右）。
 */
export declare function circlesFor(circleCount: 2 | 3): Circle[];
/** 求点落在哪些圆内（区域掩码：bit i = 在第 i 个圆内）。
 * @param x - 逻辑坐标 x。 @param y - 逻辑坐标 y。 @param circles - 圆数组。
 * @returns 区域掩码。
 */
export declare function maskAtPoint(x: number, y: number, circles: Circle[]): number;
/** 该圆数下存在的区域掩码集合：2 圆 = 4 区；3 圆链式去掉 {A,C} 与
 * {A,B,C} 两个几何不存在的掩码 = 6 区。
 * @param circleCount - 圆数量。
 * @returns 升序掩码数组。
 */
export declare function allowedMasks(circleCount: 2 | 3): number[];
/** 数字的满足掩码：bit i = 满足第 i 个圆的谓词。
 * @param n - 数字。 @param predicates - 与圆平行的谓词数组。
 * @returns 满足掩码。
 */
export declare function maskOf(n: number, predicates: Predicate[]): number;
/** 关卡总数。 */
export declare const LEVEL_COUNT = 5;
/** 抽数字的正整数全集上界（1..UNIVERSE_MAX）。 */
export declare const UNIVERSE_MAX = 60;
/** 每关数字卡数量（干扰随关数增多）。 */
export declare const LEVEL_CARD_COUNTS: number[];
/** 每关限时毫秒（null = 不限时；第 4/5 关限时收紧）。 */
export declare const LEVEL_TIME_LIMITS: Array<number | null>;
/** 过关动画停留毫秒。 */
export declare const CLEAR_MS = 1100;
/** 过关基础分。 */
export declare const CLEAR_BASE = 1000;
/** 每次错放扣分。 */
export declare const WRONG_PENALTY = 50;
/** 单关保底分。 */
export declare const CLEAR_MIN = 200;
/** 限时关每剩余秒加分上限。 */
export declare const TIME_BONUS_MAX = 300;
/** 一关的静态配置（生成后不变，可整关比对重放）。 */
export interface LevelSpec {
    /** 关号（1 起）。 */
    level: number;
    /** 圆数量。 */
    circleCount: 2 | 3;
    /** 与圆平行的谓词（圆 i 的标签 = predicates[i]）。 */
    predicates: Predicate[];
    /** 数字卡池（未放置的全部数字，生成顺序即展示顺序）。 */
    pool: number[];
    /** 限时毫秒，null = 不限时。 */
    timeLimitMs: number | null;
}
/** 生成一关：随机取谓词 + 从全集抽数字，保证每个允许区域都至少有
 * 1 张可放的卡（干扰数字 = 掩码「看似接近实则不同」的数字）。
 * @param rng - 随机源（消耗顺序确定）。
 * @param level - 关号（1 起，决定圆数/卡数/限时）。
 * @returns 关卡配置。
 */
export declare function generateLevel(rng: () => number, level: number): LevelSpec;
/** 一关的运行时状态。 */
export interface VennGameState {
    /** 当前关号（1 起）。 */
    level: number;
    /** 全部 5 关配置（生成期一次抽出，保证同 seed 重放一致）。 */
    specs: LevelSpec[];
    /** 当前关圆数量。 */
    circleCount: 2 | 3;
    /** 当前关圆几何。 */
    circles: Circle[];
    /** 当前关谓词。 */
    predicates: Predicate[];
    /** 未放置的数字卡。 */
    pool: number[];
    /** 已放置记录。 */
    placed: Array<{
        num: number;
        mask: number;
    }>;
    /** 本关错放次数。 */
    wrong: number;
    /** 本关操作步数（对 + 错）。 */
    steps: number;
    /** playing 进行中 / clear 过关动画 / complete 全通关 / failed 超时。 */
    phase: 'playing' | 'clear' | 'complete' | 'failed';
    /** 本关限时毫秒，null = 不限时。 */
    timeLimitMs: number | null;
    /** 本关已用毫秒。 */
    elapsedMs: number;
    /** 已结算的累计得分。 */
    score: number;
    /** 过关动画剩余毫秒。 */
    levelClearMs: number;
    /** 创建时注入的随机源。 */
    rng: () => number;
}
/** 创建初始状态：一次抽出全部 5 关。
 * @param rng - 注入随机源（如 mulberry32(seed)）。
 * @returns 初始状态（第 1 关 playing）。
 */
export declare function createVennGameState(rng: () => number): VennGameState;
/** 单关结算分：基础分扣错放，限时关按剩余秒加成。
 * @param wrong - 本关错放次数。 @param remainingMs - 剩余毫秒（不限时传 null）。
 * @returns 结算分。
 */
export declare function clearScore(wrong: number, remainingMs: number | null): number;
/** 放置一张数字卡：合法当且仅当其满足掩码恰好等于目标区域掩码。
 * @param state - 状态。 @param num - 数字卡。 @param mask - 目标区域掩码。
 * @returns 'ok' 放对 / 'wrong' 放错（计步） / 'ignored' 无效输入。
 */
export declare function placeCard(state: VennGameState, num: number, mask: number): 'ok' | 'wrong' | 'ignored';
/** 推进时间：限时倒计时、超时判负、过关动画结束后切下一关或通关。
 * @param state - 状态。 @param dtMs - 帧间隔毫秒。
 * @returns 本帧是否发生了阶段切换（供渲染标脏）。
 */
export declare function tick(state: VennGameState, dtMs: number): boolean;
/** 每个允许区域在卡池中的可达数字数（生成器自检 / 测试用）。
 * @param spec - 关卡配置。
 * @returns 掩码 -> 卡池中满足掩码的数字个数。
 */
export declare function regionReachable(spec: LevelSpec): Map<number, number>;
