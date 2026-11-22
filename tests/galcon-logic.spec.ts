/**
 * 星域征服 Galcon 逻辑测试：seed 确定性盘面（数量 / 不重叠 / 边界 /
 * 母星归属）、产兵 tick、选星与 50% 派兵结算、飞行到达对冲与占领、
 * 飞行耗时按距离、AI 决策确定性与回防 / 集火、胜负与超时判定、
 * 3 局积分流转、整局重放逐位一致。
 */
import { describe, it, expect } from 'vitest'
import {
  createGalcon, generatePlanets, selectPlanet, selectAllOwn, launchFleet,
  stepGalcon, aiMove, aiInterval, nextMatch, restartMatch, resolveArrival,
  fleetPos, planetById, planetGap, totalTroops, mulberry32,
  W, H, ROUND_MS, FLEET_SPEED, SEND_RATIO, MATCH_ROUNDS, AI_INTERVALS,
  type GalconState, type Fleet,
} from '../src/client/games/galcon/logic.ts'

/** 造一颗可控星球并替换盘面（测试专用）。 */
function craftState(planets: Partial<GalconState['planets'][number]>[], seed = 7): GalconState {
  const s = createGalcon(seed)
  s.planets = planets.map((p, i) => ({
    id: p.id ?? i + 1,
    x: p.x ?? 200 + i * 100,
    y: p.y ?? 300,
    r: p.r ?? 20,
    owner: p.owner ?? 'neutral',
    troops: p.troops ?? 10,
    prodRate: p.prodRate ?? 2,
  }))
  s.fleets = []
  s.selectedIds = []
  return s
}

describe('galcon logic', () => {
  it('盘面生成：12-16 颗、seed 确定性、互不重叠、在边界内、双方各一母星', () => {
    const a = generatePlanets(42, 0, 0)
    const b = generatePlanets(42, 0, 0)
    const c = generatePlanets(43, 0, 0)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
    expect(a.length).toBeGreaterThanOrEqual(12)
    expect(a.length).toBeLessThanOrEqual(16)
    for (const p of a) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(58)
      expect(p.x + p.r).toBeLessThanOrEqual(W - 58)
      expect(p.y - p.r).toBeGreaterThanOrEqual(98)
      expect(p.y + p.r).toBeLessThanOrEqual(H - 68)
      expect(p.prodRate).toBeCloseTo(p.r / 10, 9)
    }
    for (let i = 0; i < a.length; i += 1) {
      for (let j = i + 1; j < a.length; j += 1) {
        const d = Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y)
        expect(d).toBeGreaterThanOrEqual(a[i]!.r + a[j]!.r + 20)
      }
    }
    expect(a.filter((p) => p.owner === 'player')).toHaveLength(1)
    expect(a.filter((p) => p.owner === 'ai')).toHaveLength(1)
    const player = a.find((p) => p.owner === 'player')!
    const ai = a.find((p) => p.owner === 'ai')!
    expect(player.x).toBeLessThan(ai.x)
    expect(player.troops).toBe(40 + Math.round(player.r))
    for (const p of a.filter((q) => q.owner === 'neutral')) {
      expect(p.troops).toBe(Math.round(p.r * 1.1))
    }
  })

  it('产兵 tick：归属方按速率增长、中立星不产、累计符合 dt 积分', () => {
    const s = craftState([
      { id: 1, owner: 'player', troops: 100, prodRate: 3 },
      { id: 2, owner: 'ai', troops: 50, prodRate: 2 },
      { id: 3, owner: 'neutral', troops: 20, prodRate: 2 },
    ])
    for (let i = 0; i < 10; i += 1) stepGalcon(s, 100)
    expect(s.planets[0]!.troops).toBeCloseTo(100 + 3, 6)
    expect(s.planets[1]!.troops).toBeCloseTo(50 + 2, 6)
    expect(s.planets[2]!.troops).toBe(20)
  })

  it('选星交互：点己方选中、再点同星全选、点敌方/中立不可选中', () => {
    const s = craftState([
      { id: 1, owner: 'player', troops: 40 },
      { id: 2, owner: 'player', troops: 30 },
      { id: 3, owner: 'ai', troops: 30 },
      { id: 4, owner: 'neutral', troops: 10 },
    ])
    expect(selectPlanet(s, 3)).toBe('none')
    expect(selectPlanet(s, 4)).toBe('none')
    expect(selectPlanet(s, 1)).toBe('select')
    expect(s.selectedIds).toEqual([1])
    expect(selectPlanet(s, 1)).toBe('selectAll')
    expect(new Set(s.selectedIds)).toEqual(new Set([1, 2]))
    // 目标点击 → 派兵并清空选中。
    expect(selectPlanet(s, 4)).toBe('launch')
    expect(s.selectedIds).toEqual([])
    expect(s.fleets).toHaveLength(2)
    selectAllOwn(s)
    expect(new Set(s.selectedIds)).toEqual(new Set([1, 2]))
  })

  it('50% 派兵结算：向下取整、源星扣减、少于 1 兵不派', () => {
    const s = craftState([
      { id: 1, owner: 'player', troops: 55, x: 100 },
      { id: 2, owner: 'player', troops: 1, x: 300 },
      { id: 3, owner: 'neutral', troops: 10, x: 500 },
    ])
    const sent = launchFleet(s, [1, 2], 3)
    expect(sent).toBe(27)
    expect(s.planets[0]!.troops).toBe(28)
    expect(s.planets[1]!.troops).toBe(1)
    expect(s.fleets).toHaveLength(1)
    const f = s.fleets[0]!
    expect(f.count).toBe(27)
    expect(f.fromId).toBe(1)
    expect(f.toId).toBe(3)
    expect(SEND_RATIO).toBe(0.5)
  })

  it('到达结算：己方星叠加；敌方星对冲，正差占领、不足则只减兵', () => {
    const s = craftState([
      { id: 1, owner: 'player', troops: 0 },
      { id: 2, owner: 'ai', troops: 30 },
      { id: 3, owner: 'neutral', troops: 12 },
    ])
    resolveArrival(s, { id: 9, owner: 'player', fromId: 1, toId: 1, count: 15, elapsedMs: 0, totalMs: 1 })
    expect(s.planets[0]!.troops).toBe(15)
    // 攻 40 vs 守 30 → 占领，剩余 10。
    resolveArrival(s, { id: 10, owner: 'player', fromId: 1, toId: 2, count: 40, elapsedMs: 0, totalMs: 1 })
    expect(s.planets[1]!.owner).toBe('player')
    expect(s.planets[1]!.troops).toBe(10)
    // 攻 5 vs 守 12 → 失败，仅减兵。
    resolveArrival(s, { id: 11, owner: 'player', fromId: 1, toId: 3, count: 5, elapsedMs: 0, totalMs: 1 })
    expect(s.planets[2]!.owner).toBe('neutral')
    expect(s.planets[2]!.troops).toBe(7)
  })

  it('飞行耗时与位置插值：耗时=球面距离/速度，位置随进度线性推进', () => {
    // AI 星设为 1 兵 / 0 产能：aiMove 门槛（15 兵）不满足，避免测试中
    // AI 自行出击干扰断言。
    const s = craftState([
      { id: 1, owner: 'player', troops: 100, x: 100, y: 300, r: 20 },
      { id: 2, owner: 'ai', troops: 1, prodRate: 0, x: 500, y: 300, r: 30 },
    ])
    launchFleet(s, [1], 2)
    const f = s.fleets[0]!
    expect(f.totalMs).toBeCloseTo((planetGap(s.planets[0]!, s.planets[1]!) / FLEET_SPEED) * 1000, 6)
    // 半程：位置在中点。
    f.elapsedMs = f.totalMs / 2
    const mid = fleetPos(s, f)
    expect(mid.x).toBeCloseTo(300, 6)
    expect(mid.y).toBeCloseTo(300, 6)
    // 推进到位 → 舰队消失、目标被对冲。
    f.elapsedMs = 0
    for (let i = 0; i < 200 && s.fleets.includes(f); i += 1) stepGalcon(s, 100)
    expect(s.fleets).toHaveLength(0)
    expect(s.planets[1]!.owner).toBe('player')
  })

  it('AI 决策：同状态同决策、受攻回防、集火最弱、间隔随局号递减', () => {
    // 场景 A：AI 星 2 被玩家舰队威胁（incoming 80 > 可防守） → 最强
    // AI 星 3 回防（派 50% 到 2）。
    const a = craftState([
      { id: 1, owner: 'player', troops: 200 },
      { id: 2, owner: 'ai', troops: 10, x: 400 },
      { id: 3, owner: 'ai', troops: 60, x: 700 },
      { id: 4, owner: 'neutral', troops: 8, x: 200 },
    ])
    a.fleets.push({ id: 50, owner: 'player', fromId: 1, toId: 2, count: 80, elapsedMs: 0, totalMs: 5000 })
    const a1 = JSON.parse(JSON.stringify(a)) as GalconState
    const a2 = JSON.parse(JSON.stringify(a)) as GalconState
    expect(aiMove(a1)).toBe(true)
    expect(aiMove(a2)).toBe(true)
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2))
    const rein = a1.fleets.find((f) => f.owner === 'ai')!
    expect(rein.toId).toBe(2)
    expect(rein.fromId).toBe(3)
    expect(rein.count).toBe(30)
    // 场景 B：无威胁 → 集火兵力最少的中立星 4（8 兵）。
    const b = craftState([
      { id: 1, owner: 'player', troops: 200, x: 100 },
      { id: 2, owner: 'ai', troops: 10, x: 400 },
      { id: 3, owner: 'ai', troops: 60, x: 700 },
      { id: 4, owner: 'neutral', troops: 8, x: 200 },
    ])
    expect(aiMove(b)).toBe(true)
    const atk = b.fleets.find((f) => f.owner === 'ai')!
    expect(atk.toId).toBe(4)
    expect(atk.count).toBe(30)
    // 最强源星兵力不足 15 时不进攻。
    const c = craftState([
      { id: 1, owner: 'player', troops: 200 },
      { id: 2, owner: 'ai', troops: 14 },
    ])
    expect(aiMove(c)).toBe(false)
    // 决策间隔随局号递减，stepGalcon 恰按间隔触发一次决策。
    expect(AI_INTERVALS).toHaveLength(MATCH_ROUNDS)
    expect(aiInterval(0)).toBeGreaterThan(aiInterval(1))
    expect(aiInterval(1)).toBeGreaterThan(aiInterval(2))
    const d = craftState([
      { id: 1, owner: 'ai', troops: 100, prodRate: 0 },
      { id: 2, owner: 'neutral', troops: 5, prodRate: 0 },
      { id: 3, owner: 'player', troops: 60, prodRate: 0 },
    ], 3)
    const fleetsBefore = d.fleets.length
    stepGalcon(d, aiInterval(0) - 1)
    expect(d.fleets.length).toBe(fleetsBefore)
    stepGalcon(d, 1)
    expect(d.fleets.length).toBe(fleetsBefore + 1)
  })

  it('胜负判定：全图归一（含在途）判胜并计分，玩家全灭判负', () => {
    const win = craftState([
      { id: 1, owner: 'player', troops: 50 },
      { id: 2, owner: 'neutral', troops: 5 },
    ])
    for (let i = 0; i < 5 && win.phase === 'playing'; i += 1) stepGalcon(win, 1000)
    // 中立星无产兵：50 兵远超 5，占领后全图归一。
    expect(win.phase).toBe('won')
    expect(win.results).toEqual(['win'])
    expect(win.totalScore).toBe(100 + Math.round(totalTroops(win, 'player')))
    const lose = craftState([{ id: 1, owner: 'ai', troops: 5 }])
    stepGalcon(lose, 100)
    expect(lose.phase).toBe('lost')
    expect(lose.results).toEqual(['loss'])
    expect(lose.totalScore).toBe(0)
  })

  it('超时判定：roundMs 达上限按总兵力（星+在途）多者胜，平兵判负', () => {
    const more = craftState([
      { id: 1, owner: 'player', troops: 90 },
      { id: 2, owner: 'ai', troops: 30 },
    ])
    more.roundMs = ROUND_MS - 10
    stepGalcon(more, 20)
    expect(more.phase).toBe('won')
    const fewer = craftState([
      { id: 1, owner: 'player', troops: 20 },
      { id: 2, owner: 'ai', troops: 30 },
    ])
    fewer.roundMs = ROUND_MS - 10
    stepGalcon(fewer, 20)
    expect(fewer.phase).toBe('lost')
    const tie = craftState([
      { id: 1, owner: 'player', troops: 30 },
      { id: 2, owner: 'ai', troops: 30 },
    ])
    tie.roundMs = ROUND_MS - 10
    stepGalcon(tie, 20)
    expect(tie.phase).toBe('lost')
  })

  it('3 局流转：nextMatch 保留积分换盘，满 3 局 matchOver，restartMatch 清零', () => {
    const s = createGalcon(99)
    // 模拟 finishRound 已写入的首局结果。
    s.results = ['win']
    s.phase = 'won'
    s.totalScore = 250
    const planets1 = JSON.stringify(s.planets)
    nextMatch(s)
    expect(s.matchIndex).toBe(1)
    expect(s.phase).toBe('playing')
    expect(s.totalScore).toBe(250)
    expect(JSON.stringify(s.planets)).not.toBe(planets1)
    s.results = ['win', 'loss', 'win']
    nextMatch(s)
    expect(s.phase).toBe('matchOver')
    restartMatch(s)
    expect(s.results).toEqual([])
    expect(s.totalScore).toBe(0)
    expect(s.matchIndex).toBe(0)
    expect(s.phase).toBe('playing')
    expect(s.attempt).toBe(1)
  })

  it('整局重放确定性：同 seed 同输入序列两份状态逐位一致', () => {
    const run = (): string => {
      const s = createGalcon(2024)
      let flip = true
      for (let i = 0; i < 3000 && s.phase === 'playing'; i += 1) {
        if (i % 60 === 0) {
          // 玩家策略：轮换选第一颗己方星打最弱非己方星。
          const own = s.planets.filter((p) => p.owner === 'player')
          const foes = s.planets.filter((p) => p.owner !== 'player')
          if (own.length > 0 && foes.length > 0) {
            const src = flip ? own[0]! : own[own.length - 1]!
            flip = !flip
            let tgt = foes[0]!
            for (const f of foes) if (f.troops < tgt.troops) tgt = f
            selectPlanet(s, src.id)
            selectPlanet(s, tgt.id)
          }
        }
        stepGalcon(s, 50)
      }
      return JSON.stringify(s)
    }
    const a = run()
    const b = run()
    expect(a).toBe(b)
    // mulberry32 本身同 seed 一致、异 seed 不同。
    const seq = (seed: number): number[] => Array.from({ length: 6 }, () => mulberry32(seed)())
    expect(seq(5)).toEqual(seq(5))
    expect(seq(5)).not.toEqual(seq(6))
    // 重放至少完整打完或接近超时（非卡死空转）。
    const parsed = JSON.parse(a) as GalconState
    expect(parsed.roundMs).toBeGreaterThan(10000)
  })
})
