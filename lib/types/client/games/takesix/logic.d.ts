/**
 * 牛头王 TakeSix（6 nimmt! 简化，1v1 对 AI）纯逻辑：104 张牌面值 1-104，
 * 由注入 seed（mulberry32）确定性抽 24 张——双方各 10 张手牌 + 4 张开行
 * 首牌。每回合双方各出一张暗牌同时翻开，牌面小者先放：放入「行尾小于
 * 该牌且最接近」的行；行内已有 5 张时再放入第 6 张则整行收走计罚分、
 * 该牌单独开新行；若牌比所有行尾都小，出牌方自选一行收走、该牌开新
 * 行。10 回合后本局罚分少者胜，3 局积分定胜负。
 *
 * 所有操作直接修改传入 state（全部字段为 JSON 可序列化纯数据）；随机
 * 源全部由 seed 派生，同一 seed 与同一操作序列必然得到同一状态，可脱离
 * DOM 直接模拟与序列化重放。
 */
/** 行数（开行首牌固定 4 张）。 */
export declare const ROW_COUNT = 4;
/** 行内已有的牌数上限；再放一张（第 6 张）即整行收走。 */
export declare const ROW_FULL = 5;
/** 每方每局手牌数（也是每局回合数）。 */
export declare const HAND_SIZE = 10;
/** 整场比赛局数。 */
export declare const ROUND_COUNT = 3;
/** 牌面最大值（牌面 1-104）。 */
export declare const DECK_MAX = 104;
/** 一方标识：you 玩家 / ai 电脑。 */
export type Side = 'you' | 'ai';
/** 对局阶段：出牌 / 玩家选收行 / 一局结束 / 比赛结束。 */
export type TakeSixPhase = 'pick' | 'chooseRow' | 'roundOver' | 'matchOver';
/** 一张牌落位的结果：追加 / 触发整行收走 / 需要出牌方自选收行。 */
export type PlaceOutcome = {
    kind: 'placed';
    row: number;
} | {
    kind: 'collect';
    row: number;
    heads: number;
} | {
    kind: 'choose';
};
/** 渲染动画用事件（每次出牌/选行后整体替换或追加）。 */
export type TakeSixEvent = {
    kind: 'reveal';
    youCard: number;
    aiCard: number;
} | {
    kind: 'placed';
    side: Side;
    row: number;
    card: number;
} | {
    kind: 'collect';
    side: Side;
    row: number;
    cards: number[];
    heads: number;
};
/** 一场比赛的完整可测状态（纯数据，可 JSON 序列化重放）。 */
export interface TakeSixState {
    /** 基础种子（R 重开换种子；各局由局号派生洗牌种子）。 */
    seed: number;
    /** 局号，1..ROUND_COUNT。 */
    round: number;
    phase: TakeSixPhase;
    /** 本局回合序号（0 起，已完成的回合数）。 */
    turn: number;
    /** 4 行牌列，行内严格递增。 */
    rows: number[][];
    /** 玩家剩余手牌（升序）。 */
    yourHand: number[];
    /** AI 剩余手牌（升序）。 */
    aiHand: number[];
    /** 本局双方罚分（牛头数累计）。 */
    penaltyYou: number;
    penaltyAi: number;
    /** 三局累计罚分（总局数平局时破同）。 */
    totalYou: number;
    totalAi: number;
    /** 已赢局数。 */
    roundWinsYou: number;
    roundWinsAi: number;
    /** 上一局胜者（罚分打平为 null）。 */
    roundWinner: Side | null;
    /** 比赛胜者（未结束或全平为 null）。 */
    matchWinner: Side | null;
    /** chooseRow 阶段待落位的玩家牌。 */
    pendingYouCard: number | null;
    /** 本回合已翻开的双方牌面（选行/动画用）。 */
    revealedYou: number | null;
    revealedAi: number | null;
    /** 本回合 AI 的牌是否已落位（chooseRow 补结算用）。 */
    aiSettled: boolean;
    /** 最近一次动作产生的事件序列（动画定位用）。 */
    events: TakeSixEvent[];
}
/**
  * mulberry32 确定性随机数发生器：同 seed 产生同一 [0,1) 序列。
  * @param seed - 32 位整数种子。
  * @returns 返回 [0,1) 随机数的函数。
  */
export declare function mulberry32(seed: number): () => number;
/**
  * 一张牌的牛头数：55=7；双同数（11/22/…/99）=5；10 的倍数=3；
  * 其余 5 的倍数=2；其他=1。
  * @param card - 牌面 1-104。
  * @returns 牛头数。
  */
export declare function bullheads(card: number): number;
/**
  * 一行牌的牛头总数。
  * @param row - 行内牌面数组。
  * @returns 牛头数之和。
  */
export declare function rowHeads(row: number[]): number;
/**
  * 各行行尾（最后一张）牌面。
  * @param rows - 行牌列。
  * @returns 每行的行尾牌面。
  */
export declare function rowEnds(rows: number[][]): number[];
/**
  * 牌的目标行：行尾小于该牌的行里行尾最大（最接近）的一行。
  * @param rows - 行牌列。
  * @param card - 待放置牌面。
  * @returns 行下标；比所有行尾都小则为 null。
  */
export declare function targetRow(rows: number[][], card: number): number | null;
/**
  * AI 被迫收行时的行选择：牛头最少优先，平局取牌更多（拆掉危险长行），
  * 再平局取下标小（完全确定，无随机）。
  * @param rows - 行牌列。
  * @returns 收走的行下标。
  */
export declare function aiChooseRow(rows: number[][]): number;
/**
  * 开一场新比赛。
  * @param seed - 基础种子。
  * @returns 第 1 局就绪的初始状态。
  */
export declare function createGame(seed: number): TakeSixState;
/**
  * AI 出牌决策（贪心 + seed 噪声）：模拟每张手牌的落位代价——安全
  * 追加 0 分；踩满 5 张的行或比所有行尾小按对应行牛头计；把行正好
  * 填到 5 张（给对手埋雷）小减分。噪声由 seed 派生，同状态必同选。
  * @param state - 当前状态（不修改）。
  * @returns AI 手牌中的一张。
  */
export declare function aiPickCard(state: TakeSixState): number;
/**
  * 玩家从手牌出一张牌：同时计算 AI 的暗牌，双方牌一起翻开，牌面小者
  * 先落位。若玩家的牌需要自选收行，状态停在 chooseRow（pendingYouCard
  * 记牌、aiSettled 记 AI 是否已放），其选行后在 chooseRow 里补完。
  * @param state - 就地修改的状态。
  * @param card - 玩家手牌中的一张。
  */
export declare function playCard(state: TakeSixState, card: number): void;
/**
  * chooseRow 阶段玩家选定收走的行：该行牛头计入罚分，待落位的玩家牌
  * 开新行；若 AI 本回合尚未落位（玩家先放场景）则随后补完并收尾。
  * @param state - 就地修改的状态。
  * @param row - 收走的行下标 0-3。
  */
export declare function chooseRow(state: TakeSixState, row: number): void;
/**
  * roundOver 后开下一局：本局罚分清零、重抽 24 张。
  * @param state - 就地修改的状态。
  */
export declare function startNextRound(state: TakeSixState): void;
