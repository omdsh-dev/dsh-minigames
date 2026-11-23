/**
 * 记忆路径 TrailMemory 游戏定义：把纯逻辑与渲染接成 MiniGameInstance。
 * 闪现与计时全部由帧循环注入 dt 推进（暂停即停帧，天然冻结）；
 * 点击复现、空格重看、R 重开、P 暂停、H / 右下角按钮开合帮助面板
 * （任何阶段可看）。dirty 模式按需重绘，闪现/停顿/错闪/粒子期间逐帧。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  advanceShow, clickCell, createTrailMemoryState, mulberry32, startRound, useReplay,
  type TrailMemoryState,
} from './logic.ts'
import {
  LOGICAL_W, LOGICAL_H, cellAt, cellRect, helpButtonHit, renderTrailMemory,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 过关后整条路径绿闪庆祝的停顿时长（毫秒）。 */
const SETTLE_MS = 700
/** 错步红闪时长（毫秒）。 */
const WRONG_FLASH_MS = 500

function createTrailMemoryGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: trailmemory needs a 2d canvas context')
  const ctx = initialFit.ctx

  let state: TrailMemoryState = freshState()
  let running = false
  let helpOpen = false
  let settleRemaining = 0
  /** 过关停顿期绿闪的旧路径（新一轮路径不能提前外泄）。 */
  let settleCells: number[] | null = null
  let wrongCell: number | null = null
  let wrongFlashMs = 0
  let lastScore = -1
  const particles = createParticles()

  /** 新开一局（R）：随机种子，与首局同构。 */
  function freshState(): TrailMemoryState {
    const seeded = createTrailMemoryState(mulberry32((Math.random() * 4294967296) >>> 0))
    startRound(seeded)
    return seeded
  }

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const toLogical = (event: MouseEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const flashWrong = (cell: number): void => {
    wrongCell = cell
    wrongFlashMs = WRONG_FLASH_MS
  }

  const onMouseDown = (event: MouseEvent): void => {
    const p = toLogical(event)
    // 说明按钮 / 面板永远最先命中（渲染时也画在最上层）。
    if (helpButtonHit(p.x, p.y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (helpOpen) {
      helpOpen = false
      loop.markDirty()
      return
    }
    if (!running || state.phase !== 'input') return
    const cell = cellAt(p.x, p.y)
    if (cell === -1) return
    // clickCell 过关即切换到新一轮路径；庆祝/粒子要用点击前的旧路径。
    const prevPath = [...state.path]
    const result = clickCell(state, cell)
    if (result === 'step') {
      loop.markDirty()
    } else if (result === 'round-clear') {
      settleRemaining = SETTLE_MS
      settleCells = prevPath
      reportScore()
      const r = cellRect(prevPath[prevPath.length - 1] ?? 0)
      particles.burst(r.x + r.w / 2, r.y + r.h / 2, THEME.good, 18, 160)
      loop.markDirty()
    } else if (result === 'retry') {
      flashWrong(cell)
      loop.markDirty()
    } else if (result === 'game-over') {
      flashWrong(cell)
      reportScore()
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      state = freshState()
      settleRemaining = 0
      settleCells = null
      wrongCell = null
      wrongFlashMs = 0
      lastScore = -1
      reportScore()
      loop.markDirty()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
    } else if (event.code === 'Space') {
      event.preventDefault()
      if (running && useReplay(state)) loop.markDirty()
    }
  }

  const loop = createFrameLoop(f => {
    const dtMs = f.dt * 1000
    // 帧驱动计时：暂停即停帧，所有动效随暂停自然冻结。
    if (settleRemaining > 0) {
      settleRemaining = Math.max(0, settleRemaining - dtMs)
      if (settleRemaining === 0) settleCells = null
    }
    if (wrongFlashMs > 0) {
      wrongFlashMs = Math.max(0, wrongFlashMs - dtMs)
      if (wrongFlashMs === 0) wrongCell = null
    }
    if (state.phase === 'showing' && settleRemaining <= 0) advanceShow(state, dtMs)
    const animating = state.phase === 'showing' || settleRemaining > 0
      || wrongFlashMs > 0 || particles.size() > 0
    if (animating) loop.markDirty()
    if (f.render || animating) {
      renderTrailMemory(ctx, state, {
        paused: !running, helpOpen, settleCells, wrongCell,
      }, particles, dtMs)
    }
  }, { mode: 'dirty' })

  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    renderTrailMemory(ctx, state, { paused: true, helpOpen, settleCells: null, wrongCell })
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.resume()
    loop.markDirty()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
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
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
      initialFit.dispose()
    },
  }
}

export const trailmemoryGame: MiniGameDefinition = {
  id: 'trailmemory',
  title: '记忆路径 TrailMemory',
  icon: '🧶',
  description: '路径一闪而过——凭记忆把每一步重走出来，越走越长看你记到第几层。',
  controls: [
    '点击格子按序复现路径；空格重看一次',
    'R：重开 · P：暂停 · H / 右下角：说明',
  ],
  create: createTrailMemoryGame,
}
