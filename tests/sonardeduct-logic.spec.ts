import { describe, expect, it } from 'vitest'
import {
  DIRS,
  LEVEL_COUNT,
  SIZE,
  WRONG_LIMIT,
  cellIndex,
  createLevel,
  echoAt,
  fishPositions,
  greedyCoverCount,
  levelConfig,
  levelSeed,
  markCount,
  obstacleCount,
  ping,
  revealedByPing,
  tick,
  toggleMark,
  type SonarDeductState,
} from '../src/client/games/sonardeduct/logic.ts'

const SEEDS = [1, 42, 20261023, 0x9e3779b9, 777777]

/** 可判等快照（排除 rng 闭包）。 */
function snapshot(s: SonarDeductState): string {
  return JSON.stringify({
    level: s.level,
    obstacles: [...s.obstacles],
    marks: [...s.marks],
    pings: s.pings.map(p => [p.r, p.c, ...p.echo]),
    budget: s.budget,
    wrong: s.wrong,
    t: s.t,
    status: s.status,
    score: s.score,
    fish: s.fish.map(f => [f.x0, f.y0, f.vx, f.vy]),
  })
}

/** 构造指定障碍布局（绕过随机生成，直接测回声几何）。 */
function stateWithObstacles(cells: [number, number][]): SonarDeductState {
  const s = createLevel(12345, 1)
  s.obstacles = new Uint8Array(SIZE * SIZE)
  s.fish = []
  for (const [r, c] of cells) s.obstacles[cellIndex(r, c)] = 1
  return s
}

/** 测试方贪心玩家：按贪心覆盖选点发波，然后把全部命中格插旗。 */
function greedyPlay(s: SonarDeductState): void {
  const found = new Set<number>()
  while (found.size < obstacleCount(s) && s.budget > 0) {
    let bestR = -1
    let bestC = -1
    let bestGain = 0
    let bestHits: number[] = []
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        if (s.pings.some(p => p.r === r && p.c === c)) continue
        const hits = revealedByPing(s.obstacles, r, c)
        const gain = hits.filter(h => !found.has(h)).length
        if (gain > bestGain) {
          bestGain = gain
          bestR = r
          bestC = c
          bestHits = hits
        }
      }
    }
    if (bestGain <= 0) break
    expect(ping(s, bestR, bestC)).toBe(true)
    for (const h of bestHits) found.add(h)
  }
  expect(found.size, '贪心发波应命中全部障碍').toBe(obstacleCount(s))
  for (const h of found) {
    const r = Math.floor(h / SIZE)
    const c = h % SIZE
    expect(toggleMark(s, r, c)).toBe(true)
  }
}

describe('sonardeduct logic', () => {
  it('同 seed 同关生成完全相同的海域（含鱼群与到达预算）', () => {
    for (const seed of SEEDS) {
      for (const level of [1, 3, 5]) {
        const a = createLevel(seed, level)
        const b = createLevel(seed, level)
        expect(snapshot(b)).toBe(snapshot(a))
      }
    }
  })

  it('布局约束：障碍数与配置一致且两两切比雪夫距离 ≥ 2', () => {
    for (const seed of SEEDS) {
      for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        const s = createLevel(seed, level)
        expect(obstacleCount(s)).toBe(levelConfig(level).obstacles)
        const cells: [number, number][] = []
        for (let r = 0; r < SIZE; r += 1) {
          for (let c = 0; c < SIZE; c += 1) {
            if (s.obstacles[cellIndex(r, c)] === 1) cells.push([r, c])
          }
        }
        for (let i = 0; i < cells.length; i += 1) {
          for (let j = i + 1; j < cells.length; j += 1) {
            const [ar, ac] = cells[i]!
            const [br, bc] = cells[j]!
            expect(Math.max(Math.abs(ar - br), Math.abs(ac - bc))).toBeGreaterThanOrEqual(2)
          }
        }
      }
    }
  })

  it('可解性验证：贪心覆盖所需声呐数不超过本关预算', () => {
    for (const seed of SEEDS) {
      for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        const s = createLevel(seed, level)
        expect(greedyCoverCount(s.obstacles)).toBeLessThanOrEqual(levelConfig(level).budget)
      }
    }
  })

  it('回声几何：8 向 raycast 距离与非零命中精确定位', () => {
    // (3,3) 单障碍：从 (3,0) 向东距离 3；从 (0,0) 向东南距离 3。
    const a = stateWithObstacles([[3, 3]])
    expect(echoAt(a.obstacles, 3, 0)[DIRS.findIndex(d => d.name === '东')]).toBe(3)
    expect(echoAt(a.obstacles, 0, 0)[DIRS.findIndex(d => d.name === '东南')]).toBe(3)
    expect(echoAt(a.obstacles, 3, 0)[DIRS.findIndex(d => d.name === '西')]).toBe(0)
    expect(echoAt(a.obstacles, 6, 6)[DIRS.findIndex(d => d.name === '西北')]).toBe(3)
    // 近者遮远者：北向最近障碍优先。
    const b = stateWithObstacles([[1, 4], [6, 4]])
    expect(echoAt(b.obstacles, 4, 4)[DIRS.findIndex(d => d.name === '北')]).toBe(3)
    expect(echoAt(b.obstacles, 4, 4)[DIRS.findIndex(d => d.name === '南')]).toBe(2)
    expect(revealedByPing(b.obstacles, 4, 4)).toEqual([cellIndex(1, 4), cellIndex(6, 4)])
    // 边界：越界方向无障碍返回 0。
    const c = stateWithObstacles([[0, 8]])
    expect(echoAt(c.obstacles, 8, 0)[DIRS.findIndex(d => d.name === '东南')]).toBe(0)
  })

  it('声呐预算：每次 ping 扣 1、重复格与超额均拒绝', () => {
    const s = createLevel(7, 2)
    const cfg = levelConfig(2)
    expect(ping(s, 4, 4)).toBe(true)
    expect(s.budget).toBe(cfg.budget - 1)
    expect(ping(s, 4, 4)).toBe(false)
    expect(s.budget).toBe(cfg.budget - 1)
    for (let r = 0; r < SIZE && s.budget > 0; r += 1) {
      for (let c = 0; c < SIZE && s.budget > 0; c += 1) {
        if (r === 4 && c === 4) continue
        ping(s, r, c)
      }
    }
    expect(s.budget).toBe(0)
    expect(ping(s, 8, 8)).toBe(false)
  })

  it('标记判定：凑满全对过关，错旗即拔并扣分、误标 3 次判负', () => {
    const s = stateWithObstacles([[2, 2], [5, 6], [7, 1]])
    // 第一轮：一面错旗 + 两面对旗凑满 → 判定失败，错旗被拔、对旗保留。
    toggleMark(s, 0, 0)
    toggleMark(s, 2, 2)
    toggleMark(s, 5, 6)
    expect(s.status).toBe('playing')
    expect(s.wrong).toBe(1)
    expect(markCount(s)).toBe(2)
    expect(s.marks[cellIndex(0, 0)]).toBe(0)
    expect(s.marks[cellIndex(2, 2)]).toBe(1)
    expect(s.marks[cellIndex(5, 6)]).toBe(1)
    expect(s.score).toBe(-20)
    // 第二轮：第三面旗又是错旗 → 再判一次，wrong=2。
    toggleMark(s, 0, 1)
    expect(s.wrong).toBe(2)
    expect(markCount(s)).toBe(2)
    expect(s.marks[cellIndex(0, 1)]).toBe(0)
    expect(s.score).toBe(-40)
    // 第三轮误标 → 判负。
    toggleMark(s, 0, 2)
    expect(s.wrong).toBe(WRONG_LIMIT)
    expect(s.status).toBe('gameover')
  })

  it('过关计分：障碍 ×100 + 剩余声呐 ×60 − 误标 ×20（下限 60）', () => {
    const s = stateWithObstacles([[2, 2], [5, 6], [7, 1]])
    ping(s, 4, 4)
    toggleMark(s, 2, 2)
    toggleMark(s, 5, 6)
    toggleMark(s, 7, 1)
    expect(s.status).toBe('levelClear')
    // 3 障碍 ×100 + 剩余（level1 预算 6 已用 1）×60 = 480。
    expect(s.score).toBe(3 * 100 + 5 * 60)
    // 误标路径的分数下限。
    const b = stateWithObstacles([[0, 0], [8, 8]])
    for (let i = 0; i < 3; i += 1) {
      toggleMark(b, 4, 4)
      toggleMark(b, 3, 3)
    }
    expect(b.wrong).toBe(3)
    expect(b.status).toBe('gameover')
    expect(b.score).toBeLessThanOrEqual(-60)
  })

  it('预算类参数实测：贪心玩家多 seed 全关可赢（含第 5 关预算 3）', () => {
    for (const seed of SEEDS) {
      for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        const s = createLevel(seed, level)
        greedyPlay(s)
        expect(s.status, 'seed ' + seed + ' level ' + level).toBe(level === LEVEL_COUNT ? 'allClear' : 'levelClear')
      }
    }
  })

  it('鱼群漂移：随 t 线性推进且环绕、只作干扰不影响回声与判定', () => {
    const s = createLevel(99, 3)
    expect(s.fish.length).toBe(levelConfig(3).fish)
    const before = fishPositions(s)[0]!
    const obstaclesBefore = [...s.obstacles]
    for (let i = 0; i < 600; i += 1) tick(s, 1 / 60)
    const after = fishPositions(s)[0]!
    expect(s.t).toBeCloseTo(10, 5)
    expect(after).not.toEqual(before)
    for (const p of fishPositions(s)) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(SIZE)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(SIZE)
    }
    // 鱼群不改变障碍与回声：同一格先后回声一致。
    expect([...s.obstacles]).toEqual(obstaclesBefore)
    const s2 = createLevel(99, 3)
    const e1 = echoAt(s.obstacles, 4, 4)
    const e2 = echoAt(s2.obstacles, 4, 4)
    expect(e2).toEqual(e1)
  })

  it('seed 重放：同 seed + 同操作序列 + 同 tick 序列 → 局面完全一致', () => {
    for (const seed of SEEDS) {
      const a = createLevel(seed, 4)
      const b = createLevel(seed, 4)
      const ops: [number, number][] = [[4, 4], [0, 0], [8, 8], [4, 4]]
      for (const [r, c] of ops) {
        ping(a, r, c)
        ping(b, r, c)
      }
      for (const [r, c] of [[4, 4], [1, 1], [7, 7]] as [number, number][]) {
        toggleMark(a, r, c)
        toggleMark(b, r, c)
      }
      for (let i = 0; i < 120; i += 1) {
        tick(a, 1 / 60)
        tick(b, 1 / 60)
      }
      expect(snapshot(b)).toBe(snapshot(a))
    }
  })

  it('tick 时间推进：固定 1/60 子步累加，胜负后为空操作', () => {
    const s = createLevel(3, 1)
    for (let i = 0; i < 90; i += 1) tick(s, 1 / 60)
    expect(s.t).toBeCloseTo(1.5, 6)
    const frozen = s.t
    const cells: [number, number][] = []
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        if (s.obstacles[cellIndex(r, c)] === 1) cells.push([r, c])
      }
    }
    for (const [r, c] of cells) toggleMark(s, r, c)
    expect(s.status).toBe('levelClear')
    tick(s, 1)
    expect(s.t).toBe(frozen)
  })
})
