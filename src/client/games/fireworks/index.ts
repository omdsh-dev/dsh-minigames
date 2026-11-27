/**
 * 烟花编排 FireworksShow 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点击发射位选中→右栏配方按钮选配方→点/拖延时滑条（0-5 秒，1
 * 秒粒度）；空格或「点火」按钮点火，演出按 0.1s tick 回放并逐帧渲染；
 * 谱项全中过关（onScore 计分、level-progress 持久化），未中判负可 R
 * 重开。帧循环 dirty 按需重绘 + 燃放期间逐帧；挂载时先立即渲染一帧再
 * 启动循环，帧回调 try-catch 包裹（渲染异常只记录不中断）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { ignite, itemStateAt, LEVELS, LEVEL_COUNT, newGame, RECIPES, setPadDelay, setPadRecipe, step, computeScore, type GameState } from './logic.ts'
import { HELP_BTN, igniteHit, LOGICAL_H, LOGICAL_W, padFromPoint, recipeBtnFromPoint, renderScene, sliderHit, sliderValueFromPoint, type SceneView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles, drawOverlay } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 回放速度：1 tick = 0.1s 实时。 */
const TICKS_PER_SECOND = 10

function createFireworksGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  let level = Math.min(LEVEL_COUNT - 1, Math.max(0, readLevel('fireworks') - 1))
  let state: GameState = newGame(level)
  /** 说明面板开关。 */
  let helpOpen = false
  let paused = false
  let scoredLevel = -1
  /** 滑条拖拽中（mousemove 持续设值）。 */
  let dragging = false

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: fireworks needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const buildView = (): SceneView => ({
    state,
    level: LEVELS[state.levelIndex]!,
    hudLevel: (state.levelIndex + 1) + '/' + LEVEL_COUNT,
    hudRightLabel: state.phase === 'setup' ? '点火' : state.phase === 'running' ? '时刻' : '得分',
    hudRight: state.phase === 'setup' ? state.attempts + ' 次' : state.phase === 'running' ? (state.time / TICKS_PER_SECOND).toFixed(1) + 's' : (state.result?.win === true ? String(computeScore(state.levelIndex, hitCount(), state.result.duration, state.attempts)) : '--'),
    itemStates: LEVELS[state.levelIndex]!.items.map((_, i) => itemStateAt(state, i)),
  })

  const hitCount = (): number => {
    let n = 0
    for (const h of state.result?.hits ?? []) {
      if (h) n += 1
    }
    return n
  }

  const render = (dtMs: number): void => {
    renderScene(ctx, buildView(), helpOpen)
    particles.tick(ctx, dtMs)
    const overlay = overlayText()
    if (overlay !== null) drawOverlay(ctx, LOGICAL_W, LOGICAL_H, overlay.title, overlay.subtitle)
  }

  const loop = createFrameLoop((frame) => {
    // 帧回调整体 try-catch：渲染异常杀死 rAF 链是历史事故，只记录不中断。
    try {
      if (state.phase === 'running' && !paused) {
        step(state, frame.dt * TICKS_PER_SECOND)
        const finished = state.result !== null && state.time >= state.result.duration
        if (finished && state.result?.win === true && scoredLevel !== state.levelIndex) {
          scoredLevel = state.levelIndex
          options?.onScore?.(computeScore(state.levelIndex, hitCount(), state.result.duration, state.attempts))
          saveLevel('fireworks', state.levelIndex + 2)
          particles.burst(LOGICAL_W / 2, 240, THEME.good, 26, 190)
        }
        loop.markDirty()
      }
      if (frame.render || particles.size() > 0 || state.phase === 'running' || dragging) render(frame.wallMs)
    } catch (err) {
      console.error('dsh-minigames fireworks frame error', err)
    }
  }, { mode: 'dirty' })

  const startLevel = (next: number): void => {
    level = Math.min(Math.max(next, 0), LEVEL_COUNT - 1)
    state = newGame(level)
    paused = false
    loop.markDirty()
  }

  const doIgnite = (): void => {
    if (paused || state.phase !== 'setup') return
    if (ignite(state)) loop.markDirty()
  }

  const restart = (): void => {
    // R：setup 清空重来；running/done 也回到 setup（点火次数累计扣分）。
    startLevel(state.levelIndex)
  }

  const overlayText = (): { title: string; subtitle: string } | null => {
    if (paused) return { title: '暂停', subtitle: '按 P 继续 · R 重开本关' }
    if (state.phase === 'done') {
      if (state.result?.win === true) {
        const score = computeScore(state.levelIndex, hitCount(), state.result.duration, state.attempts)
        if (state.levelIndex >= LEVEL_COUNT - 1) return { title: '全部通关', subtitle: '五关编排全部达成 · 点击回到第 1 关' }
        return { title: '过关', subtitle: '得分 ' + score + ' · 点击进入下一关' }
      }
      return { title: '谱项未齐', subtitle: '看漏了哪个节拍？· 点击或按 R 重开' }
    }
    return null
  }

  const toLogical = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const applySlider = (x: number): void => {
    if (state.selectedPad === null) return
    if (setPadDelay(state, state.selectedPad, sliderValueFromPoint(x))) loop.markDirty()
  }

  const onMouseDown = (event: MouseEvent): void => {
    focusGameHost(host)
    const { x, y } = toLogical(event)
    // 说明按钮：任何阶段/暂停中都可开合。
    if (x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (paused) return
    if (state.phase === 'done') {
      if (state.result?.win === true) startLevel(state.levelIndex + 1)
      else startLevel(state.levelIndex)
      return
    }
    if (state.phase === 'running') return
    if (igniteHit(x, y)) {
      doIgnite()
      return
    }
    const recipeIndex = recipeBtnFromPoint(x, y)
    if (recipeIndex !== null) {
      const recipe = RECIPES[recipeIndex]
      if (state.selectedPad !== null && recipe !== undefined && setPadRecipe(state, state.selectedPad, recipe.id)) loop.markDirty()
      return
    }
    if (sliderHit(x, y)) {
      dragging = true
      applySlider(x)
      return
    }
    const pad = padFromPoint(LEVELS[state.levelIndex]!.pads, x, y)
    if (pad !== null) {
      state.selectedPad = pad
      loop.markDirty()
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!dragging) return
    const { x } = toLogical(event)
    applySlider(x)
  }

  const onMouseUp = (): void => {
    if (dragging) {
      dragging = false
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.key === ' ') {
      event.preventDefault()
      doIgnite()
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      restart()
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      paused = !paused
      loop.markDirty()
    }
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)

  // 挂载时立即渲染一帧（不依赖 rAF 首帧——避免黑屏事故），再启动循环。
  render(16)
  loop.start()

  return {
    start(): void {
      loop.start()
    },
    pause(): void {
      loop.pause()
    },
    resume(): void {
      loop.resume()
    },
    destroy(): void {
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 烟花编排：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const fireworksGame: MiniGameDefinition = {
  id: 'fireworks',
  title: '烟花编排 FireworksShow',
  icon: '🎆',
  description: '配方决定色彩高度与形状——排好引信延时，让满天礼花在同一个节拍绽放。',
  controls: [
    '点击发射位选配方、拖滑条设引信延时，空格点火——完整规则点游戏内右下角「说明」',
    'R：重开本关 · P：暂停 · 过关点击进入下一关',
  ],
  create: createFireworksGame,
}
