import { describe, expect, it } from 'vitest'
import {
  canPlaceDie, CELLS, computeScore, createGame, dealRound, discardDie, generateBoard,
  GRID, levelConfig, LEVEL_COUNT, mulberry32, placeDie, randomDie, satisfiesConstraint,
  solutionPlacements, type DiceGameState,
} from '../src/client/games/dicegrid/logic.ts'

describe('dicegrid logic', () => {
  it('mulberry32 确定性：同 seed 同序列，不同 seed 不同序列', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual([c(), c(), c(), c()])
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('关卡难度递进：颜色 2→4、约束格 3→7、每轮候选 3→4', () => {
    const cfg = [1, 2, 3, 4, 5].map(levelConfig)
    expect(cfg.map(c => c.colors)).toEqual([2, 2, 3, 3, 4])
    expect(cfg[0]!.fixedCells).toBeLessThan(cfg[4]!.fixedCells)
    expect(cfg.map(c => c.rackSize)).toEqual([3, 3, 4, 4, 4])
    // 越界钳制到边界关卡。
    expect(levelConfig(0).colors).toBe(2)
    expect(levelConfig(99).colors).toBe(4)
  })

  it('盘面生成：约束数符合难度表，且每条约束都被隐藏解满足', () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      const state = generateBoard(level, 20260000 + level)
      let fixed = 0
      for (let r = 0; r < GRID; r += 1) {
        for (let c = 0; c < GRID; c += 1) {
          const cell = state.board[r]![c]!
          if (cell.constraint === null) continue
          fixed += 1
          expect(satisfiesConstraint(cell.constraint, state.solution[r]![c]!)).toBe(true)
        }
      }
      expect(fixed).toBe(levelConfig(level).fixedCells)
      // 盘面初始为空。
      expect(state.placed).toBe(0)
      expect(state.won).toBe(false)
    }
  })

  it('隐藏解自洽：每行每列点数互异，正交相邻颜色互异', () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      const { solution } = generateBoard(level, 777000 + level)
      for (let r = 0; r < GRID; r += 1) {
        for (let c = 0; c < GRID; c += 1) {
          const die = solution[r]![c]!
          expect(die.value).toBeGreaterThanOrEqual(1)
          expect(die.value).toBeLessThanOrEqual(6)
          for (let i = 0; i < GRID; i += 1) {
            if (i !== c) expect(solution[r]![i]!.value).not.toBe(die.value)
            if (i !== r) expect(solution[i]![c]!.value).not.toBe(die.value)
          }
          if (r > 0) expect(solution[r - 1]![c]!.color).not.toBe(die.color)
          if (c > 0) expect(solution[r]![c - 1]!.color).not.toBe(die.color)
        }
      }
    }
  })

  it('可行放置序列：按 solutionPlacements 行优先回放整局，每步合法直至过关', () => {
    const state = generateBoard(5, 424242)
    for (const step of solutionPlacements(state.solution)) {
      expect(canPlaceDie(state, step.r, step.c, step.die)).toBe(true)
      // 直接改盘绕过骰架：验证的是冲突检测本身。
      state.board[step.r]![step.c]!.die = step.die
      state.placed += 1
    }
    expect(state.placed).toBe(CELLS)
  })

  it('行列点数冲突：同行/同列已有同点数骰则拒绝，不同点数可放', () => {
    const state = generateBoard(1, 31337)
    state.board = state.board.map(row => row.map(() => ({ constraint: null, die: null })))
    state.board[0]![0]!.die = { color: 0, value: 5 }
    state.board[0]![3]!.die = { color: 1, value: 2 }
    state.board[3]![0]!.die = { color: 1, value: 6 }
    state.placed = 3
    expect(canPlaceDie(state, 0, 1, { color: 1, value: 5 })).toBe(false) // 同行 5
    expect(canPlaceDie(state, 1, 0, { color: 0, value: 5 })).toBe(false) // 同列 5
    expect(canPlaceDie(state, 0, 1, { color: 0, value: 4 })).toBe(false) // 与左邻 (0,0) 同色 0
    expect(canPlaceDie(state, 2, 2, { color: 1, value: 5 })).toBe(true)
  })

  it('相邻颜色冲突与已占格：正交邻同色拒绝；占用的格不再可放', () => {
    const state = generateBoard(1, 999)
    state.board = state.board.map(row => row.map(() => ({ constraint: null, die: null })))
    state.board[1]![1]!.die = { color: 2, value: 3 }
    state.board[1]![2]!.die = { color: 1, value: 4 }
    state.placed = 2
    expect(canPlaceDie(state, 0, 1, { color: 2, value: 6 })).toBe(false) // 上邻同色
    expect(canPlaceDie(state, 2, 1, { color: 2, value: 6 })).toBe(false) // 下邻同色
    expect(canPlaceDie(state, 1, 3, { color: 1, value: 6 })).toBe(false) // 与左邻 (1,2) 同色 1
    expect(canPlaceDie(state, 0, 1, { color: 0, value: 6 })).toBe(true)
    expect(canPlaceDie(state, 1, 1, { color: 0, value: 6 })).toBe(false) // 已占用
    // 斜角同色不受限制（只看正交相邻）。
    expect(canPlaceDie(state, 0, 0, { color: 2, value: 6 })).toBe(true)
  })

  it('预置约束求值：色点/数值/奇/偶/≥4 各自的接受与拒绝', () => {
    const die = { color: 1, value: 4 }
    expect(satisfiesConstraint({ kind: 'color', color: 1 }, die)).toBe(true)
    expect(satisfiesConstraint({ kind: 'color', color: 0 }, die)).toBe(false)
    expect(satisfiesConstraint({ kind: 'value', value: 4 }, die)).toBe(true)
    expect(satisfiesConstraint({ kind: 'value', value: 3 }, die)).toBe(false)
    expect(satisfiesConstraint({ kind: 'even' }, die)).toBe(true)
    expect(satisfiesConstraint({ kind: 'odd' }, die)).toBe(false)
    expect(satisfiesConstraint({ kind: 'gt3' }, die)).toBe(true)
    expect(satisfiesConstraint({ kind: 'gt3' }, { color: 0, value: 3 })).toBe(false)
    // 盘面上：约束格拒绝不满足的骰。
    const state = generateBoard(1, 5)
    state.board[0]![0] = { constraint: { kind: 'odd' }, die: null }
    expect(canPlaceDie(state, 0, 0, { color: 0, value: 2 })).toBe(false)
    expect(canPlaceDie(state, 0, 0, { color: 0, value: 3 })).toBe(true)
  })

  it('候选发放：seed 决定骰架内容，袋含全部 16 颗解骰保证可完成', () => {
    const a = createGame(3, 8888)
    const b = createGame(3, 8888)
    expect(a.rack).toEqual(b.rack)
    expect(a.rack).toHaveLength(levelConfig(3).rackSize)
    expect(createGame(3, 8889).rack).not.toEqual(a.rack)
    // 袋 + 骨架起 = 解骰 16 颗（多重集合一致）。
    const state = generateBoard(3, 8888)
    const bagKeys = state.bag.map(d => d.color + ':' + d.value).sort()
    const solutionKeys = solutionPlacements(state.solution).map(s => s.die.color + ':' + s.die.value).sort()
    for (const key of solutionKeys) expect(bagKeys).toContain(key)
    expect(state.bag.length).toBeGreaterThan(16)
  })

  it('放置与弃骰流转：消耗候选、骰架空自动补发、扣分计数、非法放置被拒', () => {
    const state = createGame(1, 2024)
    const rackSize = levelConfig(1).rackSize
    // 找一颗能放进某空格的骰（空盘只有约束可能挡路）。
    let placed = false
    for (let i = 0; i < state.rack.length && !placed; i += 1) {
      for (let r = 0; r < GRID && !placed; r += 1) {
        for (let c = 0; c < GRID && !placed; c += 1) {
          if (placeDie(state, i, r, c)) placed = true
        }
      }
    }
    expect(placed).toBe(true)
    expect(state.placed).toBe(1)
    expect(state.rack.length).toBe(rackSize - 1)
    // 越界目标拒绝且不改状态。
    expect(placeDie(state, 0, -1, 0)).toBe(false)
    // 弃掉剩余候选（rackSize-1 颗）：最后一颗弃掉时骰架空 → 自动补发新一轮。
    for (let i = 0; i < rackSize - 1; i += 1) expect(discardDie(state, 0)).toBe(true)
    expect(state.discarded).toBe(rackSize - 1)
    expect(state.rack).toHaveLength(rackSize)
    expect(state.rack.every(d => d !== undefined)).toBe(true)
    expect(state.rack).toHaveLength(rackSize)
    expect(discardDie(state, 99)).toBe(false)
  })

  it('弃骰兜底可完成整局：按解骰贪心放置 + 其余全弃，最终过关并计分', () => {
    const state = createGame(2, 606)
    const need = new Set(solutionPlacements(state.solution).map(s => s.r + ':' + s.c))
    // 每轮：能合法放的先放（按隐藏解位置），其余弃掉——袋子必然补发，无死局。
    let guard = 0
    while (!state.won && guard < 5000) {
      guard += 1
      let acted = false
      for (let i = 0; i < state.rack.length && !acted; i += 1) {
        const die = state.rack[i]!
        for (let r = 0; r < GRID && !acted; r += 1) {
          for (let c = 0; c < GRID && !acted; c += 1) {
            const key = r + ':' + c
            const matchesSolution = state.solution[r]![c]!.color === die.color
              && state.solution[r]![c]!.value === die.value
            if (need.has(key) && matchesSolution && placeDie(state, i, r, c)) acted = true
          }
        }
      }
      if (!acted) discardDie(state, 0)
    }
    expect(state.won).toBe(true)
    expect(state.placed).toBe(CELLS)
    expect(computeScore(state.level, state.discarded)).toBe(Math.max(0, 60 + 2 * 15 - state.discarded * 3))
  })

  it('seed 重放：同 seed 两局执行相同动作序列产生完全一致的局面', () => {
    const run = (seed: number): DiceGameState => {
      const s = createGame(4, seed)
      for (let step = 0; step < 30; step += 1) {
        if (step % 2 === 0) discardDie(s, 0)
        else dealRound(s)
      }
      return s
    }
    const a = run(777123)
    const b = run(777123)
    expect(a.rack).toEqual(b.rack)
    expect(a.bag).toEqual(b.bag)
    expect(a.discarded).toBe(b.discarded)
    expect(run(777124).rack).not.toEqual(a.rack)
  })

  it('随机骰取值域与得分下限：randomDie 限定颜色空间；弃骰过多得分钳 0', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 200; i += 1) {
      const die = randomDie(rng, 3)
      expect(die.color).toBeGreaterThanOrEqual(0)
      expect(die.color).toBeLessThan(3)
      expect(die.value).toBeGreaterThanOrEqual(1)
      expect(die.value).toBeLessThanOrEqual(6)
    }
    expect(computeScore(1, 0)).toBe(75)
    expect(computeScore(5, 10)).toBe(105)
    expect(computeScore(1, 100)).toBe(0)
  })
})
