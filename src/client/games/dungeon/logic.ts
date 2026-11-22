/**
 * 「像素地牢」纯逻辑：seed 程序化生成的回合制 mini roguelike。
 * 12×10 网格，房间 + L 形走廊连通；玩家四向移动，每走一步所有怪物
 * 行动一次（相邻攻击 / BFS 单步追击 / 随机游走）。战斗是简化的互扣
 * 血；药水、宝箱、楼梯下行、5 层递进与第 5 层 Boss 全部在此实现。
 * 所有随机都来自注入 seed 的 mulberry32 状态：同 seed + 同操作序列
 * 得到完全相同的局面——渲染层与单元测试都依赖这一确定性。
 */

/** 地牢列数（含外墙格）。 */
export const COLS = 12
/** 地牢行数（含外墙格）。 */
export const ROWS = 10
/** 总层数；第 5 层是 Boss 层（无楼梯）。 */
export const FLOOR_COUNT = 5
/** 火把视野半径（格，按欧氏距离平方 +0.5 容差比较）。 */
export const TORCH_RADIUS = 4
/** 玩家初始生命上限。 */
export const START_HP = 20
/** 药水恢复的生命值。 */
export const POTION_HEAL = 8
/** 玩家基础伤害下限（+攻升级 +0..2 随机 → 初始 2-4）。 */
export const PLAYER_ATK_BASE = 2
/** 怪物开始追击的 BFS 距离上限。 */
export const CHASE_DIST = 8

/** 四向方向。 */
export type Dir = 'up' | 'down' | 'left' | 'right'
/** 怪物种类（对应 5 层的强度阶梯 + Boss）。 */
export type MonsterKind = 'slime' | 'bat' | 'skeleton' | 'mage' | 'dragon' | 'boss'
/** 物品种类。 */
export type ItemKind = 'potion' | 'chest'
/** 对局状态。 */
export type GameStatus = 'playing' | 'dead' | 'won'

/** 每种怪的数值表：血、伤害上限（实际 1..atk）、金币、经验。 */
export const MONSTER_STATS: Record<MonsterKind, { name: string, hp: number, atk: number, gold: number, exp: number }> = {
  slime: { name: '史莱姆', hp: 4, atk: 1, gold: 3, exp: 1 },
  bat: { name: '蝙蝠', hp: 3, atk: 2, gold: 5, exp: 2 },
  skeleton: { name: '骷髅', hp: 6, atk: 2, gold: 8, exp: 3 },
  mage: { name: '法师', hp: 5, atk: 3, gold: 12, exp: 4 },
  dragon: { name: '小龙', hp: 10, atk: 3, gold: 18, exp: 6 },
  boss: { name: '龙王', hp: 26, atk: 3, gold: 100, exp: 10 },
}

/** 一只活着的怪物。 */
export interface Monster {
  /** 稳定自增 id（回合内"已行动"标记与确定性遍历用）。 */
  id: number
  kind: MonsterKind
  x: number
  y: number
  hp: number
  maxHp: number
}

/** 地上的一件物品。 */
export interface Item { kind: ItemKind, x: number, y: number }

/** 一层地牢：地形 + 实体。tiles 为 0=墙、1=地板 的行主序数组。 */
export interface Floor {
  /** 1 起的层号。 */
  index: number
  tiles: Uint8Array
  monsters: Monster[]
  items: Item[]
  /** 下行楼梯；第 5 层为 null（击杀 Boss 即通关）。 */
  stairs: { x: number, y: number } | null
}

/** 整局状态（含跨层保留的冒险者属性）。 */
export interface DungeonState {
  /** mulberry32 当前状态；全部随机由它驱动。 */
  rngState: number
  floor: Floor
  player: { x: number, y: number }
  hp: number
  maxHp: number
  /** 武器升级次数：伤害 = 2 + atkUp + 0..2。 */
  atkUp: number
  gold: number
  exp: number
  level: number
  status: GameStatus
  /** 1 起的当前层号（与 floor.index 同步）。 */
  floorIndex: number
  /** 本层已探索（曾照亮）过的格子。 */
  explored: Uint8Array
  /** 下一只怪物的 id。 */
  nextMonsterId: number
}

/** 回合产生的浮动事件（渲染层转成浮动数字 / 特效）。 */
export interface GameEvent {
  kind: 'hit' | 'hurt' | 'heal' | 'gold' | 'atkup' | 'levelup' | 'kill' | 'descend' | 'win' | 'dead'
  x: number
  y: number
  value?: number
}

/** mulberry32 单步推进 rngState 并返回 [0,1) 随机数。 */
function nextRand(state: DungeonState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0
  let t = state.rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** 注入式随机源：从整数 seed 创建 mulberry32 序列（生成/测试用）。 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [lo, hi] 闭区间随机整数。 */
function randInt(state: DungeonState, lo: number, hi: number): number {
  return lo + Math.floor(nextRand(state) * (hi - lo + 1))
}

const DIR_DELTA: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** 四向偏移（固定顺序：确定性遍历用）。 */
export const DIRS4: readonly (readonly [number, number])[] = [[0, -1], [-1, 0], [0, 1], [1, 0]]

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS
}

/** (x,y) 是否为可走地板。 */
export function isFloor(floor: Floor, x: number, y: number): boolean {
  return inBounds(x, y) && floor.tiles[y * COLS + x] === 1
}

/** 找 (x,y) 上的活怪。 */
export function monsterAt(floor: Floor, x: number, y: number): Monster | undefined {
  return floor.monsters.find(m => m.x === x && m.y === y)
}

/**
 * 从 (sx,sy) 出发的四向 BFS 距离场（墙/出界 = -1）。
 * 楼梯可达性验证与怪物追击都基于它。
 */
export function distanceField(floor: Floor, sx: number, sy: number): Int16Array {
  const dist = new Int16Array(COLS * ROWS).fill(-1)
  if (!isFloor(floor, sx, sy)) return dist
  dist[sy * COLS + sx] = 0
  const queue: number[] = [sy * COLS + sx]
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head]!
    const cx = cur % COLS
    const cy = (cur - cx) / COLS
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx
      const ny = cy + dy
      if (!isFloor(floor, nx, ny)) continue
      const ni = ny * COLS + nx
      if (dist[ni] !== -1) continue
      dist[ni] = dist[cur]! + 1
      queue.push(ni)
    }
  }
  return dist
}

/** 从玩家出发的火把可见格（半径内即见，不挡墙——简化的火光）。 */
export function computeVisible(px: number, py: number): Uint8Array {
  const vis = new Uint8Array(COLS * ROWS)
  const r2 = (TORCH_RADIUS + 0.5) * (TORCH_RADIUS + 0.5)
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const dx = x - px
      const dy = y - py
      if (dx * dx + dy * dy <= r2) vis[y * COLS + x] = 1
    }
  }
  return vis
}

/** 用当前可见集更新探索记忆。 */
function updateFog(state: DungeonState): void {
  const vis = computeVisible(state.player.x, state.player.y)
  for (let i = 0; i < vis.length; i += 1) {
    if (vis[i] === 1) state.explored[i] = 1
  }
}

/** 程序生成下一层并写入 state（玩家落在本层第一个房间中心）。 */
function generateFloor(state: DungeonState): void {
  const index = state.floorIndex
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const rooms: { x: number, y: number, w: number, h: number }[] = []
    const tiles = new Uint8Array(COLS * ROWS)
    for (let tries = 0; tries < 30 && rooms.length < 6; tries += 1) {
      const w = 3 + randInt(state, 0, 3)
      const h = 3 + randInt(state, 0, 1)
      const x = 1 + randInt(state, 0, COLS - 2 - w)
      const y = 1 + randInt(state, 0, ROWS - 2 - h)
      const clash = rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)
      if (clash) continue
      rooms.push({ x, y, w, h })
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) tiles[yy * COLS + xx] = 1
      }
    }
    if (rooms.length < 2) continue
    // 依生成顺序用 L 形走廊串联相邻房间（水平先行）。
    const center = (r: { x: number, y: number, w: number, h: number }): { cx: number, cy: number } => ({ cx: r.x + (r.w >> 1), cy: r.y + (r.h >> 1) })
    for (let i = 1; i < rooms.length; i += 1) {
      const a = center(rooms[i - 1]!)
      const b = center(rooms[i]!)
      const x0 = Math.min(a.cx, b.cx)
      const x1 = Math.max(a.cx, b.cx)
      for (let xx = x0; xx <= x1; xx += 1) tiles[a.cy * COLS + xx] = 1
      const y0 = Math.min(a.cy, b.cy)
      const y1 = Math.max(a.cy, b.cy)
      for (let yy = y0; yy <= y1; yy += 1) tiles[yy * COLS + b.cx] = 1
    }
    const spawn = center(rooms[0]!)
    const goal = center(rooms[rooms.length - 1]!)
    const floor: Floor = { index, tiles, monsters: [], items: [], stairs: index < FLOOR_COUNT ? { x: goal.cx, y: goal.cy } : null }
    // BFS 验证：玩家出生点到楼梯（Boss 层到最远点）必须连通。
    const dist = distanceField(floor, spawn.cx, spawn.cy)
    const target = floor.stairs ?? { x: goal.cx, y: goal.cy }
    if (dist[target.y * COLS + target.x]! < 0) continue
    state.floor = floor
    state.player = { x: spawn.cx, y: spawn.cy }
    state.explored = new Uint8Array(COLS * ROWS)
    spawnEntities(state, dist)
    updateFog(state)
    return
  }
  // 兜底（实践不可达）：整条横走廊，保证可玩。
  const tiles = new Uint8Array(COLS * ROWS)
  for (let x = 1; x < COLS - 1; x += 1) {
    tiles[5 * COLS + x] = 1
    tiles[5 * COLS + x - COLS] = 1
  }
  state.floor = { index, tiles, monsters: [], items: [], stairs: index < FLOOR_COUNT ? { x: COLS - 2, y: 4 } : null }
  state.player = { x: 1, y: 4 }
  state.explored = new Uint8Array(COLS * ROWS)
  updateFog(state)
}

/** 在距玩家足够远的空地板上撒怪物 / 药水 / 宝箱（含第 5 层 Boss）。 */
function spawnEntities(state: DungeonState, dist: Int16Array): void {
  const floor = state.floor
  const taken = (x: number, y: number): boolean =>
    (x === state.player.x && y === state.player.y) ||
    (floor.stairs !== null && floor.stairs.x === x && floor.stairs.y === y) ||
    floor.monsters.some(m => m.x === x && m.y === y) ||
    floor.items.some(it => it.x === x && it.y === y)
  const candidates: { x: number, y: number }[] = []
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (dist[y * COLS + x]! < 4 || taken(x, y)) continue
      candidates.push({ x, y })
    }
  }
  const pick = (): { x: number, y: number } | undefined => {
    if (candidates.length === 0) return undefined
    const i = randInt(state, 0, candidates.length - 1)
    return candidates.splice(i, 1)[0]
  }
  const tiers: Record<number, MonsterKind[]> = {
    1: ['slime'],
    2: ['slime', 'bat'],
    3: ['bat', 'skeleton'],
    4: ['skeleton', 'mage'],
    5: ['mage', 'dragon'],
  }
  const kinds = tiers[Math.min(index5(floor.index), FLOOR_COUNT)] ?? ['slime']
  const makeMonster = (kind: MonsterKind, x: number, y: number): void => {
    const st = MONSTER_STATS[kind]
    floor.monsters.push({ id: state.nextMonsterId, kind, x, y, hp: st.hp, maxHp: st.hp })
    state.nextMonsterId += 1
  }
  // 第 5 层：Boss 落在离玩家最远的候选格，亲卫紧随其后。
  if (floor.index === FLOOR_COUNT) {
    let far: { x: number, y: number } | null = null
    let farD = -1
    for (const c of candidates) {
      const d = dist[c.y * COLS + c.x]!
      if (d > farD) { farD = d; far = c }
    }
    if (far !== null) {
      candidates.splice(candidates.indexOf(far), 1)
      makeMonster('boss', far.x, far.y)
    }
  }
  const count = 3 + Math.min(floor.index, FLOOR_COUNT)
  for (let i = 0; i < count; i += 1) {
    const cell = pick()
    if (cell === undefined) break
    makeMonster(kinds[randInt(state, 0, kinds.length - 1)]!, cell.x, cell.y)
  }
  for (let i = 0; i < 2; i += 1) {
    const cell = pick()
    if (cell === undefined) break
    floor.items.push({ kind: 'potion', x: cell.x, y: cell.y })
  }
  const chests = floor.index >= 3 ? 2 : 1
  for (let i = 0; i < chests; i += 1) {
    const cell = pick()
    if (cell === undefined) break
    floor.items.push({ kind: 'chest', x: cell.x, y: cell.y })
  }
}

function index5(index: number): number {
  return Math.min(Math.max(index, 1), FLOOR_COUNT)
}

/** 升级结算：经验满级阈值即升级（血上限 +4 并回 4 血）。 */
function gainExp(state: DungeonState, amount: number, events: GameEvent[]): void {
  state.exp += amount
  while (state.exp >= state.level * 8) {
    state.exp -= state.level * 8
    state.level += 1
    state.maxHp += 4
    state.hp = Math.min(state.maxHp, state.hp + 4)
    events.push({ kind: 'levelup', x: state.player.x, y: state.player.y })
  }
}

/** 怪物对玩家的爪击：1..atk 伤害。 */
function attackPlayer(state: DungeonState, mon: Monster, events: GameEvent[]): void {
  const dmg = 1 + randInt(state, 0, MONSTER_STATS[mon.kind].atk - 1)
  state.hp -= dmg
  events.push({ kind: 'hurt', x: state.player.x, y: state.player.y, value: dmg })
}

/** 走入空格后的落格结算：拾取物品 / 踩楼梯下行。 */
function enterCell(state: DungeonState, x: number, y: number, events: GameEvent[]): boolean {
  state.player.x = x
  state.player.y = y
  const floor = state.floor
  const itemIdx = floor.items.findIndex(it => it.x === x && it.y === y)
  if (itemIdx >= 0) {
    const item = floor.items[itemIdx]!
    floor.items.splice(itemIdx, 1)
    if (item.kind === 'potion') {
      state.hp = Math.min(state.maxHp, state.hp + POTION_HEAL)
      events.push({ kind: 'heal', x, y, value: POTION_HEAL })
    } else if (nextRand(state) < 0.5) {
      const gold = 10 + randInt(state, 0, 20)
      state.gold += gold
      events.push({ kind: 'gold', x, y, value: gold })
    } else {
      state.atkUp += 1
      events.push({ kind: 'atkup', x, y })
    }
  }
  if (floor.stairs !== null && floor.stairs.x === x && floor.stairs.y === y) {
    state.floorIndex += 1
    generateFloor(state)
    events.push({ kind: 'descend', x, y, value: state.floorIndex })
    return true
  }
  return false
}

/** 玩家行动后的怪物回合：跳过本回合已反击过的怪。 */
function monsterPhase(state: DungeonState, events: GameEvent[], acted: Set<number>): void {
  const floor = state.floor
  const dist = distanceField(floor, state.player.x, state.player.y)
  for (const mon of floor.monsters) {
    if (acted.has(mon.id)) continue
    const adjacent = Math.abs(mon.x - state.player.x) + Math.abs(mon.y - state.player.y) === 1
    if (adjacent) {
      attackPlayer(state, mon, events)
      continue
    }
    const md = dist[mon.y * COLS + mon.x]!
    let moved = false
    if (md >= 2 && md <= CHASE_DIST) {
      // 追击：走向距玩家更近的相邻地板（固定方向序保证确定性）。
      let bx = -1
      let by = -1
      let bd = md
      for (const [dx, dy] of DIRS4) {
        const nx = mon.x + dx
        const ny = mon.y + dy
        if (!isFloor(floor, nx, ny)) continue
        if (nx === state.player.x && ny === state.player.y) continue
        if (monsterAt(floor, nx, ny) !== undefined) continue
        const nd = dist[ny * COLS + nx]!
        if (nd >= 0 && nd < bd) { bd = nd; bx = nx; by = ny; moved = true }
      }
      if (moved) { mon.x = bx; mon.y = by }
    }
    if (!moved) {
      // 随机游走：随机方向，目标须为空地板。
      const [dx, dy] = DIRS4[Math.floor(nextRand(state) * 4)]!
      const nx = mon.x + dx
      const ny = mon.y + dy
      if (isFloor(floor, nx, ny) && !(nx === state.player.x && ny === state.player.y) && monsterAt(floor, nx, ny) === undefined) {
        mon.x = nx
        mon.y = ny
      }
    }
    if (state.hp <= 0) return
  }
}

/** 玩家回合结算（含死亡判定）。 */
function settle(state: DungeonState, events: GameEvent[]): GameEvent[] {
  updateFog(state)
  if (state.hp <= 0 && state.status === 'playing') {
    state.hp = 0
    state.status = 'dead'
    events.push({ kind: 'dead', x: state.player.x, y: state.player.y })
  }
  return events
}

/**
 * 玩家走一步（回合制主入口）：撞墙不消耗回合；走入怪物格即攻击
 * （先手 2+atkUp+0..2），杀死则占格并结算掉落；幸存怪物立即反击，
 * 其余怪物随后行动。
 * @param state 对局状态（原地推进）。
 * @param dir 四向之一。
 * @returns 本回合的浮动事件列表（可能为空 = 撞墙）。
 */
export function playerTurn(state: DungeonState, dir: Dir): GameEvent[] {
  if (state.status !== 'playing') return []
  const [dx, dy] = DIR_DELTA[dir]
  const tx = state.player.x + dx
  const ty = state.player.y + dy
  if (!isFloor(state.floor, tx, ty)) return []
  const events: GameEvent[] = []
  const mon = monsterAt(state.floor, tx, ty)
  if (mon === undefined) {
    const descended = enterCell(state, tx, ty, events)
    if (descended) return settle(state, events)
    monsterPhase(state, events, new Set())
    return settle(state, events)
  }
  const dmg = PLAYER_ATK_BASE + state.atkUp + randInt(state, 0, 2)
  mon.hp -= dmg
  events.push({ kind: 'hit', x: tx, y: ty, value: dmg })
  if (mon.hp <= 0) {
    const st = MONSTER_STATS[mon.kind]
    state.floor.monsters.splice(state.floor.monsters.indexOf(mon), 1)
    state.gold += st.gold
    events.push({ kind: 'kill', x: tx, y: ty })
    events.push({ kind: 'gold', x: tx, y: ty, value: st.gold })
    gainExp(state, st.exp, events)
    if (mon.kind === 'boss') {
      state.status = 'won'
      events.push({ kind: 'win', x: tx, y: ty })
      return settle(state, events)
    }
    const descended = enterCell(state, tx, ty, events)
    if (descended) return settle(state, events)
    monsterPhase(state, events, new Set())
    return settle(state, events)
  }
  // 幸存的怪物立刻反击（反击即它的本回合行动）。
  attackPlayer(state, mon, events)
  monsterPhase(state, events, new Set([mon.id]))
  return settle(state, events)
}

/**
 * 开新局：seed 决定第 1 层布局与其后所有随机；死亡重开时把减半的
 * 金币带进来（roguelike 传承）。
 * @param seed 注入的整数种子。
 * @param inheritedGold 继承金币（死亡重来 = floor(gold/2)，默认 0）。
 * @returns 初始化好的对局状态。
 */
export function createRun(seed: number, inheritedGold = 0): DungeonState {
  const state: DungeonState = {
    rngState: seed >>> 0,
    floor: { index: 1, tiles: new Uint8Array(COLS * ROWS), monsters: [], items: [], stairs: null },
    player: { x: 1, y: 1 },
    hp: START_HP,
    maxHp: START_HP,
    atkUp: 0,
    gold: inheritedGold,
    exp: 0,
    level: 1,
    status: 'playing',
    floorIndex: 1,
    explored: new Uint8Array(COLS * ROWS),
    nextMonsterId: 1,
  }
  generateFloor(state)
  return state
}

/**
 * 计分：金币 + 已下行层数×100，通关再 +500。
 * @param state 对局状态。
 * @returns 当前应上报的分数。
 */
export function scoreOf(state: DungeonState): number {
  return state.gold + (state.floorIndex - 1) * 100 + (state.status === 'won' ? 500 : 0)
}
