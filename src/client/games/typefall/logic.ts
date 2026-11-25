/**
 * 字母雨 TypeFall 纯逻辑：顶部给出目标单词，单词的字母按顺序一个个
 * 从夜空落下；玩家按下正确的字母键即把该字母接入拼词槽（按单词顺序），
 * 按错键或目标字母落地未接都漏一个（扣 1 命，共 3 命）。拼完一个词得分
 * 并进入下一词；一组词（3-5 个）拼完进入下一关，共 5 关。第 2 关起有
 * 干扰字母同屏下落：落地无害，但按到它算按错。所有随机走 mulberry32
 * 种子注入，逻辑是关于显式毫秒时钟的确定性纯函数，可完整重放。
 */

/** 32 位种子伪随机（mulberry32）：返回 [0,1)。 */
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

/** 关卡总数。 */
export const LEVELS = 5
/** 每关抽的单词个数（下标=关卡，0 起）。 */
export const WORDS_PER_LEVEL: readonly number[] = [3, 3, 4, 4, 5]
/** 初始生命。 */
export const START_LIVES = 3
/** 逻辑画布宽（px）。 */
export const FIELD_W = 480
/** 接地线 y（px）：目标字母方块底边触到即漏。 */
export const GROUND_Y = 460
/** 字母方块边长（px）。 */
export const LETTER_SIZE = 30
/** 落点横坐标两侧留白（px）。 */
export const SIDE_MARGIN = 30
/** 接住一个字母的基础分。 */
export const CATCH_SCORE = 5
/** 拼完单词每个字母的奖励分。 */
export const WORD_BONUS_PER_LETTER = 10
/** 拼完单词按关卡的额外奖励分（关卡 0 起，每关 +20）。 */
export const LEVEL_BONUS = 20
/** 命中闪光时长（ms）。 */
export const FLASH_MS = 260
/** 漏接/按错的画面抖动时长（ms）。 */
export const SHAKE_MS = 240
/** 关卡横幅展示时长（ms）。 */
export const BANNER_MS = 1400

/** 4 字母词池（第 1 关）。 */
const POOL4 = [
  'time', 'star', 'moon', 'rain', 'snow', 'wind', 'fire', 'gold', 'king', 'ship',
  'road', 'song', 'hand', 'head', 'door', 'food', 'game', 'home', 'land', 'name',
  'play', 'read', 'city', 'fish',
] as const
/** 5 字母词池（第 2、3 关）。 */
const POOL5 = [
  'apple', 'grape', 'lemon', 'peach', 'berry', 'bread', 'river', 'ocean', 'beach', 'stone',
  'metal', 'house', 'tower', 'chair', 'table', 'paper', 'music', 'dance', 'smile', 'dream',
  'magic', 'sword', 'cloud', 'storm',
] as const
/** 6 字母词池（第 4、5 关）。 */
const POOL6 = [
  'castle', 'dragon', 'planet', 'rocket', 'puzzle', 'wonder', 'bright', 'silver', 'shadow', 'winter',
  'summer', 'spring', 'friend', 'family', 'school', 'letter', 'number', 'flower', 'garden', 'monkey',
] as const
/** 7 字母词池（第 5 关）。 */
const POOL7 = [
  'morning', 'evening', 'kitchen', 'picture', 'village', 'rainbow', 'whisper', 'mystery',
  'chicken', 'dolphin', 'machine', 'monster', 'kingdom', 'journey', 'diamond', 'harvest',
] as const

/** 每关可抽的词池（关卡 0 起；总词量 84 个）。 */
const LEVEL_POOLS: readonly (readonly string[])[] = [
  POOL4,
  [...POOL4, ...POOL5],
  POOL5,
  POOL6,
  [...POOL6, ...POOL7],
]

/** 全部词库（扁平，供测试断言总量与长度）。 */
export const WORD_BANK: readonly string[] = [...POOL4, ...POOL5, ...POOL6, ...POOL7]

/** 一个下落字母（目标或干扰）。 */
export interface FallingLetter {
  id: number
  /** 大写字母。 */
  ch: string
  x: number
  y: number
  /** 下落速度（px/s），生成时确定。 */
  vy: number
  /** true=干扰字母：落地无害、按到算错。 */
  decoy: boolean
}

/** 一帧溅落事件（渲染/粒子消费后由调用方清空）。 */
export interface Splat {
  x: number
  y: number
  /** miss=目标落地漏接；hit=按键命中。 */
  kind: 'miss' | 'hit'
}

/** 字母雨的完整可变状态（纯数据 + 种子随机源）。 */
export interface TypeFallState {
  /** 种子随机源；同一种子重放结果完全一致。 */
  rand: () => number
  /** 当前关卡（0 起，共 5）。 */
  level: number
  /** 每关预先按种子抽好的单词队列。 */
  queues: string[][]
  /** 当前词在本关队列中的下标。 */
  wordIndex: number
  /** 当前词已拼入的字母数。 */
  typed: number
  lives: number
  score: number
  /** 生命耗尽 true。 */
  over: boolean
  /** 5 关全部拼完 true。 */
  won: boolean
  /** 正在下落的目标字母（同屏至多一个）。 */
  active: FallingLetter | null
  /** 同屏干扰字母。 */
  decoys: FallingLetter[]
  /** 距离下一个目标字母生成的倒计时（ms）。 */
  nextSpawnMs: number
  /** 距离下一个干扰字母生成的倒计时（ms）。 */
  decoySpawnMs: number
  /** 待消费的溅落事件。 */
  pendingSplats: Splat[]
  flashMs: number
  shakeMs: number
  levelBannerMs: number
  nextId: number
}

/** 基础下落速度（px/s）：随关卡与词序渐增。 */
export function letterSpeed(level: number, wordIndex: number): number {
  return 85 + level * 24 + wordIndex * 4
}

/** 目标字母生成间隔（ms）：随关卡缩短。 */
export function spawnDelayMs(level: number): number {
  return Math.max(240, 620 - level * 110)
}

/** 干扰字母生成间隔（ms）；关卡 0（第 1 关）不生成干扰。 */
export function decoyIntervalMs(level: number): number {
  return Math.max(560, 1700 - level * 430)
}

/** 从池中不放回抽取 n 个词（种子随机）。 */
function drawWords(pool: readonly string[], count: number, rand: () => number): string[] {
  const rest = [...pool]
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const k = Math.floor(rand() * rest.length)
    out.push(rest.splice(k, 1)[0]!)
  }
  return out
}

/** 当前目标单词（大写展示由渲染负责，此处保留原小写）。 */
export function currentWord(state: TypeFallState): string {
  return state.queues[state.level]![state.wordIndex]!
}

/** 用种子创建初始状态：各关词队列在创建时一次抽定。 */
export function createTypeFallState(seed: number): TypeFallState {
  const rand = mulberry32(seed)
  const queues: string[][] = []
  for (let level = 0; level < LEVELS; level += 1) {
    queues.push(drawWords(LEVEL_POOLS[level]!, WORDS_PER_LEVEL[level]!, rand))
  }
  return {
    rand,
    level: 0,
    queues,
    wordIndex: 0,
    typed: 0,
    lives: START_LIVES,
    score: 0,
    over: false,
    won: false,
    active: null,
    decoys: [],
    nextSpawnMs: 600,
    decoySpawnMs: decoyIntervalMs(0),
    pendingSplats: [],
    flashMs: 0,
    shakeMs: 0,
    levelBannerMs: BANNER_MS,
    nextId: 1,
  }
}

/** 生成一个下落字母的公共随机部分。 */
function makeLetter(state: TypeFallState, ch: string, decoy: boolean): FallingLetter {
  const x = SIDE_MARGIN + state.rand() * (FIELD_W - 2 * SIDE_MARGIN - LETTER_SIZE)
  const base = letterSpeed(state.level, state.wordIndex)
  const vy = decoy ? 55 + state.rand() * 55 : base * (0.9 + state.rand() * 0.25)
  const letter: FallingLetter = { id: state.nextId, ch, x, y: -LETTER_SIZE, vy, decoy }
  state.nextId += 1
  return letter
}

/** 漏一个：扣 1 命，记录抖动；生命归零即结束。 */
function miss(state: TypeFallState): void {
  state.lives -= 1
  state.shakeMs = SHAKE_MS
  if (state.lives <= 0) {
    state.lives = 0
    state.over = true
    state.active = null
  }
}

/** 拼完当前词：加分并流转到下一词/下一关。 */
function completeWord(state: TypeFallState): void {
  const word = currentWord(state)
  state.score += word.length * WORD_BONUS_PER_LETTER + state.level * LEVEL_BONUS
  state.wordIndex += 1
  state.typed = 0
  if (state.wordIndex >= state.queues[state.level]!.length) {
    state.level += 1
    state.wordIndex = 0
    state.decoys = []
    state.levelBannerMs = BANNER_MS
    if (state.level >= LEVELS) {
      state.level = LEVELS - 1
      state.won = true
      state.active = null
      return
    }
    state.nextSpawnMs = spawnDelayMs(state.level) + 900
    return
  }
  state.nextSpawnMs = spawnDelayMs(state.level) + 350
}

/**
 * 按一个字母键（A-Z，大小写均可）。
 * @returns hit=接住目标字母；wrong=按错（扣命，目标字母继续下落）；
 * complete=接住并拼完整个词；ignored=游戏已结束或通关。
 */
export function pressLetter(state: TypeFallState, ch: string): 'hit' | 'wrong' | 'complete' | 'ignored' {
  if (state.over || state.won) return 'ignored'
  const key = ch.toUpperCase()
  const active = state.active
  if (active === null || active.decoy) {
    miss(state)
    return 'wrong'
  }
  if (active.ch !== key) {
    miss(state)
    return 'wrong'
  }
  state.typed += 1
  state.score += CATCH_SCORE
  state.flashMs = FLASH_MS
  state.pendingSplats.push({ x: active.x + LETTER_SIZE / 2, y: active.y + LETTER_SIZE / 2, kind: 'hit' })
  state.active = null
  if (state.typed >= currentWord(state).length) {
    completeWord(state)
    return 'complete'
  }
  state.nextSpawnMs = spawnDelayMs(state.level)
  return 'hit'
}

/**
 * 推进模拟 dt 毫秒：生成/下落目标与干扰字母、判定落地漏接、衰减闪光。
 * 结束或通关后仅衰减视觉计时器。
 */
export function tickTypeFall(state: TypeFallState, dtMs: number): void {
  state.flashMs = Math.max(0, state.flashMs - dtMs)
  state.shakeMs = Math.max(0, state.shakeMs - dtMs)
  state.levelBannerMs = Math.max(0, state.levelBannerMs - dtMs)
  if (state.over || state.won) return

  const dt = dtMs / 1000
  const word = currentWord(state)

  if (state.active === null) {
    state.nextSpawnMs -= dtMs
    if (state.nextSpawnMs <= 0) {
      const ch = word[state.typed]!.toUpperCase()
      state.active = makeLetter(state, ch, false)
    }
  } else {
    const active = state.active
    active.y += active.vy * dt
    if (active.y + LETTER_SIZE >= GROUND_Y) {
      state.pendingSplats.push({ x: active.x + LETTER_SIZE / 2, y: GROUND_Y, kind: 'miss' })
      state.active = null
      miss(state)
      if (!state.over) state.nextSpawnMs = spawnDelayMs(state.level)
    }
  }

  // 干扰字母：第 2 关（level>=1）起出现，落地无害直接移除。
  if (state.level >= 1) {
    state.decoySpawnMs -= dtMs
    if (state.decoySpawnMs <= 0) {
      state.decoySpawnMs = decoyIntervalMs(state.level) * (0.8 + state.rand() * 0.4)
      let code = 65 + Math.floor(state.rand() * 26)
      // 干扰字母不与当前待接字母相同，避免视觉歧义。
      if (String.fromCharCode(code) === word[state.typed]!.toUpperCase()) {
        code = 65 + ((code - 65 + 13) % 26)
      }
      state.decoys.push(makeLetter(state, String.fromCharCode(code), true))
    }
  }
  for (let i = state.decoys.length - 1; i >= 0; i -= 1) {
    const d = state.decoys[i]!
    d.y += d.vy * dt
    if (d.y > GROUND_Y + 30) state.decoys.splice(i, 1)
  }
}
