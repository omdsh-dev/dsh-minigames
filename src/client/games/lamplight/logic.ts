/**
 * 「提灯人 Lamplight」纯逻辑：seed 程序化生成的网格小镇夜行解谜。
 * 玩家四向移动，随身油灯照亮周围（半径随灯油余量分档缩小）；
 * 走到路灯格即点亮，路灯永久照亮其周围 2 格，成为黑暗中的驿站。
 * 每走一步耗 1 格灯油，绿色油瓶格补给 +2；第 3 关起出现暗影——
 * 只在与玩家相邻（切比雪夫半径 1）时追击，接触会熄灭最近点亮的
 * 一盏路灯并退回出生点。所有随机（地形、路灯/油瓶/暗影落点、暗影
 * 游走）都来自注入 seed 的 mulberry32：同 seed + 同操作序列得到
 * 完全相同的局面，渲染层与单元测试都依赖这一确定性。
 */

/** 四向移动方向。 */
export type Dir = 'up' | 'down' | 'left' | 'right'

/** 对局状态：进行中 / 单关完成 / 全部通关 / 灯油耗尽失败。 */
export type GameStatus = 'playing' | 'levelClear' | 'allClear' | 'gameover'

/** 一盏路灯（坐标 + 是否已点亮）。 */
export interface Lamp {
  /** 列坐标。 */
  x: number
  /** 行坐标。 */
  y: number
  /** 是否已点亮（永久照亮周围 2 格）。 */
  lit: boolean
}

/** 一个油瓶补给格（取用后消失）。 */
export interface Bottle {
  x: number
  y: number
  /** 是否已被拾取。 */
  taken: boolean
}

/** 一只游荡暗影（接触玩家后退回出生点）。 */
export interface Shadow {
  /** 稳定自增 id（确定性遍历顺序）。 */
  id: number
  x: number
  y: number
  /** 出生点（接触后回到这里）。 */
  spawnX: number
  spawnY: number
}

/** 一关的完整局面（可变；由 movePlayer 推进）。 */
export interface LamplightState {
  /** 1 起的关卡号（1..LEVEL_COUNT）。 */
  level: number
  cols: number
  rows: number
  /** 行主序地形：1 = 建筑（不可走），0 = 街道。 */
  walls: Uint8Array
  /** 路灯数组。 */
  lamps: Lamp[]
  /** 油瓶数组。 */
  bottles: Bottle[]
  /** 暗影数组。 */
  shadows: Shadow[]
  player: { x: number; y: number }
  /** 剩余灯油（每步 -1，油瓶 +2；归零即失败）。 */
  oil: number
  /** 本关初始灯油（HUD 油量条分母）。 */
  oilStart: number
  /** 本关已走步数。 */
  moves: number
  /** 已点亮路灯的索引序列（末位是最近点亮的；暗影接触时熄灭它）。 */
  litOrder: number[]
  /** 行主序记忆掩码：曾被照亮过的格子保持 1（渲染层画暗色轮廓）。 */
  seen: Uint8Array
  status: GameStatus
  /** 注入的确定性随机源（暗影游走继续消耗）。 */
  rand: () => number
}

/** 每关配置：盘面尺寸、路灯数、油瓶数、初始灯油、暗影数。 */
export interface LevelConfig {
  cols: number
  rows: number
  lamps: number
  bottles: number
  oil: number
  shadows: number
}

/** 总关数。 */
export const LEVEL_COUNT = 5

/** 路灯永久照明半径（格，欧氏距离）。 */
export const LAMP_LIT_RADIUS = 2

/** 玩家初始油灯半径（格，欧氏距离）。 */
export const FULL_LAMP_RADIUS = 2.5

/** 每走一步消耗的灯油。 */
export const MOVE_OIL_COST = 1

/** 每个油瓶补给的灯油。 */
export const BOTTLE_OIL = 2

/** 暗影的追击感知半径（切比雪夫距离，格）。 */
export const SHADOW_SENSE = 1

/** 建筑生成密度（0..1）。 */
const WALL_DENSITY = 0.16

/** 生成重试上限（可达性不满足就换一张地形）。 */
const GEN_ATTEMPTS = 40

/** 关卡递进表：镇更大 / 路灯更多 / 油更紧 / 后期加入暗影。 */
const LEVELS: LevelConfig[] = [
  { cols: 11, rows: 9, lamps: 4, bottles: 2, oil: 12, shadows: 0 },
  { cols: 13, rows: 11, lamps: 5, bottles: 2, oil: 13, shadows: 0 },
  { cols: 15, rows: 13, lamps: 6, bottles: 3, oil: 14, shadows: 1 },
  { cols: 17, rows: 13, lamps: 7, bottles: 3, oil: 15, shadows: 1 },
  { cols: 19, rows: 15, lamps: 8, bottles: 4, oil: 16, shadows: 2 },
]

/**
 * 取某关的配置（level 超界时钳到 1..LEVEL_COUNT）。
 * @param level 1 起的关卡号。
 * @returns 该关的尺寸与数量配置。
 */
export function levelConfig(level: number): LevelConfig {
  const clamped = Math.min(Math.max(level, 1), LEVEL_COUNT)
  return LEVELS[clamped - 1]!
}

/** Mulberry32：注入 seed 的确定性 32 位 PRNG。 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 油灯当前照明半径：油量分档缩圈。
 * 油量 ≥8 → 2.5 格；≥5 → 2；≥3 → 1.5；≥1 → 1；0 → 熄灭。
 * @param oil 剩余灯油。
 * @returns 当前半径（格）。
 */
export function lampRadius(oil: number): number {
  if (oil >= 8) return 2.5
  if (oil >= 5) return 2
  if (oil >= 3) return 1.5
  if (oil >= 1) return 1
  return 0
}

/** 格是否为建筑（不可走）。越界视为建筑。 */
export function isWall(state: LamplightState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return true
  return state.walls[y * state.cols + x] === 1
}

/**
 * 格子当前是否被照亮：在玩家油灯半径内，或在任一已点亮路灯的
 * LAMP_LIT_RADIUS 半径内（欧氏距离平方比较）。
 * @param state 当前局面。
 * @param x 列坐标。
 * @param y 行坐标。
 * @returns true 表示该格处于光照中。
 */
export function isLit(state: LamplightState, x: number, y: number): boolean {
  const r = lampRadius(state.oil)
  const pdx = x - state.player.x
  const pdy = y - state.player.y
  if (pdx * pdx + pdy * pdy <= r * r) return true
  const litR2 = LAMP_LIT_RADIUS * LAMP_LIT_RADIUS
  for (const lamp of state.lamps) {
    if (!lamp.lit) continue
    const dx = x - lamp.x
    const dy = y - lamp.y
    if (dx * dx + dy * dy <= litR2) return true
  }
  return false
}

/** 用当前光照刷新记忆掩码（照到过的格子永久记入 seen）。 */
function refreshSeen(state: LamplightState): void {
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (state.seen[y * state.cols + x] === 1) continue
      if (isLit(state, x, y)) state.seen[y * state.cols + x] = 1
    }
  }
}

/** 从起点做 BFS，返回每格步数（不可达为 -1）；建筑不入队。 */
function bfsDist(state: { cols: number; rows: number; walls: Uint8Array }, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(state.cols * state.rows).fill(-1)
  if (state.walls[sy * state.cols + sx] === 1) return dist
  dist[sy * state.cols + sx] = 0
  const queue: number[] = [sy * state.cols + sx]
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head]!
    const cx = cur % state.cols
    const cy = (cur - cx) / state.cols
    const d = dist[cur]! + 1
    // 四向邻居：内联展开避免数组分配。
    const next = [cx + 1 + cy * state.cols, cx - 1 + cy * state.cols, cx + (cy + 1) * state.cols, cx + (cy - 1) * state.cols]
    const pass = [cx + 1 < state.cols, cx - 1 >= 0, cy + 1 < state.rows, cy - 1 >= 0]
    for (let i = 0; i < 4; i += 1) {
      if (!pass[i]!) continue
      const n = next[i]!
      if (state.walls[n] === 1 || dist[n] !== -1) continue
      dist[n] = d
      queue.push(n)
    }
  }
  return dist
}

/**
 * 生成某一关的小镇：建筑、路灯、油瓶、暗影全部由 seed 决定。
 * 生成后保证：起点到每盏路灯、每个油瓶、每只暗影 BFS 可达；
 * 路灯两两曼哈顿距离 ≥ 4（足够分散）；暗影离起点 BFS ≥ 6 步。
 * 重试 GEN_ATTEMPTS 次仍不满足则清空建筑兜底（必可达）。
 * @param seed 确定性 RNG 种子（同 seed 同 level → 同小镇）。
 * @param level 1 起的关卡号（决定递进配置）。
 * @returns 初始局面（status 恒为 playing）。
 */
/** 广度优先距离场（沿可走街道，四向）。 */
function bfsField(walls: Uint8Array, cols: number, rows: number, from: { x: number; y: number }): Int32Array {
  const dist = new Int32Array(cols * rows).fill(-1)
  const queue: number[] = [from.y * cols + from.x]
  dist[from.y * cols + from.x] = 0
  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi]!
    const d = dist[cur]! ?? 0
    const x = cur % cols
    const y = Math.floor(cur / cols)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const ni = ny * cols + nx
      if (walls[ni] === 1 || dist[ni] !== -1) continue
      dist[ni] = d + 1
      queue.push(ni)
    }
  }
  return dist
}

/**
 * 贪心路线步数：从起点出发，每步走到「最近的未点亮路灯」，直到全部走完。
 * 真实最优巡回的可行上界（贪心 ≥ 最优），作油量预算下界。
 * @param walls - 行主序地形。
 * @param cols - 列数。
 * @param rows - 行数。
 * @param start - 玩家起点。
 * @param lamps - 路灯数组。
 * @returns 贪心路线总步数（有灯不可达时返回 Infinity）。
 */
function greedyRouteSteps(walls: Uint8Array, cols: number, rows: number, start: { x: number; y: number }, lamps: Lamp[]): number {
  let cur = start
  let total = 0
  const remaining = lamps.map((l) => ({ x: l.x, y: l.y }))
  while (remaining.length > 0) {
    const field = bfsField(walls, cols, rows, cur)
    let bestIdx = -1
    let bestD = Infinity
    for (let k = 0; k < remaining.length; k += 1) {
      const d = field[remaining[k]!.y * cols + remaining[k]!.x] ?? -1
      if (d === -1) continue
      if (d < bestD) { bestD = d; bestIdx = k }
    }
    if (bestIdx === -1) return Infinity
    total += bestD
    cur = remaining[bestIdx]!
    remaining.splice(bestIdx, 1)
  }
  return total
}

export function generateTown(seed: number, level: number): LamplightState {
  const cfg = levelConfig(level)
  const n = cfg.cols * cfg.rows
  const rand = rng((seed ^ Math.imul(level, 0x9e3779b1)) >>> 0)
  let walls = new Uint8Array(n)
  let start = { x: 0, y: 0 }
  let lamps: Lamp[] = []
  let bottles: Bottle[] = []
  let shadows: Shadow[] = []

  const pickStreet = (): { x: number; y: number } | null => {
    for (let i = 0; i < 200; i += 1) {
      const idx = Math.floor(rand() * n)
      if (walls[idx] === 0) return { x: idx % cfg.cols, y: Math.floor(idx / cfg.cols) }
    }
    for (let i = 0; i < n; i += 1) {
      if (walls[i] === 0) return { x: i % cfg.cols, y: Math.floor(i / cfg.cols) }
    }
    return null
  }

  for (let attempt = 0; attempt <= GEN_ATTEMPTS; attempt += 1) {
    const last = attempt === GEN_ATTEMPTS
    walls = new Uint8Array(n)
    if (!last) {
      for (let i = 0; i < n; i += 1) walls[i] = rand() < WALL_DENSITY ? 1 : 0
    } // 兜底：全街道。
    const s = pickStreet()
    if (s === null) continue
    start = s

    // 路灯：街道格、避开起点、两两曼哈顿距离 ≥ 4。
    lamps = []
    let lampOk = true
    for (let i = 0; i < cfg.lamps; i += 1) {
      let placed = false
      for (let t = 0; t < 300 && !placed; t += 1) {
        const p = pickStreet()
        if (p === null) continue
        if (p.x === start.x && p.y === start.y) continue
        let far = true
        for (const l of lamps) {
          if (Math.abs(l.x - p.x) + Math.abs(l.y - p.y) < 4) { far = false; break }
        }
        if (!far) continue
        lamps.push({ x: p.x, y: p.y, lit: false })
        placed = true
      }
      if (!placed) { lampOk = false; break }
    }
    if (!lampOk) continue

    // 油瓶：街道格、避开起点与路灯、离起点曼哈顿 ≥ 3。
    bottles = []
    let bottleOk = true
    for (let i = 0; i < cfg.bottles; i += 1) {
      let placed = false
      for (let t = 0; t < 300 && !placed; t += 1) {
        const p = pickStreet()
        if (p === null) continue
        if (p.x === start.x && p.y === start.y) continue
        if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 3) continue
        let clash = false
        for (const l of lamps) {
          if (l.x === p.x && l.y === p.y) { clash = true; break }
        }
        for (const b of bottles) {
          if (b.x === p.x && b.y === p.y) { clash = true; break }
        }
        if (clash) continue
        bottles.push({ x: p.x, y: p.y, taken: false })
        placed = true
      }
      if (!placed) { bottleOk = false; break }
    }
    if (!bottleOk) continue

    // 可达性：起点到所有路灯、油瓶 BFS 可达。
    const dist = bfsDist({ cols: cfg.cols, rows: cfg.rows, walls }, start.x, start.y)
    let reach = true
    for (const l of lamps) {
      if (dist[l.y * cfg.cols + l.x]! < 0) { reach = false; break }
    }
    if (reach) {
      for (const b of bottles) {
        if (dist[b.y * cfg.cols + b.x]! < 0) { reach = false; break }
      }
    }
    if (!reach) continue

    // 暗影：街道格、避开起点/路灯/油瓶、BFS 距起点 ≥ 6。
    shadows = []
    let shadowOk = true
    for (let i = 0; i < cfg.shadows; i += 1) {
      let placed = false
      for (let t = 0; t < 300 && !placed; t += 1) {
        const p = pickStreet()
        if (p === null) continue
        if (dist[p.y * cfg.cols + p.x]! < 6) continue
        let clash = p.x === start.x && p.y === start.y
        if (!clash) {
          for (const l of lamps) { if (l.x === p.x && l.y === p.y) { clash = true; break } }
        }
        if (!clash) {
          for (const b of bottles) { if (b.x === p.x && b.y === p.y) { clash = true; break } }
        }
        if (clash) continue
        shadows.push({ id: i, x: p.x, y: p.y, spawnX: p.x, spawnY: p.y })
        placed = true
      }
      if (!placed) { shadowOk = false; break }
    }
    if (!shadowOk && !last) continue
    if (!shadowOk) shadows = []
    break // 满足全部约束：采用这张地形。
  }

  // 油量按可玩性动态定：从起点贪心最近灯逐盏走完整条路线所需步数为
  // 下界，加 6 步余量（油瓶另算奖励）——固定值 12/16 在大镇上数学不可赢
  // （实测 4 盏灯路线 25-30 步）。
  const oilBudget = Math.max(cfg.oil, greedyRouteSteps(walls, cfg.cols, cfg.rows, start, lamps) + 6)
  const state: LamplightState = {
    level,
    cols: cfg.cols,
    rows: cfg.rows,
    walls,
    lamps,
    bottles,
    shadows,
    player: { x: start.x, y: start.y },
    oil: oilBudget,
    oilStart: oilBudget,
    moves: 0,
    litOrder: [],
    seen: new Uint8Array(n),
    status: 'playing',
    rand,
  }
  refreshSeen(state)
  return state
}

/**
 * 玩家朝 dir 走一步（若可行）。一次成功移动依次结算：
 * 移动并耗 1 油 → 拾取脚下油瓶（+2）→ 点亮脚下路灯 → 全亮判胜 →
 * 油尽判负 → 暗影各走一步（相邻追击 / 否则随机游走）→ 接触惩罚
 * （熄灭最近点亮的路灯，暗影退回出生点）→ 刷新记忆。
 * @param state 当前局面（就地修改）。
 * @param dir 移动方向。
 * @returns 是否实际移动（撞墙/越界/非进行中返回 false，不耗油）。
 */
export function movePlayer(state: LamplightState, dir: Dir): boolean {
  if (state.status !== 'playing') return false
  const delta: Record<Dir, [number, number]> = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  }
  const [dx, dy] = delta[dir]
  const nx = state.player.x + dx
  const ny = state.player.y + dy
  if (isWall(state, nx, ny)) return false

  state.player.x = nx
  state.player.y = ny
  state.moves += 1
  state.oil -= MOVE_OIL_COST

  for (const bottle of state.bottles) {
    if (!bottle.taken && bottle.x === nx && bottle.y === ny) {
      bottle.taken = true
      state.oil += BOTTLE_OIL
    }
  }

  for (let i = 0; i < state.lamps.length; i += 1) {
    const lamp = state.lamps[i]!
    if (!lamp.lit && lamp.x === nx && lamp.y === ny) {
      lamp.lit = true
      state.litOrder.push(i)
    }
  }

  // 全部点亮即过关（第 5 关为整场通关）。
  if (state.litOrder.length === state.lamps.length) {
    state.status = state.level >= LEVEL_COUNT ? 'allClear' : 'levelClear'
    refreshSeen(state)
    return true
  }

  // 灯油耗尽：失败。
  if (state.oil <= 0) {
    state.status = 'gameover'
    refreshSeen(state)
    return true
  }

  // 暗影阶段：按 id 顺序各走一步。
  for (const shadow of state.shadows) {
    stepShadow(state, shadow)
    if (shadow.x === state.player.x && shadow.y === state.player.y) {
      shadowHit(state, shadow)
    }
  }

  refreshSeen(state)
  return true
}

/** 暗影走一步：与玩家切比雪夫距离 ≤ SHADOW_SENSE 时追击（优先跨距更大的轴），否则随机游走。 */
function stepShadow(state: LamplightState, shadow: Shadow): void {
  const dx = state.player.x - shadow.x
  const dy = state.player.y - shadow.y
  let sx = 0
  let sy = 0
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= SHADOW_SENSE) {
    // 追击：先走跨距更大的轴，被建筑挡住再换轴。
    if (Math.abs(dx) >= Math.abs(dy)) {
      sx = Math.sign(dx)
      sy = Math.abs(dy) > 0 ? Math.sign(dy) : 0
    } else {
      sy = Math.sign(dy)
      sx = Math.abs(dx) > 0 ? Math.sign(dx) : 0
    }
    if (sx !== 0 && !isWall(state, shadow.x + sx, shadow.y)) shadow.x += sx
    else if (sy !== 0 && !isWall(state, shadow.x, shadow.y + sy)) shadow.y += sy
    return
  }
  // 游走：seed 随机选一向，被挡则原地不动。
  const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]
  const d = dirs[Math.floor(state.rand() * 4)]!
  if (!isWall(state, shadow.x + d[0], shadow.y + d[1])) {
    shadow.x += d[0]
    shadow.y += d[1]
  }
}

/** 接触惩罚：熄灭最近点亮的一盏路灯，暗影退回出生点。 */
function shadowHit(state: LamplightState, shadow: Shadow): void {
  const last = state.litOrder.pop()
  if (last !== undefined) {
    state.lamps[last]!.lit = false
  }
  shadow.x = shadow.spawnX
  shadow.y = shadow.spawnY
}
