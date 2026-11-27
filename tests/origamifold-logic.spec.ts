import { describe, expect, it } from 'vitest'
import {
  LEVELS, LEVEL_COUNT, applyFold, centerTopColor, enumerateOutcomes, findWinningPath,
  foldGeometry, foldsTo1, generateLevel, listFolds, mulberry32, visibleColor,
  type FoldMove, type FoldState, type Stack,
} from '../src/client/games/origamifold/logic.ts'

/** 手工状态：给 cells/target 定制，专测折叠几何与胜负判定。 */
function handState(rows: number, cols: number, cells: Stack[][], target = 0): FoldState {
  return { level: 0, rows, cols, cells, target, folds: 0, optimalFolds: 0, score: 0, status: 'playing' }
}

/** 每行一色的网格（颜色按行给，方便手算）。 */
function rowColors(rows: number, cols: number, colors: number[]): Stack[][] {
  const cells: Stack[][] = []
  for (let r = 0; r < rows; r += 1) {
    const row: Stack[] = []
    for (let c = 0; c < cols; c += 1) row.push([colors[r]!])
    cells.push(row)
  }
  return cells
}

describe('origamifold logic', () => {
  it('mulberry32 is deterministic per seed and differs across seeds', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    const c = mulberry32(1235)
    expect(c()).not.toBe(a())
  })

  it('generateLevel: bounds, structure per level, deterministic replay', () => {
    expect(generateLevel(-1, 42)).toBeNull()
    expect(generateLevel(LEVEL_COUNT, 42)).toBeNull()
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const cfg = LEVELS[lv]!
      const s = generateLevel(lv, 42)!
      expect(s.rows).toBe(cfg.size)
      expect(s.cols).toBe(cfg.size)
      expect(s.status).toBe('playing')
      expect(s.folds).toBe(0)
      expect(s.score).toBe(0)
      expect(s.optimalFolds).toBe(foldsTo1(cfg.size) * 2)
      expect(s.target).toBeGreaterThanOrEqual(0)
      expect(s.target).toBeLessThan(cfg.colors)
      for (let r = 0; r < cfg.size; r += 1) {
        for (let c = 0; c < cfg.size; c += 1) {
          const stack = s.cells[r]![c]!
          expect(stack).toHaveLength(1)
          expect(stack[0]).toBeGreaterThanOrEqual(0)
          expect(stack[0]).toBeLessThan(cfg.colors)
        }
      }
    }
    // 同 seed 重放一致（盘面与目标色都一致）；异 seed 盘面不同。
    const s1 = generateLevel(2, 7)!
    const s2 = generateLevel(2, 7)!
    expect(s1.cells).toEqual(s2.cells)
    expect(s1.target).toBe(s2.target)
    const s3 = generateLevel(2, 999)!
    expect(s3.cells).not.toEqual(s1.cells)
  })

  it('every level is winnable across many seeds (budget verified, not assumed)', () => {
    // 提灯人事故教训：可赢性必须实测。12 个 seed × 5 关全部存在获胜
    // 路径，且逐步 applyFold 走完确实 status === 'won'。
    for (let seed = 1; seed <= 12; seed += 1) {
      for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
        const s = generateLevel(lv, seed * 31 + lv)!
        const path = findWinningPath(s)
        expect(path).not.toBeNull()
        let cur = s
        for (const move of path!) {
          const next = applyFold(cur, move)
          expect(next).not.toBeNull()
          cur = next!
        }
        expect(cur.status).toBe('won')
        expect(cur.rows).toBe(1)
        expect(cur.cols).toBe(1)
        expect(visibleColor(cur.cells)).toBe(s.target)
        expect(cur.score).toBe(100 * (lv + 1))
      }
    }
  })

  it('listFolds: exact half only; odd allows the two middle lines; edges and 1x1 rejected', () => {
    // 4：只有正中一条折线（两个翻折侧）。
    expect(listFolds(1, 4).filter((m) => m.axis === 'v')).toEqual([
      { axis: 'v', k: 2, side: 'a' },
      { axis: 'v', k: 2, side: 'b' },
    ])
    // 5：k=2 与 k=3（两侧差 1）；k=1/4 差 3 不可折。
    const ks5 = listFolds(1, 5).filter((m) => m.axis === 'v').map((m) => m.k)
    expect([...new Set(ks5)].sort()).toEqual([2, 3])
    // 3：k=1 与 k=2。
    const ks3 = listFolds(3, 1).filter((m) => m.axis === 'h').map((m) => m.k)
    expect([...new Set(ks3)].sort()).toEqual([1, 2])
    // 边界（一侧为 0）与远离中线的一律不可折。
    expect(foldGeometry(4, 0, 'a')).toBeNull()
    expect(foldGeometry(4, 4, 'b')).toBeNull()
    expect(foldGeometry(5, 1, 'a')).toBeNull()
    expect(foldGeometry(5, 4, 'b')).toBeNull()
    expect(foldGeometry(1, 1, 'a')).toBeNull()
    // 1×1 无折叠可走。
    expect(listFolds(1, 1)).toEqual([])
  })

  it('foldGeometry: even halves mirror exactly with zero extension', () => {
    const geo = foldGeometry(4, 2, 'b')!
    expect(geo.newSize).toBe(2)
    expect(geo.stationShift).toBe(0)
    // 翻折侧 j -> (n-1-j) + foldShift：3->0, 2->1。
    expect([3, 2].map((j) => 3 - j + geo.foldShift)).toEqual([0, 1])
    // 上侧翻折（side a）：不动侧 [k,n) 平移 -k。
    const geoA = foldGeometry(4, 2, 'a')!
    expect(geoA.newSize).toBe(2)
    expect([2, 3].map((j) => j + geoA.stationShift)).toEqual([0, 1])
    expect([0, 1].map((i) => 3 - i + geoA.foldShift)).toEqual([1, 0])
  })

  it('foldGeometry + applyFold: odd 3-column fold, the far cell extends into a new column', () => {
    // 3 列（左 1 右 2），右折左：邻折线的右列盖到左列上，远端右列伸出
    // 纸边成为新的一列（新尺寸 2）。
    const geo = foldGeometry(3, 1, 'b')!
    expect(geo.newSize).toBe(2)
    const s = handState(1, 3, [[[0], [1], [2]]], 2)
    const next = applyFold(s, { axis: 'v', k: 1, side: 'b' })!
    expect(next).not.toBeNull()
    expect(next.cols).toBe(2)
    expect(next.rows).toBe(1)
    // 新列 0 = 远端右列（伸出）；新列 1 = 左列在底 + 邻折线右列在上。
    expect(next.cells[0]![0]).toEqual([2])
    expect(next.cells[0]![1]).toEqual([0, 1])
    // 左折右（side a，左 1 折到右 2 上）：右侧保持，左列盖到右列首格。
    const s2 = handState(1, 3, [[[0], [1], [2]]], 2)
    const next2 = applyFold(s2, { axis: 'v', k: 1, side: 'a' })!
    expect(next2.cells[0]![0]).toEqual([1, 0])
    expect(next2.cells[0]![1]).toEqual([2])
  })

  it('applyFold: folded side lands on top, later folds stay on top; input state untouched', () => {
    // 2×2 全 0 色，左半折右：左列盖在右列上 -> 顶色不变但层数翻倍。
    const s = handState(2, 2, [
      [[0], [1]],
      [[0], [1]],
    ], 1)
    const snapshot = JSON.parse(JSON.stringify(s.cells)) as Stack[][]
    const next = applyFold(s, { axis: 'v', k: 1, side: 'a' })!
    expect(next.cols).toBe(1)
    expect(next.rows).toBe(2)
    // 每格：右列（不动）在底、左列（翻折）在上。
    expect(next.cells[0]![0]).toEqual([1, 0])
    expect(next.cells[1]![0]).toEqual([1, 0])
    // 纯函数：入参未被修改。
    expect(s.cells).toEqual(snapshot)
    expect(s.folds).toBe(0)
    // 再横折一次成 1×1：后折的一层在上（可见色 = 后折侧的颜色）。
    const final = applyFold(next, { axis: 'h', k: 1, side: 'b' })!
    expect(final.rows).toBe(1)
    expect(final.cols).toBe(1)
    expect(final.cells[0]![0]).toEqual([1, 0, 1, 0])
    expect(visibleColor(final.cells)).toBe(0)
  })

  it('the total fold count is invariant: every winning path has exactly optimalFolds folds', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
        const s = generateLevel(lv, seed * 97 + lv)!
        const path = findWinningPath(s)!
        expect(path).toHaveLength(s.optimalFolds)
      }
    }
    expect(foldsTo1(4)).toBe(2)
    expect(foldsTo1(5)).toBe(3)
    expect(foldsTo1(6)).toBe(3)
  })

  it('win and stuck detection with score accounting', () => {
    // 1×2 直接一折：side b（右折左）-> 右列在上，顶色 1。
    const s = handState(1, 2, [[[0], [1]]], 1)
    const won = applyFold(s, { axis: 'v', k: 1, side: 'b' })!
    expect(won.status).toBe('won')
    expect(won.score).toBe(100)
    // 目标 0 时同样一步折出顶色 1 -> 卡死（步数不限但无折叠可走）。
    const s2 = handState(1, 2, [[[0], [1]]], 0)
    const lost = applyFold(s2, { axis: 'v', k: 1, side: 'b' })!
    expect(lost.status).toBe('lost')
    expect(lost.score).toBe(0)
    // 已结束的对局不再接受折叠。
    expect(applyFold(won, { axis: 'h', k: 1, side: 'a' })).toBeNull()
    // 中心格顶色（HUD「当前」徽章）。
    expect(centerTopColor(lost)).toBe(1)
  })

  it('enumerateOutcomes counts every complete fold path and targets a reachable color', () => {
    // 2×2 双色棋盘：4 折全路径 2^4=16 条（每步 2 侧 × 定轴……实际由
    // 轴序决定），计数总和 = 全部完整路径数。
    const cells = [
      [[0], [1]],
      [[1], [0]],
    ]
    const outcomes = enumerateOutcomes(cells, 2, 2)
    const total = [...outcomes.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(0)
    // 每种结果都来自真实路径：逐一验证计数 = 路径数（2×2 路径有限）。
    const paths = countPathsByColor(cells)
    expect([...outcomes.entries()].sort()).toEqual([...paths.entries()].sort())
    // generateLevel 选的目标色必在可达集合里（最少路径者）。
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const s = generateLevel(lv, 555)!
      const outs = enumerateOutcomes(s.cells, s.rows, s.cols)
      expect(outs.get(s.target)).toBeGreaterThan(0)
    }
  })
})

/** 独立复算 2×2 全路径按终色分组（与 enumerateOutcomes 互为交叉验证）。 */
function countPathsByColor(cells: Stack[][]): Map<number, number> {
  const counts = new Map<number, number>()
  const dfs = (node: FoldState): void => {
    if (node.rows === 1 && node.cols === 1) {
      const top = visibleColor(node.cells)
      counts.set(top, (counts.get(top) ?? 0) + 1)
      return
    }
    for (const move of listFolds(node.rows, node.cols) as FoldMove[]) {
      const next = applyFold(node, move)
      if (next !== null) dfs(next)
    }
  }
  dfs({ level: 0, rows: 2, cols: 2, cells, target: -1, folds: 0, optimalFolds: 0, score: 0, status: 'playing' })
  return counts
}
