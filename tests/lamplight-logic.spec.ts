import { describe, expect, it } from 'vitest'
import {
  BOTTLE_OIL, LEVEL_COUNT, LAMP_LIT_RADIUS, generateTown, isLit, isWall, lampRadius, levelConfig, movePlayer,
  type Dir, type LamplightState,
} from '../src/client/games/lamplight/logic.ts'

const SEEDS = [1, 42, 20261023, 0x9e3779b9, 777777]

/** 快照：可判等序列化（排除 rand 闭包）。 */
function snapshot(s: LamplightState): string {
  return JSON.stringify({
    walls: [...s.walls],
    lamps: s.lamps.map(l => [l.x, l.y, l.lit ? 1 : 0]),
    bottles: s.bottles.map(b => [b.x, b.y, b.taken ? 1 : 0]),
    shadows: s.shadows.map(sh => [sh.x, sh.y, sh.spawnX, sh.spawnY]),
    player: [s.player.x, s.player.y],
    oil: s.oil,
    moves: s.moves,
    litOrder: [...s.litOrder],
    seen: [...s.seen],
    status: s.status,
  })
}

/** 测试方 BFS：返回每格最短路径的前驱（-2 无、-1 起点），供寻路。 */
function bfsPrev(s: LamplightState, sx: number, sy: number): Int32Array {
  const n = s.cols * s.rows
  const prev = new Int32Array(n).fill(-2)
  const dist = new Int32Array(n).fill(-1)
  const start = sy * s.cols + sx
  if (s.walls[start] === 1) return prev
  prev[start] = -1
  dist[start] = 0
  const queue = [start]
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head]!
    const cx = cur % s.cols
    const cy = (cur - cx) / s.cols
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows) continue
      const nIdx = ny * s.cols + nx
      if (s.walls[nIdx] === 1 || dist[nIdx] !== -1) continue
      dist[nIdx] = dist[cur]! + 1
      prev[nIdx] = cur
      queue.push(nIdx)
    }
  }
  return prev
}

/** 沿最短路把玩家走到 (tx,ty)（逐步 movePlayer；中途胜负即停）。 */
function walkTo(s: LamplightState, tx: number, ty: number): void {
  const prev = bfsPrev(s, s.player.x, s.player.y)
  const target = ty * s.cols + tx
  expect(prev[target], 'walkTo: 目标不可达').not.toBe(-2)
  const path: number[] = []
  let cur = target
  while (cur !== -1 && prev[cur] !== -1) {
    path.push(cur)
    cur = prev[cur]!
  }
  path.reverse()
  for (const cell of path) {
    if (s.status !== 'playing') break
    const cx = cell % s.cols
    const cy = (cell - cx) / s.cols
    const dx = cx - s.player.x
    const dy = cy - s.player.y
    const dir: Dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up'
    expect(movePlayer(s, dir)).toBe(true)
  }
  if (s.status === 'playing') {
    expect(s.player.x).toBe(tx)
    expect(s.player.y).toBe(ty)
  }
}

/** 找一个相邻可走的街道方向（保证至少一步成功移动）。 */
function anyOpenDir(s: LamplightState): Dir {
  for (const dir of ['right', 'down', 'left', 'up'] as Dir[]) {
    const delta: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
    const [dx, dy] = delta[dir]
    if (!isWall(s, s.player.x + dx, s.player.y + dy)) return dir
  }
  throw new Error('玩家被四面建筑围死（生成器不会产出）')
}

describe('lamplight logic', () => {
  it('同 seed 同关生成完全相同的小镇', () => {
    for (const seed of SEEDS) {
      for (const level of [1, 3, 5]) {
        const a = generateTown(seed, level)
        const b = generateTown(seed, level)
        expect(snapshot(b)).toBe(snapshot(a))
      }
    }
  })

  it('所有路灯/油瓶/暗影从起点 BFS 可达', () => {
    for (const seed of SEEDS) {
      for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        const s = generateTown(seed, level)
        const prev = bfsPrev(s, s.player.x, s.player.y)
        for (const lamp of s.lamps) expect(prev[lamp.y * s.cols + lamp.x], 'lamp').not.toBe(-2)
        for (const bottle of s.bottles) expect(prev[bottle.y * s.cols + bottle.x], 'bottle').not.toBe(-2)
        for (const shadow of s.shadows) expect(prev[shadow.y * s.cols + shadow.x], 'shadow').not.toBe(-2)
      }
    }
  })

  it('路灯数量与配置一致、两两曼哈顿距离 ≥ 4，且关卡递进', () => {
    const cfg1 = levelConfig(1)
    const cfg5 = levelConfig(5)
    expect(cfg5.cols).toBeGreaterThan(cfg1.cols)
    expect(cfg5.lamps).toBeGreaterThan(cfg1.lamps)
    expect(cfg5.shadows).toBeGreaterThan(cfg1.shadows)
    for (const seed of SEEDS) {
      const s = generateTown(seed, 5)
      const cfg = levelConfig(5)
      expect(s.lamps.length).toBe(cfg.lamps)
      expect(s.bottles.length).toBe(cfg.bottles)
      expect(s.shadows.length).toBe(cfg.shadows)
      for (let i = 0; i < s.lamps.length; i += 1) {
        for (let j = i + 1; j < s.lamps.length; j += 1) {
          const a = s.lamps[i]!
          const b = s.lamps[j]!
          expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(4)
        }
      }
    }
  })

  it('移动结算：撞墙不耗油，成功移动计步耗油；灯油分档缩圈', () => {
    const s = generateTown(20261023, 1)
    // 找一个被墙挡住的方向。
    const delta: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
    let blocked: Dir | null = null
    for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) {
      const [dx, dy] = delta[dir]
      if (isWall(s, s.player.x + dx, s.player.y + dy)) { blocked = dir; break }
    }
    if (blocked !== null) {
      const px = s.player.x, py = s.player.y, oil = s.oil
      expect(movePlayer(s, blocked)).toBe(false)
      expect(s.player.x).toBe(px)
      expect(s.player.y).toBe(py)
      expect(s.oil).toBe(oil)
      expect(s.moves).toBe(0)
    }
    const open = anyOpenDir(s)
    const oilBefore = s.oil
    expect(movePlayer(s, open)).toBe(true)
    expect(s.oil).toBe(oilBefore - 1)
    expect(s.moves).toBe(1)
    // lampRadius 分档阈值。
    expect(lampRadius(12)).toBe(2.5)
    expect(lampRadius(8)).toBe(2.5)
    expect(lampRadius(7)).toBe(2)
    expect(lampRadius(5)).toBe(2)
    expect(lampRadius(4)).toBe(1.5)
    expect(lampRadius(3)).toBe(1.5)
    expect(lampRadius(2)).toBe(1)
    expect(lampRadius(1)).toBe(1)
    expect(lampRadius(0)).toBe(0)
  })

  it('isLit 半径判定：油灯随油量缩圈', () => {
    const s = generateTown(42, 1)
    s.lamps = [] // 孤立油灯，便于半径断言。
    const { x, y } = s.player
    const far = (dx: number, dy: number): boolean => isLit(s, x + dx, y + dy)
    // 半径 2.5：(2,1) 距离 √5≈2.24 亮；(2,2) 距离 2√2≈2.83 不亮。
    s.oil = 10
    expect(far(2, 1)).toBe(true)
    expect(far(2, 2)).toBe(false)
    // 半径 1：(1,1) 距离 √2≈1.41 不亮；正邻格亮。
    s.oil = 2
    expect(far(1, 0)).toBe(true)
    expect(far(1, 1)).toBe(false)
  })

  it('路灯永久照明：点亮后走远，其周围 2 格仍亮', () => {
    const s = generateTown(42, 1)
    s.shadows = []
    s.oil = 99
    const lamp = s.lamps[0]!
    walkTo(s, lamp.x, lamp.y)
    expect(lamp.lit).toBe(true)
    // 路上可能顺路点亮别的路灯，但终点这盏必然刚被点亮（位于队尾）。
    expect(s.litOrder[s.litOrder.length - 1]).toBe(0)
    expect(s.litOrder).toContain(0)
    // (±1,±1) 距离 √2 ≤ 2 必亮；(±2,±2) 距离 2√2 > 2 必不亮（仅当在界内且非油灯照亮）。
    const diag = [[1, 1], [-1, 1], [1, -1], [-1, -1]] as [number, number][]
    for (const [dx, dy] of diag) {
      const tx = lamp.x + dx, ty = lamp.y + dy
      if (tx < 0 || ty < 0 || tx >= s.cols || ty >= s.rows) continue
      if ((tx - s.player.x) ** 2 + (ty - s.player.y) ** 2 <= 2.5 * 2.5) continue
      expect(isLit(s, tx, ty), '对角格应被路灯照亮').toBe(true)
    }
    // 走到远处（保证脱离油灯范围），路灯周围仍亮。
    let farX = 0, farY = 0, best = -1
    for (let yy = 0; yy < s.rows; yy += 1) {
      for (let xx = 0; xx < s.cols; xx += 1) {
        if (s.walls[yy * s.cols + xx] === 1) continue
        const d2 = (xx - lamp.x) ** 2 + (yy - lamp.y) ** 2 + (xx - s.player.x) ** 2 + (yy - s.player.y) ** 2
        if (d2 > best) { best = d2; farX = xx; farY = yy }
      }
    }
    walkTo(s, farX, farY)
    expect((farX - lamp.x) ** 2 + (farY - lamp.y) ** 2).toBeGreaterThan(LAMP_LIT_RADIUS ** 2)
    expect(isLit(s, lamp.x, lamp.y), '路灯本体永久亮').toBe(true)
  })

  it('油瓶补给 +2 且每瓶只取一次', () => {
    const s = generateTown(42, 1)
    s.shadows = []
    s.oil = 50
    const bottle = s.bottles[0]!
    walkTo(s, bottle.x, bottle.y)
    expect(bottle.taken).toBe(true)
    // 走到油瓶格：每步 -1 油、补给 +2（walkTo 结束时恰在油瓶格）。
    expect(s.oil).toBe(50 - s.moves + BOTTLE_OIL)
    const oilAfter = s.oil
    // 走一步再原路折回油瓶格。
    const away = anyOpenDir(s)
    const px = s.player.x, py = s.player.y
    const backToBottle = (): void => {
      while (s.status === 'playing' && (s.player.x !== px || s.player.y !== py)) {
        const dx = Math.sign(px - s.player.x)
        const dy = Math.sign(py - s.player.y)
        const dir: Dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up'
        movePlayer(s, dir)
      }
    }
    expect(movePlayer(s, away)).toBe(true)
    backToBottle()
    expect(s.player.x).toBe(bottle.x)
    expect(s.player.y).toBe(bottle.y)
    expect(bottle.taken).toBe(true)
    // 无二次补给：油量始终满足 油瓶前基准 50 + 补给 2 - 总步数。
    expect(s.oil).toBe(50 + BOTTLE_OIL - s.moves)
    expect(s.oil).toBeLessThan(oilAfter) // 折返两步净耗 2 格油
  })

  it('胜负判定：全亮过关/第 5 关整场通关；灯油耗尽失败且锁操作', () => {
    for (const [level, expectStatus] of [[1, 'levelClear'], [5, 'allClear']] as [number, string][]) {
      const s = generateTown(7, level)
      s.shadows = []
      s.oil = 999
      for (const lamp of s.lamps) walkTo(s, lamp.x, lamp.y)
      expect(s.lamps.every(l => l.lit)).toBe(true)
      expect(s.status).toBe(expectStatus)
    }
    // 灯油耗尽：失败，且不可再移动。
    const s = generateTown(7, 1)
    s.shadows = []
    s.oil = 1
    const dir = anyOpenDir(s)
    expect(movePlayer(s, dir)).toBe(true)
    expect(s.oil).toBe(0)
    expect(s.status).toBe('gameover')
    expect(movePlayer(s, dir)).toBe(false)
  })

  it('暗影接触：熄灭最近点亮的路灯并退回出生点', () => {
    // 构造无随机干扰的接触局面：手动摆位。
    const s = generateTown(20261023, 3)
    expect(s.shadows.length).toBe(1)
    const shadow = s.shadows[0]!
    s.lamps[0]!.lit = true
    s.litOrder.push(0)
    // 把暗影放到玩家身旁的街道格，玩家走上它。
    const cand: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    let placed = false
    for (const [dx, dy] of cand) {
      const nx = s.player.x + dx, ny = s.player.y + dy
      if (isWall(s, nx, ny)) continue
      shadow.x = nx
      shadow.y = ny
      const dir: Dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up'
      const litCount = s.litOrder.length
      expect(movePlayer(s, dir)).toBe(true)
      expect(s.litOrder.length).toBe(litCount - 1)
      expect(s.lamps[0]!.lit).toBe(false)
      expect(shadow.x).toBe(shadow.spawnX)
      expect(shadow.y).toBe(shadow.spawnY)
      placed = true
      break
    }
    expect(placed).toBe(true)
  })

  it('暗影追击：感知半径内朝玩家走，主轴被建筑挡住时改走副轴', () => {
    const s = generateTown(20261023, 3)
    const shadow = s.shadows[0]!
    const mid = { x: Math.floor(s.cols / 2), y: Math.floor(s.rows / 2) }
    // 清出测试街道十字（测试有权直接改写地形与摆位）。
    for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] as [number, number][]) {
      s.walls[(mid.y + dy) * s.cols + mid.x + dx] = 0
    }
    s.player.x = mid.x
    s.player.y = mid.y
    s.oil = 20
    shadow.spawnX = mid.x + 2
    shadow.spawnY = mid.y + 1
    shadow.x = mid.x + 2
    shadow.y = mid.y + 1
    // 玩家右移到 (mid+1, mid)：暗影在 (mid+2, mid+1)，切比雪夫 1 → 追击；
    // 主轴水平（|dx|≥|dy|）但 (mid+1, mid+1) 被墙挡住 → 走副轴到 (mid+2, mid)。
    s.walls[(mid.y + 1) * s.cols + mid.x + 1] = 1
    expect(movePlayer(s, 'right')).toBe(true)
    expect(shadow.x).toBe(mid.x + 2)
    expect(shadow.y).toBe(mid.y)
    // 暗影未接触玩家：路灯不受影响。
    expect(s.litOrder.length).toBe(0)
  })

  it('seed 重放：同 seed + 同操作序列 → 完全一致的演化', () => {
    const seed = 20261023
    // 固定操作序列：右、下、左、上循环 40 轮。
    const buildDirs = (): Dir[] => {
      const dirs: Dir[] = []
      for (let i = 0; i < 40; i += 1) dirs.push('right', 'down', 'left', 'up')
      return dirs
    }
    const run = (): string => {
      const s = generateTown(seed, 3)
      s.oil = 200
      for (const dir of buildDirs()) {
        if (s.status !== 'playing') break
        movePlayer(s, dir)
      }
      return snapshot(s)
    }
    const a = run()
    const b = run()
    expect(b).toBe(a)
    // 不同 seed 生成不同地形（极大概率）。
    const c = generateTown(seed + 1, 3)
    const d = generateTown(seed, 3)
    expect([...c.walls]).not.toEqual([...d.walls])
  })
})
