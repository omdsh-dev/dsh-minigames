/**
 * 蜂群算法游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 拖三滑杆
 * 实时调分离/对齐/聚合权重、空格或 P 暂停、D 切邻居连线（调试）、
 * R 重开本关、H/说明按钮开合帮助面板（任何阶段）、过关后 N 进下一关。
 * 蜂群连续模拟，frame-scheduler 走 continuous 模式每帧重绘。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  advanceLevel, createHiveMindState, restartLevel, setParam, stepHiveMind,
  type HiveMindState,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, closeHelp, helpButtonAt, isHelpOpen, renderHiveMind,
  sliderAt, sliderValueAt, toggleHelp,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

function createHiveMindGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: hivemind needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  let state: HiveMindState = createHiveMindState()
  let running = false
  let paused = false
  let showLinks = false
  let lastScore = -1
  /** 拖动中的滑杆键（null=未拖）。 */
  let dragKey: 'sep' | 'ali' | 'coh' | null = null

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const restart = (): void => {
    restartLevel(state)
    reportScore()
    loop.markDirty()
  }

  /** 逻辑坐标换算（含 dpr/letterbox 缩放逆变换）。 */
  const logicalCoords = (event: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    const p = logicalCoords(event)
    // 说明按钮任何阶段（含暂停/过关/超时）可开合。
    if (helpButtonAt(p.x, p.y)) {
      toggleHelp()
      loop.markDirty()
      return
    }
    const key = sliderAt(p.x, p.y)
    if (key !== null) {
      dragKey = key
      canvas.setPointerCapture(event.pointerId)
      setParam(state, key, sliderValueAt(key, p.x))
      loop.markDirty()
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (dragKey === null) return
    const p = logicalCoords(event)
    setParam(state, dragKey, sliderValueAt(dragKey, p.x))
    loop.markDirty()
  }

  const onPointerUp = (): void => {
    dragKey = null
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'Space' || event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
      return
    }
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      toggleHelp()
      loop.markDirty()
      return
    }
    if (event.code === 'Escape') {
      event.preventDefault()
      closeHelp()
      loop.markDirty()
      return
    }
    if (event.code === 'KeyD') {
      event.preventDefault()
      showLinks = !showLinks
      loop.markDirty()
      return
    }
    if (event.code === 'KeyN') {
      event.preventDefault()
      if (state.status === 'won') {
        advanceLevel(state)
        reportScore()
        loop.markDirty()
      }
      return
    }
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    // 暂停或帮助面板打开时不推进模拟（帮助可安心阅读）。
    if (!paused && !isHelpOpen() && state.status === 'playing') {
      stepHiveMind(state, f.dt * 1000)
      reportScore()
    }
    renderHiveMind(ctx, state, { paused, showLinks, dtMs: f.dt * 1000 })
  }

  const loop = createFrameLoop(frame, { mode: 'continuous' })
  const togglePause = (): void => {
    paused = !paused
    loop.markDirty()
  }
  const pause = (): void => {
    paused = true
    loop.pause()
    renderHiveMind(ctx, state, { paused: true, showLinks, dtMs: 0 })
  }
  const resume = (): void => {
    if (running) return
    running = true
    paused = false
    loop.start()
    loop.markDirty()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  loop.markDirty()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const hivemindGame: MiniGameDefinition = {
  id: 'hivemind',
  title: '蜂群算法 HiveMind',
  icon: '🐝',
  description: '一组简单规则涌现出复杂队形——调三条参数，看蜂群聚成什么形状。',
  controls: [
    '拖三条滑杆实时调三力（分离/对齐/聚合）',
    '空格暂停 · D 邻居连线 · R 重开 · H 说明 · N 下一关',
  ],
  create: createHiveMindGame,
}
