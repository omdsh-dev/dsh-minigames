/**
 * 时间线 Timeline 游戏定义：把纯逻辑与渲染接成 {@link MiniGameInstance}。
 * 交互：点手牌选中 → 点时间轴空位插入（或直接拖拽到空位）；点击已放置
 * 卡再点另一张交换，点空白手牌区可收回；Enter 提交判定，R 重开本关
 * （同 seed 同题），P 暂停，？/Esc 开合帮助面板（任意阶段可用）。渲染走
 * dirty 按需模式 + 500ms 计时 tick，静态局面零重绘。onScore 在每次过关
 * 与全部通关时上报累计总分。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { createRoundState, insertCard, returnToHand, submitRound, swapPlaced, tickTimer } from './logic.ts'
import { HELP_RECT, LOGICAL_H, LOGICAL_W, SUBMIT_RECT, handAt, inRect, placedAt, renderTimeline, slotAt, type TimelineUi } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 限时/闪显动画的驱动间隔。 */
const TICK_MS = 250
const MAX_LEVEL = 5

function createTimelineGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: timeline needs a 2d canvas context')
  const ctx = fit.ctx

  // 每次挂载一个种子：R 重开同题，Enter 进下一关（关卡号入种子）。
  const baseSeed = (Date.now() & 0x7fffffff) | 1
  let level = 1
  let state = createRoundState(level, baseSeed)
  let totalScore = 0
  let lastScore = -1
  let running = true
  let helpOpen = false
  let finished = false
  let selectedHandId: number | null = null
  let selectedPlaced: number | null = null
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null
  let hoverSlot: number | null = null
  let flashLockedIds: number[] = []
  let flashWrongIds: number[] = []
  let flashAgeMs = 0
  const particles = createParticles()

  const ui = (): TimelineUi => ({
    selectedHandId,
    drag: drag !== null && drag.moved ? { id: drag.id, x: drag.x, y: drag.y } : null,
    hoverSlot,
    flashLockedIds,
    flashWrongIds,
    flashAgeMs,
    paused: !running,
    helpOpen,
    finished,
    totalScore,
  })

  const paint = (): void => {
    renderTimeline(ctx, LOGICAL_W, LOGICAL_H, state, ui(), particles)
  }

  const reportScore = (): void => {
    if (totalScore === lastScore) return
    lastScore = totalScore
    options?.onScore?.(totalScore)
  }

  const startLevel = (next: number): void => {
    level = next
    state = createRoundState(level, baseSeed)
    selectedHandId = null
    selectedPlaced = null
    drag = null
    hoverSlot = null
    flashLockedIds = []
    flashWrongIds = []
    flashAgeMs = 0
    finished = false
    loop.markDirty()
  }

  /** 提交：正确锁定（绿闪）、错误回手（红闪 + 方向提示），全对过关。 */
  const submit = (): void => {
    if (state.phase !== 'playing' || state.hand.length > 0) return
    const result = submitRound(state)
    if (result === null) return
    flashLockedIds = result.locked.map((c) => c.id)
    flashWrongIds = result.wrong.map((c) => c.id)
    flashAgeMs = 0
    selectedHandId = null
    selectedPlaced = null
    if (result.allCorrect) {
      totalScore += Math.max(20, 100 - state.errors * 10)
      reportScore()
      particles.burst(LOGICAL_W / 2, 150, THEME.good, 18, 170)
      if (level >= MAX_LEVEL) finished = true
    } else {
      particles.burst(LOGICAL_W / 2, 150, THEME.bad, 10, 120)
    }
    loop.markDirty()
  }

  /** 逻辑坐标换算（CSS 像素 -> 逻辑空间）。 */
  const toLogical = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const p = toLogical(event)
    if (inRect(p.x, p.y, HELP_RECT)) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (helpOpen) return
    if (finished) return
    if (inRect(p.x, p.y, SUBMIT_RECT)) {
      submit()
      return
    }
    if (state.phase !== 'playing') return
    const hi = handAt(p.x, p.y, state)
    if (hi !== null) {
      const card = state.hand[hi]!
      selectedHandId = card.id
      selectedPlaced = null
      drag = { id: card.id, x: p.x, y: p.y, moved: false }
      loop.markDirty()
      return
    }
    const pi = placedAt(p.x, p.y, state)
    if (pi !== null) {
      if (selectedPlaced !== null) {
        swapPlaced(state, selectedPlaced, pi)
        selectedPlaced = null
      } else {
        selectedPlaced = pi
        selectedHandId = null
      }
      loop.markDirty()
      return
    }
    if (selectedPlaced !== null && p.y > 260) {
      // 手牌区空白处：把选中已放置卡收回手牌。
      returnToHand(state, selectedPlaced)
      selectedPlaced = null
      loop.markDirty()
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!running || helpOpen || finished) return
    const p = toLogical(event)
    if (drag !== null) {
      if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 6) drag.moved = true
      drag.x = p.x
      drag.y = p.y
    }
    let next: number | null = null
    if (state.phase === 'playing' && (drag !== null || selectedHandId !== null)) {
      next = slotAt(p.x, p.y, state)
    }
    if (next !== hoverSlot) {
      hoverSlot = next
      loop.markDirty()
    } else if (drag !== null && drag.moved) {
      loop.markDirty()
    }
  }

  const onMouseUp = (event: MouseEvent): void => {
    if (!running || helpOpen || finished) {
      drag = null
      return
    }
    if (drag === null) return
    const d = drag
    drag = null
    const p = toLogical(event)
    if (d.moved) {
      const slot = slotAt(p.x, p.y, state)
      if (slot !== null) insertCard(state, d.id, slot)
      selectedHandId = null
    } else if (selectedHandId === d.id) {
      // 原地点击：保持选中，等待点时间轴插入。
      const slot = slotAt(p.x, p.y, state)
      if (slot !== null) {
        insertCard(state, d.id, slot)
        selectedHandId = null
      }
    }
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyH' || event.key === '?' || (helpOpen && event.code === 'Escape')) {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
      return
    }
    if (helpOpen) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      if (!finished) startLevel(level)
    } else if (event.code === 'Enter') {
      event.preventDefault()
      if (finished) {
        totalScore = 0
        reportScore()
        startLevel(1)
      } else if (state.phase === 'cleared') {
        startLevel(level + 1)
      } else {
        submit()
      }
    }
  }

  // dirty 按需渲染：状态变化才重绘；TICK 定时器驱动限时与闪显动画。
  const loop = createFrameLoop((f) => {
    let animating = false
    if (flashAgeMs < 2600 && (flashLockedIds.length > 0 || flashWrongIds.length > 0 || state.hints.length > 0)) {
      flashAgeMs += f.wallMs
      animating = flashAgeMs < 2600
    }
    if (f.render || animating || particles.size() > 0) {
      paint()
      if (animating || particles.size() > 0) loop.markDirty()
    }
  }, { mode: 'dirty' })

  const tick = (): void => {
    if (running && state.phase === 'playing') {
      const before = state.remainingSec
      tickTimer(state, TICK_MS / 1000)
      if (state.remainingSec !== before || Math.ceil(before) !== Math.ceil(state.remainingSec)) loop.markDirty()
    }
  }
  const timer = window.setInterval(tick, TICK_MS)

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    paint()
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.markDirty()
    loop.resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  loop.start()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      window.clearInterval(timer)
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const timelineGame: MiniGameDefinition = {
  id: 'timeline',
  title: '时间线 Timeline',
  icon: '📅',
  description: '活字印刷在蒸汽机前还是后？拖动卡片排出正确的历史顺序。',
  controls: ['点击手牌选中再点时间轴空位插入（或直接拖拽）；点已放置卡交换', 'Enter：提交 · R：重开本关 · P：暂停 · ？：帮助'],
  create: createTimelineGame,
}