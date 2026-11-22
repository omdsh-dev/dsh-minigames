/**
 * 对称补全 Symmetry 纯逻辑：按注入的 mulberry32 种子确定性地生成 5 个
 * 关卡——每关是一串回合（拼图回合：左半图形 + 对称轴 + 打乱的构件盘；
 * 变体回合：给定整个图形问有几条对称轴的选择题）。提供反射变换、构件
 * 匹配判定（类型 + 镜像位置，网格吸附即半格容差）、过关判定与计分。
 * 无 DOM、无副作用，全部函数可直接在 vitest 中验证。
 */

/** 构件类型：实心块 / 线段 / 圆弧（L 形足迹，绘制为四分之一弧）。 */
export type PieceKind = 'block' | 'line' | 'arc'

/** 网格坐标：列 x、行 y，均从 0 起。 */
export interface Cell {
  x: number
  y: number
}

/** 一个构件：类型 + 覆盖的网格单元集合（单元互不重复）。 */
export interface Piece {
  kind: PieceKind
  cells: Cell[]
}

/** 对称轴方向：竖直 / 水平 / 主对角线 y=x / 副对角线 x+y=grid-1。 */
export type AxisKind = 'v' | 'h' | 'd1' | 'd2'

/** 拼图回合：把 palette 中的构件逐一放到缺失的一半，补出 targets。 */
export interface PlaceRound {
  type: 'place'
  grid: number
  axis: AxisKind
  /** 玩家侧已给定的构件（含落在轴上、镜像后不变的自对称构件）。 */
  given: Piece[]
  /** 缺失一侧需要补出的镜像构件（与 given 中非轴构件一一对应）。 */
  targets: Piece[]
  /** targets 打乱后的构件盘顺序（长度等于 targets）。 */
  palette: Piece[]
}

/** 选择题回合：给定整个图形，问它有几条（4 条候选轴内的）对称轴。 */
export interface QuizRound {
  type: 'quiz'
  grid: number
  figure: Cell[]
  /** 恒为 [0,1,2,4] 的某种乱序。 */
  options: number[]
  /** options 中正确答案的下标。 */
  answer: number
}

/** 一关内的一个回合。 */
export type Round = PlaceRound | QuizRound

/** 每关限时（秒）。 */
export const LEVEL_SECONDS = 240
/** 总关卡数。 */
export const LEVEL_COUNT = 5

/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供生成与测试复放使用。
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
 * 求一个单元关于指定轴的镜像单元。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长（奇数，轴穿过中心行/列或对角线）。
 * @param cell - 原单元。
 * @returns 镜像单元。
 */
export function reflectCell(axis: AxisKind, grid: number, cell: Cell): Cell {
  switch (axis) {
    case 'v': return { x: grid - 1 - cell.x, y: cell.y }
    case 'h': return { x: cell.x, y: grid - 1 - cell.y }
    case 'd1': return { x: cell.y, y: cell.x }
    case 'd2': return { x: grid - 1 - cell.y, y: grid - 1 - cell.x }
  }
}

/**
 * 单元集合按 (y,x) 字典序排序的规范副本（相等判定的基础）。
 * @param cells - 原单元集合。
 * @returns 排序后的新数组。
 */
export function sortCells(cells: Cell[]): Cell[] {
  return cells.map((c) => ({ x: c.x, y: c.y })).sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * 两个单元集合是否含有完全相同的单元（与顺序无关）。
 * @param a - 集合一。
 * @param b - 集合二。
 * @returns 相同返回 true。
 */
export function sameCells(a: Cell[], b: Cell[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false
  }
  return true
}

/**
 * 构件的镜像构件（类型不变，单元集合映射后重新排序）。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长。
 * @param piece - 原构件。
 * @returns 镜像构件。
 */
export function mirrorPiece(axis: AxisKind, grid: number, piece: Piece): Piece {
  return { kind: piece.kind, cells: sortCells(piece.cells.map((c) => reflectCell(axis, grid, c))) }
}

/**
 * 两个构件是否类型相同且覆盖单元完全一致（顺序无关）。
 * @param a - 构件一。
 * @param b - 构件二。
 * @returns 一致返回 true。
 */
export function pieceEquals(a: Piece, b: Piece): boolean {
  return a.kind === b.kind && sameCells(sortCells(a.cells), sortCells(b.cells))
}

/**
 * 构件是否自对称（镜像后与自身重合，即"轴上构件"）。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长。
 * @param piece - 待测构件。
 * @returns 自对称返回 true。
 */
export function isSelfSymmetric(axis: AxisKind, grid: number, piece: Piece): boolean {
  return pieceEquals(mirrorPiece(axis, grid, piece), piece)
}

/**
 * 单元相对轴的位置：-1 给定侧 / 0 轴上 / +1 缺失侧。四种轴都以网格
 * 中心为轴：v 取中心列，h 取中心行，d1/d2 取两条对角线。
 * @param axis - 对称轴方向。
 * @param grid - 网格边长。
 * @param cell - 待测单元。
 * @returns -1、0 或 +1。
 */
export function sideOf(axis: AxisKind, grid: number, cell: Cell): number {
  switch (axis) {
    case 'v': return Math.sign(cell.x - (grid - 1) / 2)
    case 'h': return Math.sign(cell.y - (grid - 1) / 2)
    case 'd1': return Math.sign(cell.y - cell.x)
    case 'd2': return Math.sign(cell.x + cell.y - (grid - 1))
  }
}

/** 构件形状模板（相对单元偏移，内部使用）。 */
interface ShapeTemplate {
  kind: PieceKind
  cells: Cell[]
  arcs: boolean
}

function cell(x: number, y: number): Cell {
  return { x, y }
}

/** 全部形状模板：实心块 2 种、线段 4 种、圆弧（L 形足迹）4 种。 */
const SHAPES: ShapeTemplate[] = [
  { kind: 'block', cells: [cell(0, 0)], arcs: false },
  { kind: 'block', cells: [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)], arcs: false },
  { kind: 'line', cells: [cell(0, 0), cell(1, 0)], arcs: false },
  { kind: 'line', cells: [cell(0, 0), cell(0, 1)], arcs: false },
  { kind: 'line', cells: [cell(0, 0), cell(1, 0), cell(2, 0)], arcs: false },
  { kind: 'line', cells: [cell(0, 0), cell(0, 1), cell(0, 2)], arcs: false },
  { kind: 'arc', cells: [cell(0, 0), cell(1, 0), cell(0, 1)], arcs: true },
  { kind: 'arc', cells: [cell(0, 0), cell(1, 0), cell(1, 1)], arcs: true },
  { kind: 'arc', cells: [cell(0, 0), cell(0, 1), cell(1, 1)], arcs: true },
  { kind: 'arc', cells: [cell(0, 1), cell(1, 0), cell(1, 1)], arcs: true },
]

function cellKey(c: Cell): string {
  return c.x + ',' + c.y
}

function pieceAt(t: ShapeTemplate, ax: number, ay: number): Piece {
  return { kind: t.kind, cells: sortCells(t.cells.map((c) => cell(ax + c.x, ay + c.y))) }
}

function inGrid(grid: number, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < grid && c.y < grid
}

function pieceSide(axis: AxisKind, grid: number, piece: Piece): number {
  let side = 0
  for (const c of piece.cells) {
    const s = sideOf(axis, grid, c)
    if (s !== 0) return s
  }
  return side
}

/**
 * 生成一个拼图回合：先随机放一个轴上自对称构件（保证"轴上构件已给"），
 * 再在给定侧生成 count 个普通构件，其镜像即为目标构件；palette 为其
 * 打乱副本。
 * @param rng - 注入的随机数发生器。
 * @param grid - 网格边长（奇数）。
 * @param axis - 对称轴方向。
 * @param count - 需要玩家补全的构件数。
 * @param allowArcs - 是否允许圆弧构件（前两关不含弧）。
 * @returns 拼图回合。
 */
export function buildPlaceRound(
  rng: () => number,
  grid: number,
  axis: AxisKind,
  count: number,
  allowArcs: boolean,
): PlaceRound {
  const given: Piece[] = []
  const targets: Piece[] = []
  const used = new Set<string>()

  const tryAdd = (piece: Piece): boolean => {
    for (const c of piece.cells) {
      if (!inGrid(grid, c) || used.has(cellKey(c))) return false
    }
    for (const c of piece.cells) used.add(cellKey(c))
    return true
  }

  const pool = SHAPES.filter((s) => allowArcs || !s.arcs)

  // 轴上自对称构件：多次尝试，兜底为轴心单格块。
  let axisGuard = 0
  for (;;) {
    const t = pool[Math.floor(rng() * pool.length)]!
    const piece = pieceAt(t, Math.floor(rng() * grid), Math.floor(rng() * grid))
    if (tryAdd(piece) && isSelfSymmetric(axis, grid, piece)) {
      given.push(piece)
      break
    }
    axisGuard += 1
    if (axisGuard > 600) {
      const center = (grid - 1) / 2
      const piece2: Piece = { kind: 'block', cells: [cell(center, center)] }
      if (tryAdd(piece2)) given.push(piece2)
      break
    }
  }

  // 给定侧普通构件：镜像自动落在缺失侧。
  let guard = 0
  while (targets.length < count && guard < 6000) {
    guard += 1
    const t = pool[Math.floor(rng() * pool.length)]!
    const piece = pieceAt(t, Math.floor(rng() * grid), Math.floor(rng() * grid))
    if (!tryAdd(piece)) continue
    const mirrored = mirrorPiece(axis, grid, piece)
    if (pieceEquals(mirrored, piece)) continue // 已被轴上构件逻辑负责
    // 普通构件必须严格整体落在给定侧（触轴/跨轴会与自身镜像重叠）。
    if (!piece.cells.every((c) => sideOf(axis, grid, c) === -1)) continue
    given.push(piece)
    targets.push(mirrored)
  }

  const palette = targets.slice()
  for (let i = palette.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = palette[i]!
    palette[i] = palette[j]!
    palette[j] = tmp
  }
  return { type: 'place', grid, axis, given, targets, palette }
}

/**
 * 枚举图形在四条候选轴（竖直/水平/两条对角线，均过网格中心）中真正的
 * 对称轴。
 * @param cells - 图形单元集合。
 * @param grid - 网格边长。
 * @returns 对称轴方向列表（子集，长度 0-4）。
 */
export function symmetryAxes(cells: Cell[], grid: number): AxisKind[] {
  const sorted = sortCells(cells)
  const axes: AxisKind[] = ['v', 'h', 'd1', 'd2']
  const result: AxisKind[] = []
  for (const axis of axes) {
    const mirrored = sortCells(sorted.map((c) => reflectCell(axis, grid, c)))
    if (sameCells(sorted, mirrored)) result.push(axis)
  }
  return result
}

/**
 * 生成一道对称轴计数选择题：图形按目标答案构造（4=中心正方形、2=中心
 * 非正方形矩形、1=随机半边镜像、0=随机散块），再以 symmetryAxes 校验
 * 实际数量一致，选项恒为 [0,1,2,4] 的乱序。
 * @param rng - 注入的随机数发生器。
 * @param grid - 网格边长（奇数）。
 * @returns 选择题回合。
 */
export function buildQuizRound(rng: () => number, grid: number): QuizRound {
  const center = (grid - 1) / 2
  const intents: number[] = [0, 1, 2, 4]
  const intent = intents[Math.floor(rng() * intents.length)]!
  let figure: Cell[] = []
  let guard = 0
  for (;;) {
    if (intent === 4) {
      figure = []
      for (let y = center - 2; y <= center + 2; y += 1) {
        for (let x = center - 2; x <= center + 2; x += 1) figure.push(cell(x, y))
      }
    } else if (intent === 2) {
      figure = []
      for (let y = center - 1; y <= center + 1; y += 1) {
        for (let x = center - 2; x <= center + 2; x += 1) figure.push(cell(x, y))
      }
    } else if (intent === 1) {
      const half = new Map<string, Cell>()
      const want = 4 + Math.floor(rng() * 3)
      let tries = 0
      while (half.size < want && tries < 60) {
        tries += 1
        const x = Math.floor(rng() * center)
        const y = Math.floor(rng() * grid)
        half.set(cellKey(cell(x, y)), cell(x, y))
      }
      figure = [...half.values()].flatMap((c) => [c, reflectCell('v', grid, c)])
    } else {
      const blob = new Map<string, Cell>()
      const want = 7 + Math.floor(rng() * 5)
      let tries = 0
      while (blob.size < want && tries < 80) {
        tries += 1
        const x = Math.floor(rng() * grid)
        const y = Math.floor(rng() * grid)
        blob.set(cellKey(cell(x, y)), cell(x, y))
      }
      figure = [...blob.values()]
    }
    guard += 1
    if (symmetryAxes(figure, grid).length === intent || guard > 200) break
  }
  const options = [0, 1, 2, 4]
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = options[i]!
    options[i] = options[j]!
    options[j] = tmp
  }
  return { type: 'quiz', grid, figure, options, answer: options.indexOf(intent) }
}

/** 关卡计划（内部使用）：网格、轴、构件数、是否含弧。 */
interface LevelStage {
  grid: number
  axis: AxisKind
  pieces: number
  arcs: boolean
  quiz: boolean
}

/** 5 关递进：竖轴→横轴→竖轴+弧→45° 主对角轴+选择题→副对角轴混合。 */
const LEVEL_PLAN: LevelStage[][] = [
  [{ grid: 7, axis: 'v', pieces: 5, arcs: false, quiz: false }],
  [{ grid: 7, axis: 'h', pieces: 6, arcs: true, quiz: false }],
  [{ grid: 9, axis: 'v', pieces: 8, arcs: true, quiz: false }],
  [
    { grid: 9, axis: 'd1', pieces: 7, arcs: true, quiz: true },
    { grid: 9, axis: 'v', pieces: 6, arcs: true, quiz: false },
  ],
  [
    { grid: 9, axis: 'd2', pieces: 8, arcs: true, quiz: false },
    { grid: 9, axis: 'd1', pieces: 7, arcs: true, quiz: true },
  ],
]

/** 各关的回合数（供 UI 与测试核对）。 */
export const LEVEL_PLAN_ROUNDS: number[] = LEVEL_PLAN.map((stages) => stages.length)

/**
 * 构造一关的全部回合；同一种子产出完全一致（可复放）。
 * @param level - 0 起的关卡下标（0-4）。
 * @param seed - 种子。
 * @returns 回合列表（至少 1 个）。
 */
export function buildLevel(level: number, seed: number): Round[] {
  const idx = Math.min(Math.max(level, 0), LEVEL_PLAN.length - 1)
  const rng = mulberry32((seed ^ Math.imul(idx + 1, 0x9e3779b9)) >>> 0)
  const rounds: Round[] = []
  for (const stage of LEVEL_PLAN[idx]!) {
    rounds.push(buildPlaceRound(rng, stage.grid, stage.axis, stage.pieces, stage.arcs))
    if (stage.quiz) rounds.push(buildQuizRound(rng, stage.grid))
  }
  return rounds
}

/**
 * 构件以 anchor 为新锚点（左上角对齐）平移后的覆盖单元。渲染层把指针
 * 坐标四舍五入到最近网格单元，即实现半格吸附容差。
 * @param piece - 待放置构件。
 * @param anchor - 放置锚点单元。
 * @returns 平移后的单元集合。
 */
export function placedCells(piece: Piece, anchor: Cell): Cell[] {
  const sorted = sortCells(piece.cells)
  const minX = sorted[0]!.x
  let minY = sorted[0]!.y
  for (const c of sorted) if (c.y < minY) minY = c.y
  return sorted.map((c) => cell(anchor.x + c.x - minX, anchor.y + c.y - minY))
}

/**
 * 判定一次放置：构件类型一致且覆盖单元与某个未占用目标的镜像单元完全
 * 重合即为正确，返回该目标下标。
 * @param round - 拼图回合。
 * @param piece - 玩家放置的构件。
 * @param anchor - 放置锚点。
 * @param claimed - 各目标是否已被正确补上。
 * @returns 匹配的目标下标，未匹配返回 -1。
 */
export function checkPlacement(round: PlaceRound, piece: Piece, anchor: Cell, claimed: boolean[]): number {
  const cells = sortCells(placedCells(piece, anchor))
  for (let i = 0; i < round.targets.length; i += 1) {
    if (claimed[i]) continue
    const target = round.targets[i]!
    if (target.kind !== piece.kind) continue
    if (sameCells(cells, sortCells(target.cells))) return i
  }
  return -1
}

/**
 * 拼图回合是否已全部补全。
 * @param round - 拼图回合。
 * @param claimed - 各目标占用状态。
 * @returns 全部目标已占用返回 true。
 */
export function isPlaceSolved(round: PlaceRound, claimed: boolean[]): boolean {
  return round.targets.every((_, i) => claimed[i] === true)
}

/**
 * 过关计分：基础分随关卡上升，剩时给奖励，每一步（含错误尝试）扣分，
 * 下限 100。
 * @param level - 1 起的关卡序号。
 * @param steps - 本关总步数。
 * @param seconds - 本关用时（秒）。
 * @returns 得分。
 */
export function computeScore(level: number, steps: number, seconds: number): number {
  const base = 380 + level * 120
  // 用时是浮点秒（帧累积），原样参与加减出现 671.6247… 这类尾差——取整。
  const timeBonus = Math.max(0, Math.round(240 - Math.max(0, seconds)))
  return Math.max(100, base + timeBonus - steps * 6)
}
