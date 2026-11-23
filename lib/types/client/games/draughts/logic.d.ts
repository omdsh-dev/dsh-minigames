/**
 * 国际跳棋（English Draughts）纯逻辑：8x8 盘面只用深色格，每方 12 子
 * 占前三排深色格。普通子只能斜前走一格；吃子为跳过相邻敌子落到其后
 * 空格，且必须连跳到底（每条吃法枚举为一条完整终局序列）；有吃必吃，
 * 多条吃法任选；到达对方底线立即升王，王可沿四个斜向走动与连跳；吃
 * 光对方或令对方无子可动者胜。跳吃过程中被吃棋子留在原位（不能二次
 * 跳过同一敌子），全部落定后才移除。AI 为 2 层极小极大 + 子力评估
 * （王=1.5 普通子 + 推进加权）+ mulberry32 种子噪声，同种子决策确定。
 * simulateGame 用种子驱动 AI 对 AI 完整对局，返回的走法序列可逐手重放。
 */
/** 一方：r = 红方（玩家，向上，升王行 0）；b = 黑方（AI，向下，升王行 7）。 */
export type Side = 'r' | 'b';
/** 一格内容：空串、普通子（小写）或王（大写）。 */
export type Piece = '' | 'r' | 'R' | 'b' | 'B';
/** 一条完整走法：起点、终点与沿途被吃的格子（静走时为空数组）。 */
export interface DraughtsMove {
    from: number;
    to: number;
    captures: number[];
}
/** 一局局面：64 格一维棋盘（行优先，sq = 行*8+列）与行动方。 */
export interface DraughtsPosition {
    board: Piece[];
    turn: Side;
}
/** 终局判定：进行中，或某方胜（吃光对方 / 对方无子可动）。 */
export type DraughtsOutcome = {
    kind: 'playing';
} | {
    kind: 'win';
    winner: Side;
};
/** AI 搜索层数（极小极大，2 = AI 一步 + 对方最佳应手后评估）。 */
export declare const AI_DEPTH = 2;
/** 深色格判定：只在此类格上行子。 */
export declare function isDark(sq: number): boolean;
/** 棋子所属方；空格返回 null。 */
export declare function sideOfPiece(p: Piece): Side | null;
/** 是否为王。 */
export declare function isKing(p: Piece): boolean;
/**
 * 初始局面：黑方（AI）占第 0-2 排深色格，红方（玩家）占第 5-7 排深色格。
 */
export declare function createStartPosition(): DraughtsPosition;
/**
 * 生成 side 在 board 上的全部合法走法：存在任一吃法时只返回完整吃法
 * 序列（有吃必吃），否则返回全部单步静走。
 */
export declare function movesForBoard(board: Piece[], side: Side): DraughtsMove[];
/**
 * 当前行动方的全部合法走法（含强制吃过滤）。
 */
export declare function legalMoves(pos: DraughtsPosition): DraughtsMove[];
/**
 * 应用走法并轮到对方；前置条件：move ∈ legalMoves(pos)。
 * @returns 新局面（原局面不变）。
 */
export declare function applyMove(pos: DraughtsPosition, m: DraughtsMove): DraughtsPosition;
/**
 * 终局判定：轮到走的一方无子或无合法走法，则判另一方胜。
 */
export declare function status(pos: DraughtsPosition): DraughtsOutcome;
/**
 * mulberry32 确定性伪随机源：同种子产生同一序列（注入 AI 噪声用）。
 * @param seed 32 位种子。
 * @returns 返回 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 子力评估（黑方视角）：普通子 1、王 1.5，普通子按推进深度加 0.02/行。
 * @returns 正值利黑方，负值利红方。
 */
export declare function evaluate(board: Piece[]): number;
/**
 * AI 选步：对每个根走法做 depth-1 层对手搜索，附加种子噪声打破平分
 * （同种子决策确定，不同种子可产生不同选择）。
 * @param pos 当前局面（轮到 AI）。
 * @param seed 噪声种子。
 * @returns 最佳走法，无合法走法时返回 null。
 */
export declare function chooseMove(pos: DraughtsPosition, seed: number): DraughtsMove | null;
/** 一场 AI 对 AI 模拟对局的结果。 */
export interface SimulatedGame {
    /** 胜方；步数耗尽按子力优势判定，接近均势判 'draw'。 */
    winner: Side | 'draw';
    /** 完整走法序列（可用 applyMove 逐手重放）。 */
    moves: DraughtsMove[];
    /** 终局面。 */
    final: DraughtsPosition;
}
/**
 * 种子驱动的完整对局模拟：每手用 seed+手数 派生种子调 chooseMove，
 * 同 seed 结果完全一致；步数耗尽按 evaluate 的子力差（>0.75）定胜负。
 * @param seed 对局种子。
 * @param maxPlies 步数上限（防长将循环，默认 400）。
 */
export declare function simulateGame(seed: number, maxPlies?: number): SimulatedGame;
