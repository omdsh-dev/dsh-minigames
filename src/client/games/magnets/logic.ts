/**
 * 磁极谜题（Magnets，Nikoli）纯逻辑：矩形盘面被划分为若干双格磁铁
 * 多米诺与少量单格绝缘块；每块磁铁必为一端 +、一端 -，同极 orth 相邻
 * 禁止，每行 / 列的 + 与 - 数量须与四周提示完全一致。生成器基于注入
 * seed 的 mulberry32：随机多米诺划分 → 随机化回溯搜一组合法极性 →
 * 推导行列提示 → 带剪枝的计数求解器验证唯一解（数到 2 即剪枝）。
 * 全部函数确定性可测，无 DOM、无随机外泄。
 */

/** 玩家标注：0 空、1 正极、2 负极、3 中性（绝缘推测）。 */
export type Mark = 0 | 1 | 2 | 3
export const EMPTY = 0
export const PLUS = 1
export const MINUS = 2
export const NEUTRAL = 3

/** 关卡总数（尺寸 6×6 → 10×10 递进）。 */
export const LEVEL_COUNT = 5

/** 一道生成完毕的谜题；solution 为唯一解（1 正 / 2 负，绝缘块 0）。 */
export interface MagnetsPuzzle {
  size: number
  /** 同一多米诺的另一半格；绝缘块为 -1。 */
  partner: number[]
  /** 固定单格绝缘块（不可交互、无极性）。 */
  insulator: boolean[]
  rowPlus: number[]
  rowMinus: number[]
  colPlus: number[]
  colMinus: number[]
  solution: number[]
}

/** 注入式确定性随机源（mulberry32）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 洗牌（Fisher–Yates，用注入 rng）。 */
function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

/** 关卡（1 起）对应的盘面边长。 */
export function levelSize(level: number): number {
  const sizes = [6, 7, 8, 9, 10]
  return sizes[level - 1] ?? 6
}

/** cell 的上下左右邻居（界内）。 */
export function orthNeighbors(size: number, cell: number): number[] {
  const r = Math.floor(cell / size)
  const c = cell % size
  const out: number[] = []
  if (r > 0) out.push(cell - size)
  if (r < size - 1) out.push(cell + size)
  if (c > 0) out.push(cell - 1)
  if (c < size - 1) out.push(cell + 1)
  return out
}

/** 多米诺划分结果：partner 对 + 绝缘块标记。 */
export interface Tiling {
  partner: number[]
  insulator: boolean[]
}

/**
 * 随机划分盘面：未分配格随机与一个未分配邻居配对，或按概率成为单格
 * 绝缘块（无邻居可配时也落绝缘）。
 * @param rng - 注入随机源。
 * @param size - 盘面边长。
 * @param insulatorChance - 单格绝缘概率（0-1）。
 */
export function dominoTiling(rng: () => number, size: number, insulatorChance: number): Tiling {
  const n = size * size
  const partner = new Array<number>(n).fill(-1)
  const insulator = new Array<boolean>(n).fill(false)
  const free = (cell: number): boolean => partner[cell] === -1 && !insulator[cell]
  const order = shuffle(Array.from({ length: n }, (_, i) => i), rng)
  for (const cell of order) {
    if (!free(cell)) continue
    const options = orthNeighbors(size, cell).filter(free)
    if (options.length === 0 || rng() < insulatorChance) {
      insulator[cell] = true
      continue
    }
    const pick = options[Math.floor(rng() * options.length)]!
    partner[cell] = pick
    partner[pick] = cell
  }
  return { partner, insulator }
}

/** 盘面上的磁铁多米诺列表（每项 [a, b]，a < b，行优先序）。 */
export function dominoesOf(partner: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (let a = 0; a < partner.length; a += 1) {
    const b = partner[a]!
    if (b > a) out.push([a, b])
  }
  return out
}

/** 极性数组：0 无极（绝缘 / 未置），1 正，2 负。 */
type Poles = number[]

/** cell 置为 pole 是否与已置邻居同极冲突。 */
function poleConflicts(size: number, poles: Poles, cell: number, pole: number): boolean {
  for (const nb of orthNeighbors(size, cell)) {
    if (poles[nb] !== 0 && poles[nb] === pole) return true
  }
  return false
}

/**
 * 随机化回溯为全部多米诺找一组合法极性（同极不相邻）；找不到返回
 * null。选项顺序与多米诺顺序均由 rng 搅动，保证同盘面可重复采样。
 */
export function assignPolarity(rng: () => number, size: number, partner: readonly number[]): Poles | null {
  const dominoes = shuffle(dominoesOf(partner).slice(), rng)
  const poles: Poles = new Array<number>(size * size).fill(0)
  const dfs = (k: number): boolean => {
    if (k === dominoes.length) return true
    const [a, b] = dominoes[k]!
    const first: [number, number] = rng() < 0.5 ? [PLUS, MINUS] : [MINUS, PLUS]
    const second: [number, number] = first[0] === PLUS ? [MINUS, PLUS] : [PLUS, MINUS]
    for (const [pa, pb] of [first, second]) {
      if (poleConflicts(size, poles, a, pa) || poleConflicts(size, poles, b, pb)) continue
      poles[a] = pa
      poles[b] = pb
      if (dfs(k + 1)) return true
      poles[a] = 0
      poles[b] = 0
    }
    return false
  }
  return dfs(0) ? poles : null
}

/** 由极性布局推导每行 / 列的 +、- 提示数。 */
function deriveClues(size: number, poles: Poles): Pick<MagnetsPuzzle, 'rowPlus' | 'rowMinus' | 'colPlus' | 'colMinus'> {
  const rowPlus = new Array<number>(size).fill(0)
  const rowMinus = new Array<number>(size).fill(0)
  const colPlus = new Array<number>(size).fill(0)
  const colMinus = new Array<number>(size).fill(0)
  for (let cell = 0; cell < size * size; cell += 1) {
    const r = Math.floor(cell / size)
    const c = cell % size
    if (poles[cell] === PLUS) { rowPlus[r]! += 1; colPlus[c]! += 1 }
    else if (poles[cell] === MINUS) { rowMinus[r]! += 1; colMinus[c]! += 1 }
  }
  return { rowPlus, rowMinus, colPlus, colMinus }
}

/** 解计数结果：solutions 为找到的解数（上限 limit 提前停时 exhausted 为 false）。 */
export interface SolveCount {
  solutions: number
  exhausted: boolean
}

/**
 * 计数求解器：多米诺两格必为一正一负，同极 orth 相邻剪枝，行列 +/-
 * 计数上界剪枝；数到 limit 个解即提前返回。
 */
export function solveCount(puzzle: MagnetsPuzzle, limit: number): SolveCount {
  const size = puzzle.size
  const n = size * size
  const dominoes = dominoesOf(puzzle.partner)
  const poles: Poles = new Array<number>(n).fill(0)
  const rowPlusUsed = new Array<number>(size).fill(0)
  const rowMinusUsed = new Array<number>(size).fill(0)
  const colPlusUsed = new Array<number>(size).fill(0)
  const colMinusUsed = new Array<number>(size).fill(0)
  const rowPlaced = new Array<number>(size).fill(0)
  const colPlaced = new Array<number>(size).fill(0)
  const rowTotal = new Array<number>(size).fill(0)
  const colTotal = new Array<number>(size).fill(0)
  for (let cell = 0; cell < n; cell += 1) {
    if (puzzle.insulator[cell]) continue
    rowTotal[Math.floor(cell / size)]! += 1
    colTotal[cell % size]! += 1
  }
  let solutions = 0
  let exhausted = true
  const dfs = (k: number): void => {
    if (solutions >= limit) { exhausted = false; return }
    if (k === dominoes.length) { solutions += 1; return }
    const [a, b] = dominoes[k]!
    const ra = Math.floor(a / size); const ca = a % size
    const rb = Math.floor(b / size); const cb = b % size
    const options: [number, number][] = [[PLUS, MINUS], [MINUS, PLUS]]
    for (const [pa, pb] of options) {
      if (poleConflicts(size, poles, a, pa) || poleConflicts(size, poles, b, pb)) continue
      const rpu = rowPlusUsed, rmu = rowMinusUsed, cpu = colPlusUsed, cmu = colMinusUsed
      if (pa === PLUS) { rpu[ra]! += 1; rmu[rb]! += 1; cpu[ca]! += 1; cmu[cb]! += 1 }
      else { rmu[ra]! += 1; rpu[rb]! += 1; cmu[ca]! += 1; cpu[cb]! += 1 }
      rowPlaced[ra]! += 1; rowPlaced[rb]! += 1
      colPlaced[ca]! += 1; colPlaced[cb]! += 1
      // 行列计数剪枝：超出提示，或剩余磁格全放也不够。
      let bad = false
      for (let r = 0; r < size && !bad; r += 1) {
        const remain = rowTotal[r]! - rowPlaced[r]!
        if (rpu[r]! > puzzle.rowPlus[r]! || rmu[r]! > puzzle.rowMinus[r]!
          || rpu[r]! + remain < puzzle.rowPlus[r]! || rmu[r]! + remain < puzzle.rowMinus[r]!) bad = true
      }
      for (let c = 0; c < size && !bad; c += 1) {
        const remain = colTotal[c]! - colPlaced[c]!
        if (cpu[c]! > puzzle.colPlus[c]! || cmu[c]! > puzzle.colMinus[c]!
          || cpu[c]! + remain < puzzle.colPlus[c]! || cmu[c]! + remain < puzzle.colMinus[c]!) bad = true
      }
      poles[a] = pa; poles[b] = pb
      if (!bad) dfs(k + 1)
      poles[a] = 0; poles[b] = 0
      if (pa === PLUS) { rpu[ra]! -= 1; rmu[rb]! -= 1; cpu[ca]! -= 1; cmu[cb]! -= 1 }
      else { rmu[ra]! -= 1; rpu[rb]! -= 1; cmu[ca]! -= 1; cpu[cb]! -= 1 }
      rowPlaced[ra]! -= 1; rowPlaced[rb]! -= 1
      colPlaced[ca]! -= 1; colPlaced[cb]! -= 1
    }
  }
  dfs(0)
  return { solutions, exhausted }
}

/**
 * 从 seed 生成一道唯一解谜题：反复采样划分与极性，直到解计数恰为 1；
 * 300 次尝试后放弃（返回 null）。
 * @param seed - 注入种子（同一 seed 完全可复现）。
 * @param size - 盘面边长（6-10）。
 * @param insulatorChance - 单格绝缘概率，默认 0.12。
 */
export function puzzleFromSeed(seed: number, size: number, insulatorChance = 0.12): MagnetsPuzzle | null {
  const rng = mulberry32(seed)
  let tiling = dominoTiling(rng, size, insulatorChance)
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (attempt % 25 === 0 && attempt > 0) tiling = dominoTiling(rng, size, insulatorChance)
    const poles = assignPolarity(rng, size, tiling.partner)
    if (poles === null) continue
    const puzzle: MagnetsPuzzle = {
      size,
      partner: tiling.partner.slice(),
      insulator: tiling.insulator.slice(),
      ...deriveClues(size, poles),
      solution: poles,
    }
    if (solveCount(puzzle, 2).solutions === 1) return puzzle
  }
  return null
}

/** 点击循环：空 → + → - → 中性 → 空。 */
export function cycleMark(mark: Mark): Mark {
  return ((mark + 1) % 4) as Mark
}

/**
 * 点击一格（原位修改 marks）：绝缘块不可交互返回 null，否则返回新标注。
 */
export function applyClick(puzzle: MagnetsPuzzle, marks: number[], cell: number): Mark | null {
  if (cell < 0 || cell >= puzzle.size * puzzle.size) return null
  if (puzzle.insulator[cell]!) return null
  marks[cell] = cycleMark(marks[cell] as Mark)
  return marks[cell] as Mark
}

/** 行列 + / - 计数（按玩家标注）。 */
export function countsOf(puzzle: MagnetsPuzzle, marks: readonly number[]): {
  rowPlus: number[]; rowMinus: number[]; colPlus: number[]; colMinus: number[]
} {
  const size = puzzle.size
  const out = {
    rowPlus: new Array<number>(size).fill(0),
    rowMinus: new Array<number>(size).fill(0),
    colPlus: new Array<number>(size).fill(0),
    colMinus: new Array<number>(size).fill(0),
  }
  for (let cell = 0; cell < size * size; cell += 1) {
    if (puzzle.insulator[cell]!) continue
    const r = Math.floor(cell / size)
    const c = cell % size
    if (marks[cell] === PLUS) { out.rowPlus[r]! += 1; out.colPlus[c]! += 1 }
    else if (marks[cell] === MINUS) { out.rowMinus[r]! += 1; out.colMinus[c]! += 1 }
  }
  return out
}

/** 同极 orth 相邻的冲突格（去重升序）。 */
export function samePoleConflicts(puzzle: MagnetsPuzzle, marks: readonly number[]): number[] {
  const size = puzzle.size
  const bad = new Set<number>()
  for (let cell = 0; cell < size * size; cell += 1) {
    const m = marks[cell]
    if (m !== PLUS && m !== MINUS) continue
    for (const nb of orthNeighbors(size, cell)) {
      if (nb > cell && marks[nb] === m) { bad.add(cell); bad.add(nb) }
    }
  }
  return [...bad].sort((a, b) => a - b)
}

/** 行 / 列某极计数超标的磁格（提示红显反馈）。 */
export function overflowCells(puzzle: MagnetsPuzzle, marks: readonly number[]): number[] {
  const size = puzzle.size
  const counts = countsOf(puzzle, marks)
  const out: number[] = []
  for (let cell = 0; cell < size * size; cell += 1) {
    if (puzzle.insulator[cell]!) continue
    if (marks[cell] !== PLUS && marks[cell] !== MINUS) continue
    const r = Math.floor(cell / size)
    const c = cell % size
    if (marks[cell] === PLUS && (counts.rowPlus[r]! > puzzle.rowPlus[r]! || counts.colPlus[c]! > puzzle.colPlus[c]!)) out.push(cell)
    if (marks[cell] === MINUS && (counts.rowMinus[r]! > puzzle.rowMinus[r]! || counts.colMinus[c]! > puzzle.colMinus[c]!)) out.push(cell)
  }
  return out
}

/** 全部冲突格并集（同极相邻 + 计数超标），供渲染红框。 */
export function findConflictCells(puzzle: MagnetsPuzzle, marks: readonly number[]): number[] {
  return [...new Set([...samePoleConflicts(puzzle, marks), ...overflowCells(puzzle, marks)])].sort((a, b) => a - b)
}

/** 是否获胜：磁格全为 +/-、同极不相邻、行列计数精确吻合。 */
export function isWon(puzzle: MagnetsPuzzle, marks: readonly number[]): boolean {
  const size = puzzle.size
  for (let cell = 0; cell < size * size; cell += 1) {
    if (puzzle.insulator[cell]!) continue
    if (marks[cell] !== PLUS && marks[cell] !== MINUS) return false
  }
  if (samePoleConflicts(puzzle, marks).length > 0) return false
  const counts = countsOf(puzzle, marks)
  for (let i = 0; i < size; i += 1) {
    if (counts.rowPlus[i] !== puzzle.rowPlus[i] || counts.rowMinus[i] !== puzzle.rowMinus[i]
      || counts.colPlus[i] !== puzzle.colPlus[i] || counts.colMinus[i] !== puzzle.colMinus[i]) return false
  }
  return true
}

/**
 * 提示：返回第一个与唯一解不符的磁格下标（调用方据此置为解值），
 * 已全部符合时返回 -1。
 */
export function hintCell(puzzle: MagnetsPuzzle, marks: readonly number[]): number {
  for (let cell = 0; cell < puzzle.size * puzzle.size; cell += 1) {
    if (puzzle.insulator[cell]!) continue
    if (marks[cell] !== puzzle.solution[cell]) return cell
  }
  return -1
}

/**
 * 过关得分：基础分随关卡上升，时间（秒）与提示次数扣减，下限 100。
 */
export function computeScore(level: number, secs: number, hints: number): number {
  return Math.max(100, 300 + level * 200 - Math.floor(secs) - hints * 100)
}