/**
 * 海豚跃浪 DolphinDive 纯逻辑：水下游动蓄力（速度提升），松开按当前
 * 速度与角度抛物线跃出；空中可空翻（加分但入水时翻滚未完成会被打
 * 折）；入水角越陡得分越高，连续完美入水触发连击倍增；每轮随机风
 * 速与水母障碍。全部随机经 mulberry32(seed) 注入，确定性可测。
 */
/** 轮数。 */
export declare const ROUNDS = 5;
/** 水面世界 y（屏幕坐标，向下为正）。 */
export declare const WATER_Y = 250;
/** 海豚游动深度（水面下 22）。 */
export declare const SWIM_Y = 272;
/** 起跳点横坐标。 */
export declare const JUMP_X = 110;
/** 空中重力加速度（世界单位/秒²）。 */
export declare const GRAVITY = 520;
/** 每完成一圈空翻的加分。 */
export declare const FLIP_BONUS = 8;
/** 水母碰到一次的扣分。 */
export declare const JELLY_PENALTY = 15;
/** 一只水母：空中圆盘障碍，缓慢漂移。 */
export interface Jellyfish {
    x: number;
    y: number;
    r: number;
    /** 水平漂移速度（有正有负）。 */
    vx: number;
    /** 本轮是否已碰到过（只扣一次分）。 */
    hit: boolean;
}
/** 游戏阶段。 */
export type DolphinPhase = 'swim' | 'charge' | 'air' | 'settle' | 'over';
export interface DolphinDiveState {
    /** 注入的确定性随机源（mulberry32）。 */
    rng: () => number;
    /** 创建时使用的种子（重放对照）。 */
    seed: number;
    phase: DolphinPhase;
    /** 当前轮（1..ROUNDS）。 */
    round: number;
    /** 累计总分（跨轮累加）。 */
    score: number;
    /** 蓄力 0..1。 */
    power: number;
    /** 起跳角（度，20..85）。 */
    angleDeg: number;
    /** 海豚位置与速度（世界坐标，y 向下为正）。 */
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** 已累计的空翻旋转弧度（只增）。 */
    rotation: number;
    /** 已请求的空翻圈数（rotation 追到 flipsTarget*TAU 为止）。 */
    flipsTarget: number;
    /** 空中达到的最高点 y（最小值；WATER_Y 表示没高过水面）。 */
    peakY: number;
    /** 本轮风加速度（水平，正为向右）。 */
    wind: number;
    jellyfish: Jellyfish[];
    /** 连续完美入水次数（决定下一跳倍率）。 */
    combo: number;
    /** 最近一跳入水的陡峭度 0..1（水花/结算展示）。 */
    entrySteepness: number;
    /** 最近一跳的加分数（含倍率）。 */
    lastRoundPoints: number;
    /** 最近一跳结算文案。 */
    lastEntryLabel: string;
    /** 入水时翻滚是否未完成（被打折的依据）。 */
    entrySloppy: boolean;
    /** 结算展示计时（秒）。 */
    settleT: number;
}
/** mulberry32：seed 确定性 PRNG，返回 [0,1)。 */
export declare function mulberry32(seed: number): () => number;
/** 新开局：seed 注入，第 1 轮随机就绪。 */
export declare function createDolphinDiveState(seed: number): DolphinDiveState;
/** 开始蓄力（水下按住空格）。 */
export declare function startCharge(state: DolphinDiveState): void;
/** 起跳角微调（↑↓，仅水下游动/蓄力阶段有效）。 */
export declare function adjustAngle(state: DolphinDiveState, delta: number): void;
/** 松开空格：以当前蓄力速度与角度跃出水面。 */
export declare function releaseJump(state: DolphinDiveState): void;
/** 空中按空格：请求一圈空翻。 */
export declare function airFlip(state: DolphinDiveState): void;
/** 入水角得分曲线：陡峭度 s∈[0,1]（0 拍水面，1 垂直），返回 0..100。 */
export declare function computeEntryScore(s: number): number;
/** 当前连击倍率（连续完美入水每次 +0.5，封顶 3）。 */
export declare function comboMultiplier(combo: number): number;
/**
 * 推进一帧。
 * @param state 局面。
 * @param dt 帧间隔秒（调用方应已钳制）。
 */
export declare function stepDolphinDive(state: DolphinDiveState, dt: number): void;
