/**
 * 侦探推理纯逻辑：简化双人 Clue —— 6 嫌疑人 × 6 凶器 × 9 房间共 21 张卡，
 * seed 抽出凶手/凶器/房间三张底牌，其余 18 张按 seed 洗牌后玩家与证人 AI
 * 各持 9 张。玩家在 3×3 房间棋盘上掷骰（1–3 步曼哈顿距离）移动；进入非
 * 中心房间可盘问（suggestion）：AI 手中有匹配卡则按发牌顺序亮出第一张
 * （该卡即被排除），没有则本次盘问三要素中不在玩家手里的卡必为底牌
 * （锁定标记）；到中央大厅可指认（accusation，一局一次）：三要素全对
 * 胜、任一错败。全部随机来自注入 seed 的 mulberry32，同种子可完整重放。
 */
/** mulberry32 种子随机数发生器（确定性，[0, 1)）。 */
export declare function mulberry32(seed: number): () => number;
/** 嫌疑人短名（列记事板用，全部 2 字）。 */
export declare const SUSPECTS: readonly string[];
/** 凶器短名（列记事板用，全部 2 字）。 */
export declare const WEAPONS: readonly string[];
/**
 * 房间短名，下标即棋盘格号（3×3 行优先）：中央第 4 格「大厅」是指认室，
 * 其余 8 格进入后可盘问。
 */
export declare const ROOMS: readonly string[];
/** 中央指认室的棋盘格号。 */
export declare const CENTER_ROOM = 4;
/** 卡总数 = 6 + 6 + 9。 */
export declare const CARD_COUNT = 21;
/** 全局卡号 → 类别（0 嫌疑人 / 1 凶器 / 2 房间）。 */
export declare function categoryOf(card: number): 0 | 1 | 2;
/** 类别内的卡号（0..5 / 0..5 / 0..8）转全局卡号。 */
export declare function cardIdOf(category: 0 | 1 | 2, index: number): number;
/** 类别内短名。 */
export declare function cardName(card: number): string;
/** 一局可测的完整游戏状态（rng 仅逻辑内部续用，不进快照）。 */
export interface DetectiveState {
    /** 本局种子。 */
    seed: number;
    /** 三张底牌（类别内下标）。 */
    secret: {
        suspect: number;
        weapon: number;
        room: number;
    };
    /** 玩家手牌（全局卡号，升序，9 张）。 */
    playerHand: number[];
    /** 证人 AI 手牌（全局卡号，保持发牌顺序 —— 决定亮牌优先级，9 张）。 */
    aiHand: number[];
    /** 棋盘格号 0..8，初始 4（从大厅出发）。 */
    pos: number;
    /** 最近一次骰值（0 = 本回合未掷）。 */
    die: number;
    /** 本回合剩余可走步数。 */
    steps: number;
    /** 是否已掷过骰并完成移动（本回合已进房可盘问）。 */
    movedThisTurn: boolean;
    /** excluded[卡号]：AI 亮出过 → 一定不是底牌。 */
    excluded: boolean[];
    /** confirmed[卡号]：由 AI 无匹配推断 → 一定是底牌。 */
    confirmed: boolean[];
    /** 是否已用过一局一次的指认。 */
    accused: boolean;
    /** null 进行中 / true 胜 / false 败。 */
    won: boolean | null;
    /** 内部随机源（快照不含）。 */
    rng: () => number;
}
/**
 * 建立一局：seed 依次决定三张底牌与剩余 18 张的洗牌发牌（前 9 张玩家、
 * 后 9 张 AI），玩家在中央大厅出发。
 * @param seed - 整数种子（同种子同局面）。
 */
export declare function createDetective(seed: number): DetectiveState;
/**
 * 去掉 rng 的可序列化快照（测试重放比对用）。
 * @param s - 游戏状态。
 * @returns 纯 JSON 字段（含 booleans 数组）。
 */
export declare function snapshot(s: DetectiveState): Omit<DetectiveState, 'rng'>;
/** 掷骰（1–3 步）：未处于可掷状态（还有剩余步 / 已终局）返回 0。 */
export declare function rollDie(s: DetectiveState): number;
/** 两格的曼哈顿距离（3×3 行优先格号）。 */
export declare function manhattan(a: number, b: number): number;
/** 当前剩余步数下可达的房间列表（不含原地）。 */
export declare function reachableRooms(s: DetectiveState): number[];
/**
 * 移动到目标房间：需在剩余步数内（曼哈顿距离 ≤ steps）、非原地，且局未
 * 结束。成功清空剩余步数并标记本回合已进房。
 * @returns 是否移动成功。
 */
export declare function moveTo(s: DetectiveState, room: number): boolean;
/**
 * 盘问（suggestion）：在刚进入的非中央房间里声明 嫌疑人 + 凶器 + 本房间。
 * AI 按手牌顺序亮出第一张匹配卡（该卡排除）；无匹配时，三要素中不在玩
 * 家手里的卡必为底牌（锁定）。
 * @param s - 游戏状态。
 * @param suspect - 嫌疑人下标 0..5。
 * @param weapon - 凶器下标 0..5。
 * @returns 亮出的全局卡号；null = AI 无匹配（触发锁定推断）。
 */
export declare function suggest(s: DetectiveState, suspect: number, weapon: number): number | null;
/**
 * 指认（accusation）：三要素与底牌全比对，一局一次；错则直接告负。
 * @param s - 游戏状态。
 * @param suspect - 嫌疑人下标。
 * @param weapon - 凶器下标。
 * @param room - 房间下标。
 * @returns 'win' / 'lose' / 'used'（已指认过）。
 */
export declare function accuse(s: DetectiveState, suspect: number, weapon: number, room: number): 'win' | 'lose' | 'used';
/** 记事格的四种标记：在手 / 已排除（AI 亮过）/ 锁定（推断为底牌）/ 未知。 */
export type NoteMark = 'held' | 'excluded' | 'confirmed' | 'unknown';
/**
 * 由手牌与盘问历史推导全部 21 张卡的记事标记（渲染三列排除格直接用）。
 * @param s - 游戏状态。
 * @returns 长度 21 的标记数组（下标即全局卡号）。
 */
export declare function deriveNotes(s: DetectiveState): NoteMark[];
