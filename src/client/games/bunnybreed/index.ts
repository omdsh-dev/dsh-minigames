/**
 * 兔子育种 BunnyBreed 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点两只兔选亲本 → 「配种」（每窝 4 仔、空位不足 4 时须先放归）；
 * 点 1 只兔选中后「放归」腾位；R 重开本关；P 暂停；说明按钮任何阶段
 * 可开合。目标达成过关（onScore 计分、level-progress 持久化），代数
 * 用尽判负。每关固定种子（重开同一窝序可复放）。帧循环 dirty 按需重绘；
 * 挂载时先立即渲染一帧再启动循环，帧回调 try-catch 包裹（渲染异常只
 * 记录不中断 rAF 链）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { breed, buildLevel, clearSelection, computeScore, isWinning, LEVEL_COUNT, matchesTarget, mulberry32, newGame, offspringStats, release, toggleSelect, type GameState } from './logic.ts'
import { BREED_BTN, HELP_BTN, LOGICAL_H, LOGICAL_W, rabbitSlotAt, RELEASE_BTN, renderScene, type SceneView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles, drawOverlay } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 每关固定种子：同关卡重开得到同一窝序（确定性可复放）。 */
const GAME_SEED = 0x5eedb47e

function createBunnyBreedGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  let level = Math.min(LEVEL_COUNT - 1, Math.max(0, readLevel('bunnybreed') - 1))
  let state: GameState = newGame(buildLevel(level))
  /** 本关随机流：startLevel 重建，重开复放同窝序。 */
  let rng = mulberry32((GAME_SEED ^ Math.imul(level + 1, 0x9e3779b9)) >>> 0)
  /** 说明面板开关。 */
  let helpOpen = false
  let paused = false
  let scoredLevel = -1

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: bunnybreed needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  /** 组装一帧视图（matchFlags 与兔子一一对应）。 */
  const buildView = (): SceneView => {
    const free = state.data.capacity - state.rabbits.length
    const selectedCount = state.selected.length
    let punnett = null
    if (selectedCount === 2) {
      const a = state.rabbits.find((r) => r.id === state.selected[0])
      const b = state.rabbits.find((r) => r.id === state.selected[1])
      if (a !== undefined && b !== undefined) punnett = offspringStats(a.genes, b.genes)
    }
    const matchFlags = state.rabbits.map((r) => matchesTarget(r.genes, state.data.target) || (state.data.target2 !== null && matchesTarget(r.genes, state.data.target2)))
    return {
      data: state.data,
      rabbits: state.rabbits,
      selected: state.selected,
      selectedCount,
      punnett,
      hudLevel: (level + 1) + '/' + LEVEL_COUNT,
      count: state.rabbits.length,
      genLeft: state.data.genLimit - state.breeds,
      breedEnabled: state.phase === 'play' && selectedCount === 2 && free >= 4 && state.breeds < state.data.genLimit,
      releaseEnabled: state.phase === 'play' && selectedCount === 1,
      matchFlags,
    }
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
      if (frame.render || particles.size() > 0) render(frame.wallMs)
    } catch (err) {
      console.error('dsh-minigames bunnybreed frame error', err)
    }
  }, { mode: 'dirty' })

  const startLevel = (next: number): void => {
    level = Math.min(Math.max(next, 0), LEVEL_COUNT - 1)
    state = newGame(buildLevel(level))
    rng = mulberry32((GAME_SEED ^ Math.imul(level + 1, 0x9e3779b9)) >>> 0)
    paused = false
    loop.markDirty()
  }

  const restartLevel = (): void => {
    // R：重开本关（重置放归计数与窝序）。
    startLevel(level)
  }

  /** breed 会改变 phase；经函数读取避免窄化误报（回调/分支内类型收窄）。 */
  const isWonPhase = (s: GameState): boolean => s.phase === 'won'

  const doBreed = (): void => {
    if (paused || state.phase !== 'play') return
    if (breed(state, rng) !== null) {
      if (isWonPhase(state)) {
        if (scoredLevel !== level) {
          scoredLevel = level
          options?.onScore?.(computeScore(level, state.data.genLimit - state.breeds, state.releases))
        }
        saveLevel('bunnybreed', level + 2)
        particles.burst(LOGICAL_W / 2, 240, THEME.good, 26, 190)
      }
      loop.markDirty()
    }
  }

  const overlayText = (): { title: string; subtitle: string } | null => {
    if (paused) return { title: '暂停', subtitle: '按 P 继续 · R 重开本关' }
    if (state.phase === 'won') {
      if (level >= LEVEL_COUNT - 1) return { title: '全部通关', subtitle: '五关育种目标全部达成 · 点击回到第 1 关' }
      return { title: '过关', subtitle: '得分 ' + computeScore(level, state.data.genLimit - state.breeds, state.releases) + ' · 点击进入下一关' }
    }
    if (state.phase === 'failed') return { title: '代数用尽', subtitle: '目标未达成 · 点击或按 R 重开本关' }
    return null
  }

  const toLogical = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

  const onMouseDown = (event: MouseEvent): void => {
    focusGameHost(host)
    const { x, y } = toLogical(event)
    // 说明按钮：任何阶段/暂停中都可开合。
    if (inRect(x, y, HELP_BTN)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (paused) return
    if (state.phase === 'won') {
      startLevel(level + 1)
      return
    }
    if (state.phase === 'failed') {
      restartLevel()
      return
    }
    if (inRect(x, y, BREED_BTN)) {
      doBreed()
      return
    }
    if (inRect(x, y, RELEASE_BTN)) {
      if (state.selected.length === 1) {
        release(state, state.selected[0]!)
        loop.markDirty()
      }
      return
    }
    const slot = rabbitSlotAt(x, y)
    if (slot === null || slot >= state.rabbits.length) return
    if (toggleSelect(state, state.rabbits[slot]!.id)) loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      restartLevel()
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      paused = !paused
      loop.markDirty()
    }
  }

  canvas.addEventListener('mousedown', onMouseDown)
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
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 兔子育种：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const bunnybreedGame: MiniGameDefinition = {
  id: 'bunnybreed',
  title: '兔子育种 BunnyBreed',
  icon: '🐰',
  description: '孟德尔定律不是玄学——选对亲本，三五代养出目标毛色。',
  controls: [
    '点两只兔选亲本后「配种」，空位不足时点 1 只「放归」——完整规则点游戏内右下角「说明」',
    'R：重开本关 · P：暂停',
  ],
  create: createBunnyBreedGame,
}
