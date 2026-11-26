/**
 * 密码转盘接线：把纯逻辑挂进 MiniGameInstance——鼠标拖动黄铜转轮（角度
 * 步进）或点击字母环直接对齐，数字键两位缓冲自动应用偏移；Enter 提交、
 * H 提示、R 重开（同 seed 重放）、P 暂停。帮助面板任何阶段可开合，
 * 打开时拦截其它交互。dirty 渲染：转轮/提示/过关才重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  applyDigit, applyHint, createCipherWheelState, mulberry32,
  rotateWheel, setMultiplier, setWheelTarget, submitAnswer,
  type CipherWheelState,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, aChipAt, helpAt, hintAt, renderCipherWheel,
  slotAt, submitAt, wheelAt, wheelLetterAt,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'
import { createParticles, THEME } from '../theme.ts'

/** 答题反馈闪烁时长（ms）。 */
const FLASH_MS = 420

/** 逻辑坐标 -> 鼠标逻辑坐标。 */
function toLogical(canvas: HTMLCanvasElement, event: MouseEvent): { x: number, y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
    y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
  }
}

/** 鼠标相对转轮圆心的角度步进序号（0..25，供拖动差分）。 */
function wheelAngleIndex(x: number, y: number): number {
  const dx = x - 156
  const dy = y - 184
  let ang = Math.atan2(dy, dx) + Math.PI / 2
  ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return Math.round((ang / ((Math.PI * 2) / 26)) % 26)
}

/** 求两个 26 格序号的差（取 -13..12 的最短方向）。 */
function wrapDelta(from: number, to: number): number {
  let d = ((to - from) % 26 + 26) % 26
  if (d > 13) d -= 26
  return d
}

function createCipherWheelGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: cipherwheel needs a 2d canvas context')
  const ctx = fit.ctx

  const seed = Math.floor(Math.random() * 2 ** 31)
  let state: CipherWheelState = createCipherWheelState(mulberry32(seed))
  let running = false
  let helpOpen = false
  let dragging = false
  let lastWheelIndex = 0
  let flashKind: 'none' | 'good' | 'bad' = 'none'
  let flashUntil = 0
  let lastScore = -1
  const particles = createParticles()

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const flash = (kind: 'good' | 'bad'): void => {
    flashKind = kind
    flashUntil = performance.now() + FLASH_MS
  }

  const currentFlash = (): 'none' | 'good' | 'bad' => {
    return performance.now() < flashUntil ? flashKind : 'none'
  }

  /** 提交当前预览并给出反馈：正确撒粒子并推进，错误红闪。 */
  const doSubmit = (): void => {
    if (state.phase !== 'playing' || !running) return
    const result = submitAnswer(state)
    if (result === 'correct') {
      flash('good')
      particles.burst(156, 184, THEME.gold, 26, 160)
    } else {
      flash('bad')
    }
    reportScore()
    loop.markDirty()
  }

  /** 使用提示：成功绿闪一次，用满或通关则不动。 */
  const doHint = (): void => {
    if (state.phase !== 'playing' || !running) return
    const pair = applyHint(state)
    if (pair !== null) flash('good')
    loop.markDirty()
  }

  const resetGame = (): void => {
    state = createCipherWheelState(mulberry32(seed))
    helpOpen = false
    dragging = false
    flashKind = 'none'
    lastScore = -1
    reportScore()
    loop.markDirty()
  }

  const draw = (paused: boolean): void => {
    renderCipherWheel(ctx, state, { paused, flash: currentFlash(), helpOpen, dragging })
    particles.tick(ctx, 16)
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const { x, y } = toLogical(canvas, event)
    // 帮助面板打开：任意点击关闭（说明按钮自身切换）。
    if (helpOpen) {
      if (!helpAt(x, y)) helpOpen = false
      loop.markDirty()
      return
    }
    if (helpAt(x, y)) {
      helpOpen = true
      loop.markDirty()
      return
    }
    if (state.phase === 'won' || !running) return
    if (submitAt(x, y)) {
      doSubmit()
      return
    }
    if (hintAt(x, y)) {
      doHint()
      return
    }
    const kind = state.challenge.kind
    if (kind === 'vigenere') {
      const slot = slotAt(x, y, state.wheel.keyOffsets.length)
      if (slot !== null) {
        state.wheel.selectedSlot = slot
        loop.markDirty()
        return
      }
    }
    if (kind === 'affine') {
      const chip = aChipAt(x, y)
      if (chip !== null) {
        setMultiplier(state, chip)
        loop.markDirty()
        return
      }
    }
    if (wheelAt(x, y)) {
      // 点击外环字母带：直接对齐到该字母序号；否则记录起点进入拖动。
      const letter = wheelLetterAt(x, y)
      if (letter !== null) {
        setWheelTarget(state, letter)
        loop.markDirty()
      }
      dragging = true
      lastWheelIndex = wheelAngleIndex(x, y)
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!running || !dragging) return
    const { x, y } = toLogical(canvas, event)
    const idx = wheelAngleIndex(x, y)
    const delta = wrapDelta(lastWheelIndex, idx)
    lastWheelIndex = idx
    if (delta !== 0) {
      rotateWheel(state, delta)
      loop.markDirty()
    }
  }

  const onMouseUp = (): void => {
    if (!dragging) return
    dragging = false
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      resetGame()
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      if (helpOpen) {
        helpOpen = false
        loop.markDirty()
        return
      }
      doHint()
      return
    }
    if (event.code === 'Enter') {
      event.preventDefault()
      if (helpOpen) {
        helpOpen = false
        loop.markDirty()
        return
      }
      doSubmit()
      return
    }
    if (helpOpen || state.phase === 'won' || !running) return
    if (event.code === 'ArrowUp') {
      event.preventDefault()
      rotateWheel(state, 1)
      loop.markDirty()
    } else if (event.code === 'ArrowDown') {
      event.preventDefault()
      rotateWheel(state, -1)
      loop.markDirty()
    } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault()
      if (state.challenge.kind === 'vigenere' && state.wheel.keyOffsets.length > 0) {
        const dir = event.code === 'ArrowRight' ? 1 : -1
        const n = state.wheel.keyOffsets.length
        state.wheel.selectedSlot = ((state.wheel.selectedSlot + dir) % n + n) % n
        loop.markDirty()
      }
    } else if (event.key >= '0' && event.key <= '9') {
      event.preventDefault()
      applyDigit(state, event.key)
      loop.markDirty()
    }
  }

  const loop = createFrameLoop((frame) => {
    if (currentFlash() !== 'none' || particles.size() > 0) loop.markDirty()
    if (frame.render) draw(pausedFlag())
  }, { mode: 'dirty' })

  const pausedFlag = (): boolean => !running

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    dragging = false
    loop.pause()
    draw(true)
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.resume()
    loop.markDirty()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
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
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const cipherwheelGame: MiniGameDefinition = {
  id: 'cipherwheel',
  title: '密码转盘 CipherWheel',
  icon: '🔐',
  description: '字母轮盘转几格才是密钥？古典替换密码等你破译——频率分析是朋友。',
  controls: ['拖动转轮 / ↑↓ / 数字键：设偏移；Enter 提交', 'H 提示 · R 重开 · P 暂停 · 点击「说明」看玩法'],
  create: createCipherWheelGame,
}
