/**
 * 翻棋暗战游戏接线：把纯逻辑与渲染拼成 MiniGameInstance。
 * 交互：点暗子翻开、点亮子选中再点落点走子；AI 黑方在帧循环内决策；
 * 三局两胜，R 重开整场，P 暂停，「说明」按钮随时开关帮助面板。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  applyAction, aiChooseAction, createBanqiState, knownPieces, legalActions, moveTargets,
  rowOf, colOf, COLS, ROWS,
  type BanqiState,
} from './logic.ts'
import { renderBanqi, LOGICAL_W, LOGICAL_H, CELL, BOARD_X, BOARD_Y, HELP_RECT, type BanqiView } from './render.ts'
import { createParticles } from '../theme.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 率先赢到的局数（三局两胜）。 */
const MATCH_WINS = 2
/** 翻面动画时长（秒）。 */
const FLIP_SECONDS = 0.34
/** AI 落子前的思考停顿（秒）。 */
const AI_THINK_SECONDS = 0.5

function createBanqiGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: banqi needs a 2d canvas context')
  const ctx = fit.ctx

  const baseSeed = (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) << 3)) >>> 0
  let gameNo = 0
  let state: BanqiState = createBanqiState(baseSeed)
  let running = false
  let matchRed = 0
  let matchBlack = 0
  let selected: number | null = null
  let flip: { index: number, progress: number } | null = null
  let aiDelay = 0
  let helpOpen = false
  let lastScore = -1
  const particles = createParticles()

  const view: BanqiView = {
    selected: null,
    targets: [],
    flip: null,
    matchRed: 0,
    matchBlack: 0,
    status: '红方行棋',
    winnerLabel: null,
    paused: false,
    helpOpen: false,
    particles,
  }

  const matchDecided = (): boolean => matchRed >= MATCH_WINS || matchBlack >= MATCH_WINS

  const refreshView = (): void => {
    view.matchRed = matchRed
    view.matchBlack = matchBlack
    view.selected = selected
    view.targets = selected === null ? [] : moveTargets(state, selected)
    view.flip = flip
    view.helpOpen = helpOpen
    view.winnerLabel = state.winner === null ? null
      : matchDecided()
        ? (matchRed > matchBlack ? '你赢下整场！' : 'AI 赢下整场')
        : (state.winner === 'red' ? '红方本局胜' : '黑方本局胜')
    view.status = state.winner !== null ? '本局结束'
      : state.turn === 'red' ? '红方行棋' : '黑方思考中'
  }

  const reportScore = (): void => {
    const own = state.winner === 'red' ? knownPieces(state, 'red') : 0
    const score = matchRed * 100 + (state.winner === 'red' ? 60 + own : 0)
    if (score === lastScore) return
    lastScore = score
    options?.onScore?.(score)
  }

  const onGameEnd = (): void => {
    if (state.winner === 'red') matchRed += 1
    else if (state.winner === 'black') matchBlack += 1
    particles.burst(LOGICAL_W / 2, BOARD_Y + (ROWS * CELL) / 2, state.winner === 'red' ? '#9ece6a' : '#f7768e', 26, 160)
    refreshView()
    reportScore()
  }

  /** 应用一手并处理翻面动画 / 胜负 / AI 交接。 */
  const perform = (action: { kind: 'flip', index: number } | { kind: 'move', from: number, to: number }): void => {
    if (action.kind === 'flip') {
      applyAction(state, action)
      flip = { index: action.index, progress: 0 }
      selected = null
    } else {
      const target = state.board[action.to]
      applyAction(state, action)
      selected = null
      if (target != null) {
        particles.burst(BOARD_X + (colOf(action.to) + 0.5) * CELL, BOARD_Y + (rowOf(action.to) + 0.5) * CELL, '#e0af68', 12, 120)
      }
    }
    if (state.winner !== null) onGameEnd()
    else if (state.turn === 'black') aiDelay = AI_THINK_SECONDS + FLIP_SECONDS
    refreshView()
    loop.markDirty()
  }

  const startGame = (nextSeed: number): void => {
    state = createBanqiState(nextSeed)
    gameNo += 1
    selected = null
    flip = null
    aiDelay = 0
    refreshView()
    loop.markDirty()
  }

  const restartMatch = (): void => {
    matchRed = 0
    matchBlack = 0
    lastScore = -1
    startGame((baseSeed + gameNo * 7919) >>> 0)
  }

  const indexFromEvent = (event: MouseEvent): number | null => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    const c = Math.floor((x - BOARD_X) / CELL)
    const r = Math.floor((y - BOARD_Y) / CELL)
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null
    return r * COLS + c
  }

  const onMouseDown = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    const inHelp = x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h
    if (inHelp || helpOpen) {
      helpOpen = inHelp ? !helpOpen : false
      refreshView()
      loop.markDirty()
      return
    }
    if (!running || view.paused) return
    if (state.winner !== null) {
      if (matchDecided()) restartMatch()
      else startGame((baseSeed + (gameNo + 1) * 7919) >>> 0)
      return
    }
    if (flip !== null || state.turn !== 'red') return
    const index = indexFromEvent(event)
    if (index === null) return
    const piece = state.board[index]
    if (piece == null) {
      // 空格：若是当前选中子的合法落点则走子（原先直接取消选中——空格移动永远不触发）。
      if (selected !== null && view.targets.includes(index)) {
        perform({ kind: 'move', from: selected, to: index })
        return
      }
      selected = null
    } else if (!piece.revealed) {
      if (legalActions(state, 'red').some((a) => a.kind === 'flip' && a.index === index)) {
        perform({ kind: 'flip', index })
        return
      }
    } else if (piece.side === 'red') {
      selected = moveTargets(state, index).length > 0 ? index : null
    } else if (selected !== null && view.targets.includes(index)) {
      perform({ kind: 'move', from: selected, to: index })
      return
    }
    refreshView()
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restartMatch()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    }
  }

  const loop = createFrameLoop((f) => {
    // AI 思考倒计时必须在早退守卫之前推进，否则 dirty 模式会冻结黑方行棋。
    if (flip === null && running && state.winner === null && state.turn === 'black') {
      aiDelay -= f.dt
      if (aiDelay <= 0) {
        const action = aiChooseAction(state, (baseSeed + gameNo * 6151) >>> 0)
        if (action === null) {
          // 无动作可走由 applyAction 的胜负判定兜底；此处防御性判红胜。
          state.winner = 'red'
          onGameEnd()
        } else {
          perform(action)
          return
        }
      }
    }
    if (state.winner === null && particles.size() === 0 && flip === null && !f.render) return
    if (flip !== null) {
      flip.progress += f.dt / FLIP_SECONDS
      if (flip.progress >= 1) {
        flip = null
        refreshView()
      }
    }
    renderBanqi(ctx, state, view, f.wallMs)
    if (flip !== null || particles.size() > 0 || (state.winner === null && running && state.turn === 'black')) loop.markDirty()
  }, { mode: 'dirty' })

  const togglePause = (): void => {
    if (view.paused) resume()
    else pause()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    view.paused = true
    refreshView()
    loop.pause()
    renderBanqi(ctx, state, view, 16)
  }
  const resume = (): void => {
    if (running) return
    running = true
    view.paused = false
    refreshView()
    loop.resume()
    loop.markDirty()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  refreshView()
  loop.start()
  renderBanqi(ctx, state, view, 16)

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

export const banqiGame: MiniGameDefinition = {
  id: 'banqi',
  title: '翻棋暗战 Banqi',
  icon: '♟️',
  description: '三十二子扣着下——翻出将军才知大小，运气与推理各占一半。',
  controls: ['点击：翻子 / 选子走子', 'R 重开 · P 暂停'],
  create: createBanqiGame,
}
