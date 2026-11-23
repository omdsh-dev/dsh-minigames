/**
 * 翻棋暗战（Banqi）纯逻辑：4×8 半盘、红黑各 16 子全部暗扣。
 * 本模块无 DOM、无随机全局态——所有随机经注入的 mulberry32 种子驱动，
 * 因此洗牌、AI 决策与整局重放全部确定性可测。
 */
/** 棋手阵营：红方为人类，黑方为 AI。 */
export type Side = 'red' | 'black';
/** 棋子牌型（帅/仕/相/车/马/炮/兵）。 */
export type PieceType = 'shuai' | 'shi' | 'xiang' | 'che' | 'ma' | 'pao' | 'bing';
/** 一枚棋子：阵营 + 牌型 + 是否已翻开。 */
export interface Piece {
    side: Side;
    type: PieceType;
    revealed: boolean;
}
/** 一局棋的全部可变状态。board 按 index = row * 8 + col 存 32 格。 */
export interface BanqiState {
    board: (Piece | null)[];
    /** 当前行棋方。 */
    turn: Side;
    /** 已分出胜负时的胜方，否则 null。 */
    winner: Side | null;
    /** 已执行的动作数（含双方），用于复盘与动画节拍。 */
    ply: number;
}
/** 一手棋：翻开 index 处的暗子，或把 from 的亮子走到 to。 */
export type BanqiAction = {
    kind: 'flip';
    index: number;
} | {
    kind: 'move';
    from: number;
    to: number;
};
/** mulberry32：32 位种子 → [0,1) 确定性随机流。 */
export declare function mulberry32(seed: number): () => number;
/** 盘面常量：8 列 × 4 行。 */
export declare const COLS = 8;
export declare const ROWS = 4;
export declare const CELLS: number;
/** 各牌型吃子等级：帅>仕>相>车>马>兵；炮不入级（只可跳吃）。 */
export declare const RANK: Record<PieceType, number>;
/** 各牌型价值（AI 评估用）。 */
export declare const PIECE_VALUE: Record<PieceType, number>;
/** 每方牌型数量（共 16 子）。 */
export declare const SIDE_COUNTS: Record<PieceType, number>;
/** 各牌型 × 阵营的显示汉字。 */
export declare const PIECE_CHAR: Record<Side, Record<PieceType, string>>;
/**
 * 建立一局新棋：32 枚暗子按种子洗混后铺满 4×8 盘，红方先行。
 * @param seed 洗牌种子。
 * @returns 初始 BanqiState。
 */
export declare function createBanqiState(seed: number): BanqiState;
/** index 的行号（0-3）。 */
export declare function rowOf(index: number): number;
/** index 的列号（0-7）。 */
export declare function colOf(index: number): number;
/** index 的四个正交邻格（不出盘）。 */
export declare function orthogonalNeighbors(index: number): number[];
/**
 * 亮子吃子判定（炮的跳吃另行处理，不走本函数）。
 * 大吃小、同级互吃；例外：兵可吃帅、帅不可吃兵。
 * @param attacker 进攻方棋子。
 * @param defender 防守方棋子。
 * @returns 是否合法吃子。
 */
export declare function canCapture(attacker: Piece, defender: Piece): boolean;
/**
 * 一枚亮子的所有落点：正交一步进空格；非炮棋子可按等级邻近吃子；
 * 炮可隔恰好一子（任意阵营、含暗子）沿直线跳吃其后第一枚敌方亮子。
 * @param state 当前局面。
 * @param from 出发格。
 * @returns 可落到的目标格 index 数组（含吃子格）。
 */
export declare function moveTargets(state: BanqiState, from: number): number[];
/**
 * side 在当前局面下的全部合法动作：翻开任意暗子 + 己方亮子的全部落点。
 * @param state 当前局面。
 * @param side 行棋方。
 * @returns 动作数组，顺序确定（先全部翻子格，再按格序走子）。
 */
export declare function legalActions(state: BanqiState, side: Side): BanqiAction[];
/** side 在盘上的已知子数（暗子归属未知，不计入）。 */
export declare function knownPieces(state: BanqiState, side: Side): number;
/**
 * 执行一手棋（就地修改 state）：翻子或走子，随后换手并判定胜负。
 * 胜负判据：轮到的一方无任何合法动作（含被吃光）即负。
 * @param state 局面。
 * @param action 合法动作（调用方保证；非法动作返回 false 不改盘）。
 * @returns 动作是否被接受。
 */
export declare function applyAction(state: BanqiState, action: BanqiAction): boolean;
/**
 * AI 决策（黑方）：枚举全部合法动作，按"安全吃 / 躲避 / 保守翻"打分，
 * 分值并列由种子噪声打破——同一局面 + 同一种子必然得到同一手棋。
 * @param state 当前局面（轮到黑方）。
 * @param seed AI 随机种子。
 * @returns 选中的动作；无动作时返回 null。
 */
export declare function aiChooseAction(state: BanqiState, seed: number): BanqiAction | null;
/** 复制整个局面（深拷贝棋子），用于重放对比与预测。 */
export declare function cloneState(state: BanqiState): BanqiState;
