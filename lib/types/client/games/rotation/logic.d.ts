/**
 * 转盘密码 (Rotation) 纯逻辑：同心圆环密码锁的盘面生成（每层格数、空缺
 * 分布、目标角均由注入 seed 决定）、逐层旋转状态与步进模长、径向通路
 * 判定（沿指定角度逐层查该格是否空缺）、多目标角依次打通流转、过关计
 * 分与关卡推进。全部随机走注入 seed（mulberry32），确定性可测；无
 * DOM、无定时器。
 */
/** mulberry32 确定性伪随机数发生器：同 seed 同序列，返回 [0,1)。 */
export declare function mulberry32(seed: number): () => number;
/** 关卡种子：不同 seed / 不同关卡号产生不同的生成序列。 */
export declare function levelSeed(seed: number, level: number): number;
/** 非负模：结果落在 [0, m)。 */
export declare function mod(n: number, m: number): number;
/** 一层同心圆环：slots 个等分格；gaps 描述图案格，rotation 为步进。 */
export interface RingLayer {
    /** 该层等分格数。 */
    slots: number;
    /** 图案格空缺表：true=空缺（可透光），false=挡板。 */
    gaps: boolean[];
    /** 当前旋转步数：盘面格 j 显示图案格 mod(j - rotation, slots)。 */
    rotation: number;
}
/** 一关盘面：同心层（0 为最内层）与目标角度序列（度）。 */
export interface RotationLevel {
    layers: RingLayer[];
    /** 需依次打通的目标角度（度，0=正右方，顺时针增长）。 */
    targetAngles: number[];
}
/** 关卡骨架：每层格数、每层空缺数、目标角个数。 */
export interface LevelDef {
    slots: number[];
    gapCounts: number[];
    targetCount: number;
}
/** 5 关递进：层数 4→6、空缺更稀疏、目标角 1→3 个。 */
export declare const LEVEL_DEFS: LevelDef[];
/** 关卡总数。 */
export declare const LEVEL_COUNT: number;
/** 过关基础分（乘以关卡号）。 */
export declare const WIN_BASE = 100;
/** 每步扣的分（效率奖励下限 0）。 */
export declare const STEP_COST = 5;
/** 效率奖励上限。 */
export declare const BONUS_MAX = 150;
export type RotationStatus = 'playing' | 'won' | 'cleared';
export interface RotationState {
    /** 1-based 关卡号。 */
    level: number;
    score: number;
    /** 进入本关时的得分（R 重开时回滚到它，防止反复刷分）。 */
    levelStartScore: number;
    status: RotationStatus;
    /** 盘面种子：同 seed 同关卡必生成同盘面。 */
    seed: number;
    board: RotationLevel;
    /** 当前选中的层下标（0 为最内层）。 */
    selectedLayer: number;
    /** 旋转操作步数。 */
    steps: number;
    /** 已打通的目标角个数（下一个待打通的是 targetAngles[targetIndex]）。 */
    targetIndex: number;
}
/** 角度在该层落在哪个等分格（0-based）。 */
export declare function angleIndex(slots: number, angle: number): number;
/** 该层在指定角度是否空缺（透光）。 */
export declare function layerOpenAtAngle(layer: RingLayer, angle: number): boolean;
/** 沿指定角度的逐层通路：第 i 项为第 i 层是否空缺。 */
export declare function beamAt(level: RotationLevel, angle: number): boolean[];
/**
 * 找一个让该层在指定角度空缺的旋转步数。
 * @returns 最小的可行旋转，层无空缺时返回 null。
 */
export declare function findOpening(layer: RingLayer, angle: number): number | null;
/**
 * 生成第 level 关（1-based；越界钳到 1..LEVEL_COUNT）。
 * 每层至少 1 个空缺（任何角度都存在可解朝向）且至少 1 个挡板；打乱后
 * 首个目标角必不通（否则逐格拧最内层直到被挡住）。
 * @param rng - 注入随机源。
 */
export declare function generateLevel(level: number, rng: () => number): RotationLevel;
/** 过关得分：基础分 × 关卡号 + 步数效率奖励（下限 0）。 */
export declare function winScore(level: number, steps: number): number;
/**
 * 把第 layerIndex 层旋转 dir 格（+1 顺时针步进）。
 * 每次旋转后检查当前目标角：全层空缺则推进目标；全部目标打通即过关
 * 并一次性计分。
 * @returns 旋转生效返回 true；非进行态或层下标越界返回 false。
 */
export declare function rotateLayer(state: RotationState, layerIndex: number, dir: 1 | -1): boolean;
/** 重开本关：同一盘面（同 seed 同关卡），分数回滚到进关时。 */
export declare function restartLevel(state: RotationState): void;
/** 过关后进入下一关：第 5 关获胜即整局终了（'cleared'）。 */
export declare function advanceLevel(state: RotationState): void;
/**
 * 新建一局状态。
 * @param level - 1-based 关卡号。
 * @param score - 结转得分。
 * @param seed - 盘面种子。
 */
export declare function createRotationState(level?: number, score?: number, seed?: number): RotationState;
