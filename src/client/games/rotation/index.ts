/**
 * 转盘密码游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 点击圆环
 * 或数字键选层、←/→ 旋转选中层、R 重开本关、P 暂停、H 或说明按钮开合
 * 帮助面板（任何阶段）、过关后 N 进入下一关。旋转补间动画期间持续重
 * 绘，静止时 dirty 按需。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  advanceLevel, createRotationState, restartLevel, rotateLayer, type RotationState,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, closeHelp, helpButtonAt, isAnimating, renderRotation, ringIndexAt,
  toggleHelp,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

function createRotationGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: rotation needs a 2d canvas context')
  const ctx = fit.ctx

  let state: RotationState = createRotationState()
  let running = false
  let lastScore = -1

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

  const onPointerDown = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    // 说明按钮任何阶段（含暂停/过关）可开合。
    if (helpButtonAt(x, y)) {
      toggleHelp()
      loop.markDirty()
      return
    }
    if (!running || state.status !== 'playing') return
    const i = ringIndexAt(x, y, state.board.layers.length)
    if (i !== null && i !== state.selectedLayer) {
      state.selectedLayer = i
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyP') {
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
    if (event.code === 'KeyN') {
      event.preventDefault()
      if (state.status === 'won') {
        advanceLevel(state)
        reportScore()
        loop.markDirty()
      }
      return
    }
    if (!running || state.status !== 'playing') return
    const digit = /^Digit([1-6])$/.exec(event.code)
    if (digit !== null) {
      event.preventDefault()
      const i = Number(digit[1]) - 1
      if (i < state.board.layers.length && i !== state.selectedLayer) {
        state.selectedLayer = i
        loop.markDirty()
      }
      return
    }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault()
      rotateLayer(state, state.selectedLayer, event.code === 'ArrowRight' ? 1 : -1)
      reportScore()
      loop.markDirty()
    }
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    if (isAnimating()) loop.markDirty()
    if (f.render) renderRotation(ctx, state, { paused: false })
  }

  const loop = createFrameLoop(frame, { mode: 'dirty' })
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    running = false
    loop.pause()
    renderRotation(ctx, state, { paused: true })
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.start()
    loop.markDirty()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
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
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const rotationGame: MiniGameDefinition = {
  id: 'rotation',
  title: '转盘密码 Rotation',
  icon: '☸️',
  description: '多层同心转盘，缺口要对齐成通路——转哪层、转几格，是门学问。',
  controls: [
    '点击圆环或按 1-6 选层，←/→ 旋转选中层',
    'R 重开 · P 暂停 · H 说明 · N 下一关',
  ],
  create: createRotationGame,
}
