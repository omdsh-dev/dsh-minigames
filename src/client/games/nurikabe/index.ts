/**
 * 数回 game definition: wires the island/sea logic into a
 * MiniGameInstance — click (or arrows + Space) toggles a cell between sea
 * (shaded) and undecided; numbered cells stay locked white. The board wins
 * when every island matches its number exactly, islands do not touch, the
 * sea is one connected region, and no 2×2 block is all sea. Generation on
 * big boards is solver-heavy, so puzzles are cached per display level for
 * the page lifetime (deterministic per level). Persisted level resumes
 * where the player left off; P pauses (advance timer freezes via the
 * stored-remainder pattern); R restarts; [ ] switches within reached
 * levels.
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  computeScore, isWon, levelIslands, levelSize, puzzleFromSeed,
  type NuriPuzzle,
} from './logic.ts'
import { cellAt, cellCenter, logicalH, logicalW, renderNuri } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1500

function createNuriGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  // Persisted level is 1-based; this game's level index is 0-based.
  let level = readLevel('nurikabe') - 1
  let puzzle: NuriPuzzle
  let blacks = new Set<number>()
  let cursor = -1
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

  /** Page-lifetime puzzle cache: each display level generates once. */
  const puzzleCache = new Map<number, NuriPuzzle>()
  const makePuzzle = (display: number): NuriPuzzle => {
    const hit = puzzleCache.get(display)
    if (hit !== undefined) return hit
    const fresh = puzzleFromSeed(display * 0x9e3779b9, levelSize(display), levelIslands(display))
    if (fresh === null) throw new Error('dsh-minigames: nurikabe level generation failed')
    puzzleCache.set(display, fresh)
    return fresh
  }

  puzzle = makePuzzle(level + 1)

  const initialFit = fitCanvas(host, canvas, logicalW(puzzle.size), logicalH(puzzle.size))
  if (initialFit === null) throw new Error('dsh-minigames: nurikabe needs a 2d canvas context')
  let fit = initialFit
  let ctx = fit.ctx

  const refit = (size: number): void => {
    fit.dispose()
    const next = fitCanvas(host, canvas, logicalW(size), logicalH(size))
    if (next === null) throw new Error('dsh-minigames: nurikabe needs a 2d canvas context')
    fit = next
    ctx = next.ctx
  }

  const startLevel = (next: number): void => {
    level = next
    const display = level + 1
    puzzle = makePuzzle(display)
    blacks = new Set()
    cursor = -1
    solved = false
    elapsedSecs = 0
    shownSec = -1
    elapsed = '0:00'
    winText = null
    refit(puzzle.size)
    loop.markDirty()
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceAt = performance.now() + delayMs
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      const next = level + 1
      saveLevel('nurikabe', next + 1) // persisted 1-based; level is 0-based
      startLevel(next)
    }, delayMs)
  }

  const checkSolved = (): void => {
    if (solved || !isWon(puzzle, blacks)) return
    solved = true
    winText = '第 ' + (level + 1) + ' 关完成 · ' + elapsed
    if (level !== lastScoreLevel) {
      lastScoreLevel = level
      options?.onScore?.(computeScore(level + 1, elapsedSecs))
    }
    const center = cellCenter(puzzle.size, Math.floor((puzzle.size * puzzle.size) / 2))
    particles.burst(center.x, center.y, THEME.gold, 20, 170)
    loop.markDirty()
    if (running) scheduleAdvance(ADVANCE_MS)
    else advanceRemaining = ADVANCE_MS
  }

  /** Toggle a cell between shaded sea and undecided; anchors stay white. */
  const toggleCell = (cell: number): void => {
    if (!running || solved || cell < 0) return
    if (puzzle.numbers.has(cell)) return
    if (blacks.has(cell)) blacks.delete(cell)
    else blacks.add(cell)
    loop.markDirty()
    checkSolved()
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * logicalW(puzzle.size)) / rect.width
    const y = ((event.clientY - rect.top) * logicalH(puzzle.size)) / rect.height
    const cell = cellAt(puzzle.size, x, y)
    if (cell >= 0) {
      cursor = cell
      toggleCell(cell)
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
    } else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      advanceRemaining = 0
      const max = Math.min(readLevel('nurikabe'), 5)
      const next = level + (event.code === 'BracketRight' ? 1 : -1)
      if (next >= 0 && next < max) startLevel(next)
    } else if (event.code.startsWith('Arrow') || event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault()
      if (!running) return
      const size = puzzle.size
      const r = cursor < 0 ? Math.floor(size / 2) : Math.floor(cursor / size)
      const c = cursor < 0 ? Math.floor(size / 2) : cursor % size
      if (event.code === 'ArrowUp') cursor = Math.max(0, r - 1) * size + c
      else if (event.code === 'ArrowDown') cursor = Math.min(size - 1, r + 1) * size + c
      else if (event.code === 'ArrowLeft') cursor = r * size + Math.max(0, c - 1)
      else if (event.code === 'ArrowRight') cursor = r * size + Math.min(size - 1, c + 1)
      else { toggleCell(cursor); return }
      loop.markDirty()
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
      renderNuri(ctx, puzzle, blacks, cursor, false, winText)
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
    renderNuri(ctx, puzzle, blacks, cursor, true, winText)
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

export const nurikabeGame: MiniGameDefinition = {
  id: 'nurikabe',
  title: '数回 Nurikabe',
  icon: '🏝️',
  description: '把非数字格涂黑成海：每座白岛大小等于岛上数字，岛与岛不相邻，海全连通且无 2×2 黑块。',
  controls: ['点击 / 方向键 + 空格：涂黑或还原', '数字格是岛锚点（白）', 'R：重开本关 · [ ]：切换关卡 · P：暂停'],
  create: createNuriGame,
}
