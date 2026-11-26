/**
 * 密码转盘纯逻辑：三种古典加密（凯撒 / 仿射 / 维吉尼亚）、seed 词库出题、
 * 转轮状态与实时解码预览、提交判定、频率统计、提示与过关推进。
 * 所有随机都来自注入的 mulberry32 种子，同一 seed 完全可重放。
 */
/** 注入式确定性随机数发生器（与其它游戏一致的 mulberry32）。 */
export type Rng = () => number;
/**
 * 构造一个 mulberry32 伪随机发生器。
 * @param seed - 31 位整数种子。
 * @returns 返回 [0,1) 随机数的函数，同 seed 序列完全一致。
 */
export declare function mulberry32(seed: number): Rng;
/** 仿射密码中与 26 互质的合法乘数集合。 */
export declare const AFFINE_MULTIPLIERS: readonly number[];
/** 英文字母近似频率（百分比，A..Z 顺序），频率图参考线用。 */
export declare const ENGLISH_FREQ: readonly number[];
/** 加密类型。 */
export type CipherKind = 'caesar' | 'affine' | 'vigenere';
/** 每关配置（递进：凯撒 → 仿射 → 维吉尼亚短钥 → 长钥 → 无频率图硬模式）。 */
export interface LevelConfig {
    /** 加密类型。 */
    kind: CipherKind;
    /** 关卡名（HUD/说明用）。 */
    name: string;
    /** 维吉尼亚密钥长度（其它类型为 0）。 */
    keyLen: number;
    /** 是否显示频率分析图（第 5 关硬模式为 false）。 */
    freqChart: boolean;
}
/** 五关固定递进。 */
export declare const LEVELS: readonly LevelConfig[];
/** 一关的题目：密文 + 真实密钥参数（逻辑层持有，渲染不直接展示）。 */
export interface LevelChallenge {
    /** 加密类型。 */
    kind: CipherKind;
    /** 明文（词库抽取）。 */
    plainText: string;
    /** 密文（由明文与密钥加密得到）。 */
    cipherText: string;
    /** 凯撒/仿射的移位量 b。 */
    shift: number;
    /** 仿射乘数 a（其它类型恒为 1）。 */
    multiplier: number;
    /** 维吉尼亚密钥偏移序列（其它类型为空数组）。 */
    keyOffsets: readonly number[];
}
/** 玩家转轮状态（提交判定与预览的全部输入）。 */
export interface WheelState {
    /** 凯撒/仿射的移位量 b（0..25）。 */
    shift: number;
    /** 仿射乘数 a（恒在互质集合内）。 */
    multiplier: number;
    /** 维吉尼亚各槽偏移（长度 = 密钥长）。 */
    keyOffsets: number[];
    /** 维吉尼亚当前选中槽索引。 */
    selectedSlot: number;
    /** 数字键输入缓冲（两位自动应用）。 */
    digitBuffer: string;
}
/** 一次提示揭示的字母映射（密文字母 → 明文字母）。 */
export interface RevealedPair {
    /** 密文字母。 */
    from: string;
    /** 对应明文字母。 */
    to: string;
}
/** 游戏总状态。 */
export interface CipherWheelState {
    /** 注入的随机源（提示抽取继续用它，保证可重放）。 */
    rng: Rng;
    /** 当前关卡索引（0..4）。 */
    level: number;
    /** 'playing' 进行中，'won' 全部通关。 */
    phase: 'playing' | 'won';
    /** 当前关题目。 */
    challenge: LevelChallenge;
    /** 玩家转轮状态。 */
    wheel: WheelState;
    /** 本关已用提示次数（上限 2）。 */
    hintsUsed: number;
    /** 已揭示的映射（按揭示顺序）。 */
    revealed: RevealedPair[];
    /** 总得分。 */
    score: number;
}
/** 每关提示次数上限。 */
export declare const MAX_HINTS = 2;
/**
 * 凯撒加密：P + s ≡ C (mod 26)。
 * @param text - 纯大写字母明文。
 * @param shift - 移位量（mod 26）。
 * @returns 密文。
 */
export declare function caesarEncrypt(text: string, shift: number): string;
/**
 * 求 a 在模 26 下的乘法逆元。
 * @param a - 乘数（须与 26 互质）。
 * @returns 逆元；不存在（不互质）时为 null。
 */
export declare function modInverse26(a: number): number | null;
/**
 * 仿射加密：C ≡ a·P + b (mod 26)。
 * @param text - 纯大写字母明文。
 * @param a - 乘数（必须与 26 互质，否则抛错）。
 * @param b - 移位量。
 * @returns 密文。
 */
export declare function affineEncrypt(text: string, a: number, b: number): string;
/**
 * 维吉尼亚加密：C_i ≡ P_i + key[i mod L] (mod 26)。
 * @param text - 纯大写字母明文。
 * @param keyOffsets - 密钥各字母偏移（0..25）。
 * @returns 密文。
 */
export declare function vigenereEncrypt(text: string, keyOffsets: readonly number[]): string;
/**
 * 按玩家当前转轮状态解出整段预览明文。
 * 凯撒/仿射对全文生效；维吉尼亚按槽偏移逐字母轮换。
 * @param challenge - 当前关题目（提供密文与类型）。
 * @param wheel - 玩家转轮状态。
 * @returns 预览明文。
 */
export declare function decryptPreview(challenge: LevelChallenge, wheel: WheelState): string;
/**
 * 统计文本中各字母出现次数（A..Z）。
 * @param text - 纯大写字母文本。
 * @returns 长度 26 的计数数组。
 */
export declare function letterCounts(text: string): number[];
/**
 * 用注入随机源为第 levelIndex 关生成题目（词库抽词 + 按类型生成密钥）。
 * @param rng - 注入随机源。
 * @param levelIndex - 关卡索引。
 * @returns 新题目（密钥避开恒等变换）。
 */
export declare function createChallenge(rng: Rng, levelIndex: number): LevelChallenge;
/**
 * 新建一局（五关从头开始）。
 * @param rng - 注入随机源。
 * @returns 初始状态（转轮全零、零提示、零分）。
 */
export declare function createCipherWheelState(rng: Rng): CipherWheelState;
/**
 * 换到下一关：重置转轮与提示，题密钥继续用注入随机源。
 * @param state - 游戏状态（就地推进）。
 */
export declare function advanceLevel(state: CipherWheelState): void;
/**
 * 设置凯撒/仿射移位量（mod 26 归一）。清空数字缓冲。
 * @param state - 游戏状态。
 * @param shift - 目标移位量（任意整数）。
 */
export declare function setShift(state: CipherWheelState, shift: number): void;
/**
 * 设置仿射乘数（不互质时向右吸附到最近互质值）。
 * @param state - 游戏状态。
 * @param a - 目标乘数。
 */
export declare function setMultiplier(state: CipherWheelState, a: number): void;
/**
 * 旋转当前转轮目标：凯撒/仿射转 b，维吉尼亚转选中槽。
 * @param state - 游戏状态。
 * @param delta - 步进格数（正 = 顺时针）。
 */
export declare function rotateWheel(state: CipherWheelState, delta: number): void;
/**
 * 数字键输入：缓冲一位，凑满两位立即作为偏移应用（维吉尼亚应用到选中槽）。
 * @param state - 游戏状态。
 * @param digit - '0'..'9'。
 */
export declare function applyDigit(state: CipherWheelState, digit: string): void;
/**
 * 把数值写入当前转轮目标（维吉尼亚选中槽 / 其它为 b；仿射另设 a）。
 * @param state - 游戏状态。
 * @param value - 目标偏移值。
 */
export declare function setWheelTarget(state: CipherWheelState, value: number): void;
/**
 * 当前预览是否已等于明文（提交判定依据）。
 * @param state - 游戏状态。
 * @returns 解开为 true。
 */
export declare function isSolved(state: CipherWheelState): boolean;
/**
 * 每关基础分（后面关卡更值钱）扣提示代价。
 * @param levelIndex - 关卡索引。
 * @param hints - 本关提示次数。
 * @returns 该关得分。
 */
export declare function scoreForLevel(levelIndex: number, hints: number): number;
/**
 * 提交当前预览：正确则计分并推进（末关置 won），错误不动。
 * @param state - 游戏状态。
 * @returns 'correct' 或 'wrong'。
 */
export declare function submitAnswer(state: CipherWheelState): 'correct' | 'wrong';
/**
 * 使用一次提示：随机揭示一个尚未揭示的密文字母 → 明文字母映射。
 * @param state - 游戏状态。
 * @returns 揭示的映射；已用满或无新字母可揭时为 null。
 */
export declare function applyHint(state: CipherWheelState): RevealedPair | null;
/**
 * 密文中某位置的字母是否已被提示揭示（渲染绿色明文用）。
 * @param state - 游戏状态。
 * @param index - 密文字符位置。
 * @returns 揭示后的明文字母；未揭示为 null。
 */
export declare function revealedAt(state: CipherWheelState, index: number): string | null;
/**
 * 用若干关的真实密钥直接构建状态（测试与调试用捷径）。
 * @param challenge - 指定题目。
 * @param levelIndex - 关卡索引。
 * @returns 置好题目的新状态（随机源为固定 seed）。
 */
export declare function stateWithChallenge(challenge: LevelChallenge, levelIndex: number): CipherWheelState;
/** 通关总分（测试全流程用）。 */
export declare function totalPerfectScore(): number;
