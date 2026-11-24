/**
 * 字母雨 TypeFall 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 字母键接住下落字母（焦点内才响应并 preventDefault）、R 重开（新种子）、
 * P 暂停、H 或右上角「说明」按钮开合帮助面板（任何阶段可用）。continuous
 * 帧循环驱动 dt 模拟，溅落事件转为粒子爆发，分数变化时上报 onScore。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { createTypeFallState, pressLetter, tickTypeFall, type TypeFallState } from './logic.ts'
import { renderTypeFall, helpButtonHit, LOGICAL_W, LOGICAL_H } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { accent, createParticles, THEME, type ParticleSystem } from '../theme.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

/** 溅落事件转粒子。 */
function drainSplats(state: TypeFallState, particles: ParticleSystem): void {
  for (const s of state.pendingSplats) {
    particles.burst(s.x, s.y, s.kind === 'hit' ? accent(2) : THEME.bad, s.kind === 'hit' ? 12 : 16, s.kind === 'hit' ? 140 : 170)
  }
  state.pendingSplats.length = 0
}

function createTypeFallGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: typefall needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  let state = createTypeFallState((Math.random() * 0x7fffffff) | 0)
  let running = false
  let helpOpen = false
  let lastScore = -1
  const particles = createParticles()

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const restart = (): void => {
    state = createTypeFallState((Math.random() * 0x7fffffff) | 0)
    lastScore = -1
  }

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  const toLogical = (event: MouseEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  // 说明按钮 / 帮助面板永远最先命中（渲染时也画在最上层）。
  const onMouseDown = (event: MouseEvent): void => {
    const p = toLogical(event)
    if (helpButtonHit(p.x, p.y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (helpOpen) {
      helpOpen = false
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    // 浏览器快捷键（Ctrl/Cmd+R 刷新等）留给浏览器。
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const letter = /^[a-zA-Z]$/.test(event.key) ? event.key.toUpperCase() : null
    if (letter !== null && !event.repeat && running && !state.over && !state.won && !helpOpen) {
      event.preventDefault()
      pressLetter(state, letter)
      return
    }
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
    }
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    const dtMs = f.dt * 1000
    tickTypeFall(state, dtMs)
    drainSplats(state, particles)
    reportScore()
    if (f.render) {
      renderTypeFall(ctx, state, { paused: false, helpOpen })
      particles.tick(ctx, dtMs)
    }
  }

  const loop = createFrameLoop(frame, { mode: 'continuous' })

  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    // 暂停冻结一切（模拟全走 dt），只补一帧带遮罩的画面。
    renderTypeFall(ctx, state, { paused: true, helpOpen })
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.start()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  renderTypeFall(ctx, state, { paused: false, helpOpen })

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const typefallGame: MiniGameDefinition = {
  id: 'typefall',
  title: '字母雨 TypeFall',
  icon: '⌨',
  description: '字母往下掉，拼出屏幕上的单词——手速与词汇量的双重考验。',
  controls: ['字母键：接住下落的字母', 'R 重开 · P 暂停 · H 说明'],
  create: createTypeFallGame,
}
