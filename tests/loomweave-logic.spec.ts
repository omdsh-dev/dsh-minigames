import { describe, expect, it } from 'vitest'
import {
  bestRow,
  buildLevel,
  clothColors,
  computeError,
  computeScore,
  isOver,
  LEVEL_COUNT,
  LEVEL_SPECS,
  mulberry32,
  newGame,
  resetLevel,
  rowColors,
  rowError,
  undoRow,
  weaveRow,
  type LevelData,
  type RowChoice,
} from '../src/client/games/loomweave/logic.ts'

/** 手工构造的小关卡：warp [0,1,0,1]，目标全 0（最优误差 1/行）。 */
function handMadeData(): LevelData {
  return {
    index: 0,
    cols: 4,
    rows: 3,
    colors: 2,
    tolerance: 0,
    warp: [0, 1, 0, 1],
    target: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    solution: [
      { color: 0, offset: 0 },
      { color: 0, offset: 0 },
      { color: 0, offset: 0 },
    ],
  }
}

/** 贪心通关：逐行取 bestRow 织满。 */
function greedyWeave(state: ReturnType<typeof newGame>): void {
  for (let r = 0; r < state.data.rows; r += 1) {
    weaveRow(state, bestRow(state.data, r))
  }
}

describe('loomweave logic', () => {
  it('isOver：基序列「压压沉沉」按偏移循环移位，列号超周期取模', () => {
    // 偏移 0：列 0,1 压；列 2,3 沉；周期 4 续到列 4,5 压……
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(j => isOver(j, 0))).toEqual(
      [true, true, false, false, true, true, false, false],
    )
    // 偏移 1：整体右移一格——列 0 沉（取 (0-1) mod 4 = 3 的基值）。
    expect([0, 1, 2, 3].map(j => isOver(j, 1))).toEqual([false, true, true, false])
    expect([0, 1, 2, 3].map(j => isOver(j, 2))).toEqual([false, false, true, true])
    expect([0, 1, 2, 3].map(j => isOver(j, 3))).toEqual([true, false, false, true])
    // 移位满周期回到自身。
    expect(isOver(7, 0)).toBe(isOver(7, 4))
  })

  it('rowColors：over 列给纬色、under 列给该列经色', () => {
    const data = handMadeData()
    const choice: RowChoice = { color: 1, offset: 0 }
    // 偏移 0：over 在列 0,1 → 纬色 1；under 在列 2,3 → 经色 0,1。
    expect(rowColors(data, choice)).toEqual([1, 1, 0, 1])
    // 偏移 2：over 在列 2,3 → 纬色 1；under 在列 0,1 → 经色 0,1。
    expect(rowColors(data, { color: 1, offset: 2 })).toEqual([0, 1, 1, 1])
    expect(rowColors(data, choice).length).toBe(data.cols)
  })

  it('buildLevel：同种子完全一致、规格合规、目标必可织出（解误差 0）', () => {
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const a = buildLevel(lv, 1234)
      const b = buildLevel(lv, 1234)
      expect(a).toEqual(b)
      const spec = LEVEL_SPECS[lv]!
      expect(a.cols).toBe(spec.cols)
      expect(a.rows).toBe(spec.rows)
      expect(a.colors).toBe(spec.colors)
      expect(a.tolerance).toBe(spec.tolerance)
      expect(a.warp.length).toBe(spec.cols)
      // 均衡经线：每色至少一列。
      for (let c = 0; c < spec.colors; c += 1) expect(a.warp).toContain(c)
      // 生成解织出的行就是目标行（构造可行）。
      for (let r = 0; r < spec.rows; r += 1) {
        expect(rowColors(a, a.solution[r]!)).toEqual(a.target[r]!)
        expect(rowError(a, r, a.solution[r]!)).toBe(0)
      }
    }
    // 不同种子给出不同题面（warp 或 target 至少一处不同）。
    let differ = 0
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const x = buildLevel(lv, 1)
      const y = buildLevel(lv, 2)
      if (!x.target.every((row, r) => row.every((v, c) => v === y.target[r]![c])) ||
          !x.warp.every((v, c) => v === y.warp[c])) differ += 1
    }
    expect(differ).toBeGreaterThan(0)
  })

  it('bestRow：贪心穷举取最小误差，含并列取色小偏移小的确定性', () => {
    const data = handMadeData()
    const best = bestRow(data, 0)
    // 手工核算：全 0 目标最优是误差 1（见 handMadeData 注释）。
    expect(rowError(data, 0, best)).toBe(1)
    expect(best).toEqual({ color: 0, offset: 0 })
    // 对随机关卡：生成解存在 → 每行贪心误差必为 0。
    for (let seed = 1; seed <= 20; seed += 1) {
      const data2 = buildLevel(4, seed)
      for (let r = 0; r < data2.rows; r += 1) {
        expect(rowError(data2, r, bestRow(data2, r))).toBe(0)
      }
    }
  })

  it('weaveRow：逐行推进，织满按容差判 won/failed，非法织入被拒', () => {
    const data = buildLevel(0, 77)
    const state = newGame(data)
    expect(state.phase).toBe('play')
    for (let r = 0; r < data.rows - 1; r += 1) {
      expect(weaveRow(state, data.solution[r]!)).toBe('woven')
      expect(state.phase).toBe('play')
    }
    expect(weaveRow(state, data.solution[data.rows - 1]!)).toBe('won')
    expect(computeError(state)).toBe(0)
    // won 后再织 / 空局外操作被拒。
    expect(weaveRow(state, { color: 0, offset: 0 })).toBe('rejected')

    // 手工关（容差 0、不可完美）：贪心织满必 failed。
    const hard = newGame(handMadeData())
    greedyWeave(hard)
    expect(hard.phase).toBe('failed')
    expect(computeError(hard)).toBe(3)
  })

  it('undoRow：拆除返回 play、计数；won 不可拆、空局不可拆', () => {
    const data = buildLevel(1, 5)
    const state = newGame(data)
    expect(undoRow(state)).toBe(false)
    weaveRow(state, data.solution[0]!)
    weaveRow(state, data.solution[1]!)
    expect(undoRow(state)).toBe(true)
    expect(state.woven.length).toBe(1)
    expect(state.undos).toBe(1)
    expect(state.phase).toBe('play')
    // failed 后拆线回到 play 可改织。
    const hard = newGame(handMadeData())
    greedyWeave(hard)
    expect(hard.phase).toBe('failed')
    expect(undoRow(hard)).toBe(true)
    expect(hard.phase).toBe('play')
    // won 不可拆。
    const wonState = newGame(buildLevel(0, 77))
    for (const choice of wonState.data.solution) weaveRow(wonState, choice)
    expect(wonState.phase).toBe('won')
    expect(undoRow(wonState)).toBe(false)
  })

  it('clothColors / computeError：已织部分逐行合成与误差累计', () => {
    const data = buildLevel(2, 9)
    const state = newGame(data)
    expect(clothColors(state)).toEqual([])
    expect(computeError(state)).toBe(0)
    weaveRow(state, data.solution[0]!)
    expect(clothColors(state)).toEqual([rowColors(data, data.solution[0]!)])
    expect(computeError(state)).toBe(0)
    // 织一行错误选择（色 +1 取模）后误差为该行错格数。
    const wrong: RowChoice = {
      color: (data.solution[1]!.color + 1) % data.colors,
      offset: data.solution[1]!.offset,
    }
    weaveRow(state, wrong)
    expect(computeError(state)).toBe(rowError(data, 1, wrong))
    expect(computeError(state)).toBeGreaterThan(0)
  })

  it('resetLevel：清空已织行回 play，拆线计数保留', () => {
    const data = buildLevel(3, 11)
    const state = newGame(data)
    weaveRow(state, data.solution[0]!)
    undoRow(state)
    weaveRow(state, data.solution[0]!)
    weaveRow(state, data.solution[1]!)
    resetLevel(state)
    expect(state.woven).toEqual([])
    expect(state.phase).toBe('play')
    expect(state.undos).toBe(1)
  })

  it('mulberry32 确定性 + seed 重放：同种子逐操作轨迹完全一致', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 20 }, () => a())
    expect(seqA).toEqual(Array.from({ length: 20 }, () => b()))
    expect(seqA).not.toEqual(Array.from({ length: 20 }, () => mulberry32(43)()))
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const run = (): string[] => {
      const state = newGame(buildLevel(4, 2026))
      const trace: string[] = []
      for (let r = 0; r < state.data.rows; r += 1) {
        const choice = r % 2 === 0 ? bestRow(state.data, r) : state.data.solution[r]!
        trace.push(weaveRow(state, choice))
        trace.push(String(computeError(state)))
      }
      if (state.phase !== 'won') undoRow(state)
      trace.push(state.phase)
      trace.push(JSON.stringify(state.woven))
      return trace
    }
    expect(run()).toEqual(run())
  })

  it('40 seeds × 全 5 关：贪心解全部可赢（预算实测——容差恒可达）', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
        const data = buildLevel(lv, seed * 31 + 7)
        const state = newGame(data)
        greedyWeave(state)
        expect(state.phase).toBe('won')
        expect(computeError(state)).toBeLessThanOrEqual(data.tolerance)
      }
    }
  })

  it('computeScore：关卡递增加分，误差/拆线递减，下限 50', () => {
    expect(computeScore(0, 0, 0)).toBe(300)
    expect(computeScore(4, 0, 0)).toBe(900)
    expect(computeScore(2, 3, 2)).toBeLessThan(computeScore(2, 0, 0))
    expect(computeScore(1, 0, 3)).toBeLessThan(computeScore(1, 0, 0))
    expect(computeScore(0, 100, 100)).toBe(50)
  })
})
