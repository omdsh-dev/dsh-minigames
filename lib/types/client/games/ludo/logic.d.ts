/**
 * 飞行棋（Ludo）纯逻辑：52 格环形跑道 + 各色 6 格终点直线（第 6 格即
 * 终点），每方 4 架飞机初始停机场。支持 2/3/4 人：玩家固定执红
 * （you），其余 1-3 家为 AI（ai 黄、blue 蓝、green 绿），经典四色布局
 * 起飞格红 40 / 黄 1 / 蓝 14 / 绿 27（各隔 13 格），安全格 = 各自起飞
 * 格 + 前方 8 步星格。掷 6 才能起飞（起飞后额外再掷一次）；棋子沿跑
 * 道按点数前进；落点若有敌子（非安全格）则将其全部送回机场；进入终点
 * 直线需精确点数到达第 6 格，超出部分原路反弹。
 *
 * 胜负：2 人制保留 3 局 2 胜；3/4 人单局定胜负——先让 4 架全部到终的
 * 方获胜即整场结束，其余名次按到终数量与剩余进度排序（standings）。
 * 轮换按经典逆时针 红→黄→蓝→绿，跳过已全部到终（获胜）的方。
 *
 * AI 为一层贪心 + 启发式（捕获 > 起飞 > 冲线 > 推进进度），候选打分
 * 混入 seed 派生的确定性噪声。所有随机（掷骰、AI 噪声）均由 seed
 * （mulberry32）派生：同一 seed 与同一操作序列必然得到同一状态。
 */
/** 一方标识：you 红方（玩家）/ ai 黄方 / blue 蓝方 / green 绿方（后三者为 AI）。 */
export type Side = 'you' | 'ai' | 'blue' | 'green';
/** 阶段：待掷骰 / 待行子 / 一局结束 / 整场结束。 */
export type LudoPhase = 'roll' | 'move' | 'roundOver' | 'matchOver';
/** 经典逆时针行棋顺序（红→黄→蓝→绿）。 */
export declare const SIDE_ORDER: readonly Side[];
/** 一场比赛的参战方（SIDE_ORDER 前 playerCount 个，you 恒在首位）。 */
export type PlaySides = readonly Side[];
/** 一步棋：piece 己方第几架（0-3），from/to 为棋子位置编码。 */
export interface LudoMove {
    piece: number;
    from: number;
    to: number;
    /** 是否为起飞（从机场进入起飞格）。 */
    takeoff: boolean;
    /** 被送回机场的敌机编号（相对其所属方数组下标）。 */
    captured: number[];
    /** 与 captured 平行：每架被捕获敌机的所属方。 */
    capturedSides: Side[];
}
/** 一场比赛的完整可测状态（JSON 可序列化纯数据）。 */
export interface LudoState {
    seed: number;
    /** 参战人数（2/3/4）。 */
    playerCount: number;
    /** 参战方列表（行棋顺序）。 */
    sides: Side[];
    /** 局号（从 1 起；2 人制最多 3 局，多人制恒为 1）。 */
    round: number;
    phase: LudoPhase;
    turn: Side;
    /** 本场掷骰次数（掷骰随机流的确定性计数器）。 */
    rollNo: number;
    /** 每方 4 架飞机的位置编码：-1 机场；0-50 跑道（相对己方起飞格的步数）；51-56 终点直线（56 = 终点）。 */
    pieces: Record<Side, number[]>;
    /** 最近一次掷出的骰面（待行子阶段非 null）。 */
    dice: number | null;
    /** 本回合掷出的是否为 6（行子后额外再掷）。 */
    rolledSix: boolean;
    /** 最近一步落定的棋（渲染回程动画用）。 */
    lastMove: LudoMove | null;
    /** 本局胜者（roundOver / matchOver 时非 null）。 */
    roundWinner: Side | null;
    roundWinsYou: number;
    roundWinsAi: number;
    matchWinner: Side | null;
    message: string;
}
/** 环形跑道长度。 */
export declare const RING_LEN = 52;
/** 终点直线长度（第 6 格即终点）。 */
export declare const HOME_LEN = 6;
/** 跑道上最后一格的步数（0-50 共 51 格）。 */
export declare const RING_LAST = 50;
/** 终点格的位置编码。 */
export declare const GOAL_POS: number;
/** 每方飞机数。 */
export declare const PLANES = 4;
/** 2 人制夺冠所需局数（3 局 2 胜）。 */
export declare const ROUNDS_TO_WIN = 2;
/** 己方起飞格在环上的绝对下标（红 40 / 黄 1 / 蓝 14 / 绿 27）。 */
export declare const START_INDEX: Record<Side, number>;
/** 己方安全格（起飞格 + 己色星格，即起飞格前方 8 步）的绝对下标集合。 */
export declare const SAFE_CELLS: Record<Side, number[]>;
/** 未参战两色的安全格下标——该对局无人使用，作普通格。 */
export declare const NEUTRAL_SAFE_CELLS: number[];
/** 各方中文名（消息文案用）。 */
export declare const SIDE_NAME: Record<Side, string>;
/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 32 位种子。
 * @returns 返回 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 棋子在步数 s（0-50）时所处的环上下标（相对己方起飞格顺时针）。
 * @param side - 哪一方。
 * @param s - 跑道步数（0-50）。
 * @returns 环上绝对下标（0-51）。
 */
export declare function ringIndexFor(side: Side, s: number): number;
/**
 * 安全格归属：只统计参战方（active）的安全格，未参战色的格作普通格。
 * @param ringIdx - 环上绝对下标。
 * @param active - 参战方列表；缺省按经典 2 人制（红/黄）。
 * @returns 归属方，普通格返回 null。
 */
export declare function safeOwner(ringIdx: number, active?: PlaySides): Side | null;
/**
 * 新建一整场比赛的初始状态（第 1 局、红方先行、全部飞机在机场）。
 * @param seed - 32 位随机种子。
 * @param playerCount - 参战人数（2/3/4，缺省 2 与经典红黄对局一致）。
 * @returns 初始 LudoState。
 */
export declare function createLudo(seed: number, playerCount?: number): LudoState;
/**
 * 下一行棋方：按 sides 顺序循环，跳过已全部到终（获胜）的方。
 * @param state - 当前比赛状态（不修改）。
 * @param from - 当前行棋方。
 * @returns 下一个应行棋的方。
 */
export declare function nextTurnSide(state: LudoState, from: Side): Side;
/**
 * 掷骰：由 seed 与 rollNo 确定性生成骰面，进入待行子阶段；若掷完
 * 无任何合法着法则直接过手（骰面与原因写入 message）。
 * @param state - 就地修改的比赛状态（须处于 roll 阶段）。
 * @returns 掷出的骰面（1-6）。
 */
export declare function rollFor(state: LudoState): number;
/**
 * 指定骰面下一方的全部合法着法：机场机需 6 起飞；落点为己方安全格
 * 或终点直线恒合法；落点为敌方安全格非法；落点为普通跑道格时若有
 * 敌机（任意参战敌方的飞机）则全部捕获。终点第 6 格需精确到达，超
 * 出反弹（112 - 目标）。
 * @param state - 当前比赛状态（不修改）。
 * @param side - 行子方。
 * @param die - 骰面（1-6）。
 * @returns 合法着法列表。
 */
export declare function legalMovesFor(state: LudoState, side: Side, die: number): LudoMove[];
/**
 * 落实一步棋（就地修改）：起飞或前移、捕获敌机回机场、检查该局与
 * 整场胜负；掷 6（含起飞）行子后同一方额外再掷，否则按经典逆时针
 * 轮换（跳过已获胜方）。2 人制保留 3 局 2 胜；多人制先全部到终者
 * 直接赢下整场。
 * @param state - 比赛状态（须处于 move 阶段且 move 合法）。
 * @param side - 行子方。
 * @param move - 要落实的着法（captured 与 capturedSides 平行）。
 */
export declare function applyPieceMove(state: LudoState, side: Side, move: LudoMove): void;
/** 一方已到达终点（位置 56）的飞机数。 */
export declare function finishedCount(state: LudoState, side: Side): number;
/** 一方总进度（各机位置编码 + 1 求和；到终 56 计 57、机场计 0）。 */
export declare function progressOf(state: LudoState, side: Side): number;
/**
 * 名次排序：先按到终架数降序，再按总进度降序（matchWinner 恒居首）。
 * @param state - 当前比赛状态。
 * @returns 参战方按名次排序的列表。
 */
export declare function standings(state: LudoState): Side[];
/**
 * 通用贪心选步（玩家按空格自动走、AI 均用此函数）：打分 = 捕获 100 +
 * 冲线 80 + 起飞 60 + 推进进度 40 * to/56 + 入终点直线 20，叠加由
 * (seed, rollNo, piece) 派生的确定性噪声（幅度 6）。
 * @param state - 比赛状态（须处于 move 阶段）。
 * @param side - 行子方。
 * @returns 打分最高的合法着法，无合法着法返回 null。
 */
export declare function chooseMove(state: LudoState, side: Side): LudoMove | null;
/** AI 选步：与 {@link chooseMove} 相同，固定取当前回合方。 */
export declare function aiChooseMove(state: LudoState): LudoMove | null;
/**
 * 一局结束后开下一局（仅 2 人制会进入 roundOver）：清空棋子、局号加
 * 一、先手在两方间交替（第 1 局红先、第 2 局黄先、第 3 局红先）。
 * @param state - 处于 roundOver 的比赛状态（就地修改）。
 */
export declare function nextRound(state: LudoState): void;
