/**
 * 烟花编排 FireworksShow 纯逻辑层：配方表（色彩×爆高×形状×升空×燃程）、
 * 关卡定义（发射位数×目标谱×风偏）、装配（位×配方×延时）、离散 0.1s
 * 粒度的升空绽放时序模拟、谱项判定（时刻×颜色×形状×数量 / 柳形最后
 * 落下）、过关与计分、装饰星点 seed 重放。全部确定性（无 Math.random），
 * 可单元测试；渲染层只消费这里的结构。无反引号模板字符串。
 */

/** 烟花形状：菊=放射 / 牡丹=多层 / 环=环形 / 柳=垂枝。 */
export type Shape = 'chrys' | 'peony' | 'ring' | 'willow'

/** 一条烟花配方：决定色彩、爆高、形状与升空/燃程时长（0.1s tick）。 */
export interface Recipe {
  /** 稳定唯一 id。 */
  id: string
  /** 中文名（2-3 字，发射位卡片显示）。 */
  name: string
  /** 色彩（THEME.accents 中的十六进制值）。 */
  color: string
  /** 色彩中文名（目标谱文案用）。 */
  colorName: string
  /** 升空时长（tick，1 tick = 0.1s）。 */
  rise: number
  /** 绽放可见时长（tick）。 */
  life: number
  /** 爆高（逻辑像素，映射到夜空高度）。 */
  height: number
  /** 形状。 */
  shape: Shape
}

/**
 * 内置配方表（9 种）：同色不同形、同形不同高——查表与记忆的核心。
 * 升空 1.0-2.5s、燃程 1.0-2.6s，柳形燃程最长（「最后落下」谱项依据）。
 */
export const RECIPES: Recipe[] = [
  { id: 'gold-chrys', name: '金菊', color: '#e0af68', colorName: '金色', rise: 10, life: 12, height: 260, shape: 'chrys' },
  { id: 'red-peony', name: '红牡丹', color: '#f7768e', colorName: '红色', rise: 15, life: 10, height: 200, shape: 'peony' },
  { id: 'blue-ring', name: '蓝环', color: '#7aa2f7', colorName: '蓝色', rise: 20, life: 10, height: 300, shape: 'ring' },
  { id: 'green-willow', name: '绿柳', color: '#9ece6a', colorName: '绿色', rise: 15, life: 26, height: 180, shape: 'willow' },
  { id: 'purple-chrys', name: '紫菊', color: '#bb9af7', colorName: '紫色', rise: 25, life: 10, height: 320, shape: 'chrys' },
  { id: 'cyan-peony', name: '青牡丹', color: '#7dcfff', colorName: '青色', rise: 10, life: 10, height: 160, shape: 'peony' },
  { id: 'orange-ring', name: '橙环', color: '#ff9e64', colorName: '橙色', rise: 20, life: 14, height: 240, shape: 'ring' },
  { id: 'gold-willow', name: '金柳', color: '#e0af68', colorName: '金色', rise: 10, life: 22, height: 220, shape: 'willow' },
  { id: 'white-chrys', name: '白菊', color: '#e2e2ee', colorName: '白色', rise: 15, life: 10, height: 280, shape: 'chrys' },
]

/** 配方数。 */
export const RECIPE_COUNT = RECIPES.length

/** 按 id 取配方（找不到返回 null）。 */
export function recipeById(id: string): Recipe | null {
  return RECIPES.find((r) => r.id === id) ?? null
}

/** 目标谱项：sync=某时刻同放若干朵；lastFall=某形状要最后落下。 */
export interface SpectrumItem {
  /** 谱项类型。 */
  kind: 'sync' | 'lastFall'
  /** sync：判定时刻（tick）。 */
  tick?: number
  /** 颜色（十六进制）。 */
  color?: string
  /** 形状。 */
  shape: Shape
  /** sync：需要的最少朵数。 */
  count?: number
}

/** 一个发射位的装配：配方 + 引信延时（0-5 整秒）。 */
export interface Assignment {
  /** 发射位下标。 */
  pad: number
  /** 配方 id。 */
  recipe: string
  /** 引信延时（秒，0-5）。 */
  delay: number
}

/** 关卡：发射位数、是否风偏、目标谱与内置可行解（可赢性由测试验证）。 */
export interface LevelData {
  /** 关卡序号（0 起）。 */
  index: number
  /** 发射位数量。 */
  pads: number
  /** 风偏：奇数位点火后额外 +1 秒升空。 */
  wind: boolean
  /** 目标谱项。 */
  items: SpectrumItem[]
  /** 一个已知可行解（测试「全关可赢」用）。 */
  solution: Assignment[]
}

/**
 * 5 关递进：发射位 3→6、谱项 2→5、第 4 关起加入风偏（奇数位 +1s，
 * 装配时须避开）。每关 solution 均经测试验证全谱项命中。
 */
export const LEVELS: LevelData[] = [
  {
    index: 0, pads: 3, wind: false,
    items: [
      { kind: 'sync', tick: 30, color: '#e0af68', shape: 'chrys', count: 1 },
      { kind: 'lastFall', shape: 'willow' },
    ],
    solution: [
      { pad: 0, recipe: 'gold-chrys', delay: 2 },
      { pad: 1, recipe: 'red-peony', delay: 0 },
      { pad: 2, recipe: 'green-willow', delay: 1 },
    ],
  },
  {
    index: 1, pads: 4, wind: false,
    items: [
      { kind: 'sync', tick: 30, color: '#e0af68', shape: 'chrys', count: 2 },
      { kind: 'sync', tick: 30, color: '#7aa2f7', shape: 'ring', count: 1 },
      { kind: 'lastFall', shape: 'willow' },
    ],
    solution: [
      { pad: 0, recipe: 'gold-chrys', delay: 1 },
      { pad: 1, recipe: 'gold-chrys', delay: 2 },
      { pad: 2, recipe: 'blue-ring', delay: 1 },
      { pad: 3, recipe: 'green-willow', delay: 2 },
    ],
  },
  {
    index: 2, pads: 5, wind: false,
    items: [
      { kind: 'sync', tick: 15, color: '#7dcfff', shape: 'peony', count: 1 },
      { kind: 'sync', tick: 20, color: '#e2e2ee', shape: 'chrys', count: 1 },
      { kind: 'sync', tick: 30, color: '#bb9af7', shape: 'chrys', count: 1 },
      { kind: 'lastFall', shape: 'willow' },
    ],
    solution: [
      { pad: 0, recipe: 'cyan-peony', delay: 0 },
      { pad: 1, recipe: 'red-peony', delay: 2 },
      { pad: 2, recipe: 'white-chrys', delay: 0 },
      { pad: 3, recipe: 'purple-chrys', delay: 0 },
      { pad: 4, recipe: 'green-willow', delay: 3 },
    ],
  },
  {
    index: 3, pads: 5, wind: true,
    items: [
      { kind: 'sync', tick: 30, color: '#e0af68', shape: 'chrys', count: 2 },
      { kind: 'sync', tick: 30, color: '#ff9e64', shape: 'ring', count: 1 },
      { kind: 'sync', tick: 40, color: '#7aa2f7', shape: 'ring', count: 1 },
      { kind: 'lastFall', shape: 'willow' },
    ],
    solution: [
      { pad: 0, recipe: 'gold-chrys', delay: 1 },
      { pad: 1, recipe: 'gold-chrys', delay: 1 },
      { pad: 2, recipe: 'blue-ring', delay: 2 },
      { pad: 3, recipe: 'orange-ring', delay: 0 },
      { pad: 4, recipe: 'green-willow', delay: 3 },
    ],
  },
  {
    index: 4, pads: 6, wind: true,
    items: [
      { kind: 'sync', tick: 15, color: '#f7768e', shape: 'peony', count: 1 },
      { kind: 'sync', tick: 30, color: '#e0af68', shape: 'chrys', count: 1 },
      { kind: 'sync', tick: 40, color: '#e0af68', shape: 'chrys', count: 2 },
      { kind: 'sync', tick: 40, color: '#bb9af7', shape: 'chrys', count: 1 },
      { kind: 'lastFall', shape: 'willow' },
    ],
    solution: [
      { pad: 0, recipe: 'gold-chrys', delay: 2 },
      { pad: 1, recipe: 'gold-chrys', delay: 2 },
      { pad: 2, recipe: 'red-peony', delay: 0 },
      { pad: 3, recipe: 'purple-chrys', delay: 0 },
      { pad: 4, recipe: 'blue-ring', delay: 1 },
      { pad: 5, recipe: 'gold-willow', delay: 3 },
    ],
  },
]

/** 关卡数。 */
export const LEVEL_COUNT = LEVELS.length

/** 引信延时范围（整秒）。 */
export const MIN_DELAY = 0
export const MAX_DELAY = 5

/** 一次绽放事件（模拟产物）。 */
export interface BurstEvent {
  /** 发射位下标。 */
  pad: number
  /** 配方 id。 */
  recipe: string
  /** 点火 tick（含风偏后的实际升空起点）。 */
  launch: number
  /** 绽放时刻（tick）。 */
  burst: number
  /** 熄灭时刻（tick，开区间右端）。 */
  end: number
  /** 色彩。 */
  color: string
  /** 形状。 */
  shape: Shape
  /** 爆高（逻辑像素）。 */
  height: number
}

/** 一场演出的模拟结果。 */
export interface ShowResult {
  /** 绽放事件（按绽放时刻升序）。 */
  events: BurstEvent[]
  /** 各谱项命中与否（与关卡 items 一一对应）。 */
  hits: boolean[]
  /** 全部命中才过关。 */
  win: boolean
  /** 演出总时长（tick，最后熄灭 + 收尾缓冲）。 */
  duration: number
}

/** 谱项在回放中的三态：未判定 / 命中 / 未命中。 */
export type ItemState = 'pending' | 'hit' | 'miss'

/** 游戏运行状态（index 层驱动，逻辑层提供转移函数）。 */
export interface GameState {
  /** 当前关卡序号。 */
  levelIndex: number
  /** 各发射位装配（未装为 null）。 */
  assignments: (Assignment | null)[]
  /** 当前选中的发射位（无选中为 null）。 */
  selectedPad: number | null
  /** setup 装配 / running 燃放 / done 结算。 */
  phase: 'setup' | 'running' | 'done'
  /** 回放时刻（tick，仅 running/done 有意义）。 */
  time: number
  /** 本场模拟结果（点火后存在）。 */
  result: ShowResult | null
  /** 本关点火尝试次数（计分惩罚用）。 */
  attempts: number
}

/**
 * mulberry32 种子随机（与其它游戏同款约定）：同种子序列一致。
 * @param seed - 种子整数。
 * @returns 返回 [0,1) 均匀伪随机的函数。
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
 * 风偏偏移：风关卡的奇数位点火后额外 +10 tick（1 秒）才升空。
 * @param level - 关卡。
 * @param pad - 发射位下标。
 * @returns 该位的风偏 tick 数。
 */
export function windShift(level: LevelData, pad: number): number {
  return level.wind && pad % 2 === 1 ? 10 : 0
}

/**
 * 一个装配的实际绽放时刻：延时 + 升空 + 风偏（全部 tick）。
 * @param level - 关卡。
 * @param assignment - 装配。
 * @returns 绽放 tick。
 */
export function burstTick(level: LevelData, assignment: Assignment): number {
  const recipe = recipeById(assignment.recipe)
  if (recipe === null) throw new Error('dsh-minigames fireworks: unknown recipe ' + assignment.recipe)
  return assignment.delay * 10 + recipe.rise + windShift(level, assignment.pad)
}

/**
 * 判定单个 sync 谱项：tick 时刻颜色×形状同时在放的朵数 ≥ count。
 * 可见窗口 [burst, end)（含绽放瞬间、不含熄灭瞬间）。
 * @param item - 谱项。
 * @param events - 全部绽放事件。
 * @returns 是否命中。
 */
export function syncSatisfied(item: SpectrumItem, events: BurstEvent[]): boolean {
  const tick = item.tick ?? 0
  const need = item.count ?? 1
  let n = 0
  for (const e of events) {
    if (e.color === item.color && e.shape === item.shape && e.burst <= tick && tick < e.end) n += 1
  }
  return n >= need
}

/**
 * 判定单个 lastFall 谱项：全场最晚熄灭的事件中存在该形状（同刻并列算命中）。
 * @param item - 谱项。
 * @param events - 全部绽放事件。
 * @returns 是否命中。
 */
export function lastFallSatisfied(item: SpectrumItem, events: BurstEvent[]): boolean {
  if (events.length === 0) return false
  let maxEnd = -1
  for (const e of events) {
    if (e.end > maxEnd) maxEnd = e.end
  }
  for (const e of events) {
    if (e.end === maxEnd && e.shape === item.shape) return true
  }
  return false
}

/** 判定单个谱项（按 kind 分派）。 */
export function itemSatisfied(item: SpectrumItem, events: BurstEvent[]): boolean {
  return item.kind === 'sync' ? syncSatisfied(item, events) : lastFallSatisfied(item, events)
}

/** 收尾缓冲（tick）：最后熄灭后再挂一会儿进入结算。 */
const TAIL_TICKS = 15

/**
 * 模拟一场演出：装配 → 绽放事件序列 → 逐谱项判定。
 * @param level - 关卡。
 * @param assignments - 每个发射位的装配（缺失的位跳过不发射）。
 * @returns 模拟结果（事件按绽放时刻升序）。
 */
export function simulateShow(level: LevelData, assignments: (Assignment | null)[]): ShowResult {
  const events: BurstEvent[] = []
  for (const a of assignments) {
    if (a === null) continue
    const recipe = recipeById(a.recipe)
    if (recipe === null) throw new Error('dsh-minigames fireworks: unknown recipe ' + a.recipe)
    const launch = a.delay * 10 + windShift(level, a.pad)
    const burst = launch + recipe.rise
    events.push({
      pad: a.pad,
      recipe: recipe.id,
      launch,
      burst,
      end: burst + recipe.life,
      color: recipe.color,
      shape: recipe.shape,
      height: recipe.height,
    })
  }
  events.sort((x, y) => x.burst - y.burst)
  const hits = level.items.map((item) => itemSatisfied(item, events))
  let maxEnd = 0
  for (const e of events) {
    if (e.end > maxEnd) maxEnd = e.end
  }
  return { events, hits, win: hits.every((h) => h), duration: maxEnd + TAIL_TICKS }
}

/**
 * 谱项的回放三态：sync 到达判定时刻后按命中冻结；lastFall 结算后判定。
 * @param state - 游戏状态（须已点火）。
 * @param index - 谱项下标。
 * @returns pending / hit / miss。
 */
export function itemStateAt(state: GameState, index: number): ItemState {
  const result = state.result
  if (result === null) return 'pending'
  const item = LEVELS[state.levelIndex]!.items[index]!
  const hit = result.hits[index] === true
  if (item.kind === 'sync') {
    return state.time >= (item.tick ?? 0) ? (hit ? 'hit' : 'miss') : 'pending'
  }
  return state.phase === 'done' ? (hit ? 'hit' : 'miss') : 'pending'
}

/**
 * 新建一局：发射位全空，默认选中 0 号位，setup 阶段。
 * @param levelIndex - 关卡序号（0 起，越界钳制）。
 * @returns 初始状态。
 */
export function newGame(levelIndex: number): GameState {
  const level = LEVELS[Math.min(Math.max(levelIndex, 0), LEVEL_COUNT - 1)]!
  return {
    levelIndex: level.index,
    assignments: Array.from({ length: level.pads }, () => null),
    selectedPad: 0,
    phase: 'setup',
    time: 0,
    result: null,
    attempts: 0,
  }
}

/**
 * 为发射位选配方（沿用原延时，默认 0 秒）。
 * @param state - 游戏状态。
 * @param pad - 发射位下标。
 * @param recipeId - 配方 id。
 * @returns 是否生效。
 */
export function setPadRecipe(state: GameState, pad: number, recipeId: string): boolean {
  const level = LEVELS[state.levelIndex]!
  if (state.phase !== 'setup' || pad < 0 || pad >= level.pads) return false
  if (recipeById(recipeId) === null) return false
  const prev = state.assignments[pad]
  state.assignments[pad] = { pad, recipe: recipeId, delay: prev?.delay ?? MIN_DELAY }
  return true
}

/**
 * 设置发射位引信延时（钳制 0-5 整秒；位上已有配方才生效）。
 * @param state - 游戏状态。
 * @param pad - 发射位下标。
 * @param delay - 延时秒。
 * @returns 是否生效。
 */
export function setPadDelay(state: GameState, pad: number, delay: number): boolean {
  const level = LEVELS[state.levelIndex]!
  if (state.phase !== 'setup' || pad < 0 || pad >= level.pads) return false
  const prev = state.assignments[pad]
  if (prev === undefined || prev === null) return false
  const clamped = Math.min(Math.max(Math.round(delay), MIN_DELAY), MAX_DELAY)
  state.assignments[pad] = { pad, recipe: prev.recipe, delay: clamped }
  return true
}

/**
 * 点火：全部发射位装配完毕才进入燃放，模拟并开始回放。
 * @param state - 游戏状态。
 * @returns 是否点火成功。
 */
export function ignite(state: GameState): boolean {
  if (state.phase !== 'setup') return false
  const level = LEVELS[state.levelIndex]!
  if (state.assignments.some((a) => a === null)) return false
  state.result = simulateShow(level, state.assignments as Assignment[])
  state.time = 0
  state.phase = 'running'
  state.attempts += 1
  state.selectedPad = null
  return true
}

/**
 * 回放推进：running 阶段前进 tick，到达总时长进入 done 结算。
 * @param state - 游戏状态。
 * @param ticks - 前进 tick 数（0.1s 粒度）。
 * @returns 状态是否变化。
 */
export function step(state: GameState, ticks: number): boolean {
  if (state.phase !== 'running' || ticks <= 0) return false
  state.time = Math.min(state.time + ticks, state.result?.duration ?? 0)
  if (state.result !== null && state.time >= state.result.duration) {
    state.phase = 'done'
  }
  return true
}

/**
 * 计分：谱项命中 + 关卡底分 + 用时奖励，多次点火扣分，下限 100。
 * @param levelIndex - 关卡序号（0 起）。
 * @param hits - 命中谱项数。
 * @param durationTicks - 演出总时长（tick）。
 * @param attempts - 点火尝试次数。
 * @returns 得分。
 */
export function computeScore(levelIndex: number, hits: number, durationTicks: number, attempts: number): number {
  const base = 300 + (levelIndex + 1) * 120
  const itemBonus = hits * 120
  const timeBonus = Math.max(0, 400 - Math.round(durationTicks))
  const penalty = Math.max(0, attempts - 1) * 60
  return Math.max(100, base + itemBonus + timeBonus - penalty)
}

/**
 * 谱项的玩家可读文案（目标谱清单与帮助面板用）。
 * @param item - 谱项。
 * @returns 中文描述一行。
 */
export function describeItem(item: SpectrumItem): string {
  if (item.kind === 'sync') {
    const t = ((item.tick ?? 0) / 10).toFixed(1)
    const color = COLOR_NAMES[item.color ?? ''] ?? '任意色'
    // 单朵说「正在绽放」（×1 无「同放」可言——用户反馈该文案莫名其妙）；
    // 多朵才说同放，且写明「亮着也算」帮助理解判定窗口。
    if ((item.count ?? 1) <= 1) {
      return t + 's 时' + color + SHAPE_NAMES[item.shape] + '正在绽放'
    }
    return t + 's：' + color + SHAPE_NAMES[item.shape] + ' ×' + (item.count ?? 1) + ' 同放（亮着也算）'
  }
  const shape = SHAPE_NAMES[item.shape]
  return shape + '要最后落下'
}

/** 色彩十六进制 → 中文名（文案用）。 */
const COLOR_NAMES: Record<string, string> = {
  '#e0af68': '金色',
  '#f7768e': '红色',
  '#7aa2f7': '蓝色',
  '#9ece6a': '绿色',
  '#bb9af7': '紫色',
  '#7dcfff': '青色',
  '#ff9e64': '橙色',
  '#e2e2ee': '白色',
}

/** 形状 → 中文名。 */
const SHAPE_NAMES: Record<Shape, string> = {
  chrys: '菊花',
  peony: '牡丹',
  ring: '圆环',
  willow: '柳形',
}

/** 夜空装饰星点（seed 重放用）。 */
export interface Star {
  /** 逻辑 x。 */
  x: number
  /** 逻辑 y。 */
  y: number
  /** 尺寸（半径）。 */
  size: number
  /** 闪烁相位（0-1）。 */
  phase: number
}

/**
 * 某关的装饰星点：种子 = 全局种子 + 关卡序号，同关必同星，换关必换景。
 * @param levelIndex - 关卡序号。
 * @param count - 星点数（默认 40）。
 * @returns 星点数组。
 */
export function starsForLevel(levelIndex: number, count = 40): Star[] {
  const rand = mulberry32(0x5eed1f4e + levelIndex * 101)
  return Array.from({ length: count }, () => ({
    x: rand() * 434 + 16,
    y: rand() * 344 + 36,
    size: 0.6 + rand() * 1.3,
    phase: rand(),
  }))
}
