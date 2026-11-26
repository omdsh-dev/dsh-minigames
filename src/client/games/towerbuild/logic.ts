/**
 * 层叠塔 TowerBuild 纯逻辑：物理叠塔（稳定性建造）的核心规则。
 * 侧视工地：底部固定基座，方块从上方吊索左右摆动，按空格落在当前
 * 堆顶。每块有宽度、重量与重心偏心；落点与下方块的重叠不足即脱钩
 * 坠落（失误）。堆的联合重心实时计算，投影超出基座支撑即整塔倾倒；
 * 块间摩擦简化为「界面滑动累积」：上段重心对每个界面的偏心比超过
 * 稳定阈值的滑动区时缓慢累积，超限则该界面以上整段倒塌（散块物理
 * 动画）。后两关引入横向风力扰动。全部随机走注入 seed 的 mulberry32，
 * 不含任何 DOM / canvas 依赖，可直接单测与确定性重放。
 */

/** mulberry32 伪随机数发生器：小而快，同 seed 序列确定。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 基座宽度（世界单位，x=0 为基座中心）。 */
export const BASE_W = 160
/** 基座重量（联合重心计算中计入）。 */
export const BASE_MASS = 20
/** 基座高度（世界单位，render 用同一常量换算屏幕坐标）。 */
export const BASE_H = 36
/** 每层方块高度。 */
export const BLOCK_H = 20
/** 方块宽度范围。 */
export const BLOCK_MIN_W = 84
export const BLOCK_MAX_W = 168
/** 吊挂块底面距堆顶的最小距离（失误块的下落起点）。 */
export const HANG = 66
/** 与下方块的最小重叠，低于即脱钩坠落（失误）。 */
export const MIN_OVERLAP = 24
/** 界面滑动累积上限，超过即该界面以上整段倒塌。 */
export const SLIP_LIMIT = 1.0
/** 偏心比低于该阈值时塔身自稳，滑动缓慢回落。 */
export const HOLD_E = 0.55
/** 滑动累积速率（偏心比每超 1.0 每秒累积的滑动量）。 */
export const SLIP_RATE = 0.8
/** 稳定时滑动回落速率（每秒）。 */
export const SLIP_DECAY = 0.35
/** 风力折算到界面偏心比的系数。 */
export const WIND_E = 1.2
/** 散块重力加速度（世界单位 / 秒²）。 */
export const DEBRIS_G = 900
/** 倒塌动画时长（毫秒），结束后进入失败态。 */
export const COLLAPSE_MS = 1500
/** 过关停留时长（毫秒），之后自动进入下一关。 */
export const CLEARED_MS = 1600
/** 过关奖励分。 */
export const CLEAR_BONUS = 25

/** 一关的固定参数：目标高度、吊索摆幅 / 周期、风力强度。 */
export interface TowerLevelConfig {
  /** 目标层数（放满即过关）。 */
  target: number
  /** 吊索摆幅（世界单位，单侧）。 */
  swingAmp: number
  /** 吊索摆动周期（毫秒）。 */
  swingPeriod: number
  /** 风力强度（0 = 无风；横向力随机扰动的幅值）。 */
  wind: number
}

/** 五关递进：目标高度 8→20 块，摆动加快，后两关起风。 */
export const LEVELS: readonly TowerLevelConfig[] = [
  { target: 8, swingAmp: 60, swingPeriod: 2000, wind: 0 },
  { target: 11, swingAmp: 76, swingPeriod: 1750, wind: 0 },
  { target: 14, swingAmp: 92, swingPeriod: 1500, wind: 0 },
  { target: 17, swingAmp: 100, swingPeriod: 1350, wind: 0.18 },
  { target: 20, swingAmp: 110, swingPeriod: 1200, wind: 0.3 },
]

/** 关卡总数。 */
export const LEVEL_COUNT = LEVELS.length

/** 已放置（或吊挂中）的一块：宽度、重量、中心 x 与重心偏心。 */
export interface TowerBlock {
  /** 方块宽度（世界单位）。 */
  w: number
  /** 重量（联合重心与界面力矩计入）。 */
  mass: number
  /** 中心 x（世界坐标，0 = 基座中心）。 */
  cx: number
  /** 重心相对几何中心的水平偏心（块内偏置）。 */
  comOffset: number
}

/** 倒塌 / 失误后的散块（世界坐标，含简单抛体运动）。 */
export interface Debris {
  x: number
  /** 世界 y（负向上，0 = 地面）。 */
  y: number
  w: number
  vx: number
  vy: number
  /** 旋转角（弧度）与角速度。 */
  rot: number
  vr: number
}

/** 对局阶段。 */
export type TowerPhase = 'swing' | 'collapse' | 'cleared' | 'over'

/** 对局状态（全部字段可直接读取；rng 仅供内部推进，勿手工调用）。 */
export interface TowerBuildState {
  /** 当前关（0 起）。 */
  level: number
  /** 本局注入种子（重放用）。 */
  seed: number
  /** 已放置方块（不含基座，下标即层号）。 */
  blocks: TowerBlock[]
  /** 吊挂中的下一块（cx 由摆动相位决定，见 {@link pendingX}）。 */
  pending: TowerBlock
  /** 吊索摆动相位（弧度）。 */
  swingPhase: number
  /** 阶段。 */
  phase: TowerPhase
  /** 每个界面的滑动累积：slip[k] 为第 k 块与其下方支撑（k=0 为基座）之间。 */
  slip: number[]
  /** 当前风力（-强度..+强度；无风关恒为 0）。 */
  wind: number
  /** 风向目标值与距下次变化的时间（毫秒）。 */
  windTarget: number
  windT: number
  /** 联合重心 x（含基座，放置后重算）。 */
  comX: number
  /** 总分（每放一块 +1，过关 +25）。 */
  score: number
  /** 已过关数。 */
  clearedLevels: number
  /** 是否以「最后一关过关」收尾（区别于倒塌失败）。 */
  completed: boolean
  /** 倒塌起始界面（-1 = 仅失误块坠落，塔身未倒）。 */
  collapseIndex: number
  /** 倒塌 / 过关动画计时（毫秒）。 */
  animT: number
  /** 散块列表。 */
  debris: Debris[]
  /** 内部随机源（seed 派生），测试勿直接调用。 */
  rng: () => number
}

/** 放置结果。 */
export type PlaceResult = 'placed' | 'cleared' | 'miss' | 'toppled' | null

/** 生成一块（宽度 / 重量 / 偏心由注入 rng 决定，cx 由调用方填）。 */
function genBlock(rng: () => number): TowerBlock {
  const w = BLOCK_MIN_W + Math.floor(rng() * (BLOCK_MAX_W - BLOCK_MIN_W + 1))
  return {
    w,
    mass: Math.round(w / 12),
    cx: 0,
    comOffset: (rng() * 2 - 1) * w * 0.1,
  }
}

const BASE_HALF = BASE_W / 2

/** 第 k 层方块的世界 y（块底面高度；负向上，0 = 地面）。 */
export function blockBaseY(k: number): number {
  return -(BASE_H + k * BLOCK_H)
}

/** 吊挂块当前的世界 x（纯函数：摆幅 × sin 相位）。 */
export function pendingX(state: TowerBuildState): number {
  return LEVELS[state.level]!.swingAmp * Math.sin(state.swingPhase)
}

/**
 * 联合重心（含基座）。
 * @param blocks - 已放置方块。
 * @returns 重心 x 与总重量。
 */
export function computeCom(blocks: readonly TowerBlock[]): { x: number, mass: number } {
  let m = BASE_MASS
  let moment = 0
  for (const b of blocks) {
    m += b.mass
    moment += b.mass * (b.cx + b.comOffset)
  }
  return { x: moment / m, mass: m }
}

/**
 * 界面 k 的几何与静力报告：支撑面（重叠区）半宽、上段总重量、
 * 上段联合重心对支撑面中心的偏心比（不含风力）。
 * @param state - 对局状态。
 * @param k - 界面下标（0 = 基座与第 0 块之间）。
 * @returns 偏心比与支撑面信息；k 越界返回 null。
 */
export function interfaceReport(state: TowerBuildState, k: number): { e: number, half: number, massAbove: number } | null {
  const n = state.blocks.length
  if (k < 0 || k >= n) return null
  const supCx = k === 0 ? 0 : state.blocks[k - 1]!.cx
  const supHalf = k === 0 ? BASE_HALF : state.blocks[k - 1]!.w / 2
  const blk = state.blocks[k]!
  const overlap = supHalf + blk.w / 2 - Math.abs(blk.cx - supCx)
  const half = Math.max(1e-6, overlap / 2)
  const overlapCx = (supCx + blk.cx) / 2
  let m = 0
  let moment = 0
  for (let i = k; i < n; i += 1) {
    const b = state.blocks[i]!
    m += b.mass
    moment += b.mass * (b.cx + b.comOffset)
  }
  const a = moment / m
  return { e: (a - overlapCx) / half, half, massAbove: m }
}

/**
 * 最危险界面的含风偏心比（render 用它画警示与 HUD）。
 * @returns 界面下标（塔空为 -1）与最大 |偏心比|。
 */
export function worstInterface(state: TowerBuildState): { k: number, e: number } {
  let k = -1
  let worst = 0
  for (let i = 0; i < state.blocks.length; i += 1) {
    const r = interfaceReport(state, i)
    if (r === null) continue
    const e = Math.abs(r.e + state.wind * WIND_E)
    if (e > worst) {
      worst = e
      k = i
    }
  }
  return { k, e: worst }
}

function spawnDebris(state: TowerBuildState, b: TowerBlock, y: number): void {
  state.debris.push({
    x: b.cx,
    y,
    w: b.w,
    vx: (state.rng() * 2 - 1) * 90 + state.wind * 80,
    vy: -state.rng() * 60,
    rot: 0,
    vr: (state.rng() * 2 - 1) * 4,
  })
}

/** 从界面 k 起整段倒塌：k 及以上全部转为散块，塔截断到 k。 */
function collapseFrom(state: TowerBuildState, k: number): void {
  for (let i = k; i < state.blocks.length; i += 1) {
    spawnDebris(state, state.blocks[i]!, blockBaseY(i))
  }
  state.blocks.length = k
  state.slip.length = k
  state.comX = computeCom(state.blocks).x
  state.collapseIndex = k
  state.animT = 0
  state.phase = 'collapse'
}

function genPending(state: TowerBuildState): void {
  state.pending = genBlock(state.rng)
  state.swingPhase = 0
}

/** 换关 / 重塔：保留分数与关卡进度，重置塔身与吊挂。 */
function resetTower(state: TowerBuildState, level: number): void {
  state.level = level
  state.blocks = []
  state.slip = []
  state.debris = []
  state.comX = 0
  state.wind = 0
  state.windTarget = 0
  state.windT = 1200
  state.collapseIndex = -1
  state.animT = 0
  state.phase = 'swing'
  genPending(state)
}

/**
 * 开一局。
 * @param level - 起始关（0 起，越界钳制）。
 * @param seed - 注入种子。
 */
export function createState(level: number, seed: number): TowerBuildState {
  const state: TowerBuildState = {
    level: Math.max(0, Math.min(LEVEL_COUNT - 1, level)),
    seed,
    blocks: [],
    pending: { w: 0, mass: 0, cx: 0, comOffset: 0 },
    swingPhase: 0,
    phase: 'swing',
    slip: [],
    wind: 0,
    windTarget: 0,
    windT: 1200,
    comX: 0,
    score: 0,
    clearedLevels: 0,
    completed: false,
    collapseIndex: -1,
    animT: 0,
    debris: [],
    rng: mulberry32(seed ^ (0x9e3779b9 * (level + 1))),
  }
  genPending(state)
  return state
}

/**
 * 放下吊挂块（按当前摆动相位计算落点）。
 * 落点与堆顶重叠不足 → 失误坠落；放置后联合重心超出基座支撑 →
 * 整塔倾倒；放满目标层 → 过关；否则换下一块继续。
 * @param state - 对局状态（须处于 swing 阶段）。
 * @returns 放置结果；非 swing 阶段返回 null。
 */
export function place(state: TowerBuildState): PlaceResult {
  if (state.phase !== 'swing') return null
  const x = pendingX(state)
  const n = state.blocks.length
  const supCx = n === 0 ? 0 : state.blocks[n - 1]!.cx
  const supHalf = n === 0 ? BASE_HALF : state.blocks[n - 1]!.w / 2
  const overlap = supHalf + state.pending.w / 2 - Math.abs(x - supCx)
  if (overlap < MIN_OVERLAP) {
    // 失误：块脱钩坠落，塔身不动，动画结束后判负。
    spawnDebris(state, { ...state.pending, cx: x }, blockBaseY(n) - HANG - BLOCK_H)
    state.collapseIndex = -1
    state.animT = 0
    state.phase = 'collapse'
    return 'miss'
  }
  state.blocks.push({ ...state.pending, cx: x })
  state.slip.push(0)
  state.comX = computeCom(state.blocks).x
  if (Math.abs(state.comX) > BASE_HALF) {
    collapseFrom(state, 0)
    return 'toppled'
  }
  state.score += 1
  const target = LEVELS[state.level]!.target
  if (state.blocks.length >= target) {
    state.phase = 'cleared'
    state.animT = 0
    state.clearedLevels += 1
    state.score += CLEAR_BONUS
    return 'cleared'
  }
  genPending(state)
  return 'placed'
}

/** 推进风力（有风关卡）：风向目标定时随机漂移，实际值缓慢跟随。 */
function stepWind(state: TowerBuildState, dtMs: number): void {
  const strength = LEVELS[state.level]!.wind
  if (strength <= 0) {
    state.wind = 0
    return
  }
  state.windT -= dtMs
  if (state.windT <= 0) {
    state.windTarget = (state.rng() * 2 - 1) * strength
    state.windT = 2500 + state.rng() * 2000
  }
  const t = Math.min(1, dtMs / 600)
  state.wind += (state.windTarget - state.wind) * t
}

/** 滑动累积判定：超稳阈值缓慢累积，稳阈值回落，超限整段倒塌。 */
function stepSlip(state: TowerBuildState, dtMs: number): void {
  const dt = dtMs / 1000
  for (let k = 0; k < state.blocks.length; k += 1) {
    const r = interfaceReport(state, k)
    if (r === null) continue
    const e = Math.abs(r.e + state.wind * WIND_E)
    if (e > 1) {
      collapseFrom(state, k)
      return
    }
    if (e > HOLD_E) state.slip[k] = (state.slip[k] ?? 0) + (e - HOLD_E) * SLIP_RATE * dt
    else state.slip[k] = Math.max(0, (state.slip[k] ?? 0) - SLIP_DECAY * dt)
    if (state.slip[k]! > SLIP_LIMIT) {
      collapseFrom(state, k)
      return
    }
  }
}

/** 散块抛体推进：重力下落、触地停在地面附近。 */
function stepDebris(state: TowerBuildState, dtMs: number): void {
  const dt = dtMs / 1000
  for (const d of state.debris) {
    d.x += d.vx * dt
    d.y += d.vy * dt
    d.vy += DEBRIS_G * dt
    d.rot += d.vr * dt
    if (d.y > -BLOCK_H / 2) {
      d.y = -BLOCK_H / 2
      d.vy = 0
      d.vx *= 0.86
      d.vr *= 0.86
    }
  }
}

/**
 * 推进一帧（确定性：相同 seed + 相同调用序列 → 相同状态）。
 * swing：摆动相位 + 风力 + 滑动判定；collapse / cleared：动画计时，
 * 结束后分别判负 / 自动进入下一关（最后一关后判负收尾为通关态）。
 * @param state - 对局状态。
 * @param dtMs - 帧间隔（毫秒）。
 */
export function step(state: TowerBuildState, dtMs: number): void {
  if (state.phase === 'swing') {
    state.swingPhase += (Math.PI * 2 * dtMs) / LEVELS[state.level]!.swingPeriod
    stepWind(state, dtMs)
    stepSlip(state, dtMs)
    return
  }
  if (state.phase === 'collapse') {
    state.animT += dtMs
    stepDebris(state, dtMs)
    if (state.animT >= COLLAPSE_MS) state.phase = 'over'
    return
  }
  if (state.phase === 'cleared') {
    state.animT += dtMs
    if (state.animT < CLEARED_MS) return
    if (state.level + 1 < LEVEL_COUNT) resetTower(state, state.level + 1)
    else {
      state.phase = 'over'
      state.completed = true
    }
  }
}

/**
 * 重开当前关（换新种子；分数与过关计数清零）。
 * @param state - 现有状态（取其 level）。
 * @param seed - 新种子。
 * @returns 新状态。
 */
export function restartLevel(state: TowerBuildState, seed: number): TowerBuildState {
  return createState(state.level, seed)
}

/** 是否已全部通关（收尾 over 态且五关全过）。 */
export function isComplete(state: TowerBuildState): boolean {
  return state.phase === 'over' && state.completed
}

/** 塔高（已放置层数）。 */
export function towerHeight(state: TowerBuildState): number {
  return state.blocks.length
}

/** 失败原因（over / collapse 态展示；进行中返回 null）。 */
export function failReason(state: TowerBuildState): 'miss' | 'toppled' | 'collapse' | null {
  if (state.phase !== 'collapse' && state.phase !== 'over') return null
  if (state.collapseIndex === -1 && state.debris.length > 0) return 'miss'
  if (state.collapseIndex === 0 && state.blocks.length === 0) return 'toppled'
  return 'collapse'
}
