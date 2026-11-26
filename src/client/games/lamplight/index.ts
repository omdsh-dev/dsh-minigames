/**
 * 「提灯人 Lamplight」游戏定义：把纯逻辑接成 MiniGameInstance。
 * 方向键/WASD 移动（回合制：一步 = 移动 + 耗油 + 暗影行动），R 用同一
 * seed 重开本关（地形完全一致），P 暂停；点击右上「说明」开合帮助面板
 * （任何阶段可用，渲染层画在最后）。灯焰动画逐帧重绘（continuous 模式）；
 * 过关遮罩下按任意方向键进入下一关；第 5 关全亮为整场通关。onScore 在
 * 每次过关时上报当前关卡号。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { LEVEL_COUNT, movePlayer, generateTown, type Dir, type LamplightState } from './logic.ts'
import { LOGICAL_W, LOGICAL_H, HELP_RECT, renderLamplight, cellCenter, type LamplightView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'
import { createParticles } from '../theme.ts'

/** 每关 seed：同关重开必然生成同一座小镇。 */
function levelSeed(level: number): number {
  return (level * 0x9e3779b9 + 0x51ab27) >>> 0
}

/** 方向键与 WASD → 四向。 */
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
}

function createLamplightGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: lamplight needs a 2d canvas context')
  const ctx = fit.ctx

  let level = 1
  let state: LamplightState = generateTown(levelSeed(level), level)
  let helpOpen = false
  let running = false
  let lastScore = 0
  const particles = createParticles()
  const view: LamplightView = { paused: false, helpOpen: false, particles, dtMs: 16 }

  const reportScore = (): void => {
    if (level === lastScore) return
    lastScore = level
    options?.onScore?.(level)
  }

  const startLevel = (next: number): void => {
    level = next > LEVEL_COUNT ? 1 : next
    state = generateTown(levelSeed(level), level)
    view.paused = false
    loop.markDirty()
  }

  /** 一步移动：结算后按需触发粒子与计分。 */
  const step = (dir: Dir): void => {
    // 过关遮罩下：任意方向键直接进入下一关。
    if (state.status === 'levelClear') {
      startLevel(level + 1)
      return
    }
    if (state.status !== 'playing') return
    const litBefore = state.litOrder.length
    const moved = movePlayer(state, dir)
    if (!moved) return
    if (state.litOrder.length > litBefore) {
      const { px, py } = cellCenter(state, state.player.x, state.player.y)
      particles.burst(px, py, '#e0af68', 14, 120)
    }
    // movePlayer 可能改写 status；经函数读取避免窄化误报。
    const over = (): string => state.status
    if (over() === 'levelClear' || over() === 'allClear') {
      const { px, py } = cellCenter(state, state.player.x, state.player.y)
      particles.burst(px, py, '#9ece6a', 26, 160)
      reportScore()
    }
    loop.markDirty()
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
    if (!running) return
    const dir = KEY_DIR[event.code]
    if (dir === undefined) return
    event.preventDefault()
    step(dir)
  }

  const onMouseDown = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * LOGICAL_W
    const y = (event.clientY - rect.top) / rect.height * LOGICAL_H
    const inHelp = x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h
    if (inHelp || helpOpen) {
      helpOpen = inHelp ? !helpOpen : false
      loop.markDirty()
    }
  }

  // 灯焰/雾团逐帧动画：continuous 模式每帧重绘（dirty 标记仍即时响应）。
  const loop = createFrameLoop(f => {
    view.helpOpen = helpOpen
    view.dtMs = f.wallMs
    if (f.render) renderLamplight(ctx, state, view)
  })

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    view.paused = true
    loop.pause()
    renderLamplight(ctx, state, view)
  }
  const resume = (): void => {
    if (running) return
    running = true
    view.paused = false
    loop.markDirty()
    loop.resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  renderLamplight(ctx, state, view)

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

/** 注册表用的「提灯人」定义。 */
export const lamplightGame: MiniGameDefinition = {
  id: 'lamplight',
  title: '提灯人 Lamplight',
  icon: '🏮',
  description: '一盏油灯照亮脚下方寸——走过的路会暗回去，凭记忆把每盏路灯点亮。',
  controls: ['方向键/WASD：移动（每步耗油）', 'R：重开本关 · P：暂停 · H/点「说明」：规则'],
  create: createLamplightGame,
}
