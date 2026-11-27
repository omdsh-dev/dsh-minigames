/**
 * 「声呐探物 SonarDeduct」纯逻辑：9×9 海域、seed 布下的静态障碍、
 * 有限次数的主动声呐（8 向 raycast 回声，非零距离直接定位最近障碍）、
 * 标记判定（凑满自动判定，错旗即拔并扣分）、高关漂移鱼群（纯干扰，
 * 判定只看静态障碍）与 5 关递进。全部确定性：随机只来自注入 seed 的
 * mulberry32，时间只由调用方传入的 dt 驱动；布局生成内含可解性验证
 * （贪心覆盖所需声呐数 ≤ 预算），同 seed + 同操作序列完全可重放。
 */

/** 海域边长（9×9 格）。 */
export const SIZE = 9
/** 总关数。 */
export const LEVEL_COUNT = 5
/** 误标判负上限（累计错旗判定次数）。 */
export const WRONG_LIMIT = 3
/** 8 个声呐方向：北、东北、东、东南、南、西南、西、西北。 */
export const DIRS: ReadonlyArray<{ dr: number; dc: number; name: string }> = [
  { dr: -1, dc: 0, name: '北' },
  { dr: -1, dc: 1, name: '东北' },
  { dr: 0, dc: 1, name: '东' },
  { dr: 1, dc: 1, name: '东南' },
  { dr: 1, dc: 0, name: '南' },
  { dr: 1, dc: -1, name: '西南' },
  { dr: 0, dc: -1, name: '西' },
  { dr: -1, dc: -1, name: '西北' },
]

/** 每关配置：障碍数 / 声呐预算 / 鱼群数量。 */
export interface LevelConfig {
  obstacles: number
  budget: number
  fish: number
}

/** 关卡递进表：障碍 3→7、预算 6→3、第 3 关起加入漂移鱼群。 */
const LEVELS: LevelConfig[] = [
  { obstacles: 3, budget: 6, fish: 0 },
  { obstacles: 4, budget: 5, fish: 0 },
  { obstacles: 5, budget: 4, fish: 4 },
  { obstacles: 6, budget: 4, fish: 6 },
  { obstacles: 7, budget: 3, fish: 8 },
]

/** 对局状态：进行中 / 单关完成 / 全部通关 / 误标过多失败。 */
export type GameStatus = 'playing' | 'levelClear' | 'allClear' | 'gameover'

/** 一次已发射的声呐：位置 + 8 向回声（0 = 该方向无障碍）。 */
export interface Ping {
  r: number
  c: number
  /** 与 DIRS 同序的 8 向回声距离。 */
  echo: number[]
}

/** 一条漂移鱼（起点 + 速度；当前位置由 t 计算，纯干扰）。 */
export interface Fish {
  x0: number
  y0: number
  vx: number
  vy: number
}

/** 一关的完整局面（可变；由 ping / toggleMark / tick 推进）。 */
export interface SonarDeductState {
  /** 1 起的关卡号（1..LEVEL_COUNT）。 */
  level: number
  /** 行主序障碍掩码：1 = 海床下有障碍（对玩家隐藏）。 */
  obstacles: Uint8Array
  /** 行主序玩家标记：1 = 插旗。 */
  marks: Uint8Array
  /** 已发射的声呐（含回声，渲染与推理共用）。 */
  pings: Ping[]
  /** 剩余声呐次数。 */
  budget: number
  /** 累计误标判定次数。 */
  wrong: number
  /** 累计模拟秒数（驱动鱼群漂移）。 */
  t: number
  /** 子步累加器（固定步长推进 t，保证重放一致）。 */
  subAcc: number
  status: GameStatus
  /** 本关得分（含误标扣分；跨关累计由 index 层维护）。 */
  score: number
  fish: Fish[]
  /** 注入的确定性随机源。 */
  rng: () => number
}

/** mulberry32：seed 注入的确定性随机源（0..1）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 每关 seed：同关重开必然得到同一片海域。 */
export function levelSeed(level: number): number {
  return (level * 0x1b873593 + 0x9e3779b9) >>> 0
}

/** 读取关卡配置（越界夹紧）。 */
export function levelConfig(level: number): LevelConfig {
  const idx = Math.min(LEVEL_COUNT, Math.max(1, level)) - 1
  return LEVELS[idx]!
}

/** 行主序下标。 */
export function cellIndex(r: number, c: number): number {
  return r * SIZE + c
}

/** 单格声呐回声：8 向各自到最近障碍的步数（无障碍为 0）。 */
export function echoAt(obstacles: Uint8Array, r: number, c: number): number[] {
  const echo: number[] = []
  for (const d of DIRS) {
    let dist = 0
    let rr = r + d.dr
    let cc = c + d.dc
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) {
      dist += 1
      if (obstacles[rr * SIZE + cc] === 1) break
      rr += d.dr
      cc += d.dc
    }
    echo.push(rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE ? dist : 0)
  }
  return echo
}

/** 一次声呐能定位的障碍集合（非零回声即精确命中该格）。 */
export function revealedByPing(obstacles: Uint8Array, r: number, c: number): number[] {
  const echo = echoAt(obstacles, r, c)
  const hit: number[] = []
  for (let i = 0; i < DIRS.length; i += 1) {
    const d = DIRS[i]!
    const e = echo[i]!
    if (e <= 0) continue
    const rr = r + d.dr * e
    const cc = c + d.dc * e
    hit.push(rr * SIZE + cc)
  }
  return hit
}

/** 贪心覆盖：把全部障碍各命中一次所需的最少声呐数（上界估计）。 */
export function greedyCoverCount(obstacles: Uint8Array): number {
  const total = obstacles.reduce((s, v) => s + v, 0)
  const found = new Set<number>()
  let pings = 0
  while (found.size < total) {
    let bestCell = -1
    let bestGain = 0
    let bestHits: number[] = []
    for (let idx = 0; idx < SIZE * SIZE; idx += 1) {
      const r = Math.floor(idx / SIZE)
      const c = idx % SIZE
      const hits = revealedByPing(obstacles, r, c)
      const gain = hits.filter(h => !found.has(h)).length
      if (gain > bestGain) {
        bestGain = gain
        bestCell = idx
        bestHits = hits
      }
    }
    if (bestGain <= 0) return Number.POSITIVE_INFINITY
    pings += 1
    for (const h of bestHits) found.add(h)
  }
  return pings
}

/** 随机布障碍：两两切比雪夫距离 ≥ 2（互不接触，回声可分）。 */
function placeObstacles(rng: () => number, count: number): Uint8Array {
  const grid = new Uint8Array(SIZE * SIZE)
  let placed = 0
  let guard = 0
  while (placed < count && guard < 500) {
    guard += 1
    const idx = Math.floor(rng() * SIZE * SIZE)
    if (grid[idx] === 1) continue
    const r = Math.floor(idx / SIZE)
    const c = idx % SIZE
    let ok = true
    for (let dr = -1; dr <= 1 && ok; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const rr = r + dr
        const cc = c + dc
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue
        if (grid[rr * SIZE + cc] === 1) { ok = false; break }
      }
    }
    if (!ok) continue
    grid[idx] = 1
    placed += 1
  }
  return grid
}

/** 生成鱼群（起点均匀、速度带随机方向）。 */
function makeFish(rng: () => number, count: number): Fish[] {
  const fish: Fish[] = []
  for (let i = 0; i < count; i += 1) {
    const speed = 0.35 + rng() * 0.45
    fish.push({
      x0: rng() * SIZE,
      y0: rng() * SIZE,
      vx: (rng() < 0.5 ? -1 : 1) * speed,
      vy: (rng() < 0.5 ? -1 : 1) * (0.2 + rng() * 0.3),
    })
  }
  return fish
}

/** 起一关：按 seed 布障碍（含可解性验证）并生成鱼群。 */
export function createLevel(seed: number, level: number): SonarDeductState {
  const cfg = levelConfig(level)
  const rng = mulberry32(seed)
  let obstacles: Uint8Array = new Uint8Array(SIZE * SIZE)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = placeObstacles(rng, cfg.obstacles)
    const count = candidate.reduce((s, v) => s + v, 0)
    if (count !== cfg.obstacles) continue
    // 预算类参数实测验证：贪心覆盖所需声呐数必须不超过本关预算。
    if (greedyCoverCount(candidate) <= cfg.budget) {
      obstacles = candidate
      break
    }
  }
  return {
    level,
    obstacles,
    marks: new Uint8Array(SIZE * SIZE),
    pings: [],
    budget: cfg.budget,
    wrong: 0,
    t: 0,
    subAcc: 0,
    status: 'playing',
    score: 0,
    fish: makeFish(rng, cfg.fish),
    rng,
  }
}

/** 当前鱼群位置（由 t 线性漂移并在海域内环绕，纯视觉干扰）。 */
export function fishPositions(state: SonarDeductState): { x: number; y: number }[] {
  return state.fish.map(f => ({
    x: ((f.x0 + f.vx * state.t) % SIZE + SIZE) % SIZE,
    y: ((f.y0 + f.vy * state.t) % SIZE + SIZE) % SIZE,
  }))
}

/** 玩家动作：在 (r,c) 发射声呐（成功返回 true）。 */
export function ping(state: SonarDeductState, r: number, c: number): boolean {
  if (state.status !== 'playing') return false
  if (state.budget <= 0) return false
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false
  if (state.pings.some(p => p.r === r && p.c === c)) return false
  state.budget -= 1
  state.pings.push({ r, c, echo: echoAt(state.obstacles, r, c) })
  return true
}

/** 当前插旗数。 */
export function markCount(state: SonarDeductState): number {
  return state.marks.reduce((s, v) => s + v, 0)
}

/** 障碍总数。 */
export function obstacleCount(state: SonarDeductState): number {
  return state.obstacles.reduce((s, v) => s + v, 0)
}

/** 过关分：障碍 ×100 + 剩余声呐 ×60 − 误标 ×20（下限 60）。 */
function winScore(state: SonarDeductState): number {
  return Math.max(60, obstacleCount(state) * 100 + state.budget * 60 - state.wrong * 20)
}

/** 玩家动作：插旗 / 拔旗；旗数凑满时自动判定。 */
export function toggleMark(state: SonarDeductState, r: number, c: number): boolean {
  if (state.status !== 'playing') return false
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false
  const idx = r * SIZE + c
  if (state.marks[idx] === 1) {
    state.marks[idx] = 0
    return true
  }
  state.marks[idx] = 1
  if (markCount(state) !== obstacleCount(state)) return true
  // 凑满自动判定：无错旗即全对（旗数已等于障碍数）；否则错旗即拔并扣分。
  let allCorrect = true
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    if (state.marks[i] !== 1 || state.obstacles[i] === 1) continue
    allCorrect = false
    state.marks[i] = 0
    state.score -= 20
  }
  if (allCorrect) {
    state.score += winScore(state)
    state.status = state.level >= LEVEL_COUNT ? 'allClear' : 'levelClear'
    return true
  }
  state.wrong += 1
  if (state.wrong >= WRONG_LIMIT) state.status = 'gameover'
  return true
}

/** 推进时间（鱼群漂移；固定 1/60 子步，胜负后为空操作）。 */
export function tick(state: SonarDeductState, dt: number): void {
  if (state.status !== 'playing') return
  state.subAcc += Math.max(0, dt)
  const step = 1 / 60
  while (state.subAcc >= step) {
    state.subAcc -= step
    state.t += step
  }
}
