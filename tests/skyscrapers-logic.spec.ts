import { describe, expect, it } from 'vitest'
import {
  computeScore, isLatin, isWon, levelSize, mulberry32, puzzleFromSeed,
  solveCount, visibleCount,
} from '../src/client/games/skyscrapers/logic.ts'

describe('skyscrapers logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('visibleCount counts strictly increasing maxima', () => {
    expect(visibleCount([2, 1, 2])).toBe(1) // equal-to-max is not visible
    expect(visibleCount([1, 2, 3])).toBe(3)
    expect(visibleCount([3, 2, 1])).toBe(1)
    expect(visibleCount([])).toBe(0)
  })

  it('isLatin accepts a Latin square and rejects duplicates and zeros', () => {
    expect(isLatin(3, [[1, 2, 3], [3, 1, 2], [2, 3, 1]])).toBe(true)
    expect(isLatin(3, [[1, 1, 3], [3, 1, 2], [2, 3, 1]])).toBe(false)
    expect(isLatin(3, [[0, 2, 3], [3, 1, 2], [2, 3, 1]])).toBe(false)
  })

  it('puzzleFromSeed is deterministic for the same seed', () => {
    const seed = 3 * 0x9e3779b9
    const a = puzzleFromSeed(seed, 5)
    const b = puzzleFromSeed(seed, 5)
    expect(a).toEqual(b)
  })

  it('every level size generates a puzzle whose own solution wins', () => {
    for (let lv = 1; lv <= 5; lv += 1) {
      const p = puzzleFromSeed(lv * 0x9e3779b9, levelSize(lv))
      expect(p.size).toBe(levelSize(lv))
      expect(isWon(p, p.solution)).toBe(true)
      if (p.unique) {
        const budget = p.size <= 5 ? 200_000 : 1_500_000
        expect(solveCount(p, budget).solutions).toBe(1)
      }
    }
  })

  it('isWon rejects a grid with two values swapped inside one row', () => {
    const p = puzzleFromSeed(1 * 0x9e3779b9, levelSize(1))
    const bad = p.solution.map(row => [...row])
    const row = bad[0]!
    ;[row[0], row[1]] = [row[1]!, row[0]!]
    expect(isWon(p, bad)).toBe(false)
  })

  it('a level-2 puzzle solves with at least one solution', () => {
    const p = puzzleFromSeed(2 * 0x9e3779b9, levelSize(2))
    const r = solveCount(p, 200_000)
    expect(r.solutions).toBeGreaterThanOrEqual(1)
    expect(r.exhausted).toBe(false)
  })

  it('computeScore decays the time bonus to the base score', () => {
    expect(computeScore(1, 0)).toBe(3100)
    expect(computeScore(1, 10_000)).toBe(100)
  })
})
