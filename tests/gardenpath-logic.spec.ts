import { describe, expect, it } from 'vitest'
import {
  CELL_CLUE, CELL_EMPTY, CELL_ROCK, LEVEL_COUNT, LEVEL_SIZES, MARK_FLOWER, MARK_GRASS,
  adjacencyConflicts, clueFlowerCount, computeScore, countSolutions, flowersAdjacent,
  hintCell, isWon, levelSize, mulberry32, puzzleFromSeed, toggleMark, uncoveredCells,
  unsatisfiedClues, type GardenPathPuzzle,
} from '../src/client/games/gardenpath/logic.ts'

/** 把生成解（Uint8Array 1/0）转成玩家标记数组。 */
function marksFromSolution(puzzle: GardenPathPuzzle): Uint8Array {
  const marks = new Uint8Array(puzzle.size * puzzle.size)
  for (let i = 0; i < marks.length; i += 1) {
    if (puzzle.cells[i] === CELL_EMPTY && puzzle.solution[i] === 1) marks[i] = MARK_FLOWER
  }
  return marks
}

/** 每关取一张确定性盘（seed 走关卡号派生，与 index.ts 一致）。 */
function puzzleForLevel(level: number): GardenPathPuzzle {
  const p = puzzleFromSeed(level * 0x9e3779b9, level)
  expect(p).not.toBeNull()
  return p!
}

describe('gardenpath logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('levelSize maps 5 levels to 8x8 through 12x12 and cycles', () => {
    expect(LEVEL_SIZES).toEqual([8, 9, 10, 11, 12])
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) expect(levelSize(lv)).toBe(LEVEL_SIZES[lv - 1])
    expect(levelSize(LEVEL_COUNT + 1)).toBe(8)
  })

  it('puzzleFromSeed replays the exact same board for the same seed', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const a = puzzleFromSeed(lv * 0x9e3779b9, lv)!
      const b = puzzleFromSeed(lv * 0x9e3779b9, lv)!
      expect([...a.cells]).toEqual([...b.cells])
      expect([...a.clueNumbers]).toEqual([...b.clueNumbers])
      expect([...a.solution]).toEqual([...b.solution])
    }
  })

  it('every level has exactly one full solution and the solver is not exhausted', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const puzzle = puzzleForLevel(lv)
      const r = countSolutions(puzzle.size, puzzle.cells, puzzle.clueNumbers, 2)
      expect(r.exhausted).toBe(false)
      expect(r.solutions).toBe(1)
    }
  })

  it('generated solutions satisfy every clue: the clue number equals its 4-neighbor flower count', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const puzzle = puzzleForLevel(lv)
      const marks = marksFromSolution(puzzle)
      const n = puzzle.size * puzzle.size
      let clues = 0
      for (let i = 0; i < n; i += 1) {
        if (puzzle.cells[i] !== CELL_CLUE) continue
        clues += 1
        expect(clueFlowerCount(puzzle, marks, i)).toBe(puzzle.clueNumbers[i])
        expect(puzzle.clueNumbers[i]).toBeGreaterThanOrEqual(0)
        expect(puzzle.clueNumbers[i]).toBeLessThanOrEqual(4)
      }
      // 初始 6-8 个提示，定向挖洞会补到唯一；上限 = 生成器的 60% 熔断。
      expect(clues).toBeGreaterThanOrEqual(6)
      expect(clues).toBeLessThanOrEqual(Math.floor(n * 0.6))
    }
  })

  it('generated solutions have no two 8-adjacent flowers and flowers sit only on empty cells', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const puzzle = puzzleForLevel(lv)
      const flowers: number[] = []
      const n = puzzle.size * puzzle.size
      for (let i = 0; i < n; i += 1) {
        if (puzzle.solution[i] === 1) {
          expect(puzzle.cells[i]).toBe(CELL_EMPTY)
          flowers.push(i)
        }
        if (puzzle.cells[i] === CELL_ROCK || puzzle.cells[i] === CELL_CLUE) {
          expect(puzzle.solution[i]).toBe(0)
        }
      }
      for (let a = 0; a < flowers.length; a += 1) {
        for (let b = a + 1; b < flowers.length; b += 1) {
          expect(flowersAdjacent(puzzle.size, flowers[a]!, flowers[b]!)).toBe(false)
        }
      }
    }
  })

  it('generated solutions dominate: every grass cell touches a flower (8-dir), uncoveredCells is empty', () => {
    for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
      const puzzle = puzzleForLevel(lv)
      const marks = marksFromSolution(puzzle)
      expect(uncoveredCells(puzzle, marks)).toEqual([])
      // 空盘（全草、无花）覆盖必然缺失，且花数 > 0 的一关里至少一格未覆盖。
      const empty = new Uint8Array(puzzle.size * puzzle.size)
      expect(uncoveredCells(puzzle, empty).length).toBeGreaterThan(0)
    }
  })

  it('isWon accepts the generated solution and rejects empty / altered boards', () => {
    const puzzle = puzzleForLevel(2)
    expect(isWon(puzzle, marksFromSolution(puzzle))).toBe(true)
    expect(isWon(puzzle, new Uint8Array(puzzle.size * puzzle.size))).toBe(false)
    // 挪走一朵花：必有提示失配或覆盖缺失。
    const fewer = marksFromSolution(puzzle)
    const flowerAt = fewer.findIndex(m => m === MARK_FLOWER)
    fewer[flowerAt] = MARK_GRASS
    expect(isWon(puzzle, fewer)).toBe(false)
    // 在某朵花旁边补一朵（斜邻也算）：违反八向不相邻。
    const size = puzzle.size
    const r = Math.floor(flowerAt / size)
    const c = flowerAt % size
    const diag = (r + 1) * size + c + 1
    const extra = marksFromSolution(puzzle)
    if (r + 1 < size && c + 1 < size && puzzle.cells[diag] === CELL_EMPTY) {
      extra[diag] = MARK_FLOWER
      expect(adjacencyConflicts(puzzle, extra).length).toBeGreaterThan(0)
      expect(isWon(puzzle, extra)).toBe(false)
    }
  })

  it('toggleMark cycles flower/grass and refuses rocks and clue cells', () => {
    const puzzle = puzzleForLevel(1)
    const marks = new Uint8Array(puzzle.size * puzzle.size)
    const n = puzzle.size * puzzle.size
    let rock = -1
    let clue = -1
    let empty = -1
    for (let i = 0; i < n; i += 1) {
      if (puzzle.cells[i] === CELL_ROCK && rock < 0) rock = i
      if (puzzle.cells[i] === CELL_CLUE && clue < 0) clue = i
      if (puzzle.cells[i] === CELL_EMPTY && empty < 0) empty = i
    }
    expect(rock).toBeGreaterThanOrEqual(0)
    expect(clue).toBeGreaterThanOrEqual(0)
    expect(toggleMark(puzzle, marks, empty!)).toBe(true)
    expect(marks[empty]).toBe(MARK_FLOWER)
    expect(toggleMark(puzzle, marks, empty!)).toBe(true)
    expect(marks[empty]).toBe(MARK_GRASS)
    expect(toggleMark(puzzle, marks, rock!)).toBe(false)
    expect(toggleMark(puzzle, marks, clue!)).toBe(false)
    expect(marks[rock]).toBe(MARK_GRASS)
  })

  it('unsatisfiedClues tracks a wrong placement and clears when fixed', () => {
    const puzzle = puzzleForLevel(3)
    const marks = marksFromSolution(puzzle)
    expect(unsatisfiedClues(puzzle, marks)).toEqual([])
    expect(adjacencyConflicts(puzzle, marks)).toEqual([])
    // 挖掉一朵花：至少一条提示失配。
    const flowerAt = marks.findIndex(m => m === MARK_FLOWER)
    marks[flowerAt] = MARK_GRASS
    expect(unsatisfiedClues(puzzle, marks).length).toBeGreaterThan(0)
    marks[flowerAt] = MARK_FLOWER
    expect(unsatisfiedClues(puzzle, marks)).toEqual([])
  })

  it('hintCell reveals a differing cell deterministically and ends at -1', () => {
    const puzzle = puzzleForLevel(4)
    const marks = new Uint8Array(puzzle.size * puzzle.size).fill(MARK_GRASS)
    const first = hintCell(puzzle, marks)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(puzzle.cells[first]).toBe(CELL_EMPTY)
    expect(marks[first]).not.toBe(puzzle.solution[first])
    expect(hintCell(puzzle, new Uint8Array(puzzle.size * puzzle.size).fill(MARK_GRASS))).toBe(first)
    // 逐步照提示落子直到全对：最后返回 -1。
    let guard = 0
    for (;;) {
      const cell = hintCell(puzzle, marks)
      if (cell < 0) break
      marks[cell] = puzzle.solution[cell] === 1 ? MARK_FLOWER : MARK_GRASS
      guard += 1
      expect(guard).toBeLessThanOrEqual(puzzle.size * puzzle.size)
    }
    expect(isWon(puzzle, marks)).toBe(true)
  })

  it('computeScore rewards level, decays with time, and penalizes hints', () => {
    expect(computeScore(1, 0, 0)).toBe(2500)
    expect(computeScore(1, 600, 0)).toBe(100)
    expect(computeScore(3, 0, 0)).toBe(2700)
    expect(computeScore(3, 0, 2)).toBe(2200)
    expect(computeScore(1, 100_000, 2)).toBe(50)
    expect(computeScore(5, 0, 0)).toBeGreaterThan(computeScore(4, 0, 0))
  })

  it('different seeds may produce different boards (generation is seed-driven)', () => {
    const a = puzzleFromSeed(12345, 1)
    const b = puzzleFromSeed(67890, 1)
    const sameCells = [...a!.cells].every((v, i) => v === b!.cells[i])
    const sameSol = [...a!.solution].every((v, i) => v === b!.solution[i])
    expect(sameCells && sameSol).toBe(false)
  })
})
