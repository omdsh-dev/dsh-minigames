/**
 * 火柴算式游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点在场火柴
 * 拿起（再点原段放回），点空位放下完成一次修改；后期关可点备用匣取
 * 新柴或把手中火柴丢入匣中；不成立的修改自动还原。U 放回手中火柴、
 * R 重开（按重开次数偏移换新题库）、P 暂停。回合制 dirty 帧循环：
 * 仅输入、判定闪烁、粒子与整秒倒计时变化时重绘；分数变化经 onScore
 * 上报。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  createMatchstick,
  discardStick,
  grabReserve,
  placeStick,
  pickStick,
  putDownHeld,
  tickMatchstick,
  type MatchstickState,
  type Seg,
} from './logic.ts'
import { H, W, hitSlot, hitStick, hitTray, renderMatchstick, type MatchstickView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'
import { THEME, createParticles } from '../theme.ts'

/** 初始种子（R 重开时按重开次数偏移换题库）。 */
const BASE_SEED = 20261122
/** 判定闪烁秒数。 */
const FLASH_S = 1.2

function createMatchstickGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: matchstick needs a 2d canvas context')
  const ctx = fit.ctx

  let gameNo = 0
  let state: MatchstickState = createMatchstick(BASE_SEED)
  let running = false
  let paused = false
  let lastScore = -1
  let lastSecond = -1
  let hover: { cell: number, seg: Seg } | null = null
  let flashWrong = 0
  let flashRight = 0
  const particles = createParticles()

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  /** 动画推进（每帧调用）：计时、闪烁与粒子；返回是否仍需重绘。 */
  const tickAnimations = (dt: number): boolean => {
    let animating = false
    if (state.status === 'playing' && !paused) {
      tickMatchstick(state, dt)
      const sec = Math.ceil(state.timeLeft)
      if (sec !== lastSecond) {
        lastSecond = sec
        animating = true
      }
    }
    if (flashWrong > 0) {
      flashWrong = Math.max(0, flashWrong - dt)
      animating = true
    }
    if (flashRight > 0) {
      flashRight = Math.max(0, flashRight - dt)
      animating = true
    }
    if (particles.size() > 0) animating = true
    return animating
  }

  const draw = (): void => {
    const view: MatchstickView = { state, paused, hover, flashWrong, flashRight }
    renderMatchstick(ctx, view)
    particles.tick(ctx, 16)
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    const animating = tickAnimations(f.dt)
    if (f.render || animating) {
      draw()
      if (animating) loop.markDirty()
    }
  }
  const loop = createFrameLoop(frame, { mode: 'dirty' })

  /** 统一的输入出口：执行动作后闪判定、上报并置脏。 */
  const act = (fn: () => string | boolean | void): void => {
    if (!running || paused) return
    const before = state.cells + ':' + String(state.puzzleIndex)
    const result = fn()
    if (result === 'wrong') flashWrong = FLASH_S
    if (result === 'solved') {
      flashRight = FLASH_S
      particles.burst(W / 2, 140, THEME.good, 16, 150)
      particles.burst(W / 2, 140, THEME.gold, 8, 110)
    }
    if (result === 'solved' || result === 'wrong' || before !== state.cells + ':' + String(state.puzzleIndex)) {
      hover = null
    }
    reportScore()
    loop.markDirty()
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    if (!running || paused) {
      if (paused) resume()
      return
    }
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * W
    const y = ((event.clientY - rect.top) / rect.height) * H
    if (hitTray(x, y)) {
      if (state.held !== null) act(() => discardStick(state))
      else act(() => grabReserve(state) === true)
      return
    }
    const stick = hitStick(state.cells, x, y)
    if (stick !== null) {
      act(() => pickStick(state, stick.cell, stick.seg))
      return
    }
    const slot = hitSlot(state.cells, x, y)
    if (slot !== null) {
      act(() => placeStick(state, slot.cell, slot.seg))
      return
    }
    // 点空白处：放下手中火柴
    if (state.held !== null) act(() => putDownHeld(state))
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!running || paused) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * W
    const y = ((event.clientY - rect.top) / rect.height) * H
    const next = hitStick(state.cells, x, y)
    if (next === null && hover === null) return
    if (next !== null && hover !== null && next.cell === hover.cell && next.seg === hover.seg) return
    hover = next
    loop.markDirty()
  }

  const reset = (): void => {
    gameNo += 1
    state = createMatchstick((BASE_SEED + gameNo * 0x9e3779b9) >>> 0)
    lastSecond = -1
    hover = null
    flashWrong = 0
    flashRight = 0
    paused = false
    reportScore()
    loop.markDirty()
    draw()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    switch (event.code) {
      case 'KeyU':
        event.preventDefault()
        if (state.held !== null) act(() => putDownHeld(state))
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
    draw()
  }
  const resume = (): void => {
    if (running) return
    running = true
    paused = false
    lastSecond = -1
    loop.markDirty()
    loop.start()
  }
  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  reportScore()
  loop.start()
  draw()

  return {
    start: resume,
    pause,
    resume,
    destroy: (): void => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const matchstickGame: MiniGameDefinition = {
  id: 'matchstick',
  title: '火柴算式 Matchstick',
  icon: '🔥',
  description: '移动一根火柴让等式成立——罗马数字与方案权衡，一根定乾坤。',
  controls: [
    '等式由火柴段拼成且当前不成立：点一根火柴拿起，再点发亮的空位放下，完成「移动一根」使等式成立即过关',
    '不成立的修改会自动还原（保持只动一根）；每关 5 题、共 5 关，限时 60→30 秒递减，超时自动跳题',
    '第 4 关起为变体关：点底部备用匣可取一根新柴「补上」，或把手中火柴点匣「抽走」——移动/补/抽三法通用',
    '等式位数从 1 位递进到 3 位；多解均判对；解出得 80 分 + 剩余秒数奖励',
    'U：放回手中火柴 · R：重开 · P：暂停',
  ],
  create: createMatchstickGame,
}
