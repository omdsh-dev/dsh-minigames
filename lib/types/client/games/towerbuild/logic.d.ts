/**
 * 层叠塔 TowerBuild 纯逻辑：物理叠塔（稳定性建造）的核心规则。
 * 侧视工地：底部固定基座，方块从上方吊索左右摆动，按空格落在当前
 * 堆顶。每块有宽度、重量与重心偏心；落点与下方块的重叠不足即脱钩
 * 坠落（失误）。堆的联合重心实时计算，投影超出基座支撑即整塔倾倒；
 * 块间摩擦简化为「界面滑动累积」：上段重心对每个界面的偏心比超过
 * 稳定阈值的滑动区时缓慢累积，超限则该界面以上整段倒塌（散块物理
 * 动画）。后两关引入横向风力扰动。全部随机走注入 seed 的 mulberry32，
 * 不含任何 DOM / canvas 依赖，可直接单测与确定性重放。
 */
/** mulberry32 伪随机数发生器：小而快，同 seed 序列确定。 */
export declare function mulberry32(seed: number): () => number;
/** 基座宽度（世界单位，x=0 为基座中心）。 */
export declare const BASE_W = 160;
/** 基座重量（联合重心计算中计入）。 */
export declare const BASE_MASS = 20;
/** 基座高度（世界单位，render 用同一常量换算屏幕坐标）。 */
export declare const BASE_H = 36;
/** 每层方块高度。 */
export declare const BLOCK_H = 20;
/** 方块宽度范围。 */
export declare const BLOCK_MIN_W = 84;
export declare const BLOCK_MAX_W = 168;
/** 吊挂块底面距堆顶的最小距离（失误块的下落起点）。 */
export declare const HANG = 66;
/** 与下方块的最小重叠，低于即脱钩坠落（失误）。 */
export declare const MIN_OVERLAP = 24;
/** 界面滑动累积上限，超过即该界面以上整段倒塌。 */
export declare const SLIP_LIMIT = 1;
/** 偏心比低于该阈值时塔身自稳，滑动缓慢回落。 */
export declare const HOLD_E = 0.55;
/** 滑动累积速率（偏心比每超 1.0 每秒累积的滑动量）。 */
export declare const SLIP_RATE = 0.8;
/** 稳定时滑动回落速率（每秒）。 */
export declare const SLIP_DECAY = 0.35;
/** 风力折算到界面偏心比的系数。 */
export declare const WIND_E = 1.2;
/** 散块重力加速度（世界单位 / 秒²）。 */
export declare const DEBRIS_G = 900;
/** 倒塌动画时长（毫秒），结束后进入失败态。 */
export declare const COLLAPSE_MS = 1500;
/** 过关停留时长（毫秒），之后自动进入下一关。 */
export declare const CLEARED_MS = 1600;
/** 过关奖励分。 */
export declare const CLEAR_BONUS = 25;
/** 一关的固定参数：目标高度、吊索摆幅 / 周期、风力强度。 */
export interface TowerLevelConfig {
    /** 目标层数（放满即过关）。 */
    target: number;
    /** 吊索摆幅（世界单位，单侧）。 */
    swingAmp: number;
    /** 吊索摆动周期（毫秒）。 */
    swingPeriod: number;
    /** 风力强度（0 = 无风；横向力随机扰动的幅值）。 */
    wind: number;
}
/** 五关递进：目标高度 8→20 块，摆动加快，后两关起风。 */
export declare const LEVELS: readonly TowerLevelConfig[];
/** 关卡总数。 */
export declare const LEVEL_COUNT: number;
/** 已放置（或吊挂中）的一块：宽度、重量、中心 x 与重心偏心。 */
export interface TowerBlock {
    /** 方块宽度（世界单位）。 */
    w: number;
    /** 重量（联合重心与界面力矩计入）。 */
    mass: number;
    /** 中心 x（世界坐标，0 = 基座中心）。 */
    cx: number;
    /** 重心相对几何中心的水平偏心（块内偏置）。 */
    comOffset: number;
}
/** 倒塌 / 失误后的散块（世界坐标，含简单抛体运动）。 */
export interface Debris {
    x: number;
    /** 世界 y（负向上，0 = 地面）。 */
    y: number;
    w: number;
    vx: number;
    vy: number;
    /** 旋转角（弧度）与角速度。 */
    rot: number;
    vr: number;
}
/** 对局阶段。 */
export type TowerPhase = 'swing' | 'collapse' | 'cleared' | 'over';
/** 对局状态（全部字段可直接读取；rng 仅供内部推进，勿手工调用）。 */
export interface TowerBuildState {
    /** 当前关（0 起）。 */
    level: number;
    /** 本局注入种子（重放用）。 */
    seed: number;
    /** 已放置方块（不含基座，下标即层号）。 */
    blocks: TowerBlock[];
    /** 吊挂中的下一块（cx 由摆动相位决定，见 {@link pendingX}）。 */
    pending: TowerBlock;
    /** 吊索摆动相位（弧度）。 */
    swingPhase: number;
    /** 阶段。 */
    phase: TowerPhase;
    /** 每个界面的滑动累积：slip[k] 为第 k 块与其下方支撑（k=0 为基座）之间。 */
    slip: number[];
    /** 当前风力（-强度..+强度；无风关恒为 0）。 */
    wind: number;
    /** 风向目标值与距下次变化的时间（毫秒）。 */
    windTarget: number;
    windT: number;
    /** 联合重心 x（含基座，放置后重算）。 */
    comX: number;
    /** 总分（每放一块 +1，过关 +25）。 */
    score: number;
    /** 已过关数。 */
    clearedLevels: number;
    /** 是否以「最后一关过关」收尾（区别于倒塌失败）。 */
    completed: boolean;
    /** 倒塌起始界面（-1 = 仅失误块坠落，塔身未倒）。 */
    collapseIndex: number;
    /** 倒塌 / 过关动画计时（毫秒）。 */
    animT: number;
    /** 散块列表。 */
    debris: Debris[];
    /** 内部随机源（seed 派生），测试勿直接调用。 */
    rng: () => number;
}
/** 放置结果。 */
export type PlaceResult = 'placed' | 'cleared' | 'miss' | 'toppled' | null;
/** 第 k 层方块的世界 y（块底面高度；负向上，0 = 地面）。 */
export declare function blockBaseY(k: number): number;
/** 吊挂块当前的世界 x（纯函数：摆幅 × sin 相位）。 */
export declare function pendingX(state: TowerBuildState): number;
/**
 * 联合重心（含基座）。
 * @param blocks - 已放置方块。
 * @returns 重心 x 与总重量。
 */
export declare function computeCom(blocks: readonly TowerBlock[]): {
    x: number;
    mass: number;
};
/**
 * 界面 k 的几何与静力报告：支撑面（重叠区）半宽、上段总重量、
 * 上段联合重心对支撑面中心的偏心比（不含风力）。
 * @param state - 对局状态。
 * @param k - 界面下标（0 = 基座与第 0 块之间）。
 * @returns 偏心比与支撑面信息；k 越界返回 null。
 */
export declare function interfaceReport(state: TowerBuildState, k: number): {
    e: number;
    half: number;
    massAbove: number;
} | null;
/**
 * 最危险界面的含风偏心比（render 用它画警示与 HUD）。
 * @returns 界面下标（塔空为 -1）与最大 |偏心比|。
 */
export declare function worstInterface(state: TowerBuildState): {
    k: number;
    e: number;
};
/**
 * 开一局。
 * @param level - 起始关（0 起，越界钳制）。
 * @param seed - 注入种子。
 */
export declare function createState(level: number, seed: number): TowerBuildState;
/**
 * 放下吊挂块（按当前摆动相位计算落点）。
 * 落点与堆顶重叠不足 → 失误坠落；放置后联合重心超出基座支撑 →
 * 整塔倾倒；放满目标层 → 过关；否则换下一块继续。
 * @param state - 对局状态（须处于 swing 阶段）。
 * @returns 放置结果；非 swing 阶段返回 null。
 */
export declare function place(state: TowerBuildState): PlaceResult;
/**
 * 推进一帧（确定性：相同 seed + 相同调用序列 → 相同状态）。
 * swing：摆动相位 + 风力 + 滑动判定；collapse / cleared：动画计时，
 * 结束后分别判负 / 自动进入下一关（最后一关后判负收尾为通关态）。
 * @param state - 对局状态。
 * @param dtMs - 帧间隔（毫秒）。
 */
export declare function step(state: TowerBuildState, dtMs: number): void;
/**
 * 重开当前关（换新种子；分数与过关计数清零）。
 * @param state - 现有状态（取其 level）。
 * @param seed - 新种子。
 * @returns 新状态。
 */
export declare function restartLevel(state: TowerBuildState, seed: number): TowerBuildState;
/** 是否已全部通关（收尾 over 态且五关全过）。 */
export declare function isComplete(state: TowerBuildState): boolean;
/** 塔高（已放置层数）。 */
export declare function towerHeight(state: TowerBuildState): number;
/** 失败原因（over / collapse 态展示；进行中返回 null）。 */
export declare function failReason(state: TowerBuildState): 'miss' | 'toppled' | 'collapse' | null;
