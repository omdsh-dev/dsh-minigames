/**
 * 织机穿梭 LoomWeave 纯逻辑：经线（每列一色，seed 洗牌的均衡多重集）+
 * 图案卡（M×N 目标色格）。玩家逐行织入纬线：每行选一种色线 + 起始偏移
 * （0-3，把固定的 over/under 基序列 [压,压,沉,沉] 整体循环移位）；
 * over 列显示纬线色、under 列显示经线色。织满 M 行后整幅对照目标：
 * 错色格数 = 误差，误差 ≤ 容差过关。全部随机走注入 seed（mulberry32），
 * 确定性可测；关卡由 buildLevel 生成（含可行解，误差 0 可达）。
 */
/** mulberry32 PRNG：同 seed 序列一致、值域 [0,1)。 */
export declare function mulberry32(seed: number): () => number;
/** 关卡总数。 */
export declare const LEVEL_COUNT = 5;
/** 每关规格：列数（经线数）/ 行数（纬线数）/ 色线种数 / 容差。 */
export interface LevelSpec {
    /** 经线列数 N。 */
    cols: number;
    /** 纬线行数 M。 */
    rows: number;
    /** 色线种数 C。 */
    colors: number;
    /** 允许的错色格数上限。 */
    tolerance: number;
}
/** 五关规格：列 4→7、行 4→7、色 2→4、容差 2→0（末关要求零误差）。 */
export declare const LEVEL_SPECS: readonly LevelSpec[];
/** 穿梭基序列周期：[压,压,沉,沉]（2/2 篮纹）。 */
export declare const WEAVE_PERIOD = 4;
/** 一行的一次织入选择：纬线色 + 起始偏移。 */
export interface RowChoice {
    /** 纬线色索引（0..colors-1）。 */
    color: number;
    /** 起始偏移（0..WEAVE_PERIOD-1）。 */
    offset: number;
}
/** 一关的完整数据（可织出目标：solution 的误差为 0）。 */
export interface LevelData {
    /** 0 起关卡序号。 */
    index: number;
    /** 列数。 */
    cols: number;
    /** 行数。 */
    rows: number;
    /** 色线种数。 */
    colors: number;
    /** 容差。 */
    tolerance: number;
    /** 每列经线色（长度 cols）。 */
    warp: number[];
    /** 目标图案（rows × cols 色格）。 */
    target: number[][];
    /** 生成时使用的可行解（织法参考，误差 0）。 */
    solution: RowChoice[];
}
/** 游戏阶段：织造中 / 过关 / 织满未达标。 */
export type Phase = 'play' | 'won' | 'failed';
/** 可变游戏状态（纯逻辑操作的目标）。 */
export interface GameState {
    /** 本关数据。 */
    data: LevelData;
    /** 已织入的行（自上而下）。 */
    woven: RowChoice[];
    /** 阶段。 */
    phase: Phase;
    /** 累计拆线次数（计分惩罚）。 */
    undos: number;
}
/**
 * 某列在给定起始偏移下是压过（over）还是沉入（under）。
 * 基序列 [压,压,沉,沉] 以 4 为周期，偏移整体循环移位。
 * @param col - 列号（0 起，可超过周期——按 (col - offset) mod 4 取基序列）。
 * @param offset - 起始偏移（0..3）。
 * @returns true = 压过经线（显示纬线色）。
 */
export declare function isOver(col: number, offset: number): boolean;
/**
 * 织一行的视觉色序列：over 列 = 纬线色，under 列 = 该列经线色。
 * @param data - 关卡数据（取 cols / warp）。
 * @param choice - 色线 + 偏移。
 * @returns 长度 cols 的色索引数组。
 */
export declare function rowColors(data: LevelData, choice: RowChoice): number[];
/**
 * 某行某选择与目标的错色格数。
 * @param data - 关卡数据。
 * @param rowIndex - 目标行号（0 起）。
 * @param choice - 待评选择。
 * @returns 错色格数（0..cols）。
 */
export declare function rowError(data: LevelData, rowIndex: number, choice: RowChoice): number;
/**
 * 贪心求解某行：穷举 色×偏移 取误差最小（并列取色小、偏移小）。
 * @param data - 关卡数据。
 * @param rowIndex - 目标行号（0 起）。
 * @returns 误差最小的选择。
 */
export declare function bestRow(data: LevelData, rowIndex: number): RowChoice;
/**
 * 生成一关：seed 决定经线洗牌与每行解（色 + 偏移），目标由解织出，
 * 因此误差 0 的解必然存在（容差 ≥ 0 恒可赢）。
 * @param level - 0 起关卡序号（越界按 clamp 处理）。
 * @param seed - 注入种子。
 * @returns 关卡数据。
 */
export declare function buildLevel(level: number, seed: number): LevelData;
/**
 * 以关卡数据开新局。
 * @param data - 关卡数据。
 * @returns 初始状态（play、零行、零拆线）。
 */
export declare function newGame(data: LevelData): GameState;
/**
 * 当前已织入部分的视觉色格（rows_so_far × cols）。
 * @param state - 游戏状态。
 * @returns 每行色索引数组（未织行不含在内）。
 */
export declare function clothColors(state: GameState): number[][];
/**
 * 已织入各行与目标的错色格总数（未织行不计）。
 * @param state - 游戏状态。
 * @returns 误差格数。
 */
export declare function computeError(state: GameState): number;
/**
 * 织入一行：play 阶段且未织满才有效；织满后按误差判定过关/失败。
 * @param state - 游戏状态（原地修改）。
 * @param choice - 色线 + 偏移。
 * @returns 'woven' 已织入（仍在织）；'won' 织满且达标；'failed' 织满未达标；
 * 'rejected' 阶段或行数不允许。
 */
export declare function weaveRow(state: GameState, choice: RowChoice): 'woven' | 'won' | 'failed' | 'rejected';
/**
 * 拆掉最上一行（won 阶段不允许；failed 拆线后回到 play 可改织）。
 * @param state - 游戏状态（原地修改）。
 * @returns true = 拆掉了一行。
 */
export declare function undoRow(state: GameState): boolean;
/**
 * 重织本关：清空已织行回到 play（拆线计数保留，作为计分惩罚）。
 * @param state - 游戏状态（原地修改）。
 */
export declare function resetLevel(state: GameState): void;
/**
 * 过关得分：关卡底分 + 误差 / 拆线惩罚，下限 50。
 * @param levelIndex - 0 起关卡序号。
 * @param error - 最终误差格数。
 * @param undos - 累计拆线次数。
 * @returns 得分。
 */
export declare function computeScore(levelIndex: number, error: number, undos: number): number;
