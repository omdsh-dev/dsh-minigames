/**
 * 记忆路径 TrailMemory 纯逻辑：6×6 网格上生成一条自避路径（第 3 轮起
 * 含传送格、第 5 轮起含干扰微闪），逐格闪现后由玩家按序点击复现。
 * 所有函数都是对纯状态对象的推进（时间由调用方以毫秒注入），无 DOM、
 * 无定时器；随机数全部来自注入的 mulberry32 种子，同种子可确定性重放。
 */

/** 网格边长（6×6 = 36 格，格下标 = 行 × 6 + 列）。 */
export const GRID = 6
/** 第 1 轮的路径长度（含起点格）。 */
export const START_LEN = 3
/** 路径长度上限（36 格内自避行走的实用上限）。 */
export const MAX_LEN = 12
/** 初始命数。 */
export const START_LIVES = 3
/** 第 1 轮每格闪现时长（毫秒）。 */
export const FLASH_START_MS = 600
/** 每轮闪现时长递减量（毫秒）。 */
export const FLASH_STEP_MS = 40
/** 闪现时长下限（毫秒）。 */
export const FLASH_MIN_MS = 280
/** 干扰微闪时长（毫秒，明显短于真格闪现）。 */
export const DISTRACT_MS = 160
/** 传送格出现的起始轮。 */
export const TELEPORT_ROUND = 3
/** 第 TELEPORT_ROUND 轮起每步选择传送的概率。 */
export const TELEPORT_CHANCE = 0.2
/** 干扰微闪出现的起始轮。 */
export const DISTRACT_ROUND = 5

/**
 * mulberry32 种子随机数发生器。
 * @param seed - 32 位种子（任意整数，内部取无符号截断）。
 * @returns 返回 [0, 1) 均匀随机数的函数。
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

/** 对局阶段：初始 → 闪现 ↔ 输入（错步回到闪现）→ 结束。 */
export type TrailPhase = 'idle' | 'showing' | 'input' | 'over'

/** 闪现序列中的一次事件：真路径格或干扰微闪格。 */
export interface ShowEvent {
  /** 格下标 0..35。 */
  cell: number
  /** true = 路径格；false = 干扰微闪。 */
  isPath: boolean
  /** 路径格是否为传送格（与上一格不相邻）。 */
  teleport: boolean
}

/** 一轮的路径配置：格子序列 + 逐格传送标记。 */
export interface TrailConfig {
  /** 自避格子序列，path[0] 为起点。 */
  path: number[]
  /** 与 path 平行；teleports[i] 为 true 表示第 i 步与上一步不相邻。 */
  teleports: boolean[]
}

/** 对局状态（纯数据，渲染与输入判定都读它）。 */
export interface TrailMemoryState {
  phase: TrailPhase
  /** 当前轮（1 起；0 表示尚未开始第一轮）。 */
  round: number
  lives: number
  score: number
  /** 本轮路径（over 前不重置，供结算展示）。 */
  path: number[]
  teleports: boolean[]
  /** 闪现序列（路径格 + 干扰微闪，按时间顺序交错）。 */
  events: ShowEvent[]
  /** 当前闪到第几个事件。 */
  showIndex: number
  /** 当前事件内已流逝的毫秒。 */
  showElapsed: number
  /** 输入阶段已正确点到的步数。 */
  inputIndex: number
  /** 本轮空格重看是否已用。 */
  replayUsed: boolean
  /** 注入的随机源（通常为 mulberry32）。 */
  rng: () => number
}

/**
 * 创建初始状态（phase 为 idle，需调用 startRound 开始第一轮）。
 * @param rng - 注入随机源，默认 Math.random（测试注入 mulberry32）。
 * @returns 初始状态对象。
 */
export function createTrailMemoryState(rng: () => number = Math.random): TrailMemoryState {
  return {
    phase: 'idle', round: 0, lives: START_LIVES, score: 0,
    path: [], teleports: [], events: [],
    showIndex: 0, showElapsed: 0, inputIndex: 0, replayUsed: false, rng,
  }
}

/**
 * 某轮的路径长度：从 START_LEN 起每轮 +1，封顶 MAX_LEN。
 * @param round - 轮数（1 起）。
 * @returns 该轮路径的格子数。
 */
export function trailLength(round: number): number {
  return Math.min(START_LEN + round - 1, MAX_LEN)
}

/**
 * 某轮每格闪现时长：600ms 起每轮递减 40ms，下限 280ms。
 * @param round - 轮数（1 起）。
 * @returns 闪现时长（毫秒）。
 */
export function flashMs(round: number): number {
  return Math.max(FLASH_MIN_MS, FLASH_START_MS - (round - 1) * FLASH_STEP_MS)
}

/** 两格是否正交相邻（曼哈顿距离 1）。 */
function areAdjacent(a: number, b: number): boolean {
  const dr = Math.abs(Math.floor(a / GRID) - Math.floor(b / GRID))
  const dc = Math.abs((a % GRID) - (b % GRID))
  return dr + dc === 1
}

/** 用注入随机源从数组等概率取一个元素。 */
function pick(rng: () => number, arr: number[]): number {
  return arr[Math.floor(rng() * arr.length)]!
}

/**
 * 生成某轮的自避路径：非传送步走正交相邻格，传送步跳到任意未访格。
 * 走死（无路可走且无传送格可跳）则整条重试，上限 200 次；36 格内
 * 长度不超过 MAX_LEN 几乎不会全部死锁，兜底返回最长的一次尝试。
 * @param rng - 注入随机源。
 * @param round - 轮数（1 起），决定是否启用传送步。
 * @returns 路径配置（path 与 teleports 平行等长）。
 */
export function generateTrail(rng: () => number, round: number): TrailConfig {
  const len = trailLength(round)
  let best: TrailConfig | null = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const path: number[] = [Math.floor(rng() * GRID * GRID)]
    const teleports: boolean[] = [false]
    while (path.length < len) {
      const prev = path[path.length - 1]!
      const neighbors: number[] = []
      const far: number[] = []
      for (let c = 0; c < GRID * GRID; c += 1) {
        if (path.indexOf(c) !== -1) continue
        if (areAdjacent(prev, c)) neighbors.push(c)
        else far.push(c)
      }
      // 传送步只从非相邻未访格里挑：teleports 标记 ⟺ 该步真的不相邻。
      const wantTeleport = round >= TELEPORT_ROUND && far.length > 0 && rng() < TELEPORT_CHANCE
      if (wantTeleport) {
        path.push(pick(rng, far))
        teleports.push(true)
      } else if (neighbors.length > 0) {
        path.push(pick(rng, neighbors))
        teleports.push(false)
      } else if (far.length > 0) {
        // 走死但仍有未访格：退化为一次传送跳步。
        path.push(pick(rng, far))
        teleports.push(true)
      } else {
        break
      }
    }
    const config: TrailConfig = { path, teleports }
    if (path.length === len) return config
    if (best === null || path.length > best.path.length) best = config
  }
  return best!
}

/**
 * 构造某轮的闪现序列：路径格按序，干扰微闪（非路径格）从第
 * DISTRACT_ROUND 轮起插在随机步之后——微闪更短更暗，迷惑记忆。
 * @param rng - 注入随机源。
 * @param config - 本轮路径配置。
 * @param round - 轮数（1 起）。
 * @returns 按时间顺序排列的闪现事件。
 */
export function buildEvents(rng: () => number, config: TrailConfig, round: number): ShowEvent[] {
  const events: ShowEvent[] = []
  const insertions = new Map<number, number>()
  if (round >= DISTRACT_ROUND) {
    const count = Math.min(1 + Math.floor((round - DISTRACT_ROUND) / 2), 3, config.path.length - 1)
    let guard = 0
    while (insertions.size < count && guard < 200) {
      guard += 1
      const after = 1 + Math.floor(rng() * (config.path.length - 1))
      const cell = Math.floor(rng() * GRID * GRID)
      if (config.path.indexOf(cell) !== -1 || insertions.has(after)) continue
      insertions.set(after, cell)
    }
  }
  for (let i = 0; i < config.path.length; i += 1) {
    events.push({ cell: config.path[i]!, isPath: true, teleport: config.teleports[i] === true })
    const distract = insertions.get(i)
    if (distract !== undefined) events.push({ cell: distract, isPath: false, teleport: false })
  }
  return events
}

/**
 * 开始下一轮（round + 1）：生成本轮路径与闪现序列并进入闪现阶段。
 * @param state - 对局状态。
 */
export function startRound(state: TrailMemoryState): void {
  state.round += 1
  const config = generateTrail(state.rng, state.round)
  state.path = config.path
  state.teleports = config.teleports
  state.events = buildEvents(state.rng, config, state.round)
  state.phase = 'showing'
  state.showIndex = 0
  state.showElapsed = 0
  state.inputIndex = 0
  state.replayUsed = false
}

/**
 * 当前正在闪的事件（仅闪现阶段非空）。
 * @param state - 对局状态。
 * @returns 当前事件，闪完或不在闪现阶段返回 null。
 */
export function currentEvent(state: TrailMemoryState): ShowEvent | null {
  if (state.phase !== 'showing') return null
  return state.events[state.showIndex] ?? null
}

/**
 * 一次事件的闪现时长：路径格按轮速闪现，干扰微闪固定短促。
 * @param event - 闪现事件。
 * @param round - 轮数（1 起）。
 * @returns 时长（毫秒）。
 */
export function eventDurationMs(event: ShowEvent, round: number): number {
  return event.isPath ? flashMs(round) : DISTRACT_MS
}

/**
 * 推进闪现阶段（毫秒由调用方注入；暂停即不再调用）。
 * @param state - 对局状态。
 * @param dtMs - 推进的毫秒数（跨事件一次性消费）。
 * @returns true 表示本次推进恰好把整条序列闪完、阶段转为 input。
 */
export function advanceShow(state: TrailMemoryState, dtMs: number): boolean {
  if (state.phase !== 'showing' || dtMs <= 0) return false
  let remain = dtMs
  while (remain > 0 && state.phase === 'showing') {
    const event = state.events[state.showIndex]
    if (event === undefined) {
      state.phase = 'input'
      state.inputIndex = 0
      return true
    }
    const need = eventDurationMs(event, state.round) - state.showElapsed
    if (remain < need) {
      state.showElapsed += remain
      remain = 0
    } else {
      remain -= need
      state.showElapsed = 0
      state.showIndex += 1
      if (state.showIndex >= state.events.length) {
        state.phase = 'input'
        state.inputIndex = 0
        return true
      }
    }
  }
  return false
}

/** clickCell 的判定结果。 */
export type ClickResult = 'ignored' | 'step' | 'round-clear' | 'retry' | 'game-over'

/**
 * 输入阶段点击一格：与路径下一步逐步比对。
 * @param state - 对局状态。
 * @param cell - 被点的格下标 0..35。
 * @returns 'ignored' 非输入阶段；'step' 正确且未走完；'round-clear'
 *   全对（计分并进入下一轮）；'retry' 错步扣 1 命后重看本条路径；
 *   'game-over' 命尽结束。
 */
export function clickCell(state: TrailMemoryState, cell: number): ClickResult {
  if (state.phase !== 'input') return 'ignored'
  if (state.path[state.inputIndex] !== cell) {
    state.lives -= 1
    if (state.lives <= 0) {
      state.lives = 0
      state.phase = 'over'
      return 'game-over'
    }
    // 还有命：回到闪现阶段重看本条路径（不重置 replayUsed）。
    state.phase = 'showing'
    state.showIndex = 0
    state.showElapsed = 0
    state.inputIndex = 0
    return 'retry'
  }
  state.inputIndex += 1
  if (state.inputIndex >= state.path.length) {
    state.score += state.path.length * state.path.length
    startRound(state)
    return 'round-clear'
  }
  return 'step'
}

/**
 * 输入阶段按空格重看本条路径一次（每轮一次，错步重看不占用它）。
 * @param state - 对局状态。
 * @returns true 表示重看生效（回到闪现阶段）；false 表示不可用。
 */
export function useReplay(state: TrailMemoryState): boolean {
  if (state.phase !== 'input' || state.replayUsed) return false
  state.replayUsed = true
  state.phase = 'showing'
  state.showIndex = 0
  state.showElapsed = 0
  state.inputIndex = 0
  return true
}
