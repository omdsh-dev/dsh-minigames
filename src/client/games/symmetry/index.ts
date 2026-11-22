/**
 * 对称补全 Symmetry 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：点构件盘选中构件，点盘面放置（对位绿显锁定，错位红显可取回，
 * 右键或再点错件取回）；第 4-5 关混入对称轴计数选择题（点选项作答，
 * 答错红显可再答）。R 重开本关，P 暂停/继续；每关限时 LEVEL_SECONDS，
 * 超时判负可 R 重开。过关按关卡/步数/用时计分上报 onScore，进度经
 * level-progress 持久化。帧循环 dirty 按需重绘。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  buildLevel, checkPlacement, computeScore, isPlaceSolved,
  LEVEL_COUNT, LEVEL_SECONDS, placedCells,
  type Cell, type Piece, type Round,
} from './logic.ts'
import {
  boardLayout, cellCenter, cellFromPoint, LOGICAL_H, LOGICAL_W, paletteSlotAt,
  quizOptionAt, renderScene, type PieceView, type SceneView,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles, drawOverlay } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 每关固定种子：同关卡重开得到同一道题（确定性可复放）。 */
const GAME_SEED = 0x1a2b3c4d

const CLEAR_MS = 700
const QUIZ_WRONG_MS = 650

type Phase = 'play' | 'clear' | 'levelDone' | 'allDone' | 'timeout'

function createSymmetryGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  let level = Math.min(LEVEL_COUNT - 1, Math.max(0, readLevel('symmetry') - 1))
  let rounds: Round[] = buildLevel(level, GAME_SEED)
  let roundIdx = 0
  let claimed: boolean[] = []
  let placedCorrect: PieceView[] = []
  let wrong: PieceView[] = []
  let palette: Piece[] = []
  let selected = -1
  let quizPicked = -1
  let steps = 0
  let secondsLeft = LEVEL_SECONDS
  let shownSecond = -1
  let phase: Phase = 'play'
  let paused = false
  let flash = 0
  let advanceTimer = 0
  let advanceAt = 0
  let advanceRemaining = 0
  let scoredLevel = -1

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: symmetry needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const loop = createFrameLoop((frame) => {
    if (!paused && phase === 'play') {
      secondsLeft -= frame.dt
      const sec = Math.ceil(Math.max(0, secondsLeft))
      if (sec !== shownSecond) {
        shownSecond = sec
        loop.markDirty()
      }
      if (secondsLeft <= 0) {
        secondsLeft = 0
        phase = 'timeout'
        clearAdvance()
        loop.markDirty()
      }
    }
    if (flash > 0) {
      flash = Math.max(0, flash - frame.dt * 1.6)
      loop.markDirty()
    }
    if (frame.render || particles.size() > 0 || flash > 0) render(frame.wallMs)
  }, { mode: 'dirty' })

  const resetRoundState = (): void => {
    const round = rounds[roundIdx]!
    if (round.type === 'place') {
      claimed = round.targets.map(() => false)
      palette = round.palette.slice()
    } else {
      claimed = []
      palette = []
    }
    placedCorrect = []
    wrong = []
    selected = -1
    quizPicked = -1
  }

  const startLevel = (next: number): void => {
    level = Math.min(Math.max(next, 0), LEVEL_COUNT - 1)
    rounds = buildLevel(level, GAME_SEED)
    roundIdx = 0
    steps = 0
    secondsLeft = LEVEL_SECONDS
    shownSecond = -1
    phase = 'play'
    flash = 0
    clearAdvance()
    resetRoundState()
    loop.markDirty()
  }

  function clearAdvance(): void {
    if (advanceTimer !== 0) {
      window.clearTimeout(advanceTimer)
      advanceTimer = 0
    }
  }

  const schedule = (ms: number, fn: () => void): void => {
    clearAdvance()
    advanceAt = performance.now() + ms
    advanceRemaining = ms
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      fn()
    }, ms)
  }

  const levelComplete = (): void => {
    phase = level === LEVEL_COUNT - 1 ? 'allDone' : 'levelDone'
    if (scoredLevel !== level) {
      scoredLevel = level
      options?.onScore?.(computeScore(level + 1, steps, LEVEL_SECONDS - secondsLeft))
    }
    saveLevel('symmetry', level + 2)
    particles.burst(LOGICAL_W / 2, 250, THEME.gold, 26, 190)
    loop.markDirty()
  }

  const advanceRound = (): void => {
    if (roundIdx + 1 >= rounds.length) {
      levelComplete()
      return
    }
    roundIdx += 1
    phase = 'play'
    resetRoundState()
    loop.markDirty()
  }

  const roundClear = (delayMs: number): void => {
    phase = 'clear'
    flash = 1
    loop.markDirty()
    if (paused) {
      advanceRemaining = delayMs
    } else {
      schedule(delayMs, advanceRound)
    }
  }

  const placeSelected = (cell: Cell): void => {
    const round = rounds[roundIdx]!
    if (round.type !== 'place') return
    const piece = palette[selected]!
    steps += 1
    const match = checkPlacement(round, piece, cell, claimed)
    if (match >= 0) {
      claimed[match] = true
      const cells = placedCells(piece, cell)
      placedCorrect.push({ kind: piece.kind, cells })
      palette.splice(selected, 1)
      selected = -1
      const layout = boardLayout(round.grid)
      const last = cells[cells.length - 1]!
      const center = cellCenter(layout, last)
      particles.burst(center.x, center.y, THEME.good, 10, 120)
      if (isPlaceSolved(round, claimed)) roundClear(CLEAR_MS)
    } else {
      wrong.push({ kind: piece.kind, cells: placedCells(piece, cell) })
    }
    loop.markDirty()
  }

  const removeWrongAt = (x: number, y: number): boolean => {
    const round = rounds[roundIdx]!
    if (round.type !== 'place') return false
    const layout = boardLayout(round.grid)
    const cell = cellFromPoint(layout, round.grid, x, y)
    if (cell === null) return false
    const key = (c: Cell): string => c.x + ',' + c.y
    const at = wrong.findIndex((p) => p.cells.some((c) => key(c) === key(cell)))
    if (at < 0) return false
    wrong.splice(at, 1)
    loop.markDirty()
    return true
  }

  const onQuizOption = (option: number): void => {
    const round = rounds[roundIdx]!
    if (round.type !== 'quiz' || quizPicked >= 0 || option < 0) return
    quizPicked = option
    if (option === round.answer) {
      roundClear(CLEAR_MS + 200)
    } else {
      steps += 1
      loop.markDirty()
      if (paused) {
        advanceRemaining = QUIZ_WRONG_MS
      } else {
        schedule(QUIZ_WRONG_MS, () => {
          quizPicked = -1
          loop.markDirty()
        })
      }
    }
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
    if (paused || phase === 'clear') return
    const { x, y } = toLogical(event)
    if (phase === 'levelDone') {
      startLevel(level + 1)
      return
    }
    if (phase === 'allDone') {
      startLevel(0)
      return
    }
    if (phase === 'timeout') {
      startLevel(level)
      return
    }
    const round = rounds[roundIdx]!
    if (round.type === 'quiz') {
      if (event.button === 0) onQuizOption(quizOptionAt(x, y))
      return
    }
    if (event.button === 2) {
      removeWrongAt(x, y)
      return
    }
    const slot = paletteSlotAt(palette.length, x, y)
    if (slot >= 0) {
      selected = slot
      loop.markDirty()
      return
    }
    if (removeWrongAt(x, y)) return
    if (selected < 0) return
    const cell = cellFromPoint(boardLayout(round.grid), round.grid, x, y)
    if (cell !== null) placeSelected(cell)
  }

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    if (paused || phase !== 'play') return
    const { x, y } = toLogical(event)
    removeWrongAt(x, y)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      startLevel(level)
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      paused = !paused
      if (paused) {
        if (advanceTimer !== 0) {
          window.clearTimeout(advanceTimer)
          advanceTimer = 0
          advanceRemaining = Math.max(0, advanceAt - performance.now())
        }
      } else if (advanceRemaining > 0 && phase === 'clear') {
        schedule(advanceRemaining, advanceRound)
      } else {
        advanceRemaining = 0
      }
      loop.markDirty()
    }
  }

  const overlayText = (): { title: string; subtitle: string } | null => {
    if (paused) return { title: '暂停', subtitle: '按 P 继续 · R 重开本关' }
    if (phase === 'levelDone') {
      return { title: '过关', subtitle: '得分 ' + computeScore(level + 1, steps, LEVEL_SECONDS - secondsLeft) + ' · 点击进入下一关' }
    }
    if (phase === 'allDone') return { title: '全部通关', subtitle: '五关全部对称完成 · 点击回到第 1 关' }
    if (phase === 'timeout') return { title: '时间到', subtitle: '点击或按 R 重开本关' }
    return null
  }

  const render = (dtMs: number): void => {
    const round = rounds[roundIdx]!
    const view: SceneView = {
      round,
      placedCorrect,
      wrong,
      palette,
      selected,
      quizPicked,
      hudLevel: (level + 1) + '/' + LEVEL_COUNT + ' · 轮 ' + (roundIdx + 1) + '/' + rounds.length,
      steps,
      secondsLeft,
      flash,
    }
    renderScene(ctx, view)
    particles.tick(ctx, dtMs)
    const overlay = overlayText()
    if (overlay !== null) drawOverlay(ctx, LOGICAL_W, LOGICAL_H, overlay.title, overlay.subtitle)
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  resetRoundState()

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

/** 对称补全：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const symmetryGame: MiniGameDefinition = {
  id: 'symmetry',
  title: '对称补全 Symmetry',
  icon: '🦋',
  description: '一半图形告诉你全部——沿对称轴补全另一半，角度和弧线都要严丝合缝。',
  controls: [
    '点击构件盘选中，再点击缺失一侧的网格放置；位置与形状完全镜像才算对位（绿色锁定）。',
    '错放的构件红显：右键或再次点击它取回，重新放置；轴上已给构件无需补。',
    '第 4-5 关对称轴转为 45° 斜线，并混入"图形有几条对称轴"选择题（点选项作答，答错可再答）。',
    '每关限时 4 分钟且计步：步数越少、用时越短得分越高；时间到判负，可按 R 重开本关。',
    '快捷键：R 重开本关 · P 暂停/继续；过关自动进入下一关，进度自动保存。',
  ],
  create: createSymmetryGame,
}
