import { describe, expect, it } from 'vitest'
import {
  FLIP_BONUS, GRAVITY, JELLY_PENALTY, ROUNDS, WATER_Y,
  airFlip, comboMultiplier, computeEntryScore, createDolphinDiveState,
  mulberry32, releaseJump, startCharge, stepDolphinDive, adjustAngle,
} from '../src/client/games/dolphindive/logic.ts'

const DT = 1 / 60

/** 完成一跳：蓄满力后起跳，推进到入水结算完成（settle 结束）。 */
function playOneJump(state: ReturnType<typeof createDolphinDiveState>, angle: number): void {
  state.wind = 0
  state.jellyfish = []
  state.angleDeg = angle
  startCharge(state)
  for (let i = 0; i < 120; i += 1) stepDolphinDive(state, DT) // 蓄满 1.1s
  releaseJump(state)
  for (let i = 0; i < 600 && state.phase === 'air'; i += 1) stepDolphinDive(state, DT)
  for (let i = 0; i < 80 && state.phase === 'settle'; i += 1) stepDolphinDive(state, DT)
}

describe('dolphindive logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(11)
    const b = mulberry32(11)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(mulberry32(3)()).not.toBe(mulberry32(4)())
  })

  it('creates round 1 with bounded wind and three jellyfish in the air region', () => {
    const state = createDolphinDiveState(7)
    expect(state.round).toBe(1)
    expect(state.phase).toBe('swim')
    expect(state.score).toBe(0)
    expect(state.wind).toBeGreaterThanOrEqual(-70)
    expect(state.wind).toBeLessThanOrEqual(70)
    expect(state.jellyfish).toHaveLength(3)
    for (const j of state.jellyfish) {
      expect(j.x).toBeGreaterThanOrEqual(220)
      expect(j.x).toBeLessThanOrEqual(450)
      expect(j.y).toBeGreaterThanOrEqual(60)
      expect(j.y).toBeLessThanOrEqual(190)
      expect(j.hit).toBe(false)
    }
  })

  it('charging builds power to the 1.0 cap and angle clamps to 20..85', () => {
    const state = createDolphinDiveState(7)
    startCharge(state)
    for (let i = 0; i < 240; i += 1) stepDolphinDive(state, DT)
    expect(state.power).toBe(1)
    for (let i = 0; i < 30; i += 1) {
      adjustAngle(state, 1)
      adjustAngle(state, -1)
    }
    adjustAngle(state, 20)
    expect(state.angleDeg).toBe(85)
    adjustAngle(state, -30)
    expect(state.angleDeg).toBe(20)
  })

  it('release launches a parabola: constant vx, gravity on vy, returns to water', () => {
    const state = createDolphinDiveState(7)
    state.wind = 0
    state.jellyfish = []
    state.angleDeg = 60
    startCharge(state)
    for (let i = 0; i < 120; i += 1) stepDolphinDive(state, DT)
    releaseJump(state)
    expect(state.phase).toBe('air')
    expect(state.vy).toBeLessThan(0)
    const vx0 = state.vx
    const vy0 = state.vy
    stepDolphinDive(state, DT)
    // 风为零：水平速度不变；垂直速度按重力积分。
    expect(state.vx).toBeCloseTo(vx0, 6)
    expect(state.vy).toBeCloseTo(vy0 + GRAVITY * DT, 6)
    let steps = 0
    while (state.phase === 'air' && steps < 600) {
      stepDolphinDive(state, DT)
      steps += 1
    }
    expect(state.phase).toBe('settle')
    expect(state.y).toBe(WATER_Y)
  })

  it('steeper entry scores more on the entry curve', () => {
    expect(computeEntryScore(1)).toBe(100)
    expect(computeEntryScore(0.95)).toBeGreaterThan(computeEntryScore(0.5))
    expect(computeEntryScore(0.5)).toBeGreaterThan(computeEntryScore(0.2))
    expect(computeEntryScore(0)).toBe(0)
    expect(computeEntryScore(2)).toBe(100) // 钳制
  })

  it('wind shifts the splashdown point horizontally', () => {
    const run = (wind: number): number => {
      const state = createDolphinDiveState(7)
      state.wind = wind
      state.jellyfish = []
      state.angleDeg = 45
      startCharge(state)
      for (let i = 0; i < 120; i += 1) stepDolphinDive(state, DT)
      releaseJump(state)
      let steps = 0
      while (state.phase === 'air' && steps < 600) {
        stepDolphinDive(state, DT)
        steps += 1
      }
      return state.x
    }
    const withTail = run(80)
    const withHead = run(-80)
    expect(withTail).toBeGreaterThan(withHead)
  })

  it('flips accumulate rotation and grant bonus when completed before entry', () => {
    const state = createDolphinDiveState(7)
    state.wind = 0
    state.jellyfish = []
    state.angleDeg = 70
    startCharge(state)
    for (let i = 0; i < 120; i += 1) stepDolphinDive(state, DT)
    releaseJump(state)
    airFlip(state)
    airFlip(state)
    expect(state.flipsTarget).toBe(2)
    let steps = 0
    while (state.phase === 'air' && steps < 600) {
      stepDolphinDive(state, DT)
      steps += 1
    }
    // 两圈都转完了（rotation 追平目标），结算没有翻滚折扣。
    expect(state.rotation).toBeGreaterThanOrEqual(2 * Math.PI * 2 - 0.001)
    expect(state.entrySloppy).toBe(false)
    // 对照：同样跳跃不翻滚，得分应少两圈加分的量。
    const plain = createDolphinDiveState(7)
    playOneJump(plain, 70)
    expect(state.lastRoundPoints).toBeGreaterThanOrEqual(plain.lastRoundPoints + 2 * FLIP_BONUS - 1)
  })

  it('an unfinished flip at entry is penalized', () => {
    const state = createDolphinDiveState(7)
    state.wind = 0
    state.jellyfish = []
    state.angleDeg = 70
    startCharge(state)
    for (let i = 0; i < 120; i += 1) stepDolphinDive(state, DT)
    releaseJump(state)
    // 快入水时才按翻滚：来不及完成 → 歪着入水。
    let steps = 0
    while (state.phase === 'air' && steps < 540) {
      stepDolphinDive(state, DT)
      steps += 1
      if (steps === 70) airFlip(state)
    }
    expect(state.entrySloppy).toBe(true)
    expect(state.lastEntryLabel).toBe('翻滚未完成…')
  })

  it('jellyfish contact deducts points, breaks combo and slows the dolphin', () => {
    const state = createDolphinDiveState(7)
    state.combo = 2
    state.score = 100
    state.wind = 0
    state.jellyfish = [{ x: 200, y: 150, r: 16, vx: 0, hit: false }]
    state.angleDeg = 60
    startCharge(state)
    for (let i = 0; i < 120; i += 1) stepDolphinDive(state, DT)
    releaseJump(state)
    const vxBefore = state.vx
    let steps = 0
    let hitSeen = false
    let scoreAtHit = -1
    while (state.phase === 'air' && steps < 600) {
      stepDolphinDive(state, DT)
      steps += 1
      if (state.jellyfish[0]!.hit) {
        if (!hitSeen) scoreAtHit = state.score
        hitSeen = true
      }
    }
    expect(hitSeen).toBe(true)
    expect(scoreAtHit).toBe(100 - JELLY_PENALTY)
    expect(state.combo).toBe(0)
    expect(state.vx).toBeLessThan(vxBefore)
  })

  it('consecutive perfect entries multiply, a flat splash resets the combo', () => {
    const state = createDolphinDiveState(7)
    playOneJump(state, 85) // 近垂直入水：完美
    expect(state.combo).toBe(1)
    const first = state.lastRoundPoints
    playOneJump(state, 85)
    expect(state.combo).toBe(2)
    expect(comboMultiplier(2)).toBe(2)
    // 第二跳基础相同，倍率 1.5 → 分数更高。
    expect(state.lastRoundPoints).toBeGreaterThan(Math.round(first * 1.4))
    // 拍水面（低角度）：连击清零。
    playOneJump(state, 20)
    expect(state.combo).toBe(0)
    expect(state.entrySteepness).toBeLessThan(0.5)
  })

  it('five rounds end the game, and the same seed replays identically', () => {
    const script = (seed: number): number => {
      const state = createDolphinDiveState(seed)
      const angles = [85, 60, 45, 30, 85]
      for (const a of angles) playOneJump(state, a)
      expect(state.phase).toBe('over')
      return state.score
    }
    const score = script(42)
    expect(script(42)).toBe(score)
    expect(score).toBeGreaterThan(0)
    const other = createDolphinDiveState(ROUNDS)
    expect(other.round).toBe(1)
  })
})
