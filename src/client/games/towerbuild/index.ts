/**
 * 层叠塔 TowerBuild 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 空格 / 点击放块，R 重开本关、P 暂停、H 或右下角按钮开合帮助面板
 * （任何阶段可看）。连续帧循环（吊索摆动 + 倒塌散块动画），分数变化
 * 时上报 onScore，过关自动进入下一关，失败 / 通关由空格或 R 重开。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { createState, restartLevel, place, step, type TowerBuildState } from './logic.ts'
import { LOGICAL_W, LOGICAL_H, renderTower, helpButtonHit } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

/** 过关时的粒子喷发位置（屏幕逻辑坐标，与 render 常量对应）。 */
const BURST_Y = 300

function createTowerBuildGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: towerbuild needs a 2d canvas context')
  const ctx = initialFit.ctx

  const newSeed = (): number => (Math.random() * 0xffffffff) >>> 0
  let state: TowerBuildState = createState(0, newSeed())
  let running = false
  let helpOpen = false
  let lastScore = -1
  let lastPhase = state.phase
  const particles = createParticles()

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const restart = (): void => {
    state = restartLevel(state, newSeed())
    lastScore = -1
    lastPhase = state.phase
    reportScore()
  }

  const doDrop = (): void => {
    if (state.phase !== 'swing') return
    const result = place(state)
    if (result === 'placed' || result === 'cleared') {
      reportScore()
      const top = state.blocks[state.blocks.length - 1]
      if (top !== undefined) particles.burst(480 + top.cx, BURST_Y, THEME.good, 6, 90)
    }
    if (result === 'cleared') {
      particles.burst(LOGICAL_W / 2, BURST_Y, THEME.gold, 24, 180)
    }
  }

  const toLogical = (event: MouseEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    const p = toLogical(event)
    // 说明按钮永远最先命中（渲染时也画在最上层）。
    if (helpButtonHit(p.x, p.y)) {
      helpOpen = !helpOpen
      return
    }
    if (helpOpen) {
      helpOpen = false
      return
    }
    if (!running) return
    if (state.phase === 'over') {
      restart()
      return
    }
    doDrop()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    switch (event.code) {
      case 'Space':
        event.preventDefault()
        if (!running || helpOpen) return
        if (state.phase === 'over') restart()
        else doDrop()
        break
      case 'KeyR':
        event.preventDefault()
        restart()
        break
      case 'KeyP':
        event.preventDefault()
        togglePause()
        break
      case 'KeyH':
        event.preventDefault()
        helpOpen = !helpOpen
        break
    }
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    if (!helpOpen) step(state, f.dt * 1000)
    // 阶段跃迁检测（logic 的 step 内部换关 / 判负）。
    if (state.phase === 'cleared' && lastPhase !== 'cleared') {
      particles.burst(LOGICAL_W / 2, BURST_Y, THEME.gold, 24, 180)
    }
    lastPhase = state.phase
    reportScore()
    renderTower(ctx, state, { paused: false, helpOpen }, particles, f.dt * 1000)
  }

  const loop = createFrameLoop(frame)

  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    renderTower(ctx, state, { paused: true, helpOpen })
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.start()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  renderTower(ctx, state, { paused: false, helpOpen })
  reportScore()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      initialFit.dispose()
    },
  }
}

export const towerbuildGame: MiniGameDefinition = {
  id: 'towerbuild',
  title: '层叠塔 TowerBuild',
  icon: '🪜',
  description: '一块块吊起叠成高塔——重心偏了就晃，晃大了就塌，手稳心细方能封顶。',
  controls: [
    '空格 / 点击：放下吊着的方块',
    'R：重开本关 · P：暂停 · H / 右下角：说明',
  ],
  create: createTowerBuildGame,
}
