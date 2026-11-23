/**
 * 国际跳棋游戏定义：把纯规则与 2 层极小极大 AI 组装成 MiniGameInstance。
 * 玩家执红（向上），点击选子 / 走子；AI 执黑延迟应手；有吃必吃由
 * legalMoves 直接保证。U 悔棋、R 重开本局、P 暂停；3 局 2 胜，胜负
 * 与必吃警示经渲染层展示，「说明」面板任何阶段可开合。AI 种子由
 * 局号 + 手数派生，同一局完全确定。dirty 模式按需重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  applyMove, chooseMove, createStartPosition, legalMoves, status,
  type DraughtsMove, type DraughtsOutcome, type DraughtsPosition,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, pointInHelp, renderDraughts, squareAt, squareCenter,
  type DraughtsView,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

const AI_DELAY_MS = 350
const GAME_ID = 'draughts'
const ROUNDS_TO_WIN = 2

function createDraughtsGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: draughts needs a 2d canvas context')
  const ctx = fit.ctx

  let pos: DraughtsPosition = createStartPosition()
  let selected = -1
  let targets = new Set<number>()
  let lastMove: DraughtsMove | null = null
  let over: DraughtsOutcome = { kind: 'playing' }
  /** 悔棋快照：玩家每次落子前的局面 + 当时的最后一步标记。 */
  const history: Array<{ pos: DraughtsPosition; lastMove: DraughtsMove | null }> = []
  let round = 1
  let youWins = 0
  let aiWins = 0
  let matchOver = false
  let lastReported = -1
  let running = false
  let aiAt = 0
  let ply = 0
  let helpOpen = false
  const particles = createParticles()

  /** 当前是否处于有吃必吃（用于红圈警示与状态文案）。 */
  const captureInfo = (): { froms: Set<number> } => {
    const moves = legalMoves(pos)
    const froms = new Set<number>()
    if (moves.length > 0 && moves[0]!.captures.length > 0) {
      for (const m of moves) froms.add(m.from)
    }
    return { froms }
  }

  const reportScore = (): void => {
    if (!matchOver) return
    if (youWins <= lastReported) return
    lastReported = youWins
    options?.onScore?.(youWins)
  }

  const resetRoundState = (): void => {
    pos = createStartPosition()
    selected = -1
    targets = new Set()
    lastMove = null
    over = { kind: 'playing' }
    history.length = 0
    aiAt = 0
    ply = 0
  }

  const restartRound = (): void => {
    resetRoundState()
    loop.markDirty()
  }

  const newMatch = (): void => {
    round = 1
    youWins = 0
    aiWins = 0
    matchOver = false
    resetRoundState()
    loop.markDirty()
  }

  const overlayFor = (): { text: string; sub: string; color: string } | null => {
    if (over.kind !== 'win') return null
    const youWon = over.winner === 'r'
    if (matchOver) {
      return youWon
        ? { text: '你赢得整场！', sub: '点击开启新一场 · 3 局 2 胜', color: THEME.good }
        : { text: 'AI 赢得整场', sub: '点击开启新一场 · 3 局 2 胜', color: THEME.bad }
    }
    return youWon
      ? { text: '你赢下本局！', sub: '点击进入第 ' + (round + 1) + ' 局', color: THEME.good }
      : { text: 'AI 赢下本局', sub: '点击进入第 ' + (round + 1) + ' 局', color: THEME.bad }
  }

  /** 应用一手并处理终局 / AI 排程与粒子。 */
  const play = (m: DraughtsMove, byPlayer: boolean): void => {
    if (byPlayer) history.push({ pos, lastMove })
    const captureColor = byPlayer ? THEME.good : THEME.bad
    for (const cap of m.captures) {
      const [cx, cy] = squareCenter(cap)
      particles.burst(cx, cy, captureColor, 8, 120)
    }
    pos = applyMove(pos, m)
    lastMove = m
    selected = -1
    targets = new Set()
    ply += 1
    over = status(pos)
    if (over.kind === 'win') {
      if (over.winner === 'r') youWins += 1
      else aiWins += 1
      if (youWins >= ROUNDS_TO_WIN || aiWins >= ROUNDS_TO_WIN) matchOver = true
      const [wx, wy] = squareCenter(m.to)
      particles.burst(wx, wy, over.winner === 'r' ? THEME.gold : THEME.bad, 18, 160)
      reportScore()
      aiAt = 0
    } else if (!byPlayer) {
      aiAt = 0
    } else {
      aiAt = performance.now() + AI_DELAY_MS
    }
    loop.markDirty()
  }

  const aiSeed = (): number => (0xd4a70000 ^ Math.imul(round, 7919) ^ Math.imul(ply, 104729)) >>> 0

  const aiMove = (): void => {
    const m = chooseMove(pos, aiSeed())
    if (m === null) {
      over = status(pos)
      if (over.kind === 'win' && over.winner === 'r') {
        youWins += 1
        if (youWins >= ROUNDS_TO_WIN) matchOver = true
        reportScore()
      }
      return
    }
    play(m, false)
  }

  const tryPlayerMove = (from: number, to: number): boolean => {
    const m = legalMoves(pos).find(mm => mm.from === from && mm.to === to)
    if (m === undefined) return false
    play(m, true)
    return true
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    if (helpOpen) {
      helpOpen = false
      loop.markDirty()
      return
    }
    if (pointInHelp(x, y)) {
      helpOpen = true
      loop.markDirty()
      return
    }
    if (over.kind === 'win') {
      if (matchOver) newMatch()
      else {
        round += 1
        restartRound()
      }
      return
    }
    if (aiAt > 0) return
    const sq = squareAt(x, y)
    if (sq < 0) {
      selected = -1
      targets = new Set()
      loop.markDirty()
      return
    }
    if (selected >= 0 && targets.has(sq)) {
      tryPlayerMove(selected, sq)
      return
    }
    const moves = legalMoves(pos).filter(m => m.from === sq)
    if (moves.length > 0) {
      selected = sq
      targets = new Set(moves.map(m => m.to))
    } else {
      selected = -1
      targets = new Set()
    }
    loop.markDirty()
  }

  const undo = (): void => {
    if (history.length === 0) return
    if (aiAt > 0 || over.kind !== 'playing') return
    const snap = history.pop()!
    pos = snap.pos
    lastMove = snap.lastMove
    selected = -1
    targets = new Set()
    ply = Math.max(0, ply - 2)
    loop.markDirty()
  }

  const buildView = (paused: boolean): DraughtsView => {
    const info = captureInfo()
    let statusText: string
    let statusColor: string
    if (paused) {
      statusText = '已暂停'
      statusColor = THEME.textMuted
    } else if (over.kind === 'win') {
      statusText = matchOver ? '整场结束 · 点击继续' : '本局结束 · 点击继续'
      statusColor = THEME.textMuted
    } else if (aiAt > 0) {
      statusText = 'AI 思考中…'
      statusColor = THEME.textMuted
    } else if (info.froms.size > 0) {
      statusText = '有吃必吃：请走红圈棋子（红圈为落点）'
      statusColor = THEME.bad
    } else {
      statusText = '轮到你走：红方向上斜行'
      statusColor = THEME.text
    }
    return {
      pos,
      selected,
      targets,
      captureFroms: info.froms,
      lastMove,
      youWins,
      aiWins,
      round,
      statusText,
      statusColor,
      overlay: paused
        ? { text: '已暂停', sub: '按 P 继续', color: THEME.text }
        : overlayFor(),
      helpOpen,
    }
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    const now = performance.now()
    if (over.kind === 'playing' && aiAt > 0 && now >= aiAt) {
      aiAt = 0
      aiMove()
    }
    if (!f.render && particles.size() === 0) return
    renderDraughts(ctx, buildView(false))
    particles.tick(ctx, f.dt * 1000)
  }

  const loop = createFrameLoop(frame, { mode: 'dirty' })

  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    renderDraughts(ctx, buildView(true))
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.start()
    loop.markDirty()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restartRound()
    } else if (event.code === 'KeyU') {
      event.preventDefault()
      undo()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
    }
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
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const draughtsGame: MiniGameDefinition = {
  id: 'draughts',
  title: '国际跳棋 Draughts',
  icon: '⚊',
  description: '斜行向前、跳吃升王——八乘八棋盘上的经典对决，一步强制吃子定乾坤。',
  controls: ['点击选子与落子；红圈=必吃', 'U 悔棋 / R 重开 / P 暂停'],
  create: createDraughtsGame,
}
