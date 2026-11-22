/**
 * 韦恩图谜题（VennPuzzle）纯逻辑：谓词库、圆几何、区域掩码、关卡生成
 * 与放置判定。一个数字的合法位置由它的「满足掩码」唯一决定——恰好满足
 * 该区域所属的全部圆谓词、且不满足其余圆谓词（圆外 = 全不满足）。所有
 * 随机经注入的 mulberry32(seed) 驱动，同 seed 重放一致，判定全部为
 * 纯函数，可脱离 DOM 测试。
 */

/** 确定性伪随机数生成器（同 seed 序列一致，供测试重放）。
 * @param seed - 32 位非负整数种子。
 * @returns 返回 [0,1) 均匀浮点的随机函数。
 */
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

/** 区域谓词：一个数字是否属于某个圆。 */
export interface Predicate {
  /** 稳定 id（测试与去重用）。 */
  id: string
  /** 展示给玩家的中文标签，如「偶数」。 */
  label: string
  /** 谓词求值。 */
  test: (n: number) => boolean
}

/** @param n - 待判定的正整数。 @returns 是否为质数。 */
function isPrime(n: number): boolean {
  if (n < 2) return false
  for (let d = 2; d * d <= n; d += 1) {
    if (n % d === 0) return false
  }
  return true
}

/** @param n - 待判定的正整数。 @returns 是否为完全平方数。 */
function isSquare(n: number): boolean {
  const r = Math.round(Math.sqrt(n))
  return r * r === n
}

/** @param n - 数字。 @param d - 数字字符。 @returns 十进制表示中是否含 d。 */
function containsDigit(n: number, d: number): boolean {
  return String(n).includes(String(d))
}

/** 谓词库：生成器从中不重复抽取，每关每个圆一条。 */
export const PREDICATES: Predicate[] = [
  { id: 'odd', label: '奇数', test: (n) => n % 2 === 1 },
  { id: 'even', label: '偶数', test: (n) => n % 2 === 0 },
  { id: 'gt20', label: '大于 20', test: (n) => n > 20 },
  { id: 'le20', label: '不大于 20', test: (n) => n <= 20 },
  { id: 'mul3', label: '3 的倍数', test: (n) => n % 3 === 0 },
  { id: 'mul5', label: '5 的倍数', test: (n) => n % 5 === 0 },
  { id: 'd7', label: '含数字 7', test: (n) => containsDigit(n, 7) },
  { id: 'd1', label: '含数字 1', test: (n) => containsDigit(n, 1) },
  { id: 'prime', label: '质数', test: (n) => isPrime(n) },
  { id: 'square', label: '平方数', test: (n) => isSquare(n) },
  { id: 'two', label: '两位数', test: (n) => n >= 10 },
  { id: 'one', label: '一位数', test: (n) => n < 10 },
]

/** 按 id 查谓词。 @param id - 谓词 id。 @returns 谓词或 undefined。 */
export function predicateById(id: string): Predicate | undefined {
  return PREDICATES.find((p) => p.id === id)
}

/** 一个圆的逻辑几何（与渲染共用，保证命中测试一致）。 */
export interface Circle {
  x: number
  y: number
  r: number
}

/** 2 圆关卡的圆心距：两圆明显交叠，形成 4 个区域。 */
const TWO_R = 150
/** 3 圆链式关卡的圆心距：相邻圆交叠、首尾圆不相交，形成 6 个区域。 */
const THREE_R = 115

/** 各关卡数的圆几何（纯数据，逻辑命中测试与渲染共用）。
 * @param circleCount - 圆数量（2 或 3）。
 * @returns 圆数组（从左到右）。
 */
export function circlesFor(circleCount: 2 | 3): Circle[] {
  if (circleCount === 2) {
    return [
      { x: 255, y: 235, r: TWO_R },
      { x: 385, y: 235, r: TWO_R },
    ]
  }
  return [
    { x: 175, y: 235, r: THREE_R },
    { x: 322, y: 235, r: THREE_R },
    { x: 469, y: 235, r: THREE_R },
  ]
}

/** 求点落在哪些圆内（区域掩码：bit i = 在第 i 个圆内）。
 * @param x - 逻辑坐标 x。 @param y - 逻辑坐标 y。 @param circles - 圆数组。
 * @returns 区域掩码。
 */
export function maskAtPoint(x: number, y: number, circles: Circle[]): number {
  let mask = 0
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i]!
    const dx = x - c.x
    const dy = y - c.y
    if (dx * dx + dy * dy <= c.r * c.r) mask |= 1 << i
  }
  return mask
}

/** 该圆数下存在的区域掩码集合：2 圆 = 4 区；3 圆链式去掉 {A,C} 与
 * {A,B,C} 两个几何不存在的掩码 = 6 区。
 * @param circleCount - 圆数量。
 * @returns 升序掩码数组。
 */
export function allowedMasks(circleCount: 2 | 3): number[] {
  if (circleCount === 2) return [0, 1, 2, 3]
  const out: number[] = []
  for (let m = 0; m < 8; m += 1) {
    const inA = (m & 1) !== 0
    const inC = (m & 4) !== 0
    if (inA && inC) continue
    out.push(m)
  }
  return out
}

/** 数字的满足掩码：bit i = 满足第 i 个圆的谓词。
 * @param n - 数字。 @param predicates - 与圆平行的谓词数组。
 * @returns 满足掩码。
 */
export function maskOf(n: number, predicates: Predicate[]): number {
  let mask = 0
  for (let i = 0; i < predicates.length; i += 1) {
    if (predicates[i]!.test(n)) mask |= 1 << i
  }
  return mask
}

/** 关卡总数。 */
export const LEVEL_COUNT = 5
/** 抽数字的正整数全集上界（1..UNIVERSE_MAX）。 */
export const UNIVERSE_MAX = 60
/** 每关数字卡数量（干扰随关数增多）。 */
export const LEVEL_CARD_COUNTS = [12, 13, 14, 15, 16]
/** 每关限时毫秒（null = 不限时；第 4/5 关限时收紧）。 */
export const LEVEL_TIME_LIMITS: Array<number | null> = [null, null, null, 210000, 180000]
/** 过关动画停留毫秒。 */
export const CLEAR_MS = 1100
/** 过关基础分。 */
export const CLEAR_BASE = 1000
/** 每次错放扣分。 */
export const WRONG_PENALTY = 50
/** 单关保底分。 */
export const CLEAR_MIN = 200
/** 限时关每剩余秒加分上限。 */
export const TIME_BONUS_MAX = 300

/** 一关的静态配置（生成后不变，可整关比对重放）。 */
export interface LevelSpec {
  /** 关号（1 起）。 */
  level: number
  /** 圆数量。 */
  circleCount: 2 | 3
  /** 与圆平行的谓词（圆 i 的标签 = predicates[i]）。 */
  predicates: Predicate[]
  /** 数字卡池（未放置的全部数字，生成顺序即展示顺序）。 */
  pool: number[]
  /** 限时毫秒，null = 不限时。 */
  timeLimitMs: number | null
}

/** Fisher-Yates 洗牌（就地）。
 * @param arr - 待洗数组。 @param rng - 随机源。
 */
function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
}

/** 不重复地从谓词库抽 count 条。
 * @param rng - 随机源。 @param count - 抽取数量。
 * @returns 谓词数组。
 */
function samplePredicates(rng: () => number, count: number): Predicate[] {
  const idx = PREDICATES.map((_, i) => i)
  shuffle(idx, rng)
  return idx.slice(0, count).map((i) => PREDICATES[i]!)
}

/** 生成一关：随机取谓词 + 从全集抽数字，保证每个允许区域都至少有
 * 1 张可放的卡（干扰数字 = 掩码「看似接近实则不同」的数字）。
 * @param rng - 随机源（消耗顺序确定）。
 * @param level - 关号（1 起，决定圆数/卡数/限时）。
 * @returns 关卡配置。
 */
export function generateLevel(rng: () => number, level: number): LevelSpec {
  const circleCount: 2 | 3 = level <= 2 ? 2 : 3
  const cardCount = LEVEL_CARD_COUNTS[level - 1] ?? 12
  const timeLimitMs = LEVEL_TIME_LIMITS[level - 1] ?? null
  const allowed = allowedMasks(circleCount)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const predicates = samplePredicates(rng, circleCount)
    const byMask = new Map<number, number[]>()
    for (const m of allowed) byMask.set(m, [])
    for (let n = 1; n <= UNIVERSE_MAX; n += 1) {
      const m = maskOf(n, predicates)
      const bucket = byMask.get(m)
      if (bucket !== undefined) bucket.push(n)
    }
    // 可达性：每个允许区域都要有候选数字，且总量够凑满卡池。
    if (allowed.some((m) => (byMask.get(m) ?? []).length === 0)) continue
    const candidates: number[] = []
    for (const m of allowed) candidates.push(...(byMask.get(m) ?? []))
    if (candidates.length < cardCount) continue
    const pool: number[] = []
    const masksOrder = [...allowed]
    shuffle(masksOrder, rng)
    for (const m of masksOrder) {
      const bucket = byMask.get(m) ?? []
      const pick = bucket[Math.floor(rng() * bucket.length)]!
      pool.push(pick)
    }
    shuffle(candidates, rng)
    for (const n of candidates) {
      if (pool.length >= cardCount) break
      if (!pool.includes(n)) pool.push(n)
    }
    if (pool.length < cardCount) continue
    return { level, circleCount, predicates, pool, timeLimitMs }
  }
  throw new Error('vennpuzzle: generateLevel failed to build a reachable level')
}

/** 一关的运行时状态。 */
export interface VennGameState {
  /** 当前关号（1 起）。 */
  level: number
  /** 全部 5 关配置（生成期一次抽出，保证同 seed 重放一致）。 */
  specs: LevelSpec[]
  /** 当前关圆数量。 */
  circleCount: 2 | 3
  /** 当前关圆几何。 */
  circles: Circle[]
  /** 当前关谓词。 */
  predicates: Predicate[]
  /** 未放置的数字卡。 */
  pool: number[]
  /** 已放置记录。 */
  placed: Array<{ num: number; mask: number }>
  /** 本关错放次数。 */
  wrong: number
  /** 本关操作步数（对 + 错）。 */
  steps: number
  /** playing 进行中 / clear 过关动画 / complete 全通关 / failed 超时。 */
  phase: 'playing' | 'clear' | 'complete' | 'failed'
  /** 本关限时毫秒，null = 不限时。 */
  timeLimitMs: number | null
  /** 本关已用毫秒。 */
  elapsedMs: number
  /** 已结算的累计得分。 */
  score: number
  /** 过关动画剩余毫秒。 */
  levelClearMs: number
  /** 创建时注入的随机源。 */
  rng: () => number
}

/** 载入某关配置到运行时字段（开局与过关切换共用）。
 * @param state - 状态。 @param spec - 关卡配置。
 */
function loadLevel(state: VennGameState, spec: LevelSpec): void {
  state.level = spec.level
  state.circleCount = spec.circleCount
  state.circles = circlesFor(spec.circleCount)
  state.predicates = spec.predicates
  state.pool = [...spec.pool]
  state.placed = []
  state.wrong = 0
  state.steps = 0
  state.phase = 'playing'
  state.timeLimitMs = spec.timeLimitMs
  state.elapsedMs = 0
  state.levelClearMs = 0
}

/** 创建初始状态：一次抽出全部 5 关。
 * @param rng - 注入随机源（如 mulberry32(seed)）。
 * @returns 初始状态（第 1 关 playing）。
 */
export function createVennGameState(rng: () => number): VennGameState {
  const specs: LevelSpec[] = []
  for (let lv = 1; lv <= LEVEL_COUNT; lv += 1) {
    specs.push(generateLevel(rng, lv))
  }
  const state: VennGameState = {
    level: 1,
    specs,
    circleCount: 2,
    circles: circlesFor(2),
    predicates: specs[0]!.predicates,
    pool: [],
    placed: [],
    wrong: 0,
    steps: 0,
    phase: 'playing',
    timeLimitMs: null,
    elapsedMs: 0,
    score: 0,
    levelClearMs: 0,
    rng,
  }
  loadLevel(state, specs[0]!)
  return state
}

/** 单关结算分：基础分扣错放，限时关按剩余秒加成。
 * @param wrong - 本关错放次数。 @param remainingMs - 剩余毫秒（不限时传 null）。
 * @returns 结算分。
 */
export function clearScore(wrong: number, remainingMs: number | null): number {
  const base = Math.max(CLEAR_MIN, CLEAR_BASE - wrong * WRONG_PENALTY)
  if (remainingMs === null) return base
  return base + Math.min(TIME_BONUS_MAX, Math.floor(remainingMs / 1000) * 2)
}

/** 放置一张数字卡：合法当且仅当其满足掩码恰好等于目标区域掩码。
 * @param state - 状态。 @param num - 数字卡。 @param mask - 目标区域掩码。
 * @returns 'ok' 放对 / 'wrong' 放错（计步） / 'ignored' 无效输入。
 */
export function placeCard(state: VennGameState, num: number, mask: number): 'ok' | 'wrong' | 'ignored' {
  if (state.phase !== 'playing') return 'ignored'
  const idx = state.pool.indexOf(num)
  if (idx < 0) return 'ignored'
  if (maskOf(num, state.predicates) !== mask) {
    state.wrong += 1
    state.steps += 1
    return 'wrong'
  }
  state.pool.splice(idx, 1)
  state.placed.push({ num, mask })
  state.steps += 1
  if (state.pool.length === 0) {
    const remaining = state.timeLimitMs === null ? null : Math.max(0, state.timeLimitMs - state.elapsedMs)
    state.score += clearScore(state.wrong, remaining)
    state.phase = 'clear'
    state.levelClearMs = CLEAR_MS
  }
  return 'ok'
}

/** 推进时间：限时倒计时、超时判负、过关动画结束后切下一关或通关。
 * @param state - 状态。 @param dtMs - 帧间隔毫秒。
 * @returns 本帧是否发生了阶段切换（供渲染标脏）。
 */
export function tick(state: VennGameState, dtMs: number): boolean {
  if (state.phase === 'playing') {
    if (state.timeLimitMs !== null) {
      state.elapsedMs += dtMs
      if (state.elapsedMs >= state.timeLimitMs) {
        state.phase = 'failed'
        return true
      }
    }
    return false
  }
  if (state.phase === 'clear') {
    state.levelClearMs -= dtMs
    if (state.levelClearMs > 0) return false
    if (state.level >= LEVEL_COUNT) {
      state.phase = 'complete'
    } else {
      loadLevel(state, state.specs[state.level]!)
    }
    return true
  }
  return false
}

/** 每个允许区域在卡池中的可达数字数（生成器自检 / 测试用）。
 * @param spec - 关卡配置。
 * @returns 掩码 -> 卡池中满足掩码的数字个数。
 */
export function regionReachable(spec: LevelSpec): Map<number, number> {
  const out = new Map<number, number>()
  for (const m of allowedMasks(spec.circleCount)) out.set(m, 0)
  for (const n of spec.pool) {
    const m = maskOf(n, spec.predicates)
    if (out.has(m)) out.set(m, (out.get(m) ?? 0) + 1)
  }
  return out
}
