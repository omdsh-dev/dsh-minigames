import { describe, expect, it } from 'vitest'
import {
  attemptCap, computeScore, isWon, levelSize, mulberry32, patternOk,
  puzzleFromSeed, solveCount,
} from '../src/client/games/kakuro/logic.ts'

describe('kakuro logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('patternOk rejects single-cell white runs', () => {
    const allBlack = [[true, true, true], [true, true, true], [true, true, true]]
    expect(patternOk(3, allBlack)).toBe(true)
    const oneWhite = [[true, true, true], [true, false, true], [true, true, true]]
    expect(patternOk(3, oneWhite)).toBe(false)
  })

  it('every level size generates a puzzle whose own fill wins', () => {
    for (let lv = 1; lv <= 5; lv += 1) {
      const p = puzzleFromSeed(lv * 0x9e3779b9, levelSize(lv))
      expect(p).not.toBeNull()
      const puzzle = p!
      expect(puzzle.size).toBe(levelSize(lv))
      expect(isWon(puzzle, puzzle.solution)).toBe(true)
    }
  })

  it('isWon rejects a zeroed white cell and an empty grid', () => {
    const p = puzzleFromSeed(1 * 0x9e3779b9, levelSize(1))!
    const bad = p.solution.map(row => [...row])
    outer: for (let r = 0; r < p.size; r += 1) {
      for (let c = 0; c < p.size; c += 1) {
        if (!p.black[r]![c]) { bad[r]![c] = 0; break outer }
      }
    }
    expect(isWon(p, bad)).toBe(false)
    const empty = Array.from({ length: p.size }, () => new Array<number>(p.size).fill(0))
    expect(isWon(p, empty)).toBe(false)
  })

  it('a generated puzzle has at least one solution', () => {
    const p = puzzleFromSeed(2 * 0x9e3779b9, levelSize(2))!
    const r = solveCount(p, 120_000)
    expect(r.solutions).toBeGreaterThanOrEqual(1)
  })

  it('computeScore decays the time bonus to the base score', () => {
    expect(computeScore(1, 0)).toBe(3100)
    expect(computeScore(1, 10_000)).toBe(100)
  })

  it('attemptCap returns 20 for a size-6 board', () => {
    expect(attemptCap(6)).toBe(20)
  })

  it('puzzleFromSeed is deterministic for the same seed', () => {
    const seed = 4 * 0x9e3779b9
    expect(puzzleFromSeed(seed, levelSize(4))).toEqual(puzzleFromSeed(seed, levelSize(4)))
  })
})
