/**
 * 云中播种 CloudSeeds 纯逻辑：风向播种谜题的核心规则——盘面生成（注入
 * seed 的 mulberry32，保证同 seed 重放一致）、恒定风矢量逐格传播积分、
 * 云层格变速（1.5×/0.5×）、落点 3×3 浇灌、种子预算与过关判负判定。
 * 渲染层与测试只依赖这里的确定性输出，不引入任何其它随机源。
 */

/** 天空格。 */
export const CELL_SKY = 0
/** 加速云：种子经过时消耗预算 ×1.5（飞得更近）。 */
export const CELL_CLOUD_FAST = 1
/** 减速云：种子经过时消耗预算 ×0.5（飞得更远）。 */
export const CELL_CLOUD_SLOW = 2
/** 山障碍格：种子撞上即损失。 */
export const CELL_MOUNTAIN = 3
/** 田地格：被浇灌的目标。 */
export const CELL_FIELD = 4

/** 关卡总数（风向与布局难度递进）。 */
export const LEVEL_COUNT = 5

/** 恒定网格尺寸（13×7，与渲染布局配套）。 */
const COLS = 13
const ROWS = 7

/** 每关飞行预算（格）：种子飘行的“里程”，进入格子时按其倍率消耗。 */
const FLIGHT: ReadonlyArray<number> = [3, 3, 2.5, 2.5, 2]

/** 每关风向量（八方向单位步，关内恒定，逐关更刁：横向→斜向→反向）。 */
const WINDS: ReadonlyArray<{ dx: number, dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
]

/** 每关田地数（逐关更散）。 */
const FIELD_COUNT: ReadonlyArray<number> = [6, 8, 9, 10, 12]

/** 每关山障碍数。 */
const MOUNTAIN_COUNT: ReadonlyArray<number> = [3, 5, 7, 8, 10]

/** 每关云格数（加速/减速各半上下浮动）。 */
const CLOUD_COUNT: ReadonlyArray<number> = [4, 6, 8, 10, 12]

/** 每关种子预算（与田地数相同：浪费一颗就浇不完）。 */
const SEED_COUNT: ReadonlyArray<number> = [6, 8, 9, 10, 12]

/** 一关的完整盘面。 */
export interface CloudSeedsLevel {
  /** 关卡号（0 基）。 */
  level: number
  /** 列数。 */
  cols: number
  /** 行数。 */
  rows: number
  /** 格子种类（行主序，下标 = row * cols + col）。 */
  cells: Uint8Array
  /** 本关恒定风向量。 */
  wind: { dx: number, dy: number }
  /** 飞行预算（格）。 */
  flight: number
  /** 种子预算。 */
  seeds: number
  /** 生成所用 seed（重放依据）。 */
  seed: number
}

/** 一颗种子的飘行结果。 */
export type SeedOutcome = 'landed' | 'out' | 'mountain'

/** 一次飘行的完整轨迹（渲染虚线与飞行动画共用）。 */
export interface SeedFlight {
  /** 途经格（含起点格与落点/撞点）。 */
  path: number[]
  /** 落点格下标（非 landed 时为 -1）。 */
  landing: number
  /** 结果：落地 / 出界 / 撞山。 */
  outcome: SeedOutcome
  /** 消耗的飞行预算。 */
  spent: number
}

/**
 * 注入式随机源（mulberry32）：同 seed 产生完全相同的 [0,1) 序列。
 * @param seed - 非负整数种子。
 * @returns 产生 [0,1) 均匀随机数的函数。
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
 * 格子的预算消耗倍率（进入该格时生效）。
 * @param kind - 格子种类。
 * @returns 倍率：天空 1、加速云 1.5、减速云 0.5、田地 1、山 2（山在到达前已判撞）。
 */
export function multiplierOf(kind: number): number {
  if (kind === CELL_CLOUD_FAST) return 1.5
  if (kind === CELL_CLOUD_SLOW) return 0.5
  return 1
}

/**
 * 该格是否可以播种（天空与云可，田地/山不可）。
 * @param kind - 格子种类。
 */
export function isPlantable(kind: number): boolean {
  return kind === CELL_SKY || kind === CELL_CLOUD_FAST || kind === CELL_CLOUD_SLOW
}

/**
 * 种子飘行模拟：从 launch 出发沿恒定风矢量逐格积分——每进入一格按其
 * 倍率消耗飞行预算，预算耗尽即落在当前格；进入山格=撞山损失，走出盘
 * 面=出界损失。
 * @param level - 盘面。
 * @param launch - 播种格下标（须为可播格）。
 * @returns 完整轨迹与结果。
 */
export function simulate(level: CloudSeedsLevel, launch: number): SeedFlight {
  const path: number[] = [launch]
  let row = Math.floor(launch / level.cols)
  let col = launch % level.cols
  let spent = 0
  const maxSteps = level.cols + level.rows + 2
  for (let step = 0; step < maxSteps; step += 1) {
    const nr = row + level.wind.dy
    const nc = col + level.wind.dx
    if (nr < 0 || nc < 0 || nr >= level.rows || nc >= level.cols) {
      return { path, landing: -1, outcome: 'out', spent }
    }
    const cell = nr * level.cols + nc
    if (level.cells[cell] === CELL_MOUNTAIN) {
      path.push(cell)
      return { path, landing: -1, outcome: 'mountain', spent }
    }
    spent += multiplierOf(level.cells[cell]!)
    row = nr
    col = nc
    path.push(cell)
    if (spent >= level.flight - 1e-9) {
      return { path, landing: cell, outcome: 'landed', spent }
    }
  }
  // 预算大于横穿全盘所需时必然先出界，此返回只是类型兜底（不可达）。
  return { path, landing: -1, outcome: 'out', spent }
}

/**
 * 落点 3×3 浇灌：把落点周围切比雪夫距离 ≤1 的田地格标记为已浇灌。
 * @param level - 盘面。
 * @param watered - 已浇灌标记（行主序），就地修改。
 * @param landing - 落点格下标。
 * @returns 本次新浇灌的田地格数。
 */
export function irrigate(level: CloudSeedsLevel, watered: Uint8Array, landing: number): number {
  const lr = Math.floor(landing / level.cols)
  const lc = landing % level.cols
  let count = 0
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const r = lr + dr
      const c = lc + dc
      if (r < 0 || c < 0 || r >= level.rows || c >= level.cols) continue
      const cell = r * level.cols + c
      if (level.cells[cell] === CELL_FIELD && watered[cell] === 0) {
        watered[cell] = 1
        count += 1
      }
    }
  }
  return count
}

/**
 * 全部田地是否都已浇灌。
 * @param level - 盘面。
 * @param watered - 已浇灌标记。
 */
export function isWon(level: CloudSeedsLevel, watered: Uint8Array): boolean {
  for (let i = 0; i < level.cells.length; i += 1) {
    if (level.cells[i] === CELL_FIELD && watered[i] === 0) return false
  }
  return true
}

/**
 * 失败判定：种子用尽且仍有未浇灌的田。
 * @param level - 盘面。
 * @param seedsLeft - 剩余种子数。
 * @param watered - 已浇灌标记。
 */
export function hasLost(level: CloudSeedsLevel, seedsLeft: number, watered: Uint8Array): boolean {
  return seedsLeft <= 0 && !isWon(level, watered)
}

/**
 * 田地格总数。
 * @param level - 盘面。
 */
export function countFields(level: CloudSeedsLevel): number {
  let count = 0
  for (let i = 0; i < level.cells.length; i += 1) {
    if (level.cells[i] === CELL_FIELD) count += 1
  }
  return count
}

/**
 * 反向求解：找一个播种格，使种子恰好落在能覆盖 target（3×3）的位置。
 * 从 target 周围的候选落点沿逆风向回走，校验正向积分的首次耗尽点。
 * @param level - 盘面。
 * @param target - 目标田地格下标。
 * @returns 可行播种格下标，找不到返回 -1。
 */
export function findWaterableLaunch(level: CloudSeedsLevel, target: number): number {
  const tr = Math.floor(target / level.cols)
  const tc = target % level.cols
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const lr = tr + dr
      const lc = tc + dc
      if (lr < 0 || lc < 0 || lr >= level.rows || lc >= level.cols) continue
      const landing = lr * level.cols + lc
      if (level.cells[landing] === CELL_MOUNTAIN) continue
      // 沿逆风向枚举候选播种格：k 步之前的格，且途经无山、首次耗尽恰在 landing。
      for (let k = 1; k <= level.cols + level.rows; k += 1) {
        const sr = lr - level.wind.dy * k
        const sc = lc - level.wind.dx * k
        if (sr < 0 || sc < 0 || sr >= level.rows || sc >= level.cols) break
        const start = sr * level.cols + sc
        if (!isPlantable(level.cells[start]!)) continue
        let spent = 0
        let ok = true
        let landedHere = false
        for (let s = 1; s <= k; s += 1) {
          const r = sr + level.wind.dy * s
          const c = sc + level.wind.dx * s
          const cell = r * level.cols + c
          if (level.cells[cell] === CELL_MOUNTAIN) { ok = false; break }
          spent += multiplierOf(level.cells[cell]!)
          if (spent >= level.flight - 1e-9) {
            landedHere = s === k
            break
          }
        }
        if (ok && landedHere) return start
      }
    }
  }
  return -1
}

/**
 * 贪心自动求解（生成期可解性验证与测试共用）：每轮枚举全部可播格，
 * 选模拟落点能新浇灌最多田的一颗，直到浇完。
 * @param level - 盘面。
 * @returns 播种格序列（空数组表示无解）。
 */
export function solveSeeds(level: CloudSeedsLevel): number[] {
  const watered = new Uint8Array(level.cells.length)
  const launches: number[] = []
  while (!isWon(level, watered)) {
    let best = -1
    let bestGain = 0
    for (let i = 0; i < level.cells.length; i += 1) {
      if (!isPlantable(level.cells[i]!)) continue
      const flight = simulate(level, i)
      if (flight.outcome !== 'landed') continue
      const probe = watered.slice()
      const gain = irrigate(level, probe, flight.landing)
      if (gain > bestGain) {
        bestGain = gain
        best = i
      }
    }
    if (best < 0) return []
    const flight = simulate(level, best)
    irrigate(level, watered, flight.landing)
    launches.push(best)
  }
  return launches
}

/**
 * 计分：关卡越深、剩余种子越多、用时越短分越高。
 * @param levelIndex - 关卡号（0 基）。
 * @param seedsLeft - 过关时剩余种子。
 * @param secs - 本关用时（秒）。
 * @returns 分数。
 */
export function computeScore(levelIndex: number, seedsLeft: number, secs: number): number {
  return (levelIndex + 1) * 600 + seedsLeft * 80 + Math.max(0, 400 - Math.floor(secs) * 2)
}

/** 从 rng 取 [min, max] 的随机整数。 */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** 生成尝试：随机放山/田/云，要求每块田可浇灌且贪心解在种子预算内。 */
function tryGenerate(rngSeed: number, levelIndex: number): CloudSeedsLevel | null {
  const rng = mulberry32(rngSeed)
  const cells = new Uint8Array(COLS * ROWS)
  const used = new Uint8Array(COLS * ROWS)
  const place = (kind: number): void => {
    for (let tries = 0; tries < 64; tries += 1) {
      const i = randInt(rng, 0, cells.length - 1)
      if (used[i] === 0) {
        used[i] = 1
        cells[i] = kind
        return
      }
    }
  }
  const fieldTotal = FIELD_COUNT[levelIndex]!
  const level: CloudSeedsLevel = {
    level: levelIndex,
    cols: COLS,
    rows: ROWS,
    cells,
    wind: { dx: WINDS[levelIndex]!.dx, dy: WINDS[levelIndex]!.dy },
    flight: FLIGHT[levelIndex]!,
    seeds: SEED_COUNT[levelIndex]!,
    seed: rngSeed,
  }
  // 山：避开逆风边界一圈，保证上游总有可播格。
  const upRow = level.wind.dy === -1 ? 1 : 0
  const upCol = level.wind.dx === -1 ? 1 : 0
  for (let m = 0; m < MOUNTAIN_COUNT[levelIndex]!; m += 1) {
    for (let tries = 0; tries < 64; tries += 1) {
      const r = randInt(rng, upRow, ROWS - 1)
      const c = randInt(rng, upCol, COLS - 1)
      const i = r * COLS + c
      if (used[i] === 0) {
        used[i] = 1
        cells[i] = CELL_MOUNTAIN
        break
      }
    }
  }
  // 田：只放进“可浇灌带”——距逆风边界至少 kmin+1（kmin=最短飘行格数），
  // 保证每块田的上风侧总有能落脚的播种格。第 1 关成簇，之后越放越散。
  const kmin = Math.ceil(level.flight / 1.5 - 1e-9)
  const rLo = level.wind.dy === 1 ? kmin + 1 : 0
  const rHi = level.wind.dy === -1 ? ROWS - 2 - kmin : ROWS - 1
  const cLo = level.wind.dx === 1 ? kmin + 1 : 0
  const cHi = level.wind.dx === -1 ? COLS - 2 - kmin : COLS - 1
  if (levelIndex === 0) {
    for (let cluster = 0; cluster < 2; cluster += 1) {
      const ar = randInt(rng, rLo + 1, Math.max(rLo + 1, rHi - 1))
      const ac = randInt(rng, cLo + 1, Math.max(cLo + 1, cHi - 1))
      let placed = 0
      for (let tries = 0; tries < 48 && placed < 3; tries += 1) {
        const r = Math.min(rHi, Math.max(rLo, ar + randInt(rng, -1, 1)))
        const c = Math.min(cHi, Math.max(cLo, ac + randInt(rng, -1, 1)))
        const i = r * COLS + c
        if (used[i] === 0) {
          used[i] = 1
          cells[i] = CELL_FIELD
          placed += 1
        }
      }
    }
  } else {
    for (let f = 0; f < fieldTotal; f += 1) {
      for (let tries = 0; tries < 64; tries += 1) {
        const r = randInt(rng, rLo, rHi)
        const c = randInt(rng, cLo, cHi)
        const i = r * COLS + c
        if (used[i] === 0) {
          used[i] = 1
          cells[i] = CELL_FIELD
          break
        }
      }
    }
  }
  // 云：一半加速一半减速（随机浮动 1）。
  const cloudTotal = CLOUD_COUNT[levelIndex]!
  const fast = Math.floor(cloudTotal / 2) + randInt(rng, 0, 1)
  for (let i = 0; i < cloudTotal; i += 1) place(i < fast ? CELL_CLOUD_FAST : CELL_CLOUD_SLOW)
  // 可解性验证：每块田单浇可达 + 贪心解不超种子预算 + 田数符合。
  if (countFields(level) < fieldTotal) return null
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] === CELL_FIELD && findWaterableLaunch(level, i) < 0) return null
  }
  const solution = solveSeeds(level)
  if (solution.length === 0 || solution.length > level.seeds) return null
  return level
}

/**
 * 按注入 seed 生成一关（最多 80 次布局尝试，全部失败返回 null）。
 * @param seed - 随机种子（同一 seed 重放得到完全相同的盘面）。
 * @param levelIndex - 关卡号（0 基，越界按边界钳制）。
 * @returns 盘面，或生成失败的 null。
 */
export function levelFromSeed(seed: number, levelIndex: number): CloudSeedsLevel | null {
  const idx = Math.min(Math.max(levelIndex, 0), LEVEL_COUNT - 1)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const made = tryGenerate((seed + attempt * 7919) >>> 0, idx)
    if (made !== null) return made
  }
  return null
}

/**
 * 生成一关并在失败时抛错（渲染入口用，杜绝静默降级）。
 * @param seed - 随机种子。
 * @param levelIndex - 关卡号（0 基）。
 * @returns 盘面。
 */
export function mustLevel(seed: number, levelIndex: number): CloudSeedsLevel {
  const made = levelFromSeed(seed, levelIndex)
  if (made === null) throw new Error('dsh-minigames: cloudseeds level generation failed')
  return made
}

