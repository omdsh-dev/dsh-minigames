/**
 * 解绳谜题 Planarity 纯逻辑：按注入的 mulberry32 种子确定性地生成 5 个
 * 关卡——每关先把 n 个顶点放在圆周上做理想无交叉布局（外圈多边形 + 随机
 * 三角剖分的部分弦，凸布局下数学上保证平面），再把顶点位置随机打乱成
 * 一团乱麻（保证打乱后至少存在一对交叉边）。玩家拖动顶点，任意两条不
 * 共端点的边不得交叉；全部边无交叉即过关。提供线段相交判定（端点豁免）、
 * 交叉边集合 / 计数、拖拽（含步数统计与边界钳制）、过关判定与计分。
 * 无 DOM、无副作用，全部函数可直接在 vitest 中验证。
 */
/** 平面点。 */
export interface Pt {
    x: number;
    y: number;
}
/** 无向边：顶点下标对（a < b）。 */
export interface Edge {
    a: number;
    b: number;
}
/** 游戏阶段：进行中 / 本关过关 / 全部通关。 */
export type PlanarityPhase = 'playing' | 'won' | 'allwon';
/** 一局的完整状态（纯数据，可 JSON 序列化）。 */
export interface PlanarityState {
    /** 本局基础种子（重开 / 下一关均由它派生，保证可重放）。 */
    baseSeed: number;
    /** 当前关下标（0 起）。 */
    levelIndex: number;
    /** 当前顶点位置（玩家可见、可拖动）。 */
    vertices: Pt[];
    /** 理想布局（生成时无交叉的参考解，仅渲染层过关动画使用）。 */
    solution: Pt[];
    /** 边集合。 */
    edges: Edge[];
    /** 拖拽中顶点下标，-1 表示未拖拽。 */
    dragIndex: number;
    /** 本次拖拽是否已实际位移（决定是否计步）。 */
    dragMoved: boolean;
    /** 已完成的拖拽次数（步数，越少分越高）。 */
    moves: number;
    /** 本关累计用时（毫秒，仅 playing 阶段累加）。 */
    timeMs: number;
    /** 当前阶段。 */
    phase: PlanarityPhase;
    /** 进入本关前的银行分（R 重开本关时恢复）。 */
    bankedScore: number;
    /** 本关过关结算分（未过关为 0）。 */
    levelScore: number;
}
/** 逻辑画布尺寸（与渲染层约定一致）。 */
export declare const W = 720;
export declare const H = 520;
/** 基础关数（无尽模式里程碑；HUD 显示用）。 */
export declare const LEVEL_COUNT = 5;
/** 无尽模式标记。 */
export declare const ENDLESS: true;
/** 每关顶点数：前 5 关 6 → 10；无尽模式逐关 +1 封顶 14（保持可拖密度）。 */
export declare const LEVEL_VERTICES: readonly [6, 7, 8, 9, 10];
export declare function levelVertices(levelIndex: number): number;
/** 顶点可拖动区域（留出 HUD 与说明按钮边距）。 */
export declare const BOARD: {
    readonly minX: 46;
    readonly maxX: number;
    readonly minY: 74;
    readonly maxY: number;
};
/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致（种子注入，确定性可测）。
 * @param seed - 非负 32 位种子。
 * @returns 返回随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 线段相交判定（端点豁免）：两条线段共享任一端点直接判不交叉（共端
 * 邻边在平面图中合法）；端点落在另一线段内部（T 触）与共线重叠均判
 * 交叉。"共享端点不算交叉" 是本游戏的规则核心。
 * @param a1 - 线段一端点。
 * @param a2 - 线段另一端点。
 * @param b1 - 线段二端点。
 * @param b2 - 线段二另一端点。
 * @returns true 表示两线段交叉（需要拆开）。 */
export declare function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean;
/**
 * 交叉边集合：遍历所有不共端点的边对做线段相交判定。
 * @param vertices - 顶点位置。
 * @param edges - 边集合。
 * @returns 交叉边的下标集合。 */
export declare function crossingEdgeSet(vertices: Pt[], edges: Edge[]): Set<number>;
/**
 * 交叉边对数（HUD 展示值：还有几对边缠在一起）。
 * @param vertices - 顶点位置。
 * @param edges - 边集合。
 * @returns 交叉边对数。 */
export declare function countCrossings(vertices: Pt[], edges: Edge[]): number;
/**
 * 生成一关：先在圆周理想布局上构造平面图（外圈 + 部分三角剖分弦），
 * 再把顶点位置打乱（带最小间距的拒绝采样，保证可拖可点）。
 * @param seed - 本关种子。
 * @param levelIndex - 关卡下标（0 起，决定顶点数与边密度）。
 * @returns 顶点 / 参考解 / 边。 */
export declare function generatePlanarityLevel(seed: number, levelIndex: number): {
    vertices: Pt[];
    solution: Pt[];
    edges: Edge[];
};
/**
 * 创建一关状态（第 0 关或重开 / 派生种子进下一关均走这里）。
 * @param baseSeed - 本局基础种子。
 * @param levelIndex - 关卡下标（0 起）。
 * @param bankedScore - 进入本关前的银行分。
 * @returns 初始状态。 */
export declare function createPlanarity(baseSeed: number, levelIndex: number, bankedScore?: number): PlanarityState;
/**
 * 检查是否全部边无交叉；是则结算得分并推进阶段（不自动进下一关——
 * 由渲染层做完归位动画后调用 {@link nextLevel}）。
 * @param state - 状态（就地更新）。
 * @returns true 表示本关刚刚过关。 */
export declare function checkWin(state: PlanarityState): boolean;
/**
 * 开始拖拽某顶点。
 * @param state - 状态（就地更新）。
 * @param index - 顶点下标。 */
export declare function startDrag(state: PlanarityState, index: number): void;
/**
 * 拖拽中移动顶点（钳制进盘面；本次拖拽首次有效位移计 1 步；落定后
 * 实时复查过关）。仅记一次拖拽为一步，微动（< 0.5px）不计。
 * @param state - 状态（就地更新）。
 * @param p - 指针逻辑坐标。 */
export declare function dragTo(state: PlanarityState, p: Pt): void;
/**
 * 结束拖拽（松开指针；过关判定已在 {@link dragTo} 内实时完成）。
 * @param state - 状态（就地更新）。 */
export declare function endDrag(state: PlanarityState): void;
/**
 * 进入下一关（最后一关调用返回原状态不变）。
 * @param state - 当前状态。
 * @returns 下一关新状态。 */
export declare function nextLevel(state: PlanarityState): PlanarityState;
/**
 * 累计用时（仅 playing 阶段；帮助面板打开时由调用方暂停计时）。
 * @param state - 状态（就地更新）。
 * @param dtMs - 帧间隔毫秒。 */
export declare function tickTime(state: PlanarityState, dtMs: number): void;
/**
 * 当前总分（银行分 + 本关已结算分）。
 * @param state - 当前状态。
 * @returns 总分。 */
export declare function totalScore(state: PlanarityState): number;
