/**
 * 对称补全 Symmetry 纯逻辑：按注入的 mulberry32 种子确定性地生成 5 个
 * 关卡——每关是一串回合（拼图回合：左半图形 + 对称轴 + 打乱的构件盘；
 * 变体回合：给定整个图形问有几条对称轴的选择题）。提供反射变换、构件
 * 匹配判定（类型 + 镜像位置，网格吸附即半格容差）、过关判定与计分。
 * 无 DOM、无副作用，全部函数可直接在 vitest 中验证。
 */
/** 构件类型：实心块 / 线段 / 圆弧（L 形足迹，绘制为四分之一弧）。 */
export type PieceKind = 'block' | 'line' | 'arc';
/** 网格坐标：列 x、行 y，均从 0 起。 */
export interface Cell {
    x: number;
    y: number;
}
/** 一个构件：类型 + 覆盖的网格单元集合（单元互不重复）。 */
export interface Piece {
    kind: PieceKind;
    cells: Cell[];
}
/** 对称轴方向：竖直 / 水平 / 主对角线 y=x / 副对角线 x+y=grid-1。 */
export type AxisKind = 'v' | 'h' | 'd1' | 'd2';
/** 拼图回合：把 palette 中的构件逐一放到缺失的一半，补出 targets。 */
export interface PlaceRound {
    type: 'place';
    grid: number;
    axis: AxisKind;
    /** 玩家侧已给定的构件（含落在轴上、镜像后不变的自对称构件）。 */
    given: Piece[];
    /** 缺失一侧需要补出的镜像构件（与 given 中非轴构件一一对应）。 */
    targets: Piece[];
    /** targets 打乱后的构件盘顺序（长度等于 targets）。 */
    palette: Piece[];
}
/** 选择题回合：给定整个图形，问它有几条（4 条候选轴内的）对称轴。 */
export interface QuizRound {
    type: 'quiz';
    grid: number;
    figure: Cell[];
    /** 恒为 [0,1,2,4] 的某种乱序。 */
    options: number[];
    /** options 中正确答案的下标。 */
    answer: number;
}
/** 一关内的一个回合。 */
export type Round = PlaceRound | QuizRound;
/** 每关限时（秒）。 */
export declare const LEVEL_SECONDS = 240;
/** 总关卡数。 */
export declare const LEVEL_COUNT = 5;
/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供生成与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 求一个单元关于指定轴的镜像单元。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长（奇数，轴穿过中心行/列或对角线）。
 * @param cell - 原单元。
 * @returns 镜像单元。
 */
export declare function reflectCell(axis: AxisKind, grid: number, cell: Cell): Cell;
/**
 * 单元集合按 (y,x) 字典序排序的规范副本（相等判定的基础）。
 * @param cells - 原单元集合。
 * @returns 排序后的新数组。
 */
export declare function sortCells(cells: Cell[]): Cell[];
/**
 * 两个单元集合是否含有完全相同的单元（与顺序无关）。
 * @param a - 集合一。
 * @param b - 集合二。
 * @returns 相同返回 true。
 */
export declare function sameCells(a: Cell[], b: Cell[]): boolean;
/**
 * 构件的镜像构件（类型不变，单元集合映射后重新排序）。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长。
 * @param piece - 原构件。
 * @returns 镜像构件。
 */
export declare function mirrorPiece(axis: AxisKind, grid: number, piece: Piece): Piece;
/**
 * 两个构件是否类型相同且覆盖单元完全一致（顺序无关）。
 * @param a - 构件一。
 * @param b - 构件二。
 * @returns 一致返回 true。
 */
export declare function pieceEquals(a: Piece, b: Piece): boolean;
/**
 * 构件是否自对称（镜像后与自身重合，即"轴上构件"）。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长。
 * @param piece - 待测构件。
 * @returns 自对称返回 true。
 */
export declare function isSelfSymmetric(axis: AxisKind, grid: number, piece: Piece): boolean;
/**
 * 单元相对轴的位置：-1 给定侧 / 0 轴上 / +1 缺失侧。四种轴都以网格
 * 中心为轴：v 取中心列，h 取中心行，d1/d2 取两条对角线。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长。
 * @param cell - 待测单元。
 * @returns -1、0 或 +1。
 */
export declare function sideOf(axis: AxisKind, grid: number, cell: Cell): number;
/**
 * 生成一个拼图回合：先随机放一个轴上自对称构件（保证"轴上构件已给"），
 * 再在给定侧生成 count 个普通构件，其镜像即为目标构件；palette 为其
 * 打乱副本。
 * @param rng - 注入的随机数发生器。
 * @param grid - 网格边长（奇数）。
 * @param axis - 对称轴方向。
 * @param count - 需要玩家补全的构件数。
 * @param allowArcs - 是否允许圆弧构件（前两关不含弧）。
 * @returns 拼图回合。
 */
export declare function buildPlaceRound(rng: () => number, grid: number, axis: AxisKind, count: number, allowArcs: boolean): PlaceRound;
/**
 * 枚举图形在四条候选轴（竖直/水平/两条对角线，均过网格中心）中真正的
 * 对称轴。
 * @param cells - 图形单元集合。
 * @param grid - 网格边长。
 * @returns 对称轴方向列表（子集，长度 0-4）。
 */
export declare function symmetryAxes(cells: Cell[], grid: number): AxisKind[];
/**
 * 生成一道对称轴计数选择题：图形按目标答案构造（4=中心正方形、2=中心
 * 非正方形矩形、1=随机半边镜像、0=随机散块），再以 symmetryAxes 校验
 * 实际数量一致，选项恒为 [0,1,2,4] 的乱序。
 * @param rng - 注入的随机数发生器。
 * @param grid - 网格边长（奇数）。
 * @returns 选择题回合。
 */
export declare function buildQuizRound(rng: () => number, grid: number): QuizRound;
/** 各关的回合数（供 UI 与测试核对）。 */
export declare const LEVEL_PLAN_ROUNDS: number[];
/**
 * 构造一关的全部回合；同一种子产出完全一致（可复放）。
 * @param level - 0 起的关卡下标（0-4）。
 * @param seed - 种子。
 * @returns 回合列表（至少 1 个）。
 */
export declare function buildLevel(level: number, seed: number): Round[];
/**
 * 构件以 anchor 为新锚点（左上角对齐）平移后的覆盖单元。渲染层把指针
 * 坐标四舍五入到最近网格单元，即实现半格吸附容差。
 * @param piece - 待放置构件。
 * @param anchor - 放置锚点单元。
 * @returns 平移后的单元集合。
 */
export declare function placedCells(piece: Piece, anchor: Cell): Cell[];
/**
 * 判定一次放置：构件类型一致且覆盖单元与某个未占用目标的镜像单元完全
 * 重合即为正确，返回该目标下标。
 * @param round - 拼图回合。
 * @param piece - 玩家放置的构件。
 * @param anchor - 放置锚点。
 * @param claimed - 各目标是否已被正确补上。
 * @returns 匹配的目标下标，未匹配返回 -1。
 */
export declare function checkPlacement(round: PlaceRound, piece: Piece, anchor: Cell, claimed: boolean[]): number;
/**
 * 拼图回合是否已全部补全。
 * @param round - 拼图回合。
 * @param claimed - 各目标占用状态。
 * @returns 全部目标已占用返回 true。
 */
export declare function isPlaceSolved(round: PlaceRound, claimed: boolean[]): boolean;
/**
 * 过关计分：基础分随关卡上升，剩时给奖励，每一步（含错误尝试）扣分，
 * 下限 100。
 * @param level - 1 起的关卡序号。
 * @param steps - 本关总步数。
 * @param seconds - 本关用时（秒）。
 * @returns 得分。
 */
export declare function computeScore(level: number, steps: number, seconds: number): number;
