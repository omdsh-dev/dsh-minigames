/**
 * 解绳谜题 Planarity 游戏定义：把纯逻辑与渲染器接成 MiniGameInstance。
 * 指针拖动顶点（拖动跟随、实时交叉复查），R 重开本关（同 baseSeed，
 * 同一盘题），P 暂停 / 继续，H 或点击「说明」开关帮助面板（任何阶段
 * 可开合，打开时暂停计时）。过关时顶点平滑归位到理想布局 + 粒子庆祝，
 * 动画结束后自动进入下一关；全部通关后 R 开新的一局（新种子）。
 * 渲染走 dirty 模式：静止盘面零重绘，拖拽 / 计时秒变 / 动画 / 粒子
 * 才标记重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  LEVEL_COUNT, W, H, createPlanarity, dragTo, endDrag, nextLevel, startDrag, tickTime, totalScore,
  type PlanarityState,
} from './logic.ts'
import { HELP_BTN, VERTEX_R, createPlanarityRenderer } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 归位动画时长（过关 → 顶点滑回理想布局）。 */
const WIN_ANIM_MS = 900
/** 归位后停留多久再进下一关。 */
const WIN_HOLD_MS = 800
/** 顶点命中半径（略大于绘制半径，好点好拖）。 */
const HIT_R = VERTEX_R + 7

function createPlanarityGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: planarity needs a 2d canvas context')
  const ctx = fit.ctx
  const renderer = createPlanarityRenderer()

  // 每局一个基础种子：R 重开本关完全可重放；通关再开才换新种子。
  let baseSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
  let state: PlanarityState = createPlanarity(baseSeed, 0)
  let running = true
  let paused = false
  let helpOpen = false
  // 过关动画时间线：< 0 表示未在动画；[0, WIN_ANIM_MS] 归位，之后停留。
  let winElapsed = -1
  let lastScore = -1
  let lastSecond = -1

  const view = { paused: false, helpOpen: false, winAnimT: -1 }

  const reportScore = (): void => {
    const score = totalScore(state)
    if (score === lastScore) return
    lastScore = score
    options?.onScore?.(score)
  }

  const restartLevel = (): void => {
    if (state.phase === 'allwon') {
      // 全部通关后 R：开全新一局（换种子，从第 1 关重来）。
      baseSeed = (baseSeed + 0x9e3779b9 + Date.now()) >>> 0
      state = createPlanarity(baseSeed, 0)
    } else {
      // 重开本关：同种子同盘面，恢复进入本关前的银行分。
      state = createPlanarity(state.baseSeed, state.levelIndex, state.bankedScore)
    }
    winElapsed = -1
    paused = false
    loop.markDirty()
  }

  /** 指针事件坐标 → 逻辑坐标。 */
  const logicalPos = (event: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * W) / rect.width,
      y: ((event.clientY - rect.top) * H) / rect.height,
    }
  }

  const inHelpBtn = (x: number, y: number): boolean =>
    x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h

  const onPointerDown = (event: PointerEvent): void => {
    const p = logicalPos(event)
    // 说明按钮永远可点（暂停中 / 过关后也能查看规则）。
    if (inHelpBtn(p.x, p.y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (!running || paused || helpOpen || state.phase !== 'playing') return
    let hit = -1
    let best = HIT_R * HIT_R
    for (let i = 0; i < state.vertices.length; i += 1) {
      const v = state.vertices[i]!
      const d = (v.x - p.x) * (v.x - p.x) + (v.y - p.y) * (v.y - p.y)
      if (d <= best) { best = d; hit = i }
    }
    if (hit >= 0) {
      canvas.setPointerCapture(event.pointerId)
      startDrag(state, hit)
      loop.markDirty()
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (state.dragIndex < 0) return
    const p = logicalPos(event)
    dragTo(state, p)
    if (state.phase !== 'playing' && winElapsed < 0) {
      // 刚在拖动中过关：启动归位动画与庆祝。
      winElapsed = 0
      const v = state.vertices[0]!
      renderer.burst(v.x, v.y)
      reportScore()
    }
    loop.markDirty()
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (state.dragIndex < 0) return
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    endDrag(state)
    loop.markDirty()
  }

  const togglePause = (): void => {
    paused = !paused
    if (paused) loop.pause()
    else loop.resume()
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restartLevel()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
    }
  }

  const draw = (): void => {
    view.paused = paused
    view.helpOpen = helpOpen
    view.winAnimT = winElapsed < 0 ? -1 : Math.min(1, winElapsed / WIN_ANIM_MS)
    renderer.draw(ctx, state, view)
  }

  const loop = createFrameLoop(f => {
    const animating = winElapsed >= 0 || renderer.busy()
    if (!paused && !helpOpen && state.phase === 'playing' && running) {
      tickTime(state, f.dt * 1000)
      const second = Math.floor(state.timeMs / 1000)
      if (second !== lastSecond) { lastSecond = second; loop.markDirty() }
    }
    if (winElapsed >= 0) {
      winElapsed += f.dt * 1000
      if (winElapsed >= WIN_ANIM_MS + WIN_HOLD_MS && state.phase === 'won') {
        state = nextLevel(state)
        winElapsed = -1
        reportScore()
      }
      loop.markDirty()
    }
    if (f.render || animating || renderer.busy()) draw()
  }, { mode: 'dirty' })

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  loop.start()

  return {
    start: (): void => {
      if (running && loop.running) return
      running = true
      paused = false
      loop.resume()
      loop.markDirty()
    },
    pause: (): void => {
      running = false
      paused = false
      loop.pause()
      draw() // 面板收起时定格最后一帧
    },
    resume: (): void => {
      running = true
      paused = false
      loop.resume()
      loop.markDirty()
    },
    destroy: (): void => {
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

export const planarityGame: MiniGameDefinition = {
  id: 'planarity',
  title: '解绳谜题 Planarity',
  icon: '🕸',
  description: '顶点拖来拖去，让所有连线互不交叉——一团乱麻理成一张平面网。',
  controls: ['拖动圆点顶点理顺连线（红 = 交叉，绿 = 干净）', 'R：重开本关 · P：暂停 · H / 说明：帮助'],
  create: createPlanarityGame,
}
