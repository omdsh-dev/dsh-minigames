/**
 * 骰子彩窗 DiceGrid 纯逻辑：Sagrada 式骰子放置谜题（简化版）。
 *
 * 盘面 4×4 彩窗网格；seed 注入（mulberry32）先生成一张合法满盘作为
 * 隐藏解，再从解出发派生预置约束（色点/数字/奇偶/≥4），保证盘面必定
 * 可解——测试可用 solutionPlacements 回放整条放置序列验证。骰子袋由
 * 解骰 + 填充骰洗混而成，逐轮发出 3-4 颗候选；放不进可弃骰（扣分），
 * 因此永无死局。全部随机走注入 seed，不含 DOM / canvas 依赖。
 *
 * 冲突规则（注意易误解点）：点数看整行整列（数独式不重复）；颜色只看
 * 上下左右正交相邻格（Sagrada 式）。若颜色也按整行整列不重复，则
 * 4 格的行需要 4 种互异颜色，2-3 色关卡在数学上无解。
 */
/** 逻辑盘面边长（4×4 固定）。 */
export declare const GRID = 4;
/** 总格数。 */
export declare const CELLS: number;
/** 关卡总数。 */
export declare const LEVEL_COUNT = 5;
/** 骰子最大点数。 */
export declare const MAX_VALUE = 6;
/** 一颗骰子：颜色索引（0 起，映射见渲染层）+ 点数（1-6）。 */
export interface Die {
    color: number;
    value: number;
}
/** 预置约束：该格只接受满足条件的骰子。 */
export type Constraint = {
    kind: 'color';
    color: number;
} | {
    kind: 'value';
    value: number;
} | {
    kind: 'odd';
} | {
    kind: 'even';
} | {
    kind: 'gt3';
};
/** 一个彩窗格：预置约束（可空）与已放骰子（可空）。 */
export interface Cell {
    constraint: Constraint | null;
    die: Die | null;
}
/** 关卡难度参数。 */
export interface LevelConfig {
    /** 本关骰子颜色种数（2 → 3 → 4 递进）。 */
    colors: number;
    /** 预置约束格数量（逐关增多）。 */
    fixedCells: number;
    /** 每轮发出的候选骰数量（3-4）。 */
    rackSize: number;
}
/** 一局游戏的完整可变状态（逻辑层视角，渲染层另持 UI 态）。 */
export interface DiceGameState {
    level: number;
    seed: number;
    board: Cell[][];
    /** 隐藏解（generateBoard 生成，保证可行）。 */
    solution: Die[][];
    /** 骰子袋（ upcoming 顺序）。 */
    bag: Die[];
    /** 当前候选骰架。 */
    rack: Die[];
    discarded: number;
    placed: number;
    won: boolean;
    /** 发骰随机源（由 seed + 关卡派生，进程内确定性）。 */
    rng: () => number;
}
/**
 * mulberry32 种子随机数发生器（确定性，[0, 1)）。
 * @param seed - 非负整数种子。
 * @returns 产生同 seed 下同一 [0,1) 序列的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 关卡难度表：颜色 2,2,3,3,4；约束格 3→7；每轮候选 3→4。
 * @param level - 1 起的关卡号（1..LEVEL_COUNT，越界取边界值）。
 * @returns 该关的颜色数 / 约束格数 / 候选数。
 */
export declare function levelConfig(level: number): LevelConfig;
/**
 * 约束求值：骰子是否满足预置条件。
 * @param constraint - 预置约束。
 * @param die - 待检查骰子。
 * @returns 满足返回 true。
 */
export declare function satisfiesConstraint(constraint: Constraint, die: Die): boolean;
/**
 * 随机骰子（不检查任何约束）。
 * @param rng - 随机源。
 * @param colors - 颜色种数。
 * @returns 一颗随机骰。
 */
export declare function randomDie(rng: () => number, colors: number): Die;
/**
 * 生成一关：先造隐藏解，再挑 fixedCells 个格子派生与解一致的预置约束，
 * 最后把 16 颗解骰 + 填充骰洗混成骰子袋。同 (level, seed) 结果确定。
 * @param level - 关卡号（1 起）。
 * @param seed - 种子。
 * @returns 尚未发候选的初始状态（需再调 dealRound）。
 */
export declare function generateBoard(level: number, seed: number): DiceGameState;
/**
 * 创建一局并发出第一轮候选。
 * @param level - 关卡号（1 起）。
 * @param seed - 种子。
 * @returns 就绪状态。
 */
export declare function createGame(level: number, seed: number): DiceGameState;
/**
 * 发一轮候选骰：从骰子袋取 rackSize 颗；袋存量不足时先补 10 颗随机骰，
 * 因此永远发得出（弃骰永远可用，游戏无死局）。
 * @param state - 游戏状态（原地修改 rack/bag）。
 */
export declare function dealRound(state: DiceGameState): void;
/**
 * 合法放置判定：空格 + 预置约束满足 + 整行整列无同点数 + 正交相邻无同色。
 * @param state - 游戏状态。
 * @param r - 行（0 起）。
 * @param c - 列（0 起）。
 * @param die - 待放骰子。
 * @returns 可放返回 true。
 */
export declare function canPlaceDie(state: DiceGameState, r: number, c: number, die: Die): boolean;
/**
 * 放置候选骰架上的第 rackIndex 颗骰子。
 * @param state - 游戏状态（原地修改）。
 * @param rackIndex - 候选索引（0 起）。
 * @param r - 目标行。
 * @param c - 目标列。
 * @returns 非法放置返回 false；成功放置消耗候选，放满 16 格判胜，
 * 骰架空则自动补发一轮。
 */
export declare function placeDie(state: DiceGameState, rackIndex: number, r: number, c: number): boolean;
/**
 * 弃掉候选骰架上的第 rackIndex 颗骰子（计分惩罚；骰架空自动补发）。
 * @param state - 游戏状态（原地修改）。
 * @param rackIndex - 候选索引（0 起）。
 * @returns 越界返回 false。
 */
export declare function discardDie(state: DiceGameState, rackIndex: number): boolean;
/**
 * 隐藏解的可行放置序列（行优先顺序）：因为整张解盘全局一致，任意子集
 * 也一致，按此序列逐颗放置必然每步合法直至放满。
 * @param solution - generateBoard 返回的解盘。
 * @returns 逐格放置步骤（含行、列、骰）。
 */
export declare function solutionPlacements(solution: Die[][]): {
    r: number;
    c: number;
    die: Die;
}[];
/**
 * 过关得分：基础分 + 关卡加成 − 弃骰惩罚（每颗 3 分，下限 0）。
 * @param level - 关卡号。
 * @param discarded - 弃骰数。
 * @returns 得分。
 */
export declare function computeScore(level: number, discarded: number): number;
