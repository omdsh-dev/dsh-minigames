/**
 * 「提灯人 Lamplight」纯逻辑：seed 程序化生成的网格小镇夜行解谜。
 * 玩家四向移动，随身油灯照亮周围（半径随灯油余量分档缩小）；
 * 走到路灯格即点亮，路灯永久照亮其周围 2 格，成为黑暗中的驿站。
 * 每走一步耗 1 格灯油，绿色油瓶格补给 +2；第 3 关起出现暗影——
 * 只在与玩家相邻（切比雪夫半径 1）时追击，接触会熄灭最近点亮的
 * 一盏路灯并退回出生点。所有随机（地形、路灯/油瓶/暗影落点、暗影
 * 游走）都来自注入 seed 的 mulberry32：同 seed + 同操作序列得到
 * 完全相同的局面，渲染层与单元测试都依赖这一确定性。
 */
/** 四向移动方向。 */
export type Dir = 'up' | 'down' | 'left' | 'right';
/** 对局状态：进行中 / 单关完成 / 全部通关 / 灯油耗尽失败。 */
export type GameStatus = 'playing' | 'levelClear' | 'allClear' | 'gameover';
/** 一盏路灯（坐标 + 是否已点亮）。 */
export interface Lamp {
    /** 列坐标。 */
    x: number;
    /** 行坐标。 */
    y: number;
    /** 是否已点亮（永久照亮周围 2 格）。 */
    lit: boolean;
}
/** 一个油瓶补给格（取用后消失）。 */
export interface Bottle {
    x: number;
    y: number;
    /** 是否已被拾取。 */
    taken: boolean;
}
/** 一只游荡暗影（接触玩家后退回出生点）。 */
export interface Shadow {
    /** 稳定自增 id（确定性遍历顺序）。 */
    id: number;
    x: number;
    y: number;
    /** 出生点（接触后回到这里）。 */
    spawnX: number;
    spawnY: number;
}
/** 一关的完整局面（可变；由 movePlayer 推进）。 */
export interface LamplightState {
    /** 1 起的关卡号（1..LEVEL_COUNT）。 */
    level: number;
    cols: number;
    rows: number;
    /** 行主序地形：1 = 建筑（不可走），0 = 街道。 */
    walls: Uint8Array;
    /** 路灯数组。 */
    lamps: Lamp[];
    /** 油瓶数组。 */
    bottles: Bottle[];
    /** 暗影数组。 */
    shadows: Shadow[];
    player: {
        x: number;
        y: number;
    };
    /** 剩余灯油（每步 -1，油瓶 +2；归零即失败）。 */
    oil: number;
    /** 本关初始灯油（HUD 油量条分母）。 */
    oilStart: number;
    /** 本关已走步数。 */
    moves: number;
    /** 已点亮路灯的索引序列（末位是最近点亮的；暗影接触时熄灭它）。 */
    litOrder: number[];
    /** 行主序记忆掩码：曾被照亮过的格子保持 1（渲染层画暗色轮廓）。 */
    seen: Uint8Array;
    status: GameStatus;
    /** 注入的确定性随机源（暗影游走继续消耗）。 */
    rand: () => number;
}
/** 每关配置：盘面尺寸、路灯数、油瓶数、初始灯油、暗影数。 */
export interface LevelConfig {
    cols: number;
    rows: number;
    lamps: number;
    bottles: number;
    oil: number;
    shadows: number;
}
/** 总关数。 */
export declare const LEVEL_COUNT = 5;
/** 路灯永久照明半径（格，欧氏距离）。 */
export declare const LAMP_LIT_RADIUS = 2;
/** 玩家初始油灯半径（格，欧氏距离）。 */
export declare const FULL_LAMP_RADIUS = 2.5;
/** 每走一步消耗的灯油。 */
export declare const MOVE_OIL_COST = 1;
/** 每个油瓶补给的灯油。 */
export declare const BOTTLE_OIL = 2;
/** 暗影的追击感知半径（切比雪夫距离，格）。 */
export declare const SHADOW_SENSE = 1;
/**
 * 取某关的配置（level 超界时钳到 1..LEVEL_COUNT）。
 * @param level 1 起的关卡号。
 * @returns 该关的尺寸与数量配置。
 */
export declare function levelConfig(level: number): LevelConfig;
/**
 * 油灯当前照明半径：油量分档缩圈。
 * 油量 ≥8 → 2.5 格；≥5 → 2；≥3 → 1.5；≥1 → 1；0 → 熄灭。
 * @param oil 剩余灯油。
 * @returns 当前半径（格）。
 */
export declare function lampRadius(oil: number): number;
/** 格是否为建筑（不可走）。越界视为建筑。 */
export declare function isWall(state: LamplightState, x: number, y: number): boolean;
/**
 * 格子当前是否被照亮：在玩家油灯半径内，或在任一已点亮路灯的
 * LAMP_LIT_RADIUS 半径内（欧氏距离平方比较）。
 * @param state 当前局面。
 * @param x 列坐标。
 * @param y 行坐标。
 * @returns true 表示该格处于光照中。
 */
export declare function isLit(state: LamplightState, x: number, y: number): boolean;
/**
 * 生成某一关的小镇：建筑、路灯、油瓶、暗影全部由 seed 决定。
 * 生成后保证：起点到每盏路灯、每个油瓶、每只暗影 BFS 可达；
 * 路灯两两曼哈顿距离 ≥ 4（足够分散）；暗影离起点 BFS ≥ 6 步。
 * 重试 GEN_ATTEMPTS 次仍不满足则清空建筑兜底（必可达）。
 * @param seed 确定性 RNG 种子（同 seed 同 level → 同小镇）。
 * @param level 1 起的关卡号（决定递进配置）。
 * @returns 初始局面（status 恒为 playing）。
 */
export declare function generateTown(seed: number, level: number): LamplightState;
/**
 * 玩家朝 dir 走一步（若可行）。一次成功移动依次结算：
 * 移动并耗 1 油 → 拾取脚下油瓶（+2）→ 点亮脚下路灯 → 全亮判胜 →
 * 油尽判负 → 暗影各走一步（相邻追击 / 否则随机游走）→ 接触惩罚
 * （熄灭最近点亮的路灯，暗影退回出生点）→ 刷新记忆。
 * @param state 当前局面（就地修改）。
 * @param dir 移动方向。
 * @returns 是否实际移动（撞墙/越界/非进行中返回 false，不耗油）。
 */
export declare function movePlayer(state: LamplightState, dir: Dir): boolean;
