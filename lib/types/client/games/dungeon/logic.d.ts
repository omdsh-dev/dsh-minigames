/**
 * 「像素地牢」纯逻辑：seed 程序化生成的回合制 mini roguelike。
 * 12×10 网格，房间 + L 形走廊连通；玩家四向移动，每走一步所有怪物
 * 行动一次（相邻攻击 / BFS 单步追击 / 随机游走）。战斗是简化的互扣
 * 血；药水、宝箱、楼梯下行、5 层递进与第 5 层 Boss 全部在此实现。
 * 所有随机都来自注入 seed 的 mulberry32 状态：同 seed + 同操作序列
 * 得到完全相同的局面——渲染层与单元测试都依赖这一确定性。
 */
/** 地牢列数（含外墙格）。 */
export declare const COLS = 12;
/** 地牢行数（含外墙格）。 */
export declare const ROWS = 10;
/** 总层数；第 5 层是 Boss 层（无楼梯）。 */
export declare const FLOOR_COUNT = 5;
/** 火把视野半径（格，按欧氏距离平方 +0.5 容差比较）。 */
export declare const TORCH_RADIUS = 4;
/** 玩家初始生命上限。 */
export declare const START_HP = 20;
/** 药水恢复的生命值。 */
export declare const POTION_HEAL = 8;
/** 玩家基础伤害下限（+攻升级 +0..2 随机 → 初始 2-4）。 */
export declare const PLAYER_ATK_BASE = 2;
/** 怪物开始追击的 BFS 距离上限。 */
export declare const CHASE_DIST = 8;
/** 四向方向。 */
export type Dir = 'up' | 'down' | 'left' | 'right';
/** 怪物种类（对应 5 层的强度阶梯 + Boss）。 */
export type MonsterKind = 'slime' | 'bat' | 'skeleton' | 'mage' | 'dragon' | 'boss';
/** 物品种类。 */
export type ItemKind = 'potion' | 'chest';
/** 对局状态。 */
export type GameStatus = 'playing' | 'dead' | 'won';
/** 每种怪的数值表：血、伤害上限（实际 1..atk）、金币、经验。 */
export declare const MONSTER_STATS: Record<MonsterKind, {
    name: string;
    hp: number;
    atk: number;
    gold: number;
    exp: number;
}>;
/** 一只活着的怪物。 */
export interface Monster {
    /** 稳定自增 id（回合内"已行动"标记与确定性遍历用）。 */
    id: number;
    kind: MonsterKind;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
}
/** 地上的一件物品。 */
export interface Item {
    kind: ItemKind;
    x: number;
    y: number;
}
/** 一层地牢：地形 + 实体。tiles 为 0=墙、1=地板 的行主序数组。 */
export interface Floor {
    /** 1 起的层号。 */
    index: number;
    tiles: Uint8Array;
    monsters: Monster[];
    items: Item[];
    /** 下行楼梯；第 5 层为 null（击杀 Boss 即通关）。 */
    stairs: {
        x: number;
        y: number;
    } | null;
}
/** 整局状态（含跨层保留的冒险者属性）。 */
export interface DungeonState {
    /** mulberry32 当前状态；全部随机由它驱动。 */
    rngState: number;
    floor: Floor;
    player: {
        x: number;
        y: number;
    };
    hp: number;
    maxHp: number;
    /** 武器升级次数：伤害 = 2 + atkUp + 0..2。 */
    atkUp: number;
    gold: number;
    exp: number;
    level: number;
    status: GameStatus;
    /** 1 起的当前层号（与 floor.index 同步）。 */
    floorIndex: number;
    /** 本层已探索（曾照亮）过的格子。 */
    explored: Uint8Array;
    /** 下一只怪物的 id。 */
    nextMonsterId: number;
}
/** 回合产生的浮动事件（渲染层转成浮动数字 / 特效）。 */
export interface GameEvent {
    kind: 'hit' | 'hurt' | 'heal' | 'gold' | 'atkup' | 'levelup' | 'kill' | 'descend' | 'win' | 'dead';
    x: number;
    y: number;
    value?: number;
}
/** 注入式随机源：从整数 seed 创建 mulberry32 序列（生成/测试用）。 */
export declare function mulberry32(seed: number): () => number;
/** 四向偏移（固定顺序：确定性遍历用）。 */
export declare const DIRS4: readonly (readonly [number, number])[];
/** (x,y) 是否为可走地板。 */
export declare function isFloor(floor: Floor, x: number, y: number): boolean;
/** 找 (x,y) 上的活怪。 */
export declare function monsterAt(floor: Floor, x: number, y: number): Monster | undefined;
/**
 * 从 (sx,sy) 出发的四向 BFS 距离场（墙/出界 = -1）。
 * 楼梯可达性验证与怪物追击都基于它。
 */
export declare function distanceField(floor: Floor, sx: number, sy: number): Int16Array;
/** 从玩家出发的火把可见格（半径内即见，不挡墙——简化的火光）。 */
export declare function computeVisible(px: number, py: number): Uint8Array;
/**
 * 玩家走一步（回合制主入口）：撞墙不消耗回合；走入怪物格即攻击
 * （先手 2+atkUp+0..2），杀死则占格并结算掉落；幸存怪物立即反击，
 * 其余怪物随后行动。
 * @param state 对局状态（原地推进）。
 * @param dir 四向之一。
 * @returns 本回合的浮动事件列表（可能为空 = 撞墙）。
 */
export declare function playerTurn(state: DungeonState, dir: Dir): GameEvent[];
/**
 * 开新局：seed 决定第 1 层布局与其后所有随机；死亡重开时把减半的
 * 金币带进来（roguelike 传承）。
 * @param seed 注入的整数种子。
 * @param inheritedGold 继承金币（死亡重来 = floor(gold/2)，默认 0）。
 * @returns 初始化好的对局状态。
 */
export declare function createRun(seed: number, inheritedGold?: number): DungeonState;
/**
 * 计分：金币 + 已下行层数×100，通关再 +500。
 * @param state 对局状态。
 * @returns 当前应上报的分数。
 */
export declare function scoreOf(state: DungeonState): number;
