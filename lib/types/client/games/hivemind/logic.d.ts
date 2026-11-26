/**
 * 蜂群算法 (HiveMind) 纯逻辑：200 只蜂的 Boids 涌现模拟（分离/对齐/
 * 聚合三力，权重由玩家实时调节 0-2）+ 5 关目标挑战。每关给出一个量化
 * 队形指标（质心入区 / 最小间距 / 区域覆盖数 / 整体对齐度 / 组合），
 * 蜂群需在限时内持续满足指标达 holdMs 才过关；红色障碍区进入即扣分。
 * 边界反弹、固定子步积分、全部随机走注入 seed（mulberry32），整局可
 * 按 (seed, 参数序列) 完整重放。时间单位全为毫秒，无 DOM、无定时器。
 */
/** 逻辑画布宽（px）。 */
export declare const W = 480;
/** 逻辑画布高（px）。 */
export declare const H = 600;
/** 模拟场地矩形（逻辑坐标）：顶部 HUD 与底部滑杆/进度区之外的区域。 */
export declare const FIELD: {
    readonly x: 10;
    readonly y: 34;
    readonly w: 460;
    readonly h: 440;
};
/** 固定物理子步长（ms）：stepHiveMind 把外部 dt 累加后按此切分。 */
export declare const SUBSTEP_MS = 16;
/** 蜂数（固定 200，题目设定）。 */
export declare const BEE_COUNT = 200;
/** 蜂的绘制/碰撞半径（px）。 */
export declare const BEE_R = 3.5;
/** 分离半径（px）：更近的邻居互相推开。 */
export declare const SEP_R = 22;
/** 对齐/聚合的视野半径（px）。 */
export declare const VIEW_R = 70;
/** 分离加速度峰值（px/s^2，按 sep 权重 0-2 缩放）。 */
export declare const SEP_ACCEL = 560;
/** 对齐转向加速度（px/s^2，向邻居平均航向靠拢，按 ali 权重缩放）。 */
export declare const ALI_ACCEL = 200;
/** 聚合加速度（px/s^2，指向邻居质心，按 coh 权重缩放）。 */
export declare const COH_ACCEL = 170;
/** 基准蜂速（px/s），个体在 ±10% 内浮动（seed 决定）。 */
export declare const BEE_SPEED = 85;
/** 三条 Boids 力的玩家可调权重（各 0-2，实时生效）。 */
export interface SwarmParams {
    /** 分离权重：越大越互斥散开。 */
    sep: number;
    /** 对齐权重：越大越朝邻居平均航向看齐（鱼群洄游）。 */
    ali: number;
    /** 聚合权重：越大越向邻居质心靠拢（成团）。 */
    coh: number;
}
/** 一只蜂：位置、航向（弧度）、个体速度系数、是否正处于障碍内。 */
export interface Bee {
    x: number;
    y: number;
    /** 航向角（弧度），速度恒定按 speed 系数。 */
    heading: number;
    /** 个体速度系数（0.9-1.1，seed 决定）。 */
    speed: number;
    /** 当前子步是否在障碍内（用于进入障碍时计一次命中）。 */
    inObstacle: boolean;
}
/** 红色障碍区（圆）。 */
export interface Obstacle {
    x: number;
    y: number;
    r: number;
}
/** 目标指标规格（判据全部在 metrics.ts 式纯函数上判定）。 */
export type TargetSpec = 
/** 质心进入指定圆。 */
{
    kind: 'centroid';
    x: number;
    y: number;
    r: number;
}
/** 全群平均最近邻间距 ≥ minSpacing（平滑、可被分离权重推高）。 */
 | {
    kind: 'spacing';
    minSpacing: number;
}
/** 进入指定圆的蜂数 ≥ count。 */
 | {
    kind: 'coverage';
    x: number;
    y: number;
    r: number;
    count: number;
}
/** 全群航向对齐度 ≥ minAlign（0-1）。 */
 | {
    kind: 'alignment';
    minAlign: number;
}
/** 组合：质心入圆且平均最近邻间距达标。 */
 | {
    kind: 'combo';
    x: number;
    y: number;
    r: number;
    minSpacing: number;
};
/** 一关定义。 */
export interface LevelDef {
    /** 关名（渲染显示）。 */
    name: string;
    /** 限时（ms）。 */
    timeLimitMs: number;
    /** 指标需持续满足的时长（ms）。 */
    holdMs: number;
    /** 障碍区列表。 */
    obstacles: Obstacle[];
    /** 目标指标。 */
    target: TargetSpec;
}
/** 5 关挑战：调参引导蜂群涌现出对应队形。 */
export declare const LEVELS: readonly LevelDef[];
/** 总关数。 */
export declare const LEVEL_COUNT: number;
/** 对局状态。 */
export interface HiveMindState {
    /** 注入种子（整局重放的根）。 */
    seed: number;
    /** 当前关卡下标（0 起）。 */
    level: number;
    /** 三力权重（玩家实时调节）。 */
    params: SwarmParams;
    /** 蜂群。 */
    bees: Bee[];
    /** 本关已流逝时间（ms）。 */
    elapsedMs: number;
    /** 指标当前已连续满足的时长（ms）。 */
    holdMs: number;
    /** 本关进入障碍次数（每次过关扣 5 分）。 */
    obstacleHits: number;
    /** 子步累加器（跨 step 调用保持固定步长）。 */
    accumMs: number;
    /** playing=进行中；won=过关（advanceLevel 前）；timeout=超时；complete=全通关。 */
    status: 'playing' | 'won' | 'timeout' | 'complete';
    /** 累计总分（过关时结算）。 */
    score: number;
}
/** mulberry32 确定性伪随机数发生器：同 seed 同序列，返回 [0,1)。 */
export declare function mulberry32(seed: number): () => number;
/** 关卡种子：不同 seed / 不同关卡号产生不同的生成序列。 */
export declare function levelSeed(seed: number, level: number): number;
/** 创建初始对局（第 1 关、三力各 1.0）。 */
export declare function createHiveMindState(seed?: number): HiveMindState;
/** 重开当前关：蜂群/计时/命中按 seed 重置，分数保留（鼓励重试）。 */
export declare function restartLevel(state: HiveMindState): void;
/** 过关后进入下一关；末关过关则全通关。 */
export declare function advanceLevel(state: HiveMindState): void;
/** 调节一条力权重（钳制到 0-2）。 */
export declare function setParam(state: HiveMindState, key: keyof SwarmParams, value: number): void;
/** 蜂群质心。 */
export declare function swarmCentroid(bees: readonly Bee[]): {
    x: number;
    y: number;
};
/** 全群两两最小间距（蜂数 n 的 O(n^2)，仅指标判定/渲染调用）。 */
export declare function minSpacing(bees: readonly Bee[]): number;
/** 全群平均最近邻间距（px）：每只蜂到最近邻居距离的均值——比两两
 * 最小值平滑，作为关卡「间距」指标（分离权重越高该值越大）。 */
export declare function meanNearestSpacing(bees: readonly Bee[]): number;
/** 进入指定圆的蜂数。 */
export declare function coverageCount(bees: readonly Bee[], x: number, y: number, r: number): number;
/** 全群航向对齐度（0=各奔东西，1=完全同向）：单位航向矢量和长度/n。 */
export declare function alignmentScore(bees: readonly Bee[]): number;
/** 目标指标当前是否满足。 */
export declare function objectiveMet(state: HiveMindState): boolean;
/** 指标持续满足进度（0-1，hold 计时占满即过关）。 */
export declare function objectiveProgress(state: HiveMindState): number;
/** 推进对局：外部 dt 累加后按固定子步切分；过关/超时/指标计时在此结算。 */
export declare function stepHiveMind(state: HiveMindState, dtMs: number): void;
