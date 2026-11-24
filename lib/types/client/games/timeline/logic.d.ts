/**
 * 时间线 Timeline 纯逻辑：内置 66 张事件卡题库（科技/历史/文化）、按注入
 * seed 发牌（mulberry32，锚点取年份中位卡）、插入/交换/收回操作、提交
 * 判定（相对邻居正确即锁定，错误卡回手并附「比 X 更早/更晚」提示）、
 * 错误计分与关卡限时。无 DOM、无副作用，全部确定性可测：同 level+seed
 * 重放完全一致，供 tests/timeline-logic.spec.ts 与渲染层共用。
 */
/** 事件领域：科技 / 历史 / 文化。 */
export type Category = 'tech' | 'history' | 'culture';
/** 一张事件卡：稳定 id、名称、年份（公元前为负）、领域。 */
export interface TimelineEvent {
    id: number;
    name: string;
    year: number;
    category: Category;
}
/** 内置题库：66 张事件卡，id 与名称全库唯一，年份覆盖公元前至现代。 */
export declare const EVENT_BANK: TimelineEvent[];
/** mulberry32：32 位种子 -> [0,1) 确定性伪随机序列（所有随机仅经此处）。 */
export declare function mulberry32(seed: number): () => number;
/** 关卡递进配置：卡片 5→7、后期同领域干扰 + 限时（0 = 不限）。 */
export interface LevelConfig {
    cardCount: number;
    timeLimitSec: number;
    focusCategory: boolean;
}
/** 5 个关卡的固定难度曲线。 */
export declare const LEVELS: LevelConfig[];
/** 一局发牌结果：本关全部事件卡 + 固定已放置的锚点卡。 */
export interface Round {
    cards: TimelineEvent[];
    anchor: TimelineEvent;
}
/**
 * 发一关牌：level 3 起锁定单一领域并在该领域按年份取连续窗口（相邻年代
 * 干扰更强），低关卡跨领域随机抽样；锚点取按年份排序后的中位卡（年份必
 * 然落在首尾之间，且不取极端，保证两侧都有推理空间）。
 * @param level 关卡号（1..5）。
 * @param seed 注入种子；同 level+seed 结果完全一致。
 */
export declare function dealRound(level: number, seed: number): Round;
/** 一局的运行阶段：进行中 / 已过关 / 时间耗尽。 */
export type Phase = 'playing' | 'cleared' | 'timeout';
/** 错误卡的相对位置提示：应比参照卡更早或更晚。 */
export interface Hint {
    card: TimelineEvent;
    ref: TimelineEvent;
    direction: 'earlier' | 'later';
}
/** 一次提交的判定结果。 */
export interface JudgeResult {
    locked: TimelineEvent[];
    wrong: TimelineEvent[];
    hints: Hint[];
    allCorrect: boolean;
}
/** 一关的完整可变状态（操作均为就地变更，返回值指示是否成功）。 */
export interface TimelineState {
    level: number;
    seed: number;
    round: Round;
    /** 手中未放置的卡（显示顺序）。 */
    hand: TimelineEvent[];
    /** 时间轴上已放置的卡（索引 0 为最左/最早端）。 */
    timeline: TimelineEvent[];
    /** 本关累计错误张次（每次提交按错误张数累加）。 */
    errors: number;
    /** 剩余秒数；0 表示本关不限时。 */
    remainingSec: number;
    phase: Phase;
    /** 最近一次提交产生的提示（渲染层展示，逻辑不清理）。 */
    hints: Hint[];
}
/** 起始一关状态：锚点已在时间轴上，其余卡洗入手牌。 */
export declare function createRoundState(level: number, seed: number): TimelineState;
/** 将手牌中的一张插入时间轴指定空位（0..长度，即两端或任意卡间）。 */
export declare function insertCard(state: TimelineState, cardId: number, slot: number): boolean;
/** 交换时间轴上两张已放置卡（提交前可自由调整；锚点同样可被换位）。 */
export declare function swapPlaced(state: TimelineState, i: number, j: number): boolean;
/** 把一张已放置（非锚点）卡收回手牌。 */
export declare function returnToHand(state: TimelineState, pos: number): boolean;
/**
 * 提交判定：手牌清空后才允许。相对邻居有序的卡锁定在轴上，其余回手并
 * 附提示（就近参照锁定卡：年份小于左侧锁定卡 → 更早，大于右侧锁定卡 →
 * 更晚；两侧都无锁定卡时退回与锚点比较）。错误张数计入 errors。
 * @returns 判定结果；未在 playing 或手牌未清空时返回 null（不改变状态）。
 */
export declare function submitRound(state: TimelineState): JudgeResult | null;
/** 本关过关得分：100 起步，每错一张扣 10，下限 20。 */
export declare function scoreForLevel(errors: number): number;
/** 推进限时（不限时关卡为 no-op）；归零进入 timeout 阶段。 */
export declare function tickTimer(state: TimelineState, dtSec: number): void;
