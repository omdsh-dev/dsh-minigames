/**
 * 蜂群算法 (HiveMind) 纯逻辑：200 只蜂的 Boids 涌现模拟（分离/对齐/
 * 聚合三力，权重由玩家实时调节 0-2）+ 5 关目标挑战。每关给出一个量化
 * 队形指标（质心入区 / 最小间距 / 区域覆盖数 / 整体对齐度 / 组合），
 * 蜂群需在限时内持续满足指标达 holdMs 才过关；红色障碍区进入即扣分。
 * 边界反弹、固定子步积分、全部随机走注入 seed（mulberry32），整局可
 * 按 (seed, 参数序列) 完整重放。时间单位全为毫秒，无 DOM、无定时器。
 */

/** 逻辑画布宽（px）。 */
export const W = 480
/** 逻辑画布高（px）。 */
export const H = 600
/** 模拟场地矩形（逻辑坐标）：顶部 HUD 与底部滑杆/进度区之外的区域。 */
export const FIELD = { x: 10, y: 34, w: 460, h: 440 } as const

/** 固定物理子步长（ms）：stepHiveMind 把外部 dt 累加后按此切分。 */
export const SUBSTEP_MS = 16
/** 单次 step 调用最多执行的子步数（防病态大 dt 卡死测试）。 */
const MAX_SUBSTEPS = 4096

// --- 蜂群参数 ---

/** 蜂数（固定 200，题目设定）。 */
export const BEE_COUNT = 200
/** 蜂的绘制/碰撞半径（px）。 */
export const BEE_R = 3.5
/** 分离半径（px）：更近的邻居互相推开。 */
export const SEP_R = 22
/** 对齐/聚合的视野半径（px）。 */
export const VIEW_R = 70
/** 分离加速度峰值（px/s^2，按 sep 权重 0-2 缩放）。 */
export const SEP_ACCEL = 560
/** 对齐转向加速度（px/s^2，向邻居平均航向靠拢，按 ali 权重缩放）。 */
export const ALI_ACCEL = 200
/** 聚合加速度（px/s^2，指向邻居质心，按 coh 权重缩放）。 */
export const COH_ACCEL = 170
/** 基准蜂速（px/s），个体在 ±10% 内浮动（seed 决定）。 */
export const BEE_SPEED = 85
/** 边距（px）：蜂中心离场地边至少保持这么远，越界反弹。 */
const EDGE_MARGIN = 10

/** 三条 Boids 力的玩家可调权重（各 0-2，实时生效）。 */
export interface SwarmParams {
  /** 分离权重：越大越互斥散开。 */
  sep: number
  /** 对齐权重：越大越朝邻居平均航向看齐（鱼群洄游）。 */
  ali: number
  /** 聚合权重：越大越向邻居质心靠拢（成团）。 */
  coh: number
}

/** 一只蜂：位置、航向（弧度）、个体速度系数、是否正处于障碍内。 */
export interface Bee {
  x: number
  y: number
  /** 航向角（弧度），速度恒定按 speed 系数。 */
  heading: number
  /** 个体速度系数（0.9-1.1，seed 决定）。 */
  speed: number
  /** 当前子步是否在障碍内（用于进入障碍时计一次命中）。 */
  inObstacle: boolean
}

/** 红色障碍区（圆）。 */
export interface Obstacle {
  x: number
  y: number
  r: number
}

/** 目标指标规格（判据全部在 metrics.ts 式纯函数上判定）。 */
export type TargetSpec =
  /** 质心进入指定圆。 */
  | { kind: 'centroid'; x: number; y: number; r: number }
  /** 全群平均最近邻间距 ≥ minSpacing（平滑、可被分离权重推高）。 */
  | { kind: 'spacing'; minSpacing: number }
  /** 进入指定圆的蜂数 ≥ count。 */
  | { kind: 'coverage'; x: number; y: number; r: number; count: number }
  /** 全群航向对齐度 ≥ minAlign（0-1）。 */
  | { kind: 'alignment'; minAlign: number }
  /** 组合：质心入圆且平均最近邻间距达标。 */
  | { kind: 'combo'; x: number; y: number; r: number; minSpacing: number }

/** 一关定义。 */
export interface LevelDef {
  /** 关名（渲染显示）。 */
  name: string
  /** 限时（ms）。 */
  timeLimitMs: number
  /** 指标需持续满足的时长（ms）。 */
  holdMs: number
  /** 障碍区列表。 */
  obstacles: Obstacle[]
  /** 目标指标。 */
  target: TargetSpec
}

/** 5 关挑战：调参引导蜂群涌现出对应队形。 */
export const LEVELS: readonly LevelDef[] = [
  {
    name: '初聚',
    timeLimitMs: 40000,
    holdMs: 1500,
    obstacles: [],
    target: { kind: 'centroid', x: 360, y: 254, r: 60 },
  },
  {
    name: '疏而不漏',
    timeLimitMs: 45000,
    holdMs: 2000,
    obstacles: [
      { x: 150, y: 150, r: 30 },
      { x: 240, y: 254, r: 30 },
      { x: 330, y: 358, r: 30 },
    ],
    target: { kind: 'spacing', minSpacing: 15 },
  },
  {
    name: '西圈集结',
    timeLimitMs: 45000,
    holdMs: 2000,
    obstacles: [
      { x: 300, y: 150, r: 30 },
      { x: 300, y: 360, r: 30 },
    ],
    target: { kind: 'coverage', x: 120, y: 254, r: 85, count: 70 },
  },
  {
    name: '洄游',
    timeLimitMs: 40000,
    holdMs: 2500,
    obstacles: [],
    target: { kind: 'alignment', minAlign: 0.88 },
  },
  {
    name: '蜂后定巢',
    timeLimitMs: 60000,
    holdMs: 2500,
    obstacles: [
      { x: 120, y: 110, r: 28 },
      { x: 360, y: 110, r: 28 },
      { x: 120, y: 400, r: 28 },
      { x: 360, y: 400, r: 28 },
    ],
    target: { kind: 'combo', x: 240, y: 360, r: 75, minSpacing: 12 },
  },
] as const

/** 总关数。 */
export const LEVEL_COUNT = LEVELS.length

/** 对局状态。 */
export interface HiveMindState {
  /** 注入种子（整局重放的根）。 */
  seed: number
  /** 当前关卡下标（0 起）。 */
  level: number
  /** 三力权重（玩家实时调节）。 */
  params: SwarmParams
  /** 蜂群。 */
  bees: Bee[]
  /** 本关已流逝时间（ms）。 */
  elapsedMs: number
  /** 指标当前已连续满足的时长（ms）。 */
  holdMs: number
  /** 本关进入障碍次数（每次过关扣 5 分）。 */
  obstacleHits: number
  /** 子步累加器（跨 step 调用保持固定步长）。 */
  accumMs: number
  /** playing=进行中；won=过关（advanceLevel 前）；timeout=超时；complete=全通关。 */
  status: 'playing' | 'won' | 'timeout' | 'complete'
  /** 累计总分（过关时结算）。 */
  score: number
}

/** mulberry32 确定性伪随机数发生器：同 seed 同序列，返回 [0,1)。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 关卡种子：不同 seed / 不同关卡号产生不同的生成序列。 */
export function levelSeed(seed: number, level: number): number {
  return (Math.imul(seed >>> 0, 374761393) + Math.imul(level + 1, 668265263)) >>> 0
}

/** 生成一关的蜂群初始布置（seed 决定，避开障碍生成即 inObstacle 起始置位）。 */
function spawnBees(seed: number, level: number): Bee[] {
  const rand = mulberry32(levelSeed(seed, level))
  const obstacles = LEVELS[level]!.obstacles
  const bees: Bee[] = []
  for (let i = 0; i < BEE_COUNT; i += 1) {
    const x = FIELD.x + 24 + rand() * (FIELD.w - 48)
    const y = FIELD.y + 24 + rand() * (FIELD.h - 48)
    let inside = false
    for (const o of obstacles) {
      if (Math.hypot(x - o.x, y - o.y) < o.r + BEE_R) inside = true
    }
    bees.push({
      x,
      y,
      heading: rand() * Math.PI * 2,
      speed: 0.9 + rand() * 0.2,
      inObstacle: inside,
    })
  }
  return bees
}

/** 创建初始对局（第 1 关、三力各 1.0）。 */
export function createHiveMindState(seed = 42): HiveMindState {
  return {
    seed,
    level: 0,
    params: { sep: 1, ali: 1, coh: 1 },
    bees: spawnBees(seed, 0),
    elapsedMs: 0,
    holdMs: 0,
    obstacleHits: 0,
    accumMs: 0,
    status: 'playing',
    score: 0,
  }
}

/** 重开当前关：蜂群/计时/命中按 seed 重置，分数保留（鼓励重试）。 */
export function restartLevel(state: HiveMindState): void {
  state.bees = spawnBees(state.seed, state.level)
  state.elapsedMs = 0
  state.holdMs = 0
  state.obstacleHits = 0
  state.accumMs = 0
  state.status = 'playing'
}

/** 过关后进入下一关；末关过关则全通关。 */
export function advanceLevel(state: HiveMindState): void {
  if (state.level + 1 < LEVEL_COUNT) {
    state.level += 1
    restartLevel(state)
  } else {
    state.status = 'complete'
  }
}

/** 调节一条力权重（钳制到 0-2）。 */
export function setParam(state: HiveMindState, key: keyof SwarmParams, value: number): void {
  state.params[key] = Math.min(2, Math.max(0, value))
}

// --- 量化指标（纯函数，渲染进度条与过关判定共用） ---

/** 蜂群质心。 */
export function swarmCentroid(bees: readonly Bee[]): { x: number, y: number } {
  let sx = 0
  let sy = 0
  for (const b of bees) {
    sx += b.x
    sy += b.y
  }
  return { x: sx / bees.length, y: sy / bees.length }
}

/** 全群两两最小间距（蜂数 n 的 O(n^2)，仅指标判定/渲染调用）。 */
export function minSpacing(bees: readonly Bee[]): number {
  let best = Infinity
  for (let i = 0; i < bees.length; i += 1) {
    const a = bees[i]!
    for (let j = i + 1; j < bees.length; j += 1) {
      const b = bees[j]!
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < best) best = d
    }
  }
  return best
}

/** 全群平均最近邻间距（px）：每只蜂到最近邻居距离的均值——比两两
 * 最小值平滑，作为关卡「间距」指标（分离权重越高该值越大）。 */
export function meanNearestSpacing(bees: readonly Bee[]): number {
  let sum = 0
  for (let i = 0; i < bees.length; i += 1) {
    const a = bees[i]!
    let best = Infinity
    for (let j = 0; j < bees.length; j += 1) {
      if (j === i) continue
      const b = bees[j]!
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < best) best = d
    }
    sum += best
  }
  return sum / bees.length
}

/** 进入指定圆的蜂数。 */
export function coverageCount(bees: readonly Bee[], x: number, y: number, r: number): number {
  let n = 0
  for (const b of bees) {
    if (Math.hypot(b.x - x, b.y - y) <= r) n += 1
  }
  return n
}

/** 全群航向对齐度（0=各奔东西，1=完全同向）：单位航向矢量和长度/n。 */
export function alignmentScore(bees: readonly Bee[]): number {
  let sx = 0
  let sy = 0
  for (const b of bees) {
    sx += Math.cos(b.heading)
    sy += Math.sin(b.heading)
  }
  return Math.hypot(sx, sy) / bees.length
}

/** 目标指标当前是否满足。 */
export function objectiveMet(state: HiveMindState): boolean {
  const t = LEVELS[state.level]!.target
  switch (t.kind) {
    case 'centroid': {
      const c = swarmCentroid(state.bees)
      return Math.hypot(c.x - t.x, c.y - t.y) <= t.r
    }
    case 'spacing':
      return meanNearestSpacing(state.bees) >= t.minSpacing
    case 'coverage':
      return coverageCount(state.bees, t.x, t.y, t.r) >= t.count
    case 'alignment':
      return alignmentScore(state.bees) >= t.minAlign
    case 'combo': {
      const c = swarmCentroid(state.bees)
      return Math.hypot(c.x - t.x, c.y - t.y) <= t.r && meanNearestSpacing(state.bees) >= t.minSpacing
    }
  }
}

/** 指标持续满足进度（0-1，hold 计时占满即过关）。 */
export function objectiveProgress(state: HiveMindState): number {
  return Math.min(1, state.holdMs / LEVELS[state.level]!.holdMs)
}

/** 过关结算：100 底分 + 剩余秒数 ×3 − 障碍命中 ×5（不低于 0）。 */
function winLevel(state: HiveMindState): void {
  const timeLeft = Math.max(0, LEVELS[state.level]!.timeLimitMs - state.elapsedMs)
  const bonus = Math.ceil(timeLeft / 1000) * 3
  state.score += Math.max(0, 100 + bonus - state.obstacleHits * 5)
  state.status = 'won'
}

/** 一个子步：三力合成 → 航向积分 → 位移 → 边界反弹 → 障碍计分。 */
function substep(state: HiveMindState, dt: number): void {
  const { sep, ali, coh } = state.params
  const obstacles = LEVELS[state.level]!.obstacles
  const bees = state.bees
  // 邻居统计（O(n^2)，n=200 每子步 4 万次距离判定，可接受）。
  for (let i = 0; i < bees.length; i += 1) {
    const a = bees[i]!
    let sepX = 0
    let sepY = 0
    let sepN = 0
    let avX = 0
    let avY = 0
    let cx = 0
    let cy = 0
    let viewN = 0
    for (let j = 0; j < bees.length; j += 1) {
      if (j === i) continue
      const b = bees[j]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d >= VIEW_R || d === 0) continue
      viewN += 1
      avX += Math.cos(b.heading)
      avY += Math.sin(b.heading)
      cx += b.x
      cy += b.y
      if (d < SEP_R) {
        // 分离方向：离邻居越近推力越大（1 - d/SEP_R 线性衰减）。
        const w = (1 - d / SEP_R) / d
        sepX -= dx * w
        sepY -= dy * w
        sepN += 1
      }
    }
    // 合成加速度（无邻居时只受当前航向惯性）。
    let ax = 0
    let ay = 0
    if (sepN > 0) {
      const m = Math.hypot(sepX, sepY)
      if (m > 0) {
        ax += (sepX / m) * SEP_ACCEL * sep
        ay += (sepY / m) * SEP_ACCEL * sep
      }
    }
    if (viewN > 0) {
      // 对齐：向邻居平均航向单位矢量的差向量 Steering。
      const mAv = Math.hypot(avX, avY)
      if (mAv > 0) {
        ax += ((avX / mAv) - Math.cos(a.heading)) * ALI_ACCEL * ali
        ay += ((avY / mAv) - Math.sin(a.heading)) * ALI_ACCEL * ali
      }
      // 聚合：指向邻居质心。
      const gx = cx / viewN - a.x
      const gy = cy / viewN - a.y
      const mG = Math.hypot(gx, gy)
      if (mG > 1) {
        ax += (gx / mG) * COH_ACCEL * coh
        ay += (gy / mG) * COH_ACCEL * coh
      }
    }
    // 航向积分：速度矢量加加速度后取方向（速率恒定）。
    const sp = BEE_SPEED * a.speed
    let vx = Math.cos(a.heading) * sp + ax * dt
    let vy = Math.sin(a.heading) * sp + ay * dt
    const m = Math.hypot(vx, vy)
    if (m > 1e-6) a.heading = Math.atan2(vy, vx)
    a.x += Math.cos(a.heading) * sp * dt
    a.y += Math.sin(a.heading) * sp * dt
    // 边界反弹：钳回边距内并镜像航向分量。
    if (a.x < FIELD.x + EDGE_MARGIN) {
      a.x = FIELD.x + EDGE_MARGIN
      a.heading = Math.PI - a.heading
    } else if (a.x > FIELD.x + FIELD.w - EDGE_MARGIN) {
      a.x = FIELD.x + FIELD.w - EDGE_MARGIN
      a.heading = Math.PI - a.heading
    }
    if (a.y < FIELD.y + EDGE_MARGIN) {
      a.y = FIELD.y + EDGE_MARGIN
      a.heading = -a.heading
    } else if (a.y > FIELD.y + FIELD.h - EDGE_MARGIN) {
      a.y = FIELD.y + FIELD.h - EDGE_MARGIN
      a.heading = -a.heading
    }
    // 障碍：新进入计一次命中（持续停留不重复计）。
    let inside = false
    for (const o of obstacles) {
      if (Math.hypot(a.x - o.x, a.y - o.y) < o.r + BEE_R) inside = true
    }
    if (inside && !a.inObstacle) state.obstacleHits += 1
    a.inObstacle = inside
  }
}

/** 推进对局：外部 dt 累加后按固定子步切分；过关/超时/指标计时在此结算。 */
export function stepHiveMind(state: HiveMindState, dtMs: number): void {
  if (state.status !== 'playing') return
  state.accumMs += Math.max(0, dtMs)
  let steps = 0
  while (state.accumMs >= SUBSTEP_MS && steps < MAX_SUBSTEPS) {
    state.accumMs -= SUBSTEP_MS
    steps += 1
    substep(state, SUBSTEP_MS / 1000)
    state.elapsedMs += SUBSTEP_MS
  }
  if (steps === 0) return
  // 指标持续满足计时：满足则累积，一旦不满足立即清零。
  if (objectiveMet(state)) {
    state.holdMs += steps * SUBSTEP_MS
    if (state.holdMs >= LEVELS[state.level]!.holdMs) {
      winLevel(state)
      return
    }
  } else {
    state.holdMs = 0
  }
  if (state.elapsedMs >= LEVELS[state.level]!.timeLimitMs) {
    state.status = 'timeout'
  }
}
