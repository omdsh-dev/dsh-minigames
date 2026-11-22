/**
 * 星域征服 Galcon 纯逻辑层：seed 确定性生成星球盘面（位置 / 大小 /
 * 归属 / 初始兵力）、每秒按大小产兵、点击选星与 50% 派兵、飞行舰队
 * 按距离计时、到达对冲（攻-防，正差占领）、AI 决策（集火最弱目标 +
 * 受攻回防，随局加速）、3 局积分与胜负判定。全部随机走注入 seed
 * （mulberry32），同 seed 逐位可重放；渲染与 DOM 均不在本层。
 */

/** 逻辑画布宽（px）。 */
export const W = 960
/** 逻辑画布高（px）。 */
export const H = 640
/** 单局时长上限（ms）：超时按总兵力多少判定胜负。 */
export const ROUND_MS = 120000
/** 舰队飞行速度（px/s）：飞行耗时 = 星球距离 / 速度。 */
export const FLEET_SPEED = 66
/** 派兵比例：从源星球派出当前兵力的 50%（向下取整）。 */
export const SEND_RATIO = 0.5
/** 一场比赛的局数（3 局积分制）。 */
export const MATCH_ROUNDS = 3
/** 各局 AI 决策间隔（ms），随局号递减（难度上升）。 */
export const AI_INTERVALS = [2400, 1900, 1500] as const

/** 星球归属方。 */
export type Owner = 'player' | 'ai' | 'neutral'

/** 一颗星球：位置 / 半径 / 归属 / 兵力 / 产兵速率（兵/秒）。 */
export interface Planet {
  id: number
  x: number
  y: number
  r: number
  owner: Owner
  troops: number
  /** 每秒产兵数，与半径成正比（只有归属方产兵）。 */
  prodRate: number
}

/** 一支飞行舰队：按 elapsedMs/totalMs 插值位置，到达即结算。 */
export interface Fleet {
  id: number
  owner: 'player' | 'ai'
  fromId: number
  toId: number
  count: number
  elapsedMs: number
  totalMs: number
}

/** 一局 / 一场比赛的完整状态。 */
export interface GalconState {
  seed: number
  /** 第几局（0 基），同时决定 AI 间隔与盘面变体。 */
  matchIndex: number
  /** 重开次数：R 重开递增并改变盘面变体。 */
  attempt: number
  planets: Planet[]
  fleets: Fleet[]
  /** 当前选中的己方星球 id 列表。 */
  selectedIds: number[]
  /** 本局已进行时长（ms）。 */
  roundMs: number
  timeMs: number
  aiTimerMs: number
  /** 下一支舰队 / 星球的 id 发号器。 */
  nextId: number
  phase: 'playing' | 'won' | 'lost' | 'matchOver'
  /** 每局胜负记录（'win' | 'loss'）。 */
  results: ('win' | 'loss')[]
  /** 3 局累计积分。 */
  totalScore: number
}

/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 注入种子。
 * @returns 返回 [0,1) 均匀分布随机数的函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 星球生成区域边界：顶部让出 HUD、底部让出常驻速览行。 */
const BOARD = { xMin: 60, xMax: W - 60, yMin: 100, yMax: H - 70 }
const R_MIN = 16
const R_MAX = 30
/** 两星球圆心最小间距 = 半径和 + 该间隙。 */
const MIN_GAP = 22

/** 两点距离。 */
function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/** 按 id 查星球；不存在返回 null。 */
export function planetById(state: GalconState, id: number): Planet | null {
  return state.planets.find((p) => p.id === id) ?? null
}

/** 两星球球面距离（圆心距 - 双方半径，用于飞行计时）。 */
export function planetGap(a: Planet, b: Planet): number {
  return Math.max(1, dist(a.x, a.y, b.x, b.y) - a.r - b.r)
}

/**
 * seed 确定性生成星球盘面：12-16 颗、互不重叠、都在边界内；最左为
 * 玩家母星、最右为 AI 母星（初始兵力高于中立星），其余中立。
 * @param seed - 注入种子。
 * @param matchIndex - 局号（0 基），参与盘面变体。
 * @param attempt - 重开序号（0 基），R 重开换盘。
 * @returns 星球数组。
 */
export function generatePlanets(seed: number, matchIndex: number, attempt: number): Planet[] {
  const rng = mulberry32((seed + matchIndex * 7919 + attempt * 104729) >>> 0)
  const count = 12 + Math.floor(rng() * 5)
  const planets: Planet[] = []
  let gap = MIN_GAP
  for (let i = 0; i < count; i += 1) {
    let placed = false
    for (let tries = 0; tries < 500 && !placed; tries += 1) {
      const r = R_MIN + rng() * (R_MAX - R_MIN)
      const x = BOARD.xMin + r + rng() * (BOARD.xMax - BOARD.xMin - 2 * r)
      const y = BOARD.yMin + r + rng() * (BOARD.yMax - BOARD.yMin - 2 * r)
      const ok = planets.every(
        (p) => dist(p.x, p.y, x, y) >= p.r + r + gap,
      )
      if (ok || tries === 499) {
        // 500 次拒绝采样仍未放下：接受当前位置（重叠概率实际为 0，
        // 保险起见放宽间隙重来）。
        if (!ok) {
          gap = Math.max(4, gap / 2)
          i -= 1
          break
        }
        planets.push({ id: i + 1, x, y, r, owner: 'neutral', troops: 0, prodRate: r / 10 })
        placed = true
      }
    }
  }
  // 归属：最左玩家、最右 AI；初始兵力按归属与大小。
  let home = planets[0]!
  for (const p of planets) if (p.x < home.x) home = p
  home.owner = 'player'
  home.troops = 40 + Math.round(home.r)
  let aiHome = planets[0]!
  for (const p of planets) if (p.x > aiHome.x) aiHome = p
  aiHome.owner = 'ai'
  aiHome.troops = 40 + Math.round(aiHome.r)
  for (const p of planets) {
    if (p.owner === 'neutral') p.troops = Math.round(p.r * 1.1)
  }
  return planets
}

/**
 * 开一局新比赛（3 局积分清零，第 1 局盘面）。
 * @param seed - 注入种子。
 * @returns 初始状态。
 */
export function createGalcon(seed: number): GalconState {
  return {
    seed,
    matchIndex: 0,
    attempt: 0,
    planets: generatePlanets(seed, 0, 0),
    fleets: [],
    selectedIds: [],
    roundMs: 0,
    timeMs: 0,
    aiTimerMs: 0,
    nextId: 100,
    phase: 'playing',
    results: [],
    totalScore: 0,
  }
}

/** 把状态重置为第 matchIndex 局开局（保留积分与胜负记录）。 */
function resetRound(state: GalconState): void {
  state.planets = generatePlanets(state.seed, state.matchIndex, state.attempt)
  state.fleets = []
  state.selectedIds = []
  state.roundMs = 0
  state.aiTimerMs = 0
  state.nextId = 100
  state.phase = 'playing'
}

/**
 * 进入下一局：未满 3 局重置盘面，满 3 局进入 matchOver。
 * @param state - 当前状态（原地更新）。
 */
export function nextMatch(state: GalconState): void {
  if (state.results.length >= MATCH_ROUNDS) {
    state.phase = 'matchOver'
    return
  }
  state.matchIndex = state.results.length
  resetRound(state)
}

/**
 * R 重开：清空积分与记录，从第 1 局重开（attempt+1 换新盘面）。
 * @param state - 当前状态（原地更新）。
 */
export function restartMatch(state: GalconState): void {
  state.attempt += 1
  state.matchIndex = 0
  state.results = []
  state.totalScore = 0
  resetRound(state)
}

/**
 * 点击一颗星球：点己方=选中（已选中则全选己方）；点其余目标=从当前
 * 选中星球各派 50% 兵力并清空选中。
 * @param state - 当前状态。
 * @param planetId - 被点击的星球 id。
 * @returns 动作类型：'select' | 'selectAll' | 'launch' | 'none'。
 */
export function selectPlanet(state: GalconState, planetId: number): 'select' | 'selectAll' | 'launch' | 'none' {
  if (state.phase !== 'playing') return 'none'
  const p = planetById(state, planetId)
  if (p === null) return 'none'
  if (p.owner === 'player') {
    if (state.selectedIds.length === 1 && state.selectedIds[0] === planetId) {
      state.selectedIds = state.planets.filter((q) => q.owner === 'player').map((q) => q.id)
      return 'selectAll'
    }
    state.selectedIds = [planetId]
    return 'select'
  }
  if (state.selectedIds.length === 0) return 'none'
  launchFleet(state, state.selectedIds, planetId)
  state.selectedIds = []
  return 'launch'
}

/** 全选己方星球（空格键）。 */
export function selectAllOwn(state: GalconState): void {
  if (state.phase !== 'playing') return
  state.selectedIds = state.planets.filter((q) => q.owner === 'player').map((q) => q.id)
}

/**
 * 从若干源星球向目标星球派出各 50% 兵力（向下取整，至少 1 兵才派）。
 * @param state - 当前状态。
 * @param fromIds - 源星球 id 列表（须归属发送方）。
 * @param toId - 目标星球 id。
 * @returns 实际派出的总兵力。
 */
export function launchFleet(state: GalconState, fromIds: number[], toId: number): number {
  const target = planetById(state, toId)
  if (target === null) return 0
  let sent = 0
  for (const id of fromIds) {
    const src = planetById(state, id)
    if (src === null || src.owner === 'neutral' || src.id === toId) continue
    const count = Math.floor(src.troops * SEND_RATIO)
    if (count < 1) continue
    src.troops -= count
    state.fleets.push({
      id: state.nextId,
      owner: src.owner,
      fromId: src.id,
      toId,
      count,
      elapsedMs: 0,
      totalMs: (planetGap(src, target) / FLEET_SPEED) * 1000,
    })
    state.nextId += 1
    sent += count
  }
  return sent
}

/**
 * 舰队当前位置：源星到目标星按 elapsed/total 插值（沿圆心连线）。
 * @param state - 当前状态。
 * @param fleet - 舰队。
 * @returns 逻辑坐标。
 */
export function fleetPos(state: GalconState, fleet: Fleet): { x: number, y: number } {
  const a = planetById(state, fleet.fromId)
  const b = planetById(state, fleet.toId)
  if (a === null || b === null) return { x: W / 2, y: H / 2 }
  const t = Math.min(1, fleet.elapsedMs / fleet.totalMs)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/**
 * 一支舰队到达某星球的结算：己方星叠加兵力；敌方星对冲（守方兵力 -
 * 攻方兵力，正差翻转归属），中立星同对冲规则。
 * @param state - 当前状态。
 * @param fleet - 到达的舰队。
 */
export function resolveArrival(state: GalconState, fleet: Fleet): void {
  const p = planetById(state, fleet.toId)
  if (p === null) return
  if (p.owner === fleet.owner) {
    p.troops += fleet.count
    return
  }
  p.troops -= fleet.count
  if (p.troops < 0) {
    p.owner = fleet.owner
    p.troops = -p.troops
  }
}

/** 某方总兵力：星球驻军 + 在途舰队。 */
export function totalTroops(state: GalconState, owner: 'player' | 'ai'): number {
  let sum = 0
  for (const p of state.planets) if (p.owner === owner) sum += p.troops
  for (const f of state.fleets) if (f.owner === owner) sum += f.count
  return sum
}

/**
 * AI 决策（确定性，同状态同决策）：受攻星球优先回防（从兵力最多的
 * 己方星派 50% 增援）；否则从兵力最多的己方星向兵力最少的非己方星
 * 发起进攻。
 * @param state - 当前状态。
 * @returns 是否实际派出了舰队。
 */
export function aiMove(state: GalconState): boolean {
  const aiPlanets = state.planets.filter((p) => p.owner === 'ai')
  if (aiPlanets.length === 0) return false
  // 1) 回防：找威胁最大（ incoming - 驻防 - 途中产能 ）的 AI 星。
  let threat: { id: number, danger: number } | null = null
  for (const p of aiPlanets) {
    let incoming = 0
    for (const f of state.fleets) {
      if (f.owner === 'player' && f.toId === p.id) incoming += f.count
    }
    if (incoming <= 0) continue
    const eta = Math.min(
      ...state.fleets.filter((f) => f.owner === 'player' && f.toId === p.id).map((f) => (f.totalMs - f.elapsedMs) / 1000),
    )
    const defendable = p.troops + p.prodRate * Math.max(0, eta)
    const danger = incoming - defendable
    if (danger > 0 && (threat === null || danger > threat.danger)) threat = { id: p.id, danger }
  }
  const strongest = (exclude: number): Planet | null => {
    let best: Planet | null = null
    for (const p of aiPlanets) {
      if (p.id === exclude) continue
      if (best === null || p.troops > best.troops) best = p
    }
    return best
  }
  if (threat !== null) {
    const helper = strongest(threat.id)
    if (helper !== null && helper.troops >= 12) {
      return launchFleet(state, [helper.id], threat.id) > 0
    }
  }
  // 2) 进攻：兵力最少的非 AI 星（平局取 id 小者）。
  let target: Planet | null = null
  for (const p of state.planets) {
    if (p.owner === 'ai') continue
    if (target === null || p.troops < target.troops || (p.troops === target.troops && p.id < target.id)) target = p
  }
  if (target === null) return false
  const sender = strongest(-1)
  if (sender === null || sender.troops < 15) return false
  return launchFleet(state, [sender.id], target.id) > 0
}

/** 本局 AI 决策间隔（随局号递减）。 */
export function aiInterval(matchIndex: number): number {
  return AI_INTERVALS[Math.min(matchIndex, AI_INTERVALS.length - 1)]!
}

/**
 * 结束本局：记胜负与积分（胜 = 100 + 剩余总兵力取整；负 = 0），置
 * phase 为 'won' / 'lost'。
 * @param state - 当前状态。
 * @param won - 玩家是否获胜。
 */
function finishRound(state: GalconState, won: boolean): void {
  state.results.push(won ? 'win' : 'loss')
  state.totalScore += won ? 100 + Math.round(totalTroops(state, 'player')) : 0
  state.phase = won ? 'won' : 'lost'
}

/**
 * 推进一帧模拟：产兵、舰队飞行与到达结算、AI 计时决策、胜负与超时
 * 判定。只依赖 state 与 dt，同 seed 同输入序列逐位可重放。
 * @param state - 当前状态（原地更新）。
 * @param dtMs - 帧时长（ms）。
 */
export function stepGalcon(state: GalconState, dtMs: number): void {
  if (state.phase !== 'playing') return
  const dt = dtMs / 1000
  state.timeMs += dtMs
  state.roundMs += dtMs
  // 产兵：归属方才产。
  for (const p of state.planets) {
    if (p.owner !== 'neutral') p.troops += p.prodRate * dt
  }
  // 舰队推进；到期的按 id 顺序结算。
  const arrived: Fleet[] = []
  for (const f of state.fleets) {
    f.elapsedMs += dtMs
    if (f.elapsedMs >= f.totalMs) arrived.push(f)
  }
  arrived.sort((a, b) => a.id - b.id)
  for (const f of arrived) {
    state.fleets.splice(state.fleets.indexOf(f), 1)
    resolveArrival(state, f)
  }
  // AI：固定间隔触发（间隔随局号降低）。
  state.aiTimerMs += dtMs
  const interval = aiInterval(state.matchIndex)
  while (state.aiTimerMs >= interval) {
    state.aiTimerMs -= interval
    aiMove(state)
  }
  // 胜负：全图归一（含在途舰队清零）或超时兵多者胜（平兵判负）。
  const aiLeft = state.planets.some((p) => p.owner === 'ai') || state.fleets.some((f) => f.owner === 'ai')
  const playerLeft = state.planets.some((p) => p.owner === 'player') || state.fleets.some((f) => f.owner === 'player')
  if (!aiLeft) finishRound(state, true)
  else if (!playerLeft) finishRound(state, false)
  else if (state.roundMs >= ROUND_MS) {
    finishRound(state, totalTroops(state, 'player') > totalTroops(state, 'ai'))
  }
}
