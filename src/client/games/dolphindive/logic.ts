/**
 * 海豚跃浪 DolphinDive 纯逻辑：水下游动蓄力（速度提升），松开按当前
 * 速度与角度抛物线跃出；空中可空翻（加分但入水时翻滚未完成会被打
 * 折）；入水角越陡得分越高，连续完美入水触发连击倍增；每轮随机风
 * 速与水母障碍。全部随机经 mulberry32(seed) 注入，确定性可测。
 */

/** 轮数。 */
export const ROUNDS = 5
/** 水面世界 y（屏幕坐标，向下为正）。 */
export const WATER_Y = 250
/** 海豚游动深度（水面下 22）。 */
export const SWIM_Y = 272
/** 起跳点横坐标。 */
export const JUMP_X = 110
/** 空中重力加速度（世界单位/秒²）。 */
export const GRAVITY = 520
/** 蓄满所需秒数。 */
const CHARGE_TIME = 1.1
/** 最小/满蓄力起跳速度（世界单位/秒）。 */
const LAUNCH_MIN = 170
const LAUNCH_RANGE = 280
/** 起跳角范围（度，相对水平向上）。 */
const ANGLE_MIN = 20
const ANGLE_MAX = 85
const ANGLE_STEP = 5
/** 空翻角速度：一圈 0.45 秒。 */
const FLIP_RATE = (Math.PI * 2) / 0.45
const TAU = Math.PI * 2
/** 每完成一圈空翻的加分。 */
export const FLIP_BONUS = 8
/** 水母碰到一次的扣分。 */
export const JELLY_PENALTY = 15
/** 入水结算后的水花展示秒数。 */
const SETTLE_TIME = 0.9
/** 风速绝对值上限（世界单位/秒²）。 */
const WIND_MAX = 70

/** 一只水母：空中圆盘障碍，缓慢漂移。 */
export interface Jellyfish {
  x: number
  y: number
  r: number
  /** 水平漂移速度（有正有负）。 */
  vx: number
  /** 本轮是否已碰到过（只扣一次分）。 */
  hit: boolean
}

/** 游戏阶段。 */
export type DolphinPhase = 'swim' | 'charge' | 'air' | 'settle' | 'over'

export interface DolphinDiveState {
  /** 注入的确定性随机源（mulberry32）。 */
  rng: () => number
  /** 创建时使用的种子（重放对照）。 */
  seed: number
  phase: DolphinPhase
  /** 当前轮（1..ROUNDS）。 */
  round: number
  /** 累计总分（跨轮累加）。 */
  score: number
  /** 蓄力 0..1。 */
  power: number
  /** 起跳角（度，20..85）。 */
  angleDeg: number
  /** 海豚位置与速度（世界坐标，y 向下为正）。 */
  x: number
  y: number
  vx: number
  vy: number
  /** 已累计的空翻旋转弧度（只增）。 */
  rotation: number
  /** 已请求的空翻圈数（rotation 追到 flipsTarget*TAU 为止）。 */
  flipsTarget: number
  /** 空中达到的最高点 y（最小值；WATER_Y 表示没高过水面）。 */
  peakY: number
  /** 本轮风加速度（水平，正为向右）。 */
  wind: number
  jellyfish: Jellyfish[]
  /** 连续完美入水次数（决定下一跳倍率）。 */
  combo: number
  /** 最近一跳入水的陡峭度 0..1（水花/结算展示）。 */
  entrySteepness: number
  /** 最近一跳的加分数（含倍率）。 */
  lastRoundPoints: number
  /** 最近一跳结算文案。 */
  lastEntryLabel: string
  /** 入水时翻滚是否未完成（被打折的依据）。 */
  entrySloppy: boolean
  /** 结算展示计时（秒）。 */
  settleT: number
}

/** mulberry32：seed 确定性 PRNG，返回 [0,1)。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 抽一轮随机：风速 + 三只水母（空中区域，避开起跳点上方）。 */
function drawRound(state: DolphinDiveState): void {
  state.wind = (state.rng() * 2 - 1) * WIND_MAX
  state.jellyfish = []
  for (let i = 0; i < 3; i += 1) {
    state.jellyfish.push({
      x: 220 + state.rng() * 230,
      y: 60 + state.rng() * 130,
      r: 14 + state.rng() * 6,
      vx: (state.rng() * 2 - 1) * 22,
      hit: false,
    })
  }
}

/** 复位海豚到水下游动位。 */
function resetDolphin(state: DolphinDiveState): void {
  state.x = JUMP_X
  state.y = SWIM_Y
  state.vx = 0
  state.vy = 0
  state.power = 0
  state.rotation = 0
  state.flipsTarget = 0
  state.peakY = WATER_Y
}

/** 新开局：seed 注入，第 1 轮随机就绪。 */
export function createDolphinDiveState(seed: number): DolphinDiveState {
  const state: DolphinDiveState = {
    rng: mulberry32(seed),
    seed,
    phase: 'swim',
    round: 1,
    score: 0,
    power: 0,
    angleDeg: 55,
    x: JUMP_X,
    y: SWIM_Y,
    vx: 0,
    vy: 0,
    rotation: 0,
    flipsTarget: 0,
    peakY: WATER_Y,
    wind: 0,
    jellyfish: [],
    combo: 0,
    entrySteepness: 0,
    lastRoundPoints: 0,
    lastEntryLabel: '',
    entrySloppy: false,
    settleT: 0,
  }
  drawRound(state)
  return state
}

/** 开始蓄力（水下按住空格）。 */
export function startCharge(state: DolphinDiveState): void {
  if (state.phase !== 'swim') return
  state.phase = 'charge'
  state.power = 0
}

/** 起跳角微调（↑↓，仅水下游动/蓄力阶段有效）。 */
export function adjustAngle(state: DolphinDiveState, delta: number): void {
  if (state.phase !== 'swim' && state.phase !== 'charge') return
  state.angleDeg = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, state.angleDeg + delta * ANGLE_STEP))
}

/** 松开空格：以当前蓄力速度与角度跃出水面。 */
export function releaseJump(state: DolphinDiveState): void {
  if (state.phase !== 'charge') return
  const speed = LAUNCH_MIN + state.power * LAUNCH_RANGE
  const rad = (state.angleDeg * Math.PI) / 180
  state.vx = Math.cos(rad) * speed
  state.vy = -Math.sin(rad) * speed
  state.phase = 'air'
  state.peakY = state.y
}

/** 空中按空格：请求一圈空翻。 */
export function airFlip(state: DolphinDiveState): void {
  if (state.phase !== 'air') return
  state.flipsTarget += 1
}

/** 入水角得分曲线：陡峭度 s∈[0,1]（0 拍水面，1 垂直），返回 0..100。 */
export function computeEntryScore(s: number): number {
  const clamped = Math.min(1, Math.max(0, s))
  return Math.round(100 * clamped * clamped)
}

/** 当前连击倍率（连续完美入水每次 +0.5，封顶 3）。 */
export function comboMultiplier(combo: number): number {
  return Math.min(3, 1 + combo * 0.5)
}

/** 入水结算：由速度矢量求陡峭度并结算本轮得分。 */
function settleEntry(state: DolphinDiveState): void {
  // 速度矢量与水平的夹角（vy>0 下落中）：90° 为垂直入水。
  const deg = (Math.atan2(state.vy, state.vx) * 180) / Math.PI
  let s = Math.min(1, Math.max(0, deg / 90))
  // 翻滚未完成：身体未对齐速度方向，入水质量打折。
  const sloppy = state.rotation < state.flipsTarget * TAU - 0.05
  if (sloppy) s *= 0.55
  const entryPts = computeEntryScore(s)
  const completedFlips = Math.floor(state.rotation / TAU)
  const flipBonus = completedFlips * FLIP_BONUS
  const heightBonus = Math.min(20, Math.round((WATER_Y - state.peakY) / 12))
  const base = entryPts + flipBonus + heightBonus
  const mult = comboMultiplier(state.combo)
  const points = Math.round(base * mult)
  state.score += points
  state.lastRoundPoints = points
  state.entrySteepness = s
  state.entrySloppy = sloppy
  const perfect = !sloppy && s >= 0.9
  if (perfect) state.combo += 1
  else state.combo = 0
  if (sloppy) state.lastEntryLabel = '翻滚未完成…'
  else if (s >= 0.9) state.lastEntryLabel = '完美入水！'
  else if (s >= 0.6) state.lastEntryLabel = '干净入水'
  else if (s >= 0.35) state.lastEntryLabel = '普通入水'
  else state.lastEntryLabel = '拍在水面'
  state.phase = 'settle'
  state.settleT = 0
}

/**
 * 推进一帧。
 * @param state 局面。
 * @param dt 帧间隔秒（调用方应已钳制）。
 */
export function stepDolphinDive(state: DolphinDiveState, dt: number): void {
  if (state.phase === 'charge') {
    state.power = Math.min(1, state.power + dt / CHARGE_TIME)
    return
  }
  if (state.phase === 'settle') {
    state.settleT += dt
    if (state.settleT >= SETTLE_TIME) {
      if (state.round >= ROUNDS) {
        state.phase = 'over'
      } else {
        state.round += 1
        resetDolphin(state)
        drawRound(state)
        state.phase = 'swim'
      }
    }
    return
  }
  if (state.phase !== 'air') return

  // 水母漂移。
  for (const j of state.jellyfish) j.x += j.vx * dt

  // 抛物线：重力 + 风（水平扰动）。
  state.vy += GRAVITY * dt
  state.vx += state.wind * dt
  state.x += state.vx * dt
  state.y += state.vy * dt
  state.peakY = Math.min(state.peakY, state.y)

  // 空翻：rotation 追向 flipsTarget 圈。
  const targetRot = state.flipsTarget * TAU
  if (state.rotation < targetRot) {
    state.rotation = Math.min(targetRot, state.rotation + FLIP_RATE * dt)
  }

  // 水母碰撞：一次扣分 + 打断连击 + 水平减速。
  for (const j of state.jellyfish) {
    if (j.hit) continue
    const dx = state.x - j.x
    const dy = state.y - j.y
    if (dx * dx + dy * dy < (j.r + 12) * (j.r + 12)) {
      j.hit = true
      state.score = Math.max(0, state.score - JELLY_PENALTY)
      state.combo = 0
      state.vx *= 0.75
    }
  }

  // 入水：下落中越过水面才算（上升穿过不算）。
  if (state.y >= WATER_Y && state.vy > 0) {
    state.y = WATER_Y
    settleEntry(state)
  }
}
