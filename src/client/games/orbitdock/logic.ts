/**
 * 轨道交会 OrbitDock 纯逻辑：飞船从圆轨道出发，全程只有两次脉冲变轨
 * 机会（受 ΔV 预算约束），目标是与沿圆轨道运行的空间站交会——距离
 * 与相对速度同时进入阈值并保持 2 秒。中心行星平方反比引力，飞船用
 * 固定子步（1/240 s）半隐式 Euler 积分，位级可重放；空间站与碎片带
 * 走解析圆轨道（角速度由开普勒第三定律给出）。撞行星 / 撞碎片 /
 * 飞出最大半径 / 超时未交会均判失败。所有随机（星点、碎片相位与
 * 半径抖动）来自注入 seed，同 seed 序列完全确定、可测。
 */

/** 逻辑画布宽度（渲染与逻辑共用坐标系）。 */
export const LOGICAL_W = 640
/** 逻辑画布高度。 */
export const LOGICAL_H = 480
/** 中心行星圆心（避开顶部 HUD 带）。 */
export const CX = 320
export const CY = 252
/** 行星碰撞半径（px）。 */
export const PLANET_R = 26
/** 飞船碰撞半径（px）。 */
export const SHIP_R = 5
/** 碎片可视 / 碰撞半径（px）。 */
export const DEBRIS_R = 6
/** 引力参数（px^3/s^2，配半径量级）。 */
export const GM = 1200000
/** 引力软化下限（px）：距离小于该值按该值算，防近场数值爆炸。 */
export const MIN_R = 20
/** 固定积分子步秒长：所有轨迹按此离散步进，保证位级可重放。 */
export const SUB_DT = 1 / 240
/** 子步毫秒数（帧循环累加器用）。 */
export const SUB_DT_MS = 1000 / 240
/** 每局最多脉冲次数。 */
export const MAX_BURNS = 2
/** 交会距离阈值（px）。 */
export const DOCK_DIST = 20
/** 交会相对速度阈值（px/s）。 */
export const DOCK_SPEED = 25
/** 交会需持续保持的秒数。 */
export const DOCK_HOLD_S = 2
/** 出界半径（px）：离心距离超过即失败。 */
export const MAX_R = 300
/** 单关最长模拟秒数：超时未交会判漂失失败。 */
export const MAX_SIM_S = 90
/** 关卡总数。 */
export const LEVEL_COUNT = 5

/** 一关的配置：初始 / 目标轨道与预算、碎片带。 */
export interface DockLevelConfig {
  /** 飞船初始圆轨道半径。 */
  r0: number
  /** 飞船初始相位角（弧度）。 */
  a0: number
  /** 空间站圆轨道半径。 */
  rS: number
  /** 空间站初始相位角（弧度）。 */
  aS: number
  /** 本关 ΔV 总预算（px/s）。 */
  dvBudget: number
  /** 碎片带：轨道半径与碎片数；null 表示无碎片。 */
  debris: { orbitR: number, count: number } | null
}

/** 五关递进：轨道半径组合变化、预算收紧、第 4/5 关加入碎片带。 */
export const LEVELS: readonly DockLevelConfig[] = [
  { r0: 120, a0: -Math.PI / 2, rS: 185, aS: Math.PI / 6, dvBudget: 40, debris: null },
  { r0: 150, a0: Math.PI, rS: 110, aS: 0, dvBudget: 30, debris: null },
  { r0: 120, a0: 0, rS: 200, aS: Math.PI * 0.7, dvBudget: 26, debris: null },
  { r0: 120, a0: -Math.PI / 3, rS: 185, aS: Math.PI, dvBudget: 32, debris: { orbitR: 150, count: 10 } },
  { r0: 135, a0: Math.PI / 2, rS: 195, aS: Math.PI * 1.2, dvBudget: 26, debris: { orbitR: 160, count: 12 } },
]

/** 对局结果阶段。 */
export type DockStatus = 'playing' | 'docked' | 'failed' | 'allClear'
/** 失败原因。 */
export type FailReason = 'planet' | 'debris' | 'bounds' | 'drift'

/** 一块碎片：解析圆轨道（半径带 seed 抖动），碰撞体为圆。 */
export interface DebrisChunk {
  orbitR: number
  ang0: number
  /** 角速度（rad/s，开普勒第三定律）。 */
  omega: number
}

/** 渲染 / 测试消费的事件（消费方负责清空）。 */
export interface DockEvent {
  type: 'burn' | 'fail' | 'clear'
  x: number
  y: number
  reason?: FailReason
}

/** 对局状态（可变对象；全部操作为确定性纯过程）。 */
export interface DockState {
  /** 当前关（1 起）。 */
  level: number
  /** 注入种子（碎片抖动 / 星点派生）。 */
  seed: number
  /** 模拟时间（秒，子步累计）。 */
  t: number
  /** 帧循环毫秒累加器（固定子步换算用）。 */
  accMs: number
  /** 已执行子步数。 */
  subCount: number
  /** 飞船位置与速度。 */
  ship: { x: number, y: number, vx: number, vy: number }
  /** 剩余 ΔV（px/s）。 */
  dvLeft: number
  /** 本关 ΔV 预算。 */
  dvBudget: number
  /** 已用脉冲次数（≤ MAX_BURNS）。 */
  burnsUsed: number
  /** 暂停中已设定的待执行脉冲（ΔV 分量）。 */
  pending: { x: number, y: number } | null
  /** 交会条件连续保持的秒数（中断清零）。 */
  dockMs: number
  status: DockStatus
  failReason: FailReason | null
  /** 轨迹抽样点（x,y 平铺，供渲染渐隐线）。 */
  trail: number[]
  /** 待消费事件。 */
  events: DockEvent[]
  /** 本关碎片带（无碎片为空数组）。 */
  debris: DebrisChunk[]
  /** 累计总分（过关时累加）。 */
  scoreTotal: number
}

/** mulberry32：注入用确定性伪随机源。
 * @param seed - 32 位种子。
 * @returns 返回 [0,1) 随机数的函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 圆轨道角速度（rad/s）。
 * @param r - 轨道半径（px）。
 * @returns sqrt(GM / r^3)。
 */
export function omegaAt(r: number): number {
  return Math.sqrt(GM / (r * r * r))
}

/** 空间站在时刻 t 的解析位置与速度。
 * @param cfg - 关卡配置。
 * @param t - 模拟秒。
 * @returns 位置与速度（切向）。
 */
export function stationAt(cfg: DockLevelConfig, t: number): { x: number, y: number, vx: number, vy: number } {
  const w = omegaAt(cfg.rS)
  const th = cfg.aS + w * t
  return {
    x: CX + cfg.rS * Math.cos(th),
    y: CY + cfg.rS * Math.sin(th),
    vx: -w * cfg.rS * Math.sin(th),
    vy: w * cfg.rS * Math.cos(th),
  }
}

/** 一块碎片在时刻 t 的解析位置。
 * @param chunk - 碎片。
 * @param t - 模拟秒。
 * @returns 位置。
 */
export function debrisPos(chunk: DebrisChunk, t: number): { x: number, y: number } {
  const th = chunk.ang0 + chunk.omega * t
  return { x: CX + chunk.orbitR * Math.cos(th), y: CY + chunk.orbitR * Math.sin(th) }
}

/** 星点背景（渲染用，seed 确定）。
 * @param seed - 种子。
 * @param count - 星点数。
 * @returns 星点数组。
 */
export function generateStarfield(seed: number, count = 110): { x: number, y: number, r: number, a: number }[] {
  const rng = mulberry32((seed ^ 0x51ab27) >>> 0)
  const stars: { x: number, y: number, r: number, a: number }[] = []
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: rng() * LOGICAL_W,
      y: rng() * LOGICAL_H,
      r: 0.4 + rng() * 0.9,
      a: 0.12 + rng() * 0.55,
    })
  }
  return stars
}

function fail(state: DockState, reason: FailReason, x: number, y: number): void {
  state.status = 'failed'
  state.failReason = reason
  state.events.push({ type: 'fail', x, y, reason })
}

function dockClear(state: DockState, x: number, y: number): void {
  state.scoreTotal += state.level * 1000 + Math.floor(state.dvLeft * 10)
  state.status = state.level >= LEVEL_COUNT ? 'allClear' : 'docked'
  state.events.push({ type: 'clear', x, y })
}

/** 创建一关对局。
 * @param level - 关号（1 起，越界钳回 [1, LEVEL_COUNT]）。
 * @param seed - 注入种子（碎片抖动派生）。
 * @returns 初始状态：飞船在 r0 圆轨道、模拟暂停在 t=0。
 */
export function createDock(level: number, seed: number): DockState {
  const lv = Math.min(LEVEL_COUNT, Math.max(1, Math.floor(level)))
  const cfg = LEVELS[lv - 1]!
  const rng = mulberry32((seed + lv * 7919) >>> 0)
  const debris: DebrisChunk[] = []
  if (cfg.debris !== null) {
    const base = cfg.debris
    for (let i = 0; i < base.count; i += 1) {
      const orbitR = base.orbitR + (rng() * 8 - 4)
      debris.push({
        orbitR,
        ang0: (i / base.count) * Math.PI * 2 + (rng() * 0.3 - 0.15),
        omega: omegaAt(orbitR),
      })
    }
  }
  const w0 = omegaAt(cfg.r0)
  const th = cfg.a0
  return {
    level: lv,
    seed,
    t: 0,
    accMs: 0,
    subCount: 0,
    ship: {
      x: CX + cfg.r0 * Math.cos(th),
      y: CY + cfg.r0 * Math.sin(th),
      vx: -w0 * cfg.r0 * Math.sin(th),
      vy: w0 * cfg.r0 * Math.cos(th),
    },
    dvLeft: cfg.dvBudget,
    dvBudget: cfg.dvBudget,
    burnsUsed: 0,
    pending: null,
    dockMs: 0,
    status: 'playing',
    failReason: null,
    trail: [],
    events: [],
    debris,
    scoreTotal: 0,
  }
}

/** 单个积分子步：半隐式 Euler + 判定（不导出，advanceSim/stepDock 共用）。 */
function substep(state: DockState): void {
  const cfg = LEVELS[state.level - 1]!
  const ship = state.ship
  const dx = ship.x - CX
  const dy = ship.y - CY
  const r = Math.hypot(dx, dy)
  const soft = Math.max(r, MIN_R)
  const g = -GM / (soft * soft * soft)
  ship.vx += g * dx * SUB_DT
  ship.vy += g * dy * SUB_DT
  ship.x += ship.vx * SUB_DT
  ship.y += ship.vy * SUB_DT
  state.t += SUB_DT
  state.subCount += 1
  if (state.subCount % 6 === 0) {
    state.trail.push(ship.x, ship.y)
    if (state.trail.length > 1200) state.trail.splice(0, state.trail.length - 1200)
  }
  const rNow = Math.hypot(ship.x - CX, ship.y - CY)
  if (rNow < PLANET_R + SHIP_R) {
    fail(state, 'planet', ship.x, ship.y)
    return
  }
  if (rNow > MAX_R) {
    fail(state, 'bounds', ship.x, ship.y)
    return
  }
  for (const chunk of state.debris) {
    const p = debrisPos(chunk, state.t)
    if (Math.hypot(ship.x - p.x, ship.y - p.y) < DEBRIS_R + SHIP_R) {
      fail(state, 'debris', p.x, p.y)
      return
    }
  }
  const st = stationAt(cfg, state.t)
  const d = Math.hypot(ship.x - st.x, ship.y - st.y)
  const vrel = Math.hypot(ship.vx - st.vx, ship.vy - st.vy)
  if (d <= DOCK_DIST && vrel <= DOCK_SPEED) {
    state.dockMs += SUB_DT
    // 480 次 1/240 累加得到的浮点和可能略小于 DOCK_HOLD_S，容差吸收该误差。
    if (state.dockMs >= DOCK_HOLD_S - 1e-9) {
      dockClear(state, st.x, st.y)
      return
    }
  } else {
    state.dockMs = 0
  }
  if (state.t > MAX_SIM_S) fail(state, 'drift', ship.x, ship.y)
}

/** 直接推进固定秒数（测试 / 剧本重放路径，不看运行开关）。
 * @param state - 对局状态。
 * @param seconds - 模拟秒数（按子步取整，确定性）。
 */
export function advanceSim(state: DockState, seconds: number): void {
  if (state.status !== 'playing' || seconds <= 0) return
  const n = Math.floor(seconds / SUB_DT + 1e-9)
  for (let i = 0; i < n; i += 1) {
    if (state.status !== 'playing') return
    substep(state)
  }
}

/** 帧循环路径：按毫秒累加器换算固定子步（分帧方式不影响轨迹）。
 * @param state - 对局状态。
 * @param dtMs - 本帧毫秒数（内部钳制防久停后跳变）。
 */
export function stepDock(state: DockState, dtMs: number): void {
  if (state.status !== 'playing') return
  state.accMs += Math.min(250, Math.max(0, dtMs))
  while (state.accMs >= SUB_DT_MS && state.status === 'playing') {
    state.accMs -= SUB_DT_MS
    substep(state)
  }
}

/** 施加一次脉冲（ΔV 直接叠加到速度上）。
 * 钳制到剩余预算；幅值 < 0.5 视为未发射、不消耗次数。
 * @param state - 对局状态。
 * @param dvx - ΔV x 分量（px/s）。
 * @param dvy - ΔV y 分量（px/s）。
 * @returns 实际施加的 ΔV；未施加返回 null。
 */
export function applyDv(state: DockState, dvx: number, dvy: number): { x: number, y: number } | null {
  if (state.status !== 'playing' || state.burnsUsed >= MAX_BURNS) return null
  const mag = Math.hypot(dvx, dvy)
  if (mag < 0.5) return null
  const scale = Math.min(1, state.dvLeft / mag)
  const ax = dvx * scale
  const ay = dvy * scale
  if (Math.hypot(ax, ay) < 0.5) return null
  state.ship.vx += ax
  state.ship.vy += ay
  state.burnsUsed += 1
  state.dvLeft = Math.max(0, state.dvLeft - Math.hypot(ax, ay))
  state.events.push({ type: 'burn', x: state.ship.x, y: state.ship.y })
  return { x: ax, y: ay }
}

/** 暂停时设定待执行脉冲（空拖拽 / 幅值过小视为取消）。
 * @param state - 对局状态。
 * @param dvx - ΔV x 分量（px/s，钳到剩余预算）。
 * @param dvy - ΔV y 分量（px/s，钳到剩余预算）。
 */
export function setPendingDv(state: DockState, dvx: number, dvy: number): void {
  if (state.status !== 'playing' || state.burnsUsed >= MAX_BURNS) {
    state.pending = null
    return
  }
  const mag = Math.hypot(dvx, dvy)
  if (mag < 0.5) {
    state.pending = null
    return
  }
  const scale = Math.min(1, state.dvLeft / mag)
  state.pending = { x: dvx * scale, y: dvy * scale }
}

/** 执行待执行脉冲并清空（恢复飞行前由 UI 调用）。
 * @param state - 对局状态。
 */
export function commitBurn(state: DockState): void {
  const p = state.pending
  state.pending = null
  if (p !== null) applyDv(state, p.x, p.y)
}

/** 本关失败文案。
 * @param reason - 失败原因。
 * @returns 中文短句。
 */
export function failText(reason: FailReason): string {
  if (reason === 'planet') return '撞上了行星'
  if (reason === 'debris') return '被碎片带击中'
  if (reason === 'bounds') return '飞出任务空域'
  return '超时未交会（ΔV 用尽）'
}
