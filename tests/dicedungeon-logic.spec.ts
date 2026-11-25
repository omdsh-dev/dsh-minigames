import { describe, expect, it } from 'vitest'
import {
  DICE_CAP,
  FIREBALL_NEED,
  LIFESTEAL_NEED,
  MAX_FLOOR,
  SHIELD_CAP,
  START_HP,
  createDungeon,
  mulberry32,
  type DungeonEngine,
  type DungeonView,
  type SlotKind,
} from '../src/client/games/dicedungeon/logic.ts'
import { wrapTextByMeasure } from '../src/client/games/dicedungeon/render.ts'

/** 打到当前层敌人死亡（全攻击），返回进入下一状态后的视图。 */
function autoKill(engine: DungeonEngine, maxTurns = 40): DungeonView {
  for (let i = 0; i < maxTurns; i += 1) {
    const v = engine.view()
    if (v.phase !== 'battle') return v
    for (const die of v.dice) {
      if (!die.used) engine.assign(die.id, 'attack')
    }
    engine.endTurn()
  }
  return engine.view()
}

/** 贪心机器人：小骰护盾、大骰攻击、缺血吸血、高血量火球，选强化偏好骰子。 */
function botStep(engine: DungeonEngine): void {
  const v = engine.view()
  if (v.phase === 'upgrade') {
    const cards = v.upgradeChoices ?? []
    let idx = cards.findIndex(c => c.kind === 'die')
    if (idx < 0) idx = cards.findIndex(c => (v.player.hp <= 12 ? c.kind === 'heal' : c.kind === 'power'))
    if (idx < 0) idx = cards.findIndex(c => c.kind === 'heal')
    engine.chooseUpgrade(Math.max(0, idx))
    return
  }
  if (v.phase !== 'battle') return
  const threat = v.enemy.pattern === 'fixed' || v.enemy.charging || v.enemy.turns % 2 === 0
  const dice = [...v.dice].filter(d => !d.used).sort((a, b) => b.value - a.value)
  for (const die of dice) {
    let slot: SlotKind = 'attack'
    if (v.player.hasLifesteal && die.value >= LIFESTEAL_NEED && v.player.hp <= v.player.maxHp - die.value - 2) slot = 'lifesteal'
    else if (v.player.hasFireball && die.value >= FIREBALL_NEED && v.enemy.hp >= 10 && v.enemy.burn < 3) slot = 'fireball'
    else if (die.value <= 3 && threat && v.player.shield < 10) slot = 'shield'
    engine.assign(die.id, slot)
  }
  engine.endTurn()
}

/** 机器人整局录制：每步后的视图快照序列。 */
function botRun(seed: number, maxSteps = 400): DungeonView[] {
  const engine = createDungeon(seed)
  const snaps: DungeonView[] = [engine.view()]
  for (let i = 0; i < maxSteps; i += 1) {
    const before = engine.view()
    botStep(engine)
    snaps.push(engine.view())
    const after = engine.view()
    if (after.phase === 'dead' || after.phase === 'victory') break
    if (before.phase === after.phase && before.turn === after.turn && before.floor === after.floor) break
  }
  return snaps
}

describe('dicedungeon logic', () => {
  it('mulberry32 同种子同序列、异种子不同', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('开局掷出 2 颗 1-6 骰，且同种子逐位一致', () => {
    const v1 = createDungeon(42).view()
    const v2 = createDungeon(42).view()
    expect(v1.dice).toHaveLength(2)
    expect(v1.dice).toEqual(v2.dice)
    for (const die of v1.dice) expect(die.value).toBeGreaterThanOrEqual(1)
    for (const die of v1.dice) expect(die.value).toBeLessThanOrEqual(6)
    expect(v1.phase).toBe('battle')
    expect(v1.player.hp).toBe(START_HP)
  })

  it('分配合法性：每骰一次、技能门槛、未解锁拒绝', () => {
    const engine = createDungeon(5)
    const v = engine.view()
    const die = v.dice[0]!
    // 未解锁的技能槽直接拒绝。
    expect(engine.assign(die.id, 'fireball')).toBe(false)
    expect(engine.assign(die.id, 'lifesteal')).toBe(false)
    expect(engine.assign(die.id, 'attack')).toBe(true)
    // 已用的骰子不能再次分配。
    expect(engine.assign(die.id, 'shield')).toBe(false)
    // 结束回合后新骰恢复可用。
    engine.endTurn()
    const next = engine.view()
    expect(engine.assign(next.dice[0]!.id, 'shield')).toBe(true)
  })

  it('攻击击杀进入三选一，发放本层奖励', () => {
    let seed = 0
    let engine = createDungeon(seed)
    // 找一个首回合两骰点数和不低于史莱姆 HP 的种子（一回合击杀）。
    const sum = (v: DungeonView): number => v.dice.reduce((s2, d) => s2 + d.value, 0)
    while (sum(engine.view()) < engine.view().enemy.hp && seed < 2000) {
      seed += 1
      engine = createDungeon(seed)
    }
    expect(sum(engine.view())).toBeGreaterThanOrEqual(engine.view().enemy.hp)
    const v0 = engine.view()
    for (const die of v0.dice) engine.assign(die.id, 'attack')
    const v = engine.view()
    expect(v.phase).toBe('upgrade')
    expect(v.enemy.hp).toBeLessThanOrEqual(0)
    expect(v.upgradeChoices).toHaveLength(3)
    expect(v.player.maxHp).toBe(START_HP + 4)
    expect(v.player.hasFireball).toBe(true)
    expect(v.player.hasLifesteal).toBe(false)
  })

  it('护盾跨回合保留并吸收伤害，上限截断', () => {
    const engine = createDungeon(9)
    let v = engine.view()
    // 攒盾：把所有骰子连续两回合全分护盾。
    for (let turn = 0; turn < 2; turn += 1) {
      v = engine.view()
      for (const die of v.dice) engine.assign(die.id, 'shield')
      engine.endTurn()
    }
    v = engine.view()
    expect(v.player.shield).toBeLessThanOrEqual(SHIELD_CAP)
    // 第 1 层史莱姆固定攻击：护盾先耗、余量入血。
    const shieldBefore = v.player.shield
    const hpBefore = engine.view().player.hp
    const atk = engine.view().enemy.atk
    engine.endTurn()
    const after = engine.view()
    const damage = (shieldBefore - after.player.shield) + (hpBefore - after.player.hp)
    expect(damage).toBe(atk)
    expect(after.player.shield).toBe(Math.max(0, shieldBefore - atk))
  })

  it('火球点燃：灼烧按层数×威力结算并逐回合衰减', () => {
    // 打上第 2 层（火球已解锁），找一个手上有 ≥4 骰的种子。
    for (let seed = 1; seed <= 80; seed += 1) {
      const engine = createDungeon(seed)
      const won = autoKill(engine)
      if (won.phase !== 'upgrade') continue
      engine.chooseUpgrade(0)
      const v = engine.view()
      const eligible = v.dice.find(d => d.value >= FIREBALL_NEED)
      if (eligible === undefined) continue
      const hp0 = v.enemy.hp
      expect(engine.assign(eligible.id, 'fireball')).toBe(true)
      expect(engine.view().enemy.burn).toBe(1)
      engine.endTurn()
      const after = engine.view()
      expect(hp0 - after.enemy.hp).toBe(v.player.fireballPower + 0)
      expect(after.enemy.burn).toBe(0)
      return
    }
    throw new Error('80 个种子内未出现火球可测局面')
  })

  it('吸血回复等值生命且不超过上限', () => {
    // 上到第 3 层（吸血已解锁），先挨打掉血再吸血。
    for (let seed = 1; seed <= 120; seed += 1) {
      const engine = createDungeon(seed)
      let v = autoKill(engine)
      if (v.phase !== 'upgrade') continue
      engine.chooseUpgrade(0)
      v = autoKill(engine)
      if (v.phase !== 'upgrade') continue
      engine.chooseUpgrade(0)
      v = engine.view()
      if (v.phase !== 'battle') continue
      // 只挨打不还手，直到受伤且手上有 ≥5 的骰。
      for (let i = 0; i < 12 && (v.player.hp >= v.player.maxHp || !v.dice.some(d => d.value >= LIFESTEAL_NEED)); i += 1) {
        engine.endTurn()
        v = engine.view()
        if (v.phase !== 'battle') break
      }
      if (v.phase !== 'battle') continue
      const die = v.dice.find(d => d.value >= LIFESTEAL_NEED && !d.used)
      if (die === undefined || v.player.hp >= v.player.maxHp) continue
      const hp0 = v.player.hp
      expect(engine.assign(die.id, 'lifesteal')).toBe(true)
      const healed = engine.view().player.hp - hp0
      expect(healed).toBe(Math.min(die.value + v.player.lifestealBonus, v.player.maxHp - hp0))
      return
    }
    throw new Error('120 个种子内未出现吸血可测局面')
  })

  it('敌人模式机：固定每回合、间隔轮空、蓄力隔回合重击', () => {
    // 第 1 层：固定攻击，连续两次 endTurn 都掉血/耗盾。
    const e1 = createDungeon(3)
    const hpA = e1.view().player.hp
    e1.endTurn()
    const hpB = e1.view().player.hp
    e1.endTurn()
    expect(hpA - hpB).toBe(e1.view().enemy.atk)
    // 上第 2 层：间隔型第一次行动出手、随后轮空一次。
    const e2 = createDungeon(11)
    if (autoKill(e2).phase !== 'upgrade') return // 种子不合适则跳过细节
    e2.chooseUpgrade(0)
    let v = e2.view()
    expect(v.enemy.pattern).toBe('interval')
    const hp0 = v.player.hp
    e2.endTurn()
    v = e2.view()
    const firstHit = hp0 - v.player.hp
    const hp1 = v.player.hp
    e2.endTurn()
    v = e2.view()
    const secondDelta = hp1 - v.player.hp
    expect(firstHit + secondDelta).toBe(v.enemy.atk)
    // 上第 3 层：蓄力型先蓄力（不掉血）再重击。
    const e3 = createDungeon(21)
    if (autoKill(e3).phase !== 'upgrade') return
    e3.chooseUpgrade(0)
    if (autoKill(e3).phase !== 'upgrade') return
    e3.chooseUpgrade(0)
    v = e3.view()
    if (v.enemy.pattern !== 'telegraph') return
    const hpC = v.player.hp
    e3.endTurn()
    expect(e3.view().enemy.charging).toBe(true)
    expect(e3.view().player.hp).toBe(hpC)
    e3.endTurn()
    expect(hpC - e3.view().player.hp).toBe(e3.view().enemy.atk)
  })

  it('三选一生成互异且达上限类别让位回血', () => {
    // 连续选骰子直到 4 颗上限：之后卡池不再出现「多一颗骰」。
    const engine = createDungeon(31)
    for (let i = 0; i < 3; i += 1) {
      const v = autoKill(engine)
      if (v.phase !== 'upgrade') break
      const kinds = (v.upgradeChoices ?? []).map(c => c.kind)
      expect(new Set(kinds).size).toBe(kinds.length)
      const dieIdx = kinds.indexOf('die')
      engine.chooseUpgrade(dieIdx >= 0 ? dieIdx : 0)
    }
    expect(engine.view().player.diceCount).toBeLessThanOrEqual(DICE_CAP)
    const v = autoKill(engine)
    if (v.phase === 'upgrade') {
      expect((v.upgradeChoices ?? []).some(c => c.kind === 'die')).toBe(engine.view().player.diceCount < DICE_CAP)
      expect(v.dice).toHaveLength(engine.view().player.diceCount)
    }
  })

  it('强化效果：骰数+1、威力+1、回血 10', () => {
    const engine = createDungeon(2)
    // 直接构造三张卡各自生效的断言：骰子。
    let v = autoKill(engine)
    expect(v.phase).toBe('upgrade')
    const dieIdx = (v.upgradeChoices ?? []).findIndex(c => c.kind === 'die')
    engine.chooseUpgrade(Math.max(0, dieIdx))
    expect(engine.view().player.diceCount).toBe(3)
    expect(engine.view().dice).toHaveLength(3)
    // 威力。
    v = autoKill(engine)
    expect(v.phase).toBe('upgrade')
    const powerIdx = (v.upgradeChoices ?? []).findIndex(c => c.kind === 'power')
    engine.chooseUpgrade(Math.max(0, powerIdx))
    expect(engine.view().player.fireballPower).toBe(3)
    expect(engine.view().player.lifestealBonus).toBe(1)
  })

  it('死亡与通关：阶段、分数、层数流转', () => {
    // 站桩挨打到死。
    const engine = createDungeon(77)
    for (let i = 0; i < 60 && engine.view().phase === 'battle'; i += 1) engine.endTurn()
    const dead = engine.view()
    expect(dead.phase).toBe('dead')
    expect(dead.player.hp).toBe(0)
    expect(engine.score()).toBe(dead.floor * 100 + 0)
    // 通关：用贪心机器人找一个能通塔的种子。
    let winSeed = -1
    for (let seed = 1; seed <= 300 && winSeed < 0; seed += 1) {
      const snaps = botRun(seed)
      if (snaps[snaps.length - 1]!.phase === 'victory') winSeed = seed
    }
    expect(winSeed).toBeGreaterThan(0)
    const snaps = botRun(winSeed)
    const last = snaps[snaps.length - 1]!
    expect(last.phase).toBe('victory')
    expect(last.floor).toBe(MAX_FLOOR)
    expect(engine.score()).toBeGreaterThan(0)
  })

  it('强化卡 desc 折行：固定字宽桩下最多两行且各不超宽', () => {
    // 桩字体：CJK 与全角标点 12px、ASCII 6px（保守近似 system-ui 12px）。
    const width = (s: string): number =>
      [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 12 : 6), 0)
    const descs = [
      '立刻回复 10 点生命',
      '每回合掷 3 颗骰子',
      '每回合掷 4 颗骰子',
      '灼烧 3/层，吸血 +1',
      '灼烧 4/层，吸血 +3',
      '护盾上限 +3，并立刻获得 3 点护盾',
    ]
    for (const desc of descs) {
      const lines = wrapTextByMeasure(desc, 154, width, 2)
      expect(lines.length).toBeLessThanOrEqual(2)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(width(line)).toBeLessThanOrEqual(154)
    }
    // 长文案必须真的折成两行（而不是被截断丢失内容）。
    const two = wrapTextByMeasure('护盾上限 +3，并立刻获得 3 点护盾', 154, width, 2)
    expect(two).toHaveLength(2)
    expect(two.join('')).toBe('护盾上限 +3，并立刻获得 3 点护盾')
    // maxLines=1 时截断加省略号且不超宽。
    const one = wrapTextByMeasure('护盾上限 +3，并立刻获得 3 点护盾', 154, width, 1)
    expect(one).toHaveLength(1)
    expect(one[0]!.endsWith('…')).toBe(true)
    expect(width(one[0]!)).toBeLessThanOrEqual(154)
    // 空文案至少返回一行空串。
    expect(wrapTextByMeasure('', 154, width, 2)).toEqual([''])
  })

  it('整塔重放：同种子同策略两次逐步视图完全一致', () => {
    const runA = botRun(42)
    const runB = botRun(42)
    expect(runA).toEqual(runB)
    expect(runA.length).toBeGreaterThan(10)
    // restart 后同种子也回到同一初局。
    const engine = createDungeon(42)
    engine.restart(42)
    expect(engine.view()).toEqual(createDungeon(42).view())
  })
})
