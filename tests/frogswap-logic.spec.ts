import { describe, expect, it } from 'vitest'
import type { CellValue } from '../src/client/games/frogswap/logic.ts'
import {
  applyMove, bfsOptimal, canAnyMove, createFrogSwap, efficiency,
  isDeadlocked, isSolved, legalTargets, moveKind, mulberry32, optimalMoveCount, undoMove,
} from '../src/client/games/frogswap/logic.ts'

/** 初格工具：按每侧蛙数 f 取初始局面。 */
const startCells = (f: number): CellValue[] => createFrogSwap(f - 1, 1).cells
/** 按每侧蛙数 f 建状态（level = f - 1）。 */
const stateOf = (f: number, seed: number) => createFrogSwap(f - 1, seed)

describe('frogswap logic', () => {
  it('initial layout: f green left, empty center, f yellow right for all 5 levels', () => {
    for (let level = 1; level <= 5; level += 1) {
      const s = createFrogSwap(level, 7)
      expect(s.frogCount).toBe(level + 1)
      expect(s.cells.length).toBe(2 * (level + 1) + 1)
      expect(s.moves).toBe(0)
      expect(s.won).toBe(false)
      expect(s.cells.every((c, i) => (i < s.frogCount ? c === 'G' : i === s.frogCount ? c === null : c === 'Y'))).toBe(true)
    }
  })

  it('green frogs move right only: slide into empty, hop over exactly one yellow', () => {
    // _ G Y _ _：绿蛙在 1，可滑到 2?（占用）不可；跳过黄蛙到 3 合法。
    const cells: CellValue[] = [null, 'G', 'Y', null, null]
    expect(moveKind(cells, 1, 2)).toBeNull() // 目标被占
    expect(moveKind(cells, 1, 3)).toBe('hop')
    expect(moveKind(cells, 1, 0)).toBeNull() // 后退
    expect(moveKind(cells, 1, 4)).toBeNull() // 距离 3
    // _ G G _ _：跳过同色不合法，滑入空位合法。
    const same: CellValue[] = [null, 'G', 'G', null, null]
    expect(moveKind(same, 1, 3)).toBeNull() // 中间是同色
    expect(moveKind(same, 1, 2)).toBeNull() // 滑入被占格
    expect(moveKind(same, 2, 3)).toBe('slide')
    // 跳过空位不合法：G _ _。
    const gap: CellValue[] = ['G', null, null]
    expect(moveKind(gap, 0, 2)).toBeNull() // 中间无蛙
    // 越界不合法。
    expect(moveKind(startCells(2), 0, -1)).toBeNull()
  })

  it('yellow frogs move left only: symmetric slide and hop rules', () => {
    const cells: CellValue[] = [null, 'G', 'Y', null, null]
    expect(moveKind(cells, 2, 0)).toBe('hop') // 黄蛙跳过绿蛙向左
    expect(moveKind(cells, 2, 1)).toBeNull() // 滑入被占格
    expect(moveKind(cells, 2, 3)).toBeNull() // 向右后退
    const slide: CellValue[] = [null, 'Y', null, null, null]
    expect(moveKind(slide, 1, 0)).toBe('slide')
    const gap: CellValue[] = [null, null, 'Y', null, null]
    expect(moveKind(gap, 2, 0)).toBeNull() // 距离 2 但中间是空位
  })

  it('legalTargets on the 3v3 start: only the two inner frogs can slide', () => {
    const s = stateOf(3, 9) // G G G _ Y Y Y
    expect(legalTargets(s, 0)).toEqual([])
    expect(legalTargets(s, 1)).toEqual([])
    expect(legalTargets(s, 2)).toEqual([3]) // 滑入空位；跳越中蛙是空位不合法
    expect(legalTargets(s, 3)).toEqual([]) // 空位无蛙
    expect(legalTargets(s, 4)).toEqual([3])
    expect(legalTargets(s, 5)).toEqual([])
    expect(legalTargets(s, 6)).toEqual([])
  })

  it('applyMove moves, counts, records history; illegal move leaves state untouched', () => {
    const s = stateOf(3, 11)
    expect(applyMove(s, 2, 3)).toBe(true)
    expect(s.cells[2]).toBeNull()
    expect(s.cells[3]).toBe('G')
    expect(s.moves).toBe(1)
    expect(s.history).toEqual([{ from: 2, to: 3 }])
    const before = [...s.cells]
    expect(applyMove(s, 4, 6)).toBe(false) // 黄蛙不可向右后退
    expect(s.cells).toEqual(before)
    expect(s.moves).toBe(1)
  })

  it('undo restores the previous position and declines on an empty stack', () => {
    const s = stateOf(3, 13)
    const initial = [...s.cells]
    expect(applyMove(s, 2, 3)).toBe(true) // G G _ G Y Y Y
    expect(applyMove(s, 4, 2)).toBe(true) // 黄蛙 4 跳过绿蛙 3 落到 2
    expect(s.moves).toBe(2)
    expect(undoMove(s)).toBe(true)
    expect(undoMove(s)).toBe(true)
    expect(s.cells).toEqual(initial)
    expect(s.moves).toBe(0)
    expect(s.won).toBe(false)
    expect(undoMove(s)).toBe(false) // 空栈拒绝
  })

  it('deadlock detection: blocked position flagged, start and solved are not', () => {
    const s = stateOf(3, 17)
    expect(isDeadlocked(s)).toBe(false)
    expect(canAnyMove(s)).toBe(true)
    // G G Y G Y Y _：每只蛙都被占位/同色挡死（见逐格注释）。
    s.cells = ['G', 'G', 'Y', 'G', 'Y', 'Y', null]
    expect(canAnyMove(s)).toBe(false)
    expect(isDeadlocked(s)).toBe(true)
    // 已胜利的局面不算死局。
    s.cells = ['Y', 'Y', 'Y', null, 'G', 'G', 'G']
    s.won = true
    expect(isDeadlocked(s)).toBe(false)
  })

  it('isSolved requires the full swap; BFS solution path solves in optimal moves', () => {
    const s = stateOf(2, 19)
    expect(isSolved(s)).toBe(false)
    // 半换不算。
    s.cells = ['Y', null, 'G', 'Y', 'G']
    expect(isSolved(s)).toBe(false)
    // BFS 找最短路径并逐步 applyMove。
    const path = bfsPath(startCells(2))
    expect(path).not.toBeNull()
    // 在全新状态上按 BFS 最短路径落子（上面的半换局面不再复用）。
    const t = stateOf(2, 19)
    for (const [from, to] of path!) expect(applyMove(t, from, to)).toBe(true)
    expect(isSolved(t)).toBe(true)
    expect(t.won).toBe(true)
    expect(t.moves).toBe(optimalMoveCount(2))
  })

  it('optimalMoveCount f*(f+2) matches BFS on the start position for f=2..5', () => {
    for (const f of [2, 3, 4, 5]) {
      expect(optimalMoveCount(f)).toBe(f * (f + 2))
      expect(bfsOptimal(startCells(f))).toBe(f * (f + 2))
    }
    expect(optimalMoveCount(6)).toBe(48) // 公式外推（BFS 状态空间大，测试只对拍到 f=5）
  })

  it('seed determinism: same seed same deco, different seed differs; rng in [0,1)', () => {
    const a = createFrogSwap(3, 42)
    const b = createFrogSwap(3, 42)
    const c = createFrogSwap(3, 43)
    expect(b.deco).toEqual(a.deco)
    expect(a.cells).toEqual(b.cells)
    expect(c.deco[0]).not.toBe(a.deco[0])
    const rng = mulberry32(42)
    const seq = [rng(), rng(), rng()]
    expect(seq.every(v => v >= 0 && v < 1)).toBe(true)
    const rng2 = mulberry32(42)
    expect([rng2(), rng2(), rng2()]).toEqual(seq)
  })

  it('efficiency: capped at 100, scales with extra moves', () => {
    expect(efficiency(15, 15)).toBe(100)
    expect(efficiency(15, 0)).toBe(100)
    expect(efficiency(15, 20)).toBe(75)
    expect(efficiency(15, 10)).toBe(100) // 超额完成也封顶
    expect(efficiency(15, 30)).toBe(50)
  })
})

/**
 * 测试辅助：BFS 求一条最短解路径（from,to 序列）。
 * @param cells - 初始局面。
 * @returns 走法数组；无解返回 null。
 */
function bfsPath(cells: CellValue[]): [number, number][] | null {
  const keyOf = (c: CellValue[]): string => c.map(v => (v === null ? '_' : v)).join('')
  const f = (cells.length - 1) / 2
  const goal: CellValue[] = []
  for (let i = 0; i < f; i += 1) goal.push('Y')
  goal.push(null)
  for (let i = 0; i < f; i += 1) goal.push('G')
  const goalKey = keyOf(goal)
  const startKey = keyOf(cells)
  if (startKey === goalKey) return []
  const prev = new Map<string, { key: string; from: number; to: number }>()
  const seen = new Set<string>([startKey])
  let frontier: CellValue[][] = [cells.map(v => v)]
  while (frontier.length > 0) {
    const next: CellValue[][] = []
    for (const board of frontier) {
      for (let from = 0; from < board.length; from += 1) {
        for (let to = 0; to < board.length; to += 1) {
          if (moveKind(board, from, to) === null) continue
          const child = board.map(v => v)
          child[to] = child[from]!
          child[from] = null
          const k = keyOf(child)
          if (seen.has(k)) continue
          seen.add(k)
          prev.set(k, { key: keyOf(board), from, to })
          if (k === goalKey) {
            const path: [number, number][] = []
            let cur = k
            while (cur !== startKey) {
              const step = prev.get(cur)!
              path.unshift([step.from, step.to])
              cur = step.key
            }
            return path
          }
          next.push(child)
        }
      }
    }
    frontier = next
  }
  return null
}
