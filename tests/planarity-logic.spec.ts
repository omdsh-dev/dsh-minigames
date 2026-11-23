import { describe, expect, it } from 'vitest'
import {
  BOARD, LEVEL_COUNT, LEVEL_VERTICES, W, H, levelVertices,
  countCrossings, createPlanarity, crossingEdgeSet, dragTo, endDrag, generatePlanarityLevel,
  mulberry32, nextLevel, segmentsCross, startDrag, tickTime, totalScore,
  type Edge, type Pt,
} from '../src/client/games/planarity/logic.ts'

describe('planarity logic', () => {
  it('mulberry32 同种子序列完全一致（seed 重放的基石）', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).toEqual(seqB)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('生成器确定：同 seed + 同关卡产出完全相同的盘面', () => {
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const s = (level + 1) * 0x9e3779b9
      const x = generatePlanarityLevel(s, level)
      const y = generatePlanarityLevel(s, level)
      expect(x.vertices).toEqual(y.vertices)
      expect(x.solution).toEqual(y.solution)
      expect(x.edges).toEqual(y.edges)
    }
  })

  it('理想布局（参考解）在每一关都无任何交叉——题目必有解', () => {
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      for (const seed of [7, 0x1234abcd, 999999999]) {
        const { solution, edges } = generatePlanarityLevel(seed, level)
        expect(countCrossings(solution, edges)).toBe(0)
        expect(crossingEdgeSet(solution, edges).size).toBe(0)
      }
    }
  })

  it('盘面结构合法：顶点数按关卡 6→10、边合法且不重复、顶点落在盘内', () => {
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const { vertices, edges } = generatePlanarityLevel(424242, level)
      expect(vertices).toHaveLength(LEVEL_VERTICES[level]!)
      expect(LEVEL_VERTICES[level]).toBe(6 + level)
      const seen = new Set<string>()
      expect(edges.length).toBeGreaterThanOrEqual(6 + 2)
      for (const e of edges) {
        // 外圈闭合边 (n-1 → 0) 的 a > b，只校验端点范围与无向去重。
        expect(Math.min(e.a, e.b)).toBeGreaterThanOrEqual(0)
        expect(Math.max(e.a, e.b)).toBeLessThan(vertices.length)
        seen.add(Math.min(e.a, e.b) + '-' + Math.max(e.a, e.b))
      }
      expect(seen.size).toBe(edges.length)
      for (const v of vertices) {
        expect(v.x).toBeGreaterThanOrEqual(BOARD.minX)
        expect(v.x).toBeLessThanOrEqual(BOARD.maxX)
        expect(v.y).toBeGreaterThanOrEqual(BOARD.minY)
        expect(v.y).toBeLessThanOrEqual(BOARD.maxY)
      }
    }
  })

  it('打乱后的开局缠成一团：至少一对交叉边，顶点间距可分辨', () => {
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const { vertices } = generatePlanarityLevel(80808, level)
      let minDist = Infinity
      for (let i = 0; i < vertices.length; i += 1) {
        for (let j = i + 1; j < vertices.length; j += 1) {
          minDist = Math.min(minDist, Math.hypot(vertices[i]!.x - vertices[j]!.x, vertices[i]!.y - vertices[j]!.y))
        }
      }
      expect(minDist).toBeGreaterThan(8)
    }
    // 开局必有交叉（大量种子验证，防个别种子退化）。
    for (let seed = 1; seed <= 30; seed += 1) {
      const { vertices, edges } = generatePlanarityLevel(seed * 7919, seed % LEVEL_COUNT)
      expect(countCrossings(vertices, edges)).toBeGreaterThan(0)
    }
  })

  it('线段相交判定：交叉 / 分离 / 共端点豁免 / T 触 / 共线重叠', () => {
    const p = (x: number, y: number): Pt => ({ x, y })
    expect(segmentsCross(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true)
    expect(segmentsCross(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false)
    // 共享端点：交叉几何上也判不交叉（规则核心）。
    expect(segmentsCross(p(0, 0), p(10, 10), p(0, 0), p(10, 0))).toBe(false)
    // T 触：端点落在另一线段内部。
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, 0), p(5, 8))).toBe(true)
    // 共线重叠。
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true)
    // 共线不相接。
    expect(segmentsCross(p(0, 0), p(4, 0), p(6, 0), p(10, 0))).toBe(false)
  })

  it('交叉计数只统计不共端点的边对，交叉边集合口径一致', () => {
    // 正方形外圈：凸四边形，自身零交叉。
    const square: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const ring: Edge[] = [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }]
    expect(countCrossings(square, ring)).toBe(0)
    // 加两条对角线（彼此严格相交于中心）+ 一条贯穿上下边的竖中线。
    // 竖线与外圈共端点豁免后只穿 0-1、2-3 两条边；对角线与外圈全部
    // 共端点豁免；竖线与两条对角线交于中心，对角线彼此也交于中心。
    const vs: Pt[] = [...square, { x: 50, y: -30 }, { x: 50, y: 130 }]
    const es: Edge[] = [...ring, { a: 4, b: 5 }, { a: 0, b: 2 }, { a: 1, b: 3 }]
    // 交叉对：竖线×上边、竖线×下边、竖线×两对角线、两对角线互交 = 5。
    expect(countCrossings(vs, es)).toBe(5)
    const bad = crossingEdgeSet(vs, es)
    expect([...bad].sort((x, y) => x - y)).toEqual([0, 2, 4, 5, 6])
  })

  it('拖拽与步数：一次拖拽计一步、微动不计、坐标钳制进盘面', () => {
    const st = createPlanarity(31337, 0)
    const v0 = { ...st.vertices[0]! }
    // 微动（< 0.5px）既不位移也不计步。
    startDrag(st, 0)
    dragTo(st, { x: v0.x + 0.2, y: v0.y })
    expect(st.moves).toBe(0)
    expect(st.vertices[0]).toEqual(v0)
    dragTo(st, { x: -500, y: -500 })
    expect(st.moves).toBe(1)
    expect(st.vertices[0]!.x).toBe(BOARD.minX)
    expect(st.vertices[0]!.y).toBe(BOARD.minY)
    // 同一次拖拽继续移动不再计步。
    dragTo(st, { x: W + 500, y: H + 500 })
    expect(st.moves).toBe(1)
    expect(st.vertices[0]!.x).toBe(BOARD.maxX)
    expect(st.vertices[0]!.y).toBe(BOARD.maxY)
    endDrag(st)
    expect(st.dragIndex).toBe(-1)
    // 未开始拖拽时 dragTo 无效果。
    dragTo(st, { x: 100, y: 100 })
    expect(st.moves).toBe(1)
    // 再拖一次另一个顶点：步数 +1。
    startDrag(st, 1)
    dragTo(st, { x: 120, y: 160 })
    expect(st.moves).toBe(2)
  })

  it('过关判定：摆成参考解即过关并结算正分，末关 allwon', () => {
    const st = createPlanarity(5150, 0)
    expect(st.phase).toBe('playing')
    // 直接把顶点摆到理想布局（拖拽路径模拟）。
    for (let i = 0; i < st.vertices.length; i += 1) {
      startDrag(st, i)
      dragTo(st, st.solution[i]!)
      endDrag(st)
    }
    expect(st.phase).toBe('won')
    expect(st.levelScore).toBeGreaterThan(0)
    // 已过关后继续拖动被冻结。
    startDrag(st, 0)
    dragTo(st, { x: 10, y: 10 })
    expect(st.vertices[0]).toEqual(st.solution[0])
    // 逐关推进到最后一关。
    let cur = st
    while (cur.levelIndex < LEVEL_COUNT - 1) cur = nextLevel(cur)
    expect(cur.bankedScore).toBeGreaterThan(0)
    for (let i = 0; i < cur.vertices.length; i += 1) {
      startDrag(cur, i)
      dragTo(cur, cur.solution[i]!)
      endDrag(cur)
    }
    // 无尽模式：过关恒 'won'，nextLevel 永远推进（levelIndex 无上限）。
    expect(cur.phase).toBe('won')
    expect(totalScore(cur)).toBe(cur.bankedScore + cur.levelScore)
    const nxt = nextLevel(cur)
    expect(nxt.levelIndex).toBe(cur.levelIndex + 1)
    // 无尽难度曲线：顶点数增长且封顶 14。
    expect(levelVertices(cur.levelIndex + 1)).toBeLessThanOrEqual(14)
    expect(levelVertices(50)).toBe(14)
  })

  it('nextLevel 派生新盘面：种子可重放、银行分结转、步数清零', () => {
    const st = createPlanarity(0xabcdef, 1)
    const initial = st.vertices.map(v => ({ ...v }))
    startDrag(st, 0)
    dragTo(st, { x: 200, y: 200 })
    expect(st.moves).toBe(1)
    const next = nextLevel(st)
    expect(next.levelIndex).toBe(2)
    expect(next.baseSeed).toBe(st.baseSeed)
    expect(next.moves).toBe(0)
    expect(next.timeMs).toBe(0)
    expect(next.vertices).toHaveLength(LEVEL_VERTICES[2]!)
    // 同 baseSeed 重放第 2 关完全一致（R 重开保证同盘）。
    const replay = createPlanarity(st.baseSeed, 2, next.bankedScore)
    expect(replay.vertices).toEqual(next.vertices)
    expect(replay.edges).toEqual(next.edges)
    // 重开当前关：同种子还原原始盘面（与拖动前的快照一致）。
    const redo = createPlanarity(st.baseSeed, st.levelIndex, st.bankedScore)
    expect(redo.vertices).toEqual(initial)
  })

  it('计时只在 playing 阶段累计且有上限', () => {
    const st = createPlanarity(777, 0)
    tickTime(st, 1000)
    expect(st.timeMs).toBe(1000)
    tickTime(st, -50) // 负帧间隔被丢弃
    expect(st.timeMs).toBe(1000)
    tickTime(st, 700000)
    expect(st.timeMs).toBe(600000)
    for (let i = 0; i < st.vertices.length; i += 1) {
      startDrag(st, i)
      dragTo(st, st.solution[i]!)
      endDrag(st)
    }
    expect(st.phase).toBe('won')
    const before = st.timeMs
    tickTime(st, 5000)
    expect(st.timeMs).toBe(before)
  })
})
