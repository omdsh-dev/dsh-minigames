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
export type SlotKind = 'attack' | 'shield' | 'fireball' | 'lifesteal'

/** 游戏阶段：战斗 / 三选一强化 / 死亡 / 通关。 */
export type Phase = 'battle' | 'upgrade' | 'dead' | 'victory'

/** 敌人攻击模式：固定每回合 / 蓄力一回合后重击 / 每两回合一次。 */
export type EnemyPattern = 'fixed' | 'telegraph' | 'interval'

/** 一颗骰子的可测视图。 */
export interface DieView {
  /** 骰子编号（同回合内递增，分配时引用）。 */
  id: number
  /** 面值 1-6。 */
  value: number
  /** 是否已分配（每颗骰每回合恰好一次）。 */
  used: boolean
}

/** 敌人视图。 */
export interface EnemyView {
  name: string
  hp: number
  maxHp: number
  /** 普通攻击力（telegraph 重击 = atk）。 */
  atk: number
  pattern: EnemyPattern
  /** telegraph：是否正在蓄力（下回合重击）。 */
  charging: boolean
  /** interval：已结束的回合数（奇数回合攻击）。 */
  turns: number
  /** 灼烧层数（每层每回合造成 fireballPower 伤害，每回合衰减 1 层）。 */
  burn: number
}

/** 玩家视图。 */
export interface PlayerView {
  hp: number
  maxHp: number
  /** 格挡值：跨回合保留，只被敌人伤害消耗。 */
  shield: number
  /** 每回合掷骰数（2 起，强化最高 4）。 */
  diceCount: number
  /** 每层灼烧伤害（2 起，强化最高 4）。 */
  fireballPower: number
  /** 吸血额外回复（0 起，强化最高 3）。 */
  lifestealBonus: number
  /** 护盾上限（15 起，强化最高 24）。 */
  shieldCap: number
  /** 火球槽是否解锁（第 1 场胜利后解锁）。 */
  hasFireball: boolean
  /** 吸血槽是否解锁（第 2 场胜利后解锁）。 */
  hasLifesteal: boolean
}

/** 强化类型：+1 骰 / 技能威力 / 回血 / 护盾上限。 */
export type UpgradeKind = 'die' | 'power' | 'heal' | 'ward'

/** 三选一强化卡片视图。 */
export interface UpgradeView {
  kind: UpgradeKind
  title: string
  desc: string
}

/** 整局对外视图（每次 view() 返回全新深拷贝，可直接比较）。 */
export interface DungeonView {
  phase: Phase
  /** 当前层 1-5。 */
  floor: number
  /** 当前战斗内回合数（从 1 起）。 */
  turn: number
  player: PlayerView
  enemy: EnemyView
  dice: DieView[]
  /** 敌人当前意图文案（渲染用，也可断言）。 */
  intent: string
  /** 最近一次结算说明（一行）。 */
  lastEvent: string
  /** upgrade 阶段的三张卡；其余阶段为 null。 */
  upgradeChoices: UpgradeView[] | null
}

/** mulberry32：32 位确定性 PRNG，同种子同序列。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 5 层敌人基线（数值再由种子微调 ±，保证确定性差异）。 */
const ENEMY_DEFS: { name: string; hp: number; atk: number; pattern: EnemyPattern }[] = [
  { name: '绿地史莱姆', hp: 12, atk: 3, pattern: 'fixed' },
  { name: '洞窟蝙蝠', hp: 15, atk: 5, pattern: 'interval' },
  { name: '骷髅卫士', hp: 19, atk: 9, pattern: 'telegraph' },
  { name: '石像魔', hp: 26, atk: 6, pattern: 'fixed' },
  { name: '守塔巨龙', hp: 34, atk: 12, pattern: 'telegraph' },
]

/** 塔层数。 */
export const MAX_FLOOR = 5
/** 玩家初始生命。 */
export const START_HP = 20
/** 护盾初始上限（防无限叠）。 */
export const SHIELD_CAP = 15
/** 护盾上限强化封顶。 */
export const SHIELD_CAP_MAX = 24
/** 骰数上限（强化封顶）。 */
export const DICE_CAP = 4
/** 灼烧威力上限。 */
export const FIRE_CAP = 4
/** 吸血加值上限。 */
export const STEAL_CAP = 3
/** 火球需求点数。 */
export const FIREBALL_NEED = 4
/** 吸血需求点数。 */
export const LIFESTEAL_NEED = 5
/** 每场胜利增加的最大生命。 */
export const WIN_MAXHP = 4

/** 引擎句柄：全部方法纯操作内部状态，view() 只给拷贝。 */
export interface DungeonEngine {
  /** 当前视图（深拷贝）。 */
  view(): DungeonView
  /** 把 id 的骰子分配到槽；非法（已用 / 槽未解锁 / 点数不足）返回 false。 */
  assign(dieId: number, slot: SlotKind): boolean
  /** 结束回合：灼烧 → 敌人行动 → 掷新骰；可能切换阶段。 */
  endTurn(): void
  /** upgrade 阶段选第 i 张卡（越界忽略）。 */
  chooseUpgrade(i: number): void
  /** 结算分数：层数×100 + 通关 500 + 当前生命。 */
  score(): number
  /** 原地重开一局新种子（保留引擎句柄）。 */
  restart(seed: number): void
}

/** 敌人意图文案。 */
function intentOf(e: EnemyView): string {
  if (e.hp <= 0) return '已被击败'
  if (e.pattern === 'fixed') return '攻击 ' + String(e.atk)
  if (e.pattern === 'telegraph') return e.charging ? '蓄力完成！重击 ' + String(e.atk) : '蓄力中…下回合重击 ' + String(e.atk)
  return e.turns % 2 === 0 ? '休整（下下回合攻击 ' + String(e.atk) + '）' : '攻击 ' + String(e.atk)
}

/** 生成第 floor 层敌人（种子微调：HP +0..3、攻击 +0..1）。 */
function makeEnemy(rand: () => number, floor: number): EnemyView {
  const def = ENEMY_DEFS[Math.min(floor, MAX_FLOOR) - 1]!
  return {
    name: def.name,
    hp: def.hp + Math.floor(rand() * 4),
    maxHp: def.hp + Math.floor(rand() * 4),
    atk: def.atk + Math.floor(rand() * 2),
    pattern: def.pattern,
    charging: false,
    turns: 0,
    burn: 0,
  }
}

/** 由当前玩家状态构造三张强化卡（达到上限的类别依次让位，不满三种以回血补足）。 */
function makeChoices(rand: () => number, p: PlayerView): UpgradeView[] {
  const heal: UpgradeView = { kind: 'heal', title: '篝火治疗', desc: '立刻回复 10 点生命' }
  const pool: UpgradeView[] = []
  if (p.diceCount < DICE_CAP) {
    pool.push({ kind: 'die', title: '多一颗骰', desc: '每回合掷 ' + String(p.diceCount + 1) + ' 颗骰子' })
  }
  if (p.fireballPower < FIRE_CAP || p.lifestealBonus < STEAL_CAP) {
    pool.push({ kind: 'power', title: '技能威力', desc: '灼烧 ' + String(p.fireballPower + 1) + '/层，吸血 +' + String(p.lifestealBonus + 1) })
  }
  if (p.shieldCap < SHIELD_CAP_MAX) {
    pool.push({ kind: 'ward', title: '塔盾淬炼', desc: '护盾上限 +3，并立刻获得 3 点护盾' })
  }
  while (pool.length < 3) pool.push(heal)
  // 种子洗牌展示顺序（不影响种类集合）。
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool
}

/** 建一局游戏；所有随机都来自注入 seed 的 mulberry32。 */
export function createDungeon(seed: number): DungeonEngine {
  let rand = mulberry32(seed)
  let phase: Phase = 'battle'
  let floor = 1
  let turn = 1
  let lastEvent = '地牢大门开启……'
  const player: PlayerView = {
    hp: START_HP,
    maxHp: START_HP,
    shield: 0,
    diceCount: 2,
    fireballPower: 2,
    lifestealBonus: 0,
    shieldCap: SHIELD_CAP,
    hasFireball: false,
    hasLifesteal: false,
  }
  let enemy = makeEnemy(rand, floor)
  let dice: DieView[] = []
  let upgradeChoices: UpgradeView[] | null = null

  /** 掷本回合骰子。 */
  const roll = (): void => {
    dice = []
    for (let i = 0; i < player.diceCount; i += 1) {
      dice.push({ id: i, value: 1 + Math.floor(rand() * 6), used: false })
    }
  }
  roll()

  const snapshot = (): DungeonView => ({
    phase,
    floor,
    turn,
    player: { ...player },
    enemy: { ...enemy },
    dice: dice.map(d => ({ ...d })),
    intent: intentOf(enemy),
    lastEvent,
    upgradeChoices: upgradeChoices === null ? null : upgradeChoices.map(u => ({ ...u })),
  })

  /** 战斗胜利：发奖励并进入强化 / 通关。 */
  const winBattle = (): void => {
    player.maxHp += WIN_MAXHP
    player.hp = Math.min(player.maxHp, player.hp + WIN_MAXHP)
    if (floor === 1) player.hasFireball = true
    if (floor === 2) player.hasLifesteal = true
    lastEvent = '击败 ' + enemy.name + '！最大生命 +' + String(WIN_MAXHP)
    if (floor >= MAX_FLOOR) {
      phase = 'victory'
      upgradeChoices = null
      return
    }
    phase = 'upgrade'
    upgradeChoices = makeChoices(rand, player)
  }

  /** 敌人对玩家造成伤害（先耗盾，余下入血）。 */
  const hitPlayer = (amount: number, label: string): void => {
    const absorbed = Math.min(player.shield, amount)
    player.shield -= absorbed
    const taken = amount - absorbed
    player.hp -= taken
    lastEvent = label + ' ' + String(amount) + '（盾挡 ' + String(absorbed) + '，掉血 ' + String(taken) + '）'
  }

  return {
    view: snapshot,
    assign(dieId: number, slot: SlotKind): boolean {
      if (phase !== 'battle') return false
      const die = dice.find(d => d.id === dieId)
      if (die === undefined || die.used) return false
      if (slot === 'fireball' && (!player.hasFireball || die.value < FIREBALL_NEED)) return false
      if (slot === 'lifesteal' && (!player.hasLifesteal || die.value < LIFESTEAL_NEED)) return false
      die.used = true
      if (slot === 'attack') {
        enemy.hp -= die.value
        lastEvent = '攻击命中 ' + enemy.name + ' ' + String(die.value) + ' 点'
        if (enemy.hp <= 0) winBattle()
      } else if (slot === 'shield') {
        player.shield = Math.min(player.shieldCap, player.shield + die.value)
        lastEvent = '举起护盾 +' + String(die.value) + '（当前 ' + String(player.shield) + '）'
      } else if (slot === 'fireball') {
        enemy.burn += 1
        lastEvent = '火球点燃 ' + enemy.name + '（灼烧 ' + String(enemy.burn) + ' 层）'
      } else {
        const healed = Math.min(player.maxHp - player.hp, die.value + player.lifestealBonus)
        player.hp += healed
        lastEvent = '吸血回复 ' + String(healed) + ' 点生命'
      }
      return true
    },
    endTurn(): void {
      if (phase !== 'battle') return
      // 1) 灼烧结算与衰减。
      if (enemy.burn > 0) {
        const dmg = enemy.burn * player.fireballPower
        enemy.hp -= dmg
        enemy.burn -= 1
        lastEvent = '灼烧造成 ' + String(dmg) + ' 点伤害'
        if (enemy.hp <= 0) {
          winBattle()
          return
        }
      }
      // 2) 敌人按模式行动。
      enemy.turns += 1
      if (enemy.pattern === 'fixed') {
        hitPlayer(enemy.atk, enemy.name + ' 攻击')
      } else if (enemy.pattern === 'telegraph') {
        if (enemy.charging) {
          enemy.charging = false
          hitPlayer(enemy.atk, enemy.name + ' 蓄力重击')
        } else {
          enemy.charging = true
          lastEvent = enemy.name + ' 正在蓄力……'
        }
      } else if (enemy.turns % 2 === 1) {
        hitPlayer(enemy.atk, enemy.name + ' 扑击')
      } else {
        lastEvent = enemy.name + ' 盘旋休整'
      }
      // 3) 玩家死亡判定。
      if (player.hp <= 0) {
        player.hp = 0
        phase = 'dead'
        return
      }
      // 4) 下一回合：掷新骰。
      turn += 1
      roll()
    },
    chooseUpgrade(i: number): void {
      if (phase !== 'upgrade' || upgradeChoices === null) return
      const card = upgradeChoices[i]
      if (card === undefined) return
      if (card.kind === 'die') player.diceCount = Math.min(DICE_CAP, player.diceCount + 1)
      else if (card.kind === 'power') {
        player.fireballPower = Math.min(FIRE_CAP, player.fireballPower + 1)
        player.lifestealBonus = Math.min(STEAL_CAP, player.lifestealBonus + 1)
      } else if (card.kind === 'ward') {
        player.shieldCap = Math.min(SHIELD_CAP_MAX, player.shieldCap + 3)
        player.shield = Math.min(player.shieldCap, player.shield + 3)
      } else {
        player.hp = Math.min(player.maxHp, player.hp + 10)
      }
      upgradeChoices = null
      phase = 'battle'
      floor += 1
      turn = 1
      enemy = makeEnemy(rand, floor)
      lastEvent = '登上第 ' + String(floor) + ' 层：' + enemy.name
      roll()
    },
    score(): number {
      if (phase === 'victory') return MAX_FLOOR * 100 + 500 + player.hp
      if (phase === 'dead') return floor * 100 + player.hp
      return (floor - 1) * 100 + player.hp
    },
    restart(nextSeed: number): void {
      rand = mulberry32(nextSeed)
      phase = 'battle'
      floor = 1
      turn = 1
      lastEvent = '地牢大门开启……'
      player.hp = START_HP
      player.maxHp = START_HP
      player.shield = 0
      player.diceCount = 2
      player.fireballPower = 2
      player.lifestealBonus = 0
      player.shieldCap = SHIELD_CAP
      player.hasFireball = false
      player.hasLifesteal = false
      enemy = makeEnemy(rand, floor)
      upgradeChoices = null
      roll()
    },
  }
}
