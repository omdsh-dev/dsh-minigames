/**
 * 兔子育种 BunnyBreed 纯逻辑：孟德尔双基因育种谜题。毛色等位 B/b（B 黑
 * 显性、b 褐隐性）、毛型等位 S/s（S 短显性、s 长隐性）；每只兔子基因型
 * 可见（如 Bb Ss），玩家选两只亲本繁殖，每窝 4 仔按 Punnett 16 格等概率
 * 分离组合（随机走注入 mulberry32 种子，确定性可复放）。兔舍容量固定，
 * 超容必须放归且放归不可找回；代数预算用尽未达标判负。关卡从单基因纯合
 * 递进到双基因指定基因型、再到两只指定基因型同时在场，起始兔群更杂、
 * 容量更紧。无 DOM、无副作用，全部函数可在 vitest 中直接验证。
 */
/** 毛色基因座等位对：BB 纯合黑 / Bb 杂合黑 / bb 纯合褐。 */
export type ColorPair = 'BB' | 'Bb' | 'bb';
/** 毛型基因座等位对：SS 纯合短 / Ss 杂合短 / ss 纯合长。 */
export type FurPair = 'SS' | 'Ss' | 'ss';
/** 一只兔子的完整基因型（两个独立遗传的基因座）。 */
export interface Genes {
    /** 毛色等位对。 */
    color: ColorPair;
    /** 毛型等位对。 */
    fur: FurPair;
}
/** 目标基因座的判定规格：精确等位对、显性表现型（black/short）或任意。 */
export type ColorSpec = 'BB' | 'Bb' | 'bb' | 'black' | 'any';
export type FurSpec = 'SS' | 'Ss' | 'ss' | 'short' | 'any';
/** 一条育种目标：两基因座各自的匹配规格。 */
export interface TargetSpec {
    /** 毛色规格。 */
    color: ColorSpec;
    /** 毛型规格。 */
    fur: FurSpec;
}
/** 一只在场兔子：稳定 id（放归即消失，不可找回）与基因型。 */
export interface Rabbit {
    /** 兔舍内唯一 id（自增分配）。 */
    id: number;
    /** 基因型。 */
    genes: Genes;
}
/** 一关的静态数据：容量、代数预算、起始兔群与目标（target2 非空为双目标）。 */
export interface LevelData {
    /** 0 起的关卡下标。 */
    level: number;
    /** 兔舍容量（在场兔数上限）。 */
    capacity: number;
    /** 代数预算：最多可配种的次数。 */
    genLimit: number;
    /** 起始兔群基因型（不满足任何目标）。 */
    start: Genes[];
    /** 目标一。 */
    target: TargetSpec;
    /** 目标二（仅第 5 关非空：两只指定基因型同时在场）。 */
    target2: TargetSpec | null;
}
/** 游戏进行态（index 层持有，逻辑层提供操作函数）。 */
export interface GameState {
    /** 当前关卡数据。 */
    data: LevelData;
    /** 在场兔子（顺序即兔舍槽位顺序）。 */
    rabbits: Rabbit[];
    /** 已选亲本 id 列表（0-2 个，配种需要恰好 2 个）。 */
    selected: number[];
    /** 已用代数（配种次数）。 */
    breeds: number;
    /** 本关累计放归只数（计分惩罚）。 */
    releases: number;
    /** play 进行中 / won 目标达成 / failed 代数用尽未达标。 */
    phase: 'play' | 'won' | 'failed';
    /** 下一只兔子的 id。 */
    nextId: number;
}
/** 每窝仔兔数。 */
export declare const LITTER_SIZE = 4;
/** 总关卡数。 */
export declare const LEVEL_COUNT = 5;
/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供配种与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 等位对拆成两个配子（减数分离）。
 * @param pair - 等位对。
 * @returns 两个配子（各一个等位）。
 */
export declare function gametes(pair: ColorPair | FurPair): [string, string];
/**
 * 两个配子受精结合成等位对（显性大写在前，规范序）。
 * @param a1 - 配子一。
 * @param a2 - 配子二。
 * @returns 规范化的等位对。
 */
export declare function combine(a1: string, a2: string): ColorPair | FurPair;
/**
 * 双亲 Punnett 方格：两基因座独立分离组合，共 4x4=16 格子代基因型。
 * @param a - 亲本 A 基因型。
 * @param b - 亲本 B 基因型。
 * @returns 16 个子代基因型（每格等概率）。
 */
export declare function punnettGrid(a: Genes, b: Genes): Genes[];
/**
 * 每窝 4 仔：每仔独立从 Punnett 16 格中等概率抽一格。
 * @param rng - 注入的随机函数。
 * @param a - 亲本 A 基因型。
 * @param b - 亲本 B 基因型。
 * @param count - 仔数（默认 LITTER_SIZE）。
 * @returns 仔兔基因型列表。
 */
export declare function litterOf(rng: () => number, a: Genes, b: Genes, count?: number): Genes[];
/** 子代可能基因型统计（预览面板用）。 */
export interface OffspringStat {
    /** 基因型展示串（如 Bb Ss）。 */
    label: string;
    /** 16 格中占格数。 */
    count: number;
    /** 概率（count/16）。 */
    frac: number;
}
/**
 * 子代可能基因型频率表：按占格数降序、同数按字典序，供预览面板显示。
 * @param a - 亲本 A 基因型。
 * @param b - 亲本 B 基因型。
 * @returns 统计列表（频率合计 1）。
 */
export declare function offspringStats(a: Genes, b: Genes): OffspringStat[];
/**
 * 基因型转展示串（如 Bb Ss）。
 * @param g - 基因型。
 * @returns 形如 "Bb Ss" 的串。
 */
export declare function genesString(g: Genes): string;
/** 一只兔子的表现型描述。 */
export interface Phenotype {
    /** true 黑毛（color 非 bb），false 褐毛。 */
    black: boolean;
    /** true 长毛（fur 为 ss），false 短毛。 */
    longFur: boolean;
}
/**
 * 表现型映射（显隐性法则：B 对 b 显、S 对 s 显）。
 * @param g - 基因型。
 * @returns 表现型。
 */
export declare function phenotype(g: Genes): Phenotype;
/**
 * 基因型是否匹配一条育种目标。
 * @param g - 基因型。
 * @param spec - 目标规格。
 * @returns 匹配返回 true。
 */
export declare function matchesTarget(g: Genes, spec: TargetSpec): boolean;
/**
 * 是否已过关：单目标——任意在场兔匹配；双目标——两只不同在场兔分别
 * 匹配两条目标（同一只兔不能同时算两条）。
 * @param state - 游戏状态。
 * @returns 过关返回 true。
 */
export declare function isWinning(state: GameState): boolean;
/**
 * 构造一关（0 起下标，越界钳制）。
 * @param level - 0 起的关卡下标。
 * @returns 关卡数据。
 */
export declare function buildLevel(level: number): LevelData;
/**
 * 开局（或重开一关）：起始兔群入舍、无选中、0 代、进行中。
 * @param data - 关卡数据。
 * @returns 初始游戏状态。
 */
export declare function newGame(data: LevelData): GameState;
/**
 * 点兔切换亲本选中：已选中则取消；未选中且已选满 2 只时拒绝（先取消
 * 一只再换）。仅进行中可用。
 * @param state - 游戏状态。
 * @param id - 兔子 id。
 * @returns 切换成功返回 true。
 */
export declare function toggleSelect(state: GameState, id: number): boolean;
/**
 * 清空亲本选择。
 * @param state - 游戏状态。
 */
export declare function clearSelection(state: GameState): void;
/**
 * 配种：需进行中、恰好 2 只亲本、空位 ≥ 每窝 4 仔、代数未用尽。追加
 * 4 仔（自增 id）、代数 +1、清空选择；随后判胜（达成目标）或代数用尽
 * 判负。空位不足时先放归腾位。
 * @param state - 游戏状态。
 * @param rng - 注入的随机函数（每窝 4 次抽样，可复放）。
 * @returns 仔兔基因型列表；不满足前置条件返回 null。
 */
export declare function breed(state: GameState, rng: () => number): Genes[] | null;
/**
 * 放归：移除一只在场兔（不可找回）。仅进行中可用，且至少保留 2 只
 * （不足 2 只无法再配种）。若它已被选为亲本则同时取消选中。
 * @param state - 游戏状态。
 * @param id - 兔子 id。
 * @returns 放归成功返回 true。
 */
export declare function release(state: GameState, id: number): boolean;
/**
 * 计分：关底 + 关卡递进 + 剩余代数奖励 - 放归惩罚，下限 100。
 * @param level - 0 起关卡下标。
 * @param genLeft - 剩余代数。
 * @param releases - 累计放归只数。
 * @returns 得分。
 */
export declare function computeScore(level: number, genLeft: number, releases: number): number;
