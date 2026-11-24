import { describe, expect, it } from 'vitest'
import {
  LEVELS, LEVEL_COUNT, GRID, CELLS, generateBoard, createState, computeChain,
  clickCell, countBuds, isCleared, solveGreedy, neighborsOf, mulberry32,
  type BloomState, type Cell,
} from '../src/client/games/bloom/logic.ts'

/** 手工盘面构造：默认全部填石头（不参与连锁），只留被测花苞。 */
function emptyGrid(): Cell[] {
  return Array.from({ length: CELLS }, () => ({ kind: 'stone', color: 0 }) as Cell)
}
const bud = (color: number): Cell => ({ kind: 'bud', color })
const bloom = (color: number): Cell => ({ kind: 'bloom', color })
const stone = (): Cell => ({ kind: 'stone', color: 0 })
const idx = (r: number, c: number): number => r * GRID + c
/** 手工状态：点击预算宽松，专注连锁语义。 */
function handState(grid: Cell[], clicksLeft = 99): BloomState {
  return createState(1, grid, clicksLeft)
}

describe('bloom logic', () => {
  it('mulberry32 is deterministic per seed and differs across seeds', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    const c = mulberry32(1235)
    expect(c()).not.toBe(a())
  })

  it('generateBoard: bounds, structure per level, deterministic replay', () => {
    expect(generateBoard(0, 42)).toBeNull()
    expect(generateBoard(LEVEL_COUNT + 1, 42)).toBeNull()
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const cfg = LEVELS[lv - 1]!
      const s = generateBoard(lv, 42)!
      expect(s.grid).toHaveLength(CELLS)
      expect(s.status).toBe('playing')
      expect(s.clicksLeft).toBeGreaterThan(0)
      expect(s.score).toBe(0)
      expect(s.grid.filter((c) => c.kind === 'stone')).toHaveLength(cfg.stones)
      expect(s.grid.filter((c) => c.kind === 'bloom')).toHaveLength(cfg.preBloomed)
      expect(s.grid.filter((c) => c.kind === 'bud')).toHaveLength(CELLS - cfg.stones - cfg.preBloomed)
      for (const cell of s.grid) {
        if (cell.kind === 'stone') continue
        expect(cell.color).toBeGreaterThanOrEqual(0)
        expect(cell.color).toBeLessThan(cfg.colors)
      }
    }
    // 同 seed 重放一致；异 seed 盘面不同。
    const s1 = generateBoard(3, 7)!
    const s2 = generateBoard(3, 7)!
    expect(s1.grid).toEqual(s2.grid)
    expect(s1.clicksLeft).toBe(s2.clicksLeft)
    const s3 = generateBoard(3, 999)!
    expect(s3.grid).not.toEqual(s1.grid)
  })

  it('every level is solvable: the greedy path clears the board within budget', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const fresh = generateBoard(lv, 42)!
      const greedy = solveGreedy(fresh)
      expect(greedy.clicks).toBeGreaterThan(0)
      const s = generateBoard(lv, 42)!
      for (const index of greedy.path) {
        expect(s.status).toBe('playing')
        clickCell(s, index)
      }
      expect(isCleared(s.grid)).toBe(true)
      expect(s.status).toBe('won')
      // 预算 = 贪心点击数 + 关卡 slack，逐关卡紧。
      expect(s.clicksUsed).toBe(greedy.clicks)
      expect(s.clicksLeft).toBe(LEVELS[lv - 1]!.slack)
      expect(s.score).toBe(greedy.score)
    }
  })

  it('the open group is the bud plus same-color orthogonal buds, then the chain spreads one layer per step', () => {
    const grid = emptyGrid()
    grid[idx(3, 3)] = bud(0)
    grid[idx(3, 2)] = bud(0) // 左邻同色 → 开放组
    grid[idx(2, 3)] = bud(0) // 上邻同色 → 开放组
    grid[idx(4, 3)] = bud(1) // 下邻异色 → 不入链
    grid[idx(3, 4)] = bud(2) // 右邻异色 → 不入链
    const steps = computeChain(grid, idx(3, 3))
    expect(steps).toHaveLength(3)
    expect(steps.every((s) => s.layer === 0)).toBe(true)
    expect(steps.map((s) => s.index).sort((a, b) => a - b)).toEqual(
      [idx(3, 3), idx(3, 2), idx(2, 3)].sort((a, b) => a - b),
    )
    // 第 4 行一整行同色花苞：点击行首应整行连锁，逐层推进。
    const row = emptyGrid()
    for (let c = 0; c < GRID; c += 1) row[idx(4, c)] = bud(0)
    const rowSteps = computeChain(row, idx(4, 0))
    expect(rowSteps).toHaveLength(GRID)
    // 开放组含右邻（第 0 波）；此后每远一格波次 +1，最远端为 GRID-2 波。
    const byIndex = new Map(rowSteps.map((s) => [s.index, s.layer]))
    expect(byIndex.get(idx(4, 1))).toBe(0)
    expect(byIndex.get(idx(4, 2))).toBe(1)
    expect(byIndex.get(idx(4, GRID - 1))).toBe(GRID - 2)
  })

  it('stones block propagation and never bloom', () => {
    const grid = emptyGrid()
    grid[idx(2, 2)] = bud(0)
    grid[idx(2, 3)] = bud(0) // 点击点的同色右邻 → 入开放组
    grid[idx(2, 4)] = stone() // 石头隔断
    grid[idx(2, 5)] = bud(0) // 石头之后同色花苞 → 不被连锁
    const steps = computeChain(grid, idx(2, 2))
    expect(steps.map((s) => s.index)).toEqual([idx(2, 2), idx(2, 3)])
    expect(steps.map((s) => s.index)).not.toContain(idx(2, 5))
    // 点击石头格直接被拒绝，不消耗点击。
    const s = handState(grid)
    expect(clickCell(s, idx(2, 4))).toBeNull()
    expect(s.clicksUsed).toBe(0)
    expect(countBuds(s.grid)).toBe(3)
  })

  it('pre-bloomed flowers bridge the chain to far same-color buds', () => {
    const grid = emptyGrid()
    grid[idx(0, 0)] = bud(0) // 点击点
    grid[idx(5, 5)] = bloom(4) // 开局已开的花（颜色任意）
    grid[idx(5, 4)] = bud(0) // 与已开的花相邻的本次同色花苞 → 被卷入
    const steps = computeChain(grid, idx(0, 0))
    const indices = steps.map((s) => s.index)
    expect(indices).toContain(idx(5, 4))
    // 远端花苞在第 1 波：已开的花是常驻连锁源。
    expect(steps.find((s) => s.index === idx(5, 4))!.layer).toBe(1)
    // 已开的花本身不会再次「绽放」。
    expect(indices).not.toContain(idx(5, 5))
  })

  it('earlier clicks amplify later chains: order matters', () => {
    // J(1,3)=颜色1；K(0,3)=颜色0 与 J 相邻但与 M(2,2)=颜色0 不相邻
    // （对角不算四邻）。先点 J 铺开已开网络，再点 M 时 K 被卷入连锁。
    const make = (): Cell[] => {
      const grid = emptyGrid()
      grid[idx(1, 3)] = bud(1)
      grid[idx(0, 3)] = bud(0)
      grid[idx(2, 2)] = bud(0)
      return grid
    }
    const without = handState(make())
    const first = clickCell(without, idx(2, 2))! // 没点过 J：连锁只有 M 自己
    expect(first.chainSize).toBe(1)
    expect(without.score).toBe(1)
    const withBridge = handState(make())
    clickCell(withBridge, idx(1, 3))! // 先开 J：连锁 1，J 成为连锁源
    const second = clickCell(withBridge, idx(2, 2))!
    expect(second.chainSize).toBe(2) // M + K（K 相邻已开的 J）
    expect(withBridge.score).toBe(1 + 4)
  })

  it('scoring is chain size squared and accumulates', () => {
    const grid = emptyGrid()
    for (let c = 0; c < 3; c += 1) grid[idx(0, c)] = bud(2)
    grid[idx(7, 7)] = bud(1) // 孤立花苞
    const s = handState(grid)
    const r = clickCell(s, idx(0, 1))!
    expect(r.chainSize).toBe(3)
    expect(r.gained).toBe(9)
    expect(s.score).toBe(9)
    const r2 = clickCell(s, idx(7, 7))!
    expect(r2.chainSize).toBe(1)
    expect(r2.gained).toBe(1)
    expect(s.score).toBe(10)
  })

  it('budget: clearing wins, running out loses, finished games reject clicks', () => {
    const make = (): Cell[] => {
      const grid = emptyGrid()
      grid[idx(0, 0)] = bud(0)
      grid[idx(0, 1)] = bud(0)
      grid[idx(7, 7)] = bud(1)
      return grid
    }
    // 点击预算 2：第一击开两个（同色相邻），第二击清场 → 胜。
    const won = handState(make(), 2)
    clickCell(won, idx(0, 0))
    const final = clickCell(won, idx(7, 7))!
    expect(final.won).toBe(true)
    expect(won.status).toBe('won')
    expect(won.clicksLeft).toBe(0)
    expect(clickCell(won, idx(0, 0))).toBeNull() // 已结束
    // 预算 1：开两个后仍剩花苞 → 败。
    const lost = handState(make(), 1)
    clickCell(lost, idx(0, 0))
    expect(lost.status).toBe('lost')
    expect(clickCell(lost, idx(7, 7))).toBeNull() // 失败后不可再点
    // 点击已绽放的格同样被拒绝。
    const s = handState(make(), 5)
    clickCell(s, idx(0, 0))
    expect(clickCell(s, idx(0, 0))).toBeNull()
  })

  it('seed replay: identical boards play out identically', () => {
    const play = (seed: number): { grid: Cell[], score: number, used: number, status: string } => {
      const s = generateBoard(4, seed)!
      let guard = 0
      while (s.status === 'playing' && guard < 200) {
        guard += 1
        // 与 solveGreedy 同策略：每次点当前连锁最大的花苞。
        let best = -1
        let bestSize = 0
        for (let i = 0; i < CELLS; i += 1) {
          if (s.grid[i]!.kind !== 'bud') continue
          const size = computeChain(s.grid, i).length
          if (size > bestSize) {
            bestSize = size
            best = i
          }
        }
        clickCell(s, best)
      }
      return { grid: s.grid, score: s.score, used: s.clicksUsed, status: s.status }
    }
    const a = play(2024)
    const b = play(2024)
    expect(b).toEqual(a)
    expect(a.status).toBe('won')
    expect(a.used).toBeLessThanOrEqual(generateBoard(4, 2024)!.clicksLeft)
    expect(countBuds(a.grid)).toBe(0)
  })

  it('neighborsOf stays inside the board and createState rejects malformed grids', () => {
    expect(neighborsOf(0).sort((x, y) => x - y)).toEqual([1, 8])
    expect(neighborsOf(63).sort((x, y) => x - y)).toEqual([55, 62])
    expect(neighborsOf(idx(3, 3)).sort((x, y) => x - y)).toEqual(
      [idx(2, 3), idx(4, 3), idx(3, 2), idx(3, 4)].sort((x, y) => x - y),
    )
    expect(() => createState(1, new Array<Cell>(10), 5)).toThrow()
  })
})
