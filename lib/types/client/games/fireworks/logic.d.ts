/**
 * 烟花编排 FireworksShow 纯逻辑层：配方表（色彩×爆高×形状×升空×燃程）、
 * 关卡定义（发射位数×目标谱×风偏）、装配（位×配方×延时）、离散 0.1s
 * 粒度的升空绽放时序模拟、谱项判定（时刻×颜色×形状×数量 / 柳形最后
 * 落下）、过关与计分、装饰星点 seed 重放。全部确定性（无 Math.random），
 * 可单元测试；渲染层只消费这里的结构。无反引号模板字符串。
 */
/** 烟花形状：菊=放射 / 牡丹=多层 / 环=环形 / 柳=垂枝。 */
export type Shape = 'chrys' | 'peony' | 'ring' | 'willow';
/** 一条烟花配方：决定色彩、爆高、形状与升空/燃程时长（0.1s tick）。 */
export interface Recipe {
    /** 稳定唯一 id。 */
    id: string;
    /** 中文名（2-3 字，发射位卡片显示）。 */
    name: string;
    /** 色彩（THEME.accents 中的十六进制值）。 */
    color: string;
    /** 色彩中文名（目标谱文案用）。 */
    colorName: string;
    /** 升空时长（tick，1 tick = 0.1s）。 */
    rise: number;
    /** 绽放可见时长（tick）。 */
    life: number;
    /** 爆高（逻辑像素，映射到夜空高度）。 */
    height: number;
    /** 形状。 */
    shape: Shape;
}
/**
 * 内置配方表（9 种）：同色不同形、同形不同高——查表与记忆的核心。
 * 升空 1.0-2.5s、燃程 1.0-2.6s，柳形燃程最长（「最后落下」谱项依据）。
 */
export declare const RECIPES: Recipe[];
/** 配方数。 */
export declare const RECIPE_COUNT: number;
/** 按 id 取配方（找不到返回 null）。 */
export declare function recipeById(id: string): Recipe | null;
/** 目标谱项：sync=某时刻同放若干朵；lastFall=某形状要最后落下。 */
export interface SpectrumItem {
    /** 谱项类型。 */
    kind: 'sync' | 'lastFall';
    /** sync：判定时刻（tick）。 */
    tick?: number;
    /** 颜色（十六进制）。 */
    color?: string;
    /** 形状。 */
    shape: Shape;
    /** sync：需要的最少朵数。 */
    count?: number;
}
/** 一个发射位的装配：配方 + 引信延时（0-5 整秒）。 */
export interface Assignment {
    /** 发射位下标。 */
    pad: number;
    /** 配方 id。 */
    recipe: string;
    /** 引信延时（秒，0-5）。 */
    delay: number;
}
/** 关卡：发射位数、是否风偏、目标谱与内置可行解（可赢性由测试验证）。 */
export interface LevelData {
    /** 关卡序号（0 起）。 */
    index: number;
    /** 发射位数量。 */
    pads: number;
    /** 风偏：奇数位点火后额外 +1 秒升空。 */
    wind: boolean;
    /** 目标谱项。 */
    items: SpectrumItem[];
    /** 一个已知可行解（测试「全关可赢」用）。 */
    solution: Assignment[];
}
/**
 * 5 关递进：发射位 3→6、谱项 2→5、第 4 关起加入风偏（奇数位 +1s，
 * 装配时须避开）。每关 solution 均经测试验证全谱项命中。
 */
export declare const LEVELS: LevelData[];
/** 关卡数。 */
export declare const LEVEL_COUNT: number;
/** 引信延时范围（整秒）。 */
export declare const MIN_DELAY = 0;
export declare const MAX_DELAY = 5;
/** 一次绽放事件（模拟产物）。 */
export interface BurstEvent {
    /** 发射位下标。 */
    pad: number;
    /** 配方 id。 */
    recipe: string;
    /** 点火 tick（含风偏后的实际升空起点）。 */
    launch: number;
    /** 绽放时刻（tick）。 */
    burst: number;
    /** 熄灭时刻（tick，开区间右端）。 */
    end: number;
    /** 色彩。 */
    color: string;
    /** 形状。 */
    shape: Shape;
    /** 爆高（逻辑像素）。 */
    height: number;
}
/** 一场演出的模拟结果。 */
export interface ShowResult {
    /** 绽放事件（按绽放时刻升序）。 */
    events: BurstEvent[];
    /** 各谱项命中与否（与关卡 items 一一对应）。 */
    hits: boolean[];
    /** 全部命中才过关。 */
    win: boolean;
    /** 演出总时长（tick，最后熄灭 + 收尾缓冲）。 */
    duration: number;
}
/** 谱项在回放中的三态：未判定 / 命中 / 未命中。 */
export type ItemState = 'pending' | 'hit' | 'miss';
/** 游戏运行状态（index 层驱动，逻辑层提供转移函数）。 */
export interface GameState {
    /** 当前关卡序号。 */
    levelIndex: number;
    /** 各发射位装配（未装为 null）。 */
    assignments: (Assignment | null)[];
    /** 当前选中的发射位（无选中为 null）。 */
    selectedPad: number | null;
    /** setup 装配 / running 燃放 / done 结算。 */
    phase: 'setup' | 'running' | 'done';
    /** 回放时刻（tick，仅 running/done 有意义）。 */
    time: number;
    /** 本场模拟结果（点火后存在）。 */
    result: ShowResult | null;
    /** 本关点火尝试次数（计分惩罚用）。 */
    attempts: number;
}
/**
 * mulberry32 种子随机（与其它游戏同款约定）：同种子序列一致。
 * @param seed - 种子整数。
 * @returns 返回 [0,1) 均匀伪随机的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 风偏偏移：风关卡的奇数位点火后额外 +10 tick（1 秒）才升空。
 * @param level - 关卡。
 * @param pad - 发射位下标。
 * @returns 该位的风偏 tick 数。
 */
export declare function windShift(level: LevelData, pad: number): number;
/**
 * 一个装配的实际绽放时刻：延时 + 升空 + 风偏（全部 tick）。
 * @param level - 关卡。
 * @param assignment - 装配。
 * @returns 绽放 tick。
 */
export declare function burstTick(level: LevelData, assignment: Assignment): number;
/**
 * 判定单个 sync 谱项：tick 时刻颜色×形状同时在放的朵数 ≥ count。
 * 可见窗口 [burst, end)（含绽放瞬间、不含熄灭瞬间）。
 * @param item - 谱项。
 * @param events - 全部绽放事件。
 * @returns 是否命中。
 */
export declare function syncSatisfied(item: SpectrumItem, events: BurstEvent[]): boolean;
/**
 * 判定单个 lastFall 谱项：全场最晚熄灭的事件中存在该形状（同刻并列算命中）。
 * @param item - 谱项。
 * @param events - 全部绽放事件。
 * @returns 是否命中。
 */
export declare function lastFallSatisfied(item: SpectrumItem, events: BurstEvent[]): boolean;
/** 判定单个谱项（按 kind 分派）。 */
export declare function itemSatisfied(item: SpectrumItem, events: BurstEvent[]): boolean;
/**
 * 模拟一场演出：装配 → 绽放事件序列 → 逐谱项判定。
 * @param level - 关卡。
 * @param assignments - 每个发射位的装配（缺失的位跳过不发射）。
 * @returns 模拟结果（事件按绽放时刻升序）。
 */
export declare function simulateShow(level: LevelData, assignments: (Assignment | null)[]): ShowResult;
/**
 * 谱项的回放三态：sync 到达判定时刻后按命中冻结；lastFall 结算后判定。
 * @param state - 游戏状态（须已点火）。
 * @param index - 谱项下标。
 * @returns pending / hit / miss。
 */
export declare function itemStateAt(state: GameState, index: number): ItemState;
/**
 * 新建一局：发射位全空，默认选中 0 号位，setup 阶段。
 * @param levelIndex - 关卡序号（0 起，越界钳制）。
 * @returns 初始状态。
 */
export declare function newGame(levelIndex: number): GameState;
/**
 * 为发射位选配方（沿用原延时，默认 0 秒）。
 * @param state - 游戏状态。
 * @param pad - 发射位下标。
 * @param recipeId - 配方 id。
 * @returns 是否生效。
 */
export declare function setPadRecipe(state: GameState, pad: number, recipeId: string): boolean;
/**
 * 设置发射位引信延时（钳制 0-5 整秒；位上已有配方才生效）。
 * @param state - 游戏状态。
 * @param pad - 发射位下标。
 * @param delay - 延时秒。
 * @returns 是否生效。
 */
export declare function setPadDelay(state: GameState, pad: number, delay: number): boolean;
/**
 * 点火：全部发射位装配完毕才进入燃放，模拟并开始回放。
 * @param state - 游戏状态。
 * @returns 是否点火成功。
 */
export declare function ignite(state: GameState): boolean;
/**
 * 回放推进：running 阶段前进 tick，到达总时长进入 done 结算。
 * @param state - 游戏状态。
 * @param ticks - 前进 tick 数（0.1s 粒度）。
 * @returns 状态是否变化。
 */
export declare function step(state: GameState, ticks: number): boolean;
/**
 * 计分：谱项命中 + 关卡底分 + 用时奖励，多次点火扣分，下限 100。
 * @param levelIndex - 关卡序号（0 起）。
 * @param hits - 命中谱项数。
 * @param durationTicks - 演出总时长（tick）。
 * @param attempts - 点火尝试次数。
 * @returns 得分。
 */
export declare function computeScore(levelIndex: number, hits: number, durationTicks: number, attempts: number): number;
/**
 * 谱项的玩家可读文案（目标谱清单与帮助面板用）。
 * @param item - 谱项。
 * @returns 中文描述一行。
 */
export declare function describeItem(item: SpectrumItem): string;
/** 夜空装饰星点（seed 重放用）。 */
export interface Star {
    /** 逻辑 x。 */
    x: number;
    /** 逻辑 y。 */
    y: number;
    /** 尺寸（半径）。 */
    size: number;
    /** 闪烁相位（0-1）。 */
    phase: number;
}
/**
 * 某关的装饰星点：种子 = 全局种子 + 关卡序号，同关必同星，换关必换景。
 * @param levelIndex - 关卡序号。
 * @param count - 星点数（默认 40）。
 * @returns 星点数组。
 */
export declare function starsForLevel(levelIndex: number, count?: number): Star[];
