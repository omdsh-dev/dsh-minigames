/**
 * 解绳谜题 Planarity 纯逻辑：按注入的 mulberry32 种子确定性地生成 5 个
 * 关卡——每关先把 n 个顶点放在圆周上做理想无交叉布局（外圈多边形 + 随机
 * 三角剖分的部分弦，凸布局下数学上保证平面），再把顶点位置随机打乱成
 * 一团乱麻（保证打乱后至少存在一对交叉边）。玩家拖动顶点，任意两条不
 * 共端点的边不得交叉；全部边无交叉即过关。提供线段相交判定（端点豁免）、
 * 交叉边集合 / 计数、拖拽（含步数统计与边界钳制）、过关判定与计分。
 * 无 DOM、无副作用，全部函数可直接在 vitest 中验证。
 */

/** 平面点。 */
export interface Pt {
  x: number
  y: number
}

/** 无向边：顶点下标对（a < b）。 */
export interface Edge {
  a: number
  b: number
}

/** 游戏阶段：进行中 / 本关过关 / 全部通关。 */
export type PlanarityPhase = 'playing' | 'won' | 'allwon'

/** 一局的完整状态（纯数据，可 JSON 序列化）。 */
export interface PlanarityState {
  /** 本局基础种子（重开 / 下一关均由它派生，保证可重放）。 */
  baseSeed: number
  /** 当前关下标（0 起）。 */
  levelIndex: number
  /** 当前顶点位置（玩家可见、可拖动）。 */
  vertices: Pt[]
  /** 理想布局（生成时无交叉的参考解，仅渲染层过关动画使用）。 */
  solution: Pt[]
  /** 边集合。 */
  edges: Edge[]
  /** 拖拽中顶点下标，-1 表示未拖拽。 */
  dragIndex: number
  /** 本次拖拽是否已实际位移（决定是否计步）。 */
  dragMoved: boolean
  /** 已完成的拖拽次数（步数，越少分越高）。 */
  moves: number
  /** 本关累计用时（毫秒，仅 playing 阶段累加）。 */
  timeMs: number
  /** 当前阶段。 */
  phase: PlanarityPhase
  /** 进入本关前的银行分（R 重开本关时恢复）。 */
  bankedScore: number
  /** 本关过关结算分（未过关为 0）。 */
  levelScore: number
}

/** 逻辑画布尺寸（与渲染层约定一致）。 */
export const W = 720
export const H = 520
/** 基础关数（无尽模式里程碑；HUD 显示用）。 */
export const LEVEL_COUNT = 5
/** 无尽模式标记。 */
export const ENDLESS = true as const
/** 每关顶点数：前 5 关 6 → 10；无尽模式逐关 +1 封顶 14（保持可拖密度）。 */
export const LEVEL_VERTICES = [6, 7, 8, 9, 10] as const
export function levelVertices(levelIndex: number): number {
  return levelIndex < LEVEL_VERTICES.length ? LEVEL_VERTICES[levelIndex]! : Math.min(14, 10 + Math.floor((levelIndex - 4) / 2))
}
/** 顶点可拖动区域（留出 HUD 与说明按钮边距）。 */
export const BOARD = { minX: 46, maxX: W - 46, minY: 74, maxY: H - 58 } as const

/** 浮点符号容差（叉积 / 投影判定用）。 */
const EPS = 1e-9

/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致（种子注入，确定性可测）。
 * @param seed - 非负 32 位种子。
 * @returns 返回随机数的函数。
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

/** 叉积 orient(p, q, r) = (q-p) × (r-p)。 */
function orient(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px)
}

/** 点 p 是否落在线段 ab 上（含端点，带容差；调用前需共线）。 */
function onSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const loX = Math.min(ax, bx) - EPS
  const hiX = Math.max(ax, bx) + EPS
  const loY = Math.min(ay, by) - EPS
  const hiY = Math.max(ay, by) + EPS
  return px >= loX && px <= hiX && py >= loY && py <= hiY
}

/** 两点是否重合（端点豁免判定用）。 */
function samePoint(p: Pt, q: Pt): boolean {
  return Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS
}

/**
 * 线段相交判定（端点豁免）：两条线段共享任一端点直接判不交叉（共端
 * 邻边在平面图中合法）；端点落在另一线段内部（T 触）与共线重叠均判
 * 交叉。"共享端点不算交叉" 是本游戏的规则核心。
 * @param a1 - 线段一端点。
 * @param a2 - 线段另一端点。
 * @param b1 - 线段二端点。
 * @param b2 - 线段二另一端点。
 * @returns true 表示两线段交叉（需要拆开）。 */
export function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  // 端点豁免：共享端点的邻接边不算交叉。
  if (samePoint(a1, b1) || samePoint(a1, b2) || samePoint(a2, b1) || samePoint(a2, b2)) {
    return false
  }
  const d1 = orient(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y)
  const d2 = orient(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y)
  const d3 = orient(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y)
  const d4 = orient(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y)
  // 规范相交：两侧严格异号。
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    return true
  }
  // 共线重叠：四叉积均为 0 且包围盒交叠。
  if (Math.abs(d1) < EPS && Math.abs(d2) < EPS && Math.abs(d3) < EPS && Math.abs(d4) < EPS) {
    return onSegment(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y) || onSegment(a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)
      || onSegment(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y) || onSegment(b2.x, b2.y, a1.x, a1.y, a2.x, a2.y)
  }
  // T 触：一端点恰好落在另一线段上（非端点处）也算交叉。
  if (Math.abs(d1) < EPS && onSegment(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y)) return true
  if (Math.abs(d2) < EPS && onSegment(a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) return true
  if (Math.abs(d3) < EPS && onSegment(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y)) return true
  if (Math.abs(d4) < EPS && onSegment(b2.x, b2.y, a1.x, a1.y, a2.x, a2.y)) return true
  return false
}

/**
 * 交叉边集合：遍历所有不共端点的边对做线段相交判定。
 * @param vertices - 顶点位置。
 * @param edges - 边集合。
 * @returns 交叉边的下标集合。 */
export function crossingEdgeSet(vertices: Pt[], edges: Edge[]): Set<number> {
  const bad = new Set<number>()
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const e1 = edges[i]!
      const e2 = edges[j]!
      if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue
      if (segmentsCross(vertices[e1.a]!, vertices[e1.b]!, vertices[e2.a]!, vertices[e2.b]!)) {
        bad.add(i)
        bad.add(j)
      }
    }
  }
  return bad
}

/**
 * 交叉边对数（HUD 展示值：还有几对边缠在一起）。
 * @param vertices - 顶点位置。
 * @param edges - 边集合。
 * @returns 交叉边对数。 */
export function countCrossings(vertices: Pt[], edges: Edge[]): number {
  let n = 0
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const e1 = edges[i]!
      const e2 = edges[j]!
      if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue
      if (segmentsCross(vertices[e1.a]!, vertices[e1.b]!, vertices[e2.a]!, vertices[e2.b]!)) n += 1
    }
  }
  return n
}

/** 圆周理想布局：n 个顶点等角分布在圆上。 */
function circleLayout(n: number, cx: number, cy: number, r: number, rot: number): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n; i += 1) {
    const ang = rot + (i / n) * Math.PI * 2
    pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r })
  }
  return pts
}

/**
 * 凸多边形随机三角剖分（递归加弦，凸布局下弦互不交叉）：返回候选弦
 * 列表，外圈边不在此列。
 * @param rng - 注入随机源。
 * @param n - 顶点数。
 * @returns 候选弦（下标对，a < b）。 */
function triangulate(rng: () => number, n: number): Edge[] {
  const chords: Edge[] = []
  const rec = (a: number, b: number): void => {
    if (b - a < 2) return
    const k = a + 1 + Math.floor(rng() * (b - a - 1))
    if (k - a >= 2) chords.push({ a, b: k })
    if (b - k >= 2) chords.push({ a: k, b })
    rec(a, k)
    rec(k, b)
  }
  rec(0, n - 1)
  return chords
}

/** Fisher-Yates 洗牌。 */
function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]!
    arr[i] = arr[j]!
    arr[j] = t
  }
  return arr
}

/**
 * 生成一关：先在圆周理想布局上构造平面图（外圈 + 部分三角剖分弦），
 * 再把顶点位置打乱（带最小间距的拒绝采样，保证可拖可点）。
 * @param seed - 本关种子。
 * @param levelIndex - 关卡下标（0 起，决定顶点数与边密度）。
 * @returns 顶点 / 参考解 / 边。 */
export function generatePlanarityLevel(seed: number, levelIndex: number): { vertices: Pt[]; solution: Pt[]; edges: Edge[] } {
  const n = levelVertices(levelIndex)
  const rng = mulberry32(Math.floor(seed) >>> 0)
  // 理想布局：圆心取盘面中心，半径收进可拖区域。
  const cx = (BOARD.minX + BOARD.maxX) / 2
  const cy = (BOARD.minY + BOARD.maxY) / 2
  const r = Math.min(BOARD.maxX - BOARD.minX, BOARD.maxY - BOARD.minY) / 2 - 10
  const solution = circleLayout(n, cx, cy, r, rng() * Math.PI * 2)
  // 外圈边 + 三角剖分弦（按关卡密度保留一部分）。
  const edges: Edge[] = []
  for (let i = 0; i < n; i += 1) edges.push({ a: i, b: (i + 1) % n })
  const chords = shuffle(rng, triangulate(rng, n))
  const keep = Math.max(2, Math.round((n - 3) * Math.min(0.95, 0.45 + 0.14 * levelIndex)))
  for (let i = 0; i < Math.min(keep, chords.length); i += 1) edges.push(chords[i]!)
  edges.sort((p, q) => p.a - q.a || p.b - q.b)
  // 打乱顶点位置：拒绝采样保证最小间距；整体重试保证开局必有交叉。
  let vertices: Pt[] = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const cand: Pt[] = []
    let minDist = 62
    for (let i = 0; i < n; i += 1) {
      let placed = false
      for (let tries = 0; tries < 160 && !placed; tries += 1) {
        if (tries === 40 || tries === 100) minDist *= 0.85
        const x = BOARD.minX + rng() * (BOARD.maxX - BOARD.minX)
        const y = BOARD.minY + rng() * (BOARD.maxY - BOARD.minY)
        let ok = true
        for (const q of cand) {
          if (Math.hypot(q.x - x, q.y - y) < minDist) { ok = false; break }
        }
        if (ok) { cand.push({ x, y }); placed = true }
      }
      if (!placed) cand.push({ x: BOARD.minX + rng() * (BOARD.maxX - BOARD.minX), y: BOARD.minY + rng() * (BOARD.maxY - BOARD.minY) })
    }
    vertices = cand
    if (countCrossings(vertices, edges) > 0) break
  }
  return { vertices, solution, edges }
}

/**
 * 创建一关状态（第 0 关或重开 / 派生种子进下一关均走这里）。
 * @param baseSeed - 本局基础种子。
 * @param levelIndex - 关卡下标（0 起）。
 * @param bankedScore - 进入本关前的银行分。
 * @returns 初始状态。 */
export function createPlanarity(baseSeed: number, levelIndex: number, bankedScore = 0): PlanarityState {
  const seed = (Math.floor(baseSeed) + levelIndex * 1013904223) >>> 0
  const { vertices, solution, edges } = generatePlanarityLevel(seed, levelIndex)
  return {
    baseSeed: Math.floor(baseSeed) >>> 0,
    levelIndex,
    vertices,
    solution,
    edges,
    dragIndex: -1,
    dragMoved: false,
    moves: 0,
    timeMs: 0,
    phase: 'playing',
    bankedScore,
    levelScore: 0,
  }
}

/** 把坐标钳制进可拖动区域。 */
function clampToBoard(p: Pt): Pt {
  return {
    x: Math.min(BOARD.maxX, Math.max(BOARD.minX, p.x)),
    y: Math.min(BOARD.maxY, Math.max(BOARD.minY, p.y)),
  }
}

/**
 * 过关结算：基础分 + 关卡递增 + 少步奖励 + 限时奖励。
 * @param state - 过关瞬间的状态。
 * @returns 本关得分。 */
function settleScore(state: PlanarityState): number {
  const timeBonus = Math.max(0, 120 - Math.floor(state.timeMs / 1000)) * 2
  const moveBonus = Math.max(0, state.edges.length * 2 - state.moves) * 6
  return 60 + state.levelIndex * 30 + moveBonus + timeBonus
}

/**
 * 检查是否全部边无交叉；是则结算得分并推进阶段（不自动进下一关——
 * 由渲染层做完归位动画后调用 {@link nextLevel}）。
 * @param state - 状态（就地更新）。
 * @returns true 表示本关刚刚过关。 */
export function checkWin(state: PlanarityState): boolean {
  if (state.phase !== 'playing') return false
  if (countCrossings(state.vertices, state.edges) > 0) return false
  if (state.dragIndex >= 0 && !state.dragMoved) return false
  state.levelScore = settleScore(state)
  // 无尽模式：每关过关都进下一关（levelIndex 无上限，难度由 levelVertices 封顶）。
  state.phase = 'won'
  return true
}

/**
 * 开始拖拽某顶点。
 * @param state - 状态（就地更新）。
 * @param index - 顶点下标。 */
export function startDrag(state: PlanarityState, index: number): void {
  if (state.phase !== 'playing') return
  if (index < 0 || index >= state.vertices.length) return
  state.dragIndex = index
  state.dragMoved = false
}

/**
 * 拖拽中移动顶点（钳制进盘面；本次拖拽首次有效位移计 1 步；落定后
 * 实时复查过关）。仅记一次拖拽为一步，微动（< 0.5px）不计。
 * @param state - 状态（就地更新）。
 * @param p - 指针逻辑坐标。 */
export function dragTo(state: PlanarityState, p: Pt): void {
  if (state.phase !== 'playing' || state.dragIndex < 0) return
  const target = clampToBoard(p)
  const cur = state.vertices[state.dragIndex]!
  if (Math.hypot(target.x - cur.x, target.y - cur.y) < 0.5) return
  if (!state.dragMoved) {
    state.dragMoved = true
    state.moves += 1
  }
  state.vertices[state.dragIndex] = target
  checkWin(state)
}

/**
 * 结束拖拽（松开指针；过关判定已在 {@link dragTo} 内实时完成）。
 * @param state - 状态（就地更新）。 */
export function endDrag(state: PlanarityState): void {
  state.dragIndex = -1
  state.dragMoved = false
}

/**
 * 进入下一关（最后一关调用返回原状态不变）。
 * @param state - 当前状态。
 * @returns 下一关新状态。 */
export function nextLevel(state: PlanarityState): PlanarityState {
  return createPlanarity(state.baseSeed, state.levelIndex + 1, state.bankedScore + state.levelScore)
}

/**
 * 累计用时（仅 playing 阶段；帮助面板打开时由调用方暂停计时）。
 * @param state - 状态（就地更新）。
 * @param dtMs - 帧间隔毫秒。 */
export function tickTime(state: PlanarityState, dtMs: number): void {
  if (state.phase !== 'playing') return
  state.timeMs = Math.min(600000, state.timeMs + Math.max(0, dtMs))
}

/**
 * 当前总分（银行分 + 本关已结算分）。
 * @param state - 当前状态。
 * @returns 总分。 */
export function totalScore(state: PlanarityState): number {
  return state.bankedScore + state.levelScore
}