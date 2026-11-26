import { describe, expect, it } from 'vitest'
import {
  LEVELS, LEVEL_COUNT, BASE_W, BLOCK_MIN_W, BLOCK_MAX_W,
  COLLAPSE_MS, CLEARED_MS, CLEAR_BONUS,
  mulberry32, createState, place, step, pendingX, computeCom,
  interfaceReport, worstInterface, failReason, isComplete,
  towerHeight, type TowerBlock, type TowerBuildState,
} from '../src/client/games/towerbuild/logic.ts'

/** 手工摆一块（绕开 rng，直接构造指定几何）。 */
function block(w: number, mass: number, cx: number, comOffset = 0): TowerBlock {
  return { w, mass, cx, comOffset }
}

/** 在指定关卡上手工搭好塔身（slip 清零、吊挂块固定）。 */
function withTower(level: number, blocks: TowerBlock[], pending: TowerBlock): TowerBuildState {
  const state = createState(level, 42)
  state.blocks = blocks.map(b => ({ ...b }))
  state.slip = blocks.map(() => 0)
  state.pending = { ...pending }
  state.swingPhase = 0
  state.comX = computeCom(state.blocks).x
  return state
}

describe('towerbuild logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('block generation is seed-deterministic and within ranges', () => {
    const a = createState(0, 777)
    const b = createState(0, 777)
    expect(a.pending).toEqual(b.pending)
    expect(createState(0, 778).pending).not.toEqual(b.pending)
    for (let i = 0; i < 40; i += 1) {
      const s = createState(i % LEVEL_COUNT, 1000 + i)
      expect(s.pending.w).toBeGreaterThanOrEqual(BLOCK_MIN_W)
      expect(s.pending.w).toBeLessThanOrEqual(BLOCK_MAX_W)
      expect(s.pending.mass).toBe(Math.round(s.pending.w / 12))
      expect(Math.abs(s.pending.comOffset)).toBeLessThanOrEqual(s.pending.w * 0.1 + 1e-9)
    }
  })

  it('createState starts a fresh swing with clamped level', () => {
    const state = createState(0, 5)
    expect(state.phase).toBe('swing')
    expect(state.blocks).toHaveLength(0)
    expect(state.slip).toHaveLength(0)
    expect(state.score).toBe(0)
    expect(state.wind).toBe(0)
    expect(towerHeight(state)).toBe(0)
    expect(createState(99, 5).level).toBe(LEVEL_COUNT - 1)
    expect(createState(-3, 5).level).toBe(0)
  })

  it('centered drops stack: 8 blocks clear level 1 with bonus', () => {
    const state = createState(0, 99)
    for (let i = 0; i < 7; i += 1) {
      expect(place(state)).toBe('placed')
      // genPending 重置摆相位为 0，落点恒为中线。
      expect(state.blocks[i]!.cx).toBe(0)
      expect(state.score).toBe(i + 1)
    }
    expect(place(state)).toBe('cleared')
    expect(state.blocks).toHaveLength(LEVELS[0]!.target)
    expect(state.score).toBe(8 + CLEAR_BONUS)
    expect(state.clearedLevels).toBe(1)
    expect(state.phase).toBe('cleared')
  })

  it('a drop with too little overlap misses and falls, then fails', () => {
    // 顶层窄块 cx=0 半宽 42，吊块半宽 42；摆到 amp=76 处重叠仅 8。
    const state = withTower(1, [block(84, 7, 0)], block(84, 7, 0))
    state.swingPhase = Math.PI / 2
    expect(pendingX(state)).toBeCloseTo(LEVELS[1]!.swingAmp, 6)
    const result = place(state)
    expect(result).toBe('miss')
    expect(state.phase).toBe('collapse')
    expect(state.blocks).toHaveLength(1)
    expect(state.debris).toHaveLength(1)
    expect(state.collapseIndex).toBe(-1)
    expect(failReason(state)).toBe('miss')
    for (let t = 0; t < COLLAPSE_MS; t += 50) step(state, 50)
    expect(state.phase).toBe('over')
  })

  it('center of mass beyond the base topples the whole tower', () => {
    // 8 块重块全压在 cx=110，联合重心 ~95 > 基座半宽 80。
    const tower: TowerBlock[] = []
    for (let i = 0; i < 8; i += 1) tower.push(block(168, 14, 110))
    const state = withTower(4, tower, block(168, 14, 110))
    state.swingPhase = Math.PI / 2 // amp=110 → 落点 110
    expect(Math.abs(computeCom([...tower, block(168, 14, 110)]).x)).toBeGreaterThan(BASE_W / 2)
    expect(place(state)).toBe('toppled')
    expect(state.phase).toBe('collapse')
    expect(state.collapseIndex).toBe(0)
    expect(state.blocks).toHaveLength(0)
    expect(state.debris).toHaveLength(9)
    expect(failReason(state)).toBe('toppled')
  })

  it('interface eccentricity creeps to a segment collapse; centered stacks hold', () => {
    // 偏心比 ~0.85：进入滑移区但不超 1，数秒后第 1 界面以上倒塌。
    const wobbly = withTower(0, [block(168, 14, 0), block(84, 7, 58)], block(120, 10, 0))
    const report = interfaceReport(wobbly, 1)!
    expect(report.e).toBeGreaterThan(0.55)
    expect(report.e).toBeLessThan(1)
    let collapsed = false
    for (let t = 0; t < 8000 && !collapsed; t += 50) {
      step(wobbly, 50)
      collapsed = wobbly.phase === 'collapse'
    }
    expect(collapsed).toBe(true)
    expect(wobbly.collapseIndex).toBe(1)
    expect(wobbly.blocks).toHaveLength(1)
    expect(wobbly.debris).toHaveLength(1)
    expect(failReason(wobbly)).toBe('collapse')

    // 居中塔：偏心比低于稳定阈值，长时间不倒。
    const steady = withTower(0, [block(168, 14, 0), block(84, 7, 20)], block(120, 10, 0))
    expect(Math.abs(interfaceReport(steady, 1)!.e)).toBeLessThan(0.55)
    for (let t = 0; t < 8000; t += 50) step(steady, 50)
    expect(steady.phase).toBe('swing')
    expect(steady.slip[1]).toBeLessThanOrEqual(0)
  })

  it('wind only blows on the last two levels and stays within strength', () => {
    const calm = createState(0, 31)
    const windy = createState(4, 31)
    for (let t = 0; t < 8000; t += 50) {
      step(calm, 50)
      step(windy, 50)
    }
    expect(calm.wind).toBe(0)
    expect(Math.abs(windy.wind)).toBeLessThanOrEqual(LEVELS[4]!.wind + 1e-9)
    expect(windy.wind).not.toBe(0)
    expect(LEVELS[0]!.wind).toBe(0)
    expect(LEVELS[3]!.wind).toBeGreaterThan(0)
  })

  it('clearing auto-advances to the next level and completes the run', () => {
    const state = createState(0, 55)
    for (let i = 0; i < LEVELS[0]!.target; i += 1) place(state)
    for (let t = 0; t < CLEARED_MS + 100; t += 50) step(state, 50)
    expect(state.level).toBe(1)
    expect(state.phase).toBe('swing')
    expect(state.blocks).toHaveLength(0)
    expect(state.score).toBe(LEVELS[0]!.target + CLEAR_BONUS)

    const last = createState(LEVEL_COUNT - 1, 55)
    for (let i = 0; i < LEVELS[LEVEL_COUNT - 1]!.target; i += 1) place(last)
    expect(last.phase).toBe('cleared')
    for (let t = 0; t < CLEARED_MS + 100; t += 50) step(last, 50)
    expect(last.phase).toBe('over')
    expect(isComplete(last)).toBe(true)
  })

  it('the same seed replays identically; a different seed diverges', () => {
    const run = (seed: number): TowerBuildState => {
      const s = createState(2, seed)
      for (let i = 0; i < 6; i += 1) {
        step(s, 40)
        if (s.phase !== 'swing') break
        place(s)
      }
      return s
    }
    const a = run(2024)
    const b = run(2024)
    expect(b.blocks).toEqual(a.blocks)
    expect(b.score).toBe(a.score)
    expect(b.comX).toBeCloseTo(a.comX, 12)
    expect(b.phase).toBe(a.phase)
    const c = run(2025)
    expect(c.blocks).not.toEqual(a.blocks)
  })

  it('debris obeys projectile physics and settles near the ground', () => {
    const state = withTower(1, [block(84, 7, 0)], block(84, 7, 0))
    state.swingPhase = Math.PI / 2
    place(state) // miss
    const d = state.debris[0]!
    const vy0 = d.vy
    expect(vy0).toBeLessThanOrEqual(0) // 出生时可能上抛
    step(state, 100)
    expect(d.vy).toBeGreaterThan(vy0) // 重力持续加速
    expect(d.rot).not.toBe(0)
    expect(d.x).not.toBe(0) // 带随机水平初速
    for (let t = 0; t < 3000; t += 50) step(state, 50)
    expect(state.phase).toBe('over')
    expect(d.y).toBeGreaterThanOrEqual(-11) // 触地停在地面附近
    expect(Math.abs(d.y + 10)).toBeLessThanOrEqual(1e-9)
  })

  it('worstInterface tracks the riskiest interface for the HUD', () => {
    const state = withTower(0, [block(168, 14, 0), block(84, 7, 58)], block(120, 10, 0))
    const worst = worstInterface(state)
    expect(worst.k).toBe(1)
    expect(worst.e).toBeGreaterThan(0.55)
    const empty = createState(0, 1)
    expect(worstInterface(empty).k).toBe(-1)
    expect(interfaceReport(state, -1)).toBeNull()
    expect(interfaceReport(state, 2)).toBeNull()
  })
})
