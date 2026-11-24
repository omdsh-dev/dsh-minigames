/**
 * 螺栓分拣（ScrewSort）纯逻辑：传送带从右向左输送螺母，每颗螺母携带
 * 颜色与内径（粗细）双属性；下方四个螺栓工位各绑定一种颜色与一种
 * 粗细。玩家选中螺母后投放到工位：颜色与内径都匹配才拧上（拧紧动画
 * 800ms 期间工位占用），不匹配则弹回并扣分（连续模式再扣时）；真
 * 螺母滑出左端未处理记漏检扣分，迷惑螺母（颜色相近但双属性均不
 * 匹配）放行不扣。连续模式 60 秒限时冲分；关卡模式 5 关按目标个数
 * 流转。带速与生成密度随进度升档；全部随机走 mulberry32(seed, round)，
 * 帧时间先累加再按固定 10ms 子步推进，任意调用节奏下轨迹一致；同
 * seed + 输入脚本重放一致。输入（选中 / 投放）以纯函数调用传入，
 * 逻辑层不接触 DOM。
 */

/** 逻辑画布宽（HUD 与全部元素包含在内）。 */
export const W = 560
/** 逻辑画布高。 */
export const H = 600

/** 四种螺母颜色：0/1 为近蓝对、2/3 为绿青对（迷惑件取近邻色）。 */
export const NUT_COLORS = ['#7aa2f7', '#7dcfff', '#9ece6a', '#73daca'] as const
/** 颜色数（同时是螺栓工位数）。 */
export const COLOR_COUNT = 4
/** 内径档数：0 = M6 细牙，1 = M10 粗牙。 */
export const SIZE_COUNT = 2
/** 工位 i 的粗细：两细两粗，保证颜色与粗细都不足以单独定位。 */
export const BOLT_SIZES: readonly (0 | 1)[] = [0, 1, 0, 1]

/** 传送带左端（漏检口）。 */
export const BELT_LEFT = 26
/** 传送带右端。 */
export const BELT_RIGHT = 548
/** 传送带上沿 y。 */
export const BELT_Y = 100
/** 传送带厚度。 */
export const BELT_H = 26
/** 带上螺母中心线 y。 */
export const NUT_Y = 92
/** 螺母外半径。 */
export const NUT_R = 20
/** 两档内孔半径：M6 / M10。 */
export const HOLE_R: readonly [number, number] = [7, 12]
/** 生成 x（画布右外，滑入可视区）。 */
export const SPAWN_X = 590
/** 错配弹回的右推距离 px。 */
export const BOUNCE_X = 70

/** 拧紧动画时长与工位占用时长 ms。 */
export const SCREW_MS = 800
/** 固定子步 ms：stepScrewSort 内部按该粒度推进模拟。 */
export const SUBSTEP_MS = 10

/** 拧对基础分。 */
export const BASE_SCORE = 2
/** 每级连击附加分。 */
export const COMBO_BONUS = 1
/** 连击上限。 */
export const COMBO_CAP = 8
/** 连击窗口 ms：窗口内再拧对则连击 +1。 */
export const COMBO_WINDOW_MS = 1500
/** 漏检扣分。 */
export const MISS_PENALTY = 2
/** 错配扣分。 */
export const MISMATCH_PENALTY = 1
/** 错配扣时（仅连续模式）ms。 */
export const MISMATCH_TIME_MS = 1500
/** 连续模式限时 ms。 */
export const TIME_LIMIT_MS = 60_000
/** 关卡模式关数。 */
export const LEVEL_COUNT = 5
/** 各关目标拧紧数（严格递增）。 */
export const LEVEL_TARGETS = [10, 14, 18, 22, 26] as const
/** 连续模式：该时刻后才开始出迷惑件。 */
export const DECOY_AFTER_MS = 20_000
/** 关卡模式：该关起才开始出迷惑件。 */
export const DECOY_AFTER_LEVEL = 3
/** 迷惑件在晚期生成流中的占比。 */
export const DECOY_P = 0.3
/** 飘字存活时长 ms。 */
export const FLOAT_MS = 800
/** 错配红闪持续 ms。 */
export const FLASH_MS = 350

/** HUD 右下「说明」按钮矩形（渲染与点击命中共用）。 */
export const HELP_BTN = { x: W - 74, y: 34, w: 60, h: 24 } as const
/** 螺栓工位几何（渲染与命中共用）。 */
export const STATION_X0 = 24
export const STATION_W = 118
export const STATION_GAP = 14
export const STATION_Y = 170
export const STATION_H = 290

/** 一颗在途螺母：双属性 + 是否迷惑件 + 带上 x。 */
export interface Nut {
  id: number
  color: 0 | 1 | 2 | 3
  size: 0 | 1
  decoy: boolean
  x: number
}

/** 一个螺栓工位：绑定双属性、累计拧紧数与占用 / 红闪状态。 */
export interface Bolt {
  color: 0 | 1 | 2 | 3
  size: 0 | 1
  count: number
  /** 拧紧占用截止时刻（回合钟 ms），0 表示空闲。 */
  busyUntil: number
  /** 正在拧的螺母颜色（渲染动画用）。 */
  screwColor: 0 | 1 | 2 | 3
  /** 正在拧的螺母内径档。 */
  screwSize: 0 | 1
  /** 错配红闪截止时刻 ms。 */
  flashUntil: number
}

/** 单步内产生、供渲染层消费的可视事件。 */
export type ScrewSortEvent =
  | { type: 'screwed'; bolt: number; color: number; x: number; y: number }
  | { type: 'mismatch'; bolt: number; x: number; y: number }
  | { type: 'busy'; bolt: number }
  | { type: 'missed'; color: number; x: number; y: number }
  | { type: 'decoyPass'; x: number; y: number }
  | { type: 'level'; level: number }

/** 上浮渐隐的飘字（得分 / 漏检 / 错配提示）。 */
export interface FloatText {
  x: number
  y: number
  text: string
  life: number
}

/** 模式：连续 60 秒冲分 / 关卡 5 关目标流转。 */
export type GameMode = 'continuous' | 'levels'

/** 一局游戏的完整可测状态。 */
export interface ScrewSortState {
  mode: GameMode
  /** 回合内已流逝 ms。 */
  t: number
  /** 未消费的帧时间累加器 ms（固定子步用）。 */
  acc: number
  score: number
  combo: number
  /** 连击失效时刻 ms（回合钟）。 */
  comboExpire: number
  /** 漏检数（真螺母滑出左端）。 */
  missed: number
  /** 在途螺母（按 x 降序不保证）。 */
  nuts: Nut[]
  /** 四个工位，下标即工位号。 */
  bolts: Bolt[]
  /** 当前选中的螺母 id（无则 null）。 */
  selected: number | null
  nextNutId: number
  /** 下一次生成时刻 ms。 */
  nextSpawnAt: number
  rng: () => number
  events: ScrewSortEvent[]
  floats: FloatText[]
  over: boolean
  /** 关卡模式通关标记（连续模式恒 false）。 */
  win: boolean
  /** 连续模式剩余 ms（关卡模式未用，恒为 0）。 */
  timeLeft: number
  /** 关卡模式当前关（1 起；连续模式未用，恒为 1）。 */
  level: number
  /** 本关已拧紧数（关卡模式）。 */
  levelProgress: number
}

/**
 * mulberry32 确定性随机数发生器。
 * @param seed - 非负整数种子。
 * @returns 返回 [0,1) 均匀随机数的函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 工位 i 的左上角 x。
 * @param i - 工位索引 0-3。
 * @returns 该工位面板左上角逻辑 x。
 */
export function stationX(i: number): number {
  return STATION_X0 + i * (STATION_W + STATION_GAP)
}

/**
 * 点击是否落在「说明」按钮矩形内。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中返回 true。
 */
export function inHelpButton(x: number, y: number): boolean {
  return x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h
}

/**
 * 点击落在哪个工位面板内。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 工位索引 0-3，未命中返回 null。
 */
export function boltAt(x: number, y: number): number | null {
  for (let i = 0; i < COLOR_COUNT; i += 1) {
    const x0 = stationX(i)
    if (x >= x0 && x <= x0 + STATION_W && y >= STATION_Y && y <= STATION_Y + STATION_H) return i
  }
  return null
}

/**
 * 点击落在哪颗螺母上（半径外放 6px 容差）。
 * @param state - 目标状态。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中螺母的 id，未命中返回 null。
 */
export function nutAt(state: ScrewSortState, x: number, y: number): number | null {
  if (state.over) return null
  const dy = y - NUT_Y
  for (const nut of state.nuts) {
    const dx = x - nut.x
    if (dx * dx + dy * dy <= (NUT_R + 6) * (NUT_R + 6)) return nut.id
  }
  return null
}

/**
 * 当前难度档：连续模式按回合时间每 12 秒 +1；关卡模式即关卡号。
 * @param mode - 游戏模式。
 * @param tMs - 连续模式回合钟 ms。
 * @param level - 关卡模式当前关。
 * @returns 从 1 开始的档位。
 */
export function levelOf(mode: GameMode, tMs: number, level: number): number {
  if (mode === 'levels') return Math.max(1, level)
  return 1 + Math.floor(Math.max(0, tMs) / 12_000)
}

/**
 * 带速 px/s：1 档 70，每档 +20，封顶 240。
 * @param level - 当前档位。
 * @returns 该档位的带速。
 */
export function beltSpeed(level: number): number {
  return Math.min(240, 70 + (level - 1) * 20)
}

/**
 * 生成平均间隔 ms：1 档 1800，逐档 -260，下限 520。
 * @param level - 当前档位。
 * @returns 生成间隔的期望值。
 */
export function spawnMeanMs(level: number): number {
  return Math.max(520, 1800 - (level - 1) * 260)
}

/**
 * 泊松间隔采样：指数分布 -ln(1-u)*mean，截断到 [0.5, 1.6] 倍期望。
 * @param rng - 随机源。
 * @param mean - 间隔期望 ms。
 * @returns 本次到下一次生成的间隔 ms。
 */
export function poissonInterval(rng: () => number, mean: number): number {
  const u = rng()
  const raw = -Math.log(1 - u) * mean
  return Math.max(mean * 0.5, Math.min(mean * 1.6, raw))
}

/**
 * 新开一局。
 * @param seed - 外部种子（如日期）。
 * @param round - 第几局（同 seed 不同局轨迹不同）。
 * @param mode - 连续 / 关卡模式。
 * @returns 初始状态。
 */
export function createScrewSort(seed: number, round = 1, mode: GameMode = 'continuous'): ScrewSortState {
  const rng = mulberry32((Math.floor(seed) * 33 + round) >>> 0)
  const bolts: Bolt[] = []
  for (let i = 0; i < COLOR_COUNT; i += 1) {
    bolts.push({
      color: i as 0 | 1 | 2 | 3,
      size: BOLT_SIZES[i]!,
      count: 0,
      busyUntil: 0,
      screwColor: 0,
      screwSize: 0,
      flashUntil: 0,
    })
  }
  return {
    mode,
    t: 0,
    acc: 0,
    score: 0,
    combo: 0,
    comboExpire: 0,
    missed: 0,
    nuts: [],
    bolts,
    selected: null,
    nextNutId: 1,
    nextSpawnAt: 700 + rng() * 500,
    rng,
    events: [],
    floats: [],
    over: false,
    win: false,
    timeLeft: mode === 'continuous' ? TIME_LIMIT_MS : 0,
    level: 1,
    levelProgress: 0,
  }
}

/**
 * 压制自然生成（测试注入可控螺母用）：把下一次生成推到无限远。
 * @param state - 目标状态。
 */
export function quietSpawn(state: ScrewSortState): void {
  state.nextSpawnAt = Number.MAX_SAFE_INTEGER
}

/**
 * 注入一颗螺母（测试与调试用）。
 * @param state - 目标状态。
 * @param color - 颜色索引。
 * @param size - 内径档。
 * @param x - 带上 x。
 * @param decoy - 是否迷惑件。
 * @returns 注入螺母的 id。
 */
export function injectNut(state: ScrewSortState, color: 0 | 1 | 2 | 3, size: 0 | 1, x: number, decoy = false): number {
  const id = state.nextNutId
  state.nextNutId += 1
  state.nuts.push({ id, color, size, decoy, x })
  return id
}

/**
 * 尝试把当前选中的螺母拧到工位 boltIndex：双属性匹配才成功。
 * 成功移除螺母、占用工位 SCREW_MS 并计连击分；不匹配弹回（x 右推
 * BOUNCE_X）、扣分、清连击，连续模式再扣 MISMATCH_TIME_MS；工位
 * 占用中返回 'busy' 不作任何结算。
 * @param state - 目标状态。
 * @param boltIndex - 工位索引 0-3。
 * @returns 'ok' | 'mismatch' | 'busy' | 'none'（无选中 / 已结束）。
 */
export function attemptScrew(state: ScrewSortState, boltIndex: number): 'ok' | 'mismatch' | 'busy' | 'none' {
  if (state.over) return 'none'
  if (state.selected === null) return 'none'
  const idx = state.nuts.findIndex((n) => n.id === state.selected)
  if (idx < 0) {
    state.selected = null
    return 'none'
  }
  const nut = state.nuts[idx]!
  const bolt = state.bolts[boltIndex]!
  const cx = stationX(boltIndex) + STATION_W / 2
  if (bolt.busyUntil > state.t) {
    state.events.push({ type: 'busy', bolt: boltIndex })
    return 'busy'
  }
  if (nut.decoy || nut.color !== bolt.color || nut.size !== bolt.size) {
    state.score = Math.max(0, state.score - MISMATCH_PENALTY)
    state.combo = 0
    if (state.mode === 'continuous') {
      state.timeLeft = Math.max(0, state.timeLeft - MISMATCH_TIME_MS)
    }
    nut.x = Math.min(SPAWN_X - 10, nut.x + BOUNCE_X)
    bolt.flashUntil = state.t + FLASH_MS
    state.events.push({ type: 'mismatch', bolt: boltIndex, x: cx, y: STATION_Y + 50 })
    state.floats.push({ x: cx, y: STATION_Y + 70, text: '错配 -' + MISMATCH_PENALTY, life: FLOAT_MS })
    return 'mismatch'
  }
  state.nuts.splice(idx, 1)
  state.selected = null
  state.combo = state.comboExpire > state.t ? Math.min(COMBO_CAP, state.combo + 1) : 1
  state.comboExpire = state.t + COMBO_WINDOW_MS
  const gained = BASE_SCORE + (state.combo - 1) * COMBO_BONUS
  state.score += gained
  bolt.count += 1
  bolt.screwColor = nut.color
  bolt.screwSize = nut.size
  bolt.busyUntil = state.t + SCREW_MS
  if (state.mode === 'levels') state.levelProgress += 1
  state.events.push({ type: 'screwed', bolt: boltIndex, color: nut.color, x: cx, y: STATION_Y + 50 })
  state.floats.push({ x: cx, y: STATION_Y + 70, text: '+' + gained, life: FLOAT_MS })
  if (state.combo >= 3) {
    state.floats.push({ x: cx, y: STATION_Y + 92, text: 'x' + state.combo + ' 连击', life: FLOAT_MS })
  }
  return 'ok'
}

/**
 * 生成一颗螺母：迷惑件 = 近邻色（同对色互换）+ 被模仿工位的粗细，
 * 双属性均不匹配任何工位；真件属性恰为其颜色对应工位的绑定值。
 * 入口被占（近右端有在途螺母）时跳过本次但照常排下一次时钟。
 * @param state - 目标状态。
 * @param level - 当前档位。
 */
function trySpawn(state: ScrewSortState, level: number): void {
  if (state.t < state.nextSpawnAt) return
  const decoyAllowed = state.mode === 'continuous'
    ? state.t >= DECOY_AFTER_MS
    : state.level >= DECOY_AFTER_LEVEL
  const blocked = state.nuts.some((n) => n.x > BELT_RIGHT - NUT_R * 2 - 8)
  if (!blocked) {
    const decoy = decoyAllowed && state.rng() < DECOY_P
    let color: 0 | 1 | 2 | 3
    let size: 0 | 1
    if (decoy) {
      const mimic = Math.floor(state.rng() * COLOR_COUNT)
      color = (mimic ^ 1) as 0 | 1 | 2 | 3
      size = BOLT_SIZES[mimic]!
    } else {
      color = Math.min(COLOR_COUNT - 1, Math.floor(state.rng() * COLOR_COUNT)) as 0 | 1 | 2 | 3
      size = BOLT_SIZES[color]!
    }
    state.nuts.push({ id: state.nextNutId, color, size, decoy, x: SPAWN_X })
    state.nextNutId += 1
  }
  state.nextSpawnAt = state.t + poissonInterval(state.rng, spawnMeanMs(level))
}

/**
 * 螺母滑出左端：真件记漏检（扣分 + 清连击 + 事件）；迷惑件静默放行
 * （仅事件，供渲染给灰色提示）。
 * @param state - 目标状态。
 * @param nut - 滑出的螺母。
 */
function fallOff(state: ScrewSortState, nut: Nut): void {
  if (nut.decoy) {
    state.events.push({ type: 'decoyPass', x: BELT_LEFT + 16, y: NUT_Y })
    return
  }
  state.missed += 1
  state.score = Math.max(0, state.score - MISS_PENALTY)
  state.combo = 0
  state.events.push({ type: 'missed', color: nut.color, x: BELT_LEFT + 16, y: NUT_Y })
  state.floats.push({ x: BELT_LEFT + 46, y: NUT_Y - 22, text: '漏检 -' + MISS_PENALTY, life: FLOAT_MS })
}

/**
 * 关卡流转：本关拧满目标即清带进下一关；第 LEVEL_COUNT 关拧满即通关。
 * @param state - 目标状态。
 */
function advanceLevel(state: ScrewSortState): void {
  if (state.mode !== 'levels' || state.over) return
  const target = LEVEL_TARGETS[state.level - 1]!
  if (state.levelProgress < target) return
  if (state.level >= LEVEL_COUNT) {
    state.over = true
    state.win = true
    return
  }
  state.level += 1
  state.levelProgress = 0
  state.nuts.length = 0
  state.selected = null
  state.nextSpawnAt = state.t + 1200
  state.events.push({ type: 'level', level: state.level })
  state.floats.push({ x: W / 2, y: NUT_Y - 30, text: '第 ' + state.level + ' 关', life: FLOAT_MS })
}

/**
 * 推进一个固定子步：时钟、限时、生成、带移动、左端判定、飘字衰减、
 * 关卡流转。boost 只放大螺母位移（空格加速带），不改时钟与生成节奏。
 * @param state - 目标状态。
 * @param dtMs - 子步时长 ms（固定 SUBSTEP_MS）。
 * @param boost - 空格加速（位移 ×1.6）。
 */
function substep(state: ScrewSortState, dtMs: number, boost: boolean): void {
  const dt = dtMs / 1000
  state.t += dtMs
  if (state.mode === 'continuous') {
    state.timeLeft -= dtMs
    if (state.timeLeft <= 0) {
      state.timeLeft = 0
      state.over = true
      return
    }
  }
  const level = levelOf(state.mode, state.t, state.level)
  const speed = beltSpeed(level) * (boost ? 1.6 : 1)
  trySpawn(state, level)
  for (let i = state.nuts.length - 1; i >= 0; i -= 1) {
    const nut = state.nuts[i]!
    nut.x -= speed * dt
    if (nut.x + NUT_R < BELT_LEFT) {
      state.nuts.splice(i, 1)
      if (state.selected === nut.id) state.selected = null
      fallOff(state, nut)
    }
  }
  for (let i = state.floats.length - 1; i >= 0; i -= 1) {
    const fl = state.floats[i]!
    fl.y -= 30 * dt
    fl.life -= dtMs
    if (fl.life <= 0) state.floats.splice(i, 1)
  }
  advanceLevel(state)
}

/**
 * 推进一帧：把帧时间累加并按固定 SUBSTEP_MS 子步确定性推进。事件写
 * 入 state.events，调用方每帧消费（下一帧开头清空）。结束后冻结。
 * @param state - 目标状态。
 * @param dtMs - 帧间隔 ms。
 * @param boost - 空格加速带（仅放大位移）。
 */
export function stepScrewSort(state: ScrewSortState, dtMs: number, boost = false): void {
  state.events.length = 0
  if (state.over) {
    state.acc = 0
    return
  }
  state.acc += Math.max(0, dtMs)
  while (state.acc >= SUBSTEP_MS) {
    state.acc -= SUBSTEP_MS
    substep(state, SUBSTEP_MS, boost)
    if (state.over) {
      state.acc = 0
      return
    }
  }
}
