import { describe, expect, it } from 'vitest'
import {
  BOLT_SIZES, BOUNCE_X, COLOR_COUNT, DECOY_AFTER_MS, DECOY_P, HOLE_R, LEVEL_COUNT,
  LEVEL_TARGETS, MISMATCH_PENALTY, MISMATCH_TIME_MS, MISS_PENALTY, NUT_R, NUT_Y, BELT_LEFT,
  SCREW_MS, SPAWN_X, SUBSTEP_MS, TIME_LIMIT_MS, HELP_BTN, STATION_W, STATION_X0, boltAt,
  beltSpeed, createScrewSort, inHelpButton, injectNut, levelOf, mulberry32, nutAt,
  poissonInterval, quietSpawn, spawnMeanMs, stepScrewSort, attemptScrew,
  type ScrewSortEvent, type ScrewSortState,
} from '../src/client/games/screwsort/logic.ts'

const run = (s: ScrewSortState, frames: number, boost = false): void => {
  for (let i = 0; i < frames; i += 1) stepScrewSort(s, 16, boost)
}

/** 推进直到条件满足，跨帧收集事件（events 每帧开头被清空）。 */
const runUntil = (s: ScrewSortState, done: () => boolean, frames = 400): ScrewSortEvent[] => {
  const seen: ScrewSortEvent[] = []
  for (let i = 0; i < frames && !done(); i += 1) {
    stepScrewSort(s, 16)
    seen.push(...s.events)
  }
  return seen
}

/** 注入一颗颜色 c 的合法真件（内径即该工位绑定值）并选中。 */
const armReal = (s: ScrewSortState, c: 0 | 1 | 2 | 3, x = 300): void => {
  const id = injectNut(s, c, BOLT_SIZES[c]!, x)
  s.selected = id
}

const trace = (s: ScrewSortState): string => {
  const marks: number[] = [s.t, s.score, s.missed, s.combo, s.nuts.length, s.selected ?? -1, s.level, s.levelProgress]
  for (const bolt of s.bolts) marks.push(bolt.count, bolt.busyUntil, bolt.flashUntil)
  for (const nut of s.nuts) marks.push(nut.id, nut.color, nut.size, nut.decoy ? 1 : 0, Math.round(nut.x * 100))
  return JSON.stringify(marks)
}

describe('screwsort logic', () => {
  it('tables: speed/spawn ramp with caps, level targets grow, dual-attribute layout is unambiguous', () => {
    expect(beltSpeed(1)).toBe(70)
    expect(beltSpeed(4)).toBe(130)
    expect(beltSpeed(20)).toBe(240)
    expect(spawnMeanMs(1)).toBe(1800)
    expect(spawnMeanMs(5)).toBe(760)
    expect(spawnMeanMs(20)).toBe(520)
    expect(levelOf('continuous', 0, 1)).toBe(1)
    expect(levelOf('continuous', 24_000, 1)).toBe(3)
    expect(levelOf('levels', 0, 4)).toBe(4)
    expect(LEVEL_TARGETS.length).toBe(LEVEL_COUNT)
    for (let i = 1; i < LEVEL_TARGETS.length; i += 1) {
      expect(LEVEL_TARGETS[i]!).toBeGreaterThan(LEVEL_TARGETS[i - 1]!)
    }
    expect(BOLT_SIZES.length).toBe(COLOR_COUNT)
    // 双约束布局：颜色与粗细都不足以单独定位——每色仅一档粗细，且近邻
    // 色对（0^1、2^3）粗细互异（迷惑件因此永不匹配任何工位）。
    const sizeSeen = new Set<number>(BOLT_SIZES)
    expect(sizeSeen.size).toBe(2)
    for (let i = 0; i < COLOR_COUNT; i += 1) {
      expect(BOLT_SIZES[i ^ 1]!).not.toBe(BOLT_SIZES[i]!)
    }
    expect(SUBSTEP_MS).toBeGreaterThan(0)
    expect(HOLE_R.length).toBe(2)
    expect(HOLE_R[0]!).toBeLessThan(HOLE_R[1]!)
    expect(SPAWN_X).toBeGreaterThan(548)
    expect(DECOY_P).toBeGreaterThan(0)
    expect(SCREW_MS).toBe(800)
  })

  it('nut stream is seeded: real nuts fit their color bolt, decoys appear only late and match nothing', () => {
    const s = createScrewSort(9, 1, 'continuous')
    const seenIds = new Set<number>()
    const attrs: { color: number, size: number, decoy: boolean }[] = []
    let decoyBefore = 0
    for (let i = 0; i < 4000; i += 1) {
      stepScrewSort(s, 16)
      for (const n of s.nuts) {
        if (seenIds.has(n.id)) continue
        seenIds.add(n.id)
        attrs.push({ color: n.color, size: n.size, decoy: n.decoy })
        if (n.decoy && s.t < DECOY_AFTER_MS) decoyBefore += 1
      }
    }
    expect(s.over).toBe(true) // 60 秒限时自然结束
    expect(attrs.length).toBeGreaterThan(20)
    expect(decoyBefore).toBe(0)
    const colors = new Set<number>()
    const sizes = new Set<number>()
    let decoys = 0
    for (const n of attrs) {
      colors.add(n.color)
      sizes.add(n.size)
      if (n.decoy) {
        decoys += 1
        // 迷惑件：近邻色 + 被模仿工位的粗细 → 与所有工位都不匹配。
        expect(BOLT_SIZES[n.color]!).not.toBe(n.size)
      } else {
        expect(BOLT_SIZES[n.color]!).toBe(n.size)
      }
    }
    expect(colors.size).toBe(4)
    expect(sizes.size).toBe(2)
    expect(decoys).toBeGreaterThan(0)
  })

  it('attemptScrew enforces the dual constraint: both attributes must match', () => {
    const s = createScrewSort(4, 1, 'continuous')
    quietSpawn(s)
    // 无选中 → none。
    expect(attemptScrew(s, 0)).toBe('none')
    // 颜色对、内径错 → mismatch。
    let id = injectNut(s, 0, 1, 300)
    s.selected = id
    expect(attemptScrew(s, 0)).toBe('mismatch')
    expect(s.score).toBe(0) // 分数下限 0
    // 颜色错、内径对（近邻色 1 与工位 0 同为细牙）→ mismatch。
    id = injectNut(s, 1, BOLT_SIZES[0]!, 300)
    s.selected = id
    expect(attemptScrew(s, 0)).toBe('mismatch')
    // 迷惑件（近邻色 + 模仿粗细）→ 到任何工位都 mismatch。
    id = injectNut(s, 1, BOLT_SIZES[0]!, 300, true)
    s.selected = id
    expect(attemptScrew(s, 0)).toBe('mismatch')
    expect(attemptScrew(s, 1)).toBe('mismatch')
    // 双匹配 → ok。
    armReal(s, 2)
    expect(attemptScrew(s, 2)).toBe('ok')
    expect(s.score).toBe(2)
    expect(s.bolts[2]!.count).toBe(1)
    expect(s.bolts[2]!.busyUntil).toBe(s.t + SCREW_MS)
    expect(s.nuts.length).toBe(3) // 三颗错配件仍在带上（弹回不消失）
    expect(s.selected).toBeNull()
  })

  it('bolt occupancy: busy bolt rejects attempts without penalty; frees after 800ms', () => {
    const s = createScrewSort(11, 1, 'continuous')
    quietSpawn(s)
    armReal(s, 1)
    expect(attemptScrew(s, 1)).toBe('ok')
    const score = s.score
    // 占用期内投放第二颗匹配件 → busy，不结算、螺母保留。
    armReal(s, 1, 260)
    run(s, 5) // 推进 80ms，仍占用
    expect(s.bolts[1]!.busyUntil).toBeGreaterThan(s.t)
    expect(attemptScrew(s, 1)).toBe('busy')
    expect(s.score).toBe(score)
    expect(s.nuts.some((n) => n.color === 1)).toBe(true)
    // 占用结束后可再次投放。
    runUntil(s, () => s.bolts[1]!.busyUntil <= s.t)
    expect(attemptScrew(s, 1)).toBe('ok')
    expect(s.bolts[1]!.count).toBe(2)
  })

  it('mismatch bounces right, scores down (floor 0), resets combo, and costs time in continuous', () => {
    const s = createScrewSort(12, 1, 'continuous')
    quietSpawn(s)
    s.score = 5
    s.combo = 3
    s.comboExpire = s.t + 9999
    const x0 = 300
    const real = injectNut(s, 3, BOLT_SIZES[3]!, x0) // 工位 3 的合法件，留作对照
    const wrong = injectNut(s, 0, BOLT_SIZES[3]!, x0) // 同径异色 → 错配
    s.selected = wrong
    const timeBefore = s.timeLeft
    expect(attemptScrew(s, 3)).toBe('mismatch')
    expect(s.score).toBe(5 - MISMATCH_PENALTY)
    expect(s.combo).toBe(0)
    expect(s.timeLeft).toBe(timeBefore - MISMATCH_TIME_MS)
    const bounced = s.nuts.find((n) => n.id === wrong)!
    expect(bounced.x).toBe(x0 + BOUNCE_X)
    expect(s.bolts[3]!.flashUntil).toBeGreaterThan(s.t)
    expect(s.nuts.some((n) => n.id === real)).toBe(true)
    // 关卡模式不扣时（无 timeLeft 可扣）。
    const lv = createScrewSort(12, 1, 'levels')
    quietSpawn(lv)
    lv.score = 5
    const w2 = injectNut(lv, 0, BOLT_SIZES[3]!, 300)
    lv.selected = w2
    expect(attemptScrew(lv, 3)).toBe('mismatch')
    expect(lv.timeLeft).toBe(0)
    expect(lv.score).toBe(5 - MISMATCH_PENALTY)
  })

  it('left edge: real nut falls off = miss penalty; decoy passes silently', () => {
    const s = createScrewSort(13, 1, 'continuous')
    quietSpawn(s)
    s.score = 6
    s.combo = 2
    s.comboExpire = s.t + 9999
    injectNut(s, 2, BOLT_SIZES[2]!, BELT_LEFT - 2) // 真件：滑出左端
    const seen = runUntil(s, () => s.missed === 1, 30)
    expect(s.missed).toBe(1)
    expect(s.score).toBe(6 - MISS_PENALTY)
    expect(s.combo).toBe(0)
    expect(seen.some((e) => e.type === 'missed' && e.color === 2)).toBe(true)
    // 迷惑件滑出：不计漏检、不扣分。
    const scoreAfter = s.score
    const missedAfter = s.missed
    injectNut(s, 1, BOLT_SIZES[0]!, BELT_LEFT - 2, true)
    const seen2 = runUntil(s, () => s.events.some((e) => e.type === 'decoyPass') || s.nuts.length === 0, 30)
    expect(s.missed).toBe(missedAfter)
    expect(s.score).toBe(scoreAfter)
    expect(seen2.some((e) => e.type === 'decoyPass')).toBe(true)
    expect(seen2.some((e) => e.type === 'missed')).toBe(false)
  })

  it('combo scoring: consecutive screws inside the window pay base plus bonus', () => {
    const s = createScrewSort(14, 1, 'continuous')
    quietSpawn(s)
    const screwOne = (c: 0 | 1 | 2 | 3): void => {
      armReal(s, c)
      expect(attemptScrew(s, c)).toBe('ok')
    }
    screwOne(0)
    expect(s.score).toBe(2)
    screwOne(1)
    expect(s.combo).toBe(2)
    expect(s.score).toBe(2 + 2 + 1)
    screwOne(2)
    expect(s.score).toBe(2 + 2 + 1 + 2 + 2)
    // 连击窗口过期后再拧：combo 归 1，无加成。
    s.comboExpire = 0
    screwOne(3)
    expect(s.combo).toBe(1)
    expect(s.score).toBe(9 + 2)
  })

  it('continuous mode ends at the time limit and freezes afterwards', () => {
    const s = createScrewSort(15, 1, 'continuous')
    quietSpawn(s)
    expect(s.timeLeft).toBe(TIME_LIMIT_MS)
    s.timeLeft = 30
    run(s, 4)
    expect(s.over).toBe(true)
    expect(s.timeLeft).toBe(0)
    expect(s.win).toBe(false)
    const t = s.t
    const score = s.score
    armReal(s, 0)
    expect(attemptScrew(s, 0)).toBe('none')
    run(s, 10)
    expect(s.t).toBe(t)
    expect(s.score).toBe(score)
    expect(s.nuts.length).toBe(1)
  })

  it('level mode: reaching the target clears the belt and advances; finishing level 5 wins', () => {
    const s = createScrewSort(16, 1, 'levels')
    quietSpawn(s)
    s.level = 2
    s.levelProgress = LEVEL_TARGETS[1]! - 1
    armReal(s, 1)
    expect(attemptScrew(s, 1)).toBe('ok')
    const seen = runUntil(s, () => s.level === 3, 20)
    expect(s.level).toBe(3)
    expect(s.levelProgress).toBe(0)
    expect(s.nuts.length).toBe(0)
    expect(seen.some((e) => e.type === 'level' && e.level === 3)).toBe(true)
    // 第 5 关拧满 → 通关。
    s.level = LEVEL_COUNT
    s.levelProgress = LEVEL_TARGETS[LEVEL_COUNT - 1]! - 1
    armReal(s, 0)
    expect(attemptScrew(s, 0)).toBe('ok')
    runUntil(s, () => s.over, 20)
    expect(s.over).toBe(true)
    expect(s.win).toBe(true)
  })

  it('fixed substepping: the same total time in different frame slices yields the identical trace', () => {
    const seedTrace = (slices: number[]): string => {
      const s = createScrewSort(55, 2, 'continuous')
      for (const dt of slices) stepScrewSort(s, dt)
      return trace(s)
    }
    const even: number[] = []
    for (let i = 0; i < 80; i += 1) even.push(10)
    const burst: number[] = []
    let burstTotal = 0
    for (const dt of [70, 5, 25, 100, 40, 20, 80, 15, 55, 90, 30, 50, 60, 10, 45, 65, 35, 75, 25, 55]) {
      if (burstTotal + dt > 800) { burst.push(800 - burstTotal); burstTotal = 800; break }
      burst.push(dt)
      burstTotal += dt
    }
    if (burstTotal < 800) { burst.push(800 - burstTotal); burstTotal = 800 }
    expect(burstTotal).toBe(800)
    expect(seedTrace(even)).toBe(seedTrace(even))
    expect(seedTrace(even)).toBe(seedTrace(burst))
  })

  it('seed replay: same seed + script identical, different round diverges; poisson is bounded', () => {
    const script = (seed: number, round: number): string => {
      const s = createScrewSort(seed, round, 'continuous')
      for (let i = 0; i < 1200; i += 1) {
        if (i % 40 === 7) armReal(s, (Math.floor(i / 40) % 4) as 0 | 1 | 2 | 3, 200 + (i % 5) * 40)
        if (i % 40 === 9 && s.selected !== null) attemptScrew(s, Math.floor(i / 40) % 4)
        stepScrewSort(s, 16)
      }
      return trace(s)
    }
    expect(script(888, 1)).toBe(script(888, 1))
    expect(script(888, 1)).not.toBe(script(888, 2))
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs: number[] = []
    for (let i = 0; i < 200; i += 1) xs.push(poissonInterval(a, 1000))
    for (let i = 0; i < 200; i += 1) expect(poissonInterval(b, 1000)).toBe(xs[i])
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(350)
      expect(x).toBeLessThanOrEqual(2200)
    }
  })

  it('hit tests: nutAt / boltAt / inHelpButton match the geometry; stale selection self-clears', () => {
    const s = createScrewSort(17, 1, 'continuous')
    quietSpawn(s)
    const id = injectNut(s, 0, BOLT_SIZES[0]!, 300)
    expect(nutAt(s, 300, NUT_Y)).toBe(id)
    expect(nutAt(s, 300 + NUT_R, NUT_Y + 4)).toBe(id) // 容差 6px
    expect(nutAt(s, 300 + NUT_R + 12, NUT_Y)).toBeNull()
    expect(nutAt(s, 300, NUT_Y + NUT_R + 20)).toBeNull()
    for (let i = 0; i < COLOR_COUNT; i += 1) {
      const x0 = STATION_X0 + i * (STATION_W + 14)
      expect(boltAt(x0 + STATION_W / 2, 300)).toBe(i)
      expect(boltAt(x0 - 2, 300)).toBeNull()
    }
    expect(boltAt(280, 40)).toBeNull() // 上方传送带区域不属于任何工位
    expect(inHelpButton(HELP_BTN.x + 5, HELP_BTN.y + 5)).toBe(true)
    expect(inHelpButton(HELP_BTN.x - 5, HELP_BTN.y + 5)).toBe(false)
    expect(inHelpButton(HELP_BTN.x + HELP_BTN.w - 1, HELP_BTN.y + HELP_BTN.h - 1)).toBe(true)
    expect(inHelpButton(HELP_BTN.x + HELP_BTN.w + 1, HELP_BTN.y)).toBe(false)
    // 选中由外部赋值（index 层职责），逻辑层据此投放。
    s.selected = id
    expect(attemptScrew(s, 0)).toBe('ok')
    // 选中指向已不存在的螺母 → 自动清空返回 none。
    s.selected = 9999
    expect(attemptScrew(s, 1)).toBe('none')
    expect(s.selected).toBeNull()
  })
})
