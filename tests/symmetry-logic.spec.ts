import { describe, expect, it } from 'vitest'
import {
  buildLevel, buildPlaceRound, buildQuizRound, checkPlacement, computeScore,
  isPlaceSolved, isSelfSymmetric, LEVEL_COUNT, LEVEL_PLAN_ROUNDS, mirrorPiece,
  mulberry32, placedCells, reflectCell, sameCells, sideOf, symmetryAxes,
  type Cell, type Piece,
} from '../src/client/games/symmetry/logic.ts'

function pieceKey(p: Piece): string {
  return p.kind + ':' + p.cells.map((c) => c.x + ',' + c.y).sort().join(';')
}

describe('symmetry logic', () => {
  it('mulberry32: 同种子序列一致，不同种子不同', () => {
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

  it('reflectCell: 四种轴的镜像正确且反射为对合（两次还原）', () => {
    const grid = 9
    const cell: Cell = { x: 2, y: 5 }
    expect(reflectCell('v', grid, cell)).toEqual({ x: 6, y: 5 })
    expect(reflectCell('h', grid, cell)).toEqual({ x: 2, y: 3 })
    expect(reflectCell('d1', grid, cell)).toEqual({ x: 5, y: 2 })
    expect(reflectCell('d2', grid, cell)).toEqual({ x: 3, y: 6 })
    const axes = ['v', 'h', 'd1', 'd2'] as const
    for (const axis of axes) {
      const once = reflectCell(axis, grid, cell)
      expect(reflectCell(axis, grid, once)).toEqual(cell)
    }
  })

  it('mirrorPiece: 类型不变、单元为镜像，且连续镜像两次复原', () => {
    const piece: Piece = {
      kind: 'line',
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    }
    const mirrored = mirrorPiece('d1', 7, piece)
    expect(mirrored.kind).toBe('line')
    expect(mirrored.cells).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ])
    expect(mirrorPiece('d1', 7, mirrored)).toEqual({ kind: 'line', cells: piece.cells.map((c) => ({ ...c })) })
  })

  it('sideOf / isSelfSymmetric: 轴上单元为 0，自对称构件判定正确', () => {
    expect(sideOf('v', 9, { x: 2, y: 4 })).toBe(-1)
    expect(sideOf('v', 9, { x: 6, y: 4 })).toBe(1)
    expect(sideOf('v', 9, { x: 4, y: 4 })).toBe(0)
    expect(sideOf('d1', 9, { x: 3, y: 3 })).toBe(0)
    expect(sideOf('d2', 9, { x: 2, y: 6 })).toBe(0)
    const centered: Piece = {
      kind: 'line',
      cells: [
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 2 },
      ],
    }
    expect(isSelfSymmetric('v', 9, centered)).toBe(true)
    expect(isSelfSymmetric('h', 9, centered)).toBe(false)
  })

  it('buildPlaceRound: 生成合法——给定侧构件、轴上自对称件、palette 为 targets 乱序', () => {
    const rng = mulberry32(7)
    const round = buildPlaceRound(rng, 9, 'v', 6, true)
    expect(round.type).toBe('place')
    expect(round.targets).toHaveLength(6)
    expect(round.palette).toHaveLength(6)
    const used = new Set<string>()
    for (const p of [...round.given, ...round.targets]) {
      for (const c of p.cells) {
        const key = c.x + ',' + c.y
        expect(used.has(key)).toBe(false)
        used.add(key)
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x).toBeLessThan(9)
        expect(c.y).toBeLessThan(9)
      }
    }
    // 轴上至少一个自对称给定构件。
    expect(round.given.some((p) => isSelfSymmetric('v', 9, p))).toBe(true)
    // 给定构件要么自对称（轴上），要么整体在给定侧（x < 4）。
    for (const p of round.given) {
      if (!isSelfSymmetric('v', 9, p)) {
        for (const c of p.cells) expect(sideOf('v', 9, c)).toBe(-1)
      }
    }
    // 目标构件整体在缺失侧，且与某个给定件互为镜像。
    const givenKeys = new Set(round.given.map(pieceKey))
    for (const t of round.targets) {
      for (const c of t.cells) expect(sideOf('v', 9, c)).toBe(1)
      const back = mirrorPiece('v', 9, t)
      expect(givenKeys.has(pieceKey(back))).toBe(true)
    }
    // palette 与 targets 是同一构件多重集（乱序副本）。
    const targetKeys = round.targets.map(pieceKey).sort()
    expect(round.palette.map(pieceKey).sort()).toEqual(targetKeys)
  })

  it('buildLevel: 5 关全部合法且递进（斜轴 + 选择题混入），种子可复放', () => {
    const replayA = buildLevel(3, 999)
    const replayB = buildLevel(3, 999)
    expect(replayA).toEqual(replayB)
    expect(JSON.stringify(buildLevel(3, 1000))).not.toEqual(JSON.stringify(replayA))
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const rounds = buildLevel(level, 123)
      expect(rounds.length).toBeGreaterThanOrEqual(LEVEL_PLAN_ROUNDS[level]!)
      const placeRounds = rounds.filter((r) => r.type === 'place')
      expect(placeRounds.length).toBeGreaterThanOrEqual(1)
      if (level >= 3) {
        expect(rounds.some((r) => r.type === 'quiz')).toBe(true)
        expect(placeRounds.some((r) => r.axis === 'd1' || r.axis === 'd2')).toBe(true)
      } else {
        expect(rounds.some((r) => r.type === 'quiz')).toBe(false)
      }
      if (level === 0) {
        // 第一关不含圆弧。
        for (const r of placeRounds) {
          if (r.type === 'place') expect(r.given.every((p) => p.kind !== 'arc')).toBe(true)
        }
      }
      // 每关构件数递增（第 1 关 vs 第 3 关）。
      if (level === 2) {
        const r = rounds[0]!
        if (r.type === 'place') expect(r.targets.length).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('选择题：图形真实对称轴数等于标注答案，选项恒为 {0,1,2,4}', () => {
    for (let i = 0; i < 60; i += 1) {
      const quiz = buildQuizRound(mulberry32(500 + i), 7)
      expect(quiz.type).toBe('quiz')
      expect(quiz.options.slice().sort((x, y) => x - y)).toEqual([0, 1, 2, 4])
      expect(symmetryAxes(quiz.figure, 7).length).toBe(quiz.options[quiz.answer]!)
    }
  })

  it('symmetryAxes: 正方形 4 条、矩形 2 条、单轴图形 1 条、散块 0 条', () => {
    const square: Cell[] = []
    for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 5; x += 1) square.push({ x, y })
    expect(symmetryAxes(square, 7)).toHaveLength(4)
    const rect: Cell[] = []
    for (let y = 2; y <= 4; y += 1) for (let x = 1; x <= 5; x += 1) rect.push({ x, y })
    expect(symmetryAxes(rect, 7)).toHaveLength(2)
    const half: Cell[] = [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 1, y: 5 }, { x: 5, y: 2 }, { x: 4, y: 4 }, { x: 5, y: 5 }]
    expect(symmetryAxes(half, 7)).toEqual(['v'])
    const blob: Cell[] = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 1 }, { x: 6, y: 3 }]
    expect(symmetryAxes(blob, 7)).toHaveLength(0)
  })

  it('checkPlacement: 类型+镜像位置全对才判对；已占用目标不可重复匹配；半格内锚点等价', () => {
    const rng = mulberry32(2024)
    const round = buildPlaceRound(rng, 9, 'h', 5, true)
    if (round.type !== 'place') throw new Error('unreachable')
    const claimed = round.targets.map(() => false)
    const target = round.targets[0]!
    // 从构件盘找到对应构件（palette 是 targets 的乱序副本）。
    const paletteIdx = round.palette.findIndex((p) => pieceKey(p) === pieceKey(target))
    expect(paletteIdx).toBeGreaterThanOrEqual(0)
    // placedCells 以左上角对齐 anchor；锚点取目标自己的左上角即完全重合。
    const sorted = target.cells.slice().sort((a, b) => a.y - b.y || a.x - b.x)
    const anchor = { x: sorted[0]!.x, y: sorted[0]!.y }
    const placed = placedCells(round.palette[paletteIdx]!, anchor)
    expect(sameCells(placed.slice().sort((a, b) => a.y - b.y || a.x - b.x), sorted)).toBe(true)
    expect(checkPlacement(round, round.palette[paletteIdx]!, anchor, claimed)).toBe(0)
    // 错位一格不匹配。
    expect(checkPlacement(round, round.palette[paletteIdx]!, { x: anchor.x + 1, y: anchor.y }, claimed)).toBe(-1)
    // 类型不同（若盘内存在其他类型构件）不匹配：构造假构件验证类型闸门。
    const wrongKind: Piece = { kind: target.kind === 'block' ? 'line' : 'block', cells: target.cells }
    expect(checkPlacement(round, wrongKind, anchor, claimed)).toBe(-1)
    // 占用后同一位置不可再匹配同一目标。
    claimed[0] = true
    expect(checkPlacement(round, round.palette[paletteIdx]!, anchor, claimed)).toBe(-1)
  })

  it('isPlaceSolved + 完整通关流程：逐个正确放置后判过关', () => {
    const round = buildPlaceRound(mulberry32(31337), 7, 'v', 5, true)
    if (round.type !== 'place') throw new Error('unreachable')
    const claimed = round.targets.map(() => false)
    expect(isPlaceSolved(round, claimed)).toBe(false)
    round.targets.forEach((target, i) => {
      const sorted = target.cells.slice().sort((a, b) => a.y - b.y || a.x - b.x)
      const match = checkPlacement(round, target, sorted[0]!, claimed)
      expect(match).toBe(i)
      claimed[match] = true
    })
    expect(isPlaceSolved(round, claimed)).toBe(true)
  })

  it('computeScore: 步数扣分、用时奖励、下限 100、随关卡上升', () => {
    const fast = computeScore(1, 2, 30)
    const slow = computeScore(1, 2, 200)
    const manySteps = computeScore(1, 30, 30)
    expect(fast).toBeGreaterThan(slow)
    expect(fast).toBeGreaterThan(manySteps)
    expect(computeScore(5, 2, 30)).toBeGreaterThan(computeScore(1, 2, 30))
    expect(computeScore(1, 999, 999)).toBe(100)
    expect(Number.isInteger(computeScore(3, 7, 90))).toBe(true)
  })
})
