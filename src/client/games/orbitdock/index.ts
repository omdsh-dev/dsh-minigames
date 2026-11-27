/**
 * 「轨道交会 OrbitDock」游戏定义：把纯逻辑接成 MiniGameInstance。
 * 暂停（未推进）时从飞船拖出箭头设定 ΔV，空格执行脉冲并继续模拟，
 * 再按空格暂停规划第二脉冲；P 暂停遮罩、R 同 seed 重开本关、H 或点
 * 「说明」开合帮助面板（任何阶段可用，渲染层画在最后）。continuous
 * 帧循环（轨迹渐隐与读数逐帧刷新）；挂载时立即渲染一帧（不依赖 rAF
 * 首帧），帧回调 try-catch 包裹，渲染异常只记录不中断循环。过关后
 * 空格 / R 进入下一关；第 5 关对接为整场通关。onScore 在每次过关时
 * 上报累计总分（关卡 ×1000 + 剩余 ΔV 折算）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  LEVEL_COUNT, LOGICAL_H, LOGICAL_W, commitBurn, createDock, generateStarfield,
  setPendingDv, stepDock,
  type DockState,
} from './logic.ts'
import { HELP_RECT, renderOrbitDock, type OrbitDockView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'
import { THEME, createParticles } from '../theme.ts'

/** 拖拽像素 → ΔV 换算（px/s 每 px）。 */
const DRAG_TO_DV = 0.25
/** 视为取消脉冲的最小拖拽像素。 */
const MIN_DRAG_PX = 4

function createOrbitDockGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: orbitdock needs a 2d canvas context')
  const ctx = initialFit.ctx

  const seed = Math.floor(Math.random() * 0x80000000)
  let state: DockState = createDock(1, seed)
  let running = false
  let paused = false
  let helpOpen = false
  let lastScore = -1
  const particles = createParticles()
  const view: OrbitDockView = {
    running: false,
    paused: false,
    helpOpen: false,
    particles,
    dtMs: 16,
    stars: generateStarfield(seed),
    drag: null,
  }
  const refreshView = (): void => {
    view.running = running
    view.paused = paused
    view.helpOpen = helpOpen
  }

  const reportScore = (): void => {
    if (state.scoreTotal === lastScore) return
    lastScore = state.scoreTotal
    options?.onScore?.(state.scoreTotal)
  }

  const toLogical = (event: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  /** 拖拽矢量 → ΔV（相对飞船位置）。 */
  const dragToDv = (p: { x: number, y: number }): { x: number, y: number } => {
    return { x: (p.x - state.ship.x) * DRAG_TO_DV, y: (p.y - state.ship.y) * DRAG_TO_DV }
  }

  /** 是否允许拖拽设定脉冲：playing、未推进、还有脉冲次数。 */
  const canPlan = (): boolean =>
    state.status === 'playing' && !running && !paused && state.burnsUsed < 2

  let dragging = false
  const onPointerDown = (event: PointerEvent): void => {
    const p = toLogical(event)
    const inHelp =
      p.x >= HELP_RECT.x && p.x <= HELP_RECT.x + HELP_RECT.w &&
      p.y >= HELP_RECT.y && p.y <= HELP_RECT.y + HELP_RECT.h
    if (inHelp) {
      helpOpen = !helpOpen
      return
    }
    if (helpOpen) {
      helpOpen = false
      return
    }
    if (canPlan()) {
      dragging = true
      view.drag = dragToDv(p)
    }
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return
    view.drag = dragToDv(toLogical(event))
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    const p = toLogical(event)
    const px = Math.hypot(p.x - state.ship.x, p.y - state.ship.y)
    if (px < MIN_DRAG_PX) {
      state.pending = null
    } else {
      const dv = dragToDv(p)
      setPendingDv(state, dv.x, dv.y)
    }
    view.drag = null
  }

  /** 空格：playing 时执行/暂停；docked 时进下一关。 */
  const onSpace = (): void => {
    if (state.status === 'docked') {
      state = createDock(state.level + 1, seed)
      running = false
      view.drag = null
      return
    }
    if (state.status === 'failed' || state.status === 'allClear') {
      restart()
      return
    }
    if (paused) {
      paused = false
      return
    }
    if (!running) {
      commitBurn(state)
      running = true
    } else {
      running = false
      view.drag = null
    }
  }

  const restart = (): void => {
    const lv = state.status === 'allClear' ? 1 : state.level
    state = createDock(lv, seed)
    running = false
    view.drag = null
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'Space') {
      event.preventDefault()
      onSpace()
      return
    }
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      if (state.status !== 'playing') return
      paused = !paused
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
    }
  }

  // continuous：轨迹渐隐、读数与箭头逐帧刷新。帧回调 try-catch：渲染
  // 异常只记录，绝不杀死 rAF 链（蜂群事故教训）。
  const loop = createFrameLoop(f => {
    try {
      if (running && !paused && state.status === 'playing') {
        stepDock(state, f.dt * 1000)
      }
      for (const ev of state.events) {
        if (ev.type === 'burn') particles.burst(ev.x, ev.y, THEME.gold, 12, 150)
        else if (ev.type === 'fail') particles.burst(ev.x, ev.y, THEME.bad, 18, 200)
        else if (ev.type === 'clear') {
          particles.burst(ev.x, ev.y, THEME.good, 26, 220)
          reportScore()
        }
      }
      state.events.length = 0
      refreshView()
      view.dtMs = f.wallMs
      if (f.render) renderOrbitDock(ctx, state, view)
      particles.tick(ctx, f.dt * 1000)
    } catch (err) {
      console.error('dsh-minigames orbitdock frame error', err)
    }
  })

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  // 挂载立即渲染一帧：不依赖 rAF 首帧（黑屏事故教训）。
  refreshView()
  renderOrbitDock(ctx, state, view)
  loop.start()

  return {
    start: () => {
      loop.resume()
    },
    pause: () => {
      loop.pause()
      paused = true
      renderOrbitDock(ctx, state, view)
    },
    resume: () => {
      paused = false
      loop.markDirty()
      loop.resume()
    },
    destroy: () => {
      loop.destroy()
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      initialFit.dispose()
    },
  }
}

/** 注册表用的「轨道交会」定义。 */
export const orbitdockGame: MiniGameDefinition = {
  id: 'orbitdock',
  title: '轨道交会 OrbitDock',
  icon: '🛰️',
  description: '两脉冲变轨去追空间站——ΔV 就这么点，方向和时机都是学问。',
  controls: [
    '暂停时从飞船拖出箭头设定 ΔV，空格执行并继续',
    'P：暂停 · R：重开 · 点「说明」看完整规则（共 ' + LEVEL_COUNT + ' 关）',
  ],
  create: createOrbitDockGame,
}
