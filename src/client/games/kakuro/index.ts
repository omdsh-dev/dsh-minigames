/**
 * 数和 Kakuro game definition: wires the segment-sum logic into a
 * MiniGameInstance — click (or arrows) moves the cursor onto a white cell,
 * digits 1-9 type directly, Space/Enter cycles 1..9 then empties, 0/Backspace
 * clears. Every segment filled 1-9 without repeats and summing to its clue
 * fires onScore with the time bonus and auto-advances 1.5s later.
 * Persisted level resumes where the player left off; P pauses (advance
 * timer freezes via the stored-remainder pattern); R restarts; [ ]
 * switches within reached levels.
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import { computeScore, isWon, levelSize, puzzleFromSeed, type KakuroPuzzle } from './logic.ts'
import { cellAt, cellCenter, logicalH, logicalW, renderKakuro } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1500

function createKakuroGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  // Persisted level is 1-based; this game's level index is 0-based.
  let level = readLevel('kakuro') - 1
  let puzzle: KakuroPuzzle
  let grid: number[][] = []
  let cursor = { r: 1, c: 1 }
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

  const startLevel = (lv: number): void => {
    level = lv
    const display = level + 1
    const next = puzzleFromSeed(display * 0x9e3779b9, levelSize(display))
    if (next === null) return
    puzzle = next
    // All white cells start empty.
    grid = Array.from({ length: puzzle.size }, () => new Array<number>(puzzle.size).fill(0))
    cursor = { r: 1, c: 1 }
    solved = false
    elapsedSecs = 0
    shownSec = -1
    elapsed = '0:00'
    winText = null
    refit(puzzle.size)
    loop.markDirty()
  }

  const initial = puzzleFromSeed((level + 1) * 0x9e3779b9, levelSize(level + 1))
  if (initial === null) throw new Error('dsh-minigames: kakuro level generation failed')
  puzzle = initial
  grid = Array.from({ length: puzzle.size }, () => new Array<number>(puzzle.size).fill(0))

  const initialFit = fitCanvas(host, canvas, logicalW(puzzle.size), logicalH(puzzle.size))
  if (initialFit === null) throw new Error('dsh-minigames: kakuro needs a 2d canvas context')
  let fit = initialFit
  let ctx = fit.ctx

  const refit = (size: number): void => {
    fit.dispose()
    const next = fitCanvas(host, canvas, logicalW(size), logicalH(size))
    if (next === null) throw new Error('dsh-minigames: kakuro needs a 2d canvas context')
    fit = next
    ctx = next.ctx
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceAt = performance.now() + delayMs
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      const next = level + 1
      saveLevel('kakuro', next + 1) // persisted 1-based; level is 0-based
      startLevel(next)
    }, delayMs)
  }

  const checkSolved = (): void => {
    if (solved || !isWon(puzzle, grid)) return
    solved = true
    winText = '第 ' + (level + 1) + ' 关完成 · ' + elapsed
    if (level !== lastScoreLevel) {
      lastScoreLevel = level
      options?.onScore?.(computeScore(level + 1, elapsedSecs))
    }
    const center = cellCenter(puzzle.size, Math.floor(puzzle.size / 2), Math.floor(puzzle.size / 2))
    particles.burst(center.x, center.y, THEME.gold, 20, 170)
    loop.markDirty()
    if (running) scheduleAdvance(ADVANCE_MS)
    else advanceRemaining = ADVANCE_MS
  }

  /** Set the focused white cell's digit (0 = empty). */
  const setCell = (r: number, c: number, v: number): void => {
    if (!running || solved) return
    if (puzzle.black[r]![c]) return
    if (grid[r]![c] === v) return
    grid[r]![c] = v
    loop.markDirty()
    checkSolved()
  }

  const cycleCell = (r: number, c: number): void => {
    const next = grid[r]![c]! >= 9 ? 0 : grid[r]![c]! + 1
    setCell(r, c, next)
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * logicalW(puzzle.size)) / rect.width
    const y = ((event.clientY - rect.top) * logicalH(puzzle.size)) / rect.height
    const cell = cellAt(puzzle.size, puzzle.black, x, y)
    if (cell === null) return
    cursor = cell
    loop.markDirty()
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
    } else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      advanceRemaining = 0
      const max = Math.min(readLevel('kakuro'), 5)
      const next = level + (event.code === 'BracketRight' ? 1 : -1)
      if (next >= 0 && next < max) startLevel(next)
    } else if (event.code.startsWith('Arrow')) {
      event.preventDefault()
      if (!running) return
      const size = puzzle.size
      if (event.code === 'ArrowUp') cursor = { r: Math.max(0, cursor.r - 1), c: cursor.c }
      else if (event.code === 'ArrowDown') cursor = { r: Math.min(size - 1, cursor.r + 1), c: cursor.c }
      else if (event.code === 'ArrowLeft') cursor = { r: cursor.r, c: Math.max(0, cursor.c - 1) }
      else cursor = { r: cursor.r, c: Math.min(size - 1, cursor.c + 1) }
      loop.markDirty()
    } else if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault()
      if (running) cycleCell(cursor.r, cursor.c)
    } else if (event.code.startsWith('Digit')) {
      const v = Number(event.code.slice(5))
      if (running && v >= 1 && v <= 9) {
        event.preventDefault()
        setCell(cursor.r, cursor.c, v)
      }
    } else if (event.code === 'Backspace' || event.code === 'Delete' || event.code === 'Digit0') {
      event.preventDefault()
      if (running) setCell(cursor.r, cursor.c, 0)
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
      renderKakuro(ctx, puzzle, grid, cursor, false, winText)
      particles.tick(ctx, f.dt * 1000)
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
    renderKakuro(ctx, puzzle, grid, cursor, true, winText)
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
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const kakuroGame: MiniGameDefinition = {
  id: 'kakuro',
  title: '数和 Kakuro',
  icon: '➕',
  description: '每段白格填 1-9 且不重复，行/列各段的和必须等于黑格里的提示数。',
  controls: ['点击 / 方向键 + 数字键 1-9 填入', '0 / 退格清空 · 段内数字不能重复', 'R：重开本关 · [ ]：切换关卡 · P：暂停'],
  create: createKakuroGame,
}
