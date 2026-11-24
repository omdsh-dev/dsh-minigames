/**
 * 骰子地牢（DiceDungeon）纯逻辑：掷骰分配式回合制战斗 roguelike。
 * 每回合掷若干颗六面骰（seed 注入、逐位确定），把每颗骰子恰好分配到
 * 一个槽：攻击（等值伤害）/ 护盾（等值格挡，保留到被消耗）/ 火球
 * （≥4 点燃敌人，每回合结算灼烧并衰减）/ 吸血（≥5 回等值血）。敌人
 * 数值化：HP + 攻击模式（固定 / 蓄力 telegraph / 间隔）。5 层闯塔，
 * 胜利加最大血量、解锁技能槽，间隙三选一强化。无 DOM、无全局状态；
 * 同一种子 + 同一动作序列必然得到完全一致的结果（可整塔重放）。
 */
/** 槽类型：攻击 / 护盾 / 火球（需 ≥4）/ 吸血（需 ≥5）。 */
export type SlotKind = 'attack' | 'shield' | 'fireball' | 'lifesteal';
/** 游戏阶段：战斗 / 三选一强化 / 死亡 / 通关。 */
export type Phase = 'battle' | 'upgrade' | 'dead' | 'victory';
/** 敌人攻击模式：固定每回合 / 蓄力一回合后重击 / 每两回合一次。 */
export type EnemyPattern = 'fixed' | 'telegraph' | 'interval';
/** 一颗骰子的可测视图。 */
export interface DieView {
    /** 骰子编号（同回合内递增，分配时引用）。 */
    id: number;
    /** 面值 1-6。 */
    value: number;
    /** 是否已分配（每颗骰每回合恰好一次）。 */
    used: boolean;
}
/** 敌人视图。 */
export interface EnemyView {
    name: string;
    hp: number;
    maxHp: number;
    /** 普通攻击力（telegraph 重击 = atk）。 */
    atk: number;
    pattern: EnemyPattern;
    /** telegraph：是否正在蓄力（下回合重击）。 */
    charging: boolean;
    /** interval：已结束的回合数（奇数回合攻击）。 */
    turns: number;
    /** 灼烧层数（每层每回合造成 fireballPower 伤害，每回合衰减 1 层）。 */
    burn: number;
}
/** 玩家视图。 */
export interface PlayerView {
    hp: number;
    maxHp: number;
    /** 格挡值：跨回合保留，只被敌人伤害消耗。 */
    shield: number;
    /** 每回合掷骰数（2 起，强化最高 4）。 */
    diceCount: number;
    /** 每层灼烧伤害（2 起，强化最高 4）。 */
    fireballPower: number;
    /** 吸血额外回复（0 起，强化最高 3）。 */
    lifestealBonus: number;
    /** 护盾上限（15 起，强化最高 24）。 */
    shieldCap: number;
    /** 火球槽是否解锁（第 1 场胜利后解锁）。 */
    hasFireball: boolean;
    /** 吸血槽是否解锁（第 2 场胜利后解锁）。 */
    hasLifesteal: boolean;
}
/** 强化类型：+1 骰 / 技能威力 / 回血 / 护盾上限。 */
export type UpgradeKind = 'die' | 'power' | 'heal' | 'ward';
/** 三选一强化卡片视图。 */
export interface UpgradeView {
    kind: UpgradeKind;
    title: string;
    desc: string;
}
/** 整局对外视图（每次 view() 返回全新深拷贝，可直接比较）。 */
export interface DungeonView {
    phase: Phase;
    /** 当前层 1-5。 */
    floor: number;
    /** 当前战斗内回合数（从 1 起）。 */
    turn: number;
    player: PlayerView;
    enemy: EnemyView;
    dice: DieView[];
    /** 敌人当前意图文案（渲染用，也可断言）。 */
    intent: string;
    /** 最近一次结算说明（一行）。 */
    lastEvent: string;
    /** upgrade 阶段的三张卡；其余阶段为 null。 */
    upgradeChoices: UpgradeView[] | null;
}
/** mulberry32：32 位确定性 PRNG，同种子同序列。 */
export declare function mulberry32(seed: number): () => number;
/** 塔层数。 */
export declare const MAX_FLOOR = 5;
/** 玩家初始生命。 */
export declare const START_HP = 20;
/** 护盾初始上限（防无限叠）。 */
export declare const SHIELD_CAP = 15;
/** 护盾上限强化封顶。 */
export declare const SHIELD_CAP_MAX = 24;
/** 骰数上限（强化封顶）。 */
export declare const DICE_CAP = 4;
/** 灼烧威力上限。 */
export declare const FIRE_CAP = 4;
/** 吸血加值上限。 */
export declare const STEAL_CAP = 3;
/** 火球需求点数。 */
export declare const FIREBALL_NEED = 4;
/** 吸血需求点数。 */
export declare const LIFESTEAL_NEED = 5;
/** 每场胜利增加的最大生命。 */
export declare const WIN_MAXHP = 4;
/** 引擎句柄：全部方法纯操作内部状态，view() 只给拷贝。 */
export interface DungeonEngine {
    /** 当前视图（深拷贝）。 */
    view(): DungeonView;
    /** 把 id 的骰子分配到槽；非法（已用 / 槽未解锁 / 点数不足）返回 false。 */
    assign(dieId: number, slot: SlotKind): boolean;
    /** 结束回合：灼烧 → 敌人行动 → 掷新骰；可能切换阶段。 */
    endTurn(): void;
    /** upgrade 阶段选第 i 张卡（越界忽略）。 */
    chooseUpgrade(i: number): void;
    /** 结算分数：层数×100 + 通关 500 + 当前生命。 */
    score(): number;
    /** 原地重开一局新种子（保留引擎句柄）。 */
    restart(seed: number): void;
}
/** 建一局游戏；所有随机都来自注入 seed 的 mulberry32。 */
export declare function createDungeon(seed: number): DungeonEngine;
