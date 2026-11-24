import { describe, expect, it } from 'vitest'
import {
  applyHint, buildLevel, compareCells, completionPct, computeScore, createCanvas,
  eligiblePatterns, eraseCell, HINTS_PER_LEVEL, isSolved, LEVEL_COUNT,
  levelGridRange, mulberry32, paintCell, PATTERN_LIBRARY, referenceCells,
} from '../src/client/games/pixelpainter/logic.ts'

describe('pixelpainter logic', () => {
  it('mulberry32: 同种子序列一致，不同种子不同，值域 [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
    const c = mulberry32(43)
    const seqC = Array.from({ length: 20 }, () => c())
    expect(seqA).not.toEqual(seqC)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('图案库合法：行宽=边长、字符有定义、总数>=10、含色 4-6', () => {
    expect(PATTERN_LIBRARY.length).toBeGreaterThanOrEqual(10)
    const seen = new Set<string>()
    for (const p of PATTERN_LIBRARY) {
      expect(seen.has(p.id)).toBe(false)
      seen.add(p.id)
      expect(p.rows.length).toBe(p.grid)
      for (const row of p.rows) expect(row.length).toBe(p.grid)
      const totalColors = p.colors.length + 1
      expect(totalColors).toBeGreaterThanOrEqual(4)
      expect(totalColors).toBeLessThanOrEqual(6)
      for (const row of p.rows) {
        for (const ch of row) {
          if (ch === '.') continue
          expect(p.colors.some((c) => c.char === ch)).toBe(true)
        }
      }
      // 每幅图至少用到每一种声明的颜色（避免死色）。
      for (const c of p.colors) {
        expect(p.rows.some((row) => row.includes(c.char))).toBe(true)
      }
    }
  })

  it('关卡递进：各关网格范围单调放大且可选图案 >=2，选图都在范围内', () => {
    let prevMax = 0
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const [min, max] = levelGridRange(level)
      expect(max).toBeGreaterThanOrEqual(min)
      expect(min).toBeGreaterThanOrEqual(prevMax)
      prevMax = max
      const pool = eligiblePatterns(level)
      expect(pool.length).toBeGreaterThanOrEqual(2)
      for (const p of pool) {
        expect(p.grid).toBeGreaterThanOrEqual(min)
        expect(p.grid).toBeLessThanOrEqual(max)
      }
    }
    expect(levelGridRange(0)).toEqual([8, 8])
    expect(levelGridRange(LEVEL_COUNT - 1)).toEqual([11, 12])
  })

  it('buildLevel 确定性：同种子同图同参考同调色板；调色板是颜色下标的排列', () => {
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const a = buildLevel(level, 12345)
      const b = buildLevel(level, 12345)
      expect(a.pattern.id).toBe(b.pattern.id)
      expect(a.reference).toEqual(b.reference)
      expect(a.palette).toEqual(b.palette)
      expect(a.palette.length).toBe(a.pattern.colors.length)
      const sorted = a.palette.slice().sort((x, y) => x - y)
      expect(sorted).toEqual(a.pattern.colors.map((_, i) => i))
    }
  })

  it('referenceCells: 参考图长度为 grid 方，空格 -1，其余为合法颜色下标', () => {
    for (const p of PATTERN_LIBRARY) {
      const ref = referenceCells(p)
      expect(ref.length).toBe(p.grid * p.grid)
      for (const v of ref) {
        expect(v === -1 || (v >= 0 && v < p.colors.length)).toBe(true)
      }
      // 参考图必须既有非空格也有空格（否则没有清除玩法）。
      expect(ref.some((v) => v >= 0)).toBe(true)
      expect(ref.some((v) => v === -1)).toBe(true)
    }
  })

  it('paintCell/eraseCell: 涂改与清除只在真正变化时计一次，越界拒绝', () => {
    const cells = createCanvas(8)
    expect(paintCell(cells, 8, 3, 2, 1)).toBe(true)
    expect(cells[2 * 8 + 3]).toBe(1)
    expect(paintCell(cells, 8, 3, 2, 1)).toBe(false)
    expect(paintCell(cells, 8, 3, 2, 0)).toBe(true)
    expect(eraseCell(cells, 8, 3, 2)).toBe(true)
    expect(cells[2 * 8 + 3]).toBe(-1)
    expect(eraseCell(cells, 8, 3, 2)).toBe(false)
    expect(paintCell(cells, 8, -1, 0, 1)).toBe(false)
    expect(paintCell(cells, 8, 8, 0, 1)).toBe(false)
    expect(eraseCell(cells, 8, 0, 8)).toBe(false)
  })

  it('compareCells: 对/错计数与错格列表符合手算，多涂与漏涂都算错', () => {
    // 2x2 参考：[0, 1, -1, 0]；画布：[0, -1, -1, 1]
    const reference = [0, 1, -1, 0]
    const canvas = [0, -1, -1, 1]
    const result = compareCells(reference, canvas, 2)
    expect(result.total).toBe(4)
    expect(result.correct).toBe(2)
    expect(result.wrong).toBe(2)
    expect(result.wrongCells).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }])
    expect(completionPct(result)).toBe(50)
    expect(isSolved(result)).toBe(false)
  })

  it('完成度与过关：空画布按空格数起步，完全一致时 100% 且 isSolved', () => {
    const level = buildLevel(2, 777)
    const grid = level.pattern.grid
    const cells = createCanvas(grid)
    const start = compareCells(level.reference, cells, grid)
    expect(start.correct).toBe(level.reference.filter((v) => v === -1).length)
    expect(isSolved(start)).toBe(false)
    // 直接把画布抄成参考图：全对。
    const cloned = level.reference.slice()
    const done = compareCells(level.reference, cloned, grid)
    expect(done.wrong).toBe(0)
    expect(completionPct(done)).toBe(100)
    expect(isSolved(done)).toBe(true)
  })

  it('applyHint: 修正首个错格、重复用提示可解完、无错格返回 null', () => {
    const level = buildLevel(4, 99)
    const grid = level.pattern.grid
    const cells = createCanvas(grid)
    let fixed = applyHint(level.reference, cells, grid)
    expect(fixed).not.toBeNull()
    expect(cells[fixed!.y * grid + fixed!.x]).toBe(level.reference[fixed!.y * grid + fixed!.x]!)
    // 反向证明：把该格再涂错后，hint 修正的是当前首个（行优先）错格。
    cells[fixed!.y * grid + fixed!.x] = cells[fixed!.y * grid + fixed!.x] === 0 ? 1 : 0
    const firstWrong = compareCells(level.reference, cells, grid).wrongCells[0]!
    fixed = applyHint(level.reference, cells, grid)
    expect(fixed).toEqual(firstWrong)
    // 不断用提示直到解完。
    let guard = 0
    while (applyHint(level.reference, cells, grid) !== null && guard < 200) guard += 1
    expect(isSolved(compareCells(level.reference, cells, grid))).toBe(true)
    expect(applyHint(level.reference, cells, grid)).toBeNull()
  })

  it('computeScore: 关卡抬基线，步数与提示扣分，下限 100', () => {
    expect(computeScore(5, 0, 0)).toBe(870)
    expect(computeScore(1, 0, 0)).toBe(430)
    expect(computeScore(5, 10, 0)).toBe(830)
    expect(computeScore(5, 0, HINTS_PER_LEVEL)).toBe(780)
    expect(computeScore(1, 0, HINTS_PER_LEVEL)).toBe(340)
    expect(computeScore(1, 1000, 2)).toBe(100)
    // 单调性：步数越多分越低，提示越多分越低。
    expect(computeScore(3, 5, 0)).toBeGreaterThan(computeScore(3, 10, 0))
    expect(computeScore(3, 5, 0)).toBeGreaterThan(computeScore(3, 5, 1))
  })

  it('seed 重放：同一随机序列驱动的两局涂画过程与结果完全一致', () => {
    const play = (seed: number): { canvas: number[]; steps: number } => {
      const rng = mulberry32(seed)
      const level = buildLevel(3, 4242)
      const grid = level.pattern.grid
      const cells = createCanvas(grid)
      let steps = 0
      for (let i = 0; i < 60; i += 1) {
        const x = Math.floor(rng() * grid)
        const y = Math.floor(rng() * grid)
        const color = level.palette[Math.floor(rng() * level.palette.length)] ?? 0
        if (rng() < 0.2) {
          if (eraseCell(cells, grid, x, y)) steps += 1
        } else if (paintCell(cells, grid, x, y, color)) {
          steps += 1
        }
      }
      return { canvas: cells, steps }
    }
    const a = play(2024)
    const b = play(2024)
    expect(a).toEqual(b)
    const result = compareCells(buildLevel(3, 4242).reference, a.canvas, buildLevel(3, 4242).pattern.grid)
    expect(result.total).toBe(buildLevel(3, 4242).pattern.grid ** 2)
  })
})
