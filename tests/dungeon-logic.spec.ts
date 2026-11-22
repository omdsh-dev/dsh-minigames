import { describe, expect, it } from 'vitest'
import {
  CHASE_DIST, COLS, FLOOR_COUNT, MONSTER_STATS, ROWS, START_HP, TORCH_RADIUS,
  computeVisible, createRun, distanceField, isFloor, monsterAt, mulberry32, playerTurn, scoreOf,
  type Dir, type DungeonState,
} from '../src/client/games/dungeon/logic.ts'

const SEEDS = [1, 42, 20261122, 987654321]
const ALL_DIRS: Dir[] = ['up', 'down', 'left', 'right']
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** 朝目标点沿距离场下坡走一步（可穿过怪=攻击），无路则退化为任意可行方向。 */
function stepTowards(state: DungeonState, tx: number, ty: number): boolean {
  const d = distanceField(state.floor, tx, ty)
  const cur = d[state.player.y * COLS + state.player.x]!
  let best: Dir | undefined
  let bestD = cur
  let attackDir: Dir | undefined
  for (const dir of ALL_DIRS) {
    const [dx, dy] = DELTA[dir]
    const nx = state.player.x + dx
    const ny = state.player.y + dy
    if (!isFloor(state.floor, nx, ny)) continue
    const nd = d[ny * COLS + nx]!
    if (nd < 0 || nd >= bestD) continue
    if (monsterAt(state.floor, nx, ny) !== undefined) { attackDir = dir; continue }
    bestD = nd
    best = dir
  }
  const chosen = best ?? attackDir ?? ALL_DIRS.find(dir => {
    const [dx, dy] = DELTA[dir]
    return isFloor(state.floor, state.player.x + dx, state.player.y + dy)
  })
  if (chosen === undefined) return false
  playerTurn(state, chosen)
  return true
}

/** 沿真实地图一路下行到目标层（途中会真实战斗），返回是否成功。 */
function descendTo(state: DungeonState, target: number): boolean {
  let guard = 0
  while (state.floorIndex < target && state.status === 'playing' && guard < 2000) {
    guard += 1
    const startFloor = state.floorIndex
    const s = state.floor.stairs
    if (s === null) return false
    let steps = 0
    while (state.floorIndex === startFloor && state.status === 'playing' && steps < 300) {
      steps += 1
      state.hp = state.maxHp // 途中的战斗允许回血续命：这里只验证可达性
      if (!stepTowards(state, s.x, s.y)) return false
    }
  }
  return state.floorIndex === target && state.status === 'playing'
}

/** 铺一条第 5 行的直达走廊（AI 实验用）。 */
function corridorState(seed: number): DungeonState {
  const state = createRun(seed)
  const tiles = new Uint8Array(COLS * ROWS)
  for (let x = 1; x < COLS - 1; x += 1) tiles[5 * COLS + x] = 1
  state.floor = { index: 1, tiles, monsters: [], items: [], stairs: null }
  state.explored = new Uint8Array(COLS * ROWS)
  state.player = { x: 2, y: 5 }
  return state
}

/** 无脑游走 n 步，用于随机回归。 */
function wander(state: DungeonState, n: number): void {
  for (let i = 0; i < n && state.status === 'playing'; i += 1) {
    const dir = ALL_DIRS.find(d => isFloor(state.floor, state.player.x + DELTA[d][0], state.player.y + DELTA[d][1]))
    if (dir === undefined) return
    playerTurn(state, dir)
  }
}

describe('dungeon logic', () => {
  it('同 seed 生成完全相同的层（布局+实体+初始状态）', () => {
    for (const seed of SEEDS) {
      const a = createRun(seed)
      const b = createRun(seed)
      expect([...b.floor.tiles]).toEqual([...a.floor.tiles])
      expect(b.floor.monsters).toEqual(a.floor.monsters)
      expect(b.floor.items).toEqual(a.floor.items)
      expect(b.floor.stairs).toEqual(a.floor.stairs)
      expect(b.player).toEqual(a.player)
      expect(b.rngState).toBe(a.rngState)
    }
  })

  it('所有地板连通（出生点 BFS 全覆盖），楼梯可达且不在出生点', () => {
    for (const seed of SEEDS) {
      const state = createRun(seed)
      const dist = distanceField(state.floor, state.player.x, state.player.y)
      let floors = 0
      for (let i = 0; i < dist.length; i += 1) {
        if (state.floor.tiles[i] === 1) {
          floors += 1
          expect(dist[i], 'seed ' + seed + ' cell ' + i + ' unreachable').toBeGreaterThanOrEqual(0)
        }
      }
      expect(floors).toBeGreaterThan(20)
      const stairs = state.floor.stairs
      expect(stairs).not.toBeNull()
      expect(dist[stairs!.y * COLS + stairs!.x]!).toBeGreaterThan(0)
    }
  })

  it('实体落位：怪/物品都在空地板上且不贴脸；Boss 只在且必在第 5 层', () => {
    for (const seed of SEEDS) {
      for (let target = 1; target <= FLOOR_COUNT; target += 1) {
        const state = createRun(seed)
        const ok = descendTo(state, target)
        expect(ok, 'seed ' + seed + ' floor ' + target).toBe(true)
        const fl = state.floor
        const hasBoss = fl.monsters.some(m => m.kind === 'boss')
        expect(hasBoss).toBe(fl.index === FLOOR_COUNT)
        if (fl.index === FLOOR_COUNT) expect(fl.stairs).toBeNull()
        const dist = distanceField(fl, state.player.x, state.player.y)
        for (const mon of fl.monsters) {
          expect(isFloor(fl, mon.x, mon.y)).toBe(true)
          expect(dist[mon.y * COLS + mon.x]!).toBeGreaterThanOrEqual(2)
          expect(mon.hp).toBe(MONSTER_STATS[mon.kind].hp)
          expect(mon.maxHp).toBe(MONSTER_STATS[mon.kind].hp)
        }
        expect(fl.monsters.length).toBeGreaterThanOrEqual(4)
        for (const item of fl.items) {
          expect(isFloor(fl, item.x, item.y)).toBe(true)
          expect(monsterAt(fl, item.x, item.y)).toBeUndefined()
        }
        expect(fl.items.filter(i => i.kind === 'potion').length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('撞墙不消耗回合：位置不变、无事件、怪物不动、rng 不推进', () => {
    const state = corridorState(7)
    const wallDir = ALL_DIRS.find(d => !isFloor(state.floor, state.player.x + DELTA[d][0], state.player.y + DELTA[d][1]))
    expect(wallDir).toBeDefined()
    const beforeMonsters = state.floor.monsters.map(m => ({ ...m }))
    const before = { x: state.player.x, y: state.player.y, rng: state.rngState }
    expect(playerTurn(state, wallDir!)).toEqual([])
    expect(state.player.x).toBe(before.x)
    expect(state.player.y).toBe(before.y)
    expect(state.rngState).toBe(before.rng)
    expect(state.floor.monsters).toEqual(beforeMonsters)
  })

  it('战斗数值：先手 2-4（攻+1 后 3-5）；幸存怪反击 1..atk 且玩家原地', () => {
    const state = corridorState(20261122)
    state.floor.monsters = [{ id: 99, kind: 'skeleton', x: 3, y: 5, hp: 6, maxHp: 6 }]
    const px = state.player.x
    const py = state.player.y
    const hp0 = state.hp
    const events = playerTurn(state, 'right')
    const hit = events.find(e => e.kind === 'hit')!
    expect(hit.value!).toBeGreaterThanOrEqual(2)
    expect(hit.value!).toBeLessThanOrEqual(4)
    expect(state.floor.monsters[0]!.hp).toBe(6 - hit.value!)
    expect(state.floor.monsters[0]!.x).toBe(3) // 被打但没动
    const hurt = events.filter(e => e.kind === 'hurt')
    expect(hurt.length).toBe(1) // 幸存 → 反击一次
    expect(hurt[0]!.value!).toBeGreaterThanOrEqual(1)
    expect(hurt[0]!.value!).toBeLessThanOrEqual(MONSTER_STATS.skeleton.atk)
    expect(state.hp).toBe(hp0 - hurt[0]!.value!)
    expect(state.player.x).toBe(px)
    expect(state.player.y).toBe(py)
    // 武器升级 +1 后伤害区间整体上移。
    state.atkUp = 1
    state.floor.monsters = [{ id: 100, kind: 'skeleton', x: px + 1, y: py, hp: 6, maxHp: 6 }]
    const events2 = playerTurn(state, 'right')
    const hit2 = events2.find(e => e.kind === 'hit')!
    expect(hit2.value!).toBeGreaterThanOrEqual(3)
    expect(hit2.value!).toBeLessThanOrEqual(5)
  })

  it('击杀：怪物移除、金币/经验入账、玩家占格、无反击；Boss 死亡即通关', () => {
    const state = corridorState(20261122)
    state.floor.monsters = [{ id: 1, kind: 'bat', x: 3, y: 5, hp: 1, maxHp: 3 }]
    const gold0 = state.gold
    const events = playerTurn(state, 'right')
    expect(state.floor.monsters.length).toBe(0)
    expect(state.gold).toBe(gold0 + MONSTER_STATS.bat.gold)
    expect(state.exp).toBe(MONSTER_STATS.bat.exp)
    expect(state.player.x).toBe(3)
    expect(events.some(e => e.kind === 'kill')).toBe(true)
    expect(events.some(e => e.kind === 'hurt')).toBe(false)
    // Boss：一击必杀 → won，且其余怪不再行动。
    const bossState = corridorState(3)
    bossState.player = { x: 2, y: 5 }
    bossState.floor.monsters = [
      { id: 2, kind: 'boss', x: 3, y: 5, hp: 1, maxHp: 26 },
      { id: 3, kind: 'mage', x: 10, y: 5, hp: 5, maxHp: 5 },
    ]
    playerTurn(bossState, 'right')
    expect(bossState.status).toBe('won')
    expect(bossState.floor.monsters.length).toBe(1) // 法师没吃到回合
    expect(bossState.floor.monsters[0]!.x).toBe(10)
    expect(scoreOf(bossState)).toBe(bossState.gold + 0 * 100 + 500)
  })

  it('物品：药水 +8 且封顶；宝箱两种分支（金币 / 攻+1）都能开出', () => {
    const state = corridorState(20261122)
    // 残血 3 差 → 回满。
    state.floor.items = [{ kind: 'potion', x: 3, y: 5 }]
    state.hp = state.maxHp - 3
    playerTurn(state, 'right')
    expect(state.hp).toBe(state.maxHp)
    expect(state.floor.items.length).toBe(0)
    // 大残 → 恰好 +8。
    state.player = { x: 2, y: 5 }
    state.floor.items = [{ kind: 'potion', x: 3, y: 5 }]
    state.hp = 5
    playerTurn(state, 'right')
    expect(state.hp).toBe(13)
    // 宝箱分支：扫不同 seed 的确定序列直到两种都见过。
    let sawGold = false
    let sawAtk = false
    for (let i = 0; i < 3000 && !(sawGold && sawAtk); i += 1) {
      const s = corridorState(20261122 + i)
      s.floor.items = [{ kind: 'chest', x: 3, y: 5 }]
      const gold0 = s.gold
      playerTurn(s, 'right')
      if (s.gold > gold0) sawGold = true
      if (s.atkUp === 1) sawAtk = true
    }
    expect(sawGold).toBe(true)
    expect(sawAtk).toBe(true)
  })

  it('楼梯下行：层数+1、生命/攻/金币保留；第 5 层无楼梯有 Boss', () => {
    for (const seed of SEEDS) {
      const two = createRun(seed)
      expect(descendTo(two, 2)).toBe(true)
      expect(two.floorIndex).toBe(2)
      expect(two.floor.index).toBe(2)
      expect(two.hp).toBeGreaterThan(0)
      expect(two.floor.stairs).not.toBeNull()
      const five = createRun(seed)
      const reached = descendTo(five, FLOOR_COUNT)
      if (reached) {
        expect(five.floor.stairs).toBeNull()
        expect(five.floor.monsters.some(m => m.kind === 'boss')).toBe(true)
        expect(five.player).toBeDefined()
      } else {
        expect(five.status).toBe('dead') // 途中战死也算合法结局
      }
    }
    // 属性保留的受控验证：手动放楼梯。
    const manual = corridorState(11)
    manual.floor.stairs = { x: 3, y: 5 }
    manual.hp = 9
    manual.atkUp = 2
    manual.gold = 33
    const events = playerTurn(manual, 'right')
    expect(events.some(e => e.kind === 'descend')).toBe(true)
    expect(manual.floorIndex).toBe(2)
    expect(manual.hp).toBe(9)
    expect(manual.atkUp).toBe(2)
    expect(manual.gold).toBe(33)
  })

  it('怪物 AI：相邻追击攻击；视野内沿走廊逼近；随机游走确定', () => {
    // 直线走廊：怪 4 格外 → 一回合后距离必减（追击）。
    const s2 = corridorState(5)
    s2.floor.monsters = [{ id: 1, kind: 'slime', x: 6, y: 5, hp: 4, maxHp: 4 }]
    playerTurn(s2, 'left') // 玩家 (1,5)
    const mon = s2.floor.monsters[0]!
    const d = Math.abs(mon.x - s2.player.x) + Math.abs(mon.y - s2.player.y)
    expect(d).toBeLessThanOrEqual(CHASE_DIST)
    expect(d).toBeLessThanOrEqual(4) // 起步 5，至少逼近一步
    // 贴脸：玩家走开后怪追上来，下一回合走入怪格=互扣血。
    const s3 = corridorState(20261122)
    s3.floor.monsters = [{ id: 1, kind: 'skeleton', x: 3, y: 5, hp: 6, maxHp: 6 }]
    const hpA = s3.hp
    playerTurn(s3, 'right') // 攻击怪（2-4），幸存反击 1
    expect(s3.hp).toBeLessThan(hpA)
    // 随机游走确定性：远离的怪同 seed 同操作序列完全一致。
    const a = corridorState(77)
    a.floor.monsters = [{ id: 1, kind: 'bat', x: 10, y: 5, hp: 3, maxHp: 3 }]
    const b = corridorState(77)
    b.floor.monsters = [{ id: 1, kind: 'bat', x: 10, y: 5, hp: 3, maxHp: 3 }]
    for (let i = 0; i < 20; i += 1) { playerTurn(a, 'left'); playerTurn(b, 'left') }
    expect(a.floor.monsters[0]).toEqual(b.floor.monsters[0])
    expect(a.rngState).toBe(b.rngState)
  })

  it('迷雾视野：半径内可见、外不可见、探索记忆只增不减', () => {
    const state = createRun(20261122)
    const vis = computeVisible(state.player.x, state.player.y)
    const r2 = (TORCH_RADIUS + 0.5) * (TORCH_RADIUS + 0.5)
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const dx = x - state.player.x
        const dy = y - state.player.y
        expect(vis[y * COLS + x] === 1).toBe(dx * dx + dy * dy <= r2)
      }
    }
    for (let i = 0; i < vis.length; i += 1) {
      if (vis[i] === 1) expect(state.explored[i]).toBe(1)
    }
    const start = { ...state.player }
    wander(state, 30)
    if (state.status === 'playing') {
      expect(state.explored[start.y * COLS + start.x]).toBe(1)
    }
  })

  it('死亡与传承：血尽即 dead；重开带入 floor(gold/2)；分数规则正确', () => {
    const state = corridorState(20261122)
    state.floor.monsters = [{ id: 1, kind: 'mage', x: 3, y: 5, hp: 5, maxHp: 5 }]
    state.hp = 1
    let guard = 0
    while (state.status === 'playing' && guard < 50) {
      guard += 1
      if (state.floor.monsters.length === 0) {
        state.floor.monsters = [{ id: guard, kind: 'mage', x: state.player.x + 1, y: 5, hp: 5, maxHp: 5 }]
      }
      playerTurn(state, 'right')
    }
    expect(state.status).toBe('dead')
    expect(state.hp).toBe(0)
    state.gold = 9
    const heir = createRun(424242, Math.floor(state.gold / 2))
    expect(heir.gold).toBe(4)
    expect(heir.hp).toBe(START_HP)
    expect(heir.floorIndex).toBe(1)
    expect(scoreOf(heir)).toBe(4)
    // 分数 = 金币 + (层-1)*100 + 通关 500。
    const fresh = createRun(1)
    expect(scoreOf(fresh)).toBe(0)
    fresh.gold = 50
    fresh.floorIndex = 3
    expect(scoreOf(fresh)).toBe(250)
  })

  it('seed 重放：同 seed + 同按键序列 → 事件与局面完全一致', () => {
    const script: Dir[] = ['up', 'left', 'down', 'right', 'up', 'up', 'left', 'down', 'right', 'right', 'down', 'left']
    const a = createRun(20261122)
    const b = createRun(20261122)
    for (const dir of script) {
      const ea = playerTurn(a, dir)
      const eb = playerTurn(b, dir)
      expect(eb).toEqual(ea)
    }
    expect(a.player).toEqual(b.player)
    expect(a.hp).toBe(b.hp)
    expect(a.gold).toBe(b.gold)
    expect(a.level).toBe(b.level)
    expect(a.rngState).toBe(b.rngState)
    expect(a.floor.monsters).toEqual(b.floor.monsters)
    expect([...a.explored]).toEqual([...b.explored])
    expect(scoreOf(a)).toBe(scoreOf(b))
    // mulberry32 独立序列可用且与 createRun 的内部推进同源。
    const rng = mulberry32(20261122)
    expect(rng()).toBeGreaterThanOrEqual(0)
    expect(rng()).toBeLessThan(1)
  })
})
