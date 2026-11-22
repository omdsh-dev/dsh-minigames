/**
 * 磁极谜题游戏定义：把纯逻辑接成 {@link MiniGameInstance}——dirty 按需
 * 重绘。点击磁格循环 空→+→−→中性→空（绝缘块不可点）；H 揭示一格与
 * 唯一解不符的极性（每关限 2 次，金点标记）；R 重开本关、P 暂停。全
 * 部磁格极性正确且行列计数精确吻合即过关，onScore 上报得分后 1.5 秒
 * 自动进入下一关（第 5 关过后循环回第 1 关重新生成同 seed 盘面）。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  LEVEL_COUNT, applyClick, computeScore, findConflictCells, hintCell, isWon,
  levelSize, puzzleFromSeed,
} from './logic.ts'
import type { MagnetsPuzzle } from './logic.ts'
import { cellAt, cellCenter, logicalH, logicalW, renderMagnets } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1500
const MAX_HINTS = 2

function createMagnetsGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)

  let level = 0
  let puzzle: MagnetsPuzzle
  let marks: number[] = []
  let revealed: number[] = []
  let hintsLeft = MAX_HINTS
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

  const buildPuzzle = (lv: number): MagnetsPuzzle => {
    const made = puzzleFromSeed(((lv + 1) * 0x9e3779b9) >>> 0, levelSize(lv + 1))
    if (made === null) throw new Error('dsh-minigames: magnets level generation failed')
    return made
  }
  puzzle = buildPuzzle(0)

  const initialFit = fitCanvas(host, canvas, logicalW(puzzle.size), logicalH(puzzle.size))
  if (initialFit === null) throw new Error('dsh-minigames: magnets needs a 2d canvas context')
  let fit = initialFit
  let ctx = initialFit.ctx

  const refit = (size: number): void => {
    fit.dispose()
    const next = fitCanvas(host, canvas, logicalW(size), logicalH(size))
    if (next === null) throw new Error('dsh-minigames: magnets needs a 2d canvas context')
    fit = next
    ctx = next.ctx
  }

  const startLevel = (next: number): void => {
    level = next
    puzzle = buildPuzzle(level)
    marks = new Array<number>(puzzle.size * puzzle.size).fill(0)
    revealed = []
    hintsLeft = MAX_HINTS
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
      startLevel((level + 1) % LEVEL_COUNT)
    }, delayMs)
  }

  const checkSolved = (): void => {
    if (solved || !isWon(puzzle, marks)) return
    solved = true
    winText = '第 ' + (level + 1) + ' 关完成 · ' + elapsed
    if (level !== lastScoreLevel) {
      lastScoreLevel = level
      options?.onScore?.(computeScore(level + 1, elapsedSecs, MAX_HINTS - hintsLeft))
    }
    const center = cellCenter(puzzle.size, Math.floor((puzzle.size * puzzle.size) / 2))
    particles.burst(center.x, center.y, THEME.gold, 20, 170)
    loop.markDirty()
    if (running) scheduleAdvance(ADVANCE_MS)
    else advanceRemaining = ADVANCE_MS
  }

  const draw = (pausedView: boolean): void => {
    renderMagnets(ctx, puzzle, marks, solved ? [] : findConflictCells(puzzle, marks), revealed,
      { level: level + 1, levelTotal: LEVEL_COUNT, hintsLeft, time: elapsed },
      pausedView, winText)
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!running || solved) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * logicalW(puzzle.size)) / rect.width
    const y = ((event.clientY - rect.top) * logicalH(puzzle.size)) / rect.height
    const cell = cellAt(puzzle.size, x, y)
    if (cell < 0) return
    if (applyClick(puzzle, marks, cell) !== null) {
      loop.markDirty()
      checkSolved()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
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
      if (!running || solved || hintsLeft <= 0) return
      const cell = hintCell(puzzle, marks)
      if (cell < 0) return
      marks[cell] = puzzle.solution[cell]!
      if (!revealed.includes(cell)) revealed.push(cell)
      hintsLeft -= 1
      loop.markDirty()
      checkSolved()
    }
  }

  const loop = createFrameLoop(f => {
    if (running && !solved) {
      elapsedSecs += f.dt
      const secs = Math.floor(elapsedSecs)
      if (secs !== shownSec) {
        shownSec = secs
        elapsed = String(Math.floor(secs / 60)) + ':' + String(secs % 60).padStart(2, '0')
        loop.markDirty()
      }
    }
    const animating = particles.size() > 0
    if (f.render || animating) {
      draw(false)
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
    draw(true)
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

  canvas.addEventListener('pointerdown', onPointerDown)
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
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const magnetsGame: MiniGameDefinition = {
  id: 'magnets',
  title: '磁极谜题 Magnets',
  icon: '🔌',
  description: '每格是磁铁还是绝缘块？同极不相邻，行列极数都对上才算赢。',
  controls: [
    '点击磁格循环：空 → + → − → 中性 → 空（灰色绝缘块不可点）',
    '每块双格磁铁必为一正一负；水平或垂直相邻的同极相斥，禁止出现',
    '四周 +/− 提示须精确匹配：超出即红显，同极相邻格红框',
    'H：揭示一格正确极性（每关限 2 次）· R：重开本关 · P：暂停',
    '全部磁格定极且行列计数吻合即过关，自动进入下一关',
  ],
  create: createMagnetsGame,
}
