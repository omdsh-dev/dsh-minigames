/**
 * 轨道交会 OrbitDock 纯逻辑：飞船从圆轨道出发，全程只有两次脉冲变轨
 * 机会（受 ΔV 预算约束），目标是与沿圆轨道运行的空间站交会——距离
 * 与相对速度同时进入阈值并保持 2 秒。中心行星平方反比引力，飞船用
 * 固定子步（1/240 s）半隐式 Euler 积分，位级可重放；空间站与碎片带
 * 走解析圆轨道（角速度由开普勒第三定律给出）。撞行星 / 撞碎片 /
 * 飞出最大半径 / 超时未交会均判失败。所有随机（星点、碎片相位与
 * 半径抖动）来自注入 seed，同 seed 序列完全确定、可测。
 */
/** 逻辑画布宽度（渲染与逻辑共用坐标系）。 */
export declare const LOGICAL_W = 640;
/** 逻辑画布高度。 */
export declare const LOGICAL_H = 480;
/** 中心行星圆心（避开顶部 HUD 带）。 */
export declare const CX = 320;
export declare const CY = 252;
/** 行星碰撞半径（px）。 */
export declare const PLANET_R = 26;
/** 飞船碰撞半径（px）。 */
export declare const SHIP_R = 5;
/** 碎片可视 / 碰撞半径（px）。 */
export declare const DEBRIS_R = 6;
/** 引力参数（px^3/s^2，配半径量级）。 */
export declare const GM = 1200000;
/** 引力软化下限（px）：距离小于该值按该值算，防近场数值爆炸。 */
export declare const MIN_R = 20;
/** 固定积分子步秒长：所有轨迹按此离散步进，保证位级可重放。 */
export declare const SUB_DT: number;
/** 子步毫秒数（帧循环累加器用）。 */
export declare const SUB_DT_MS: number;
/** 每局最多脉冲次数。 */
export declare const MAX_BURNS = 2;
/** 交会距离阈值（px）。 */
export declare const DOCK_DIST = 20;
/** 交会相对速度阈值（px/s）。 */
export declare const DOCK_SPEED = 25;
/** 交会需持续保持的秒数。 */
export declare const DOCK_HOLD_S = 2;
/** 出界半径（px）：离心距离超过即失败。 */
export declare const MAX_R = 300;
/** 单关最长模拟秒数：超时未交会判漂失失败。 */
export declare const MAX_SIM_S = 90;
/** 关卡总数。 */
export declare const LEVEL_COUNT = 5;
/** 一关的配置：初始 / 目标轨道与预算、碎片带。 */
export interface DockLevelConfig {
    /** 飞船初始圆轨道半径。 */
    r0: number;
    /** 飞船初始相位角（弧度）。 */
    a0: number;
    /** 空间站圆轨道半径。 */
    rS: number;
    /** 空间站初始相位角（弧度）。 */
    aS: number;
    /** 本关 ΔV 总预算（px/s）。 */
    dvBudget: number;
    /** 碎片带：轨道半径与碎片数；null 表示无碎片。 */
    debris: {
        orbitR: number;
        count: number;
    } | null;
}
/** 五关递进：轨道半径组合变化、预算收紧、第 4/5 关加入碎片带。 */
export declare const LEVELS: readonly DockLevelConfig[];
/** 对局结果阶段。 */
export type DockStatus = 'playing' | 'docked' | 'failed' | 'allClear';
/** 失败原因。 */
export type FailReason = 'planet' | 'debris' | 'bounds' | 'drift';
/** 一块碎片：解析圆轨道（半径带 seed 抖动），碰撞体为圆。 */
export interface DebrisChunk {
    orbitR: number;
    ang0: number;
    /** 角速度（rad/s，开普勒第三定律）。 */
    omega: number;
}
/** 渲染 / 测试消费的事件（消费方负责清空）。 */
export interface DockEvent {
    type: 'burn' | 'fail' | 'clear';
    x: number;
    y: number;
    reason?: FailReason;
}
/** 对局状态（可变对象；全部操作为确定性纯过程）。 */
export interface DockState {
    /** 当前关（1 起）。 */
    level: number;
    /** 注入种子（碎片抖动 / 星点派生）。 */
    seed: number;
    /** 模拟时间（秒，子步累计）。 */
    t: number;
    /** 帧循环毫秒累加器（固定子步换算用）。 */
    accMs: number;
    /** 已执行子步数。 */
    subCount: number;
    /** 飞船位置与速度。 */
    ship: {
        x: number;
        y: number;
        vx: number;
        vy: number;
    };
    /** 剩余 ΔV（px/s）。 */
    dvLeft: number;
    /** 本关 ΔV 预算。 */
    dvBudget: number;
    /** 已用脉冲次数（≤ MAX_BURNS）。 */
    burnsUsed: number;
    /** 暂停中已设定的待执行脉冲（ΔV 分量）。 */
    pending: {
        x: number;
        y: number;
    } | null;
    /** 交会条件连续保持的秒数（中断清零）。 */
    dockMs: number;
    status: DockStatus;
    failReason: FailReason | null;
    /** 轨迹抽样点（x,y 平铺，供渲染渐隐线）。 */
    trail: number[];
    /** 待消费事件。 */
    events: DockEvent[];
    /** 本关碎片带（无碎片为空数组）。 */
    debris: DebrisChunk[];
    /** 累计总分（过关时累加）。 */
    scoreTotal: number;
}
/** mulberry32：注入用确定性伪随机源。
 * @param seed - 32 位种子。
 * @returns 返回 [0,1) 随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/** 圆轨道角速度（rad/s）。
 * @param r - 轨道半径（px）。
 * @returns sqrt(GM / r^3)。
 */
export declare function omegaAt(r: number): number;
/** 空间站在时刻 t 的解析位置与速度。
 * @param cfg - 关卡配置。
 * @param t - 模拟秒。
 * @returns 位置与速度（切向）。
 */
export declare function stationAt(cfg: DockLevelConfig, t: number): {
    x: number;
    y: number;
    vx: number;
    vy: number;
};
/** 一块碎片在时刻 t 的解析位置。
 * @param chunk - 碎片。
 * @param t - 模拟秒。
 * @returns 位置。
 */
export declare function debrisPos(chunk: DebrisChunk, t: number): {
    x: number;
    y: number;
};
/** 星点背景（渲染用，seed 确定）。
 * @param seed - 种子。
 * @param count - 星点数。
 * @returns 星点数组。
 */
export declare function generateStarfield(seed: number, count?: number): {
    x: number;
    y: number;
    r: number;
    a: number;
}[];
/** 创建一关对局。
 * @param level - 关号（1 起，越界钳回 [1, LEVEL_COUNT]）。
 * @param seed - 注入种子（碎片抖动派生）。
 * @returns 初始状态：飞船在 r0 圆轨道、模拟暂停在 t=0。
 */
export declare function createDock(level: number, seed: number): DockState;
/** 直接推进固定秒数（测试 / 剧本重放路径，不看运行开关）。
 * @param state - 对局状态。
 * @param seconds - 模拟秒数（按子步取整，确定性）。
 */
export declare function advanceSim(state: DockState, seconds: number): void;
/** 帧循环路径：按毫秒累加器换算固定子步（分帧方式不影响轨迹）。
 * @param state - 对局状态。
 * @param dtMs - 本帧毫秒数（内部钳制防久停后跳变）。
 */
export declare function stepDock(state: DockState, dtMs: number): void;
/** 施加一次脉冲（ΔV 直接叠加到速度上）。
 * 钳制到剩余预算；幅值 < 0.5 视为未发射、不消耗次数。
 * @param state - 对局状态。
 * @param dvx - ΔV x 分量（px/s）。
 * @param dvy - ΔV y 分量（px/s）。
 * @returns 实际施加的 ΔV；未施加返回 null。
 */
export declare function applyDv(state: DockState, dvx: number, dvy: number): {
    x: number;
    y: number;
} | null;
/** 暂停时设定待执行脉冲（空拖拽 / 幅值过小视为取消）。
 * @param state - 对局状态。
 * @param dvx - ΔV x 分量（px/s，钳到剩余预算）。
 * @param dvy - ΔV y 分量（px/s，钳到剩余预算）。
 */
export declare function setPendingDv(state: DockState, dvx: number, dvy: number): void;
/** 执行待执行脉冲并清空（恢复飞行前由 UI 调用）。
 * @param state - 对局状态。
 */
export declare function commitBurn(state: DockState): void;
/** 本关失败文案。
 * @param reason - 失败原因。
 * @returns 中文短句。
 */
export declare function failText(reason: FailReason): string;
