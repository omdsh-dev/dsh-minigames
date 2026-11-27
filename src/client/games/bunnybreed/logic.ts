/**
 * 兔子育种 BunnyBreed 纯逻辑：孟德尔双基因育种谜题。毛色等位 B/b（B 黑
 * 显性、b 褐隐性）、毛型等位 S/s（S 短显性、s 长隐性）；每只兔子基因型
 * 可见（如 Bb Ss），玩家选两只亲本繁殖，每窝 4 仔按 Punnett 16 格等概率
 * 分离组合（随机走注入 mulberry32 种子，确定性可复放）。兔舍容量固定，
 * 超容必须放归且放归不可找回；代数预算用尽未达标判负。关卡从单基因纯合
 * 递进到双基因指定基因型、再到两只指定基因型同时在场，起始兔群更杂、
 * 容量更紧。无 DOM、无副作用，全部函数可在 vitest 中直接验证。
 */

/** 毛色基因座等位对：BB 纯合黑 / Bb 杂合黑 / bb 纯合褐。 */
export type ColorPair = 'BB' | 'Bb' | 'bb'

/** 毛型基因座等位对：SS 纯合短 / Ss 杂合短 / ss 纯合长。 */
export type FurPair = 'SS' | 'Ss' | 'ss'

/** 一只兔子的完整基因型（两个独立遗传的基因座）。 */
export interface Genes {
  /** 毛色等位对。 */
  color: ColorPair
  /** 毛型等位对。 */
  fur: FurPair
}

/** 目标基因座的判定规格：精确等位对、显性表现型（black/short）或任意。 */
export type ColorSpec = 'BB' | 'Bb' | 'bb' | 'black' | 'any'
export type FurSpec = 'SS' | 'Ss' | 'ss' | 'short' | 'any'

/** 一条育种目标：两基因座各自的匹配规格。 */
export interface TargetSpec {
  /** 毛色规格。 */
  color: ColorSpec
  /** 毛型规格。 */
  fur: FurSpec
}

/** 一只在场兔子：稳定 id（放归即消失，不可找回）与基因型。 */
export interface Rabbit {
  /** 兔舍内唯一 id（自增分配）。 */
  id: number
  /** 基因型。 */
  genes: Genes
}

/** 一关的静态数据：容量、代数预算、起始兔群与目标（target2 非空为双目标）。 */
export interface LevelData {
  /** 0 起的关卡下标。 */
  level: number
  /** 兔舍容量（在场兔数上限）。 */
  capacity: number
  /** 代数预算：最多可配种的次数。 */
  genLimit: number
  /** 起始兔群基因型（不满足任何目标）。 */
  start: Genes[]
  /** 目标一。 */
  target: TargetSpec
  /** 目标二（仅第 5 关非空：两只指定基因型同时在场）。 */
  target2: TargetSpec | null
}

/** 游戏进行态（index 层持有，逻辑层提供操作函数）。 */
export interface GameState {
  /** 当前关卡数据。 */
  data: LevelData
  /** 在场兔子（顺序即兔舍槽位顺序）。 */
  rabbits: Rabbit[]
  /** 已选亲本 id 列表（0-2 个，配种需要恰好 2 个）。 */
  selected: number[]
  /** 已用代数（配种次数）。 */
  breeds: number
  /** 本关累计放归只数（计分惩罚）。 */
  releases: number
  /** play 进行中 / won 目标达成 / failed 代数用尽未达标。 */
  phase: 'play' | 'won' | 'failed'
  /** 下一只兔子的 id。 */
  nextId: number
}

/** 每窝仔兔数。 */
export const LITTER_SIZE = 4

/** 总关卡数。 */
export const LEVEL_COUNT = 5

/** 关卡规格（内部使用）。 */
interface LevelSpec {
  capacity: number
  genLimit: number
  start: [ColorPair, FurPair][]
  target: TargetSpec
  target2: TargetSpec | null
}

/**
 * 5 关递进：单基因纯合（bb）→ 单基因纯合（ss）→ 表现型组合（黑长）→
 * 双基因指定基因型（BB ss）→ 两只指定基因型（BB ss 与 bb ss）同时在场。
 * 起始兔群递进更杂，末关容量收紧到 7。
 */
const SPECS: LevelSpec[] = [
  { capacity: 8, genLimit: 5, start: [['Bb', 'Ss'], ['Bb', 'SS'], ['BB', 'Ss']], target: { color: 'bb', fur: 'any' }, target2: null },
  { capacity: 8, genLimit: 7, start: [['Bb', 'Ss'], ['Bb', 'Ss'], ['BB', 'SS']], target: { color: 'any', fur: 'ss' }, target2: null },
  { capacity: 8, genLimit: 9, start: [['Bb', 'Ss'], ['Bb', 'Ss'], ['bb', 'Ss']], target: { color: 'black', fur: 'ss' }, target2: null },
  { capacity: 8, genLimit: 10, start: [['Bb', 'Ss'], ['BB', 'Ss'], ['Bb', 'ss'], ['bb', 'Ss']], target: { color: 'BB', fur: 'ss' }, target2: null },
  { capacity: 7, genLimit: 12, start: [['Bb', 'ss'], ['Bb', 'ss'], ['Bb', 'Ss']], target: { color: 'BB', fur: 'ss' }, target2: { color: 'bb', fur: 'ss' } },
]

/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供配种与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
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

/**
 * 等位对拆成两个配子（减数分离）。
 * @param pair - 等位对。
 * @returns 两个配子（各一个等位）。
 */
export function gametes(pair: ColorPair | FurPair): [string, string] {
  if (pair === 'Bb') return ['B', 'b']
  if (pair === 'Ss') return ['S', 's']
  if (pair === 'BB') return ['B', 'B']
  if (pair === 'bb') return ['b', 'b']
  if (pair === 'SS') return ['S', 'S']
  return ['s', 's']
}

/**
 * 两个配子受精结合成等位对（显性大写在前，规范序）。
 * @param a1 - 配子一。
 * @param a2 - 配子二。
 * @returns 规范化的等位对。
 */
export function combine(a1: string, a2: string): ColorPair | FurPair {
  if ((a1 === 'B' && a2 === 'B') || (a1 === 'S' && a2 === 'S')) return a1 === 'B' ? 'BB' : 'SS'
  if ((a1 === 'b' && a2 === 'b') || (a1 === 's' && a2 === 's')) return a1 === 'b' ? 'bb' : 'ss'
  if ((a1 === 'B' && a2 === 'b') || (a1 === 'b' && a2 === 'B')) return 'Bb'
  if ((a1 === 'S' && a2 === 's') || (a1 === 's' && a2 === 'S')) return 'Ss'
  return 'Bb'
}

/**
 * 双亲 Punnett 方格：两基因座独立分离组合，共 4x4=16 格子代基因型。
 * @param a - 亲本 A 基因型。
 * @param b - 亲本 B 基因型。
 * @returns 16 个子代基因型（每格等概率）。
 */
export function punnettGrid(a: Genes, b: Genes): Genes[] {
  const ca = gametes(a.color)
  const cb = gametes(b.color)
  const fa = gametes(a.fur)
  const fb = gametes(b.fur)
  const grid: Genes[] = []
  for (const fc of fa) {
    for (const fd of fb) {
      for (const ac of ca) {
        for (const ad of cb) {
          grid.push({ color: combine(ac, ad) as ColorPair, fur: combine(fc, fd) as FurPair })
        }
      }
    }
  }
  return grid
}

/**
 * 每窝 4 仔：每仔独立从 Punnett 16 格中等概率抽一格。
 * @param rng - 注入的随机函数。
 * @param a - 亲本 A 基因型。
 * @param b - 亲本 B 基因型。
 * @param count - 仔数（默认 LITTER_SIZE）。
 * @returns 仔兔基因型列表。
 */
export function litterOf(rng: () => number, a: Genes, b: Genes, count = LITTER_SIZE): Genes[] {
  const grid = punnettGrid(a, b)
  const pups: Genes[] = []
  for (let i = 0; i < count; i += 1) {
    pups.push(grid[Math.floor(rng() * grid.length)]!)
  }
  return pups
}

/** 子代可能基因型统计（预览面板用）。 */
export interface OffspringStat {
  /** 基因型展示串（如 Bb Ss）。 */
  label: string
  /** 16 格中占格数。 */
  count: number
  /** 概率（count/16）。 */
  frac: number
}

/**
 * 子代可能基因型频率表：按占格数降序、同数按字典序，供预览面板显示。
 * @param a - 亲本 A 基因型。
 * @param b - 亲本 B 基因型。
 * @returns 统计列表（频率合计 1）。
 */
export function offspringStats(a: Genes, b: Genes): OffspringStat[] {
  const counts = new Map<string, number>()
  for (const g of punnettGrid(a, b)) {
    const key = genesString(g)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const stats: OffspringStat[] = []
  for (const [label, count] of counts) stats.push({ label, count, frac: count / 16 })
  stats.sort((x, y) => y.count - x.count || (x.label < y.label ? -1 : 1))
  return stats
}

/**
 * 基因型转展示串（如 Bb Ss）。
 * @param g - 基因型。
 * @returns 形如 "Bb Ss" 的串。
 */
export function genesString(g: Genes): string {
  return g.color + ' ' + g.fur
}

/** 一只兔子的表现型描述。 */
export interface Phenotype {
  /** true 黑毛（color 非 bb），false 褐毛。 */
  black: boolean
  /** true 长毛（fur 为 ss），false 短毛。 */
  longFur: boolean
}

/**
 * 表现型映射（显隐性法则：B 对 b 显、S 对 s 显）。
 * @param g - 基因型。
 * @returns 表现型。
 */
export function phenotype(g: Genes): Phenotype {
  return { black: g.color !== 'bb', longFur: g.fur === 'ss' }
}

/**
 * 单基因座是否匹配目标规格。
 * @param pair - 实际等位对。
 * @param spec - 目标规格。
 * @returns 匹配返回 true。
 */
function locusMatches(pair: string, spec: string): boolean {
  if (spec === 'any') return true
  if (spec === 'black') return pair !== 'bb'
  if (spec === 'short') return pair !== 'ss'
  return pair === spec
}

/**
 * 基因型是否匹配一条育种目标。
 * @param g - 基因型。
 * @param spec - 目标规格。
 * @returns 匹配返回 true。
 */
export function matchesTarget(g: Genes, spec: TargetSpec): boolean {
  return locusMatches(g.color, spec.color) && locusMatches(g.fur, spec.fur)
}

/**
 * 是否已过关：单目标——任意在场兔匹配；双目标——两只不同在场兔分别
 * 匹配两条目标（同一只兔不能同时算两条）。
 * @param state - 游戏状态。
 * @returns 过关返回 true。
 */
export function isWinning(state: GameState): boolean {
  const { target, target2 } = state.data
  if (target2 === null) return state.rabbits.some((r) => matchesTarget(r.genes, target))
  let first = -1
  for (let i = 0; i < state.rabbits.length; i += 1) {
    if (matchesTarget(state.rabbits[i]!.genes, target)) { first = i; break }
  }
  if (first === -1) return false
  for (let j = 0; j < state.rabbits.length; j += 1) {
    if (j !== first && matchesTarget(state.rabbits[j]!.genes, target2)) return true
  }
  return false
}

/**
 * 构造一关（0 起下标，越界钳制）。
 * @param level - 0 起的关卡下标。
 * @returns 关卡数据。
 */
export function buildLevel(level: number): LevelData {
  const idx = Math.min(Math.max(level, 0), SPECS.length - 1)
  const spec = SPECS[idx]!
  return {
    level: idx,
    capacity: spec.capacity,
    genLimit: spec.genLimit,
    start: spec.start.map(([color, fur]) => ({ color, fur })),
    target: spec.target,
    target2: spec.target2,
  }
}

/**
 * 开局（或重开一关）：起始兔群入舍、无选中、0 代、进行中。
 * @param data - 关卡数据。
 * @returns 初始游戏状态。
 */
export function newGame(data: LevelData): GameState {
  return {
    data,
    rabbits: data.start.map((genes, i) => ({ id: i, genes })),
    selected: [],
    breeds: 0,
    releases: 0,
    phase: 'play',
    nextId: data.start.length,
  }
}

/**
 * 点兔切换亲本选中：已选中则取消；未选中且已选满 2 只时拒绝（先取消
 * 一只再换）。仅进行中可用。
 * @param state - 游戏状态。
 * @param id - 兔子 id。
 * @returns 切换成功返回 true。
 */
export function toggleSelect(state: GameState, id: number): boolean {
  if (state.phase !== 'play') return false
  if (!state.rabbits.some((r) => r.id === id)) return false
  const at = state.selected.indexOf(id)
  if (at >= 0) {
    state.selected.splice(at, 1)
    return true
  }
  if (state.selected.length >= 2) return false
  state.selected.push(id)
  return true
}

/**
 * 清空亲本选择。
 * @param state - 游戏状态。
 */
export function clearSelection(state: GameState): void {
  state.selected.length = 0
}

/**
 * 配种：需进行中、恰好 2 只亲本、空位 ≥ 每窝 4 仔、代数未用尽。追加
 * 4 仔（自增 id）、代数 +1、清空选择；随后判胜（达成目标）或代数用尽
 * 判负。空位不足时先放归腾位。
 * @param state - 游戏状态。
 * @param rng - 注入的随机函数（每窝 4 次抽样，可复放）。
 * @returns 仔兔基因型列表；不满足前置条件返回 null。
 */
export function breed(state: GameState, rng: () => number): Genes[] | null {
  if (state.phase !== 'play') return null
  if (state.selected.length !== 2) return null
  if (state.breeds >= state.data.genLimit) return null
  if (state.data.capacity - state.rabbits.length < LITTER_SIZE) return null
  const a = state.rabbits.find((r) => r.id === state.selected[0])!
  const b = state.rabbits.find((r) => r.id === state.selected[1])!
  const pups = litterOf(rng, a.genes, b.genes)
  for (const genes of pups) {
    state.rabbits.push({ id: state.nextId, genes })
    state.nextId += 1
  }
  state.breeds += 1
  clearSelection(state)
  if (isWinning(state)) {
    state.phase = 'won'
  } else if (state.breeds >= state.data.genLimit) {
    state.phase = 'failed'
  }
  return pups
}

/**
 * 放归：移除一只在场兔（不可找回）。仅进行中可用，且至少保留 2 只
 * （不足 2 只无法再配种）。若它已被选为亲本则同时取消选中。
 * @param state - 游戏状态。
 * @param id - 兔子 id。
 * @returns 放归成功返回 true。
 */
export function release(state: GameState, id: number): boolean {
  if (state.phase !== 'play') return false
  if (state.rabbits.length <= 2) return false
  const at = state.rabbits.findIndex((r) => r.id === id)
  if (at === -1) return false
  state.rabbits.splice(at, 1)
  state.releases += 1
  const selAt = state.selected.indexOf(id)
  if (selAt >= 0) state.selected.splice(selAt, 1)
  return true
}

/**
 * 计分：关底 + 关卡递进 + 剩余代数奖励 - 放归惩罚，下限 100。
 * @param level - 0 起关卡下标。
 * @param genLeft - 剩余代数。
 * @param releases - 累计放归只数。
 * @returns 得分。
 */
export function computeScore(level: number, genLeft: number, releases: number): number {
  return Math.max(100, 150 + level * 80 + genLeft * 15 - releases * 10)
}
