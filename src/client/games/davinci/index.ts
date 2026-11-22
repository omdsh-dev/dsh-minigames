/**
 * 达芬奇密码游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点牌堆
 * 摸牌、点己方牌位选插入点、点对方牌位弹数值面板猜数、空格结束回合 /
 * 下一局、R 重开（换新种子）、P 暂停。回合制 dirty 帧循环：输入、AI
 * 思考倒计时与翻开动画期间重绘；局分经 onScore 上报（每局 100 分，
 * 夺冠再奖 300）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  aiTakeTurn, createDavinci, endTurn, guess, playerDraw, playerInsert,
  startNextRound, type DavinciState,
} from './logic.ts'
import { W, H, hitTest, renderDavinci, type DavinciView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'
import { THEME, createParticles } from '../theme.ts'

/** 初始种子（R 重开时按重开次数偏移换新序列）。 */
const BASE_SEED = 20261122
/** AI 思考展示时长（秒）。 */
const AI_THINK_S = 0.9
/** 翻面动画速率（每秒进度）。 */
const REVEAL_SPEED = 2

function createDavinciGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: davinci needs a 2d canvas context')
  const ctx = fit.ctx

  let gameNo = 0
  let state: DavinciState = createDavinci(BASE_SEED)
  let picking: number | null = null
  let running = false
  let paused = false
  /** 说明面板开关（替代常驻小字速览，点击「说明」切换）。 */
  let helpOpen = false
  let lastScore = -1
  let lastLogLen = 0
  let reveal = 1
  let aiTimer = 0
  const particles = createParticles()

  /** 局分上报：每局 100 分，夺冠再奖 300。 */
  const reportScore = (): void => {
    const score = state.roundWinsYou * 100
      + (state.phase === 'matchOver' && state.matchWinner === 'you' ? 300 : 0)
    if (score === lastScore) return
    lastScore = score
    options?.onScore?.(score)
  }

  /** 事件侦测：新翻开触发翻面动画与粒子，局/比赛结束触发上报。 */
  const detectEvents = (): void => {
    if (state.log.length === lastLogLen) return
    const fresh = state.log.slice(lastLogLen)
    lastLogLen = state.log.length
    if (fresh.some(e => e.kind === 'guess')) {
      reveal = 0
      const last = state.lastReveal
      if (last !== null && last.reason === 'target') {
        particles.burst(W / 2, last.side === 'ai' ? 106 : 336, THEME.gold, 14, 140)
      }
    }
    reportScore()
  }

  /** 动画与 AI 推进（每帧调用）：翻面动画、AI 思考倒计时、粒子。 */
  const tickAnimations = (dt: number): boolean => {
    let animating = false
    if (state.lastReveal !== null && reveal < 1) {
      reveal = Math.min(1, reveal + dt * REVEAL_SPEED)
      animating = true
    }
    if (state.phase === 'playing' && state.turn === 'ai') {
      // dirty 模式下未置脏的帧不会回调，倒计时期间必须持续置脏。
      loop.markDirty()
      aiTimer += dt
      animating = true
      if (aiTimer >= AI_THINK_S) {
        aiTimer = 0
        aiTakeTurn(state)
        detectEvents()
      }
    } else {
      aiTimer = 0
    }
    if (particles.size() > 0) animating = true
    return animating
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    const animating = tickAnimations(f.dt)
    if (f.render || animating) {
      renderDavinci(ctx, helpOpen, { state, picking, reveal, aiThinking: aiTimer > 0, paused: false })
      particles.tick(ctx, f.dt * 1000)
      if (animating) loop.markDirty()
    }
  }
  const loop = createFrameLoop(frame, { mode: 'dirty' })

  /** 统一的输入出口：回合闸门通过后执行并置脏。 */
  const act = (fn: () => void): void => {
    if (!running || paused) return
    if (state.phase === 'playing' && state.turn !== 'you') return
    fn()
    detectEvents()
    loop.markDirty()
  }

  /** 空格：猜对后主动收手结束回合 / 一局结束开下一局。 */
  const doSpace = (): void => {
    if (state.phase === 'roundOver') {
      act(() => { startNextRound(state) })
      return
    }
    if (state.phase === 'playing' && state.pending === null && picking === null) {
      act(() => { endTurn(state, 'you') })
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    if (!running) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * W
    const y = ((event.clientY - rect.top) / rect.height) * H
    const region = hitTest(x, y, { state, picking, reveal, aiThinking: false, paused: false })
    if (region === null) return
    // 说明按钮：任何阶段/暂停中都可切换（含 matchOver 终局界面）。
    if (region.kind === 'help') {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (paused || state.phase !== 'playing' && state.phase !== 'roundOver') return
    if (region.kind === 'next') {
      act(() => { startNextRound(state) })
    } else if (region.kind === 'pile') {
      act(() => { playerDraw(state) })
    } else if (region.kind === 'aiCard') {
      if (state.turn === 'you' && state.pending === null) {
        picking = region.index
        loop.markDirty()
      }
    } else if (region.kind === 'insert') {
      act(() => { playerInsert(state, region.index) })
    } else if (region.kind === 'insertEnd') {
      act(() => { playerInsert(state, state.yourHand.length) })
    } else if (region.kind === 'value') {
      if (picking !== null) {
        const target = picking
        picking = null
        act(() => { guess(state, 'you', target, region.value) })
      }
    }
  }

  const reset = (): void => {
    gameNo += 1
    state = createDavinci((BASE_SEED + gameNo * 0x9e3779b9) >>> 0)
    picking = null
    lastLogLen = 0
    reveal = 1
    aiTimer = 0
    paused = false
    reportScore()
    loop.markDirty()
    renderDavinci(ctx, helpOpen, { state, picking, reveal: 1, aiThinking: false, paused: false })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    switch (event.code) {
      case 'Space':
        event.preventDefault()
        if (picking !== null) {
          picking = null
          loop.markDirty()
        } else {
          doSpace()
        }
        break
      case 'Enter':
      case 'NumpadEnter':
        event.preventDefault()
        doSpace()
        break
      case 'KeyR':
        event.preventDefault()
        reset()
        break
      case 'KeyP':
        event.preventDefault()
        togglePause()
        break
    }
  }

  const pause = (): void => {
    if (!running) return
    paused = true
    running = false
    loop.pause()
    renderDavinci(ctx, helpOpen, { state, picking, reveal, aiThinking: false, paused: true })
  }
  const resume = (): void => {
    if (running) return
    running = true
    paused = false
    loop.markDirty()
    loop.start()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  reportScore()
  loop.start()
  renderDavinci(ctx, helpOpen, { state, picking, reveal: 1, aiThinking: false, paused: false })

  return {
    start: resume,
    pause,
    resume,
    destroy: (): void => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const davinciGame: MiniGameDefinition = {
  id: 'davinci',
  title: '达芬奇密码 Davinci',
  icon: '👁️',
  description: '你的数字牌我看不到——凭记忆与排除，猜穿对手的整手暗牌。',
  controls: [
    '目标：把对方 4 张暗牌全部猜开（3 局 2 胜）——完整规则点游戏内右下角「说明」',
    'R：重开 · P：暂停',
  ],
  create: createDavinciGame,
}
