/**
 * 飞行棋 Ludo 游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 开局
 * overlay 选 2/3/4 人（玩家恒执红，其余为 AI）；空格/点按钮掷骰，点
 * 击发光飞机移动（唯一合法着法自动落子，空格也可交给贪心自动走），
 * 悬停可动飞机时预览高亮落点；AI 各色自动掷骰行子；踩子触发回程幽灵
 * 动画与粒子；2 人 3 局 2 胜、多人单局定胜负，R 重开整场（保留人
 * 数）、P 暂停、H 或「说明」按钮随时开关帮助面板。骰子滚动与 AI 回
 * 合期间逐帧重绘，静态盘面按脏标记按需重绘。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  applyPieceMove, chooseMove, createLudo, legalMovesFor, nextRound, ringIndexFor, rollFor,
  type LudoState, type Side,
} from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, helpButtonAt, planeAt, posToCenter, renderLudo, rollButtonAt, setupButtonAt,
  type LudoView,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { accent, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ROLL_MS = 520
const AI_THINK_MS = 430
const AUTO_MOVE_MS = 380
const GHOST_MS = 450

/** 每次重开的新种子来源：时间戳异或递增计数器。 */
let restartCounter = 0
function nextSeed(): number {
  restartCounter = (restartCounter + 1) >>> 0
  return (Date.now() ^ Math.imul(restartCounter, 0x9e3779b9)) >>> 0
}

function createLudoGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: ludo needs a 2d canvas context')
  const ctx = initialFit.ctx

  // 开局先选人数（默认 2 人占位状态，选择后按人数重建）。
  let state: LudoState = createLudo(nextSeed())
  let playerCount = 2
  let awaitingSetup = true
  let userPaused = false
  let running = false
  let rolling = false
  let rollEndsAt = 0
  let aiMoveAt = 0
  let autoMoveAt = 0
  let helpOpen = false
  let lastScore = -1
  let hoverPiece: number | null = null
  let hoverTo: number | null = null
  let capture: { cells: number[], at: number, victim: Side } | null = null
  const particles = createParticles()

  /** 玩家当前可动的飞机编号（待行子阶段）。 */
  const movable = (): number[] => {
    if (awaitingSetup || state.phase !== 'move' || state.turn !== 'you' || state.dice === null) return []
    const set = new Set<number>()
    for (const m of legalMovesFor(state, 'you', state.dice)) set.add(m.piece)
    return [...set]
  }

  const reportScore = (): void => {
    let progress = 0
    for (const p of state.pieces.you) progress += p === -1 ? 0 : p + 1
    const score = state.roundWinsYou * 1000 + progress
    if (score === lastScore) return
    lastScore = score
    options?.onScore?.(score)
  }

  /** 掷骰动画启动（面值在动画结束时由逻辑层确定性地生成）。 */
  const startRoll = (): void => {
    if (state.phase !== 'roll' || rolling) return
    rolling = true
    rollEndsAt = performance.now() + ROLL_MS
    autoMoveAt = 0
    loop.markDirty()
  }

  /** 动画结束落地：真正掷骰；AI 行子排思考延时，玩家唯一着法排自动落子。 */
  const finishRoll = (): void => {
    rolling = false
    rollFor(state)
    const now = performance.now()
    if (state.phase === 'move' && state.turn !== 'you') {
      aiMoveAt = now + AI_THINK_MS
    } else if (state.phase === 'move' && state.turn === 'you') {
      if (movable().length === 1) autoMoveAt = now + AUTO_MOVE_MS
    }
    reportScore()
    loop.markDirty()
  }

  /** 落实一步并触发捕获回程动画与粒子反馈。 */
  const playMove = (side: Side, piece: number): boolean => {
    if (state.phase !== 'move' || state.dice === null) return false
    const move = legalMovesFor(state, side, state.dice).find(m => m.piece === piece)
    if (move === undefined) return false
    applyPieceMove(state, side, move)
    if (move.captured.length > 0) {
      const victim: Side = move.capturedSides[0] ?? (side === 'you' ? 'ai' : 'you')
      const cells: number[] = []
      if (!move.takeoff && move.to <= 50) {
        cells.push(ringIndexFor(side, move.to))
      }
      capture = { cells, at: performance.now(), victim }
      if (cells.length > 0) {
        const c = posToCenter(side, move.to, move.piece)
        particles.burst(c.x, c.y, accent(4), 12, 140)
      }
    }
    hoverPiece = null
    hoverTo = null
    aiMoveAt = 0
    autoMoveAt = 0
    reportScore()
    loop.markDirty()
    return true
  }

  /** 玩家贪心自动走（空格触发；AI 各色复用 chooseMove）。 */
  const autoPlay = (): void => {
    const move = chooseMove(state, state.turn)
    if (move !== null) playMove(state.turn, move.piece)
  }

  /** 按当前人数重开整场（保留人数选择）。 */
  const restart = (): void => {
    state = createLudo(nextSeed(), playerCount)
    userPaused = false
    rolling = false
    aiMoveAt = 0
    autoMoveAt = 0
    hoverPiece = null
    hoverTo = null
    capture = null
    reportScore()
    loop.markDirty()
  }

  /** 开局人数选择落地：按人数重建对局状态。 */
  const chooseCount = (count: number): void => {
    playerCount = count
    awaitingSetup = false
    restart()
  }

  const advance = (): void => {
    if (awaitingSetup) return
    if (state.phase === 'roundOver') {
      nextRound(state)
      reportScore()
      loop.markDirty()
    } else if (state.phase === 'matchOver') {
      restart()
    } else if (state.phase === 'roll') {
      startRoll()
    } else if (state.phase === 'move') {
      autoPlay()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    // 浏览器快捷键（Ctrl/Cmd+R 等）不拦截。
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === 'Space') {
      event.preventDefault()
      if (!running || userPaused || rolling || awaitingSetup) return
      advance()
      return
    }
    if (event.code === 'KeyR') {
      event.preventDefault()
      if (awaitingSetup) return
      restart()
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      if (state.phase !== 'matchOver' && !awaitingSetup) {
        userPaused = !userPaused
        loop.markDirty()
      }
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
    }
  }

  /** 逻辑坐标换算（鼠标事件共用）。 */
  const logicalXY = (event: MouseEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    return { x, y }
  }

  const onMouseDown = (event: MouseEvent): void => {
    const { x, y } = logicalXY(event)
    // 说明按钮任何阶段（含暂停、结束、选人）都可开合，且永远最先命中。
    if (helpButtonAt(x, y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    // 开局选人：点中 2/3/4 按钮即开局。
    if (awaitingSetup) {
      const count = setupButtonAt(x, y)
      if (count !== null) chooseCount(count)
      return
    }
    if (!running || userPaused || rolling) return
    if (state.phase === 'matchOver') {
      restart()
      return
    }
    if (state.phase === 'roundOver') {
      nextRound(state)
      reportScore()
      loop.markDirty()
      return
    }
    if (state.phase === 'roll' && state.turn === 'you') {
      if (rollButtonAt(x, y)) startRoll()
      return
    }
    if (state.phase === 'move' && state.turn === 'you') {
      const piece = planeAt(state, movable(), x, y)
      if (piece !== null) playMove('you', piece)
    }
  }

  /** 悬停预览：待行子阶段鼠标靠近可动飞机时记录编号与落点（渲染高亮）。 */
  const onMouseMove = (event: MouseEvent): void => {
    const { x, y } = logicalXY(event)
    let piece: number | null = null
    let to: number | null = null
    if (running && !userPaused && !rolling && !awaitingSetup
      && state.phase === 'move' && state.turn === 'you' && state.dice !== null && movable().length > 1) {
      piece = planeAt(state, movable(), x, y)
      if (piece !== null) {
        const move = legalMovesFor(state, 'you', state.dice).find(m => m.piece === piece)
        if (move === undefined) {
          piece = null
        } else {
          to = move.to
        }
      }
    }
    if (piece !== hoverPiece || to !== hoverTo) {
      hoverPiece = piece
      hoverTo = to
      loop.markDirty()
    }
  }

  const view = (): LudoView => ({
    state,
    movable: !awaitingSetup && state.phase === 'move' && state.turn === 'you' && !rolling ? movable() : [],
    setup: awaitingSetup,
    hoverPiece,
    hoverTo,
    rolling,
    rollingFace: 1 + (Math.floor(performance.now() / 80) % 6),
    capture,
    userPaused,
    paused: !running,
    helpOpen,
    now: performance.now(),
  })

  // 脏标记渲染：静态盘面只在状态或动效变化时重绘（见 frame-scheduler）。
  const loop = createFrameLoop(f => {
    const dtMs = f.dt * 1000
    const now = performance.now()
    // AI 与自动落子驱动：待掷骰先掷（带动画），行子阶段思考后落地。
    if (!userPaused && running && !awaitingSetup) {
      if (state.phase === 'roll' && state.turn !== 'you' && !rolling) startRoll()
      if (rolling && now >= rollEndsAt) finishRoll()
      if (!rolling && state.phase === 'move' && state.turn !== 'you') {
        if (aiMoveAt === 0) aiMoveAt = now + AI_THINK_MS
        else if (now >= aiMoveAt) {
          aiMoveAt = 0
          autoPlay()
        }
      }
      if (!rolling && autoMoveAt > 0 && now >= autoMoveAt && state.phase === 'move' && state.turn === 'you') {
        autoMoveAt = 0
        autoPlay()
      }
    }
    const ghostActive = capture !== null && now - capture.at < GHOST_MS
    const hoverActive = hoverPiece !== null
    const animating = rolling || ghostActive || particles.size() > 0 || hoverActive
      || (state.phase === 'move')
      || (state.phase === 'roll' && state.turn !== 'you')
    if (f.render || animating) {
      renderLudo(ctx, view())
      particles.tick(ctx, dtMs)
      if (animating) loop.markDirty()
    }
  }, { mode: 'dirty' })

  const pause = (): void => {
    running = false
    loop.pause()
    renderLudo(ctx, view())
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.markDirty()
    loop.resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  renderLudo(ctx, view())

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      initialFit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const ludoGame: MiniGameDefinition = {
  id: 'ludo',
  title: '飞行棋 Ludo',
  icon: '🎮',
  description: '掷六起飞、踩子回家、安全格歇脚——2 至 4 人四色竞速的经典回忆。',
  controls: ['开局选 2/3/4 人 · 空格 / 点骰子：掷骰 · 点发光飞机：移动 · 悬停预览落点', 'R：重开 · P：暂停 · H：说明'],
  create: createLudoGame,
}
