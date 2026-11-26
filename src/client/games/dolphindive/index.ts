/**
 * 海豚跃浪游戏定义：把纯逻辑接成 {@link MiniGameInstance}——按住空格
 * 蓄力、松开跃出；空中空格翻滚；↑↓ 调起跳角；R 重开、P 暂停；
 * 「说明」按钮任何阶段可开合。continuous 帧循环。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  adjustAngle, airFlip, createDolphinDiveState, releaseJump,
  startCharge, stepDolphinDive, type DolphinDiveState,
} from './logic.ts'
import { HELP_RECT, LOGICAL_H, LOGICAL_W, renderDolphinDive, type DolphinView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'
import { createParticles } from '../theme.ts'

function createDolphinDiveGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: dolphindive needs a 2d canvas context')
  const ctx = initialFit.ctx

  let state: DolphinDiveState = createDolphinDiveState((Date.now() & 0x7fffffff) >>> 0)
  const view: DolphinView = {
    helpOpen: false,
    paused: false,
    timeMs: 0,
    particles: createParticles(),
  }
  let running = false
  let lastScore = -1

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const toggleHelp = (): void => {
    view.helpOpen = !view.helpOpen
  }

  const restart = (): void => {
    state = createDolphinDiveState((Date.now() & 0x7fffffff) >>> 0)
    lastScore = -1
    view.helpOpen = false
  }

  /** 点击画布：命中说明按钮则开合帮助；否则等价空格（蓄力/空翻）。 */
  const onMouseDown = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * LOGICAL_W
    const y = ((event.clientY - rect.top) / rect.height) * LOGICAL_H
    if (x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h) {
      toggleHelp()
      return
    }
    if (!running || view.paused || view.helpOpen) return
    if (state.phase === 'swim') startCharge(state)
    else if (state.phase === 'air') airFlip(state)
  }

  const onMouseUp = (): void => {
    if (!running || view.paused || view.helpOpen) return
    if (state.phase === 'charge') releaseJump(state)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'Space') {
      event.preventDefault()
      if (event.repeat) return
      if (!running || view.paused || view.helpOpen) return
      if (state.phase === 'swim') startCharge(state)
      else if (state.phase === 'air') airFlip(state)
    } else if (event.code === 'ArrowUp') {
      event.preventDefault()
      if (!running || view.paused || view.helpOpen) return
      adjustAngle(state, 1)
    } else if (event.code === 'ArrowDown') {
      event.preventDefault()
      if (!running || view.paused || view.helpOpen) return
      adjustAngle(state, -1)
    } else if (event.code === 'KeyR') {
      event.preventDefault()
      if (state.phase === 'over' || !view.paused) restart()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    if (!running || view.paused || view.helpOpen) return
    if (state.phase === 'charge') releaseJump(state)
  }

  const frame = (f: FrameInfo): void => {
    if (!running || view.paused) return
    const dtMs = Math.round(f.dt * 1000)
    stepDolphinDive(state, f.dt)
    reportScore()
    if (f.render) renderDolphinDive(ctx, state, view, dtMs)
  }

  const loop = createFrameLoop(frame)
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    running = false
    view.paused = true
    loop.pause()
    renderDolphinDive(ctx, state, view, 16)
  }
  const resume = (): void => {
    if (running) return
    running = true
    view.paused = false
    loop.start()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  focusGameHost(host)
  running = true
  loop.start()
  renderDolphinDive(ctx, state, view, 16)

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      initialFit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    },
  }
}

export const dolphindiveGame: MiniGameDefinition = {
  id: 'dolphindive',
  title: '海豚跃浪 DolphinDive',
  icon: '🐬',
  description: '加速、跃出、空翻入水——一条抛物线的艺术，水花越大分越高。',
  controls: ['按住空格蓄力，松开跃出；空中空格空翻，↑↓ 调角度', 'R 重开，P 暂停'],
  create: createDolphinDiveGame,
}
