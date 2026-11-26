import { describe, expect, it } from 'vitest'
import {
  BOARD_MARGIN, BOARD_Y, H, HELP_BTN, HINT_MAX, LEVELS, LEVEL_COUNT, TILE_GAP, TILE_H, W,
  attemptSwap, boardX, countInversions, createDominoShuffle, inHelpButton, isSortedTiles,
  mulberry32, requestHint, selectTile, tileAt, tileRect, tileW,
  type DominoShuffleState,
} from '../src/client/games/dominoshuffle/logic.ts'

/** 贪心求解：每步找最靠左的「相邻、未锁定、左大右小」对并交换；
 * 只解当前这一关（过关发牌或局面结束即停），返回本关实际交换数。 */
const greedySolve = (s: DominoShuffleState): number => {
  const startLevel = s.level
  let count = 0
  let guard = 0
  while (s.level === startLevel && !s.over && !isSortedTiles(s.tiles)) {
    const n = s.tiles.length
    let acted = false
    for (let i = 0; i + 1 < n; i += 1) {
      if (!s.locked[i] && !s.locked[i + 1] && s.tiles[i]! > s.tiles[i + 1]!) {
        expect(attemptSwap(s, i, i + 1)).toBe('ok')
        count += 1
        acted = true
        break
      }
    }
    expect(acted).toBe(true)
    guard += 1
    expect(guard).toBeLessThan(500)
  }
  return count
}

/** 状态摘要（重放一致性比较用）。 */
const trace = (s: DominoShuffleState): string => JSON.stringify([
  s.level, s.tiles, s.locked, s.moves, s.budget, s.inversions, s.hintsLeft,
  s.selected, s.hintPair, s.score, s.over, s.win,
])

describe('dominoshuffle logic', () => {
  it('level table ramps 8→14 tiles, 0→4 locks, buffer 3→0; geometry fits the canvas', () => {
    expect(LEVELS.length).toBe(LEVEL_COUNT)
    for (let i = 0; i < LEVEL_COUNT; i += 1) {
      expect(LEVELS[i]!.count).toBe(8 + [0, 2, 4, 5, 6][i]!)
    }
    expect(LEVELS.map((l) => l.locks)).toEqual([0, 1, 2, 3, 4])
    expect(LEVELS.map((l) => l.buffer)).toEqual([3, 2, 2, 1, 0])
    expect(HINT_MAX).toBe(3)
    expect(HELP_BTN.w).toBe(60)
    expect(HELP_BTN.h).toBe(24)
    expect(HELP_BTN.x + HELP_BTN.w).toBeLessThanOrEqual(W)
    expect(HELP_BTN.y + HELP_BTN.h).toBeLessThanOrEqual(H)
    expect(inHelpButton(HELP_BTN.x + 1, HELP_BTN.y + 1)).toBe(true)
    expect(inHelpButton(0, 0)).toBe(false)
    // 各关骨牌行：居中、留白内、间隙恒定、两两不重叠。
    for (const spec of LEVELS) {
      const n = spec.count
      expect(tileW(n)).toBeLessThanOrEqual(60)
      const rects = []
      for (let i = 0; i < n; i += 1) rects.push(tileRect(i, n))
      expect(rects[0]!.x).toBeGreaterThanOrEqual(BOARD_MARGIN - TILE_GAP)
      expect(rects[n - 1]!.x + rects[n - 1]!.w).toBeLessThanOrEqual(W - BOARD_MARGIN + TILE_GAP)
      expect(rects[0]!.y).toBe(BOARD_Y)
      expect(rects[0]!.y + TILE_H).toBeLessThanOrEqual(H)
      expect(Math.abs(rects[0]!.x - boardX(n))).toBeLessThan(0.001)
      for (let i = 1; i < n; i += 1) {
        expect(rects[i]!.x - (rects[i - 1]!.x + rects[i - 1]!.w)).toBe(TILE_GAP)
      }
    }
    // 命中测试：槽中心命中、缝隙与盘面外不命中。
    const s = createDominoShuffle(7, 1, 0)
    const r = tileRect(3, s.tiles.length)
    expect(tileAt(s, r.x + r.w / 2, r.y + r.h / 2)).toBe(3)
    expect(tileAt(s, r.x + r.w + TILE_GAP / 2, r.y + r.h / 2)).toBeNull()
    expect(tileAt(s, W / 2, 20)).toBeNull()
  })

  it('countInversions matches hand-computed cases (adjacent swap changes it by ±1)', () => {
    expect(countInversions([1, 2, 3])).toBe(0)
    expect(countInversions([2, 1])).toBe(1)
    expect(countInversions([1, 3, 2])).toBe(1)
    expect(countInversions([3, 2, 1])).toBe(3)
    expect(countInversions([5, 4, 3, 2, 1])).toBe(10)
    const arr = [3, 1, 4, 1, 5, 9, 2, 6]
    const before = countInversions(arr)
    const swapped = [...arr]
    const tmp = swapped[2]!
    swapped[2] = swapped[3]!
    swapped[3] = tmp
    expect(countInversions(swapped)).toBe(before + (arr[2]! < arr[3]! ? 1 : -1))
  })

  it('seeded deal: deterministic, unsorted, locked tiles already in place, budget = inversions + buffer', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const a = createDominoShuffle(42, level, 0)
      const b = createDominoShuffle(42, level, 0)
      expect(trace(a)).toBe(trace(b))
      const spec = LEVELS[level - 1]!
      expect(a.tiles.length).toBe(spec.count)
      expect(a.locked.filter(Boolean).length).toBe(spec.locks)
      expect(isSortedTiles(a.tiles)).toBe(false)
      expect(a.inversions).toBeGreaterThanOrEqual(1)
      expect(a.budget).toBe(a.inversions + spec.buffer)
      // 锁定骨牌天然已就位：值为槽位 + 1。
      for (let i = 0; i < a.tiles.length; i += 1) {
        if (a.locked[i]) expect(a.tiles[i]).toBe(i + 1)
      }
      // 值为 1..n 的排列。
      expect([...a.tiles].sort((x, y) => x - y)).toEqual(a.tiles.map((_, i) => i + 1))
    }
    // 不同 seed 局面不同。
    const s1 = createDominoShuffle(1, 1, 0)
    const s2 = createDominoShuffle(2, 1, 0)
    expect(s1.tiles).not.toEqual(s2.tiles)
  })

  it('every deal is solvable in exactly the inversion count (greedy play never exceeds budget)', () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const s = createDominoShuffle(seed, level, 0)
        const inv = s.inversions
        const used = greedySolve(s)
        if (s.level > level) {
          // 1-4 关：排好即发下一关（新局面非有序、步数清零）。
          expect(s.over).toBe(false)
          expect(s.moves).toBe(0)
          expect(s.inversions).toBeGreaterThanOrEqual(1)
        } else {
          // 第 5 关：排好即通关。
          expect(isSortedTiles(s.tiles)).toBe(true)
          expect(s.over).toBe(true)
          expect(s.win).toBe(true)
        }
        expect(used).toBe(inv)
        expect(used).toBeLessThanOrEqual(inv + LEVELS[level - 1]!.buffer)
      }
    }
  })

  it('attemptSwap validation: over / notAdjacent / out-of-range / locked leave state untouched', () => {
    const s = createDominoShuffle(11, 3, 0)
    const snap = trace(s)
    expect(attemptSwap(s, 0, 2)).toBe('notAdjacent')
    expect(attemptSwap(s, -1, 0)).toBe('notAdjacent')
    expect(attemptSwap(s, 0, s.tiles.length)).toBe('notAdjacent')
    const li = s.locked.findIndex(Boolean)
    expect(li).toBeGreaterThanOrEqual(0)
    const lj = li === 0 ? 1 : li - 1
    expect(attemptSwap(s, li, lj)).toBe('locked')
    expect(s.events.some((e) => e.type === 'lockedClick')).toBe(true)
    // 拒绝路径不改局面（trace 不含事件数组）。
    expect(trace(s)).toBe(snap)
    // 结束后拒绝。
    const w = createDominoShuffle(3, 1, 0)
    greedySolve(w)
    while (!w.over) greedySolve(w)
    expect(attemptSwap(w, 0, 1)).toBe('over')
  })

  it('level clear: exact reward formula, advance to a fresh unsorted board of the next level', () => {
    const s = createDominoShuffle(5, 1, 0)
    const inv = s.inversions
    const used = greedySolve(s)
    // 第 1 关缓冲 3：reward = 100 + (budget-moves)*10 + hintsLeft*5。
    expect(used).toBe(inv)
    expect(s.level).toBe(2)
    expect(s.score).toBe(100 + LEVELS[0]!.buffer * 10 + HINT_MAX * 5)
    expect(s.moves).toBe(0)
    expect(s.inversions).toBeGreaterThanOrEqual(1)
    expect(s.tiles.length).toBe(LEVELS[1]!.count)
    expect(s.locked.filter(Boolean).length).toBe(LEVELS[1]!.locks)
    expect(s.events.some((e) => e.type === 'level' && e.level === 2)).toBe(true)
    expect(s.over).toBe(false)
  })

  it('level 5 completion ends the run as a win with cumulative score', () => {
    const s = createDominoShuffle(19, 1, 0)
    let guard = 0
    while (!s.over && guard < 2000) {
      greedySolve(s)
      guard += 1
    }
    expect(s.over).toBe(true)
    expect(s.win).toBe(true)
    expect(s.level).toBe(LEVEL_COUNT)
    expect(s.score).toBeGreaterThanOrEqual(5 * 100)
    expect(s.events.some((e) => e.type === 'win')).toBe(true)
  })

  it('budget exhaustion fails the level exactly on the move that reaches the budget', () => {
    // 找一个初始逆序 ≥ 2 的第 1 关局面。
    let s: DominoShuffleState | null = null
    for (let seed = 1; seed <= 200 && s === null; seed += 1) {
      const c = createDominoShuffle(seed, 1, 0)
      if (c.inversions >= 2) s = c
    }
    expect(s).not.toBeNull()
    const st = s!
    // 把步数推到预算 - 1，再做一次「消除逆序但仍未排好」的交换。
    st.moves = st.budget - 1
    let swapped = false
    for (let i = 0; i + 1 < st.tiles.length && !swapped; i += 1) {
      if (!st.locked[i] && !st.locked[i + 1] && st.tiles[i]! > st.tiles[i + 1]! && st.inversions >= 2) {
        expect(attemptSwap(st, i, i + 1)).toBe('ok')
        swapped = true
      }
    }
    expect(swapped).toBe(true)
    expect(st.moves).toBe(st.budget)
    expect(st.over).toBe(true)
    expect(st.win).toBe(false)
    expect(isSortedTiles(st.tiles)).toBe(false)
    expect(st.events.some((e) => e.type === 'fail')).toBe(true)
  })

  it('hint: swaps a hinted pair to remove exactly one inversion; capped at 3, cleared by swap', () => {
    const s = createDominoShuffle(23, 4, 0)
    const inv = s.inversions
    expect(inv).toBeGreaterThanOrEqual(2)
    const h = requestHint(s)
    expect(h).not.toBeNull()
    expect(s.hintsLeft).toBe(HINT_MAX - 1)
    expect(Math.abs(h![0] - h![1])).toBe(1)
    expect(s.tiles[h![0]]!).toBeGreaterThan(s.tiles[h![1]]!)
    expect(attemptSwap(s, h![0], h![1])).toBe('ok')
    expect(s.inversions).toBe(inv - 1)
    expect(s.hintPair).toBeNull()
    // 用完 3 次后返回 null 且不再扣次数。
    const s2 = createDominoShuffle(23, 4, 0)
    for (let k = 0; k < HINT_MAX; k += 1) expect(requestHint(s2)).not.toBeNull()
    expect(s2.hintsLeft).toBe(0)
    expect(requestHint(s2)).toBeNull()
    expect(s2.hintsLeft).toBe(0)
    // 结束局面不给提示。
    const w = createDominoShuffle(23, 4, 0)
    while (!w.over) greedySolve(w)
    expect(requestHint(w)).toBeNull()
  })

  it('selectTile: toggles unlocked tiles, rejects locked and out-of-range without side effects', () => {
    const s = createDominoShuffle(31, 3, 0)
    const li = s.locked.findIndex(Boolean)
    const ui = s.locked.findIndex((v) => !v)
    expect(ui).toBeGreaterThanOrEqual(0)
    expect(selectTile(s, ui)).toBe(true)
    expect(s.selected).toBe(ui)
    expect(selectTile(s, ui)).toBe(true)
    expect(s.selected).toBeNull()
    const before = trace(s)
    expect(selectTile(s, li)).toBe(false)
    expect(s.events.some((e) => e.type === 'lockedClick' && e.i === li)).toBe(true)
    expect(selectTile(s, -1)).toBe(false)
    expect(selectTile(s, s.tiles.length)).toBe(false)
    expect(trace(s)).toBe(before)
  })

  it('seed replay: identical traces under the same input script; mulberry32 is deterministic', () => {
    const script = (s: DominoShuffleState): void => {
      requestHint(s)
      const h = s.hintPair
      if (h !== null) attemptSwap(s, h[0], h[1])
      selectTile(s, 0)
      attemptSwap(s, 0, 1)
      selectTile(s, 2)
      attemptSwap(s, 2, 3)
    }
    const a = createDominoShuffle(97, 1, 0)
    const b = createDominoShuffle(97, 1, 0)
    const ta: string[] = [trace(a)]
    const tb: string[] = [trace(b)]
    for (let step = 0; step < 8; step += 1) {
      script(a)
      script(b)
      ta.push(trace(a))
      tb.push(trace(b))
    }
    expect(ta).toEqual(tb)
    // mulberry32：同种子同序列，不同种子不同序列。
    const r1 = mulberry32(5)
    const r2 = mulberry32(5)
    const r3 = mulberry32(6)
    const seq1 = [r1(), r1(), r1()]
    expect(seq1).toEqual([r2(), r2(), r2()])
    expect(seq1).not.toEqual([r3(), r3(), r3()])
    for (const v of seq1) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
