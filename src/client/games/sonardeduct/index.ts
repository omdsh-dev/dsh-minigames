/**
 * 「声呐探物 SonarDeduct」游戏定义：把纯逻辑接成 MiniGameInstance。
 * 左键按模式发声呐 / 插旗拔旗，E 切换模式，R 用同一 seed 重开本关
 * （海域完全一致），P 暂停；点击右上「说明」开合帮助面板（任何阶段
 * 可用，渲染层画在最后）。基础 dirty 模式：波纹 / 鱼群 / 粒子活跃时
 * 逐帧 markDirty 重绘，静止时零重绘；挂载时先立即渲染一帧再启动循环，
 * 帧回调 try-catch 包裹（渲染异常只记录不中断循环）。过关遮罩下点
 * 网格或按 E 进入下一关；第 5 关完成即整场通关。onScore 在过关时上报
 * 跨关累计分。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { LEVEL_COUNT, cellIndex, createLevel, levelSeed, ping, tick, toggleMark, type SonarDeductState } from './logic.ts'
import { HELP_RECT, LOGICAL_H, LOGICAL_W, cellAt, cellCenter, renderSonar, type Mode, type SonarDeductView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'
import { createParticles } from '../theme.ts'

/** 波纹生命周期（毫秒）。 */
const RIPPLE_MS = 600

function createSonarGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: sonardeduct needs a 2d canvas context')
  const ctx = fit.ctx

  let level = 1
  let state: SonarDeductState = createLevel(levelSeed(level), level)
  let helpOpen = false
  let mode: Mode = 'ping'
  let running = false
  let carry = 0
  let lastReported = -1
  const particles = createParticles()
  const view: SonarDeductView = { paused: false, helpOpen: false, hover: null, mode: 'ping', ripples: [], particles, dtMs: 16 }

/** 上报跨关累计分（只在变化时触发）。 */
  const reportScore = (): void => {
    const total = Math.max(0, carry + state.score)
    if (total === lastReported) return
    lastReported = total
    options?.onScore?.(total)
  }

  const startLevel = (next: number): void => {
    level = next > LEVEL_COUNT ? 1 : next
    if (state.status === 'levelClear' || state.status === 'allClear') carry += Math.max(0, state.score)
    if (next > LEVEL_COUNT) carry = 0
    state = createLevel(levelSeed(level), level)
    view.ripples = []
    view.paused = false
    reportScore()
    loop.markDirty()
  }

/** 网格点击：过关遮罩下进入下一关，否则按模式执行声呐 / 插旗。 */
  const clickCell = (r: number, c: number): void => {
    if (state.status === 'levelClear' || state.status === 'allClear') {
      startLevel(level + 1)
      return
    }
    if (state.status !== 'playing') return
    if (mode === 'ping') {
      const ok = ping(state, r, c)
      if (ok) {
        const { px, py } = cellCenter(r, c)
        view.ripples.push({ x: px, y: py, age: 0 })
      }
    } else {
      toggleMark(state, r, c)
      const idx = cellIndex(r, c)
      if (state.marks[idx] === 1) {
        const { px, py } = cellCenter(r, c)
        particles.burst(px, py, '#e0af68', 10, 110)
      }
      // toggleMark 可能改写 status（凑满全对即过关）；经函数读取避免窄化误报。
      const statusOf = (): string => state.status
      if (statusOf() === 'levelClear' || statusOf() === 'allClear') {
        particles.burst(LOGICAL_W / 2, LOGICAL_H / 2, '#9ece6a', 24, 150)
        reportScore()
      }
    }
    loop.markDirty()
  }

  const onMouseDown = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * LOGICAL_W
    const y = (event.clientY - rect.top) / rect.height * LOGICAL_H
    const inHelp = x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h
    if (inHelp) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (helpOpen) {
      helpOpen = false
      loop.markDirty()
      return
    }
    const cell = cellAt(x, y)
    if (cell === null) return
    clickCell(cell.r, cell.c)
  }

  const onMouseMove = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * LOGICAL_W
    const y = (event.clientY - rect.top) / rect.height * LOGICAL_H
    const cell = cellAt(x, y)
    const same = view.hover !== null && cell !== null && cell.r === view.hover.r && cell.c === view.hover.c
    if (!same) {
      view.hover = cell
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      startLevel(state.status === 'allClear' ? 1 : level)
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (event.code === 'KeyE') {
      event.preventDefault()
      if (state.status === 'levelClear' || state.status === 'allClear') {
        startLevel(level + 1)
        return
      }
      mode = mode === 'ping' ? 'mark' : 'ping'
      loop.markDirty()
      return
    }
  }

  // dirty 基调 + 动画自续：波纹 / 鱼群 / 粒子活跃时逐帧 markDirty。
  const loop = createFrameLoop(f => {
    try {
      view.helpOpen = helpOpen
      view.mode = mode
      view.dtMs = f.wallMs
      if (!view.paused) {
        if (f.render) {
          for (const rp of view.ripples) rp.age += f.wallMs
          view.ripples = view.ripples.filter(rp => rp.age < RIPPLE_MS)
          tick(state, f.dt)
        }
      }
      const animating = view.ripples.length > 0 || state.fish.length > 0 || particles.size() > 0
      if (f.render) renderSonar(ctx, state, view)
      if (animating && !view.paused) loop.markDirty()
    } catch (err) {
      // 渲染异常不得杀死循环链：记录后继续。
      console.error('sonardeduct render error', err)
    }
  }, { mode: 'dirty' })

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    view.paused = true
    loop.pause()
    renderSonar(ctx, state, view)
  }
  const resume = (): void => {
    if (running) return
    running = true
    view.paused = false
    loop.markDirty()
    loop.resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  // 事故 A 规避：挂载即渲染一帧，不依赖 rAF 首帧。
  renderSonar(ctx, state, view)
  loop.start()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 注册表用的「声呐探物」定义。 */
export const sonardeductGame: MiniGameDefinition = {
  id: 'sonardeduct',
  title: '声呐探物 SonarDeduct',
  icon: '🛰',
  description: 'ping 一声听八方回声——用几何推理把海床下的障碍全标出来。',
  controls: ['左键：声呐 / 标记（E 切换模式）', 'R：重开本关 · P：暂停 · 点「说明」看规则'],
  create: createSonarGame,
}
