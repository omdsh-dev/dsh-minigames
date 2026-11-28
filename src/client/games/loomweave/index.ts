/**
 * 织机穿梭 LoomWeave 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点色线篮选纬线色、点 0-3 起始偏移钮（预览条即时反映），回车织
 * 入一行，Z 拆最上一行（未达标阶段也可拆了重织），R 重开本关，P 暂停，
 * 说明按钮任何阶段可开合。过关 onScore 计分、level-progress 持久化。
 * 帧循环 dirty 按需重绘；挂载时先立即渲染一帧再启动循环（防黑屏事故），
 * 帧回调 try-catch 包裹（渲染异常只记录不中断 rAF 链）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { bestRow, buildLevel, clothColors, computeError, computeScore, LEVEL_COUNT, newGame, resetLevel, undoRow, weaveRow, type GameState, type RowChoice } from './logic.ts'
import { HELP_BTN, LOGICAL_H, LOGICAL_W, offsetFromPoint, renderScene, threadFromPoint, type SceneView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 每关固定种子：同关卡重开得到同一道题（确定性可复放）。 */
const GAME_SEED = 0x10c0ffe5

function createLoomWeaveGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  let level = Math.min(LEVEL_COUNT - 1, Math.max(0, readLevel('loomweave') - 1))
  let state: GameState = newGame(buildLevel(level, GAME_SEED))
  let selectedColor = 0
  let offset = 0
  /** 说明面板开关。 */
  let helpOpen = false
  let paused = false
  /** H 提示剩余次数：自动按最优解织入下一行。 */
  let hintsLeft = 2
  let scoredLevel = -1

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: loomweave needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const view = (): SceneView => ({
    data: state.data,
    woven: state.woven,
    cloth: clothColors(state),
    selectedColor,
    offset,
    phase: state.phase,
    paused,
    hudLevel: (level + 1) + '/' + LEVEL_COUNT,
    error: computeError(state),
  })

  const render = (dtMs: number): void => {
    renderScene(ctx, view(), particles, dtMs, helpOpen)
  }

  const loop = createFrameLoop((frame) => {
    // 帧回调整体 try-catch：渲染异常杀死 rAF 链是历史事故，只记录不中断。
    try {
      if (frame.render || particles.size() > 0) render(frame.wallMs)
    } catch (err) {
      console.error('dsh-minigames loomweave frame error', err)
    }
  }, { mode: 'dirty' })

  const startLevel = (next: number): void => {
    level = Math.min(Math.max(next, 0), LEVEL_COUNT - 1)
    state = newGame(buildLevel(level, GAME_SEED))
    hintsLeft = 2
    selectedColor = 0
    offset = 0
    paused = false
    loop.markDirty()
  }

  const restartLevel = (): void => {
    // R：重开。清空已织行重织（拆线计数保留计入得分）。
    resetLevel(state)
    paused = false
    loop.markDirty()
  }

  const doWeave = (): void => {
    if (paused || helpOpen) return
    const choice: RowChoice = { color: selectedColor, offset }
    const result = weaveRow(state, choice)
    if (result === 'won') {
      if (scoredLevel !== level) {
        scoredLevel = level
        options?.onScore?.(computeScore(level, computeError(state), state.undos))
      }
      saveLevel('loomweave', level + 2)
      const layout = { x: LOGICAL_W / 2, y: 240 }
      particles.burst(layout.x, layout.y, THEME.good, 26, 190)
    }
    if (result !== 'rejected') loop.markDirty()
  }

  const doUndo = (): void => {
    if (paused || helpOpen) return
    if (undoRow(state)) loop.markDirty()
  }

  const toLogical = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
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
    if (state.phase === 'won') {
      startLevel(level + 1)
      return
    }
    if (state.phase === 'failed') {
      // 未达标：点击拆最上一行重织（比整关重来更温和）。
      if (undoRow(state)) loop.markDirty()
      return
    }
    if (helpOpen) return
    const thread = threadFromPoint(state.data, x, y)
    if (thread !== null) {
      selectedColor = thread
      loop.markDirty()
      return
    }
    const off = offsetFromPoint(x, y)
    if (off !== null) {
      offset = off
      loop.markDirty()
    }
  }

  /** H 提示（2 次/关）：按已知最优解直接织入下一行（选色+偏移+织入一步到位）。 */
  const applyHint = (): void => {
    if (hintsLeft <= 0 || paused || state.phase !== 'play') return
    const rowIndex = state.woven.length
    if (rowIndex >= state.data.rows) return
    const best = bestRow(state.data, rowIndex)
    selectedColor = best.color
    offset = best.offset
    doWeave()
    if (state.woven.length === rowIndex + 1) hintsLeft -= 1
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault()
      applyHint()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      doWeave()
    } else if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault()
      doUndo()
    } else if (event.key === 'r' || event.key === 'R') {
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

/** 织机穿梭：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const loomweaveGame: MiniGameDefinition = {
  id: 'loomweave',
  title: '织机穿梭 LoomWeave',
  icon: '🪡',
  description: '一行一行织过去——经线在哪个颜色上压过去，图案说了算。',
  controls: [
    '点色线篮选纬线色、点 0-3 偏移钮定穿梭序列，回车织入一行——完整规则点游戏内右下角「说明」',
    'Z：拆一行 · H：提示 · R：重开 · P：暂停',
  ],
  create: createLoomWeaveGame,
}
