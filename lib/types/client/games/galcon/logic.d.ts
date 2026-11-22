/**
 * 星域征服 Galcon 纯逻辑层：seed 确定性生成星球盘面（位置 / 大小 /
 * 归属 / 初始兵力）、每秒按大小产兵、点击选星与 50% 派兵、飞行舰队
 * 按距离计时、到达对冲（攻-防，正差占领）、AI 决策（集火最弱目标 +
 * 受攻回防，随局加速）、3 局积分与胜负判定。全部随机走注入 seed
 * （mulberry32），同 seed 逐位可重放；渲染与 DOM 均不在本层。
 */
/** 逻辑画布宽（px）。 */
export declare const W = 960;
/** 逻辑画布高（px）。 */
export declare const H = 640;
/** 单局时长上限（ms）：超时按总兵力多少判定胜负。 */
export declare const ROUND_MS = 120000;
/** 舰队飞行速度（px/s）：飞行耗时 = 星球距离 / 速度。 */
export declare const FLEET_SPEED = 66;
/** 派兵比例：从源星球派出当前兵力的 50%（向下取整）。 */
export declare const SEND_RATIO = 0.5;
/** 一场比赛的局数（3 局积分制）。 */
export declare const MATCH_ROUNDS = 3;
/** 各局 AI 决策间隔（ms），随局号递减（难度上升）。 */
export declare const AI_INTERVALS: readonly [2400, 1900, 1500];
/** 星球归属方。 */
export type Owner = 'player' | 'ai' | 'neutral';
/** 一颗星球：位置 / 半径 / 归属 / 兵力 / 产兵速率（兵/秒）。 */
export interface Planet {
    id: number;
    x: number;
    y: number;
    r: number;
    owner: Owner;
    troops: number;
    /** 每秒产兵数，与半径成正比（只有归属方产兵）。 */
    prodRate: number;
}
/** 一支飞行舰队：按 elapsedMs/totalMs 插值位置，到达即结算。 */
export interface Fleet {
    id: number;
    owner: 'player' | 'ai';
    fromId: number;
    toId: number;
    count: number;
    elapsedMs: number;
    totalMs: number;
}
/** 一局 / 一场比赛的完整状态。 */
export interface GalconState {
    seed: number;
    /** 第几局（0 基），同时决定 AI 间隔与盘面变体。 */
    matchIndex: number;
    /** 重开次数：R 重开递增并改变盘面变体。 */
    attempt: number;
    planets: Planet[];
    fleets: Fleet[];
    /** 当前选中的己方星球 id 列表。 */
    selectedIds: number[];
    /** 本局已进行时长（ms）。 */
    roundMs: number;
    timeMs: number;
    aiTimerMs: number;
    /** 下一支舰队 / 星球的 id 发号器。 */
    nextId: number;
    phase: 'playing' | 'won' | 'lost' | 'matchOver';
    /** 每局胜负记录（'win' | 'loss'）。 */
    results: ('win' | 'loss')[];
    /** 3 局累计积分。 */
    totalScore: number;
}
/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 注入种子。
 * @returns 返回 [0,1) 均匀分布随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/** 按 id 查星球；不存在返回 null。 */
export declare function planetById(state: GalconState, id: number): Planet | null;
/** 两星球球面距离（圆心距 - 双方半径，用于飞行计时）。 */
export declare function planetGap(a: Planet, b: Planet): number;
/**
 * seed 确定性生成星球盘面：12-16 颗、互不重叠、都在边界内；最左为
 * 玩家母星、最右为 AI 母星（初始兵力高于中立星），其余中立。
 * @param seed - 注入种子。
 * @param matchIndex - 局号（0 基），参与盘面变体。
 * @param attempt - 重开序号（0 基），R 重开换盘。
 * @returns 星球数组。
 */
export declare function generatePlanets(seed: number, matchIndex: number, attempt: number): Planet[];
/**
 * 开一局新比赛（3 局积分清零，第 1 局盘面）。
 * @param seed - 注入种子。
 * @returns 初始状态。
 */
export declare function createGalcon(seed: number): GalconState;
/**
 * 进入下一局：未满 3 局重置盘面，满 3 局进入 matchOver。
 * @param state - 当前状态（原地更新）。
 */
export declare function nextMatch(state: GalconState): void;
/**
 * R 重开：清空积分与记录，从第 1 局重开（attempt+1 换新盘面）。
 * @param state - 当前状态（原地更新）。
 */
export declare function restartMatch(state: GalconState): void;
/**
 * 点击一颗星球：点己方=选中（已选中则全选己方）；点其余目标=从当前
 * 选中星球各派 50% 兵力并清空选中。
 * @param state - 当前状态。
 * @param planetId - 被点击的星球 id。
 * @returns 动作类型：'select' | 'selectAll' | 'launch' | 'none'。
 */
export declare function selectPlanet(state: GalconState, planetId: number): 'select' | 'selectAll' | 'launch' | 'none';
/** 全选己方星球（空格键）。 */
export declare function selectAllOwn(state: GalconState): void;
/**
 * 从若干源星球向目标星球派出各 50% 兵力（向下取整，至少 1 兵才派）。
 * @param state - 当前状态。
 * @param fromIds - 源星球 id 列表（须归属发送方）。
 * @param toId - 目标星球 id。
 * @returns 实际派出的总兵力。
 */
export declare function launchFleet(state: GalconState, fromIds: number[], toId: number): number;
/**
 * 舰队当前位置：源星到目标星按 elapsed/total 插值（沿圆心连线）。
 * @param state - 当前状态。
 * @param fleet - 舰队。
 * @returns 逻辑坐标。
 */
export declare function fleetPos(state: GalconState, fleet: Fleet): {
    x: number;
    y: number;
};
/**
 * 一支舰队到达某星球的结算：己方星叠加兵力；敌方星对冲（守方兵力 -
 * 攻方兵力，正差翻转归属），中立星同对冲规则。
 * @param state - 当前状态。
 * @param fleet - 到达的舰队。
 */
export declare function resolveArrival(state: GalconState, fleet: Fleet): void;
/** 某方总兵力：星球驻军 + 在途舰队。 */
export declare function totalTroops(state: GalconState, owner: 'player' | 'ai'): number;
/**
 * AI 决策（确定性，同状态同决策）：受攻星球优先回防（从兵力最多的
 * 己方星派 50% 增援）；否则从兵力最多的己方星向兵力最少的非己方星
 * 发起进攻。
 * @param state - 当前状态。
 * @returns 是否实际派出了舰队。
 */
export declare function aiMove(state: GalconState): boolean;
/** 本局 AI 决策间隔（随局号递减）。 */
export declare function aiInterval(matchIndex: number): number;
/**
 * 推进一帧模拟：产兵、舰队飞行与到达结算、AI 计时决策、胜负与超时
 * 判定。只依赖 state 与 dt，同 seed 同输入序列逐位可重放。
 * @param state - 当前状态（原地更新）。
 * @param dtMs - 帧时长（ms）。
 */
export declare function stepGalcon(state: GalconState, dtMs: number): void;
