/**
 * 转盘密码 (Rotation) 纯逻辑：同心圆环密码锁的盘面生成（每层格数、空缺
 * 分布、目标角均由注入 seed 决定）、逐层旋转状态与步进模长、径向通路
 * 判定（沿指定角度逐层查该格是否空缺）、多目标角依次打通流转、过关计
 * 分与关卡推进。全部随机走注入 seed（mulberry32），确定性可测；无
 * DOM、无定时器。
 */

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
  return (Math.imul(seed >>> 0, 374761393) + Math.imul(level, 668265263)) >>> 0
}

/** 非负模：结果落在 [0, m)。 */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** 一层同心圆环：slots 个等分格；gaps 描述图案格，rotation 为步进。 */
export interface RingLayer {
  /** 该层等分格数。 */
  slots: number
  /** 图案格空缺表：true=空缺（可透光），false=挡板。 */
  gaps: boolean[]
  /** 当前旋转步数：盘面格 j 显示图案格 mod(j - rotation, slots)。 */
  rotation: number
}

/** 一关盘面：同心层（0 为最内层）与目标角度序列（度）。 */
export interface RotationLevel {
  layers: RingLayer[]
  /** 需依次打通的目标角度（度，0=正右方，顺时针增长）。 */
  targetAngles: number[]
}

/** 关卡骨架：每层格数、每层空缺数、目标角个数。 */
export interface LevelDef {
  slots: number[]
  gapCounts: number[]
  targetCount: number
}

/** 5 关递进：层数 4→6、空缺更稀疏、目标角 1→3 个。 */
export const LEVEL_DEFS: LevelDef[] = [
  { slots: [6, 8, 10, 12], gapCounts: [3, 3, 3, 3], targetCount: 1 },
  { slots: [6, 8, 10, 12], gapCounts: [2, 2, 2, 2], targetCount: 2 },
  { slots: [6, 8, 10, 12, 14], gapCounts: [3, 2, 2, 2, 2], targetCount: 2 },
  { slots: [8, 10, 12, 14, 16], gapCounts: [2, 2, 1, 1, 1], targetCount: 3 },
  { slots: [8, 10, 12, 14, 16, 18], gapCounts: [2, 2, 2, 1, 1, 1], targetCount: 3 },
]

/** 关卡总数。 */
export const LEVEL_COUNT = LEVEL_DEFS.length

/** 过关基础分（乘以关卡号）。 */
export const WIN_BASE = 100
/** 每步扣的分（效率奖励下限 0）。 */
export const STEP_COST = 5
/** 效率奖励上限。 */
export const BONUS_MAX = 150

/** 目标角候选网格（度）。 */
const TARGET_STEP_DEG = 30
/** 目标角之间的最小角距（度）。 */
const TARGET_MIN_SEPARATION = 60

export type RotationStatus = 'playing' | 'won' | 'cleared'

export interface RotationState {
  /** 1-based 关卡号。 */
  level: number
  score: number
  /** 进入本关时的得分（R 重开时回滚到它，防止反复刷分）。 */
  levelStartScore: number
  status: RotationStatus
  /** 盘面种子：同 seed 同关卡必生成同盘面。 */
  seed: number
  board: RotationLevel
  /** 当前选中的层下标（0 为最内层）。 */
  selectedLayer: number
  /** 旋转操作步数。 */
  steps: number
  /** 已打通的目标角个数（下一个待打通的是 targetAngles[targetIndex]）。 */
  targetIndex: number
}

/** 角度归一化到 [0, 360)。 */
function normalizeAngle(angle: number): number {
  return mod(angle, 360)
}

/** 角度在该层落在哪个等分格（0-based）。 */
export function angleIndex(slots: number, angle: number): number {
  return Math.floor((normalizeAngle(angle) / 360) * slots + 1e-9) % slots
}

/** 该层在指定角度是否空缺（透光）。 */
export function layerOpenAtAngle(layer: RingLayer, angle: number): boolean {
  const j = angleIndex(layer.slots, angle)
  return layer.gaps[mod(j - layer.rotation, layer.slots)] === true
}

/** 沿指定角度的逐层通路：第 i 项为第 i 层是否空缺。 */
export function beamAt(level: RotationLevel, angle: number): boolean[] {
  return level.layers.map(layer => layerOpenAtAngle(layer, angle))
}

/**
 * 找一个让该层在指定角度空缺的旋转步数。
 * @returns 最小的可行旋转，层无空缺时返回 null。
 */
export function findOpening(layer: RingLayer, angle: number): number | null {
  for (let r = 0; r < layer.slots; r += 1) {
    if (layer.gaps[mod(angleIndex(layer.slots, angle) - r, layer.slots)] === true) return r
  }
  return null
}

/** Fisher-Yates 洗牌 0..n-1（注入 rng）。 */
function shuffled(rng: () => number, n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

/** 两角的最小角距（度）。 */
function angularDist(a: number, b: number): number {
  const d = Math.abs(mod(a - b, 360))
  return Math.min(d, 360 - d)
}

/** 抽取互异且角距达标的目标角。 */
function pickTargets(rng: () => number, count: number): number[] {
  const candidates = Array.from({ length: 12 }, (_, i) => i * TARGET_STEP_DEG)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const picked: number[] = []
    for (const i of shuffled(rng, candidates.length)) {
      const deg = candidates[i]!
      if (picked.every(p => angularDist(p, deg) >= TARGET_MIN_SEPARATION)) picked.push(deg)
    }
    if (picked.length >= count) return picked.slice(0, count)
  }
  // 兜底：固定等距三角（正常随机路径绝不会走到这里）。
  return [0, 120, 240].slice(0, count)
}

/**
 * 生成第 level 关（1-based；越界钳到 1..LEVEL_COUNT）。
 * 每层至少 1 个空缺（任何角度都存在可解朝向）且至少 1 个挡板；打乱后
 * 首个目标角必不通（否则逐格拧最内层直到被挡住）。
 * @param rng - 注入随机源。
 */
export function generateLevel(level: number, rng: () => number): RotationLevel {
  const clamped = Math.min(LEVEL_COUNT, Math.max(1, level))
  const def = LEVEL_DEFS[clamped - 1]!
  const layers: RingLayer[] = def.slots.map((slots, i) => {
    const want = Math.max(1, Math.min(def.gapCounts[i] ?? 1, slots - 1))
    const gaps = Array.from({ length: slots }, () => false)
    for (const p of shuffled(rng, slots).slice(0, want)) gaps[p] = true
    return { slots, gaps, rotation: Math.floor(rng() * slots) }
  })
  const targetAngles = pickTargets(rng, def.targetCount)
  const board: RotationLevel = { layers, targetAngles }
  let guard = 0
  while (beamAt(board, targetAngles[0]!).every(Boolean) && guard < 64) {
    layers[0]!.rotation = mod(layers[0]!.rotation + 1, layers[0]!.slots)
    guard += 1
  }
  return board
}

/** 过关得分：基础分 × 关卡号 + 步数效率奖励（下限 0）。 */
export function winScore(level: number, steps: number): number {
  return WIN_BASE * level + Math.max(0, BONUS_MAX - STEP_COST * steps)
}

/**
 * 把第 layerIndex 层旋转 dir 格（+1 顺时针步进）。
 * 每次旋转后检查当前目标角：全层空缺则推进目标；全部目标打通即过关
 * 并一次性计分。
 * @returns 旋转生效返回 true；非进行态或层下标越界返回 false。
 */
export function rotateLayer(state: RotationState, layerIndex: number, dir: 1 | -1): boolean {
  if (state.status !== 'playing') return false
  const layer = state.board.layers[layerIndex]
  if (layer === undefined) return false
  layer.rotation = mod(layer.rotation + dir, layer.slots)
  state.steps += 1
  const angle = state.board.targetAngles[state.targetIndex]
  if (angle !== undefined && beamAt(state.board, angle).every(Boolean)) {
    state.targetIndex += 1
    if (state.targetIndex >= state.board.targetAngles.length) {
      state.status = 'won'
      state.score += winScore(state.level, state.steps)
    }
  }
  return true
}

/** 重开本关：同一盘面（同 seed 同关卡），分数回滚到进关时。 */
export function restartLevel(state: RotationState): void {
  state.board = generateLevel(state.level, mulberry32(levelSeed(state.seed, state.level)))
  state.status = 'playing'
  state.score = state.levelStartScore
  state.selectedLayer = 0
  state.steps = 0
  state.targetIndex = 0
}

/** 过关后进入下一关：第 5 关获胜即整局终了（'cleared'）。 */
export function advanceLevel(state: RotationState): void {
  if (state.status !== 'won') return
  if (state.level >= LEVEL_COUNT) {
    state.status = 'cleared'
    return
  }
  state.level += 1
  state.board = generateLevel(state.level, mulberry32(levelSeed(state.seed, state.level)))
  state.status = 'playing'
  state.selectedLayer = 0
  state.steps = 0
  state.targetIndex = 0
  state.levelStartScore = state.score
}

/**
 * 新建一局状态。
 * @param level - 1-based 关卡号。
 * @param score - 结转得分。
 * @param seed - 盘面种子。
 */
export function createRotationState(level = 1, score = 0, seed = 0x10ca3): RotationState {
  return {
    level,
    score,
    levelStartScore: score,
    status: 'playing',
    seed,
    board: generateLevel(level, mulberry32(levelSeed(seed, level))),
    selectedLayer: 0,
    steps: 0,
    targetIndex: 0,
  }
}
