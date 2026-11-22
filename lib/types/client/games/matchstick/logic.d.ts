/**
 * 火柴算式纯逻辑：七段数码管风格的等式谜题。数字 0-9 与 +、-、= 全部
 * 由火柴段拼成；每题初始等式不成立，玩家通过「移动一根」或变体关的
 * 「补一根 / 抽一根」使其成立。题库从随机合法等式出发做一次等价扰动
 * 生成——原等式恒可还原，保证每题至少一解（可能存在多解，均判对）。
 * 仅含确定性纯函数与状态机：无 DOM、无定时器；随机性全部经注入的
 * rng（mulberry32）驱动，同种子同序列，可重放可测。
 */
/** 段名全集：a 顶横、b 右上竖、c 右下竖、d 底横、e 左下竖、f 左上竖、
 * g 中横（七段数码管标准段），m/n 中竖上下半（仅 +），x/y 双横
 * （仅 =）。共 11 个火柴位。 */
export type Seg = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'm' | 'n' | 'x' | 'y';
/** 每关 5 题、共 5 关；maxDigits 为操作数最大位数，timeLimit 为每题
 * 秒数，variants 关允许移动/补/抽三种修法。 */
export interface LevelConfig {
    maxDigits: number;
    timeLimit: number;
    variants: boolean;
}
/** 关卡表：位数 1→2→3 递进，限时 60→30 递减，后两关开变体。 */
export declare const LEVELS: readonly LevelConfig[];
/** 每关题数。 */
export declare const PUZZLES_PER_LEVEL = 5;
/** 解一题基础分。 */
export declare const SOLVE_BASE_SCORE = 80;
/** 修法类型：move 移动一根、add 补一根（题面被抽走过一根）、
 * remove 抽一根（题面被多塞了一根）。 */
export type PuzzleFix = 'move' | 'add' | 'remove';
/** 一次完整的火柴移动：从 fromCell 的 fromSeg 拿起，放到 toCell 的 toSeg。 */
export interface StickMove {
    fromCell: number;
    fromSeg: Seg;
    toCell: number;
    toSeg: Seg;
}
/** 生成器记录的保底解（原等式的还原动作）。 */
export type PuzzleSolution = {
    fix: 'move';
    move: StickMove;
} | {
    fix: 'add';
    cell: number;
    seg: Seg;
} | {
    fix: 'remove';
    cell: number;
    seg: Seg;
};
/** 一道题：初始字元序列、修法与保底解。 */
export interface MatchstickPuzzle {
    /** 逐字元的等式串，如 '9-6=3'。 */
    cells: string;
    fix: PuzzleFix;
    solution: PuzzleSolution;
}
/** 玩家手中正拿着的火柴：来自棋盘某格，或来自备用匣。 */
export type HeldStick = {
    from: 'board';
    cell: number;
    seg: Seg;
} | {
    from: 'reserve';
};
/** 一局完整状态。 */
export interface MatchstickState {
    seed: number;
    /** 当前关（0 起）。 */
    level: number;
    /** 关内题号（0 起）。 */
    puzzleIndex: number;
    /** 本题剩余秒数。 */
    timeLeft: number;
    score: number;
    /** 'playing' 进行中；'won' 五关全清。 */
    status: 'playing' | 'won';
    /** 当前题面字元序列（随玩家操作即时变化）。 */
    cells: string;
    /** 当前题修法。 */
    fix: PuzzleFix;
    /** 手持火柴（空为 null）。 */
    held: HeldStick | null;
    /** 本题已试错次数。 */
    attempts: number;
    /** 全局已解 / 超时题数。 */
    solved: number;
    failed: number;
    /** 全部 5x5 题库（种子驱动，创建时一次生成）。 */
    puzzles: MatchstickPuzzle[][];
}
/**
 * mulberry32 确定性伪随机数生成器：返回 [0,1) 的函数，同种子同序列。
 * @param seed - 非负整数种子。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 读取字符的段位掩码。
 * @param ch - 等式字元（数字或 +、-、=）。
 * @returns 段位掩码；非法字符返回 0。
 */
export declare function glyphBits(ch: string): number;
/**
 * 位掩码反查字元。
 * @param bits - 段位掩码。
 * @returns 对应字元；不是任何合法字型时返回 null。
 */
export declare function charFromBits(bits: number): string | null;
/**
 * 某格还能补进哪些段（补后仍是合法字型）——放置候选位。
 * @param ch - 该格当前字元。
 * @returns 可补段名列表。
 */
export declare function addableSegs(ch: string): Seg[];
/**
 * 某格还能抽走哪些段（抽后仍是合法字型）。
 * @param ch - 该格当前字元。
 * @returns 可抽段名列表。
 */
export declare function removableSegs(ch: string): Seg[];
/**
 * 等式求值：结构与算术双重校验。结构要求恰好一个 =、左侧一个不在首
 * 位的 + 或 -、两侧操作数为纯数字（数值上允许前导零）。
 * @param cells - 等式字元序列。
 * @returns parsed 结构是否合法；correct 结构合法且两侧数值相等。
 */
export declare function evaluateEquation(cells: string): {
    parsed: boolean;
    correct: boolean;
};
/**
 * 在某格补上一根火柴。
 * @param cells - 等式字元序列。
 * @param cell - 目标格下标。
 * @param seg - 目标段。
 * @returns 新字元序列；格越界、段已存在或补后字型非法时返回 null。
 */
export declare function addSeg(cells: string, cell: number, seg: Seg): string | null;
/**
 * 从某格抽走一根火柴。
 * @param cells - 等式字元序列。
 * @param cell - 源格下标。
 * @param seg - 源段。
 * @returns 新字元序列；格越界、段不存在或抽后字型非法时返回 null。
 */
export declare function removeSeg(cells: string, cell: number, seg: Seg): string | null;
/**
 * 执行一次完整移动（先抽后补）：源段必须存在、目标段必须为空、两格
 * 变换后都必须仍是合法字型。
 * @param cells - 等式字元序列。
 * @param move - 移动描述。
 * @returns 新字元序列；任一校验不过返回 null。
 */
export declare function applyStickMove(cells: string, move: StickMove): string | null;
/**
 * 从一条成立的等式出发生成谜题：做一次扰动使其不成立，并记录原式
 * 还原动作作为保底解。
 * @param rng - 注入随机源。
 * @param maxDigits - 操作数最大位数。
 * @param variants - 是否允许 move/add/remove 三种修法（否则仅 move）。
 * @returns 谜题（含保底解）；生成失败时返回固定保底题（1-8=3，移一根
 * b 可还原 9-6=3），保证本函数永不抛错。
 */
export declare function generatePuzzle(rng: () => number, maxDigits: number, variants: boolean): MatchstickPuzzle;
/**
 * 生成整局：同一种子流一次铺好 5 关 x 5 题。
 * @param seed - 非负整数种子。
 * @returns 初始状态（第 1 关第 1 题已装填）。
 */
export declare function createMatchstick(seed: number): MatchstickState;
/** 当前关是否允许三种修法混用（含备用匣取火柴与抽走丢弃）。 */
export declare function variantLevel(state: MatchstickState): boolean;
/**
 * 从棋盘拿起一根火柴（再次点击同一根放回）。
 * @param state - 局状态。
 * @param cell - 格下标。
 * @param seg - 段名。
 * @returns 是否拿起（或切选）成功；题面无此段或当前修法不允许时 false。
 */
export declare function pickStick(state: MatchstickState, cell: number, seg: Seg): boolean;
/**
 * 从备用匣取一根新火柴（变体关或本题修法为「补一根」时可用）。
 * @param state - 局状态。
 * @returns 是否取起成功。
 */
export declare function grabReserve(state: MatchstickState): boolean;
/**
 * 放下手中火柴（不改变题面）——U 键撤回拿起。
 * @param state - 局状态。
 */
export declare function putDownHeld(state: MatchstickState): void;
/**
 * 把手中火柴放到某空位。放置后立即判定：等式成立则记分解题并推进，
 * 不成立则题面自动还原（保持「只动一根」的纯度），试错数加一。
 * @param state - 局状态。
 * @param cell - 目标格下标。
 * @param seg - 目标段。
 * @returns 'solved' 解出并推进；'returned' 点回原位放回；'wrong' 不
 * 成立已还原；'illegal' 此处不可放；'none' 手上没有火柴。
 */
export declare function placeStick(state: MatchstickState, cell: number, seg: Seg): 'solved' | 'returned' | 'wrong' | 'illegal' | 'none';
/**
 * 把手中火柴丢进备用匣（从题面移除）——变体关「抽一根」修法。
 * @param state - 局状态。
 * @returns 判定结果，语义同 {@link placeStick}（'illegal' 为手上是备用
 * 匣新火柴，无事可丢）。
 */
export declare function discardStick(state: MatchstickState): 'solved' | 'wrong' | 'illegal' | 'none';
/**
 * 计时推进（由宿主每帧驱动）。
 * @param state - 局状态。
 * @param dt - 实际经过秒数（正数）。
 * @returns 'timeout' 本题超时（已自动换题并计 failed）；'ok' 正常。
 */
export declare function tickMatchstick(state: MatchstickState, dt: number): 'timeout' | 'ok';
