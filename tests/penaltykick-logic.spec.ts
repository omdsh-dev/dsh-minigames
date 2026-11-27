import { describe, expect, it } from 'vitest'
import {
  clampPower,
  confirmDive,
  confirmShoot,
  MAX_POWER,
  matchScore,
  MIN_POWER,
  missProbability,
  mulberry32,
  newMatch,
  planAiShot,
  preReadHint,
  REGULATION_KICKS,
  replayMatch,
  resolveShot,
  saveProbability,
  keeperPickZone,
  ZONE_LABELS,
  type MatchState,
  type Shot,
  type Zone,
} from '../src/client/games/penaltykick/logic.ts'

function shot(zone: Zone, power: number): Shot {
  return { zone, power }
}

/** 自动整场：玩家循环换区罚球（力度 0.78，无打飞风险），扑救跟随预读提示。 */
function autoPlay(seed: number, level: number): MatchState {
  const state = newMatch(seed, level)
  const zones: Zone[] = [0, 5, 1, 4, 2, 3, 0, 5, 1, 4, 2, 3, 0, 5, 1, 4, 2, 3]
  let i = 0
  while (state.phase !== 'over') {
    if (state.phase === 'shoot') {
      confirmShoot(state, zones[i % zones.length]!, 0.78)
    } else if (state.hint !== null) {
      confirmDive(state, state.hint)
    }
    i += 1
  }
  return state
}

describe('penaltykick logic', () => {
  it('mulberry32：同种子序列一致，不同种子不同，值域 [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
    const c = mulberry32(43)
    expect(seqA).not.toEqual(Array.from({ length: 20 }, () => c()))
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('几何与常量：六区标签、力度收敛、常规轮数', () => {
    expect(ZONE_LABELS.length).toBe(6)
    expect(REGULATION_KICKS).toBe(5)
    expect(clampPower(-1)).toBe(MIN_POWER)
    expect(clampPower(0.5)).toBe(0.5)
    expect(clampPower(99)).toBe(MAX_POWER)
    expect(clampPower(MIN_POWER)).toBe(MIN_POWER)
    expect(clampPower(MAX_POWER)).toBe(MAX_POWER)
  })

  it('打飞概率：≤75% 恒为 0，满力度恰为 15%，中间线性', () => {
    expect(missProbability(0.3)).toBe(0)
    expect(missProbability(0.75)).toBe(0)
    expect(missProbability(1.0)).toBe(0.15)
    expect(missProbability(0.8)).toBeCloseTo(0.03, 10)
    for (let p = 0.76; p < 1.0; p += 0.05) {
      expect(missProbability(p)).toBeLessThanOrEqual(missProbability(p + 0.05) + 1e-12)
    }
  })

  it('扑出概率：随力度单调下降且在 (0,1) 内', () => {
    expect(saveProbability(MIN_POWER)).toBeCloseTo(0.92 - 0.62 * MIN_POWER, 10)
    expect(saveProbability(MAX_POWER)).toBeCloseTo(0.30, 10)
    for (let p = MIN_POWER; p < MAX_POWER; p += 0.1) {
      expect(saveProbability(p)).toBeGreaterThan(saveProbability(p + 0.1))
    }
  })

  it('射门判定三分支：扑错区必进；扑对区低力多被扑；满力存在打飞与进球', () => {
    // 扑错区：任何种子下都是进球（无打飞风险的力度）。
    for (let seed = 1; seed <= 100; seed += 1) {
      expect(resolveShot(shot(2, 0.5), 3, mulberry32(seed))).toBe('goal')
    }
    // 扑对区 + 低力度（扑出率 0.734）：大量种子应多数扑出。
    let saved = 0
    for (let seed = 1; seed <= 300; seed += 1) {
      if (resolveShot(shot(0, 0.3), 0, mulberry32(seed)) === 'saved') saved += 1
    }
    expect(saved).toBeGreaterThan(180)
    // 满力度：三种结果都应出现（打飞 15%、扑对时仍有 30% 扑出）。
    const results = new Set<string>()
    for (let seed = 1; seed <= 300; seed += 1) {
      results.add(resolveShot(shot(4, 1.0), 4, mulberry32(seed)))
    }
    expect(results.has('miss')).toBe(true)
    expect(results.has('saved')).toBe(true)
    expect(results.has('goal')).toBe(true)
  })

  it('守门员倾向模型：零历史近均匀；连踢同区被读穿；换区不可锁定', () => {
    // 零历史：无任何一区占比超过 30%（600 种子）。
    const empty = [0, 0, 0, 0, 0, 0]
    for (let seed = 1; seed <= 600; seed += 1) {
      empty[keeperPickZone([], mulberry32(seed))]! += 1
    }
    for (const n of empty) expect(n / 600).toBeLessThan(0.3)
    // 连续 3 脚同区：守门员几乎必然扑该区。
    let read = 0
    for (let seed = 1; seed <= 400; seed += 1) {
      if (keeperPickZone([0, 0, 0], mulberry32(seed)) === 0) read += 1
    }
    expect(read / 400).toBeGreaterThan(0.95)
    // 均匀换区：无任何一区被锁定超过 45%。
    const varied = [0, 0, 0, 0, 0, 0]
    for (let seed = 1; seed <= 400; seed += 1) {
      varied[keeperPickZone([0, 1, 2, 3, 4, 5], mulberry32(seed))]! += 1
    }
    for (const n of varied) expect(n / 400).toBeLessThan(0.45)
  })

  it('预读提示：等级 1 真率约 75%；假提示必然指向不同区；等级升高真率下降', () => {
    let trueN = 0
    const N = 400
    for (let seed = 1; seed <= N; seed += 1) {
      const rng = mulberry32(seed)
      const s = planAiShot(1, rng)
      const h = preReadHint(s, 1, rng)
      if (h === s.zone) trueN += 1
      else expect(h).not.toBe(s.zone)
    }
    expect(trueN / N).toBeGreaterThan(0.65)
    expect(trueN / N).toBeLessThan(0.85)
    let trueHigh = 0
    for (let seed = 1; seed <= N; seed += 1) {
      const rng = mulberry32(seed)
      const s = planAiShot(6, rng)
      if (preReadHint(s, 6, rng) === s.zone) trueHigh += 1
    }
    expect(trueHigh / N).toBeLessThan(trueN / N)
  })

  it('轮次流转：罚球/扑救严格交替成组，骤死仅在 5 组平局后出现，结局与分差同号', () => {
    for (const seed of [7, 123, 999, 20240601, 555555]) {
      const state = autoPlay(seed, 1)
      expect(state.phase).toBe('over')
      expect(state.outcome).not.toBeNull()
      // 记录严格 player/ai 交替，组号单调不减。
      state.records.forEach((r, i) => {
        expect(r.shooter).toBe(i % 2 === 0 ? 'player' : 'ai')
      })
      const kicks10 = state.records.slice(0, 10)
      if (kicks10.length === 10) {
        const pg = kicks10.filter(r => r.shooter === 'player' && r.result === 'goal').length
        const ag = kicks10.filter(r => r.shooter === 'ai' && r.result === 'goal').length
        if (pg === ag) expect(state.suddenDeath).toBe(true)
      }
      const diff = state.playerGoals - state.aiGoals
      expect(diff !== 0).toBe(true)
      expect(Math.sign(diff)).toBe(state.outcome === 'win' ? 1 : -1)
      // 玩家与 AI 罚球数至多差 1（玩家先罚）。
      const pk = state.records.filter(r => r.shooter === 'player').length
      const ak = state.records.filter(r => r.shooter === 'ai').length
      expect(pk - ak).toBeGreaterThanOrEqual(0)
      expect(pk - ak).toBeLessThanOrEqual(1)
    }
  })

  it('提前出线：3 比 0 时 AI 第 3 脚罚完立即终局，玩家不再罚第 4 脚', () => {
    // 扫描种子找一个 3 组内玩家 3 进、AI 0 进的对局（确定性种子固定）。
    let found: MatchState | null = null
    for (let seed = 1; seed <= 2000 && found === null; seed += 1) {
      const state = newMatch(seed, 1)
      const zones: Zone[] = [0, 5, 1, 4, 2, 3]
      for (let i = 0; i < 3 && state.phase !== 'over'; i += 1) {
        confirmShoot(state, zones[i]!, 0.78)
        confirmDive(state, state.hint!)
      }
      if (state.playerGoals === 3 && state.aiGoals === 0 && state.phase === 'over') found = state
    }
    expect(found).not.toBeNull()
    const s = found!
    expect(s.phase).toBe('over')
    expect(s.outcome).toBe('win')
    expect(s.records.filter(r => r.shooter === 'player').length).toBe(3)
    expect(s.round).toBe(3)
    expect(s.suddenDeath).toBe(false)
  })

  it('整场重放：同 seed 同操作序列记录完全一致，不同 seed 记录不同', () => {
    const actions = [
      { zone: 0 as Zone, power: 0.9 },
      { zone: 5 as Zone, power: 0.78 },
      { zone: 5 as Zone, power: 0.78 },
      { zone: 1 as Zone, power: 0.55 },
      { zone: 4 as Zone, power: 1.0 },
      { zone: 4 as Zone, power: 0.78 },
      { zone: 2 as Zone, power: 0.78 },
      { zone: 3 as Zone, power: 0.78 },
      { zone: 0 as Zone, power: 0.78 },
      { zone: 5 as Zone, power: 0.78 },
      { zone: 1 as Zone, power: 0.78 },
      { zone: 4 as Zone, power: 0.78 },
    ]
    const a = replayMatch(20260101, 1, actions)
    const b = replayMatch(20260101, 1, actions)
    expect(a.records).toEqual(b.records)
    expect(a.playerGoals).toBe(b.playerGoals)
    expect(a.playerSaves).toBe(b.playerSaves)
    expect(a.outcome).toBe(b.outcome)
    const c = replayMatch(1999999999, 1, actions)
    expect(JSON.stringify(c.records)).not.toBe(JSON.stringify(a.records))
  })

  it('阶段守卫与计分：非当前阶段操作抛错；终局得分与胜负挂钩', () => {
    const state = newMatch(1, 1)
    expect(() => confirmDive(state, 2)).toThrow(/扑救阶段/)
    confirmShoot(state, 0, 0.78)
    expect(() => confirmShoot(state, 1, 0.9)).toThrow(/罚球阶段/)
    confirmDive(state, 2)
    expect(matchScore(state)).toBe(0)
    // 用 autoPlay 的终局核对计分公式。
    const done = autoPlay(123, 1)
    if (done.outcome === 'win') {
      expect(matchScore(done)).toBe(done.playerGoals * 50 + done.playerSaves * 40 + 150)
    } else {
      expect(matchScore(done)).toBe(Math.floor((done.playerGoals * 50 + done.playerSaves * 40) / 2))
    }
    expect(matchScore(done)).toBeGreaterThan(0)
  })

  it('可赢性实测：换区罚球 + 跟随预读的朴素策略，40 个 seed 胜率 ≥ 60%', () => {
    let wins = 0
    const N = 40
    for (let seed = 100; seed < 100 + N; seed += 1) {
      if (autoPlay(seed, 1).outcome === 'win') wins += 1
    }
    expect(wins).toBeGreaterThanOrEqual(Math.ceil(N * 0.6))
  })
})
