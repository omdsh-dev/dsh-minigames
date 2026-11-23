/**
 * 青蛙过河游戏定义：把确定性 FrogSwap 逻辑接成 {@link MiniGameInstance}
 * ——点蛙选中、点目标落子、U 撤销、R 重开（换种子）、P 暂停、过关后
 * 空格/按钮进下一关；说明按钮任何阶段可开合。回合制 dirty 帧循环：
 * 仅交互与过关粒子期间重绘；分数按已完成关卡的效率累计，经 onScore
 * 上报（每关满分 100，按最优步数比例折算）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { applyMove, createFrogSwap, optimalMoveCount, undoMove } from './logic.ts'
import type { FrogSwapState } from './logic.ts'
import { LOGICAL_W, LOGICAL_H, hitTest, renderFrogSwap, type FrogSwapView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'
import { createParticles } from '../theme.ts'

/** 初始种子（R 重开时按重开次数偏移换新装饰序列）。 */
const BASE_SEED = 20261123
/** 最后一关序号。 */
const MAX_LEVEL = 5

function createFrogSwapGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: frogswap needs a 2d canvas context')
  const ctx = initialFit.ctx

  let gameNo = 0
  let level = 1
  let state: FrogSwapState = createFrogSwap(level, BASE_SEED)
  let selected: number | null = null
  let running = false
  let paused = false
  /** 说明面板开关（任何阶段/暂停可开合）。 */
  let helpOpen = false
  /** 已完成关卡累计分数。 */
  let banked = 0
  let lastScore = -1
  /** 本关是否已结算（防重复入库）。 */
  let settled = false
  const particles = createParticles()

  const view = (): FrogSwapView => ({ state, selected, helpOpen, paused: paused && !state.won })

  const draw = (): void => {
    renderFrogSwap(ctx, view())
  }

  /** 分数上报：已完成关卡累计分。 */
  const reportScore = (): void => {
    if (banked === lastScore) return
    lastScore = banked
    options?.onScore?.(banked)
  }

  /** 过关结算：效率分入库（每关满分 100，按最优步数比例折算）+ 粒子。 */
  const settleWin = (): void => {
    const opt = optimalMoveCount(state.frogCount)
    banked += Math.max(10, Math.round((opt / Math.max(state.moves, opt)) * 100))
    reportScore()
    for (let i = 0; i < state.cells.length; i += 1) {
      const x = LOGICAL_W / 2 + (i - state.cells.length / 2) * 48
      particles.burst(x, 180, i % 2 === 0 ? '#79c96e' : '#e6c457', 8, 150)
    }
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    const animating = particles.size() > 0
    if (animating) loop.markDirty()
    if (f.render || animating) {
      draw()
      particles.tick(ctx, f.dt * 1000)
    }
  }
  const loop = createFrameLoop(frame, { mode: 'dirty' })

  /** 过关后进入下一关（第 5 关过关则回到第 1 关重新挑战，累计分清零）。 */
  const nextLevel = (): void => {
    if (level >= MAX_LEVEL) banked = 0
    level = level >= MAX_LEVEL ? 1 : level + 1
    state = createFrogSwap(level, (BASE_SEED + gameNo * 0x9e3779b9 + level) >>> 0)
    selected = null
    settled = false
    reportScore()
    loop.markDirty()
    draw()
  }

  const reset = (): void => {
    gameNo += 1
    banked = 0
    settled = false
    state = createFrogSwap(level, (BASE_SEED + gameNo * 0x9e3779b9) >>> 0)
    selected = null
    paused = false
    reportScore()
    loop.markDirty()
    draw()
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    if (!running) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * LOGICAL_W
    const y = ((event.clientY - rect.top) / rect.height) * LOGICAL_H
    const region = hitTest(x, y, { state, selected, helpOpen, paused })
    if (region === null) return
    // 说明按钮：任何阶段/暂停/过关中都可切换（面板画在最上层）。
    if (region.kind === 'help') {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (region.kind === 'next') {
      if (state.won) nextLevel()
      return
    }
    if (paused || state.won) return
    const i = region.index
    if (state.cells[i] === null) {
      // 点空位：若是选中蛙的合法目标则落子，否则取消选中。
      if (selected !== null && applyMove(state, selected, i)) {
        selected = null
        if (state.won && !settled) {
          settled = true
          settleWin()
        }
      } else {
        selected = null
      }
    } else {
      // 点蛙：切换选中（再点同一只取消）。
      selected = selected === i ? null : i
    }
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    switch (event.code) {
      case 'KeyU':
        event.preventDefault()
        if (!running || paused || state.won) break
        if (undoMove(state)) selected = null
        loop.markDirty()
        break
      case 'KeyR':
        event.preventDefault()
        reset()
        break
      case 'KeyP':
        event.preventDefault()
        togglePause()
        break
      case 'Space':
      case 'Enter':
        event.preventDefault()
        if (state.won && running) nextLevel()
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
  draw()

  return {
    start: resume,
    pause,
    resume,
    destroy: (): void => {
      running = false
      loop.destroy()
      initialFit.dispose()
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const frogswapGame: MiniGameDefinition = {
  id: 'frogswap',
  title: '青蛙过河 FrogSwap',
  icon: '🪷',
  description: '左边的青蛙要去右边，右边的要去左边——只能向前滑一步或跳过一只蛙，规划好每一步。',
  controls: [
    '目标：两侧青蛙完全互换——完整规则点游戏内右下角「说明」',
    '点蛙再点目标移动 · U：撤销 · R：重开 · P：暂停',
  ],
  create: createFrogSwapGame,
}
