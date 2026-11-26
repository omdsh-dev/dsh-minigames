/**
 * 云中播种 game definition：把纯逻辑接进 MiniGameInstance——点击天空/
 * 云朵格播种（种子沿风矢量动画飘行），空格对悬停格试放轨迹预览（不消
 * 耗种子），R 重开本关（同 seed 重放），P 暂停，说明按钮随时开合。过关
 * 上报 onScore 后 1.5s 自动进下一关；种子用尽判负。dirty 帧循环 + 流场
 * 与云朵动画期间逐帧重绘，静止（暂停/无动画）时零重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  LEVEL_COUNT,
  CELL_FIELD,
  computeScore,
  countFields,
  hasLost,
  irrigate,
  isPlantable,
  isWon,
  mustLevel,
  simulate,
  type CloudSeedsLevel,
  type SeedFlight,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, cellAt, cellCenter, computeLayout, helpButtonHit,
  renderCloudSeeds, type SeedTrail,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1500
/** 一格飘行动画时长（秒），整段 = 格数 × 该值。 */
const CELL_FLY_SEC = 0.14
/** 历史轨迹最多保留条数（防长局遮挡）。 */
const TRAIL_LIMIT = 6

/** 挂载计数：与时间戳混合派生每局互不相同的 seed。 */
let mountCounter = 0

function createCloudSeedsGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  mountCounter += 1
  const runSeed = (Date.now() ^ Math.imul(mountCounter, 2654435761)) >>> 0

  let levelIndex = 0
  let level: CloudSeedsLevel = mustLevel(runSeed, 0)
  let watered = new Uint8Array(level.cells.length)
  let seedsLeft = level.seeds
  let hover = -1
  let preview: SeedFlight | null = null
  let flying: { flight: SeedFlight, t: number } | null = null
  let trails: SeedTrail[] = []
  let helpOpen = false
  let running = false
  let won = false
  let lost = false
  let winText: string | null = null
  let elapsedSecs = 0
  let timeSec = 0
  let advanceTimer = 0
  let lastScoreLevel = -1
  const particles = createParticles()

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: cloudseeds needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const startLevel = (index: number): void => {
    levelIndex = index
    level = mustLevel(runSeed + index * 1013, index)
    watered = new Uint8Array(level.cells.length)
    seedsLeft = level.seeds
    hover = -1
    preview = null
    flying = null
    trails = []
    won = false
    lost = false
    winText = null
    elapsedSecs = 0
    loop.markDirty()
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      startLevel((levelIndex + 1) % LEVEL_COUNT)
    }, delayMs)
  }

  const finishFlight = (): void => {
    if (flying === null) return
    const flight = flying.flight
    flying = null
    let wateredCount = 0
    const center = cellCenter(computeLayout(level), level, flight.path[flight.path.length - 1]!)
    if (flight.outcome === 'landed') {
      wateredCount = irrigate(level, watered, flight.landing)
      if (wateredCount > 0) {
        particles.burst(center.x, center.y, THEME.good, 14, 120)
      } else {
        particles.burst(center.x, center.y, THEME.textMuted, 6, 70)
      }
    } else {
      particles.burst(center.x, center.y, THEME.bad, 8, 90)
    }
    trails.push({ path: flight.path, outcome: flight.outcome, wateredCount })
    if (trails.length > TRAIL_LIMIT) trails = trails.slice(trails.length - TRAIL_LIMIT)
    seedsLeft -= 1
    preview = null
    if (isWon(level, watered)) {
      won = true
      winText = '第 ' + (levelIndex + 1) + ' 关完成 · 剩余种子 ' + seedsLeft
      if (levelIndex !== lastScoreLevel) {
        lastScoreLevel = levelIndex
        options?.onScore?.(computeScore(levelIndex, seedsLeft, elapsedSecs))
      }
      if (running) scheduleAdvance(ADVANCE_MS)
    } else if (hasLost(level, seedsLeft, watered)) {
      lost = true
    }
    loop.markDirty()
  }

  /** 播种：可播格 + 有种子 + 当前无种子在飞。 */
  const plant = (cell: number): void => {
    if (!running || won || lost || helpOpen || seedsLeft <= 0 || flying !== null) return
    if (cell < 0 || !isPlantable(level.cells[cell]!)) return
    const flight = simulate(level, cell)
    flying = { flight, t: 0 }
    preview = null
    loop.markDirty()
  }

  /** 空格试放：预览悬停格的完整轨迹（不消耗种子）。 */
  const showPreview = (): void => {
    if (!running || won || lost || helpOpen || hover < 0) return
    if (!isPlantable(level.cells[hover]!)) return
    preview = simulate(level, hover)
    loop.markDirty()
  }

  const onMouseDown = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    // 说明按钮任何阶段（含暂停/过关/失败）都可点。
    if (helpButtonHit(computeLayout(level), x, y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (!running || helpOpen) return
    plant(cellAt(computeLayout(level), level, x, y))
  }

  const onMouseMove = (event: MouseEvent): void => {
    const cellBefore = hover
    if (!running || helpOpen) {
      hover = -1
    } else {
      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
      const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
      hover = cellAt(computeLayout(level), level, x, y)
    }
    if (hover !== cellBefore) {
      // 移出预览格即清预览，避免预览与悬停错位。
      preview = null
      loop.markDirty()
    }
  }

  const onMouseLeave = (): void => {
    if (hover !== -1 || preview !== null) {
      hover = -1
      preview = null
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      startLevel(levelIndex)
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'Space') {
      event.preventDefault()
      showPreview()
    }
  }

  const renderOnce = (): void => {
    renderCloudSeeds(ctx, level, {
      level: levelIndex + 1,
      seedsLeft: Math.max(0, seedsLeft),
      wateredTotal: countFields(level) - remainingFields(),
      fieldsTotal: countFields(level),
      watered,
      hover,
      preview,
      flying,
      trails,
      paused: !running && !won && !lost,
      won,
      lost,
      winText,
      helpOpen,
      timeSec,
    }, particles, 16)
  }

  /** 未浇灌田数（HUD 进度）。 */
  const remainingFields = (): number => {
    let count = 0
    for (let i = 0; i < level.cells.length; i += 1) {
      if (level.cells[i] === CELL_FIELD && watered[i] === 0) count += 1
    }
    return count
  }

  const loop = createFrameLoop(f => {
    const active = running && !won && !lost && !helpOpen
    if (active) {
      timeSec += f.dt
      elapsedSecs += f.dt
    }
    if (active && flying !== null) {
      flying.t += f.dt / Math.max(1, flying.flight.path.length * CELL_FLY_SEC)
      if (flying.t >= 1) finishFlight()
    }
    const animating = particles.size() > 0 || flying !== null
    if (active || animating || f.render) renderOnce()
    // 流场/云朵动画期间逐帧重绘；静止（暂停/过关/说明）时零重绘。
    if (active || animating) loop.markDirty()
  }, { mode: 'dirty' })

  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    renderOnce()
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.markDirty()
    loop.resume()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const cloudseedsGame: MiniGameDefinition = {
  id: 'cloudseeds',
  title: '云中播种 CloudSeeds',
  icon: '☁️',
  description: '风向对了才能下雨——在云里撒种子，把每块田都浇到。',
  controls: ['点击天空/云格：播种', '空格 预览轨迹 · R 重开 · P 暂停'],
  create: createCloudSeedsGame,
}

