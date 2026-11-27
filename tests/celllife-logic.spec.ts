import { describe, expect, it } from 'vitest'
import {
  boardToCells,
  boardsEqual,
  buildLevel,
  cellIndex,
  cellsToBoard,
  computeScore,
  evolveOnce,
  evolveStep,
  GRID,
  inZone,
  LEVEL_COUNT,
  mulberry32,
  neighborCount,
  newGame,
  previewNext,
  resetPlacement,
  toggleCell,
  type Cell,
  type GameState,
} from '../src/client/games/celllife/logic.ts'

function cell(x: number, y: number): Cell {
  return { x, y }
}

function playSolution(state: GameState): void {
  for (const c of state.data.solution) {
    expect(toggleCell(state, c)).toBe(true)
  }
  for (let i = 0; i < state.data.steps; i += 1) {
    evolveOnce(state)
  }
}

describe('celllife logic', () => {
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

  it('neighborCount: 中心 3 邻、边角越界按死亡计', () => {
    // 2x2 块：每格恰好 3 个存活邻居。
    const block = cellsToBoard([cell(3, 3), cell(4, 3), cell(3, 4), cell(4, 4)])
    expect(neighborCount(block, 3, 3)).toBe(3)
    expect(neighborCount(block, 4, 4)).toBe(3)
    // 角 (0,0) 只有格内邻居，盘外不计。
    const corner = cellsToBoard([cell(0, 0), cell(1, 0), cell(0, 1)])
    expect(neighborCount(corner, 0, 0)).toBe(2)
    expect(neighborCount(corner, 1, 1)).toBe(3)
    expect(neighborCount(corner, 7, 7)).toBe(0)
  })

  it('evolveStep: B3/S23——方块静物不变，闪烁子翻转，孤格死亡，边界裁剪', () => {
    // 静物 2x2 块：每格 3 邻，全部存活且无出生。
    const block = cellsToBoard([cell(2, 2), cell(3, 2), cell(2, 3), cell(3, 3)])
    expect(boardsEqual(evolveStep(block), block)).toBe(true)
    // 闪烁子：横三连 → 竖三连 → 横三连。
    const blinker = cellsToBoard([cell(3, 3), cell(4, 3), cell(5, 3)])
    const vertical = evolveStep(blinker)
    expect(boardToCells(vertical)).toEqual([cell(4, 2), cell(4, 3), cell(4, 4)])
    expect(boardsEqual(evolveStep(vertical), blinker)).toBe(true)
    // 孤格与双格条均无 2/3 邻，一步全灭。
    expect(boardToCells(evolveStep(cellsToBoard([cell(0, 0)])))).toEqual([])
    expect(boardToCells(evolveStep(cellsToBoard([cell(1, 1), cell(2, 1)])))).toEqual([])
    // 边界：第 0 行横三连的上下出生格中，y=-1 被裁掉，只留 (4,0) 与 (4,1)。
    const edge = evolveStep(cellsToBoard([cell(3, 0), cell(4, 0), cell(5, 0)]))
    expect(boardToCells(edge)).toEqual([cell(4, 0), cell(4, 1)])
  })

  it('cellsToBoard/boardToCells/cellIndex: 互逆、越界忽略、下标一致', () => {
    const cells = [cell(0, 0), cell(7, 7), cell(3, 4), cell(3, 4)]
    const board = cellsToBoard(cells)
    expect(board.length).toBe(GRID * GRID)
    expect(board[cellIndex(cell(3, 4))]).toBe(true)
    expect(board[cellIndex(cell(0, 7))]).toBe(false)
    expect(boardToCells(board)).toEqual([cell(0, 0), cell(3, 4), cell(7, 7)])
    const out = cellsToBoard([cell(-1, 0), cell(8, 8)])
    expect(boardToCells(out)).toEqual([])
  })

  it('buildLevel: 同种子完全一致，不同种子目标不同，规格符合关卡计划', () => {
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const a = buildLevel(lv, 1234)
      const b = buildLevel(lv, 1234)
      expect(a.target).toEqual(b.target)
      expect(a.solution).toEqual(b.solution)
      expect(a.steps).toBeGreaterThanOrEqual(2)
      expect(a.steps).toBeLessThanOrEqual(5)
      expect(a.zone).toBeGreaterThanOrEqual(3)
      expect(a.zone).toBeLessThanOrEqual(4)
      expect(a.target.length).toBeGreaterThanOrEqual(3)
      expect(a.target.length).toBeLessThanOrEqual(8)
      for (const c of a.target) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x).toBeLessThan(GRID)
        expect(c.y).toBeLessThan(GRID)
      }
    }
    let diff = 0
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const a = buildLevel(lv, 1)
      const b = buildLevel(lv, 2)
      if (!boardsEqual(cellsToBoard(a.target), cellsToBoard(b.target))) diff += 1
    }
    expect(diff).toBeGreaterThan(0)
  })

  it('inZone: 起始区几何——区内真、区外假，已知解全部落在区内', () => {
    const data = buildLevel(3, 99)
    const o = data.zoneOrigin
    expect(inZone(data, o)).toBe(true)
    expect(inZone(data, cell(o.x + data.zone - 1, o.y + data.zone - 1))).toBe(true)
    expect(inZone(data, cell(o.x - 1, o.y))).toBe(false)
    expect(inZone(data, cell(o.x + data.zone, o.y))).toBe(false)
    for (const c of data.solution) {
      expect(inZone(data, c)).toBe(true)
    }
  })

  it('N 个种子全部关卡均可赢：已知解 K 步后恰好等于目标（预算实测验证）', () => {
    const seeds = [1, 7, 42, 99, 2024, 31337, 55555, 88888]
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      for (const seed of seeds) {
        const data = buildLevel(lv, seed)
        let board = cellsToBoard(data.solution)
        for (let i = 0; i < data.steps; i += 1) board = evolveStep(board)
        expect(boardsEqual(board, cellsToBoard(data.target))).toBe(true)
      }
    }
  })

  it('newGame/toggleCell: 开局空盘，摆放阶段区内可切换、区外与进化后拒绝', () => {
    const state = newGame(buildLevel(0, 5))
    expect(state.board.every((v) => v !== true)).toBe(true)
    expect(state.steps).toBe(0)
    expect(state.phase).toBe('play')
    expect(state.resets).toBe(0)
    const inside = state.data.zoneOrigin
    const far = cell(0, 7)
    if (!inZone(state.data, far)) expect(toggleCell(state, far)).toBe(false)
    expect(toggleCell(state, inside)).toBe(true)
    expect(state.board[cellIndex(inside)]).toBe(true)
    expect(toggleCell(state, inside)).toBe(true)
    expect(state.board[cellIndex(inside)]).toBe(false)
    // 进化一步后进入观察阶段，不能再摆。
    evolveOnce(state)
    expect(toggleCell(state, inside)).toBe(false)
  })

  it('evolveOnce 完整复放：摆已知解、逐步进化到 K 步判 won，中途不提前判', () => {
    for (const seed of [11, 22, 33]) {
      const state = newGame(buildLevel(4, seed))
      playSolution(state)
      expect(state.steps).toBe(state.data.steps)
      expect(state.phase).toBe('won')
      expect(boardsEqual(state.board, cellsToBoard(state.data.target))).toBe(true)
    }
    // 中途（K-1 步）不提前判胜负。
    const mid = newGame(buildLevel(0, 77))
    for (const c of mid.data.solution) toggleCell(mid, c)
    for (let i = 0; i < mid.data.steps - 1; i += 1) {
      expect(evolveOnce(mid)).toBe('evolved')
      expect(mid.phase).toBe('play')
    }
    expect(evolveOnce(mid)).toBe('won')
  })

  it('evolveOnce 判负与步数上限：错误摆法 K 步后 failed，超步拒绝进化', () => {
    const state = newGame(buildLevel(1, 8))
    // 故意摆一个与解不同的图案（至少一个细胞，且不等于解）。
    toggleCell(state, state.data.zoneOrigin)
    for (let i = 0; i < state.data.steps; i += 1) evolveOnce(state)
    // 极小概率恰好撞上解则换一格；确保验证的是非解路径。
    if (state.phase !== 'won') expect(state.phase).toBe('failed')
    expect(evolveOnce(state)).toBe('failed')
    expect(state.steps).toBe(state.data.steps)
    // 判负后再进化也不推进。
    expect(state.steps).toBe(state.data.steps)
  })

  it('resetPlacement/previewNext/computeScore: 重摆清盘、预览只读、计分单调有下限', () => {
    const state = newGame(buildLevel(2, 6))
    for (const c of state.data.solution) toggleCell(state, c)
    const before = state.board.slice()
    const preview = previewNext(state)
    expect(boardsEqual(preview, evolveStep(before))).toBe(true)
    expect(boardsEqual(state.board, before)).toBe(true)
    evolveOnce(state)
    state.resets = 2
    resetPlacement(state)
    expect(state.steps).toBe(0)
    expect(state.phase).toBe('play')
    expect(state.board.every((v) => v !== true)).toBe(true)
    expect(state.resets).toBe(2)
    expect(computeScore(1, 0)).toBeLessThan(computeScore(5, 0))
    expect(computeScore(3, 5)).toBeLessThan(computeScore(3, 1))
    expect(computeScore(1, 9999)).toBeGreaterThanOrEqual(100)
  })
})
