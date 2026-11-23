/**
 * 牛头王 TakeSix 游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点击手牌
 * 出牌（与 AI 暗牌同时翻开，小牌先放）、被迫收行时点击行、空格开下一局、
 * R 重开（换新种子）、P 暂停；右上角「说明」按钮任何阶段可弹帮助面板。
 * dirty 帧循环：输入、亮牌动画与粒子期间重绘；局分经 onScore 上报
 * （每局 100 分，夺冠再奖 300）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { chooseRow, createGame, playCard, startNextRound, type TakeSixState } from './logic.ts'
import { H, hitTest, renderTakeSix, rowBurstPos, W, type TakeSixView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'
import { THEME, createParticles } from '../theme.ts'

/** 初始种子（R 重开时按重开次数偏移换新序列）。 */
const BASE_SEED = 20261123
/** 亮牌动画速率（每秒进度）。 */
const REVEAL_SPEED = 2.2
/** 亮牌未完成时锁输入（让玩家看清双方出了什么）。 */
function revealLocked(reveal: number): boolean {
  return reveal < 1
}

function createTakeSixGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: takesix needs a 2d canvas context')
  const ctx = fit.ctx

  let gameNo = 0
  let state: TakeSixState = createGame(BASE_SEED)
  let running = false
  let paused = false
  /** 说明面板开关（任何阶段/暂停可开合，渲染层最上层）。 */
  let helpOpen = false
  let reveal = 1
  let hover: number | null = null
  let lastScore = -1
  let lastEventCount = 0
  const particles = createParticles()

  const view = (): TakeSixView => ({ state, reveal, paused, helpOpen, hover })

  /** 局分上报：每局 100 分，夺冠再奖 300。 */
  const reportScore = (): void => {
    const score = state.roundWinsYou * 100
      + (state.phase === 'matchOver' && state.matchWinner === 'you' ? 300 : 0)
    if (score === lastScore) return
    lastScore = score
    options?.onScore?.(score)
  }

  /** 事件侦测：新收行触发粒子迸发；任何动作后上报局分。 */
  const detectEvents = (): void => {
    if (state.events.length > lastEventCount) {
      const fresh = state.events.slice(lastEventCount)
      lastEventCount = state.events.length
      for (const e of fresh) {
        if (e.kind === 'collect') {
          const p = rowBurstPos(e.row)
          particles.burst(p.x, p.y, e.side === 'you' ? THEME.bad : THEME.good, 14, 140)
        }
      }
    } else {
      lastEventCount = state.events.length
    }
    reportScore()
  }

  /** 动画推进（每帧调用）：亮牌翻面 + 粒子。 */
  const tickAnimations = (dt: number): boolean => {
    let animating = false
    if (reveal < 1) {
      reveal = Math.min(1, reveal + dt * REVEAL_SPEED)
      animating = true
    }
    if (particles.size() > 0) animating = true
    return animating
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    const animating = tickAnimations(f.dt)
    if (f.render || animating) {
      renderTakeSix(ctx, view())
      particles.tick(ctx, f.dt * 1000)
      if (animating) loop.markDirty()
    }
  }
  const loop = createFrameLoop(frame, { mode: 'dirty' })

  /** 统一输入出口：阶段闸门 + 动画锁通过后执行并置脏。 */
  const act = (fn: () => void): void => {
    if (!running || paused) return
    if (revealLocked(reveal)) return
    fn()
    reveal = 0
    detectEvents()
    loop.markDirty()
  }

  const logicalPos = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H }
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    const { x, y } = logicalPos(event)
    const region = hitTest(x, y, view())
    if (region === null) return
    // 说明按钮：任何阶段/暂停/终局都可切换，且立即重绘一帧。
    if (region.kind === 'help') {
      helpOpen = !helpOpen
      renderTakeSix(ctx, view())
      loop.markDirty()
      return
    }
    if (region.kind === 'hand') {
      act(() => { playCard(state, state.yourHand[region.index]!) })
      return
    }
    if (region.kind === 'row') {
      act(() => { chooseRow(state, region.row) })
      return
    }
    if (region.kind === 'next') {
      act(() => { startNextRound(state) })
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!running) return
    const { x, y } = logicalPos(event)
    const region = state.phase === 'pick' && !paused && !revealLocked(reveal)
      ? hitTest(x, y, view())
      : null
    const next = region !== null && region.kind === 'hand' ? region.index : null
    if (next !== hover) {
      hover = next
      loop.markDirty()
    }
  }

  const restart = (): void => {
    gameNo += 1
    state = createGame(BASE_SEED + gameNo * 7919)
    reveal = 1
    hover = null
    lastEventCount = 0
    lastScore = -1
    reportScore()
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
      renderTakeSix(ctx, view()) // 暂停中重开也要立即呈现
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'Space') {
      event.preventDefault()
      if (state.phase === 'roundOver') act(() => { startNextRound(state) })
    }
  }

  const togglePause = (): void => {
    if (paused) resume()
    else pause()
  }
  const pause = (): void => {
    if (paused || !running) return
    paused = true
    loop.pause()
    renderTakeSix(ctx, view())
  }
  const resume = (): void => {
    if (!paused) return
    paused = false
    loop.markDirty()
    loop.resume()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
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
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const takesixGame: MiniGameDefinition = {
  id: 'takesix',
  title: '牛头王 TakeSix',
  icon: '🐮',
  description: '104 张牌六行摆放——比你出的牌大的最少行收下它，小心别吃到牛头。',
  controls: ['点击手牌出牌，被迫收行时点击一行收走', '空格：下一局 · P：暂停 · R：重开'],
  create: createTakeSixGame,
}
