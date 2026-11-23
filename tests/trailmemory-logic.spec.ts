import { describe, expect, it } from 'vitest'
import {
  DISTRACT_MS, DISTRACT_ROUND, FLASH_MIN_MS, FLASH_START_MS, GRID,
  START_LIVES, TELEPORT_ROUND,
  advanceShow, buildEvents, clickCell, createTrailMemoryState, currentEvent,
  flashMs, generateTrail, mulberry32, startRound, trailLength, useReplay,
} from '../src/client/games/trailmemory/logic.ts'

/** 把闪现阶段一次性推完（小步长保证跨事件边界也被消费）。 */
function showAll(state: ReturnType<typeof createTrailMemoryState>): void {
  let guard = 0
  while (state.phase === 'showing' && guard < 10000) {
    advanceShow(state, 40)
    guard += 1
  }
}

/** 两格是否正交相邻（测试侧独立实现，作交叉验证）。 */
function manhattan1(a: number, b: number): boolean {
  const dr = Math.abs(Math.floor(a / GRID) - Math.floor(b / GRID))
  const dc = Math.abs((a % GRID) - (b % GRID))
  return dr + dc === 1
}

describe('trailmemory logic', () => {
  it('generates deterministic trails and events for the same seed', () => {
    const a = createTrailMemoryState(mulberry32(123))
    const b = createTrailMemoryState(mulberry32(123))
    for (let i = 0; i < 5; i += 1) {
      startRound(a)
      startRound(b)
    }
    expect(a.round).toBe(5)
    expect(a.path).toEqual(b.path)
    expect(a.teleports).toEqual(b.teleports)
    expect(a.events).toEqual(b.events)
    // 不同种子大概率得到不同路径。
    const c = createTrailMemoryState(mulberry32(456))
    startRound(c)
    expect(c.path).not.toEqual(a.path.slice(0, c.path.length))
  })

  it('builds self-avoiding trails of the round length inside the grid', () => {
    const state = createTrailMemoryState(mulberry32(7))
    for (let r = 1; r <= 10; r += 1) {
      startRound(state)
      expect(state.round).toBe(r)
      expect(state.path).toHaveLength(trailLength(r))
      expect(new Set(state.path).size).toBe(state.path.length)
      for (const cell of state.path) {
        expect(cell).toBeGreaterThanOrEqual(0)
        expect(cell).toBeLessThan(GRID * GRID)
      }
      expect(state.teleports).toHaveLength(state.path.length)
    }
    expect(trailLength(1)).toBe(3)
  })

  it('marks teleports exactly on non-adjacent steps and none before round 3', () => {
    for (const seed of [1, 42, 99, 2024]) {
      const rng = mulberry32(seed)
      for (let r = 1; r <= 8; r += 1) {
        const { path, teleports } = generateTrail(rng, r)
        for (let i = 1; i < path.length; i += 1) {
          // 不变量：传送标记 ⟺ 与上一格不相邻。
          expect(teleports[i]).toBe(!manhattan1(path[i - 1]!, path[i]!))
          if (r < TELEPORT_ROUND) expect(teleports[i]).toBe(false)
        }
      }
    }
  })

  it('ramps flash duration from 600ms down to the 280ms floor', () => {
    expect(flashMs(1)).toBe(FLASH_START_MS)
    expect(flashMs(9)).toBe(FLASH_MIN_MS)
    expect(flashMs(50)).toBe(FLASH_MIN_MS)
    for (let r = 1; r < 8; r += 1) {
      expect(flashMs(r)).toBeGreaterThan(flashMs(r + 1))
    }
  })

  it('keeps path order in events and adds distractors only from round 5', () => {
    const rng = mulberry32(11)
    for (let r = 1; r < DISTRACT_ROUND; r += 1) {
      const config = generateTrail(rng, r)
      const events = buildEvents(rng, config, r)
      expect(events.every(e => e.isPath)).toBe(true)
      expect(events.map(e => e.cell)).toEqual(config.path)
    }
    for (let r = DISTRACT_ROUND; r <= 9; r += 1) {
      const config = generateTrail(rng, r)
      const events = buildEvents(rng, config, r)
      const pathEvents = events.filter(e => e.isPath).map(e => e.cell)
      expect(pathEvents).toEqual(config.path)
      const distractors = events.filter(e => !e.isPath)
      expect(distractors.length).toBeGreaterThanOrEqual(1)
      // 干扰微闪时长固定短促，明显快于该轮路径格闪现。
      expect(DISTRACT_MS).toBeLessThan(flashMs(r))
      for (const d of distractors) {
        expect(config.path).not.toContain(d.cell)
      }
    }
  })

  it('advances the show phase over events and lands in input', () => {
    const state = createTrailMemoryState(mulberry32(5))
    startRound(state)
    expect(state.phase).toBe('showing')
    expect(currentEvent(state)).toEqual(state.events[0])
    // 一次大步推进跨过多个事件边界，dt 被整段消费。
    let guard = 0
    while (state.phase === 'showing' && guard < 100) {
      advanceShow(state, 1000)
      guard += 1
    }
    expect(state.phase).toBe('input')
    expect(currentEvent(state)).toBeNull()
    expect(state.inputIndex).toBe(0)
    expect(advanceShow(state, 100)).toBe(false) // input 阶段推进无效
  })

  it('scores path-length-squared per cleared round and grows the trail', () => {
    const state = createTrailMemoryState(mulberry32(9))
    startRound(state)
    showAll(state)
    expect(clickCell(state, state.path[0]!)).toBe('step')
    expect(clickCell(state, state.path[1]!)).toBe('step')
    expect(clickCell(state, state.path[2]!)).toBe('round-clear')
    expect(state.score).toBe(9) // 3²
    expect(state.round).toBe(2)
    expect(state.path).toHaveLength(4)
    expect(state.phase).toBe('showing')
    expect(state.replayUsed).toBe(false)
    showAll(state)
    for (const cell of state.path) clickCell(state, cell)
    expect(state.score).toBe(25) // 9 + 4²
  })

  it('charges a life per wrong step, reshows the trail, then ends at 0 lives', () => {
    const state = createTrailMemoryState(mulberry32(13))
    startRound(state)
    showAll(state)
    const trail = state.path
    // 重看后 inputIndex 归 0：每次错步都从第一步判起。
    const wrongFor = (): number => (trail[0]! + 1) % (GRID * GRID)
    expect(clickCell(state, wrongFor())).toBe('retry')
    expect(state.lives).toBe(START_LIVES - 1)
    expect(state.phase).toBe('showing')
    expect(state.path).toEqual(trail) // 同一条路径重看
    showAll(state)
    expect(clickCell(state, wrongFor())).toBe('retry')
    expect(state.lives).toBe(1)
    showAll(state)
    expect(clickCell(state, wrongFor())).toBe('game-over')
    expect(state.lives).toBe(0)
    expect(state.phase).toBe('over')
    expect(clickCell(state, trail[0]!)).toBe('ignored')
  })

  it('ignores clicks outside the input phase', () => {
    const state = createTrailMemoryState(mulberry32(21))
    expect(clickCell(state, 0)).toBe('ignored') // idle
    startRound(state)
    expect(clickCell(state, state.path[0]!)).toBe('ignored') // showing
  })

  it('allows one space replay per round and restores it next round', () => {
    const state = createTrailMemoryState(mulberry32(31))
    startRound(state)
    expect(useReplay(state)).toBe(false) // showing 阶段不可用
    showAll(state)
    const events = state.events
    expect(useReplay(state)).toBe(true)
    expect(state.phase).toBe('showing')
    expect(state.events).toEqual(events) // 重看同一条序列
    showAll(state)
    expect(useReplay(state)).toBe(false) // 每轮只有一次
    // 错步重看不占用空格重看额度。
    clickCell(state, (state.path[0]! + 1) % (GRID * GRID))
    showAll(state)
    expect(useReplay(state)).toBe(false)
    // 走完本轮后下一轮额度恢复。
    for (const cell of state.path) clickCell(state, cell)
    expect(state.replayUsed).toBe(false)
  })

  it('replays a full scripted game identically from the same seed', () => {
    const run = (seed: number): { score: number, round: number, lives: number } => {
      const s = createTrailMemoryState(mulberry32(seed))
      startRound(s)
      // 剧本：第 1 轮全对、第 2 轮故意错一次再走对、第 3 轮连错到底。
      showAll(s)
      for (const cell of s.path) clickCell(s, cell)
      showAll(s)
      clickCell(s, (s.path[0]! + 5) % (GRID * GRID))
      showAll(s)
      for (const cell of s.path) clickCell(s, cell)
      showAll(s)
      while (s.phase !== 'over') {
        clickCell(s, (s.path[s.inputIndex]! + 1) % (GRID * GRID))
        showAll(s)
      }
      return { score: s.score, round: s.round, lives: s.lives }
    }
    const first = run(777)
    const second = run(777)
    expect(second).toEqual(first)
    expect(first.score).toBe(9 + 16) // 前两轮通过，第三轮命尽
    expect(first.round).toBe(3)
    expect(first.lives).toBe(0)
  })

})
