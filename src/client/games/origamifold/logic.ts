/**
 * 折纸成方 OrigamiFold 纯逻辑：N×N 彩纸沿网格线对折（上层盖下层），
 * 折成 1×1 且最上层颜色等于目标色即过关。折叠只允许「恰好对折」：
 * 折线两侧格数相等，或奇数尺寸差 1（多的一侧翻过去会伸出纸边，成为
 * 新的一列/行）。每次折后该方向尺寸减半（向上取整），因此从 N×N 折到
 * 1×1 的总次数是定值（双方各 f(N) 折）——胜负与难度全在「折哪一侧」：
 * 两侧选择决定谁的层叠在最上、最终露出什么颜色。
 *
 * 所有随机来自注入 seed 的 mulberry32；同一 (关卡, seed) 盘面与目标色
 * 完全一致，纯函数可测、可重放。关卡生成后用正向穷举（每关至多 4^6
 * 条折叠路径）验证目标色确实可达，并选「达成路径最少」的颜色作目标，
 * 保证可解且不平凡。
 */
/** 关卡数。 */
export const LEVEL_COUNT = 5

/** 关卡参数：纸边长与颜色种数。 */
export interface LevelConfig {
  /** 纸边长（N×N）。 */
  size: number
  /** 颜色种数（2-3）。 */
  colors: number
}

/** 五关：4×4 到 6×6，颜色 2 到 3。 */
export const LEVELS: readonly LevelConfig[] = [
  { size: 4, colors: 2 },
  { size: 4, colors: 2 },
  { size: 5, colors: 3 },
  { size: 5, colors: 3 },
  { size: 6, colors: 3 },
]

/** 一格的层叠（颜色 id，自底向上；末位=可见色）。 */
export type Stack = number[]

/** 对局状态（纯数据，可整体拷贝重放）。 */
export interface FoldState {
  /** 关卡号（0 起）。 */
  level: number
  /** 当前行数。 */
  rows: number
  /** 当前列数。 */
  cols: number
  /** cells[行][列] = 该位置的层叠（自底向上）。 */
  cells: Stack[][]
  /** 目标颜色 id（折成 1×1 后顶色须等于它）。 */
  target: number
  /** 已折叠次数。 */
  folds: number
  /** 最优（也是唯一可能）的总折叠次数。 */
  optimalFolds: number
  /** 累计得分（过关加成，跨关携带）。 */
  score: number
  /** 进行中 / 已过关（1×1 且顶色=目标）/ 已卡死（1×1 但顶色不符）。 */
  status: 'playing' | 'won' | 'lost'
}

/** 一次折叠：axis 'v'=竖折线（列合并）、'h'=横折线（行合并）；k=折线在第几条边界（0<k<n）；side 'a'=折线上侧/左侧翻折，'b'=下侧/右侧翻折。 */
export interface FoldMove {
  axis: 'h' | 'v'
  k: number
  side: 'a' | 'b'
}

/** 一维折叠几何：旧索引 -> 新索引的映射与新原点平移（格单位）。 */
export interface FoldGeometry {
  /** 折后该方向尺寸 = max(左, 右)。 */
  newSize: number
  /** 不动侧索引区间 [stationStart, stationEnd)。 */
  stationStart: number
  stationEnd: number
  /** 不动侧平移：新索引 = 旧索引 + stationShift。 */
  stationShift: number
  /** 翻折侧索引区间 [foldStart, foldEnd)。 */
  foldStart: number
  foldEnd: number
  /** 翻折侧：新索引 = (n-1-旧索引) + foldShift（镜像+平移）。 */
  foldShift: number
  /** 新原点 = 旧原点 + originShift 格（盘面重居中，渲染动画共用）。 */
  originShift: number
}

/**
 * mulberry32 确定性伪随机数发生器。
 * @param seed - 任意 32 位整数。
 * @returns 返回 [0, 1) 随机数的函数；同 seed 序列完全一致。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 某尺寸折到 1 需要的折数（每折减半向上取整：4→2→1 共 2 折）。
 * @param n - 方向格数。
 * @returns 最少（也是唯一可能的）折数。
 */
export function foldsTo1(n: number): number {
  let count = 0
  let size = n
  while (size > 1) {
    size = Math.ceil(size / 2)
    count += 1
  }
  return count
}

/**
 * 一维折叠几何：验证并计算折线 k、翻折侧 side 的映射。
 * 规则：0 < k < n 且 |k-(n-k)| <= 1（恰好对折；两侧之一为 0 不可折）。
 * @param n - 该方向格数。
 * @param k - 折线边界序号（0 < k < n）。
 * @param side - 翻折侧：'a'=索引小的一侧（上/左）翻折，'b'=索引大的一侧（下/右）。
 * @returns 折叠几何；不满足对折约束返回 null。
 */
export function foldGeometry(n: number, k: number, side: 'a' | 'b'): FoldGeometry | null {
  if (n < 2 || k <= 0 || k >= n) return null
  const left = k
  const right = n - k
  if (Math.abs(left - right) > 1) return null
  const newSize = Math.max(left, right)
  if (side === 'b') {
    // 下/右侧翻折盖到上/左侧：不动侧是 [0, k)，翻折侧 [k, n)。
    return {
      newSize,
      stationStart: 0,
      stationEnd: k,
      stationShift: Math.max(0, right - left),
      foldStart: k,
      foldEnd: n,
      foldShift: Math.max(0, left - right),
      originShift: (n - newSize) / 2 + Math.max(0, right - left),
    }
  }
  // 上/左侧翻折盖到下/右侧：不动侧是 [k, n)，翻折侧 [0, k)。
  return {
    newSize,
    stationStart: k,
    stationEnd: n,
    stationShift: -left,
    foldStart: 0,
    foldEnd: k,
    foldShift: -right,
    originShift: (n - newSize) / 2 - left,
  }
}

/**
 * 当前列出的全部合法折叠（每方向至多 2 条折线 × 2 个翻折侧）。
 * @param rows - 当前行数。
 * @param cols - 当前列数。
 * @returns 合法折叠列表（1×1 时为空）。
 */
export function listFolds(rows: number, cols: number): FoldMove[] {
  const out: FoldMove[] = []
  for (let k = 1; k < rows; k += 1) {
    if (Math.abs(2 * k - rows) <= 1) {
      out.push({ axis: 'h', k, side: 'a' })
      out.push({ axis: 'h', k, side: 'b' })
    }
  }
  for (let k = 1; k < cols; k += 1) {
    if (Math.abs(2 * k - cols) <= 1) {
      out.push({ axis: 'v', k, side: 'a' })
      out.push({ axis: 'v', k, side: 'b' })
    }
  }
  return out
}

/**
 * 执行一次折叠：翻折侧的层叠按映射盖到不动侧之上（本折内部保持
 * 自底向上顺序；后折的层永远在最上）。折成 1×1 时按顶色判胜负。
 * 纯函数：不修改入参，返回新状态。
 * @param state - 对局状态。
 * @param move - 折叠（非法或对局已结束时返回 null）。
 * @returns 折后的新状态；非法折叠返回 null。
 */
export function applyFold(state: FoldState, move: FoldMove): FoldState | null {
  if (state.status !== 'playing') return null
  const axisV = move.axis === 'v'
  const n = axisV ? state.cols : state.rows
  const geo = foldGeometry(n, move.k, move.side)
  if (geo === null) return null
  const newRows = axisV ? state.rows : geo.newSize
  const newCols = axisV ? geo.newSize : state.cols
  const cells: Stack[][] = []
  for (let r = 0; r < newRows; r += 1) {
    const row: Stack[] = []
    for (let c = 0; c < newCols; c += 1) row.push([])
    cells.push(row)
  }
  const put = (oldR: number, oldC: number, newR: number, newC: number): void => {
    const stack = state.cells[oldR]![oldC]!
    const target = cells[newR]![newC]!
    for (const color of stack) target.push(color)
  }
  // 先落不动侧（在底），再落翻折侧（在上）——后折上层。
  for (let r = 0; r < state.rows; r += 1) {
    for (let c = 0; c < state.cols; c += 1) {
      const index = axisV ? c : r
      if (index >= geo.stationStart && index < geo.stationEnd) {
        const shifted = index + geo.stationShift
        put(r, c, axisV ? r : shifted, axisV ? shifted : c)
      }
    }
  }
  for (let r = 0; r < state.rows; r += 1) {
    for (let c = 0; c < state.cols; c += 1) {
      const index = axisV ? c : r
      if (index >= geo.foldStart && index < geo.foldEnd) {
        const shifted = n - 1 - index + geo.foldShift
        put(r, c, axisV ? r : shifted, axisV ? shifted : c)
      }
    }
  }
  const next: FoldState = {
    ...state,
    rows: newRows,
    cols: newCols,
    cells,
    folds: state.folds + 1,
  }
  if (newRows === 1 && newCols === 1) {
    const top = cells[0]![0]![cells[0]![0]!.length - 1]!
    if (top === state.target) {
      next.status = 'won'
      next.score = state.score + 100 * (state.level + 1)
    } else {
      next.status = 'lost'
    }
  }
  return next
}

/**
 * 纸完全折成 1×1 时的可见（最上）颜色。
 * @param cells - 层叠网格。
 * @returns 顶格层叠末位颜色。
 */
export function visibleColor(cells: Stack[][]): number {
  const stack = cells[0]![0]!
  return stack[stack.length - 1]!
}

/**
 * 盘面中心格的可见颜色（HUD「当前」徽章用；非 1×1 时作提示）。
 * @param state - 对局状态。
 * @returns 中心格层叠末位颜色。
 */
export function centerTopColor(state: FoldState): number {
  const r = Math.floor(state.rows / 2)
  const c = Math.floor(state.cols / 2)
  const stack = state.cells[r]![c]!
  return stack[stack.length - 1]!
}

/** 轻量模拟节点（穷举用，不含计分）。 */
/**
 * 穷举全部折叠路径，统计每种最终顶色的达成路径数（正向可达验证）。
 * 路径数上界 4^folds（每步至多 4 种折叠），4×4 至 6×6 均为个位折数，
 * 直接深度优先即可。
 * @param cells - 初始层叠网格。
 * @param rows - 初始行数。
 * @param cols - 初始列数。
 * @returns 颜色 id -> 达成该颜色的完整折叠路径条数（至少 1 项）。
 */
export function enumerateOutcomes(cells: Stack[][], rows: number, cols: number): Map<number, number> {
  const counts = new Map<number, number>()
  const dfs = (node: FoldState): void => {
    if (node.rows === 1 && node.cols === 1) {
      const top = visibleColor(node.cells)
      counts.set(top, (counts.get(top) ?? 0) + 1)
      return
    }
    for (const move of listFolds(node.rows, node.cols)) {
      const next = applyFold(node, move)
      if (next === null) continue
      dfs(next)
    }
  }
  dfs({ level: 0, rows, cols, cells, target: -1, folds: 0, optimalFolds: 0, score: 0, status: 'playing' })
  return counts
}

/**
 * 求一条达成目标色的完整获胜路径（测试「N seed 全关可赢」用）。
 * @param state - 对局状态（target 已定）。
 * @returns 折叠序列，逐个 applyFold 后 status === 'won'；无解返回 null。
 */
export function findWinningPath(state: FoldState): FoldMove[] | null {
  const dfs = (node: FoldState): FoldMove[] | null => {
    if (node.status !== 'playing') return node.status === 'won' ? [] : null
    for (const move of listFolds(node.rows, node.cols)) {
      const next = applyFold(node, move)
      if (next === null) continue
      const rest = dfs(next)
      if (rest !== null) return [move, ...rest]
    }
    return null
  }
  return dfs({ ...state, status: 'playing' })
}

/**
 * 生成一关：seed 决定每格颜色；穷举全部折叠路径后，在可达颜色中选
 * 「达成路径最少」者作目标（路径数并列时按 seed 洗牌打破），保证目标
 * 必可达且不平凡。
 * @param level - 关卡号（0 起，越界返回 null）。
 * @param seed - 随机种子。
 * @param carryScore - 跨关携带的累计得分。
 * @returns 初始对局状态；level 越界返回 null。
 */
export function generateLevel(level: number, seed: number, carryScore = 0): FoldState | null {
  if (level < 0 || level >= LEVEL_COUNT) return null
  const cfg = LEVELS[level]!
  const rng = mulberry32((seed ^ Math.imul(level + 1, 0x9e3779b9)) >>> 0)
  const cells: Stack[][] = []
  for (let r = 0; r < cfg.size; r += 1) {
    const row: Stack[] = []
    for (let c = 0; c < cfg.size; c += 1) row.push([Math.floor(rng() * cfg.colors)])
    cells.push(row)
  }
  const outcomes = enumerateOutcomes(cells, cfg.size, cfg.size)
  // 可达颜色按路径数升序；并列随机洗牌（seed 决定，可重放）。
  const entries = [...outcomes.entries()]
  const shuffled = entries.map((entry) => ({ entry, key: rng() }))
  shuffled.sort((a, b) => a.key - b.key)
  const ordered = shuffled.map((s) => s.entry).sort((a, b) => a[1] - b[1])
  const target = ordered[0]![0]
  return {
    level,
    rows: cfg.size,
    cols: cfg.size,
    cells,
    target,
    folds: 0,
    optimalFolds: foldsTo1(cfg.size) * 2,
    score: carryScore,
    status: 'playing',
  }
}
