/**
 * 火柴算式纯逻辑：七段数码管风格的等式谜题。数字 0-9 与 +、-、= 全部
 * 由火柴段拼成；每题初始等式不成立，玩家通过「移动一根」或变体关的
 * 「补一根 / 抽一根」使其成立。题库从随机合法等式出发做一次等价扰动
 * 生成——原等式恒可还原，保证每题至少一解（可能存在多解，均判对）。
 * 仅含确定性纯函数与状态机：无 DOM、无定时器；随机性全部经注入的
 * rng（mulberry32）驱动，同种子同序列，可重放可测。
 */

/** 段名全集：a 顶横、b 右上竖、c 右下竖、d 底横、e 左下竖、f 左上竖、
 * g 中横（七段数码管标准段），m/n 中竖上下半（仅 +），x/y 双横
 * （仅 =）。共 11 个火柴位。 */
export type Seg = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'm' | 'n' | 'x' | 'y'

/** 段名按序数组（位掩码位次来源）。 */
const SEG_LIST: readonly Seg[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'm', 'n', 'x', 'y']

/** 每个段名对应的位掩码。 */
const SEG_BIT: Readonly<Record<Seg, number>> = {
  a: 1, b: 2, c: 4, d: 8, e: 16, f: 32, g: 64, m: 128, n: 256, x: 512, y: 1024,
}

/** 合法字型表：字符 -> 组成段集合（掩码在模块加载时展开）。 */
const GLYPH_SEGS: Readonly<Record<string, readonly Seg[]>> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '+': ['g', 'm', 'n'],
  '-': ['g'],
  '=': ['x', 'y'],
}

/** 字符 -> 段位掩码（非法字符返回 0）。 */
const CHAR_BITS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(GLYPH_SEGS).map(([ch, segs]) => [ch, segs.reduce((bits, s) => bits | SEG_BIT[s], 0)]),
)

/** 位掩码 -> 字符（非法组合返回 null）。 */
const BITS_CHAR: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(CHAR_BITS).map(([ch, bits]) => [bits, ch]),
)

/** 每关 5 题、共 5 关；maxDigits 为操作数最大位数，timeLimit 为每题
 * 秒数，variants 关允许移动/补/抽三种修法。 */
export interface LevelConfig {
  maxDigits: number
  timeLimit: number
  variants: boolean
}

/** 关卡表：位数 1→2→3 递进，限时 60→30 递减，后两关开变体。 */
export const LEVELS: readonly LevelConfig[] = [
  { maxDigits: 1, timeLimit: 60, variants: false },
  { maxDigits: 2, timeLimit: 52, variants: false },
  { maxDigits: 2, timeLimit: 44, variants: false },
  { maxDigits: 3, timeLimit: 37, variants: true },
  { maxDigits: 3, timeLimit: 30, variants: true },
]

/** 每关题数。 */
export const PUZZLES_PER_LEVEL = 5
/** 解一题基础分。 */
export const SOLVE_BASE_SCORE = 80

/** 修法类型：move 移动一根、add 补一根（题面被抽走过一根）、
 * remove 抽一根（题面被多塞了一根）。 */
export type PuzzleFix = 'move' | 'add' | 'remove'

/** 一次完整的火柴移动：从 fromCell 的 fromSeg 拿起，放到 toCell 的 toSeg。 */
export interface StickMove {
  fromCell: number
  fromSeg: Seg
  toCell: number
  toSeg: Seg
}

/** 生成器记录的保底解（原等式的还原动作）。 */
export type PuzzleSolution =
  | { fix: 'move', move: StickMove }
  | { fix: 'add', cell: number, seg: Seg }
  | { fix: 'remove', cell: number, seg: Seg }

/** 一道题：初始字元序列、修法与保底解。 */
export interface MatchstickPuzzle {
  /** 逐字元的等式串，如 '9-6=3'。 */
  cells: string
  fix: PuzzleFix
  solution: PuzzleSolution
}

/** 玩家手中正拿着的火柴：来自棋盘某格，或来自备用匣。 */
export type HeldStick =
  | { from: 'board', cell: number, seg: Seg }
  | { from: 'reserve' }

/** 一局完整状态。 */
export interface MatchstickState {
  seed: number
  /** 当前关（0 起）。 */
  level: number
  /** 关内题号（0 起）。 */
  puzzleIndex: number
  /** 本题剩余秒数。 */
  timeLeft: number
  score: number
  /** 'playing' 进行中；'won' 五关全清。 */
  status: 'playing' | 'won'
  /** 当前题面字元序列（随玩家操作即时变化）。 */
  cells: string
  /** 当前题修法。 */
  fix: PuzzleFix
  /** 手持火柴（空为 null）。 */
  held: HeldStick | null
  /** 本题已试错次数。 */
  attempts: number
  /** 全局已解 / 超时题数。 */
  solved: number
  failed: number
  /** 全部 5x5 题库（种子驱动，创建时一次生成）。 */
  puzzles: MatchstickPuzzle[][]
}

/**
 * mulberry32 确定性伪随机数生成器：返回 [0,1) 的函数，同种子同序列。
 * @param seed - 非负整数种子。
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
 * 读取字符的段位掩码。
 * @param ch - 等式字元（数字或 +、-、=）。
 * @returns 段位掩码；非法字符返回 0。
 */
export function glyphBits(ch: string): number {
  return CHAR_BITS[ch] ?? 0
}

/**
 * 位掩码反查字元。
 * @param bits - 段位掩码。
 * @returns 对应字元；不是任何合法字型时返回 null。
 */
export function charFromBits(bits: number): string | null {
  return BITS_CHAR[bits] ?? null
}

/**
 * 某格还能补进哪些段（补后仍是合法字型）——放置候选位。
 * @param ch - 该格当前字元。
 * @returns 可补段名列表。
 */
export function addableSegs(ch: string): Seg[] {
  const bits = glyphBits(ch)
  const out: Seg[] = []
  for (const s of SEG_LIST) {
    const b = SEG_BIT[s]
    if ((bits & b) === 0 && charFromBits(bits | b) !== null) out.push(s)
  }
  return out
}

/**
 * 某格还能抽走哪些段（抽后仍是合法字型）。
 * @param ch - 该格当前字元。
 * @returns 可抽段名列表。
 */
export function removableSegs(ch: string): Seg[] {
  const bits = glyphBits(ch)
  const out: Seg[] = []
  for (const s of SEG_LIST) {
    const b = SEG_BIT[s]
    if ((bits & b) !== 0 && charFromBits(bits & ~b) !== null) out.push(s)
  }
  return out
}

/**
 * 等式求值：结构与算术双重校验。结构要求恰好一个 =、左侧一个不在首
 * 位的 + 或 -、两侧操作数为纯数字（数值上允许前导零）。
 * @param cells - 等式字元序列。
 * @returns parsed 结构是否合法；correct 结构合法且两侧数值相等。
 */
export function evaluateEquation(cells: string): { parsed: boolean, correct: boolean } {
  const eqIdx = cells.indexOf('=')
  if (eqIdx <= 0 || cells.indexOf('=', eqIdx + 1) !== -1) return { parsed: false, correct: false }
  const lhs = cells.slice(0, eqIdx)
  const rhs = cells.slice(eqIdx + 1)
  if (rhs.length === 0 || !/^[0-9]+$/.test(rhs)) return { parsed: false, correct: false }
  const opIdx = lhs.search(/[+-]/)
  if (opIdx <= 0 || lhs.slice(opIdx + 1).search(/[+-]/) !== -1) {
    return { parsed: false, correct: false }
  }
  const a = lhs.slice(0, opIdx)
  const b = lhs.slice(opIdx + 1)
  if (a.length === 0 || b.length === 0 || !/^[0-9]+$/.test(a) || !/^[0-9]+$/.test(b)) {
    return { parsed: false, correct: false }
  }
  const left = opIdx !== -1 && lhs[opIdx] === '-' ? Number(a) - Number(b) : Number(a) + Number(b)
  return { parsed: true, correct: left === Number(rhs) }
}

/**
 * 在某格补上一根火柴。
 * @param cells - 等式字元序列。
 * @param cell - 目标格下标。
 * @param seg - 目标段。
 * @returns 新字元序列；格越界、段已存在或补后字型非法时返回 null。
 */
export function addSeg(cells: string, cell: number, seg: Seg): string | null {
  if (cell < 0 || cell >= cells.length) return null
  const bits = glyphBits(cells[cell]!)
  if (bits === 0) return null
  const b = SEG_BIT[seg]
  if ((bits & b) !== 0) return null
  const ch = charFromBits(bits | b)
  if (ch === null) return null
  return cells.slice(0, cell) + ch + cells.slice(cell + 1)
}

/**
 * 从某格抽走一根火柴。
 * @param cells - 等式字元序列。
 * @param cell - 源格下标。
 * @param seg - 源段。
 * @returns 新字元序列；格越界、段不存在或抽后字型非法时返回 null。
 */
export function removeSeg(cells: string, cell: number, seg: Seg): string | null {
  if (cell < 0 || cell >= cells.length) return null
  const bits = glyphBits(cells[cell]!)
  if (bits === 0) return null
  const b = SEG_BIT[seg]
  if ((bits & b) === 0) return null
  const ch = charFromBits(bits & ~b)
  if (ch === null) return null
  return cells.slice(0, cell) + ch + cells.slice(cell + 1)
}

/**
 * 执行一次完整移动（先抽后补）：源段必须存在、目标段必须为空、两格
 * 变换后都必须仍是合法字型。
 * @param cells - 等式字元序列。
 * @param move - 移动描述。
 * @returns 新字元序列；任一校验不过返回 null。
 */
export function applyStickMove(cells: string, move: StickMove): string | null {
  const afterTake = removeSeg(cells, move.fromCell, move.fromSeg)
  if (afterTake === null) return null
  return addSeg(afterTake, move.toCell, move.toSeg)
}

/**
 * 随机生成一条成立的等式 a±b=c，各数位数不超过 maxDigits。
 * @param rng - 注入随机源。
 * @param maxDigits - 操作数最大位数。
 * @returns 等式字元序列；多轮重试失败返回 null。
 */
function randomEquation(rng: () => number, maxDigits: number): string | null {
  const max = Math.pow(10, maxDigits) - 1
  for (let i = 0; i < 200; i += 1) {
    const op = rng() < 0.5 ? '+' : '-'
    const a = 1 + Math.floor(rng() * max)
    const b = 1 + Math.floor(rng() * max)
    if (op === '-' && a < b) continue
    const c = op === '-' ? a - b : a + b
    if (c < 0 || c > max) continue
    return String(a) + op + String(b) + '=' + String(c)
  }
  return null
}

/** 枚举等式中每格可抽的段。 */
function allRemovals(cells: string): { cell: number, seg: Seg }[] {
  const out: { cell: number, seg: Seg }[] = []
  for (let i = 0; i < cells.length; i += 1) {
    for (const seg of removableSegs(cells[i]!)) out.push({ cell: i, seg })
  }
  return out
}

/** 枚举等式中每格可补的空位。 */
function allAdditions(cells: string): { cell: number, seg: Seg }[] {
  const out: { cell: number, seg: Seg }[] = []
  for (let i = 0; i < cells.length; i += 1) {
    for (const seg of addableSegs(cells[i]!)) out.push({ cell: i, seg })
  }
  return out
}

/** 结构合法且算术不成立的题面才是有效谜题。 */
function usablePuzzle(cells: string): boolean {
  const r = evaluateEquation(cells)
  return r.parsed && !r.correct
}

/**
 * 从一条成立的等式出发生成谜题：做一次扰动使其不成立，并记录原式
 * 还原动作作为保底解。
 * @param rng - 注入随机源。
 * @param maxDigits - 操作数最大位数。
 * @param variants - 是否允许 move/add/remove 三种修法（否则仅 move）。
 * @returns 谜题（含保底解）；生成失败时返回固定保底题（1-8=3，移一根
 * b 可还原 9-6=3），保证本函数永不抛错。
 */
export function generatePuzzle(rng: () => number, maxDigits: number, variants: boolean): MatchstickPuzzle {
  const fallback: MatchstickPuzzle = {
    cells: '3-8=3',
    fix: 'move',
    solution: { fix: 'move', move: { fromCell: 2, fromSeg: 'b', toCell: 0, toSeg: 'f' } },
  }
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const eq = randomEquation(rng, maxDigits)
    if (eq === null) continue
    const moves: { puzzle: MatchstickPuzzle }[] = []
    const adds: { puzzle: MatchstickPuzzle }[] = []
    const removes: { puzzle: MatchstickPuzzle }[] = []
    for (const rm of allRemovals(eq)) {
      const base = removeSeg(eq, rm.cell, rm.seg)
      if (base === null) continue
      // 扰动为「抽走一根」：补回原位即得原式（fix 'add'）。
      if (usablePuzzle(base)) {
        adds.push({ puzzle: { cells: base, fix: 'add', solution: { fix: 'add', cell: rm.cell, seg: rm.seg } } })
      }
      // 扰动为「移动一根」：抽出的段再补进某空位。
      for (const ad of allAdditions(base)) {
        if (ad.cell === rm.cell && ad.seg === rm.seg) continue
        const next = addSeg(base, ad.cell, ad.seg)
        if (next === null || !usablePuzzle(next)) continue
        moves.push({
          puzzle: {
            cells: next,
            fix: 'move',
            solution: { fix: 'move', move: { fromCell: ad.cell, fromSeg: ad.seg, toCell: rm.cell, toSeg: rm.seg } },
          },
        })
      }
    }
    // 扰动为「多塞一根」：抽走该段即得原式（fix 'remove'）。
    for (const ad of allAdditions(eq)) {
      const next = addSeg(eq, ad.cell, ad.seg)
      if (next === null || !usablePuzzle(next)) continue
      removes.push({
        puzzle: { cells: next, fix: 'remove', solution: { fix: 'remove', cell: ad.cell, seg: ad.seg } },
      })
    }
    let pool = moves
    if (variants) {
      const roll = rng()
      const first = roll < 0.4 ? moves : roll < 0.7 ? adds : removes
      const rest = roll < 0.4
        ? [adds, removes]
        : roll < 0.7 ? [moves, removes] : [moves, adds]
      pool = first.length > 0 ? first : rest.find(list => list.length > 0) ?? moves
    }
    if (pool.length > 0) return pool[Math.floor(rng() * pool.length)]!.puzzle
  }
  return fallback
}

/**
 * 生成整局：同一种子流一次铺好 5 关 x 5 题。
 * @param seed - 非负整数种子。
 * @returns 初始状态（第 1 关第 1 题已装填）。
 */
export function createMatchstick(seed: number): MatchstickState {
  const rng = mulberry32(seed)
  const puzzles: MatchstickPuzzle[][] = []
  for (let li = 0; li < LEVELS.length; li += 1) {
    const level: MatchstickPuzzle[] = []
    for (let pi = 0; pi < PUZZLES_PER_LEVEL; pi += 1) {
      level.push(generatePuzzle(rng, LEVELS[li]!.maxDigits, LEVELS[li]!.variants))
    }
    puzzles.push(level)
  }
  const state: MatchstickState = {
    seed,
    level: 0,
    puzzleIndex: 0,
    timeLeft: LEVELS[0]!.timeLimit,
    score: 0,
    status: 'playing',
    cells: puzzles[0]![0]!.cells,
    fix: puzzles[0]![0]!.fix,
    held: null,
    attempts: 0,
    solved: 0,
    failed: 0,
    puzzles,
  }
  return state
}

/** 当前关是否允许三种修法混用（含备用匣取火柴与抽走丢弃）。 */
export function variantLevel(state: MatchstickState): boolean {
  return LEVELS[Math.min(state.level, LEVELS.length - 1)]!.variants
}

/**
 * 从棋盘拿起一根火柴（再次点击同一根放回）。
 * @param state - 局状态。
 * @param cell - 格下标。
 * @param seg - 段名。
 * @returns 是否拿起（或切选）成功；题面无此段或当前修法不允许时 false。
 */
export function pickStick(state: MatchstickState, cell: number, seg: Seg): boolean {
  if (state.status !== 'playing') return false
  if (!variantLevel(state) && state.fix === 'add') return false
  if (cell < 0 || cell >= state.cells.length) return false
  if ((glyphBits(state.cells[cell]!) & SEG_BIT[seg]) === 0) return false
  if (state.held !== null && state.held.from === 'board' && state.held.cell === cell && state.held.seg === seg) {
    state.held = null
    return true
  }
  state.held = { from: 'board', cell, seg }
  return true
}

/**
 * 从备用匣取一根新火柴（变体关或本题修法为「补一根」时可用）。
 * @param state - 局状态。
 * @returns 是否取起成功。
 */
export function grabReserve(state: MatchstickState): boolean {
  if (state.status !== 'playing') return false
  if (state.held !== null) return false
  if (!variantLevel(state) && state.fix !== 'add') return false
  state.held = { from: 'reserve' }
  return true
}

/**
 * 放下手中火柴（不改变题面）——U 键撤回拿起。
 * @param state - 局状态。
 */
export function putDownHeld(state: MatchstickState): void {
  state.held = null
}

/**
 * 把手中火柴放到某空位。放置后立即判定：等式成立则记分解题并推进，
 * 不成立则题面自动还原（保持「只动一根」的纯度），试错数加一。
 * @param state - 局状态。
 * @param cell - 目标格下标。
 * @param seg - 目标段。
 * @returns 'solved' 解出并推进；'returned' 点回原位放回；'wrong' 不
 * 成立已还原；'illegal' 此处不可放；'none' 手上没有火柴。
 */
export function placeStick(state: MatchstickState, cell: number, seg: Seg): 'solved' | 'returned' | 'wrong' | 'illegal' | 'none' {
  const held = state.held
  if (held === null || state.status !== 'playing') return 'none'
  let next: string | null
  if (held.from === 'reserve') {
    next = addSeg(state.cells, cell, seg)
  } else {
    if (held.cell === cell && held.seg === seg) {
      state.held = null
      return 'returned'
    }
    next = applyStickMove(state.cells, { fromCell: held.cell, fromSeg: held.seg, toCell: cell, toSeg: seg })
  }
  if (next === null) return 'illegal'
  state.held = null
  if (evaluateEquation(next).correct) {
    state.score += SOLVE_BASE_SCORE + Math.ceil(state.timeLeft)
    state.solved += 1
    advance(state)
    return 'solved'
  }
  state.attempts += 1
  return 'wrong'
}

/**
 * 把手中火柴丢进备用匣（从题面移除）——变体关「抽一根」修法。
 * @param state - 局状态。
 * @returns 判定结果，语义同 {@link placeStick}（'illegal' 为手上是备用
 * 匣新火柴，无事可丢）。
 */
export function discardStick(state: MatchstickState): 'solved' | 'wrong' | 'illegal' | 'none' {
  const held = state.held
  if (held === null || state.status !== 'playing') return 'none'
  if (held.from !== 'board') return 'illegal'
  const next = removeSeg(state.cells, held.cell, held.seg)
  if (next === null) return 'illegal'
  state.held = null
  if (evaluateEquation(next).correct) {
    state.score += SOLVE_BASE_SCORE + Math.ceil(state.timeLeft)
    state.solved += 1
    advance(state)
    return 'solved'
  }
  state.attempts += 1
  return 'wrong'
}

/** 推进到下一题（或下一关 / 结束），并重置计时与本题状态。 */
function advance(state: MatchstickState): void {
  state.held = null
  state.attempts = 0
  state.puzzleIndex += 1
  if (state.puzzleIndex >= PUZZLES_PER_LEVEL) {
    state.level += 1
    state.puzzleIndex = 0
    if (state.level >= LEVELS.length) {
      state.status = 'won'
      return
    }
  }
  loadPuzzle(state)
}

/** 把 puzzles[level][puzzleIndex] 装填进当前题面并重置计时。 */
function loadPuzzle(state: MatchstickState): void {
  const p = state.puzzles[state.level]![state.puzzleIndex]!
  state.cells = p.cells
  state.fix = p.fix
  state.timeLeft = LEVELS[state.level]!.timeLimit
}

/**
 * 计时推进（由宿主每帧驱动）。
 * @param state - 局状态。
 * @param dt - 实际经过秒数（正数）。
 * @returns 'timeout' 本题超时（已自动换题并计 failed）；'ok' 正常。
 */
export function tickMatchstick(state: MatchstickState, dt: number): 'timeout' | 'ok' {
  if (state.status !== 'playing') return 'ok'
  state.timeLeft = Math.max(0, state.timeLeft - dt)
  if (state.timeLeft <= 0) {
    state.failed += 1
    advance(state)
    return 'timeout'
  }
  return 'ok'
}
