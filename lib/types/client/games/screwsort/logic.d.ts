/**
 * 螺栓分拣（ScrewSort）纯逻辑：传送带从右向左输送螺母，每颗螺母携带
 * 颜色与内径（粗细）双属性；下方四个螺栓工位各绑定一种颜色与一种
 * 粗细。玩家选中螺母后投放到工位：颜色与内径都匹配才拧上（拧紧动画
 * 800ms 期间工位占用），不匹配则弹回并扣分（连续模式再扣时）；真
 * 螺母滑出左端未处理记漏检扣分，迷惑螺母（颜色相近但双属性均不
 * 匹配）放行不扣。连续模式 60 秒限时冲分；关卡模式 5 关按目标个数
 * 流转。带速与生成密度随进度升档；全部随机走 mulberry32(seed, round)，
 * 帧时间先累加再按固定 10ms 子步推进，任意调用节奏下轨迹一致；同
 * seed + 输入脚本重放一致。输入（选中 / 投放）以纯函数调用传入，
 * 逻辑层不接触 DOM。
 */
/** 逻辑画布宽（HUD 与全部元素包含在内）。 */
export declare const W = 560;
/** 逻辑画布高。 */
export declare const H = 600;
/** 四种螺母颜色：0/1 为近蓝对、2/3 为绿青对（迷惑件取近邻色）。 */
export declare const NUT_COLORS: readonly ["#7aa2f7", "#7dcfff", "#9ece6a", "#73daca"];
/** 颜色数（同时是螺栓工位数）。 */
export declare const COLOR_COUNT = 4;
/** 内径档数：0 = M6 细牙，1 = M10 粗牙。 */
export declare const SIZE_COUNT = 2;
/** 工位 i 的粗细：两细两粗，保证颜色与粗细都不足以单独定位。 */
export declare const BOLT_SIZES: readonly (0 | 1)[];
/** 传送带左端（漏检口）。 */
export declare const BELT_LEFT = 26;
/** 传送带右端。 */
export declare const BELT_RIGHT = 548;
/** 传送带上沿 y。 */
export declare const BELT_Y = 100;
/** 传送带厚度。 */
export declare const BELT_H = 26;
/** 带上螺母中心线 y。 */
export declare const NUT_Y = 92;
/** 螺母外半径。 */
export declare const NUT_R = 20;
/** 两档内孔半径：M6 / M10。 */
export declare const HOLE_R: readonly [number, number];
/** 生成 x（画布右外，滑入可视区）。 */
export declare const SPAWN_X = 590;
/** 错配弹回的右推距离 px。 */
export declare const BOUNCE_X = 70;
/** 拧紧动画时长与工位占用时长 ms。 */
export declare const SCREW_MS = 800;
/** 固定子步 ms：stepScrewSort 内部按该粒度推进模拟。 */
export declare const SUBSTEP_MS = 10;
/** 拧对基础分。 */
export declare const BASE_SCORE = 2;
/** 每级连击附加分。 */
export declare const COMBO_BONUS = 1;
/** 连击上限。 */
export declare const COMBO_CAP = 8;
/** 连击窗口 ms：窗口内再拧对则连击 +1。 */
export declare const COMBO_WINDOW_MS = 1500;
/** 漏检扣分。 */
export declare const MISS_PENALTY = 2;
/** 错配扣分。 */
export declare const MISMATCH_PENALTY = 1;
/** 错配扣时（仅连续模式）ms。 */
export declare const MISMATCH_TIME_MS = 1500;
/** 连续模式限时 ms。 */
export declare const TIME_LIMIT_MS = 60000;
/** 关卡模式关数。 */
export declare const LEVEL_COUNT = 5;
/** 各关目标拧紧数（严格递增）。 */
export declare const LEVEL_TARGETS: readonly [10, 14, 18, 22, 26];
/** 连续模式：该时刻后才开始出迷惑件。 */
export declare const DECOY_AFTER_MS = 20000;
/** 关卡模式：该关起才开始出迷惑件。 */
export declare const DECOY_AFTER_LEVEL = 3;
/** 迷惑件在晚期生成流中的占比。 */
export declare const DECOY_P = 0.3;
/** 飘字存活时长 ms。 */
export declare const FLOAT_MS = 800;
/** 错配红闪持续 ms。 */
export declare const FLASH_MS = 350;
/** HUD 右下「说明」按钮矩形（渲染与点击命中共用）。 */
export declare const HELP_BTN: {
    readonly x: number;
    readonly y: 34;
    readonly w: 60;
    readonly h: 24;
};
/** 螺栓工位几何（渲染与命中共用）。 */
export declare const STATION_X0 = 24;
export declare const STATION_W = 118;
export declare const STATION_GAP = 14;
export declare const STATION_Y = 170;
export declare const STATION_H = 290;
/** 一颗在途螺母：双属性 + 是否迷惑件 + 带上 x。 */
export interface Nut {
    id: number;
    color: 0 | 1 | 2 | 3;
    size: 0 | 1;
    decoy: boolean;
    x: number;
}
/** 一个螺栓工位：绑定双属性、累计拧紧数与占用 / 红闪状态。 */
export interface Bolt {
    color: 0 | 1 | 2 | 3;
    size: 0 | 1;
    count: number;
    /** 拧紧占用截止时刻（回合钟 ms），0 表示空闲。 */
    busyUntil: number;
    /** 正在拧的螺母颜色（渲染动画用）。 */
    screwColor: 0 | 1 | 2 | 3;
    /** 正在拧的螺母内径档。 */
    screwSize: 0 | 1;
    /** 错配红闪截止时刻 ms。 */
    flashUntil: number;
}
/** 单步内产生、供渲染层消费的可视事件。 */
export type ScrewSortEvent = {
    type: 'screwed';
    bolt: number;
    color: number;
    x: number;
    y: number;
} | {
    type: 'mismatch';
    bolt: number;
    x: number;
    y: number;
} | {
    type: 'busy';
    bolt: number;
} | {
    type: 'missed';
    color: number;
    x: number;
    y: number;
} | {
    type: 'decoyPass';
    x: number;
    y: number;
} | {
    type: 'level';
    level: number;
};
/** 上浮渐隐的飘字（得分 / 漏检 / 错配提示）。 */
export interface FloatText {
    x: number;
    y: number;
    text: string;
    life: number;
}
/** 模式：连续 60 秒冲分 / 关卡 5 关目标流转。 */
export type GameMode = 'continuous' | 'levels';
/** 一局游戏的完整可测状态。 */
export interface ScrewSortState {
    mode: GameMode;
    /** 回合内已流逝 ms。 */
    t: number;
    /** 未消费的帧时间累加器 ms（固定子步用）。 */
    acc: number;
    score: number;
    combo: number;
    /** 连击失效时刻 ms（回合钟）。 */
    comboExpire: number;
    /** 漏检数（真螺母滑出左端）。 */
    missed: number;
    /** 在途螺母（按 x 降序不保证）。 */
    nuts: Nut[];
    /** 四个工位，下标即工位号。 */
    bolts: Bolt[];
    /** 当前选中的螺母 id（无则 null）。 */
    selected: number | null;
    nextNutId: number;
    /** 下一次生成时刻 ms。 */
    nextSpawnAt: number;
    rng: () => number;
    events: ScrewSortEvent[];
    floats: FloatText[];
    over: boolean;
    /** 关卡模式通关标记（连续模式恒 false）。 */
    win: boolean;
    /** 连续模式剩余 ms（关卡模式未用，恒为 0）。 */
    timeLeft: number;
    /** 关卡模式当前关（1 起；连续模式未用，恒为 1）。 */
    level: number;
    /** 本关已拧紧数（关卡模式）。 */
    levelProgress: number;
}
/**
 * mulberry32 确定性随机数发生器。
 * @param seed - 非负整数种子。
 * @returns 返回 [0,1) 均匀随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 工位 i 的左上角 x。
 * @param i - 工位索引 0-3。
 * @returns 该工位面板左上角逻辑 x。
 */
export declare function stationX(i: number): number;
/**
 * 点击是否落在「说明」按钮矩形内。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中返回 true。
 */
export declare function inHelpButton(x: number, y: number): boolean;
/**
 * 点击落在哪个工位面板内。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 工位索引 0-3，未命中返回 null。
 */
export declare function boltAt(x: number, y: number): number | null;
/**
 * 点击落在哪颗螺母上（半径外放 6px 容差）。
 * @param state - 目标状态。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中螺母的 id，未命中返回 null。
 */
export declare function nutAt(state: ScrewSortState, x: number, y: number): number | null;
/**
 * 当前难度档：连续模式按回合时间每 12 秒 +1；关卡模式即关卡号。
 * @param mode - 游戏模式。
 * @param tMs - 连续模式回合钟 ms。
 * @param level - 关卡模式当前关。
 * @returns 从 1 开始的档位。
 */
export declare function levelOf(mode: GameMode, tMs: number, level: number): number;
/**
 * 带速 px/s：1 档 70，每档 +20，封顶 240。
 * @param level - 当前档位。
 * @returns 该档位的带速。
 */
export declare function beltSpeed(level: number): number;
/**
 * 生成平均间隔 ms：1 档 1800，逐档 -260，下限 520。
 * @param level - 当前档位。
 * @returns 生成间隔的期望值。
 */
export declare function spawnMeanMs(level: number): number;
/**
 * 泊松间隔采样：指数分布 -ln(1-u)*mean，截断到 [0.5, 1.6] 倍期望。
 * @param rng - 随机源。
 * @param mean - 间隔期望 ms。
 * @returns 本次到下一次生成的间隔 ms。
 */
export declare function poissonInterval(rng: () => number, mean: number): number;
/**
 * 新开一局。
 * @param seed - 外部种子（如日期）。
 * @param round - 第几局（同 seed 不同局轨迹不同）。
 * @param mode - 连续 / 关卡模式。
 * @returns 初始状态。
 */
export declare function createScrewSort(seed: number, round?: number, mode?: GameMode): ScrewSortState;
/**
 * 压制自然生成（测试注入可控螺母用）：把下一次生成推到无限远。
 * @param state - 目标状态。
 */
export declare function quietSpawn(state: ScrewSortState): void;
/**
 * 注入一颗螺母（测试与调试用）。
 * @param state - 目标状态。
 * @param color - 颜色索引。
 * @param size - 内径档。
 * @param x - 带上 x。
 * @param decoy - 是否迷惑件。
 * @returns 注入螺母的 id。
 */
export declare function injectNut(state: ScrewSortState, color: 0 | 1 | 2 | 3, size: 0 | 1, x: number, decoy?: boolean): number;
/**
 * 尝试把当前选中的螺母拧到工位 boltIndex：双属性匹配才成功。
 * 成功移除螺母、占用工位 SCREW_MS 并计连击分；不匹配弹回（x 右推
 * BOUNCE_X）、扣分、清连击，连续模式再扣 MISMATCH_TIME_MS；工位
 * 占用中返回 'busy' 不作任何结算。
 * @param state - 目标状态。
 * @param boltIndex - 工位索引 0-3。
 * @returns 'ok' | 'mismatch' | 'busy' | 'none'（无选中 / 已结束）。
 */
export declare function attemptScrew(state: ScrewSortState, boltIndex: number): 'ok' | 'mismatch' | 'busy' | 'none';
/**
 * 推进一帧：把帧时间累加并按固定 SUBSTEP_MS 子步确定性推进。事件写
 * 入 state.events，调用方每帧消费（下一帧开头清空）。结束后冻结。
 * @param state - 目标状态。
 * @param dtMs - 帧间隔 ms。
 * @param boost - 空格加速带（仅放大位移）。
 */
export declare function stepScrewSort(state: ScrewSortState, dtMs: number, boost?: boolean): void;
