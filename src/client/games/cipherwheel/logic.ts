/**
 * 密码转盘纯逻辑：三种古典加密（凯撒 / 仿射 / 维吉尼亚）、seed 词库出题、
 * 转轮状态与实时解码预览、提交判定、频率统计、提示与过关推进。
 * 所有随机都来自注入的 mulberry32 种子，同一 seed 完全可重放。
 */

/** 注入式确定性随机数发生器（与其它游戏一致的 mulberry32）。 */
export type Rng = () => number

/**
 * 构造一个 mulberry32 伪随机发生器。
 * @param seed - 31 位整数种子。
 * @returns 返回 [0,1) 随机数的函数，同 seed 序列完全一致。
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 字母表长度。 */
const Z = 26
/** 'A' 的字符码。 */
const A_CODE = 65

/** 仿射密码中与 26 互质的合法乘数集合。 */
export const AFFINE_MULTIPLIERS: readonly number[] = [1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25]

/** 英文字母近似频率（百分比，A..Z 顺序），频率图参考线用。 */
export const ENGLISH_FREQ: readonly number[] = [
  8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.8, 4.0, 2.4,
  6.7, 7.5, 1.9, 0.1, 6.0, 6.3, 9.1, 2.8, 1.0, 2.4, 0.15, 2.0, 0.07,
]

/** 内置明文词库（纯大写字母，出题时按 seed 抽取）。 */
const WORDS: readonly string[] = [
  'ATTACKATDAWN', 'THEQUICKBROWNFOX', 'FREQUENCYANALYSIS', 'MEETMEATMIDNIGHT',
  'THEEAGLEHASLANDED', 'SECRETMESSAGESENT', 'CIPHERWHEELTURNS', 'GOLDENRINGOFTIME',
  'BREAKTHECODEFAST', 'CLASSICALCRYPTO', 'OPERATIONNIGHTFALL', 'HELLOWORLDCIPHER',
  'CRACKTHEBRASSWHEEL', 'SHIFTTHELETTERS', 'SPYSECRETSREVEALED', 'MIDNIGHTCIPHERKEY',
  'DECODETHERIDDLENOW', 'ANCIENTROMANCODES', 'PLAINTEXTHIDDENHERE', 'WHEELSSPINTOTRUTH',
]

/** 加密类型。 */
export type CipherKind = 'caesar' | 'affine' | 'vigenere'

/** 每关配置（递进：凯撒 → 仿射 → 维吉尼亚短钥 → 长钥 → 无频率图硬模式）。 */
export interface LevelConfig {
  /** 加密类型。 */
  kind: CipherKind
  /** 关卡名（HUD/说明用）。 */
  name: string
  /** 维吉尼亚密钥长度（其它类型为 0）。 */
  keyLen: number
  /** 是否显示频率分析图（第 5 关硬模式为 false）。 */
  freqChart: boolean
}

/** 五关固定递进。 */
export const LEVELS: readonly LevelConfig[] = [
  { kind: 'caesar', name: '凯撒', keyLen: 0, freqChart: true },
  { kind: 'affine', name: '仿射', keyLen: 0, freqChart: true },
  { kind: 'vigenere', name: '维吉尼亚·短钥', keyLen: 3, freqChart: true },
  { kind: 'vigenere', name: '维吉尼亚·长钥', keyLen: 6, freqChart: true },
  { kind: 'vigenere', name: '盲解·无频率图', keyLen: 5, freqChart: false },
]

/** 一关的题目：密文 + 真实密钥参数（逻辑层持有，渲染不直接展示）。 */
export interface LevelChallenge {
  /** 加密类型。 */
  kind: CipherKind
  /** 明文（词库抽取）。 */
  plainText: string
  /** 密文（由明文与密钥加密得到）。 */
  cipherText: string
  /** 凯撒/仿射的移位量 b。 */
  shift: number
  /** 仿射乘数 a（其它类型恒为 1）。 */
  multiplier: number
  /** 维吉尼亚密钥偏移序列（其它类型为空数组）。 */
  keyOffsets: readonly number[]
}

/** 玩家转轮状态（提交判定与预览的全部输入）。 */
export interface WheelState {
  /** 凯撒/仿射的移位量 b（0..25）。 */
  shift: number
  /** 仿射乘数 a（恒在互质集合内）。 */
  multiplier: number
  /** 维吉尼亚各槽偏移（长度 = 密钥长）。 */
  keyOffsets: number[]
  /** 维吉尼亚当前选中槽索引。 */
  selectedSlot: number
  /** 数字键输入缓冲（两位自动应用）。 */
  digitBuffer: string
}

/** 一次提示揭示的字母映射（密文字母 → 明文字母）。 */
export interface RevealedPair {
  /** 密文字母。 */
  from: string
  /** 对应明文字母。 */
  to: string
}

/** 游戏总状态。 */
export interface CipherWheelState {
  /** 注入的随机源（提示抽取继续用它，保证可重放）。 */
  rng: Rng
  /** 当前关卡索引（0..4）。 */
  level: number
  /** 'playing' 进行中，'won' 全部通关。 */
  phase: 'playing' | 'won'
  /** 当前关题目。 */
  challenge: LevelChallenge
  /** 玩家转轮状态。 */
  wheel: WheelState
  /** 本关已用提示次数（上限 2）。 */
  hintsUsed: number
  /** 已揭示的映射（按揭示顺序）。 */
  revealed: RevealedPair[]
  /** 总得分。 */
  score: number
}

/** 每关提示次数上限。 */
export const MAX_HINTS = 2

/**
 * 凯撒加密：P + s ≡ C (mod 26)。
 * @param text - 纯大写字母明文。
 * @param shift - 移位量（mod 26）。
 * @returns 密文。
 */
export function caesarEncrypt(text: string, shift: number): string {
  const s = ((shift % Z) + Z) % Z
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i) - A_CODE
    out += String.fromCharCode(A_CODE + ((c + s) % Z))
  }
  return out
}

/**
 * 求 a 在模 26 下的乘法逆元。
 * @param a - 乘数（须与 26 互质）。
 * @returns 逆元；不存在（不互质）时为 null。
 */
export function modInverse26(a: number): number | null {
  for (let x = 1; x < Z; x += 1) {
    if ((a * x) % Z === 1) return x
  }
  return null
}

/**
 * 仿射加密：C ≡ a·P + b (mod 26)。
 * @param text - 纯大写字母明文。
 * @param a - 乘数（必须与 26 互质，否则抛错）。
 * @param b - 移位量。
 * @returns 密文。
 */
export function affineEncrypt(text: string, a: number, b: number): string {
  if (modInverse26(a) === null) throw new Error('affine multiplier must be coprime with 26')
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const p = text.charCodeAt(i) - A_CODE
    out += String.fromCharCode(A_CODE + ((a * p + b) % Z))
  }
  return out
}

/**
 * 维吉尼亚加密：C_i ≡ P_i + key[i mod L] (mod 26)。
 * @param text - 纯大写字母明文。
 * @param keyOffsets - 密钥各字母偏移（0..25）。
 * @returns 密文。
 */
export function vigenereEncrypt(text: string, keyOffsets: readonly number[]): string {
  if (keyOffsets.length === 0) throw new Error('vigenere key must not be empty')
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const p = text.charCodeAt(i) - A_CODE
    const k = keyOffsets[i % keyOffsets.length]! % Z
    out += String.fromCharCode(A_CODE + ((p + k) % Z))
  }
  return out
}

/**
 * 按玩家当前转轮状态解出整段预览明文。
 * 凯撒/仿射对全文生效；维吉尼亚按槽偏移逐字母轮换。
 * @param challenge - 当前关题目（提供密文与类型）。
 * @param wheel - 玩家转轮状态。
 * @returns 预览明文。
 */
export function decryptPreview(challenge: LevelChallenge, wheel: WheelState): string {
  let out = ''
  if (challenge.kind === 'vigenere') {
    const len = Math.max(1, wheel.keyOffsets.length)
    for (let i = 0; i < challenge.cipherText.length; i += 1) {
      const c = challenge.cipherText.charCodeAt(i) - A_CODE
      const k = wheel.keyOffsets[i % len] ?? 0
      out += String.fromCharCode(A_CODE + (((c - k) % Z) + Z) % Z)
    }
    return out
  }
  if (challenge.kind === 'affine') {
    const inv = modInverse26(wheel.multiplier)
    const aInv = inv ?? 1
    for (let i = 0; i < challenge.cipherText.length; i += 1) {
      const c = challenge.cipherText.charCodeAt(i) - A_CODE
      out += String.fromCharCode(A_CODE + (((aInv * (c - wheel.shift)) % Z + Z) % Z))
    }
    return out
  }
  for (let i = 0; i < challenge.cipherText.length; i += 1) {
    const c = challenge.cipherText.charCodeAt(i) - A_CODE
    out += String.fromCharCode(A_CODE + (((c - wheel.shift) % Z) + Z) % Z)
  }
  return out
}

/**
 * 统计文本中各字母出现次数（A..Z）。
 * @param text - 纯大写字母文本。
 * @returns 长度 26 的计数数组。
 */
export function letterCounts(text: string): number[] {
  const counts = new Array<number>(Z).fill(0)
  for (let i = 0; i < text.length; i += 1) {
    const idx = text.charCodeAt(i) - A_CODE
    if (idx >= 0 && idx < Z) counts[idx] = (counts[idx] ?? 0) + 1
  }
  return counts
}

/**
 * 用注入随机源为第 levelIndex 关生成题目（词库抽词 + 按类型生成密钥）。
 * @param rng - 注入随机源。
 * @param levelIndex - 关卡索引。
 * @returns 新题目（密钥避开恒等变换）。
 */
export function createChallenge(rng: Rng, levelIndex: number): LevelChallenge {
  const cfg = LEVELS[levelIndex] ?? LEVELS[0]!
  const plainText = WORDS[Math.floor(rng() * WORDS.length)]!
  if (cfg.kind === 'caesar') {
    let shift = 1 + Math.floor(rng() * (Z - 1))
    if (shift % Z === 0) shift = 1
    return { kind: 'caesar', plainText, cipherText: caesarEncrypt(plainText, shift), shift, multiplier: 1, keyOffsets: [] }
  }
  if (cfg.kind === 'affine') {
    const a = AFFINE_MULTIPLIERS[Math.floor(rng() * AFFINE_MULTIPLIERS.length)]!
    let b = Math.floor(rng() * Z)
    if (a === 1 && b === 0) b = 1
    return { kind: 'affine', plainText, cipherText: affineEncrypt(plainText, a, b), shift: b, multiplier: a, keyOffsets: [] }
  }
  const keyLen = cfg.keyLen
  const keyOffsets: number[] = []
  for (let i = 0; i < keyLen; i += 1) keyOffsets.push(1 + Math.floor(rng() * (Z - 1)))
  return { kind: 'vigenere', plainText, cipherText: vigenereEncrypt(plainText, keyOffsets), shift: 0, multiplier: 1, keyOffsets }
}

/**
 * 新建一局（五关从头开始）。
 * @param rng - 注入随机源。
 * @returns 初始状态（转轮全零、零提示、零分）。
 */
export function createCipherWheelState(rng: Rng): CipherWheelState {
  return {
    rng,
    level: 0,
    phase: 'playing',
    challenge: createChallenge(rng, 0),
    wheel: { shift: 0, multiplier: 1, keyOffsets: new Array<number>(LEVELS[0]!.keyLen).fill(0), selectedSlot: 0, digitBuffer: '' },
    hintsUsed: 0,
    revealed: [],
    score: 0,
  }
}

/**
 * 换到下一关：重置转轮与提示，题密钥继续用注入随机源。
 * @param state - 游戏状态（就地推进）。
 */
export function advanceLevel(state: CipherWheelState): void {
  if (state.level >= LEVELS.length - 1) {
    state.phase = 'won'
    return
  }
  state.level += 1
  state.challenge = createChallenge(state.rng, state.level)
  state.wheel = {
    shift: 0,
    multiplier: 1,
    keyOffsets: new Array<number>(LEVELS[state.level]!.keyLen).fill(0),
    selectedSlot: 0,
    digitBuffer: '',
  }
  state.hintsUsed = 0
  state.revealed = []
}

/**
 * 设置凯撒/仿射移位量（mod 26 归一）。清空数字缓冲。
 * @param state - 游戏状态。
 * @param shift - 目标移位量（任意整数）。
 */
export function setShift(state: CipherWheelState, shift: number): void {
  state.wheel.shift = ((shift % Z) + Z) % Z
  state.wheel.digitBuffer = ''
}

/**
 * 设置仿射乘数（不互质时向右吸附到最近互质值）。
 * @param state - 游戏状态。
 * @param a - 目标乘数。
 */
export function setMultiplier(state: CipherWheelState, a: number): void {
  let idx = 0
  let best = Infinity
  for (let i = 0; i < AFFINE_MULTIPLIERS.length; i += 1) {
    const m = AFFINE_MULTIPLIERS[i]!
    const d = Math.abs(m - (((a % Z) + Z) % Z))
    if (d < best) { best = d; idx = i }
  }
  state.wheel.multiplier = AFFINE_MULTIPLIERS[idx]!
  state.wheel.digitBuffer = ''
}

/**
 * 旋转当前转轮目标：凯撒/仿射转 b，维吉尼亚转选中槽。
 * @param state - 游戏状态。
 * @param delta - 步进格数（正 = 顺时针）。
 */
export function rotateWheel(state: CipherWheelState, delta: number): void {
  const kind = state.challenge.kind
  if (kind === 'vigenere') {
    const i = Math.min(Math.max(state.wheel.selectedSlot, 0), Math.max(0, state.wheel.keyOffsets.length - 1))
    const cur = state.wheel.keyOffsets[i] ?? 0
    state.wheel.keyOffsets[i] = (((cur + delta) % Z) + Z) % Z
  } else {
    state.wheel.shift = (((state.wheel.shift + delta) % Z) + Z) % Z
  }
  state.wheel.digitBuffer = ''
}

/**
 * 数字键输入：缓冲一位，凑满两位立即作为偏移应用（维吉尼亚应用到选中槽）。
 * @param state - 游戏状态。
 * @param digit - '0'..'9'。
 */
export function applyDigit(state: CipherWheelState, digit: string): void {
  if (digit < '0' || digit > '9') return
  const buf = state.wheel.digitBuffer + digit
  if (buf.length >= 2) {
    setWheelTarget(state, Number(buf.slice(0, 2)))
    return
  }
  state.wheel.digitBuffer = buf
}

/**
 * 把数值写入当前转轮目标（维吉尼亚选中槽 / 其它为 b；仿射另设 a）。
 * @param state - 游戏状态。
 * @param value - 目标偏移值。
 */
export function setWheelTarget(state: CipherWheelState, value: number): void {
  const v = ((Math.trunc(value) % Z) + Z) % Z
  const kind = state.challenge.kind
  if (kind === 'vigenere') {
    const i = Math.min(Math.max(state.wheel.selectedSlot, 0), Math.max(0, state.wheel.keyOffsets.length - 1))
    state.wheel.keyOffsets[i] = v
  } else {
    state.wheel.shift = v
  }
  state.wheel.digitBuffer = ''
}

/**
 * 当前预览是否已等于明文（提交判定依据）。
 * @param state - 游戏状态。
 * @returns 解开为 true。
 */
export function isSolved(state: CipherWheelState): boolean {
  return decryptPreview(state.challenge, state.wheel) === state.challenge.plainText
}

/**
 * 每关基础分（后面关卡更值钱）扣提示代价。
 * @param levelIndex - 关卡索引。
 * @param hints - 本关提示次数。
 * @returns 该关得分。
 */
export function scoreForLevel(levelIndex: number, hints: number): number {
  return Math.max(40, 100 + levelIndex * 20 - hints * 15)
}

/**
 * 提交当前预览：正确则计分并推进（末关置 won），错误不动。
 * @param state - 游戏状态。
 * @returns 'correct' 或 'wrong'。
 */
export function submitAnswer(state: CipherWheelState): 'correct' | 'wrong' {
  if (state.phase !== 'playing') return 'wrong'
  if (!isSolved(state)) return 'wrong'
  state.score += scoreForLevel(state.level, state.hintsUsed)
  advanceLevel(state)
  return 'correct'
}

/**
 * 使用一次提示：随机揭示一个尚未揭示的密文字母 → 明文字母映射。
 * @param state - 游戏状态。
 * @returns 揭示的映射；已用满或无新字母可揭时为 null。
 */
export function applyHint(state: CipherWheelState): RevealedPair | null {
  if (state.phase !== 'playing' || state.hintsUsed >= MAX_HINTS) return null
  const known = new Set(state.revealed.map((p) => p.from))
  const candidates: number[] = []
  const plain = state.challenge.plainText
  for (let i = 0; i < plain.length; i += 1) {
    const c = state.challenge.cipherText[i]!
    if (!known.has(c)) candidates.push(i)
  }
  if (candidates.length === 0) return null
  const pick = candidates[Math.floor(state.rng() * candidates.length)]!
  const pair: RevealedPair = { from: state.challenge.cipherText[pick]!, to: plain[pick]! }
  state.revealed.push(pair)
  state.hintsUsed += 1
  return pair
}

/**
 * 密文中某位置的字母是否已被提示揭示（渲染绿色明文用）。
 * @param state - 游戏状态。
 * @param index - 密文字符位置。
 * @returns 揭示后的明文字母；未揭示为 null。
 */
export function revealedAt(state: CipherWheelState, index: number): string | null {
  const c = state.challenge.cipherText[index]
  if (c === undefined) return null
  for (const pair of state.revealed) {
    if (pair.from === c) return pair.to
  }
  return null
}

/**
 * 用若干关的真实密钥直接构建状态（测试与调试用捷径）。
 * @param challenge - 指定题目。
 * @param levelIndex - 关卡索引。
 * @returns 置好题目的新状态（随机源为固定 seed）。
 */
export function stateWithChallenge(challenge: LevelChallenge, levelIndex: number): CipherWheelState {
  const rng = mulberry32(1)
  const state = createCipherWheelState(rng)
  state.level = levelIndex
  state.challenge = challenge
  state.wheel = {
    shift: 0,
    multiplier: 1,
    keyOffsets: new Array<number>(LEVELS[levelIndex]!.keyLen).fill(0),
    selectedSlot: 0,
    digitBuffer: '',
  }
  return state
}

/** 通关总分（测试全流程用）。 */
export function totalPerfectScore(): number {
  let total = 0
  for (let i = 0; i < LEVELS.length; i += 1) total += scoreForLevel(i, 0)
  return total
}
