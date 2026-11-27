/**
 * 花径寻踪 game definition：把纯逻辑接进 MiniGameInstance——点击空地
 * 在花/草间循环（非法格忽略），H 给提示（每关限 2 次，直接落正解子），
 * R 重开本关，P 暂停，[ ] 在已到达关卡间切换。过关即整体标记满足全部
 * 约束（唯一解保证与生成解一致），onScore 上报后 1.5s 自动进下一关；
 * 进度走 level-progress 持久化。dirty 帧循环：静止时零重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  CELL_CLUE, LEVEL_COUNT, MARK_GRASS, MARK_FLOWER,
  adjacencyConflicts, computeScore, hintCell, isWon,
  puzzleFromSeed, toggleMark, unsatisfiedClues,
  type GardenPathPuzzle,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, cellAt, cellCenter, computeLayout,
  helpButtonHit, renderGardenPath,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1500
const HINT_LIMIT = 2

function createGardenPathGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  // 持久化进度是 1 基；本游戏内部 level 是 0 基。
  let level = Math.min(readLevel('gardenpath'), LEVEL_COUNT) - 1
  let puzzle: GardenPathPuzzle
  let marks: Uint8Array
  let hover = -1
  let hintShown = -1
  let helpOpen = false
  let steps = 0
  let hintsUsed = 0
  let solved = false
  let running = false
  let elapsedSecs = 0
  let shownSec = -1
  let elapsed = '0:00'
  let winText: string | null = null
  let advanceTimer = 0
  let advanceAt = 0
  let advanceRemaining = 0
  let lastScoreLevel = -1
  const particles = createParticles()

  const makePuzzle = (display: number): GardenPathPuzzle => {
    const fresh = puzzleFromSeed(display * 0x9e3779b9, display)
    if (fresh === null) throw new Error('dsh-minigames: gardenpath level generation failed')
    return fresh
  }

  puzzle = makePuzzle(level + 1)
  marks = new Uint8Array(puzzle.size * puzzle.size).fill(MARK_GRASS)

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: gardenpath needs a 2d canvas context')
  let fit = initialFit
  let ctx = fit.ctx

  const startLevel = (next: number): void => {
    level = next
    puzzle = makePuzzle(level + 1)
    marks = new Uint8Array(puzzle.size * puzzle.size).fill(MARK_GRASS)
    hover = -1
    hintShown = -1
    steps = 0
    hintsUsed = 0
    solved = false
    elapsedSecs = 0
    shownSec = -1
    elapsed = '0:00'
    winText = null
    loop.markDirty()
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceAt = performance.now() + delayMs
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      const next = (level + 1) % LEVEL_COUNT
      saveLevel('gardenpath', next + 1)
      startLevel(next)
    }, delayMs)
  }

  const cluesTotal = (): number => {
    let count = 0
    for (const kind of puzzle.cells) {
      if (kind === CELL_CLUE) count += 1
    }
    return count
  }

  const checkSolved = (): void => {
    if (solved || !isWon(puzzle, marks)) return
    solved = true
    winText = '第 ' + (level + 1) + ' 关完成 · ' + elapsed
    if (level !== lastScoreLevel) {
      lastScoreLevel = level
      options?.onScore?.(computeScore(level + 1, elapsedSecs, hintsUsed))
    }
    const center = cellCenter(computeLayout(puzzle), puzzle, Math.floor((puzzle.size * puzzle.size) / 2))
    particles.burst(center.x, center.y, THEME.gold, 24, 170)
    loop.markDirty()
    if (running) scheduleAdvance(ADVANCE_MS)
    else advanceRemaining = ADVANCE_MS
  }

  /** 点击空地：花↔草循环（步数只计真实切换）。 */
  const toggleCell = (cell: number): void => {
    if (!running || solved || helpOpen || cell < 0) return
    if (toggleMark(puzzle, marks, cell)) {
      steps += 1
      hintShown = -1
      loop.markDirty()
      checkSolved()
    }
  }

  /** H 提示：把一个与正解不一致的空格直接落成正解子（每关限 2 次）。 */
  const useHint = (): void => {
    if (!running || solved || helpOpen || hintsUsed >= HINT_LIMIT) return
    const cell = hintCell(puzzle, marks)
    if (cell < 0) return
    marks[cell] = puzzle.solution[cell] === 1 ? MARK_FLOWER : MARK_GRASS
    hintsUsed += 1
    hintShown = cell
    loop.markDirty()
    checkSolved()
  }

  const onMouseDown = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    // 说明按钮任何阶段（含暂停/过关）都可点。
    if (helpButtonHit(computeLayout(puzzle), x, y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (!running || helpOpen) return
    toggleCell(cellAt(computeLayout(puzzle), puzzle, x, y))
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!running || helpOpen) {
      if (hover !== -1) { hover = -1; loop.markDirty() }
      return
    }
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    const cell = cellAt(computeLayout(puzzle), puzzle, x, y)
    if (cell !== hover) {
      hover = cell
      loop.markDirty()
    }
  }

  const onMouseLeave = (): void => {
    if (hover !== -1) {
      hover = -1
      loop.markDirty()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      advanceRemaining = 0
      startLevel(level)
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      useHint()
    } else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      advanceRemaining = 0
      const max = Math.min(readLevel('gardenpath'), LEVEL_COUNT)
      const next = level + (event.code === 'BracketRight' ? 1 : -1)
      if (next >= 0 && next < max) startLevel(next)
    }
  }

  const loop = createFrameLoop(f => {
    if (running && !solved) {
      elapsedSecs += f.dt
      const secs = Math.floor(elapsedSecs)
      if (secs !== shownSec) {
        shownSec = secs
        const mm = String(Math.floor(secs / 60))
        const ss = String(secs % 60).padStart(2, '0')
        elapsed = mm + ':' + ss
        loop.markDirty()
      }
    }
    const animating = particles.size() > 0
    if (f.render || animating) {
      renderGardenPath(ctx, puzzle, marks, {
        hovered: hover,
        hintCell: hintShown,
        badClues: unsatisfiedClues(puzzle, marks),
        conflicts: adjacencyConflicts(puzzle, marks),
        level: level + 1,
        steps,
        cluesSat: cluesTotal() - unsatisfiedClues(puzzle, marks).length,
        cluesTotal: cluesTotal(),
        paused: !running && !solved,
        won: solved,
        winText,
        helpOpen,
      }, particles, f.dt * 1000)
      if (animating) loop.markDirty()
    }
  }, { mode: 'dirty' })

  const pause = (): void => {
    if (!running) return
    running = false
    if (advanceTimer !== 0) {
      clearTimeout(advanceTimer)
      advanceTimer = 0
      advanceRemaining = Math.max(0, advanceAt - performance.now())
    }
    loop.pause()
    renderGardenPath(ctx, puzzle, marks, {
      hovered: -1,
      hintCell: hintShown,
      badClues: unsatisfiedClues(puzzle, marks),
      conflicts: adjacencyConflicts(puzzle, marks),
      level: level + 1,
      steps,
      cluesSat: cluesTotal() - unsatisfiedClues(puzzle, marks).length,
      cluesTotal: cluesTotal(),
      paused: true,
      won: solved,
      winText,
      helpOpen,
    })
  }
  const resume = (): void => {
    if (running) return
    running = true
    if (advanceRemaining > 0) {
      scheduleAdvance(advanceRemaining)
      advanceRemaining = 0
    }
    loop.markDirty()
    loop.resume()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const gardenpathGame: MiniGameDefinition = {
  id: 'gardenpath',
  title: '花径寻踪 GardenPath',
  icon: '🌷',
  description: '数字提示花该开在几邻——花朵互不相邻还要铺满花径。',
  controls: ['点击空地：种花 / 留草', 'H 提示(限 2) · R 重开 · P 暂停'],
  create: createGardenPathGame,
}
