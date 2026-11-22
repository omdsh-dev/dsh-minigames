/**
 * 达芬奇密码（Davinci Code，1v1 对 AI）纯逻辑：数字牌 0-11 各白/黑两张
 * 共 24 张（黑 0 带短横线与白 0 区分），mulberry32 确定性洗牌后各摸 4 张
 * 按升序排成一列（同值白在黑前、短横在后），其余入公共牌堆。回合可选
 * 摸一张按序插入，再猜对手某个位置的数值：猜对翻开该牌并可继续行动，
 * 猜错自己翻开一张与所猜数值最接近的牌并结束回合；一方整手牌全部被
 * 翻开即输掉一局，3 局 2 胜。AI 记忆双方已翻开的牌，按排除法从候选集
 * 里挑选目标（局数越高越充分利用邻居牌的排序边界收窄候选）。
 *
 * 所有操作直接修改传入 state；随机源全部由 seed 派生，同一 seed 与同一
 * 操作序列必然得到同一状态，可脱离 DOM 直接模拟与序列化重放。
 */
/** 每方起始手牌数。 */
export declare const START_HAND = 4;
/** 夺冠所需局数（3 局 2 胜）。 */
export declare const ROUNDS_TO_WIN = 2;
/** 牌色：w 白 / b 黑。 */
export type CardColor = 'w' | 'b';
/** 一张数字牌：0-11 各白黑两张，黑 0 带短横线（dash）。 */
export interface DavinciCard {
    /** 数值 0-11。 */
    value: number;
    /** 颜色：w 白 / b 黑。 */
    color: CardColor;
    /** 是否短横牌（仅黑 0 为 true）。 */
    dash: boolean;
}
/** 一方标识：you 玩家 / ai 电脑。 */
export type Side = 'you' | 'ai';
/** 阶段：对局中 / 一局结束 / 比赛结束。 */
export type DavinciPhase = 'playing' | 'roundOver' | 'matchOver';
/** 日志条目：摸牌 / 猜测（含猜错时的被迫揭示）。 */
export type DavinciLogEntry = {
    kind: 'draw';
    by: Side;
} | {
    kind: 'guess';
    by: Side;
    index: number;
    value: number;
    correct: boolean;
};
/** 最近一次翻开事件（供渲染动画定位）。 */
export interface RevealEvent {
    /** 被翻开的牌属于哪一方。 */
    side: Side;
    /** 手牌中的位置。 */
    index: number;
    /** 翻开原因：猜对 target / 猜错被迫揭示 penalty。 */
    reason: 'target' | 'penalty';
}
/** 一场比赛的完整可测状态（全部为 JSON 可序列化的纯数据）。 */
export interface DavinciState {
    seed: number;
    /** 局号（从 1 起）。 */
    round: number;
    phase: DavinciPhase;
    turn: Side;
    /** 本局先手（奇数局你、偶数局对方）。 */
    roundStarter: Side;
    /** 己方手牌（恒为升序）。 */
    yourHand: DavinciCard[];
    /** 对方手牌（对玩家保密，翻开后可见）。 */
    aiHand: DavinciCard[];
    /** 己方手牌翻开标记（与 yourHand 平行）。 */
    revealedYou: boolean[];
    /** 对方手牌翻开标记（与 aiHand 平行）。 */
    revealedAi: boolean[];
    /** 公共牌堆（背面，顺序由洗牌决定）。 */
    pile: DavinciCard[];
    roundWinsYou: number;
    roundWinsAi: number;
    /** 比赛冠军（仅 matchOver 时非 null）。 */
    matchWinner: Side | null;
    /** 本回合已摸牌的一方。 */
    drew: Side | null;
    /** 已摸出待插入的牌（仅玩家侧使用）。 */
    pending: DavinciCard | null;
    log: DavinciLogEntry[];
    /** 最近一次翻开（供动画）。 */
    lastReveal: RevealEvent | null;
    message: string;
}
/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 32 位种子。
 * @returns 返回 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 牌的排序键：数值升序，同值白在黑前，短横牌（黑 0）在白 0 之后。
 * @param card - 牌。
 * @returns 全序比较键（牌组内两两不同）。
 */
export declare function sortKey(card: DavinciCard): number;
/**
 * 构造整副牌：0-11 各白黑两张共 24 张，黑 0 带短横线。
 * @returns 新建的牌组（按序排列）。
 */
export declare function buildDeck(): DavinciCard[];
/**
 * 原地升序排列一手牌（同值白在黑前、短横在后）。
 * @param cards - 手牌数组（原地修改）。
 */
export declare function sortHand(cards: DavinciCard[]): void;
/**
 * 洗牌（Fisher-Yates，按传入 rng 顺序）。
 * @param rng - 随机源。
 * @param cards - 数组（原地打乱）。
 */
export declare function shuffle(rng: () => number, cards: DavinciCard[]): void;
/**
 * 把牌插入手牌的合法位置集合：保持升序（含同值白前黑后）的全部下标。
 * @param hand - 已升序的手牌。
 * @param card - 待插入牌。
 * @returns 合法插入下标升序数组。
 */
export declare function legalInsertPositions(hand: readonly DavinciCard[], card: DavinciCard): number[];
/**
 * 开新比赛：第 1 局、双方各摸 4 张升序排列、其余 16 张入牌堆、你先手。
 * @param seed - 基础种子。
 */
export declare function createDavinci(seed: number): DavinciState;
/**
 * 玩家摸牌：从牌堆顶摸出一张挂到 pending，等待选择插入位置。
 * @param state - 当前状态。
 * @returns 条件不满足（非玩家回合 / 本回合已摸 / 牌堆空 / 非对局中）为 false。
 */
export declare function playerDraw(state: DavinciState): boolean;
/**
 * 把 pending 牌插入玩家手牌指定位置（校验合法性）。
 * @param state - 当前状态。
 * @param pos - 插入下标。
 * @returns 位置非法或无待插入牌为 false。
 */
export declare function playerInsert(state: DavinciState, pos: number): boolean;
/**
 * 摸牌并插入（测试与 AI 便捷路径）。
 * @param state - 当前状态。
 * @param side - 摸牌方。
 * @param pos - 插入下标（须为该牌的合法插入位置）。
 * @returns 任何一步非法为 false。
 */
export declare function drawAndInsert(state: DavinciState, side: Side, pos: number): boolean;
/**
 * 猜测一方手牌中对手指定位置的数值（只比数值，不比颜色）。
 * 猜对：翻开该牌、保留回合并可继续猜；猜错：翻开自己一张与所猜数值最
 * 接近的未翻开牌（同距取最靠前/最小者），回合交出。
 * @param state - 当前状态。
 * @param side - 猜测方。
 * @param index - 对手手牌位置。
 * @param value - 所猜数值 0-11。
 * @returns null 非法；true 猜对；false 猜错。
 */
export declare function guess(state: DavinciState, side: Side, index: number, value: number): boolean | null;
/**
 * 自己未翻开牌中与所猜数值最接近者的下标（同距取最靠前者，即排序最
 * 小的一张）。
 * @param state - 当前状态。
 * @param side - 被迫揭示的一方。
 * @param value - 所猜数值。
 * @returns 下标；无未翻开牌（不可能存活到此时）为 null。
 */
export declare function closestHiddenIndex(state: DavinciState, side: Side, value: number): number | null;
/**
 * 主动结束己方回合（猜对后可选择不再猜）。
 * @param state - 当前状态。
 * @param side - 结束方。
 * @returns 非该方回合或非对局中为 false。
 */
export declare function endTurn(state: DavinciState, side: Side): boolean;
/**
 * 开下一局：重新洗牌发牌、先手交替。
 * @param state - 当前状态。
 * @returns 非一局结束阶段为 false。
 */
export declare function startNextRound(state: DavinciState): boolean;
/**
 * AI 视角的候选集：整副牌排除己方手牌与双方已翻开的牌，strict 时进一
 * 步用对手该位置两侧最近翻开牌的排序边界收窄（牌组内排序键两两不同，
 * 边界为严格不等号）。
 * @param state - 当前状态。
 * @param index - 对手（玩家）手牌位置。
 * @param strict - 是否应用邻居排序边界。
 * @returns 候选牌数组（按排序键升序）。
 */
export declare function aiCandidates(state: DavinciState, index: number, strict: boolean): DavinciCard[];
/**
 * AI 一次猜测决策（纯函数）：未翻开位置中选一个目标再从候选集里按
 * seed 噪声取数值。第 1 局宽候选（不利用排序边界）；第 2 局起应用边
 * 界；第 3 局起选候选最少的位置（信息量最大）。
 * @param state - 当前状态。
 * @returns 目标位置与所猜数值。
 */
export declare function aiDecide(state: DavinciState): {
    index: number;
    value: number;
};
/**
 * AI 执行整个回合：约半数时候先摸牌插入中间合法位，随后反复猜测直到
 * 猜错、局终或噪声决定收手；全部随机由 seed 派生，可重放。
 * @param state - 当前状态。
 * @returns 是否执行了行动（非对方回合为 false）。
 */
export declare function aiTakeTurn(state: DavinciState): boolean;
/**
 * 序列化整场比赛状态（纯 JSON）。
 * @param state - 当前状态。
 */
export declare function serializeState(state: DavinciState): string;
/**
 * 反序列化状态：与 serializeState 互逆，用于克隆与重放。
 * @param json - serializeState 的输出。
 * @returns 重建的状态。
 */
export declare function deserializeState(json: string): DavinciState;
