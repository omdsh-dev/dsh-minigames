/**
 * 云中播种 CloudSeeds 纯逻辑测试：确定性随机、盘面生成与可解性、风矢量
 * 传播积分、云层变速、山/出界损失、3×3 浇灌、种子预算与判负、贪心自动
 * 通关、重放一致性与计分。
 */
import { describe, expect, it } from 'vitest'
import {
  CELL_CLOUD_FAST,
  CELL_CLOUD_SLOW,
  CELL_FIELD,
  CELL_MOUNTAIN,
  LEVEL_COUNT,
  computeScore,
  countFields,
  findWaterableLaunch,
  hasLost,
  irrigate,
  isWon,
  levelFromSeed,
  mulberry32,
  simulate,
  solveSeeds,
  type CloudSeedsLevel,
} from '../src/client/games/cloudseeds/logic.ts'

/** 字符画构盘：. 天空、> 加速云、< 减速云、^ 山、F 田地。 */
function makeLevel(rows: string[], dx: number, dy: number, flight: number): CloudSeedsLevel {
  const cols = rows[0]!.length
  const cells = new Uint8Array(cols * rows.length)
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c += 1) {
      const ch = row[c]
      cells[r * cols + c] = ch === '>' ? CELL_CLOUD_FAST
        : ch === '<' ? CELL_CLOUD_SLOW
        : ch === '^' ? CELL_MOUNTAIN
        : ch === 'F' ? CELL_FIELD
        : 0
    }
  })
  return { level: 0, cols, rows: rows.length, cells, wind: { dx, dy }, flight, seeds: 9, seed: 1 }
}

describe('cloudseeds logic', () => {
  it('mulberry32 同 seed 重放一致，异 seed 序列不同', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual([c(), c(), c(), c()])
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('五关盘面全部生成成功且含田/云/山，同 seed 重放一致', () => {
    for (let i = 0; i < LEVEL_COUNT; i += 1) {
      const level = levelFromSeed(20261126, i)
      expect(level).not.toBeNull()
      const lvl = level!
      const replay = levelFromSeed(20261126, i)!
      expect([...replay.cells]).toEqual([...lvl.cells])
      expect(replay.wind).toEqual(lvl.wind)
      expect(countFields(lvl)).toBeGreaterThan(0)
      expect(lvl.cells.some(k => k === CELL_MOUNTAIN)).toBe(true)
      expect(lvl.cells.some(k => k === CELL_CLOUD_FAST || k === CELL_CLOUD_SLOW)).toBe(true)
      expect(lvl.seeds).toBeGreaterThan(0)
    }
  })

  it('每块田都可被浇灌，且贪心解不超过种子预算', () => {
    for (let i = 0; i < LEVEL_COUNT; i += 1) {
      const lvl = levelFromSeed(777, i)!
      for (let cell = 0; cell < lvl.cells.length; cell += 1) {
        if (lvl.cells[cell] === CELL_FIELD) {
          expect(findWaterableLaunch(lvl, cell)).toBeGreaterThanOrEqual(0)
        }
      }
      const solution = solveSeeds(lvl)
      expect(solution.length).toBeGreaterThan(0)
      expect(solution.length).toBeLessThanOrEqual(lvl.seeds)
    }
  })

  it('恒定东风逐格传播：flight=3 恰好落在 3 格之外', () => {
    const lvl = makeLevel(['.............'], 1, 0, 3)
    const flight = simulate(lvl, 5)
    expect(flight.outcome).toBe('landed')
    expect(flight.landing).toBe(8)
    expect(flight.path).toEqual([5, 6, 7, 8])
    expect(flight.spent).toBe(3)
  })

  it('云层变速：加速云让种子落得更近，减速云落得更远', () => {
    const plain = simulate(makeLevel(['.............'], 1, 0, 3), 5)
    const fast = simulate(makeLevel(['......>>.....'], 1, 0, 3), 5)
    const slow = simulate(makeLevel(['......<<<....'], 1, 0, 3), 5)
    expect(plain.landing).toBe(8)
    expect(fast.landing).toBe(7)
    expect(slow.landing).toBe(10)
  })

  it('撞山与出界都是损失', () => {
    const mountain = simulate(makeLevel(['........^....'], 1, 0, 3), 5)
    expect(mountain.outcome).toBe('mountain')
    expect(mountain.landing).toBe(-1)
    const west = makeLevel(['.............'], -1, 0, 3)
    expect(simulate(west, 0).outcome).toBe('out')
    const east = makeLevel(['.............'], 1, 0, 99)
    expect(simulate(east, 12).outcome).toBe('out')
  })

  it('落点 3×3 浇灌：只浇田地且不重复计数', () => {
    const lvl = makeLevel([
      '....FFF..',
      '....F.F..',
      '....FFF..',
    ], 1, 0, 1)
    const watered = new Uint8Array(lvl.cells.length)
    expect(irrigate(lvl, watered, 14)).toBe(8)
    expect(irrigate(lvl, watered, 14)).toBe(0)
    expect([...watered].filter(v => v === 1)).toHaveLength(8)
    // 落在非田格上同样能浇到 3×3 内的田。
    const far = makeLevel(['F.........'], 1, 0, 1)
    const w2 = new Uint8Array(far.cells.length)
    expect(irrigate(far, w2, 1)).toBe(1)
  })

  it('种子预算与判负判定', () => {
    const lvl = makeLevel(['FF...FF...'], 1, 0, 1)
    const watered = new Uint8Array(lvl.cells.length)
    expect(hasLost(lvl, 0, watered)).toBe(true)
    expect(hasLost(lvl, 1, watered)).toBe(false)
    irrigate(lvl, watered, 1)
    irrigate(lvl, watered, 6)
    expect(isWon(lvl, watered)).toBe(true)
    expect(hasLost(lvl, 0, watered)).toBe(false)
  })

  it('贪心自动通关：按 solveSeeds 逐颗播种后全部田地浇灌', () => {
    for (const i of [0, 1, 2]) {
      const lvl = levelFromSeed(314159, i)!
      const watered = new Uint8Array(lvl.cells.length)
      for (const launch of solveSeeds(lvl)) {
        const flight = simulate(lvl, launch)
        expect(flight.outcome).toBe('landed')
        irrigate(lvl, watered, flight.landing)
      }
      expect(isWon(lvl, watered)).toBe(true)
    }
  })

  it('模拟确定性重放：同输入两次结果完全一致', () => {
    const lvl = levelFromSeed(12345, 3)!
    for (let launch = 0; launch < lvl.cells.length; launch += 7) {
      const a = simulate(lvl, launch)
      const b = simulate(lvl, launch)
      expect(b).toEqual(a)
    }
  })

  it('计分随关卡/剩余种子递增，时间惩罚有下限', () => {
    expect(computeScore(1, 0, 0)).toBeGreaterThan(computeScore(0, 0, 0))
    expect(computeScore(0, 3, 0)).toBeGreaterThan(computeScore(0, 0, 0))
    expect(computeScore(0, 0, 500)).toBe(600)
  })
})

