/**
 * 装箱谜题 BinPack 纯逻辑：一维装箱优化谜题的核心规则与求解器。
 * 每关由生成器「先构造装箱、再打乱」产出物品，保证恰好用最优箱数装完
 * 一定可行；玩家点击物品、点击箱子放入或取出，任意时刻箱内体积和不得
 * 超过容量。全部随机走注入 seed 的 mulberry32，不含任何 DOM / canvas
 * 依赖，可直接单测。
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

/** 一关的固定参数：容量、构造用箱数、每箱物品数。 */
export interface BinPackLevelConfig {
  /** 单箱容量 C。 */
  capacity: number
  /** 构造装箱使用的箱数（即最优箱数）。 */
  bins: number
  /** 每箱构造出的物品个数（体积 1-9）。 */
  perBin: number
}

/** 五关递进：物品更多、容量更紧。 */
export const LEVELS: readonly BinPackLevelConfig[] = [
  { capacity: 12, bins: 3, perBin: 3 },
  { capacity: 10, bins: 4, perBin: 2 },
  { capacity: 12, bins: 4, perBin: 4 },
  { capacity: 9, bins: 5, perBin: 2 },
  { capacity: 15, bins: 5, perBin: 3 },
]

/** 关卡总数。 */
export const LEVEL_COUNT = LEVELS.length

/** 生成出来的一关：物品体积列表 + 元信息。 */
export interface BinPackLevel {
  /** 1 起的关卡号。 */
  level: number
  /** 单箱容量。 */
  capacity: number
  /** 最优（构造）箱数。 */
  optimal: number
  /** 物品体积列表（已打乱，体积 1-9）。 */
  items: number[]
}

/**
 * 把容量 C 随机拆成 k 个 1-9 的正整数（rng 注入，确定性）。
 * @param capacity - 容量 C。
 * @param count - 拆出的份数 k。
 * @param rng - 注入的随机源。
 * @returns k 个 1-9 的体积，和恰为 C。
 */
function randomSplit(capacity: number, count: number, rng: () => number): number[] {
  const parts = new Array<number>(count).fill(1)
  let extra = capacity - count
  while (extra > 0) {
    const i = Math.floor(rng() * count)
    if (parts[i]! < 9) {
      parts[i]! += 1
      extra -= 1
    }
  }
  return parts
}

/**
 * 生成一关：每箱按 randomSplit 构造恰好装满的装箱，再整体 Fisher-Yates
 * 打乱。因为总体积 = bins * capacity，任何装法的箱数 ≥ ceil(总体积 / C)
 * = bins，而构造解恰好用 bins 个箱，故 optimal = bins 一定可达成。
 * @param level - 1 起的关卡号（1-5）。
 * @param seedOverride - 覆盖默认种子（测试 / 重放用）。
 * @returns 关卡数据；level 越界返回 null。
 */
export function generateLevel(level: number, seedOverride?: number): BinPackLevel | null {
  if (level < 1 || level > LEVEL_COUNT) return null
  const config = LEVELS[level - 1]!
  const seed = seedOverride ?? level * 0x9e3779b9
  const rng = mulberry32(seed)
  const items: number[] = []
  for (let b = 0; b < config.bins; b += 1) {
    for (const size of randomSplit(config.capacity, config.perBin, rng)) items.push(size)
  }
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]!
    items[i]! = items[j]!
    items[j]! = tmp
  }
  return { level, capacity: config.capacity, optimal: config.bins, items }
}

/** 对局状态：物品归属（-1 = 未放入），箱位固定 optimal + 2 个。 */
export interface BinPackState {
  /** 所属关卡。 */
  level: BinPackLevel
  /** 每个物品当前所在箱；-1 表示还在待装区。 */
  binOf: number[]
  /** 可见箱总数（含空箱）。 */
  binCount: number
  /** 当前选中的物品下标；-1 表示未选中。 */
  selected: number
  /** 已用的步数（放入 / 取出各计 1 步）。 */
  steps: number
}

/**
 * 由关卡创建对局状态。
 * @param level - 生成好的关卡。
 * @returns 全部物品待装、未选中、0 步的初始状态。
 */
export function createState(level: BinPackLevel): BinPackState {
  return {
    level,
    binOf: new Array<number>(level.items.length).fill(-1),
    binCount: level.optimal + 2,
    selected: -1,
    steps: 0,
  }
}

/**
 * 某个箱当前装载的体积和。
 * @param state - 对局状态。
 * @param bin - 箱下标。
 * @returns 该箱体积和。
 */
export function binLoad(state: BinPackState, bin: number): number {
  let sum = 0
  for (let i = 0; i < state.binOf.length; i += 1) {
    if (state.binOf[i] === bin) sum += state.level.items[i]!
  }
  return sum
}

/**
 * 物品能否放入目标箱（不超容量，且物品确实不在该箱里）。
 * @param state - 对局状态。
 * @param item - 物品下标。
 * @param bin - 目标箱下标。
 * @returns 合法返回 true。
 */
export function canPlace(state: BinPackState, item: number, bin: number): boolean {
  if (item < 0 || item >= state.binOf.length) return false
  if (bin < 0 || bin >= state.binCount) return false
  if (state.binOf[item] === bin) return false
  return binLoad(state, bin) + state.level.items[item]! <= state.level.capacity
}

/**
 * 把物品放入目标箱（含从一个箱挪到另一个箱）；非法放置直接忽略。
 * @param state - 对局状态（就地修改）。
 * @param item - 物品下标。
 * @param bin - 目标箱下标。
 */
export function placeItem(state: BinPackState, item: number, bin: number): void {
  if (!canPlace(state, item, bin)) return
  state.binOf[item] = bin
  state.steps += 1
  if (state.selected === item) state.selected = -1
}

/**
 * 把已放入的物品取出回待装区。
 * @param state - 对局状态（就地修改）。
 * @param item - 物品下标。
 */
export function takeOut(state: BinPackState, item: number): void {
  if (item < 0 || item >= state.binOf.length) return
  if (state.binOf[item]! < 0) return
  state.binOf[item]! = -1
  state.steps += 1
  if (state.selected === item) state.selected = -1
}

/**
 * 当前实际用到的箱数（至少有一个物品的箱）。
 * @param state - 对局状态。
 * @returns 已用箱数。
 */
export function usedBins(state: BinPackState): number {
  const used = new Set<number>()
  for (const b of state.binOf) if (b >= 0) used.add(b)
  return used.size
}

/**
 * 是否所有物品都已装箱。
 * @param state - 对局状态。
 * @returns 全部装完返回 true。
 */
export function allPlaced(state: BinPackState): boolean {
  return state.binOf.every(b => b >= 0)
}

/**
 * 过关判定：全部装完且用箱数 ≤ 最优。
 * @param state - 对局状态。
 * @returns 过关返回 true。
 */
export function isWon(state: BinPackState): boolean {
  return allPlaced(state) && usedBins(state) <= state.level.optimal
}

/**
 * FFD（首次适应递减）启发式装箱。
 * @param sizes - 物品体积列表。
 * @param capacity - 容量。
 * @returns FFD 使用的箱数（恒 ≥ 最优）。
 */
export function ffd(sizes: number[], capacity: number): number {
  const sorted = [...sizes].sort((a, b) => b - a)
  const loads: number[] = []
  for (const size of sorted) {
    let placed = false
    for (let i = 0; i < loads.length; i += 1) {
      if (loads[i]! + size <= capacity) {
        loads[i]! += size
        placed = true
        break
      }
    }
    if (!placed) loads.push(size)
  }
  return loads.length
}

/**
 * 精确最优装箱数（子集 DP，n ≤ 20 可承受；f[mask] = 最少箱数 + 末箱最小
 * 余量，按字典序取最小）。
 * @param sizes - 物品体积列表（长度 ≤ 20）。
 * @param capacity - 容量。
 * @returns 精确最优箱数；物品为空返回 0。
 */
export function exactBins(sizes: number[], capacity: number): number {
  const n = sizes.length
  if (n === 0) return 0
  if (n > 20) throw new Error('binpack: exact solver supports at most 20 items')
  const total = 1 << n
  const bins = new Array<number>(total).fill(Infinity)
  const last = new Array<number>(total).fill(Infinity)
  bins[0]! = 0
  last[0]! = capacity
  for (let mask = 0; mask < total - 1; mask += 1) {
    if (bins[mask]! === Infinity) continue
    for (let j = 0; j < n; j += 1) {
      if (mask & (1 << j)) continue
      const next = mask | (1 << j)
      const size = sizes[j]!
      let nb: number
      let nl: number
      if (last[mask]! + size <= capacity) {
        nb = bins[mask]!
        nl = last[mask]! + size
      } else {
        nb = bins[mask]! + 1
        nl = size
      }
      if (nb < bins[next]! || (nb === bins[next]! && nl < last[next]!)) {
        bins[next]! = nb
        last[next]! = nl
      }
    }
  }
  return bins[total - 1]!
}

/**
 * 过关得分：关数为主、步数为辅（放入取出都计步，步数越少分越高）。
 * @param level - 1 起的关卡号。
 * @param steps - 总步数。
 * @returns 得分（> 0）。
 */
export function computeScore(level: number, steps: number): number {
  return 100 * level + Math.max(0, 240 - steps * 8)
}
