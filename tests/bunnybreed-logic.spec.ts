import { describe, expect, it } from 'vitest'
import {
  breed,
  buildLevel,
  clearSelection,
  combine,
  computeScore,
  gametes,
  genesString,
  isWinning,
  litterOf,
  LITTER_SIZE,
  matchesTarget,
  mulberry32,
  newGame,
  offspringStats,
  phenotype,
  punnettGrid,
  release,
  toggleSelect,
  type Genes,
  type GameState,
  type LevelData,
  type TargetSpec,
  LEVEL_COUNT,
} from '../src/client/games/bunnybreed/logic.ts'

/** 快速构造基因型。 */
function g(color: string, fur: string): Genes {
  return { color: color as Genes['color'], fur: fur as Genes['fur'] }
}

/** 构造自定义关卡（测试用）。 */
function level(start: Genes[], target: TargetSpec, target2: TargetSpec | null = null, genLimit = 99, capacity = 8): LevelData {
  return { level: 0, capacity, genLimit, start, target, target2 }
}

/** 选两只亲本并配种（失败抛错由调用方断言前先行守卫）。 */
function breedPair(state: GameState, rng: () => number, idA: number, idB: number): Genes[] | null {
  clearSelection(state)
  toggleSelect(state, idA)
  toggleSelect(state, idB)
  return breed(state, rng)
}

/** 尚未达成的目标列表（贪心求解器用）。 */
function unmet(state: GameState): TargetSpec[] {
  const needs: TargetSpec[] = []
  if (!state.rabbits.some((r) => matchesTarget(r.genes, state.data.target))) needs.push(state.data.target)
  const t2 = state.data.target2
  if (t2 !== null && !state.rabbits.some((r) => matchesTarget(r.genes, t2))) needs.push(t2)
  return needs
}

/**
 * 贪心求解器：每轮选「Punnett 16 格中命中未达成目标格数最多」的亲本
 * 对；空位不足时放归非保护兔（亲本对与已达标兔永不放归）——预算
 * 类参数（genLimit）据此实测验证可赢。
 */
function greedyPlay(data: LevelData, seed: number): GameState {
  const state = newGame(data)
  const rng = mulberry32(seed)
  while (state.phase === 'play' && state.breeds < data.genLimit) {
    const needs = unmet(state)
    if (needs.length === 0) break
    let best: [number, number] = [0, 1]
    let bestScore = -1
    for (let i = 0; i < state.rabbits.length; i += 1) {
      for (let j = i + 1; j < state.rabbits.length; j += 1) {
        const grid = punnettGrid(state.rabbits[i]!.genes, state.rabbits[j]!.genes)
        let s = 0
        for (const cell of grid) {
          if (needs.some((n) => matchesTarget(cell, n))) s += 1
        }
        if (s > bestScore) {
          bestScore = s
          best = [i, j]
        }
      }
    }
    // 先记亲本 id 再放归（放归按 splice 移除，下标会漂移）。
    const pairA = state.rabbits[best[0]]!
    const pairB = state.rabbits[best[1]]!
    const protect = new Set<number>([pairA.id, pairB.id])
    for (const r of state.rabbits) {
      if (needs.some((n) => matchesTarget(r.genes, n))) protect.add(r.id)
    }
    while (data.capacity - state.rabbits.length < LITTER_SIZE) {
      const victim = state.rabbits.find((r) => !protect.has(r.id))
      if (victim === undefined || !release(state, victim.id)) break
    }
    const pups = breedPair(state, rng, pairA.id, pairB.id)
    if (pups === null) break
  }
  return state
}

describe('bunnybreed logic', () => {
  it('gametes/combine: 等位分离与受精组合（显性大写规范序）', () => {
    expect(gametes('Bb')).toEqual(['B', 'b'])
    expect(gametes('BB')).toEqual(['B', 'B'])
    expect(gametes('Ss')).toEqual(['S', 's'])
    expect(gametes('ss')).toEqual(['s', 's'])
    expect(combine('B', 'b')).toBe('Bb')
    expect(combine('b', 'B')).toBe('Bb')
    expect(combine('B', 'B')).toBe('BB')
    expect(combine('b', 'b')).toBe('bb')
    expect(combine('S', 's')).toBe('Ss')
    expect(combine('s', 's')).toBe('ss')
  })

  it('punnettGrid: 双杂交 16 格、独立分配 1:2:1 x 1:2:1、测交无纯合显', () => {
    const grid = punnettGrid(g('Bb', 'Ss'), g('Bb', 'Ss'))
    expect(grid.length).toBe(16)
    const colors = grid.map((c) => c.color)
    expect(colors.filter((c) => c === 'BB').length).toBe(4)
    expect(colors.filter((c) => c === 'Bb').length).toBe(8)
    expect(colors.filter((c) => c === 'bb').length).toBe(4)
    expect(grid.filter((c) => genesString(c) === 'Bb Ss').length).toBe(4)
    expect(grid.filter((c) => genesString(c) === 'BB ss').length).toBe(1)
    // 独立分配：毛型分布不受毛色影响（每个毛色格内 S 比例一致）。
    const black = grid.filter((c) => c.color !== 'bb')
    expect(black.filter((c) => c.fur === 'ss').length).toBe(3)
    // 测交 Bb x bb：不可能出现 BB。
    const test = punnettGrid(g('Bb', 'Ss'), g('bb', 'ss'))
    expect(test.every((c) => c.color !== 'BB')).toBe(true)
    expect(new Set(test.map((c) => genesString(c))).size).toBe(4)
  })

  it('phenotype: 显隐性映射（B 对 b 显、S 对 s 显）', () => {
    expect(phenotype(g('BB', 'SS'))).toEqual({ black: true, longFur: false })
    expect(phenotype(g('Bb', 'Ss'))).toEqual({ black: true, longFur: false })
    expect(phenotype(g('bb', 'SS'))).toEqual({ black: false, longFur: false })
    expect(phenotype(g('bb', 'ss'))).toEqual({ black: false, longFur: true })
    expect(phenotype(g('BB', 'ss'))).toEqual({ black: true, longFur: true })
    expect(genesString(g('Bb', 'ss'))).toBe('Bb ss')
  })

  it('litterOf/offspringStats: 每窝 4 仔取自方格、seed 确定性复放、频率合计 1', () => {
    const a = g('Bb', 'Ss')
    const b = g('Bb', 'Ss')
    const grid = punnettGrid(a, b)
    const labels = new Set(grid.map((c) => genesString(c)))
    const pups1 = litterOf(mulberry32(7), a, b)
    const pups2 = litterOf(mulberry32(7), a, b)
    expect(pups1.map(genesString)).toEqual(pups2.map(genesString))
    expect(pups1.length).toBe(LITTER_SIZE)
    for (const pup of pups1) expect(labels.has(genesString(pup))).toBe(true)
    // 不同种子给出不同窝序（在 2..40 内确定性地找一对）。
    let diffSeed = -1
    for (let s = 8; s <= 40; s += 1) {
      const other = litterOf(mulberry32(s), a, b).map(genesString)
      if (other.join() !== pups1.map(genesString).join()) { diffSeed = s; break }
    }
    expect(diffSeed).toBeGreaterThan(0)
    // 频率表：合计 1、降序、与占格数一致。
    const stats = offspringStats(a, b)
    expect(stats.reduce((sum, s) => sum + s.count, 0)).toBe(16)
    expect(stats.reduce((sum, s) => sum + s.frac, 0)).toBeCloseTo(1)
    expect(stats[0]!.label).toBe('Bb Ss')
    expect(stats[0]!.count).toBe(4)
    expect(stats[0]!.frac).toBe(0.25)
    for (let i = 1; i < stats.length; i += 1) expect(stats[i]!.count).toBeLessThanOrEqual(stats[i - 1]!.count)
    // 测交频率：各 4/16。
    const tc = offspringStats(g('Bb', 'Ss'), g('bb', 'ss'))
    expect(tc.every((s) => s.count === 4)).toBe(true)
  })

  it('buildLevel: 5 关规格、下标钳制、起始兔群不自带解（开局不判胜）', () => {
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const data = buildLevel(lv)
      expect(data.level).toBe(lv)
      expect(data.capacity).toBeGreaterThanOrEqual(7)
      expect(data.genLimit).toBeGreaterThanOrEqual(5)
      expect(data.start.length).toBeGreaterThanOrEqual(3)
      const state = newGame(data)
      expect(isWinning(state)).toBe(false)
      expect(state.phase).toBe('play')
      expect(state.selected).toEqual([])
    }
    expect(buildLevel(-3).level).toBe(0)
    expect(buildLevel(99).level).toBe(LEVEL_COUNT - 1)
    // 递进：第 5 关为双目标且容量收紧。
    expect(buildLevel(3).target2).toBeNull()
    expect(buildLevel(4).target2).not.toBeNull()
    expect(buildLevel(4).capacity).toBe(7)
    expect(buildLevel(4).genLimit).toBeGreaterThan(buildLevel(0).genLimit)
  })

  it('toggleSelect: 点兔切换、最多 2 只、已选取消、非进行中拒绝', () => {
    const state = newGame(buildLevel(0))
    expect(toggleSelect(state, 0)).toBe(true)
    expect(toggleSelect(state, 1)).toBe(true)
    expect(state.selected).toEqual([0, 1])
    // 已选满 2 只时点第三只被拒。
    expect(toggleSelect(state, 2)).toBe(false)
    // 再点已选的取消。
    expect(toggleSelect(state, 0)).toBe(true)
    expect(state.selected).toEqual([1])
    // 不存在的 id 拒绝。
    expect(toggleSelect(state, 99)).toBe(false)
    state.phase = 'won'
    expect(toggleSelect(state, 1)).toBe(false)
  })

  it('breed: 追加 4 仔、清空选择、亲本仍在场、代数计数、前置条件守卫', () => {
    const state = newGame(buildLevel(0))
    // 未选满 2 只不能配。
    expect(breed(state, mulberry32(1))).toBeNull()
    toggleSelect(state, 0)
    expect(breed(state, mulberry32(1))).toBeNull()
    toggleSelect(state, 1)
    const before = state.rabbits.map((r) => r.id)
    const pups = breed(state, mulberry32(11))
    expect(pups).not.toBeNull()
    expect(pups!.length).toBe(LITTER_SIZE)
    expect(state.rabbits.length).toBe(before.length + LITTER_SIZE)
    expect(state.breeds).toBe(1)
    expect(state.selected).toEqual([])
    // 亲本不被消耗。
    expect(state.rabbits.map((r) => r.id)).toEqual(expect.arrayContaining(before))
    // 空位不足 4 拒绝（容量 8，在场 7 时）。
    // 目标 ss 不可达（亲本含 SS，ss 仔不可能出现），保证停留在进行中验证容量守卫。
    const tight = newGame(level([g('Bb', 'Ss'), g('Bb', 'SS'), g('BB', 'Ss')], { color: 'any', fur: 'ss' }, null, 99, 8))
    let rng = mulberry32(5)
    // 首窝：3 + 4 = 7，剩 1 个空位。配种后选择被清空，重新选亲本。
    expect(tight.selected).toEqual([])
    expect(breedPair(tight, rng, 0, 1)).not.toBeNull()
    expect(tight.rabbits.length).toBe(7)
    // 空位 1 < 4：拒绝配种。
    expect(breedPair(tight, rng, 0, 1)).toBeNull()
    expect(tight.breeds).toBe(1)
    // 放归 3 只（腾出 4 个空位）后可再配。
    for (const victim of tight.rabbits.slice(4)) expect(release(tight, victim.id)).toBe(true)
    expect(tight.rabbits.length).toBe(4)
    expect(breedPair(tight, rng, 0, 1)).not.toBeNull()
    expect(tight.rabbits.length).toBe(8)
  })

  it('release: 放归不可找回、选中清理、至少保留 2 只、计放归数', () => {
    const state = newGame(level([g('Bb', 'Ss'), g('Bb', 'SS'), g('BB', 'Ss')], { color: 'bb', fur: 'any' }))
    toggleSelect(state, 2)
    const released = state.rabbits[2]!.id
    expect(release(state, released)).toBe(true)
    expect(state.rabbits.some((r) => r.id === released)).toBe(false)
    expect(state.rabbits.length).toBe(2)
    expect(state.selected).toEqual([])
    expect(state.releases).toBe(1)
    // 只剩 2 只时拒绝放归（不足亲本）。
    expect(release(state, state.rabbits[0]!.id)).toBe(false)
    expect(state.releases).toBe(1)
    // 不存在的 id 拒绝。
    expect(release(state, 99)).toBe(false)
    state.phase = 'won'
    expect(release(state, 0)).toBe(false)
  })

  it('代数预算：用尽判负、末代达成仍过关（win 判定先于判负）', () => {
    // 构造 1 代预算关：Bb x Bb，找到首窝含 bb 的种子则胜、否则负。
    const data = level([g('Bb', 'Ss'), g('Bb', 'Ss')], { color: 'bb', fur: 'any' }, null, 1)
    let winSeed = -1
    let loseSeed = -1
    for (let s = 1; s <= 64; s += 1) {
      const st = newGame(data)
      const pups = breedPair(st, mulberry32(s), 0, 1)
      if (pups === null) throw new Error('breed should succeed on fresh state')
      const hasBb = pups.some((pu) => pu.color === 'bb')
      if (hasBb && winSeed === -1) winSeed = s
      if (!hasBb && loseSeed === -1) loseSeed = s
    }
    expect(winSeed).toBeGreaterThan(0)
    expect(loseSeed).toBeGreaterThan(0)
    const wonState = newGame(data)
    breedPair(wonState, mulberry32(winSeed), 0, 1)
    expect(wonState.phase).toBe('won')
    expect(wonState.breeds).toBe(1)
    const lostState = newGame(data)
    breedPair(lostState, mulberry32(loseSeed), 0, 1)
    expect(lostState.phase).toBe('failed')
    // 判负后不能再配。
    expect(breedPair(lostState, mulberry32(loseSeed), 0, 1)).toBeNull()
    // 多代耗尽：预算 3 的关卡连配 3 次不达标判负。
    const data3 = level([g('Bb', 'SS'), g('Bb', 'SS')], { color: 'BB', fur: 'ss' }, null, 3)
    const st3 = newGame(data3)
    const rng3 = mulberry32(2024)
    // 首先放归腾位……起始 2 只 + 预算 3 共需腾位，逐步配。
    for (let i = 0; i < 3; i += 1) {
      while (data3.capacity - st3.rabbits.length < LITTER_SIZE) {
        const victim = st3.rabbits.slice(2).find((r) => r.id >= 2)
        if (victim === undefined || !release(st3, victim.id)) break
      }
      breedPair(st3, rng3, 0, 1)
    }
    expect(st3.breeds).toBe(3)
    expect(st3.phase === 'failed' || st3.phase === 'won').toBe(true)
  })

  it('目标判定：表现型规格与基因型规格、双目标须两只不同兔', () => {
    expect(matchesTarget(g('BB', 'ss'), { color: 'black', fur: 'ss' })).toBe(true)
    expect(matchesTarget(g('Bb', 'ss'), { color: 'black', fur: 'ss' })).toBe(true)
    expect(matchesTarget(g('bb', 'ss'), { color: 'black', fur: 'ss' })).toBe(false)
    expect(matchesTarget(g('bb', 'Ss'), { color: 'bb', fur: 'any' })).toBe(true)
    expect(matchesTarget(g('Bb', 'ss'), { color: 'BB', fur: 'ss' })).toBe(false)
    expect(matchesTarget(g('BB', 'SS'), { color: 'any', fur: 'short' })).toBe(true)
    // 双目标：一只兔不能同时充当两条（即便规格相同）。
    const dualSame = level([g('bb', 'ss')], { color: 'bb', fur: 'ss' }, { color: 'bb', fur: 'ss' })
    expect(isWinning(newGame(dualSame))).toBe(false)
    const dualTwo = level([g('bb', 'ss'), g('bb', 'ss')], { color: 'bb', fur: 'ss' }, { color: 'bb', fur: 'ss' })
    expect(isWinning(newGame(dualTwo))).toBe(true)
    // 双目标不同规格：各一只即胜。
    const dual = level([g('BB', 'ss'), g('bb', 'ss'), g('Bb', 'Ss')], { color: 'BB', fur: 'ss' }, { color: 'bb', fur: 'ss' })
    expect(isWinning(newGame(dual))).toBe(true)
    const dualMiss = level([g('Bb', 'ss'), g('bb', 'ss'), g('Bb', 'Ss')], { color: 'BB', fur: 'ss' }, { color: 'bb', fur: 'ss' })
    expect(isWinning(newGame(dualMiss))).toBe(false)
    // 单目标：任意一只达标。
    const single = level([g('Bb', 'Ss'), g('bb', 'ss')], { color: 'any', fur: 'ss' })
    expect(isWinning(newGame(single))).toBe(true)
  })

  it('N seed x 全关可赢（贪心实测验证预算：配种次数均在 genLimit 内）', () => {
    const seeds = [1, 7, 42, 99, 2024, 31337, 55555, 88888]
    for (let lv = 0; lv < LEVEL_COUNT; lv += 1) {
      const data = buildLevel(lv)
      for (const seed of seeds) {
        const state = greedyPlay(data, seed)
        expect(state.phase).toBe('won')
        expect(state.breeds).toBeLessThanOrEqual(data.genLimit)
      }
    }
  })

  it('computeScore: 关卡与剩余代数加成、放归惩罚、下限 100', () => {
    expect(computeScore(4, 5, 0)).toBeGreaterThan(computeScore(0, 5, 0))
    expect(computeScore(2, 4, 0)).toBeGreaterThan(computeScore(2, 1, 0))
    expect(computeScore(2, 4, 6)).toBeLessThan(computeScore(2, 4, 0))
    expect(computeScore(0, 0, 9999)).toBe(100)
    expect(computeScore(0, 0, 0)).toBe(150)
  })
})
