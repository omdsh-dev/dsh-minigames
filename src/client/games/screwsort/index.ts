/**
 * 螺栓分拣游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点螺母
 * 选中、再点工位投放（或按住拖拽到工位），空格按住加速传送带，
 * continuous 帧循环推进模拟与渲染，R 重开（换局号）、P 暂停；说明
 * 按钮开合帮助面板（展开时点击优先收起），分数经 onScore 上报（最高
 * 分由面板管理）。挂载即采用连续 60 秒模式。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  attemptScrew, boltAt, createScrewSort, inHelpButton, nutAt, stepScrewSort, W, H,
  type ScrewSortState,
} from './logic.ts'
import { renderScrewSort } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

/** 每局种子：挂载时取一次，重开换新局号但同一天内可复现。 */
function dailySeed(): number {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function createScrewSortGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: screwsort needs a 2d canvas context')
  const ctx = fit.ctx

  const seed = dailySeed()
  let round = 0
  // 索引层只挂载连续模式（关卡模式由逻辑层与测试覆盖）。
  let state: ScrewSortState = createScrewSort(seed, round, 'continuous')
  let running = false
  let lastScore = -1
  let helpOpen = false
  let boost = false
  let dragging = false
  let drag: { x: number, y: number } | null = null

  /** 指针事件 → 逻辑坐标（画布 CSS 尺寸与逻辑尺寸的比例换算）。 */
  const toLogical = (e: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }

  const renderNow = (): void => {
    renderScrewSort(ctx, state, !running && !state.over, helpOpen, drag)
  }

  const onPointerDown = (e: PointerEvent): void => {
    const p = toLogical(e)
    // 说明按钮任何阶段可开合；面板展开时首次点击收起并吞掉。
    if (inHelpButton(p.x, p.y)) {
      helpOpen = !helpOpen
      loop.markDirty()
      renderNow()
      return
    }
    if (helpOpen) {
      helpOpen = false
      loop.markDirty()
      renderNow()
      return
    }
    if (state.over) return
    const bolt = boltAt(p.x, p.y)
    if (bolt !== null) {
      // 点击-点击路径：已有选中则立即投放。
      attemptScrew(state, bolt)
      loop.markDirty()
      renderNow()
      return
    }
    const nutId = nutAt(state, p.x, p.y)
    if (nutId !== null) {
      state.selected = nutId
      // 拖拽路径：按住螺母可拖到工位松手投放。
      dragging = true
      drag = p
      canvas.setPointerCapture(e.pointerId)
    } else {
      state.selected = null
    }
    loop.markDirty()
    renderNow()
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return
    drag = toLogical(e)
    loop.markDirty()
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    const p = toLogical(e)
    const bolt = boltAt(p.x, p.y)
    if (bolt !== null && state.selected !== null && !state.over) {
      attemptScrew(state, bolt)
    }
    drag = null
    loop.markDirty()
    renderNow()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === 'Space') {
      event.preventDefault()
      boost = true
      return
    }
    if (event.code === 'KeyR') {
      event.preventDefault()
      reset()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') boost = false
  }

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    stepScrewSort(state, f.dt * 1000, boost)
    reportScore()
    // 拖拽幽灵 / 帮助面板 / 结算画面需要即时重绘：dirty 帧之外按
    // continuous 渲染；结束后模拟冻结但遮罩保持刷新。
    if (f.render || dragging || helpOpen || state.over) renderScrewSort(ctx, state, false, helpOpen, drag)
  }
  const loop = createFrameLoop(frame)

  const reset = (): void => {
    round += 1
    state = createScrewSort(seed, round, 'continuous')
    lastScore = -1
    dragging = false
    drag = null
    boost = false
    loop.markDirty()
    renderNow()
  }

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    renderNow()
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.start()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  focusGameHost(host)
  running = true
  loop.start()
  renderNow()

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
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    },
  }
}

export const screwsortGame: MiniGameDefinition = {
  id: 'screwsort',
  title: '螺栓分拣 ScrewSort',
  icon: '🔩',
  description: '同色螺母拧到同色螺栓上——不同粗细不同颜色，一眼扫过去手要快。',
  controls: [
    '点螺母选中再点（或拖到）同色同粗的螺栓 · 空格按住加速带',
    'R 重开 · P 暂停 · 说明书 = 画面右上「说明」',
  ],
  create: createScrewSortGame,
}
