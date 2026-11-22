import { describe, expect, it } from 'vitest'
import {
  EMPTY, LEVEL_COUNT, MINUS, NEUTRAL, PLUS, applyClick, assignPolarity, computeScore,
  cycleMark, dominoesOf, dominoTiling, findConflictCells, hintCell, isWon, levelSize,
  mulberry32, orthNeighbors, overflowCells, puzzleFromSeed, samePoleConflicts, solveCount,
} from '../src/client/games/magnets/logic.ts'

describe('magnets logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('dominoTiling covers every cell with domino pairs or insulators', () => {
    const rng = mulberry32(7)
    for (const size of [6, 8, 10]) {
      const tiling = dominoTiling(rng, size, 0.12)
      expect(tiling.partner.length).toBe(size * size)
      for (let cell = 0; cell < size * size; cell += 1) {
        if (tiling.insulator[cell]) {
          expect(tiling.partner[cell]).toBe(-1)
        } else {
          const p = tiling.partner[cell]!
          expect(p).toBeGreaterThanOrEqual(0)
          expect(tiling.partner[p]).toBe(cell)
          expect(orthNeighbors(size, cell)).toContain(p)
        }
      }
    }
  })

  it('assignPolarity yields a same-pole-free layout over the whole tiling', () => {
    const rng = mulberry32(99)
    for (let i = 0; i < 5; i += 1) {
      const size = 6 + i
      const tiling = dominoTiling(rng, size, 0.12)
      const poles = assignPolarity(rng, size, tiling.partner)
      expect(poles).not.toBeNull()
      const pv = poles!
      for (let cell = 0; cell < size * size; cell += 1) {
        if (tiling.insulator[cell]) { expect(pv[cell]).toBe(0); continue }
        expect(pv[cell]).toBeGreaterThan(0)
        const partner = tiling.partner[cell]!
        expect((pv[cell] ?? -1) + (pv[partner] ?? -9)).toBe(3) // 一正一负
        for (const nb of orthNeighbors(size, cell)) {
          if (!tiling.insulator[nb] && nb !== partner) {
            expect(pv[nb] === pv[cell]).toBe(false)
          }
        }
      }
    }
  })

  it('every level generates a unique-solution puzzle with consistent clues', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const p = puzzleFromSeed((lv * 0x9e3779b9) >>> 0, levelSize(lv))
      expect(p).not.toBeNull()
      const puzzle = p!
      const r = solveCount(puzzle, 2)
      expect(r.solutions).toBe(1)
      expect(r.exhausted).toBe(true)
      // 提示与解布局逐行逐列一致。
      for (let i = 0; i < puzzle.size; i += 1) {
        expect(puzzle.rowPlus[i]).toBe(puzzle.solution.filter((v, c) => v === 1 && Math.floor(c / puzzle.size) === i).length)
        expect(puzzle.colMinus[i]).toBe(puzzle.solution.filter((v, c) => v === 2 && c % puzzle.size === i).length)
      }
    }
  })

  it('same seed replays identically; a different seed differs', () => {
    const a = puzzleFromSeed(12345, 7)
    const b = puzzleFromSeed(12345, 7)
    expect(a).toEqual(b)
    let differing = false
    for (let seed = 12346; seed < 12366 && !differing; seed += 1) {
      const c = puzzleFromSeed(seed, 7)
      differing = c === null || JSON.stringify(c) !== JSON.stringify(a)
    }
    expect(differing).toBe(true)
  })

  it('cycleMark walks 空→+→−→中性→空 and applyClick skips insulators', () => {
    expect(cycleMark(EMPTY)).toBe(PLUS)
    expect(cycleMark(PLUS)).toBe(MINUS)
    expect(cycleMark(MINUS)).toBe(NEUTRAL)
    expect(cycleMark(NEUTRAL)).toBe(EMPTY)
    const puzzle = puzzleFromSeed(5, 6)!
    const marks = new Array<number>(puzzle.size * puzzle.size).fill(0)
    const insulatorIdx = puzzle.insulator.findIndex(v => v)
    if (insulatorIdx >= 0) expect(applyClick(puzzle, marks, insulatorIdx)).toBeNull()
    const magnetIdx = puzzle.insulator.findIndex(v => !v)
    expect(applyClick(puzzle, marks, magnetIdx)).toBe(PLUS)
    expect(applyClick(puzzle, marks, magnetIdx)).toBe(MINUS)
    expect(applyClick(puzzle, marks, magnetIdx)).toBe(NEUTRAL)
    expect(applyClick(puzzle, marks, magnetIdx)).toBe(EMPTY)
  })

  it('isWon accepts the solution and rejects neutral gaps or count drift', () => {
    const puzzle = puzzleFromSeed((3 * 0x9e3779b9) >>> 0, levelSize(3))!
    const good = puzzle.solution.slice()
    expect(isWon(puzzle, good)).toBe(true)
    const firstMagnet = puzzle.insulator.findIndex(v => !v)
    const neutral = good.slice(); neutral[firstMagnet] = NEUTRAL
    expect(isWon(puzzle, neutral)).toBe(false)
    const swapped = good.slice(); swapped[firstMagnet] = swapped[firstMagnet] === PLUS ? MINUS : PLUS
    expect(isWon(puzzle, swapped)).toBe(false)
  })

  it('samePoleConflicts flags adjacent equals and clears on fix', () => {
    const puzzle = puzzleFromSeed(11, 6)!
    const dominoes = dominoesOf(puzzle.partner)
    const marks = new Array<number>(puzzle.size * puzzle.size).fill(0)
    // 找一条水平相邻但分属不同多米诺的两格，同置 + 必冲突。
    let a = -1; let b = -1
    outer: for (const [d1, d2] of dominoes) {
      for (const [e1, e2] of dominoes) {
        if (d1 === e1) continue
        if (orthNeighbors(puzzle.size, d1).includes(e1)) { a = d1; b = e1; break outer }
        if (orthNeighbors(puzzle.size, d2).includes(e2)) { a = d2; b = e2; break outer }
      }
    }
    expect(a).toBeGreaterThanOrEqual(0)
    marks[a] = PLUS; marks[b] = PLUS
    const conflicts = samePoleConflicts(puzzle, marks)
    expect(conflicts).toContain(a)
    expect(conflicts).toContain(b)
    marks[b] = MINUS
    expect(samePoleConflicts(puzzle, marks)).toEqual([])
  })

  it('overflow and conflict helpers flag over-counted rows', () => {
    const puzzle = puzzleFromSeed(13, 6)!
    const marks = new Array<number>(puzzle.size * puzzle.size).fill(0)
    const row0 = []
    for (let c = 0; c < puzzle.size; c += 1) {
      const cell = c
      if (!puzzle.insulator[cell]) row0.push(cell)
    }
    for (const cell of row0) marks[cell] = PLUS
    const over = overflowCells(puzzle, marks)
    expect(over.length).toBeGreaterThan(0)
    expect(findConflictCells(puzzle, marks).length).toBeGreaterThanOrEqual(over.length)
  })

  it('hintCell returns a mismatched magnet cell, -1 once solved', () => {
    const puzzle = puzzleFromSeed(17, 6)!
    const marks = new Array<number>(puzzle.size * puzzle.size).fill(0)
    const cell = hintCell(puzzle, marks)
    expect(cell).toBeGreaterThanOrEqual(0)
    expect(puzzle.insulator[cell]).toBeFalsy()
    expect(marks[cell]).not.toBe(puzzle.solution[cell])
    marks[cell] = puzzle.solution[cell]!
    let next = hintCell(puzzle, marks)
    while (next >= 0) { marks[next] = puzzle.solution[next]!; next = hintCell(puzzle, marks) }
    expect(hintCell(puzzle, marks)).toBe(-1)
    expect(isWon(puzzle, marks)).toBe(true)
  })

  it('computeScore decreases with time and hints and stays positive', () => {
    const fast = computeScore(3, 10, 0)
    expect(computeScore(3, 60, 0)).toBeLessThan(fast)
    expect(computeScore(3, 10, 2)).toBe(fast - 200)
    expect(computeScore(1, 9999, 2)).toBeGreaterThanOrEqual(100)
    expect(fast).toBeGreaterThan(0)
  })
})