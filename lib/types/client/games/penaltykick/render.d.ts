/**
 * 点球大战 PenaltyKick 渲染层：门线视角球场（球门六区分格 + 球网）、
 * 守门员扑救动画、足球飞行弧线、力度滑条（风险段红显）、比分板（五轮
 * 点球格 ●/✗/○ + 骤死轮追加）、AI 热区预读金框、说明按钮 + 帮助面板
 * （渲染末尾最上层）。纯绘制，无状态；布局常量集中声明并核算互不
 * 遮挡：HUD 带 y26（左 x16 / 中 x360 居中 / 右 x704 右锚，净距 ≥140px）；
 * 点球格行 y58/y82（左标签 x16 结束 ~x42，右统计 x~616 起，净距 >570px）；
 * 球门 200-520 x 96-256；预读/结果文本 y292/y330（模式互斥不同时出现）；
 * 力度带 y512（标签右锚 244，数值左锚 462，净距 218px）；底提示带 y540
 * （居中 ≤340px 宽即 190-530，与说明按钮 644-704 净距 ≥114px）；说明按钮
 * 644-704 x 528-552。全部在 720x560 逻辑画布内。无反引号模板字符串。
 */
import type { KickRecord, MatchState, Zone } from './logic.ts';
/** 逻辑画布尺寸。 */
export declare const LOGICAL_W = 720;
export declare const LOGICAL_H = 560;
/** 球门矩形（门线视角，含六区网格）。 */
export declare const GOAL: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 力度滑条矩形。 */
export declare const POWER_BAR: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 力度滑条的可点命中区（比滑条本体外扩，便于拖拽）。 */
export declare const POWER_HIT: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 点球点。 */
export declare const PEN_SPOT: {
    x: number;
    y: number;
};
/** 说明按钮矩形（右下角，60x24）。 */
export declare const HELP_BTN: {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** 一格球门区的逻辑矩形。 */
export interface ZoneRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/**
 * 六区中某一格的矩形（行×列均分球门）。
 * @param zone - 区号（行*2+列）。
 * @returns 该格矩形。
 */
export declare function zoneRect(zone: Zone): ZoneRect;
/**
 * 六区中某一格的中心点（球飞行的落点/守门员扑向点）。
 * @param zone - 区号。
 * @returns 中心坐标。
 */
export declare function zoneCenter(zone: Zone): {
    x: number;
    y: number;
};
/**
 * 命中测试：逻辑坐标落在球门哪一格。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的区号，球门外返回 null。
 */
export declare function zoneFromPoint(px: number, py: number): Zone | null;
/**
 * 命中测试：拖拽位置换算力度（越界自动收敛）。
 * @param px - 逻辑 x。
 * @returns 对应力度。
 */
export declare function powerFromPoint(px: number): number;
/** 渲染阶段：罚球瞄准 / 扑救预读 / 罚球动画 / 终局（渲染按此显式分派）。 */
export type SceneMode = 'shoot' | 'read' | 'anim' | 'over';
/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
    /** 渲染阶段（显式分派源）。 */
    mode: SceneMode;
    /** 比赛逻辑状态。 */
    state: MatchState;
    /** 罚球阶段当前瞄准区。 */
    aimZone: Zone;
    /** 罚球阶段当前力度。 */
    power: number;
    /** 鼠标悬停的球门区（可空）。 */
    hoverZone: Zone | null;
    /** 进行中的罚球动画（anim 阶段非空）：记录 + 进度 t∈[0,1]。 */
    anim: {
        record: KickRecord;
        t: number;
    } | null;
    /** 预读剩余秒数（read 阶段，<=0 表示已到时待点击）。 */
    countdown: number;
    /** 累计时钟秒（脉冲动画）。 */
    clock: number;
}
/**
 * 整帧绘制：背景 + HUD + 点球格 + 球门 + 球场 + 守门员/球（按阶段显式
 * 分派）+ 力度滑条 + 阶段提示 + 说明按钮与帮助面板（末尾最上层）。
 * overlay 由 index 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export declare function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen?: boolean): void;
