/**
 * 开花连消 Bloom 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 点击花苞触发同色连锁绽放（涟漪动画逐层展开），方向键 + 回车也可
 * 触发；R 重开本关、P 暂停、H 或右下角按钮随时开合帮助面板。过关
 * 自动进入下一关（进度走 level-progress 持久化），胜利时全田绽放
 * 粒子庆祝并上报 onScore。dirty 模式按需重绘，涟漪动画期间逐帧。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { GRID, LEVEL_COUNT, clickCell, generateBoard, type BloomState } from './logic.ts'
import {
  LOGICAL_W, LOGICAL_H, BOARD_X, BOARD_Y, CELL, GAP, gridCellAt, helpButtonHit,
  renderBloom, type RippleAnim,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, accent, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1800
/** 涟漪动画总时长 = 最大波次 × 每波延迟 + 收尾（与 render 的常量一致）。 */
const LAYER_S = 0.16

function createBloomGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: bloom needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  // 持久化进度为 1 起；本游戏 level 为 0 起。
  let level = Math.min(readLevel('bloom'), LEVEL_COUNT) - 1
  let state: BloomState = freshState(level, 0)
  let running = false
  let helpOpen = false
  let hoverIndex = -1
  let cursor = { r: 0, c: 0 }
  /** 进行中的连锁涟漪（logic 已结算，动画纯表现）。 */
  let anim: RippleAnim | null = null
  let winText: string | null = null
  let advanceTimer = 0
  let advanceRemaining = 0
  let advanceAt = 0
  let lastScore = -1
  const particles = createParticles()

  function freshState(next: number, carryScore: number): BloomState {
    const seed = (Math.random() * 0x7fffffff) | 0
    const generated = generateBoard(next + 1, seed)
    if (generated === null) throw new Error('dsh-minigames: bloom level generation failed')
    generated.score = carryScore
    return generated
  }

  const startLevel = (next: number, carryScore: number): void => {
    level = next
    state = freshState(next, carryScore)
    winText = null
    hoverIndex = -1
    anim = null
    clearTimeout(advanceTimer)
    advanceTimer = 0
    advanceRemaining = 0
    reportScore()
    repaint()
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceAt = performance.now() + delayMs
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      const next = (level + 1) % LEVEL_COUNT
      saveLevel('bloom', Math.max(readLevel('bloom'), next + 1))
      startLevel(next, state.score)
    }, delayMs)
  }

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  /** 暂停中 rAF 已停：直接整幅重绘；运行中交给 markDirty。 */
  const repaint = (): void => {
    if (running) {
      loop.markDirty()
      return
    }
    renderBloom(ctx, state, view(), particles, 0)
  }

  const view = () => ({
    paused: !running,
    helpOpen,
    hoverIndex,
    cursorIndex: cursor.r * GRID + cursor.c,
    anim,
    winText,
  })

  /** 执行一次点击：结算连锁、启动涟漪、判胜负、上报分数。 */
  const doClick = (index: number): void => {
    if (state.status !== 'playing') return
    const result = clickCell(state, index)
    if (result === null) {
      repaint()
      return
    }
    anim = { steps: result.steps, t: 0 }
    reportScore()
    if (result.won) {
      winText = '第 ' + state.level + ' 关 · 累计 ' + state.score + ' 分'
      // 全田绽放粒子：中心一簇 + 随机几朵花上各一小簇。
      particles.burst(LOGICAL_W / 2, 330, THEME.gold, 26, 180)
      for (let k = 0; k < 5; k += 1) {
        const i = (Math.random() * GRID * GRID) | 0
        const cx = BOARD_X + (i % GRID) * (CELL + GAP) + CELL / 2
        const cy = BOARD_Y + Math.floor(i / GRID) * (CELL + GAP) + CELL / 2
        particles.burst(cx, cy, accent(i % GRID), 6, 110)
      }
      if (running) scheduleAdvance(ADVANCE_MS)
      else advanceRemaining = ADVANCE_MS
    }
    repaint()
  }

  const toLogical = (event: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    const p = toLogical(event)
    // 说明按钮 / 面板永远最先命中（渲染时也画在最上层）。
    if (helpButtonHit(p.x, p.y)) {
      helpOpen = !helpOpen
      repaint()
      return
    }
    if (helpOpen) {
      helpOpen = false
      repaint()
      return
    }
    if (!running || state.status !== 'playing') return
    const index = gridCellAt(p.x, p.y)
    if (index < 0) return
    cursor = { r: Math.floor(index / GRID), c: index % GRID }
    doClick(index)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!running || state.status !== 'playing') return
    const p = toLogical(event)
    const index = gridCellAt(p.x, p.y)
    if (index !== hoverIndex) {
      hoverIndex = index
      repaint()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    switch (event.code) {
      case 'KeyR':
        event.preventDefault()
        startLevel(level, 0)
        return
      case 'KeyP':
        event.preventDefault()
        togglePause()
        return
      case 'KeyH':
        event.preventDefault()
        helpOpen = !helpOpen
        repaint()
        return
    }
    if (!running || state.status !== 'playing') return
    switch (event.code) {
      case 'ArrowUp':
        event.preventDefault()
        cursor = { r: Math.max(0, cursor.r - 1), c: cursor.c }
        break
      case 'ArrowDown':
        event.preventDefault()
        cursor = { r: Math.min(GRID - 1, cursor.r + 1), c: cursor.c }
        break
      case 'ArrowLeft':
        event.preventDefault()
        cursor = { r: cursor.r, c: Math.max(0, cursor.c - 1) }
        break
      case 'ArrowRight':
        event.preventDefault()
        cursor = { r: cursor.r, c: Math.min(GRID - 1, cursor.c + 1) }
        break
      case 'Enter':
      case 'Space':
        event.preventDefault()
        doClick(cursor.r * GRID + cursor.c)
        break
      default:
        return
    }
    repaint()
  }

  const loop = createFrameLoop((f) => {
    // 渲染异常冒泡会杀死 rAF 链（画面冻结、点击无响应、无结算遮罩）——
    // 包一层让异常可见且不吞掉循环：抛错也继续调度下一帧。
    try {
      if (anim !== null) {
        anim.t += f.dt
        let maxLayer = 0
        for (const s of anim.steps) {
          if (s.layer > maxLayer) maxLayer = s.layer
        }
        if (anim.t >= maxLayer * LAYER_S + 1.6) anim = null
      }
      const animating = anim !== null || particles.size() > 0
      if (f.render || animating) {
        renderBloom(ctx, state, view(), particles, f.dt * 1000)
        if (animating) loop.markDirty()
      }
    } catch (e) {
      console.error('[dsh-minigames/bloom] frame error:', e)
    }
  }, { mode: 'dirty' })

  const pause = (): void => {
    if (!running) return
    running = false
    if (advanceTimer !== 0) {
      clearTimeout(advanceTimer)
      advanceTimer = 0
      advanceRemaining = Math.max(0, advanceAt - performance.now())
    }
    loop.pause()
    renderBloom(ctx, state, view(), particles, 0)
  }
  const resume = (): void => {
    if (running) return
    running = true
    if (advanceRemaining > 0) {
      scheduleAdvance(advanceRemaining)
      advanceRemaining = 0
    }
    loop.markDirty()
    loop.resume()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  renderBloom(ctx, state, view(), particles, 0)

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const bloomGame: MiniGameDefinition = {
  id: 'bloom',
  title: '开花连消 Bloom',
  icon: '🌺',
  description: '同色花苞相邻就会绽放——一片花田连锁开满的高光时刻。',
  controls: [
    '点击花苞绽放同色连锁（方向键+回车亦可）',
    'R：重开 · P：暂停 · H / 右下角：说明',
  ],
  create: createBloomGame,
}
