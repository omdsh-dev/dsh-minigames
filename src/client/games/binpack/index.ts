/**
 * 装箱谜题 BinPack 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 点击物品选中、点击箱放入、点击箱内选中物品取出重放；R 重开本关、
 * P 暂停、H 或右下角按钮开合帮助面板（任何阶段可看）。过关（用箱数
 * ≤ 最优）上报 onScore 并自动进入下一关。dirty 模式按需重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  createState, generateLevel, isWon, placeItem, takeOut, usedBins,
  computeScore, LEVEL_COUNT, type BinPackState,
} from './logic.ts'
import {
  LOGICAL_W, LOGICAL_H, computeLayout, renderBinPack, trayItemAt,
  binItemAt, binAt, helpButtonHit,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1600

function createBinPackGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)

  // 持久化进度为 1 起；本游戏 level 为 0 起。
  let level = Math.min(readLevel('binpack'), LEVEL_COUNT) - 1
  let state: BinPackState = freshState(level)
  let running = false
  let won = false
  let winText: string | null = null
  let helpOpen = false
  let hoveredBin = -1
/** 拖拽状态：物品下标（全局 items 索引）、起点逻辑坐标（判点击/拖动）、当前拖点。 */
let dragItem = -1
let dragFromBin = -1
let dragStartX = 0
let dragStartY = 0
let dragX = 0
let dragY = 0
  let advanceTimer = 0
  let advanceRemaining = 0
  let advanceAt = 0
  let lastScoreLevel = -1
  const particles = createParticles()

  function freshState(next: number): BinPackState {
    const generated = generateLevel(next + 1)
    if (generated === null) throw new Error('dsh-minigames: binpack level generation failed')
    return createState(generated)
  }

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: binpack needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const startLevel = (next: number): void => {
    level = next
    state = freshState(level)
    won = false
    winText = null
    hoveredBin = -1
    clearTimeout(advanceTimer)
    advanceTimer = 0
    advanceRemaining = 0
    loop.markDirty()
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceAt = performance.now() + delayMs
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      const next = (level + 1) % LEVEL_COUNT
      saveLevel('binpack', Math.max(readLevel('binpack'), next + 1))
      startLevel(next)
    }, delayMs)
  }

  const checkWin = (): void => {
    if (won || !isWon(state)) return
    won = true
    winText = '用 ' + usedBins(state) + ' 箱装完 · ' + state.steps + ' 步'
    if (level !== lastScoreLevel) {
      lastScoreLevel = level
      options?.onScore?.(computeScore(level + 1, state.steps))
    }
    particles.burst(LOGICAL_W / 2, 350, THEME.gold, 24, 180)
    loop.markDirty()
    if (running) scheduleAdvance(ADVANCE_MS)
    else advanceRemaining = ADVANCE_MS
  }

  const toLogical = (event: MouseEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    const p = toLogical(event)
    const layout = computeLayout(state)
    // 说明按钮 / 面板永远最先命中（渲染时也画在最上层）。
    if (helpButtonHit(layout, p.x, p.y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (helpOpen) {
      helpOpen = false
      loop.markDirty()
      return
    }
    if (!running || won) return
    const trayItem = trayItemAt(layout, state, p.x, p.y)
    if (trayItem >= 0) {
      // 拖拽起点：mouseup 位移 <4px 走点击选中，否则按放置处理。
      dragItem = trayItem
      dragFromBin = -1
      dragStartX = p.x
      dragStartY = p.y
      dragX = p.x
      dragY = p.y
      loop.markDirty()
      return
    }
    const inBin = binItemAt(layout, state, p.x, p.y)
    if (inBin >= 0) {
      dragItem = inBin
      dragFromBin = state.binOf[inBin] ?? -1
      dragStartX = p.x
      dragStartY = p.y
      dragX = p.x
      dragY = p.y
      loop.markDirty()
      return
    }
    const bin = binAt(layout, p.x, p.y)
    if (bin >= 0 && state.selected >= 0) {
      placeItem(state, state.selected, bin)
      loop.markDirty()
      checkWin()
      return
    }
    if (state.selected >= 0) {
      state.selected = -1
      loop.markDirty()
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!running) return
    const p = toLogical(event)
    if (dragItem >= 0) {
      dragX = p.x
      dragY = p.y
      loop.markDirty()
      return
    }
    if (won) return
    const layout = computeLayout(state)
    const bin = binAt(layout, p.x, p.y)
    if (bin !== hoveredBin) {
      hoveredBin = bin
      loop.markDirty()
    }
  }

  const onMouseUp = (event: MouseEvent): void => {
    if (dragItem < 0) return
    const p = toLogical(event)
    const layout = computeLayout(state)
    const moved = Math.hypot(p.x - dragStartX, p.y - dragStartY)
    const item = dragItem
    const fromBin = dragFromBin
    dragItem = -1
    dragFromBin = -1
    if (!running || won) { loop.markDirty(); return }
    // 点击（位移 <4px）：保持原点选语义。
    if (moved < 4) {
      if (fromBin < 0) {
        state.selected = state.selected === item ? -1 : item
      } else if (state.selected === item) {
        takeOut(state, item)
        won = false
      } else {
        state.selected = item
      }
      loop.markDirty()
      return
    }
    // 拖动放置：目标箱合法即放入（placeItem 自带容量校验）。
    const bin = binAt(layout, p.x, p.y)
    if (bin >= 0) {
      if (fromBin >= 0 && fromBin !== bin) {
        takeOut(state, item)
        placeItem(state, item, bin)
        state.selected = -1
        won = false
        checkWin()
      } else if (fromBin < 0) {
        placeItem(state, item, bin)
        state.selected = -1
        checkWin()
      }
    } else if (fromBin >= 0) {
      // 拖出箱外 = 取出重放。
      takeOut(state, item)
      won = false
    }
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      startLevel(level)
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
    }
  }

  const loop = createFrameLoop(f => {
    const animating = particles.size() > 0
    if (f.render || animating) {
      renderBinPack(ctx, state, { paused: !running && !won, won, winText, hoveredBin, helpOpen, dragItem, dragX, dragY }, particles, f.dt * 1000)
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
    renderBinPack(ctx, state, { paused: true, won, winText, hoveredBin, helpOpen, dragItem: -1, dragX: 0, dragY: 0 })
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
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('mousemove', onMouseMove)
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
  canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const binpackGame: MiniGameDefinition = {
  id: 'binpack',
  title: '装箱谜题 BinPack',
  icon: '🧳',
  description: '一堆箱子几个货柜？塞得进一个就别开第二个——空间感与贪心的较量。',
  controls: [
    '拖动物品到箱内放入（或点选物品→点箱）；拖出箱外/再点选中件 = 取出',
    'R：重开本关 · P：暂停 · H / 右下角：说明',
  ],
  create: createBinPackGame,
}
