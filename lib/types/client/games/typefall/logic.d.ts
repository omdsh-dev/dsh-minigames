/**
 * 字母雨 TypeFall 纯逻辑：顶部给出目标单词，单词的字母按顺序一个个
 * 从夜空落下；玩家按下正确的字母键即把该字母接入拼词槽（按单词顺序），
 * 按错键或目标字母落地未接都漏一个（扣 1 命，共 3 命）。拼完一个词得分
 * 并进入下一词；一组词（3-5 个）拼完进入下一关，共 5 关。第 2 关起有
 * 干扰字母同屏下落：落地无害，但按到它算按错。所有随机走 mulberry32
 * 种子注入，逻辑是关于显式毫秒时钟的确定性纯函数，可完整重放。
 */
/** 32 位种子伪随机（mulberry32）：返回 [0,1)。 */
export declare function mulberry32(seed: number): () => number;
/** 关卡总数。 */
export declare const LEVELS = 5;
/** 每关抽的单词个数（下标=关卡，0 起）。 */
export declare const WORDS_PER_LEVEL: readonly number[];
/** 初始生命。 */
export declare const START_LIVES = 3;
/** 逻辑画布宽（px）。 */
export declare const FIELD_W = 480;
/** 接地线 y（px）：目标字母方块底边触到即漏。 */
export declare const GROUND_Y = 460;
/** 字母方块边长（px）。 */
export declare const LETTER_SIZE = 30;
/** 落点横坐标两侧留白（px）。 */
export declare const SIDE_MARGIN = 30;
/** 接住一个字母的基础分。 */
export declare const CATCH_SCORE = 5;
/** 拼完单词每个字母的奖励分。 */
export declare const WORD_BONUS_PER_LETTER = 10;
/** 拼完单词按关卡的额外奖励分（关卡 0 起，每关 +20）。 */
export declare const LEVEL_BONUS = 20;
/** 命中闪光时长（ms）。 */
export declare const FLASH_MS = 260;
/** 漏接/按错的画面抖动时长（ms）。 */
export declare const SHAKE_MS = 240;
/** 关卡横幅展示时长（ms）。 */
export declare const BANNER_MS = 1400;
/** 全部词库（扁平，供测试断言总量与长度）。 */
export declare const WORD_BANK: readonly string[];
/** 一个下落字母（目标或干扰）。 */
export interface FallingLetter {
    id: number;
    /** 大写字母。 */
    ch: string;
    x: number;
    y: number;
    /** 下落速度（px/s），生成时确定。 */
    vy: number;
    /** true=干扰字母：落地无害、按到算错。 */
    decoy: boolean;
}
/** 一帧溅落事件（渲染/粒子消费后由调用方清空）。 */
export interface Splat {
    x: number;
    y: number;
    /** miss=目标落地漏接；hit=按键命中。 */
    kind: 'miss' | 'hit';
}
/** 字母雨的完整可变状态（纯数据 + 种子随机源）。 */
export interface TypeFallState {
    /** 种子随机源；同一种子重放结果完全一致。 */
    rand: () => number;
    /** 当前关卡（0 起，共 5）。 */
    level: number;
    /** 每关预先按种子抽好的单词队列。 */
    queues: string[][];
    /** 当前词在本关队列中的下标。 */
    wordIndex: number;
    /** 当前词已拼入的字母数。 */
    typed: number;
    lives: number;
    score: number;
    /** 生命耗尽 true。 */
    over: boolean;
    /** 5 关全部拼完 true。 */
    won: boolean;
    /** 正在下落的目标字母（同屏至多一个）。 */
    active: FallingLetter | null;
    /** 同屏干扰字母。 */
    decoys: FallingLetter[];
    /** 距离下一个目标字母生成的倒计时（ms）。 */
    nextSpawnMs: number;
    /** 距离下一个干扰字母生成的倒计时（ms）。 */
    decoySpawnMs: number;
    /** 待消费的溅落事件。 */
    pendingSplats: Splat[];
    flashMs: number;
    shakeMs: number;
    levelBannerMs: number;
    nextId: number;
}
/** 基础下落速度（px/s）：随关卡与词序渐增。 */
export declare function letterSpeed(level: number, wordIndex: number): number;
/** 目标字母生成间隔（ms）：随关卡缩短。 */
export declare function spawnDelayMs(level: number): number;
/** 干扰字母生成间隔（ms）；关卡 0（第 1 关）不生成干扰。 */
export declare function decoyIntervalMs(level: number): number;
/** 当前目标单词（大写展示由渲染负责，此处保留原小写）。 */
export declare function currentWord(state: TypeFallState): string;
/** 用种子创建初始状态：各关词队列在创建时一次抽定。 */
export declare function createTypeFallState(seed: number): TypeFallState;
/**
 * 按一个字母键（A-Z，大小写均可）。
 * @returns hit=接住目标字母；wrong=按错（扣命，目标字母继续下落）；
 * complete=接住并拼完整个词；ignored=游戏已结束或通关。
 */
export declare function pressLetter(state: TypeFallState, ch: string): 'hit' | 'wrong' | 'complete' | 'ignored';
/**
 * 推进模拟 dt 毫秒：生成/下落目标与干扰字母、判定落地漏接、衰减闪光。
 * 结束或通关后仅衰减视觉计时器。
 */
export declare function tickTypeFall(state: TypeFallState, dtMs: number): void;
