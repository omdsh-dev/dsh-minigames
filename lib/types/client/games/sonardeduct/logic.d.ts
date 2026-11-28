/**
 * 「声呐探物 SonarDeduct」纯逻辑：9×9 海域、seed 布下的静态障碍、
 * 有限次数的主动声呐（8 向 raycast 回声，非零距离直接定位最近障碍）、
 * 标记判定（凑满自动判定，错旗即拔并扣分）、高关漂移鱼群（纯干扰，
 * 判定只看静态障碍）与 5 关递进。全部确定性：随机只来自注入 seed 的
 * mulberry32，时间只由调用方传入的 dt 驱动；布局生成内含可解性验证
 * （贪心覆盖所需声呐数 ≤ 预算），同 seed + 同操作序列完全可重放。
 */
/** 海域边长（9×9 格）。 */
export declare const SIZE = 9;
/** 总关数。 */
export declare const LEVEL_COUNT = 5;
/** 误标判负上限（累计错旗判定次数）。 */
export declare const WRONG_LIMIT = 3;
/** 8 个声呐方向：北、东北、东、东南、南、西南、西、西北。 */
export declare const DIRS: ReadonlyArray<{
    dr: number;
    dc: number;
    name: string;
}>;
/** 每关配置：障碍数 / 声呐预算 / 鱼群数量。 */
export interface LevelConfig {
    obstacles: number;
    budget: number;
    fish: number;
}
/** 对局状态：进行中 / 单关完成 / 全部通关 / 误标过多失败。 */
export type GameStatus = 'playing' | 'levelClear' | 'allClear' | 'gameover';
/** 一次已发射的声呐：位置 + 8 向回声（0 = 该方向无障碍）。 */
export interface Ping {
    r: number;
    c: number;
    /** 与 DIRS 同序的 8 向回声距离。 */
    echo: number[];
}
/** 一条漂移鱼（起点 + 速度；当前位置由 t 计算，纯干扰）。 */
export interface Fish {
    x0: number;
    y0: number;
    vx: number;
    vy: number;
}
/** 一关的完整局面（可变；由 ping / toggleMark / tick 推进）。 */
export interface SonarDeductState {
    /** 1 起的关卡号（1..LEVEL_COUNT）。 */
    level: number;
    /** 行主序障碍掩码：1 = 海床下有障碍（对玩家隐藏）。 */
    obstacles: Uint8Array;
    /** 行主序玩家标记：1 = 插旗。 */
    marks: Uint8Array;
    /** 已发射的声呐（含回声，渲染与推理共用）。 */
    pings: Ping[];
    /** 剩余声呐次数。 */
    budget: number;
    /** 累计误标判定次数。 */
    wrong: number;
    /** 累计模拟秒数（驱动鱼群漂移）。 */
    t: number;
    /** 子步累加器（固定步长推进 t，保证重放一致）。 */
    subAcc: number;
    status: GameStatus;
    /** 本关得分（含误标扣分；跨关累计由 index 层维护）。 */
    score: number;
    /** 提示文案（错旗排查提示，渲染层显示；空=无）。 */
    message: string;
    fish: Fish[];
    /** 注入的确定性随机源。 */
    rng: () => number;
}
/** mulberry32：seed 注入的确定性随机源（0..1）。 */
export declare function mulberry32(seed: number): () => number;
/** 每关 seed：同关重开必然得到同一片海域。 */
export declare function levelSeed(level: number): number;
/** 读取关卡配置（越界夹紧）。 */
export declare function levelConfig(level: number): LevelConfig;
/** 行主序下标。 */
export declare function cellIndex(r: number, c: number): number;
/** 单格声呐回声：8 向各自到最近障碍的步数（无障碍为 0）。 */
export declare function echoAt(obstacles: Uint8Array, r: number, c: number): number[];
/** 一次声呐能定位的障碍集合（非零回声即精确命中该格）。 */
export declare function revealedByPing(obstacles: Uint8Array, r: number, c: number): number[];
/** 贪心覆盖：把全部障碍各命中一次所需的最少声呐数（上界估计）。 */
export declare function greedyCoverCount(obstacles: Uint8Array): number;
/** 起一关：按 seed 布障碍（含可解性验证）并生成鱼群。 */
export declare function createLevel(seed: number, level: number): SonarDeductState;
/** 当前鱼群位置（由 t 线性漂移并在海域内环绕，纯视觉干扰）。 */
export declare function fishPositions(state: SonarDeductState): {
    x: number;
    y: number;
}[];
/** 玩家动作：在 (r,c) 发射声呐（成功返回 true）。 */
export declare function ping(state: SonarDeductState, r: number, c: number): boolean;
/** 当前插旗数。 */
export declare function markCount(state: SonarDeductState): number;
/** 障碍总数。 */
export declare function obstacleCount(state: SonarDeductState): number;
/** 玩家动作：插旗 / 拔旗；旗数凑满时自动判定。 */
export declare function toggleMark(state: SonarDeductState, r: number, c: number): boolean;
/** 推进时间（鱼群漂移；固定 1/60 子步，胜负后为空操作）。 */
export declare function tick(state: SonarDeductState, dt: number): void;
