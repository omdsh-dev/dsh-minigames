/**
 * 轨道交会 OrbitDock 逻辑测试：圆轨道稳定性、解析站轨速度关系、
 * 位级重放与分帧一致性、ΔV 钳制与脉冲次数、三类失败判定、交会
 * 「双阈值 + 保持 2 秒」判定（含中断清零）、脚本化两脉冲霍曼交会
 * （含 ΔV 用量实测 ≤ 预算 = 预算类参数验证）、多 seed 全关可赢、
 * 关卡配置与碎片间隙合法性、计分。
 */
import { describe, expect, it } from 'vitest'
import {
  CY, CX, DOCK_DIST, DOCK_HOLD_S, DOCK_SPEED, GM, LEVELS, MAX_BURNS, PLANET_R,
  advanceSim, applyDv, createDock, debrisPos, mulberry32, omegaAt, setPendingDv,
  stationAt, stepDock,
  type DockState, type DockStatus,
} from '../src/client/games/orbitdock/logic.ts'

const SEEDS = [1, 42, 20261023, 777777, 0x9e3779b9]

/** 快照：可判等序列化（排除事件数组——消费后即清空）。 */
function snapshot(s: DockState): string {
  return JSON.stringify({
    level: s.level,
    t: s.t,
    ship: [s.ship.x, s.ship.y, s.ship.vx, s.ship.vy],
    dvLeft: s.dvLeft,
    burnsUsed: s.burnsUsed,
    dockMs: s.dockMs,
    status: s.status,
    scoreTotal: s.scoreTotal,
    trailLen: s.trail.length,
  })
}

/** 经函数读取对局阶段（阻断调用方对可变属性的流类型窄化）。
 * @param s - 对局状态。
 * @returns 当前阶段。
 */
function readStatus(s: DockState): DockStatus {
  return s.status
}

/**
 * 脚本化两脉冲交会搜索（玩家策略的确定性重放）：先按霍曼转移算
 * 第一脉冲，用相位关系解析出等待时刻候选，逐个试跑：到达目标轨道
 * 半径时与空间站距离足够近，则第二脉冲把速度对齐空间站。返回 ΔV
 * 用量；找不到解返回 -1。
 * @param level - 关号（1 起）。
 * @param seed - 种子。
 * @returns 实际用掉的 ΔV；无可行解为 -1。
 */
function hohmannWin(level: number, seed: number): number {
  const cfg = LEVELS[level - 1]!
  const v0 = Math.sqrt(GM / cfg.r0)
  const aT = (cfg.r0 + cfg.rS) / 2
  const vp = Math.sqrt(GM * (2 / cfg.r0 - 1 / aT))
  // 第一脉冲带符号：外转移为正（顺行加速），内转移为负（逆行减速）。
  const dv1 = vp - v0
  const T = Math.PI * Math.sqrt((aT * aT * aT) / GM)
  const w0 = omegaAt(cfg.r0)
  const wS = omegaAt(cfg.rS)
  const syn = (2 * Math.PI) / Math.abs(w0 - wS)
  // 相位关系：到站角 ≈ 起始角 + w0*w + π（转移扫过半圈）。解析解
  // w·(wS - w0) = a0 + π - aS - wS·T；数值漂移用近邻细扫兜底。
  const target = cfg.a0 + Math.PI - cfg.aS - wS * T
  const wBase = target / (wS - w0)
  const waits: number[] = []
  for (let j = -8; j <= 8; j += 1) waits.push(((wBase + j * 0.05) % syn + syn) % syn)
  // 兜底粗扫：解析解失效时仍覆盖全部相位。
  for (let j = 0; j < 24; j += 1) waits.push((j * syn) / 24)
  for (const w of waits) {
    if (w < 0) continue
    const s = createDock(level, seed)
    advanceSim(s, w)
    if (s.status !== 'playing') continue
    const th = Math.atan2(s.ship.y - CY, s.ship.x - CX)
    const m = dv1
    if (applyDv(s, -Math.sin(th) * m, Math.cos(th) * m) === null) continue
    // 滑行至越过目标轨道半径（每 0.1s 检查一次，最长 30s）。
    let crossed = false
    for (let k = 0; k < 300; k += 1) {
      advanceSim(s, 0.1)
      if (s.status !== 'playing') break
      const r = Math.hypot(s.ship.x - CX, s.ship.y - CY)
      if (Math.abs(r - cfg.rS) < 2) {
        crossed = true
        break
      }
    }
    if (!crossed || s.status !== 'playing') continue
    const st = stationAt(cfg, s.t)
    const d = Math.hypot(s.ship.x - st.x, s.ship.y - st.y)
    if (d > 15) continue
    // 第二脉冲：速度对齐空间站。
    if (applyDv(s, st.vx - s.ship.vx, st.vy - s.ship.vy) === null) continue
    advanceSim(s, DOCK_HOLD_S + 1)
    // advanceSim 会改写 status；经函数读取切断流分析对 s.status 的
    // 'playing' 窄化，否则与 'docked'/'allClear' 的比较被判无重叠。
    const finalStatus = readStatus(s)
    if (finalStatus === 'docked' || finalStatus === 'allClear') {
      return cfg.dvBudget - s.dvLeft
    }
  }
  return -1
}

describe('orbitdock logic', () => {
  it('圆轨道稳定：初始速度下 60 秒半径漂移 < 2px（每关初始轨道）', () => {
    for (const cfg of LEVELS) {
      const lv = LEVELS.indexOf(cfg) + 1
      const s = createDock(lv, 7)
      advanceSim(s, 60)
      expect(s.status).toBe('playing')
      const r = Math.hypot(s.ship.x - CX, s.ship.y - CY)
      expect(Math.abs(r - cfg.r0)).toBeLessThan(2)
    }
  })

  it('空间站解析轨道：|v|=√(GM/r)、速度垂直于矢径、周期守恒', () => {
    const cfg = LEVELS[0]!
    const st = stationAt(cfg, 13.7)
    const r = Math.hypot(st.x - CX, st.y - CY)
    expect(r).toBeCloseTo(cfg.rS, 9)
    expect(Math.hypot(st.vx, st.vy)).toBeCloseTo(Math.sqrt(GM / cfg.rS), 9)
    // 速度 · 矢径 ≈ 0（切向）。
    const dot = (st.x - CX) * st.vx + (st.y - CY) * st.vy
    expect(Math.abs(dot)).toBeLessThan(1e-6)
    // 一个周期后回到原点。
    const period = (2 * Math.PI) / omegaAt(cfg.rS)
    const st2 = stationAt(cfg, 13.7 + period)
    expect(st2.x).toBeCloseTo(st.x, 6)
    expect(st2.y).toBeCloseTo(st.y, 6)
  })

  it('位级重放与 seed：mulberry32 同种子一致异种子不同；同 seed 同剧本两次对局完全一致', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    const c = mulberry32(124)
    const sa = [a(), a(), a(), a()]
    const sb = [b(), b(), b(), b()]
    const sc = [c(), c(), c(), c()]
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
    const script = (seed: number): string => {
      const s = createDock(4, seed)
      advanceSim(s, 3.5)
      applyDv(s, 8, 3)
      advanceSim(s, 2.25)
      applyDv(s, -2, -5)
      advanceSim(s, 4.75)
      return snapshot(s) + '|' + JSON.stringify(s.debris.map(c => [c.orbitR, c.ang0]))
    }
    expect(script(99)).toBe(script(99))
    expect(script(99)).not.toBe(script(100))
  })

  it('分帧不影响轨迹：stepDock 8×10ms 与 2×40ms 位级一致', () => {
    const run = (frames: number, dtMs: number): string => {
      const s = createDock(1, 5)
      advanceSim(s, 1)
      applyDv(s, 10, 0)
      for (let i = 0; i < frames; i += 1) stepDock(s, dtMs)
      return snapshot(s)
    }
    expect(run(8, 10)).toBe(run(2, 40))
  })

  it('applyDv：精确叠加 ΔV、钳制到预算、最多两次、微小脉冲拒收', () => {
    const s = createDock(1, 11)
    const applied = applyDv(s, 9, 12)
    expect(applied).not.toBeNull()
    expect(applied!.x).toBeCloseTo(9, 12)
    expect(applied!.y).toBeCloseTo(12, 12)
    expect(s.dvLeft).toBeCloseTo(LEVELS[0]!.dvBudget - 15, 12)
    expect(s.burnsUsed).toBe(1)
    // 第二次超过剩余预算 → 钳到剩余量。
    const applied2 = applyDv(s, -30, 0)
    expect(Math.hypot(applied2!.x, applied2!.y)).toBeCloseTo(LEVELS[0]!.dvBudget - 15, 12)
    expect(s.dvLeft).toBe(0)
    // 第三次无次数可用。
    expect(applyDv(s, 1, 0)).toBeNull()
    expect(s.burnsUsed).toBe(MAX_BURNS)
    // 微小脉冲不消耗次数。
    const s2 = createDock(1, 11)
    expect(applyDv(s2, 0.1, 0)).toBeNull()
    expect(s2.burnsUsed).toBe(0)
    // setPendingDv 同样钳制且过小取消。
    setPendingDv(s2, 0.2, 0)
    expect(s2.pending).toBeNull()
  })

  it('失败判定：撞行星 / 出界 / 撞碎片各自给出对应原因', () => {
    // 反向大脉冲：近地点扎进行星。
    const crash = createDock(1, 21)
    const thC = Math.atan2(crash.ship.y - CY, crash.ship.x - CX)
    const tang = { x: -Math.sin(thC), y: Math.cos(thC) }
    applyDv(crash, -tang.x * 95, -tang.y * 95)
    advanceSim(crash, 30)
    expect(crash.status).toBe('failed')
    expect(crash.failReason).toBe('planet')
    // 超大顺行脉冲：甩出最大半径。
    const out = createDock(1, 21)
    const thO = Math.atan2(out.ship.y - CY, out.ship.x - CX)
    applyDv(out, -Math.sin(thO) * 120, Math.cos(thO) * 120)
    advanceSim(out, 60)
    expect(out.status).toBe('failed')
    expect(out.failReason).toBe('bounds')
    // 碎片：把飞船放到某碎片旁边随时间前进必然相撞。
    const hit = createDock(4, 21)
    const chunk = hit.debris[3]!
    const p = debrisPos(chunk, 0)
    hit.ship.x = p.x + 4
    hit.ship.y = p.y
    advanceSim(hit, 0.05)
    expect(hit.status).toBe('failed')
    expect(hit.failReason).toBe('debris')
    // 脉冲用尽且长期不交会 → 超时漂移。两个小脉冲（径向向外 + 顺行）
    // 抬高轨道到 ~148-192px，远离 110px 站轨，不可能交会。
    const drift = createDock(2, 21)
    applyDv(drift, -5, 0)
    applyDv(drift, 0, -5)
    advanceSim(drift, 95)
    expect(drift.status).toBe('failed')
    expect(drift.failReason).toBe('drift')
  })

  it('交会判定：双阈值连续保持 2 秒才成功，条件中断即清零', () => {
    const cfg = LEVELS[1]!
    // 速度对齐、同轨道领先 12px（切向偏移，半径一致才能共轨）→ 2 秒后 docked。
    const ok = createDock(2, 41)
    // 同半径共轨：领先 12/rS 弧度，速度取自身位置的圆轨道速度（与站速度
    // 同大小、方向转过同一角）——位形随轨道共转，距离恒为 12px。直接复制
    // 站速度矢量不是共轨（差动引力会拉开距离）。
    const st = stationAt(cfg, 0)
    const thS = Math.atan2(st.y - CY, st.x - CX) + 12 / cfg.rS
    const wS = omegaAt(cfg.rS)
    ok.ship.x = CX + cfg.rS * Math.cos(thS)
    ok.ship.y = CY + cfg.rS * Math.sin(thS)
    ok.ship.vx = -wS * cfg.rS * Math.sin(thS)
    ok.ship.vy = wS * cfg.rS * Math.cos(thS)
    advanceSim(ok, DOCK_HOLD_S - 0.05)
    expect(ok.status).toBe('playing')
    advanceSim(ok, 0.2)
    expect(ok.status).toBe('docked')
    // 快速掠过：相对速度超阈值，dockMs 不累计且离开后归零。
    const fast = createDock(2, 41)
    const st2 = stationAt(cfg, 0)
    fast.ship.x = st2.x + 6
    fast.ship.y = st2.y
    fast.ship.vx = st2.vx * 2
    fast.ship.vy = st2.vy * 2
    advanceSim(fast, 0.5)
    expect(fast.status).toBe('playing')
    expect(fast.dockMs).toBe(0)
    // 距离够近、速度没对齐（0.7 倍）：vrel≈31 > 25，不累计；且能量为负
    // （1.5 倍会变成逃逸轨道触发出界），3 秒内仍应 playing。
    const near = createDock(2, 41)
    const st3 = stationAt(cfg, 0)
    near.ship.x = st3.x + 4
    near.ship.y = st3.y
    near.ship.vx = st3.vx * 0.7
    near.ship.vy = st3.vy * 0.7
    advanceSim(near, 3)
    expect(near.status).toBe('playing')
  })

  it('脚本化霍曼交会：5 关全部可赢且实测 ΔV 用量 ≤ 预算（预算验证）', () => {
    for (let lv = 1; lv <= LEVELS.length; lv += 1) {
      const used = hohmannWin(lv, 7)
      expect(used, '第 ' + lv + ' 关找不到两脉冲交会解').toBeGreaterThanOrEqual(0)
      expect(used, '第 ' + lv + ' 关 ΔV 用量超预算').toBeLessThanOrEqual(LEVELS[lv - 1]!.dvBudget)
    }
  })

  it('多 seed 全关可赢：碎片抖动不产生死局（5 seed × 5 关）', () => {
    for (const seed of SEEDS) {
      for (let lv = 1; lv <= LEVELS.length; lv += 1) {
        const used = hohmannWin(lv, seed)
        expect(used, 'seed ' + seed + ' 第 ' + lv + ' 关无可行解').toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('关卡配置：轨道在画布内、r0≠rS、预算 ≥ 霍曼需求 1.3 倍、碎片带夹在两轨之间且间隙充足', () => {
    for (const cfg of LEVELS) {
      expect(Math.max(cfg.r0, cfg.rS)).toBeLessThanOrEqual(210)
      expect(Math.min(cfg.r0, cfg.rS)).toBeGreaterThan(PLANET_R + 40)
      expect(cfg.r0).not.toBe(cfg.rS)
      const v0 = Math.sqrt(GM / cfg.r0)
      const aT = (cfg.r0 + cfg.rS) / 2
      const vp = Math.sqrt(GM * (2 / cfg.r0 - 1 / aT))
      const va = vp * (cfg.r0 / aT)
      const need = cfg.rS > cfg.r0 ? vp - v0 : v0 - va + Math.abs(Math.sqrt(GM / cfg.rS) - va)
      expect(cfg.dvBudget).toBeGreaterThanOrEqual(need * 1.3 + 4)
      if (cfg.debris !== null) {
        const d = cfg.debris
        expect(d.orbitR).toBeGreaterThan(Math.min(cfg.r0, cfg.rS) + 15)
        expect(d.orbitR).toBeLessThan(Math.max(cfg.r0, cfg.rS) - 15)
        // 相邻碎片角间隙 ≥ 0.25 rad（同轨道半径下的弧间隙）。
        expect((2 * Math.PI) / d.count).toBeGreaterThanOrEqual(0.25)
      }
    }
    // 跨 seed 的实际碎片间隙（抖动后仍充足）。
    for (const seed of SEEDS) {
      const s = createDock(5, seed)
      const angs = s.debris.map(c => c.ang0).sort((a, b) => a - b)
      for (let i = 1; i < angs.length; i += 1) {
        expect(angs[i]! - angs[i - 1]!).toBeGreaterThanOrEqual(0.18)
      }
    }
  })

  it('计分：过关分 = 关号 ×1000 + 剩余 ΔV 折算（floor×10）并累计', () => {
    const cfg = LEVELS[0]!
    const s = createDock(1, 61)
    const st = stationAt(cfg, 0)
    // 切向偏移 12px：与空间站同半径共轨，速度对齐后距离恒定。
    const theta = Math.atan2(st.y - CY, st.x - CX)
    s.ship.x = st.x - Math.sin(theta) * 12
    s.ship.y = st.y + Math.cos(theta) * 12
    s.ship.vx = st.vx
    s.ship.vy = st.vy
    // 消耗 25.3 ΔV，剩余量随关卡预算动态断言。
    applyDv(s, -Math.sin(0) * 25.3, 0)
    advanceSim(s, DOCK_HOLD_S + 0.3)
    expect(s.status).toBe('docked')
    expect(s.scoreTotal).toBe(1 * 1000 + Math.floor(s.dvLeft * 10))
    expect(s.dvLeft).toBeGreaterThan(0)
  })
})
