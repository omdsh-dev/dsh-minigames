import { describe, expect, it } from 'vitest'
import {
  CLEAR_MIN, CLEAR_MS, LEVEL_CARD_COUNTS, LEVEL_COUNT, LEVEL_TIME_LIMITS, PREDICATES,
  allowedMasks, circlesFor, clearScore, createVennGameState, generateLevel, maskAtPoint,
  maskOf, mulberry32, placeCard, predicateById, regionReachable, tick,
} from '../src/client/games/vennpuzzle/logic.ts'

/** 放完当前关全部卡（每张都放到其满足掩码锚定区）。 */
function solveCurrentLevel(state: ReturnType<typeof createVennGameState>): void {
  for (const num of [...state.pool]) {
    expect(placeCard(state, num, maskOf(num, state.predicates))).toBe('ok')
  }
}

describe('vennpuzzle logic', () => {
  it('mulberry32: 同种子序列一致、值域 [0,1)、不同种子不同', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const c = mulberry32(54321)
    expect(seqA).not.toEqual(Array.from({ length: 20 }, () => c()))
  })

  it('谓词库：12 条互异谓词，抽样求值正确', () => {
    expect(PREDICATES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(PREDICATES.map((p) => p.id)).size).toBe(PREDICATES.length)
    const by = (id: string) => predicateById(id)!.test
    expect(by('odd')(7)).toBe(true)
    expect(by('odd')(8)).toBe(false)
    expect(by('even')(8)).toBe(true)
    expect(by('gt20')(21)).toBe(true)
    expect(by('gt20')(20)).toBe(false)
    expect(by('le20')(20)).toBe(true)
    expect(by('mul3')(9)).toBe(true)
    expect(by('mul3')(10)).toBe(false)
    expect(by('mul5')(10)).toBe(true)
    expect(by('d7')(37)).toBe(true)
    expect(by('d7')(38)).toBe(false)
    expect(by('d1')(13)).toBe(true)
    expect(by('prime')(2)).toBe(true)
    expect(by('prime')(9)).toBe(false)
    expect(by('prime')(59)).toBe(true)
    expect(by('square')(49)).toBe(true)
    expect(by('square')(48)).toBe(false)
    expect(by('two')(10)).toBe(true)
    expect(by('one')(9)).toBe(true)
    expect(by('one')(10)).toBe(false)
  })

  it('maskOf：按圆并行求谓词，得到唯一满足掩码', () => {
    const preds = [predicateById('even')!, predicateById('gt20')!]
    expect(maskOf(8, preds)).toBe(1)
    expect(maskOf(30, preds)).toBe(3)
    expect(maskOf(7, preds)).toBe(0)
    expect(maskOf(25, preds)).toBe(2)
    const preds3 = [predicateById('odd')!, predicateById('mul3')!, predicateById('prime')!]
    // 3 满足全部三条 → 掩码 0b111。
    expect(maskOf(3, preds3)).toBe(7)
    // 15 = 奇数 & 3 倍数 & 非质数。
    expect(maskOf(15, preds3)).toBe(3)
  })

  it('圆几何：2 圆交叠 4 区；3 圆链式 6 区且首尾圆不相交', () => {
    const c2 = circlesFor(2)
    // 交叠点同时在两圆内。
    const mid2 = maskAtPoint(320, 235, c2)
    expect(mid2).toBe(3)
    expect(maskAtPoint(150, 235, c2)).toBe(1)
    expect(maskAtPoint(490, 235, c2)).toBe(2)
    expect(maskAtPoint(320, 60, c2)).toBe(0)
    const c3 = circlesFor(3)
    expect(maskAtPoint(248, 235, c3)).toBe(3)
    expect(maskAtPoint(395, 235, c3)).toBe(6)
    // 首尾圆（A、C）圆心连线中点：只落 B 或空，绝不同时含 A 与 C。
    expect(maskAtPoint(322, 235, c3)).toBe(2)
    // 全画布采样：几何掩码必须都在允许集合内。
    const allowed3 = new Set(allowedMasks(3))
    expect(allowed3).toEqual(new Set([0, 1, 2, 3, 4, 6]))
    for (let x = 20; x <= 620; x += 10) {
      for (let y = 60; y <= 420; y += 10) {
        expect(allowed3.has(maskAtPoint(x, y, c3))).toBe(true)
      }
    }
    expect(allowedMasks(2)).toEqual([0, 1, 2, 3])
  })

  it('generateLevel：卡数/唯一性/谓词数正确，每个允许区域至少 1 张可达', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
        const spec = generateLevel(mulberry32(seed * 100 + lv), lv)
        expect(spec.level).toBe(lv)
        expect(spec.circleCount).toBe(lv <= 2 ? 2 : 3)
        expect(spec.predicates).toHaveLength(spec.circleCount)
        expect(new Set(spec.predicates.map((p) => p.id)).size).toBe(spec.circleCount)
        expect(spec.pool).toHaveLength(LEVEL_CARD_COUNTS[lv - 1]!)
        expect(new Set(spec.pool).size).toBe(spec.pool.length)
        expect(spec.timeLimitMs).toBe(LEVEL_TIME_LIMITS[lv - 1])
        const reach = regionReachable(spec)
        for (const [mask, count] of reach) {
          expect([mask, count]).toEqual([mask, expect.any(Number)])
          expect(count).toBeGreaterThanOrEqual(1)
        }
        // 池中每个数字的掩码都落在允许集合（不会有无处可放的数字）。
        const allowed = new Set(allowedMasks(spec.circleCount))
        for (const n of spec.pool) expect(allowed.has(maskOf(n, spec.predicates))).toBe(true)
      }
    }
  })

  it('生成器确定性：同 seed 同关两次生成完全一致，不同 seed 布局不同', () => {
    const s1 = generateLevel(mulberry32(777), 3)
    const s2 = generateLevel(mulberry32(777), 3)
    expect(s2.predicates.map((p) => p.id)).toEqual(s1.predicates.map((p) => p.id))
    expect(s2.pool).toEqual(s1.pool)
    const s3 = generateLevel(mulberry32(778), 3)
    const differs = s3.predicates.map((p) => p.id).join(',') !== s1.predicates.map((p) => p.id).join(',')
      || s3.pool.join(',') !== s1.pool.join(',')
    expect(differs).toBe(true)
  })

  it('createVennState：一次生成 5 关，重放一致，限时只出现在第 4/5 关', () => {
    const a = createVennGameState(mulberry32(42))
    const b = createVennGameState(mulberry32(42))
    expect(a.specs).toHaveLength(LEVEL_COUNT)
    expect(b.specs.map((s) => s.pool.join(',')).join(';')).toEqual(a.specs.map((s) => s.pool.join(',')).join(';'))
    expect(b.specs.map((s) => s.predicates.map((p) => p.id).join(',')).join(';'))
      .toEqual(a.specs.map((s) => s.predicates.map((p) => p.id).join(',')).join(';'))
    expect(a.phase).toBe('playing')
    expect(a.level).toBe(1)
    a.specs.forEach((s, i) => expect(s.timeLimitMs).toBe(LEVEL_TIME_LIMITS[i]))
    // 第 4/5 关限时，前三关不限时。
    expect(a.specs[3]!.timeLimitMs).not.toBeNull()
    expect(a.specs[4]!.timeLimitMs).not.toBeNull()
  })

  it('placeCard：对号入座 ok、错放 wrong 计错、非法输入 ignored', () => {
    const state = createVennGameState(mulberry32(9))
    const num = state.pool[0]!
    const good = maskOf(num, state.predicates)
    // 在全 2^circleCount 掩码里挑一个不同的错误掩码。
    const badMask = (good + 1) % (1 << state.circleCount)
    const before = state.pool.length
    expect(placeCard(state, num, badMask)).toBe('wrong')
    expect(state.wrong).toBe(1)
    expect(state.steps).toBe(1)
    expect(state.pool).toHaveLength(before)
    expect(placeCard(state, num, good)).toBe('ok')
    expect(state.pool).toHaveLength(before - 1)
    expect(state.placed).toEqual([{ num, mask: good }])
    // 已放置 / 不存在的数字 → ignored。
    expect(placeCard(state, num, good)).toBe('ignored')
    expect(placeCard(state, 999, good)).toBe('ignored')
  })

  it('放完一关进入 clear，动画后切入下一关；五关全清 complete 且得分结算', () => {
    const state = createVennGameState(mulberry32(11))
    let clears = 0
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      solveCurrentLevel(state)
      expect(state.phase).toBe('clear')
      expect(state.levelClearMs).toBe(CLEAR_MS)
      // 消耗完过关动画。
      while (state.phase === 'clear') tick(state, 100)
      clears += 1
      if (lv < LEVEL_COUNT) {
        expect(state.phase).toBe('playing')
        expect(state.level).toBe(lv + 1)
        expect(state.pool).toHaveLength(LEVEL_CARD_COUNTS[lv]!)
      }
    }
    expect(state.phase).toBe('complete')
    expect(clears).toBe(LEVEL_COUNT)
    expect(state.score).toBeGreaterThanOrEqual(CLEAR_MIN * LEVEL_COUNT)
  })

  it('计分：错放扣分有保底，限时关有剩余时间加成', () => {
    expect(clearScore(0, null)).toBe(1000)
    expect(clearScore(4, null)).toBe(800)
    expect(clearScore(40, null)).toBe(CLEAR_MIN)
    const noBonus = clearScore(0, null)
    const withBonus = clearScore(0, 60000)
    expect(withBonus).toBe(noBonus + 120)
    // 加成封顶 300。
    expect(clearScore(0, 600000)).toBe(noBonus + 300)
    // 集成：故意错放两次再通关，得分 = 满分 - 100。
    const state = createVennGameState(mulberry32(13))
    const num = state.pool[0]!
    const badMask = (maskOf(num, state.predicates) + 1) % 4
    placeCard(state, num, badMask)
    placeCard(state, num, badMask)
    solveCurrentLevel(state)
    expect(state.score).toBe(900)
  })

  it('tick：限时关超时判 failed，计时只在限时关推进', () => {
    const state = createVennGameState(mulberry32(21))
    // 不限时关：时间不累计。
    tick(state, 5000)
    expect(state.elapsedMs).toBe(0)
    // 快进到第 4 关（限时 210s）。
    for (let i = 0; i < 3; i += 1) {
      solveCurrentLevel(state)
      while (state.phase === 'clear') tick(state, 100)
    }
    expect(state.level).toBe(4)
    expect(state.timeLimitMs).toBe(LEVEL_TIME_LIMITS[3])
    let t = 0
    while (state.phase === 'playing' && t < 250000) {
      t += 1000
      tick(state, 1000)
    }
    expect(state.phase).toBe('failed')
    // 超时后放置被忽略。
    expect(placeCard(state, state.pool[0]!, maskOf(state.pool[0]!, state.predicates))).toBe('ignored')
  })
})
