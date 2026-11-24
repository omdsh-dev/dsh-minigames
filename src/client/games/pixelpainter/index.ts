/**
 * 像素画家 PixelPainter 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点击调色板换色；左键点画布涂色、右键清除；H 提示（自动修正
 * 一个错格，每关限 2 次）；R 重开本关（同种子同图案）；P 暂停/继续。
 * 实时比对驱动错格红框与完成度，全格一致过关计分上报 onScore，进度经
 * level-progress 持久化。帧循环 dirty 按需重绘；说明按钮与帮助面板由
 * 渲染函数末尾的 drawHelp 画在最上层，任何阶段/暂停均可开合。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  applyHint, buildLevel, compareCells, completionPct, computeScore, createCanvas,
  eraseCell, HINTS_PER_LEVEL, isSolved, LEVEL_COUNT, paintCell,
  type Cell, type PainterLevel,
} from './logic.ts'
import {
  cellFromPoint, drawHelp, HELP_BTN, layoutFor, LEFT_PANEL, LOGICAL_H, LOGICAL_W,
  paletteSwatchAt, renderScene, RIGHT_PANEL, type SceneView,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles, drawOverlay } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 每关固定种子：同关卡重开得到同一幅图案（确定性可复放）。 */
const GAME_SEED = 0x3d5a7c1e

const CLEAR_MS = 900

type Phase = 'play' | 'clear' | 'levelDone' | 'allDone'

function createPixelPainterGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  let level = Math.min(LEVEL_COUNT - 1, Math.max(0, readLevel('pixelpainter') - 1))
  let current: PainterLevel = buildLevel(level, GAME_SEED)
  let cells = createCanvas(current.pattern.grid)
  let selected = 0
  let steps = 0
  let hintsLeft = HINTS_PER_LEVEL
  let hintsUsed = 0
  let phase: Phase = 'play'
  let paused = false
  let helpOpen = false
  let flash = 0
  let advanceTimer = 0
  let scoredLevel = -1

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: pixelpainter needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const loop = createFrameLoop((frame) => {
    if (flash > 0) {
      flash = Math.max(0, flash - frame.dt * 1.4)
      loop.markDirty()
    }
    if (frame.render || particles.size() > 0 || flash > 0) render(frame.wallMs)
  }, { mode: 'dirty' })

  const clearAdvance = (): void => {
    if (advanceTimer !== 0) {
      window.clearTimeout(advanceTimer)
      advanceTimer = 0
    }
  }

  const startLevel = (next: number): void => {
    level = Math.min(Math.max(next, 0), LEVEL_COUNT - 1)
    current = buildLevel(level, GAME_SEED)
    cells = createCanvas(current.pattern.grid)
    selected = 0
    steps = 0
    hintsLeft = HINTS_PER_LEVEL
    hintsUsed = 0
    phase = 'play'
    flash = 0
    clearAdvance()
    loop.markDirty()
  }

  const compare = () => compareCells(current.reference, cells, current.pattern.grid)

  const checkSolved = (): void => {
    if (!isSolved(compare())) return
    phase = level === LEVEL_COUNT - 1 ? 'allDone' : 'levelDone'
    flash = 1
    if (scoredLevel !== level) {
      scoredLevel = level
      options?.onScore?.(computeScore(level + 1, steps, hintsUsed))
    }
    saveLevel('pixelpainter', level + 2)
    particles.burst(RIGHT_PANEL.x + RIGHT_PANEL.w / 2, 250, THEME.gold, 26, 190)
    if (phase === 'levelDone') {
      advanceTimer = window.setTimeout(() => {
        advanceTimer = 0
        startLevel(level + 1)
      }, CLEAR_MS)
    }
    loop.markDirty()
  }

  const paint = (cell: Cell, colorIdx: number): void => {
    if (paintCell(cells, current.pattern.grid, cell.x, cell.y, colorIdx)) {
      steps += 1
      loop.markDirty()
      checkSolved()
    }
  }

  const erase = (cell: Cell): void => {
    if (eraseCell(cells, current.pattern.grid, cell.x, cell.y)) {
      steps += 1
      loop.markDirty()
      checkSolved()
    }
  }

  const hint = (): void => {
    if (phase !== 'play' || paused || hintsLeft <= 0) return
    const fixed = applyHint(current.reference, cells, current.pattern.grid)
    if (fixed === null) return
    hintsLeft -= 1
    hintsUsed += 1
    const layout = layoutFor(RIGHT_PANEL, current.pattern.grid)
    const px = layout.ox + (fixed.x + 0.5) * layout.cell
    const py = layout.oy + (fixed.y + 0.5) * layout.cell
    particles.burst(px, py, THEME.good, 10, 120)
    loop.markDirty()
    checkSolved()
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
    if (phase === 'levelDone' || phase === 'allDone') {
      clearAdvance()
      startLevel(phase === 'allDone' ? 0 : level + 1)
      return
    }
    if (phase !== 'play' || event.button !== 0) return
    const slot = paletteSwatchAt(current.palette.length, x, y)
    if (slot >= 0) {
      selected = slot
      loop.markDirty()
      return
    }
    const cell = cellFromPoint(layoutFor(RIGHT_PANEL, current.pattern.grid), current.pattern.grid, x, y)
    if (cell !== null) paint(cell, current.palette[selected] ?? 0)
  }

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    if (paused || phase !== 'play') return
    const { x, y } = toLogical(event)
    const cell = cellFromPoint(layoutFor(RIGHT_PANEL, current.pattern.grid), current.pattern.grid, x, y)
    if (cell !== null) erase(cell)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      startLevel(level)
    } else if (event.key === 'h' || event.key === 'H') {
      event.preventDefault()
      hint()
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      paused = !paused
      loop.markDirty()
    }
  }

  const overlayText = (): { title: string; subtitle: string } | null => {
    if (paused) return { title: '暂停', subtitle: '按 P 继续 · R 重开本关' }
    if (phase === 'levelDone') {
      return { title: '复刻成功', subtitle: '得分 ' + computeScore(level + 1, steps, hintsUsed) + ' · 即将进入下一关' }
    }
    if (phase === 'allDone') {
      return { title: '全部通关', subtitle: '五幅像素画全部复刻完成 · 点击回到第 1 关' }
    }
    return null
  }

  const render = (dtMs: number): void => {
    const result = compare()
    const view: SceneView = {
      reference: current.reference,
      canvas: cells,
      grid: current.pattern.grid,
      colors: current.pattern.colors.map((c) => c.color),
      palette: current.palette,
      selected,
      steps,
      wrong: phase === 'play' ? result.wrong : 0,
      pct: phase === 'play' ? completionPct(result) : 100,
      level,
      levelCount: LEVEL_COUNT,
      hintsLeft,
      flash,
    }
    renderScene(ctx, view)
    particles.tick(ctx, dtMs)
    const overlay = overlayText()
    if (overlay !== null) drawOverlay(ctx, LOGICAL_W, LOGICAL_H, overlay.title, overlay.subtitle)
    // 说明按钮与帮助面板画在渲染函数末尾：最上层，任何阶段可开合。
    drawHelp(ctx, helpOpen)
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)

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
      clearAdvance()
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 像素画家：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const pixelpainterGame: MiniGameDefinition = {
  id: 'pixelpainter',
  title: '像素画家 PixelPainter',
  icon: '🖌️',
  description: '左边参考右边画布——一格一色把它复刻出来，像素眼力大考验。',
  controls: [
    '点调色板选色，左键涂画布 / 右键清除，把参考图一格不差地复刻出来——完整规则点游戏内右下角「说明」',
    'H：提示 · R：重开 · P：暂停',
  ],
  create: createPixelPainterGame,
}
