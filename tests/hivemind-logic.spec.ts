import { describe, expect, it } from 'vitest'
import {
  BEE_COUNT, FIELD, LEVELS, LEVEL_COUNT, advanceLevel, alignmentScore,
  createHiveMindState, coverageCount, levelSeed, meanNearestSpacing, minSpacing,
  mulberry32, objectiveMet, objectiveProgress, restartLevel, setParam,
  stepHiveMind, swarmCentroid,
  type HiveMindState,
} from '../src/client/games/hivemind/logic.ts'

/** 蜂群到质心的平均距离（聚拢程度，越小越抱团）。 */
function avgSpread(state: HiveMindState): number {
  const c = swarmCentroid(state.bees)
  let s = 0
  for (const b of state.bees) s += Math.hypot(b.x - c.x, b.y - c.y)
  return s / state.bees.length
}

/** 连续步进 ms 毫秒（每次 500ms，避开单次子步上限压力）。 */
function runMs(state: HiveMindState, ms: number): void {
  let left = ms
  while (left > 0) {
    const chunk = Math.min(500, left)
    stepHiveMind(state, chunk)
    left -= chunk
  }
}

/** 快照蜂群（判定重放确定性）。 */
function snapshot(state: HiveMindState): number[] {
  const out: number[] = []
  for (const b of state.bees) out.push(b.x, b.y, b.heading)
  return out
}

describe('hivemind logic', () => {
  it('mulberry32 确定且 levelSeed 随 seed/关卡变化', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 8; i += 1) expect(a()).toBe(b())
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
    expect(levelSeed(42, 0)).not.toBe(levelSeed(42, 1))
    expect(levelSeed(7, 0)).not.toBe(levelSeed(8, 0))
  })

  it('初始 200 蜂全部落在场地内，seed 决定布置', () => {
    const s1 = createHiveMindState(42)
    const s2 = createHiveMindState(42)
    const s3 = createHiveMindState(7)
    expect(s1.bees.length).toBe(BEE_COUNT)
    for (const b of s1.bees) {
      expect(b.x).toBeGreaterThanOrEqual(FIELD.x)
      expect(b.x).toBeLessThanOrEqual(FIELD.x + FIELD.w)
      expect(b.y).toBeGreaterThanOrEqual(FIELD.y)
      expect(b.y).toBeLessThanOrEqual(FIELD.y + FIELD.h)
      expect(b.heading).toBeGreaterThanOrEqual(0)
      expect(b.heading).toBeLessThan(Math.PI * 2)
    }
    expect(snapshot(s1)).toEqual(snapshot(s2))
    expect(snapshot(s1)).not.toEqual(snapshot(s3))
  })

  it('聚合主导使蜂群抱团：散布显著小于无聚合对照', () => {
    const s = createHiveMindState(42)
    setParam(s, 'coh', 2)
    setParam(s, 'ali', 1)
    setParam(s, 'sep', 1)
    runMs(s, 4000)
    const control = createHiveMindState(42)
    setParam(control, 'coh', 0)
    setParam(control, 'ali', 1)
    setParam(control, 'sep', 1)
    runMs(control, 4000)
    const spread = avgSpread(s)
    expect(spread).toBeLessThan(avgSpread(control))
    expect(spread).toBeLessThan(avgSpread(createHiveMindState(42)))
  })

  it('分离主导撑开间距：平均最近邻间距远大于无分离对照', () => {
    const withSep = createHiveMindState(42)
    setParam(withSep, 'sep', 2)
    setParam(withSep, 'coh', 1)
    setParam(withSep, 'ali', 0)
    runMs(withSep, 5000)
    const noSep = createHiveMindState(42)
    setParam(noSep, 'sep', 0)
    setParam(noSep, 'coh', 1)
    setParam(noSep, 'ali', 0)
    runMs(noSep, 5000)
    const spaced = meanNearestSpacing(withSep.bees)
    expect(spaced).toBeGreaterThan(meanNearestSpacing(noSep.bees))
    // 第 2 关（平均间距 15）用强分离可达，验证关卡可行性。
    expect(spaced).toBeGreaterThanOrEqual(15)
    // minSpacing 纯函数：等距网格上取网格间距。
    const grid: { x: number, y: number, heading: number, speed: number, inObstacle: boolean }[] = []
    for (let gx = 0; gx < 20; gx += 1) {
      for (let gy = 0; gy < 10; gy += 1) grid.push({ x: gx * 20, y: gy * 20, heading: 0, speed: 1, inObstacle: false })
    }
    expect(minSpacing(grid)).toBeCloseTo(20, 6)
  })

  it('对齐主导产生洄游：对齐度上升且第 4 关指标可达', () => {
    const s = createHiveMindState(42)
    setParam(s, 'ali', 2)
    setParam(s, 'coh', 0.6)
    setParam(s, 'sep', 0.6)
    runMs(s, 6000)
    const aligned = alignmentScore(s.bees)
    const control = createHiveMindState(42)
    setParam(control, 'ali', 0)
    setParam(control, 'coh', 0.6)
    setParam(control, 'sep', 0.6)
    runMs(control, 6000)
    expect(aligned).toBeGreaterThan(alignmentScore(control.bees))
    // 第 4 关阈值 0.88 需要真实可达（洄游队形）。
    expect(aligned).toBeGreaterThanOrEqual(0.88)
  })

  it('边界反弹：蜂永不越出场地边界', () => {
    const s = createHiveMindState(42)
    // 全员推向右缘朝右飞。
    for (const b of s.bees) {
      b.x = FIELD.x + FIELD.w - 11
      b.heading = 0
    }
    stepHiveMind(s, 200)
    for (const b of s.bees) {
      expect(b.x).toBeLessThanOrEqual(FIELD.x + FIELD.w - 10 + 1e-6)
      expect(Math.cos(b.heading)).toBeLessThan(0)
    }
  })

  it('障碍计次：进入红区记一次命中，停留不重复计', () => {
    const s = createHiveMindState(42)
    s.level = 1 // 第 2 关带 3 个障碍
    restartLevel(s)
    const o = LEVELS[1]!.obstacles[0]!
    for (const b of s.bees) {
      b.x = o.x
      b.y = o.y
      b.inObstacle = false
    }
    stepHiveMind(s, 100)
    expect(s.obstacleHits).toBeGreaterThan(0)
    const hits = s.obstacleHits
    // 继续停留在障碍内不再累计。
    for (const b of s.bees) {
      b.x = o.x
      b.y = o.y
    }
    stepHiveMind(s, 100)
    expect(s.obstacleHits).toBe(hits)
  })

  it('质心/覆盖/对齐指标纯函数计算正确', () => {
    const s = createHiveMindState(42)
    // 手工布置验证质心与覆盖。
    for (let i = 0; i < s.bees.length; i += 1) {
      s.bees[i]!.x = i % 2 === 0 ? 100 : 300
      s.bees[i]!.y = 254
    }
    const c = swarmCentroid(s.bees)
    expect(c.x).toBe(200)
    expect(c.y).toBe(254)
    expect(coverageCount(s.bees, 100, 254, 50)).toBe(100)
    expect(coverageCount(s.bees, 400, 254, 50)).toBe(0)
    // 完全同向 → 对齐度 1；两半反向 → 接近 0。
    for (const b of s.bees) b.heading = 0.3
    expect(alignmentScore(s.bees)).toBeCloseTo(1, 5)
    for (let i = 0; i < s.bees.length; i += 1) {
      s.bees[i]!.heading = i % 2 === 0 ? 0 : Math.PI
    }
    expect(alignmentScore(s.bees)).toBeCloseTo(0, 5)
  })

  it('目标需持续保持：进度累积、失守清零、走满过关并计分', () => {
    const s = createHiveMindState(42)
    const t = LEVELS[0]!.target
    expect(t.kind).toBe('centroid')
    // 蜂群整体搬进目标圆（质心即达）。
    for (let i = 0; i < s.bees.length; i += 1) {
      s.bees[i]!.x = 360 + (i % 20) * 0.5
      s.bees[i]!.y = 254 + Math.floor(i / 20) * 0.5
    }
    runMs(s, 800)
    expect(s.status).toBe('playing')
    expect(objectiveProgress(s)).toBeGreaterThan(0)
    expect(objectiveMet(s)).toBe(true)
    // 失守：搬走后 hold 清零。
    for (const b of s.bees) b.x = 60
    stepHiveMind(s, 200)
    expect(s.holdMs).toBe(0)
    expect(objectiveProgress(s)).toBe(0)
    // 回到目标区持续到 hold 走满 → 过关计分。
    for (let i = 0; i < s.bees.length; i += 1) {
      s.bees[i]!.x = 360 + (i % 20) * 0.5
      s.bees[i]!.y = 254 + Math.floor(i / 20) * 0.5
    }
    runMs(s, 2000)
    expect(s.status).toBe('won')
    expect(s.score).toBeGreaterThan(0)
    // 命中障碍会扣分：同流程但先撞一次红区分数更低。
    const dirty = createHiveMindState(42)
    dirty.obstacleHits = 3
    for (let i = 0; i < dirty.bees.length; i += 1) {
      dirty.bees[i]!.x = 360 + (i % 20) * 0.5
      dirty.bees[i]!.y = 254 + Math.floor(i / 20) * 0.5
    }
    runMs(dirty, 2000)
    expect(dirty.score).toBe(s.score - 15)
  })

  it('超时进入 timeout，R 重开恢复进行且分数保留', () => {
    const s = createHiveMindState(42)
    s.level = 3 // 第 4 关：对齐度指标
    restartLevel(s)
    setParam(s, 'ali', 0) // 无对齐权重 → 指标无法满足，注定超时
    const limit = LEVELS[3]!.timeLimitMs
    s.elapsedMs = limit - 1000 // 快进到只剩 1s，避免整局模拟拖慢测试
    runMs(s, 2000)
    expect(s.status).toBe('timeout')
    const scoreAfterTimeout = s.score
    restartLevel(s)
    expect(s.status).toBe('playing')
    expect(s.elapsedMs).toBe(0)
    expect(s.score).toBe(scoreAfterTimeout)
  })

  it('advanceLevel 逐关推进并重置关卡状态，末关过关全通关', () => {
    const s = createHiveMindState(42)
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      expect(s.status).toBe('playing')
      expect(s.level).toBe(lv)
      expect(s.bees.length).toBe(BEE_COUNT)
      expect(s.elapsedMs).toBe(0)
      // 过关结算（winLevel 计分）在「持续保持」测试中覆盖；这里直接
      // 置过关态，只测 advanceLevel 的流转契约。
      s.status = 'won'
      advanceLevel(s)
    }
    expect(s.status).toBe('complete')
    // 全通关后再 advanceLevel 保持 complete（不再越界）。
    advanceLevel(s)
    expect(s.status).toBe('complete')
    expect(s.level).toBe(LEVEL_COUNT - 1)
  })

  it('seed 重放确定性：同 seed 同步进序列得到完全相同的蜂群', () => {
    const a = createHiveMindState(99)
    const b = createHiveMindState(99)
    setParam(a, 'sep', 1.5)
    setParam(a, 'ali', 0.5)
    setParam(b, 'sep', 1.5)
    setParam(b, 'ali', 0.5)
    runMs(a, 2000)
    runMs(b, 2000)
    expect(snapshot(b)).toEqual(snapshot(a))
    // setParam 钳制到 0-2。
    setParam(a, 'coh', 9)
    expect(a.params.coh).toBe(2)
    setParam(a, 'coh', -3)
    expect(a.params.coh).toBe(0)
  })
})
