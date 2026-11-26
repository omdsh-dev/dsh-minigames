/**
 * 骨牌对对（DominoShuffle）纯逻辑：一排 8-14 张数字骨牌，只能交换
 * 相邻两张（部分关卡存在锁定骨牌，锁定槽位上的骨牌不可参与交换），
 * 目标是把整排排成左小右大的升序。生成器从有序目标出发、只在连续
 * 未锁定窗口内洗牌，因此局面永远可以在「初始逆序对数」次合法交换内
 * 复原；步数预算 = 初始逆序对数 + 关卡缓冲（第 5 关缓冲为 0，要求
 * 步步都消除一个逆序）。全部随机走注入 seed 的 mulberry32，同 seed
 * + 同输入脚本重放一致；逻辑层不接触 DOM。
 */

/** 逻辑画布宽（HUD 与全部元素包含在内）。 */
export const W = 640
/** 逻辑画布高。 */
export const H = 480

/** 盘面左右留白。 */
export const BOARD_MARGIN = 24
/** 骨牌行上沿 y。 */
export const BOARD_Y = 210
/** 单张骨牌高（竖长骨牌）。 */
export const TILE_H = 84
/** 相邻骨牌间隙。 */
export const TILE_GAP = 8
/** 骨牌宽上限（张数少时不至于过宽）。 */
export const MAX_TILE_W = 60

/** HUD 右下「说明」按钮矩形（渲染与点击命中共用）。 */
export const HELP_BTN = { x: W - 74, y: 34, w: 60, h: 24 } as const

/** 每关提示次数上限。 */
export const HINT_MAX = 3
/** 关卡总数。 */
export const LEVEL_COUNT = 5

/** 单关规格：骨牌张数、锁定张数、步数缓冲（超出逆序对数的余量）。 */
export interface DominoLevelSpec {
  count: number
  locks: number
  buffer: number
}

/** 五关递进：8→14 张、锁定 0→4 张、缓冲 3→0。 */
export const LEVELS: readonly DominoLevelSpec[] = [
  { count: 8, locks: 0, buffer: 3 },
  { count: 10, locks: 1, buffer: 2 },
  { count: 12, locks: 2, buffer: 2 },
  { count: 13, locks: 3, buffer: 1 },
  { count: 14, locks: 4, buffer: 0 },
] as const

/** 单步内产生、供渲染层消费的可视事件。 */
export type DominoEvent =
  | { type: 'swap'; i: number; j: number; x: number; y: number }
  | { type: 'lockedClick'; i: number; x: number; y: number }
  | { type: 'level'; level: number; x: number; y: number }
  | { type: 'win'; x: number; y: number }
  | { type: 'fail'; x: number; y: number }

/** 一局游戏的完整可测状态。 */
export interface DominoShuffleState {
  /** 当前关（1 起，最大 LEVEL_COUNT）。 */
  level: number
  /** 各槽位的骨牌值（1..n 的排列）。 */
  tiles: number[]
  /** 各槽位是否锁定（锁定槽上的骨牌不可交换）。 */
  locked: boolean[]
  /** 已用交换次数。 */
  moves: number
  /** 本关步数预算 = 初始逆序对数 + 缓冲。 */
  budget: number
  /** 当前逆序对数（剩余最少交换次数）。 */
  inversions: number
  /** 剩余提示次数。 */
  hintsLeft: number
  /** 当前选中的槽位（无则 null）。 */
  selected: number | null
  /** 提示高亮的相邻对 [左槽, 右槽]（下一次交换后清除）。 */
  hintPair: [number, number] | null
  /** 累计得分（跨关累加）。 */
  score: number
  /** 局面是否已结束（过关或步数用尽）。 */
  over: boolean
  /** over 时是否通关（第 5 关排完）。 */
  win: boolean
  /** 本局的确定性随机源。 */
  rng: () => number
  /** 供渲染层消费的事件（每次逻辑调用开头清空）。 */
  events: DominoEvent[]
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
 * 数组的逆序对数（相邻交换每次恰好改变 ±1，即剩余最少交换次数）。
 * @param tiles - 骨牌值数组。
 * @returns 逆序对个数。
 */
export function countInversions(tiles: readonly number[]): number {
  let inv = 0
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      if (tiles[i]! > tiles[j]!) inv += 1
    }
  }
  return inv
}

/**
 * 数组是否已排成升序。
 * @param tiles - 骨牌值数组。
 * @returns 升序返回 true。
 */
export function isSortedTiles(tiles: readonly number[]): boolean {
  for (let i = 1; i < tiles.length; i += 1) {
    if (tiles[i - 1]! > tiles[i]!) return false
  }
  return true
}

/**
 * n 张骨牌时单张宽度（随张数自适应，封顶 MAX_TILE_W）。
 * @param n - 骨牌张数。
 * @returns 单张骨牌宽。
 */
export function tileW(n: number): number {
  const avail = W - BOARD_MARGIN * 2 - (n - 1) * TILE_GAP
  return Math.min(MAX_TILE_W, Math.floor(avail / n))
}

/**
 * n 张骨牌时整行的左端 x（水平居中）。
 * @param n - 骨牌张数。
 * @returns 行首骨牌左上角 x。
 */
export function boardX(n: number): number {
  const total = n * tileW(n) + (n - 1) * TILE_GAP
  return (W - total) / 2
}

/**
 * 第 i 张骨牌的矩形（渲染与点击命中共用）。
 * @param i - 槽位索引（0 起）。
 * @param n - 骨牌张数。
 * @returns 该骨牌的左上角与宽高。
 */
export function tileRect(i: number, n: number): { x: number, y: number, w: number, h: number } {
  return { x: boardX(n) + i * (tileW(n) + TILE_GAP), y: BOARD_Y, w: tileW(n), h: TILE_H }
}

/**
 * 点击落在哪张骨牌上。
 * @param state - 目标状态。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 槽位索引，未命中返回 null。
 */
export function tileAt(state: DominoShuffleState, x: number, y: number): number | null {
  const n = state.tiles.length
  for (let i = 0; i < n; i += 1) {
    const r = tileRect(i, n)
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i
  }
  return null
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
 * 发牌：按当前关规格生成局面——先摆有序目标，随机选锁定槽（锁定
 * 骨牌保持目标值，天然已就位），再在每个连续未锁定窗口内独立洗牌，
 * 保证最优交换次数恰为逆序对数；若洗完恰好整体有序，则在首个可换
 * 相邻对上强制交换一次。
 * @param state - 目标状态（level 已就位）。
 */
function dealLevel(state: DominoShuffleState): void {
  const spec = LEVELS[state.level - 1]!
  const n = spec.count
  const tiles: number[] = []
  for (let i = 0; i < n; i += 1) tiles.push(i + 1)
  const locked: boolean[] = new Array<boolean>(n).fill(false)
  let placed = 0
  while (placed < spec.locks) {
    const p = Math.floor(state.rng() * n)
    if (!locked[p]) {
      locked[p] = true
      placed += 1
    }
  }
  // 各连续未锁定窗口内 Fisher–Yates 洗牌：窗口内骨牌不越过锁定槽，
  // 因此任意局面的最优解 = 各窗口逆序对之和。
  let i = 0
  while (i < n) {
    if (locked[i]) {
      i += 1
      continue
    }
    let j = i
    while (j < n && !locked[j]) j += 1
    for (let k = j - 1; k > i; k -= 1) {
      const t = i + Math.floor(state.rng() * (k - i + 1))
      const tmp = tiles[k]!
      tiles[k] = tiles[t]!
      tiles[t] = tmp
    }
    i = j
  }
  if (isSortedTiles(tiles)) {
    for (let k = 0; k + 1 < n; k += 1) {
      if (!locked[k] && !locked[k + 1]) {
        const tmp = tiles[k]!
        tiles[k] = tiles[k + 1]!
        tiles[k + 1] = tmp
        break
      }
    }
  }
  state.tiles = tiles
  state.locked = locked
  state.moves = 0
  state.inversions = countInversions(tiles)
  state.budget = state.inversions + spec.buffer
  state.hintsLeft = HINT_MAX
  state.selected = null
  state.hintPair = null
}

/**
 * 新开一局（指定起始关；同 seed + 同 level 的局面完全一致，便于重开
 * 本关重试与测试重放）。
 * @param seed - 外部种子（如日期）。
 * @param level - 起始关（1 起）。
 * @param score - 起始累计得分。
 * @returns 初始状态。
 */
export function createDominoShuffle(seed: number, level = 1, score = 0): DominoShuffleState {
  const lv = Math.min(LEVEL_COUNT, Math.max(1, Math.floor(level)))
  const rng = mulberry32((Math.imul(Math.floor(seed), 2654435761) + Math.imul(lv, 40503)) >>> 0)
  const state: DominoShuffleState = {
    level: lv,
    tiles: [],
    locked: [],
    moves: 0,
    budget: 0,
    inversions: 0,
    hintsLeft: HINT_MAX,
    selected: null,
    hintPair: null,
    score,
    over: false,
    win: false,
    rng,
    events: [],
  }
  dealLevel(state)
  return state
}

/**
 * 过关结算：计分（基础 100 + 剩余步数×10 + 未用提示×5），第 5 关
 * 排完置 over/win，否则立即发下一关新局面。
 * @param state - 目标状态（已排成升序）。
 */
function settleWin(state: DominoShuffleState): void {
  const reward = 100 + (state.budget - state.moves) * 10 + state.hintsLeft * 5
  state.score += reward
  if (state.level >= LEVEL_COUNT) {
    state.over = true
    state.win = true
    state.selected = null
    state.hintPair = null
    state.events.push({ type: 'win', x: W / 2, y: BOARD_Y })
    return
  }
  state.level += 1
  dealLevel(state)
  state.events.push({ type: 'level', level: state.level, x: W / 2, y: BOARD_Y })
}

/**
 * 尝试交换槽位 i 与 j 的骨牌：仅接受相邻且双方都未锁定的对；交换后
 * 重算逆序对——排成升序即过关结算；未排好但步数达到预算则判负。
 * @param state - 目标状态。
 * @param i - 槽位索引。
 * @param j - 槽位索引。
 * @returns 'ok' | 'notAdjacent' | 'locked' | 'over'（被拒绝时状态不变）。
 */
export function attemptSwap(
  state: DominoShuffleState,
  i: number,
  j: number,
): 'ok' | 'notAdjacent' | 'locked' | 'over' {
  state.events.length = 0
  if (state.over) return 'over'
  const n = state.tiles.length
  if (i < 0 || j < 0 || i >= n || j >= n || Math.abs(i - j) !== 1) return 'notAdjacent'
  const ri = tileRect(i, n)
  const rj = tileRect(j, n)
  if (state.locked[i] || state.locked[j]) {
    const li = state.locked[i] ? i : j
    state.events.push({ type: 'lockedClick', i: li, x: (ri.x + ri.w / 2 + rj.x + rj.w / 2) / 2, y: BOARD_Y + TILE_H / 2 })
    return 'locked'
  }
  const tmp = state.tiles[i]!
  state.tiles[i] = state.tiles[j]!
  state.tiles[j] = tmp
  state.moves += 1
  state.selected = null
  state.hintPair = null
  state.inversions = countInversions(state.tiles)
  state.events.push({ type: 'swap', i, j, x: (ri.x + ri.w / 2 + rj.x + rj.w / 2) / 2, y: BOARD_Y + TILE_H / 2 })
  if (isSortedTiles(state.tiles)) {
    settleWin(state)
  } else if (state.moves >= state.budget) {
    state.over = true
    state.win = false
    state.selected = null
    state.hintPair = null
    state.events.push({ type: 'fail', x: W / 2, y: BOARD_Y + TILE_H / 2 })
  }
  return 'ok'
}

/**
 * 选中 / 取消选中一张未锁定的骨牌（锁定与越界返回 false 且不改状态）。
 * @param state - 目标状态。
 * @param i - 槽位索引。
 * @returns 选中或切换成功返回 true。
 */
export function selectTile(state: DominoShuffleState, i: number): boolean {
  state.events.length = 0
  if (state.over) return false
  if (i < 0 || i >= state.tiles.length) return false
  if (state.locked[i]) {
    const r = tileRect(i, state.tiles.length)
    state.events.push({ type: 'lockedClick', i, x: r.x + r.w / 2, y: r.y + r.h / 2 })
    return false
  }
  state.selected = state.selected === i ? null : i
  return true
}

/**
 * 请求提示：高亮从左到右第一对「相邻、未锁定、左大右小」的骨牌（交
 * 换它恰好消除一个逆序）。剩余次数为 0 或局面已结束时返回 null。
 * @param state - 目标状态。
 * @returns 提示对 [左槽, 右槽]，无可用提示返回 null。
 */
export function requestHint(state: DominoShuffleState): [number, number] | null {
  state.events.length = 0
  if (state.over || state.hintsLeft <= 0) return null
  const n = state.tiles.length
  for (let i = 0; i + 1 < n; i += 1) {
    if (!state.locked[i] && !state.locked[i + 1] && state.tiles[i]! > state.tiles[i + 1]!) {
      state.hintsLeft -= 1
      state.hintPair = [i, i + 1]
      return state.hintPair
    }
  }
  return null
}
