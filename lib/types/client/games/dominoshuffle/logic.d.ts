/**
 * 骨牌对对（DominoShuffle）纯逻辑：一排 8-14 张数字骨牌，只能交换
 * 相邻两张（部分关卡存在锁定骨牌，锁定槽位上的骨牌不可参与交换），
 * 目标是把整排排成左小右大的升序。生成器从有序目标出发、只在连续
 * 未锁定窗口内洗牌，因此局面永远可以在「初始逆序对数」次合法交换内
 * 复原；步数预算 = 初始逆序对数 + 关卡缓冲（第 5 关缓冲为 0，要求
 * 步步都消除一个逆序）。全部随机走注入 seed 的 mulberry32，同 seed
 * + 同输入脚本重放一致；逻辑层不接触 DOM。
 */
/** 逻辑画布宽（HUD 与全部元素包含在内）。 */
export declare const W = 640;
/** 逻辑画布高。 */
export declare const H = 480;
/** 盘面左右留白。 */
export declare const BOARD_MARGIN = 24;
/** 骨牌行上沿 y。 */
export declare const BOARD_Y = 210;
/** 单张骨牌高（竖长骨牌）。 */
export declare const TILE_H = 84;
/** 相邻骨牌间隙。 */
export declare const TILE_GAP = 8;
/** 骨牌宽上限（张数少时不至于过宽）。 */
export declare const MAX_TILE_W = 60;
/** HUD 右下「说明」按钮矩形（渲染与点击命中共用）。 */
export declare const HELP_BTN: {
    readonly x: number;
    readonly y: 34;
    readonly w: 60;
    readonly h: 24;
};
/** 每关提示次数上限。 */
export declare const HINT_MAX = 3;
/** 关卡总数。 */
export declare const LEVEL_COUNT = 5;
/** 单关规格：骨牌张数、锁定张数、步数缓冲（超出逆序对数的余量）。 */
export interface DominoLevelSpec {
    count: number;
    locks: number;
    buffer: number;
}
/** 五关递进：8→14 张、锁定 0→4 张、缓冲 3→0。 */
export declare const LEVELS: readonly DominoLevelSpec[];
/** 单步内产生、供渲染层消费的可视事件。 */
export type DominoEvent = {
    type: 'swap';
    i: number;
    j: number;
    x: number;
    y: number;
} | {
    type: 'lockedClick';
    i: number;
    x: number;
    y: number;
} | {
    type: 'level';
    level: number;
    x: number;
    y: number;
} | {
    type: 'win';
    x: number;
    y: number;
} | {
    type: 'fail';
    x: number;
    y: number;
};
/** 一局游戏的完整可测状态。 */
export interface DominoShuffleState {
    /** 当前关（1 起，最大 LEVEL_COUNT）。 */
    level: number;
    /** 各槽位的骨牌值（1..n 的排列）。 */
    tiles: number[];
    /** 各槽位是否锁定（锁定槽上的骨牌不可交换）。 */
    locked: boolean[];
    /** 已用交换次数。 */
    moves: number;
    /** 本关步数预算 = 初始逆序对数 + 缓冲。 */
    budget: number;
    /** 当前逆序对数（剩余最少交换次数）。 */
    inversions: number;
    /** 剩余提示次数。 */
    hintsLeft: number;
    /** 当前选中的槽位（无则 null）。 */
    selected: number | null;
    /** 提示高亮的相邻对 [左槽, 右槽]（下一次交换后清除）。 */
    hintPair: [number, number] | null;
    /** 累计得分（跨关累加）。 */
    score: number;
    /** 局面是否已结束（过关或步数用尽）。 */
    over: boolean;
    /** over 时是否通关（第 5 关排完）。 */
    win: boolean;
    /** 本局的确定性随机源。 */
    rng: () => number;
    /** 供渲染层消费的事件（每次逻辑调用开头清空）。 */
    events: DominoEvent[];
}
/**
 * mulberry32 确定性随机数发生器。
 * @param seed - 非负整数种子。
 * @returns 返回 [0,1) 均匀随机数的函数。
 */
export declare function mulberry32(seed: number): () => number;
/**
 * 数组的逆序对数（相邻交换每次恰好改变 ±1，即剩余最少交换次数）。
 * @param tiles - 骨牌值数组。
 * @returns 逆序对个数。
 */
export declare function countInversions(tiles: readonly number[]): number;
/**
 * 数组是否已排成升序。
 * @param tiles - 骨牌值数组。
 * @returns 升序返回 true。
 */
export declare function isSortedTiles(tiles: readonly number[]): boolean;
/**
 * n 张骨牌时单张宽度（随张数自适应，封顶 MAX_TILE_W）。
 * @param n - 骨牌张数。
 * @returns 单张骨牌宽。
 */
export declare function tileW(n: number): number;
/**
 * n 张骨牌时整行的左端 x（水平居中）。
 * @param n - 骨牌张数。
 * @returns 行首骨牌左上角 x。
 */
export declare function boardX(n: number): number;
/**
 * 第 i 张骨牌的矩形（渲染与点击命中共用）。
 * @param i - 槽位索引（0 起）。
 * @param n - 骨牌张数。
 * @returns 该骨牌的左上角与宽高。
 */
export declare function tileRect(i: number, n: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/**
 * 点击落在哪张骨牌上。
 * @param state - 目标状态。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 槽位索引，未命中返回 null。
 */
export declare function tileAt(state: DominoShuffleState, x: number, y: number): number | null;
/**
 * 点击是否落在「说明」按钮矩形内。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中返回 true。
 */
export declare function inHelpButton(x: number, y: number): boolean;
/**
 * 新开一局（指定起始关；同 seed + 同 level 的局面完全一致，便于重开
 * 本关重试与测试重放）。
 * @param seed - 外部种子（如日期）。
 * @param level - 起始关（1 起）。
 * @param score - 起始累计得分。
 * @returns 初始状态。
 */
export declare function createDominoShuffle(seed: number, level?: number, score?: number): DominoShuffleState;
/**
 * 尝试交换槽位 i 与 j 的骨牌：仅接受相邻且双方都未锁定的对；交换后
 * 重算逆序对——排成升序即过关结算；未排好但步数达到预算则判负。
 * @param state - 目标状态。
 * @param i - 槽位索引。
 * @param j - 槽位索引。
 * @returns 'ok' | 'notAdjacent' | 'locked' | 'over'（被拒绝时状态不变）。
 */
export declare function attemptSwap(state: DominoShuffleState, i: number, j: number): 'ok' | 'notAdjacent' | 'locked' | 'over';
/**
 * 选中 / 取消选中一张未锁定的骨牌（锁定与越界返回 false 且不改状态）。
 * @param state - 目标状态。
 * @param i - 槽位索引。
 * @returns 选中或切换成功返回 true。
 */
export declare function selectTile(state: DominoShuffleState, i: number): boolean;
/**
 * 请求提示：高亮从左到右第一对「相邻、未锁定、左大右小」的骨牌（交
 * 换它恰好消除一个逆序）。剩余次数为 0 或局面已结束时返回 null。
 * @param state - 目标状态。
 * @returns 提示对 [左槽, 右槽]，无可用提示返回 null。
 */
export declare function requestHint(state: DominoShuffleState): [number, number] | null;
