/**
 * 骨牌对对游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点击选中
 * 再点相邻骨牌交换（或按住拖到相邻格松手）、点锁定骨牌给红色反馈，
 * H 提示、R 重开本关（通关后再按回到第 1 关）、P 暂停；脏标记按需
 * 渲染（有粒子或拖拽时逐帧），说明按钮开合帮助面板（展开时点击优先
 * 收起），分数经 onScore 上报（最高分由面板管理）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { W, H, attemptSwap, createDominoShuffle, inHelpButton, requestHint, selectTile, tileAt, type DominoShuffleState } from './logic.ts'
import { dominoParticlesActive, renderDominoShuffle } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

/** 每局种子：挂载时取一次；同 seed + 同 level 重开本关局面一致。 */
function dailySeed(): number {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function createDominoShuffleGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: dominoshuffle needs a 2d canvas context')
  const ctx = fit.ctx

  const seed = dailySeed()
  let state: DominoShuffleState = createDominoShuffle(seed, 1, 0)
  // 当前关起手的累计分（重开本关时回滚到这里）与当前关号。
  let levelStartScore = 0
  let curLevel = 1
  let running = false
  let lastScore = -1
  let helpOpen = false
  let drag: { index: number, x: number, y: number } | null = null

  /** 指针事件 → 逻辑坐标（画布 CSS 尺寸与逻辑尺寸的比例换算）。 */
  const toLogical = (e: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }

  /** 暂停中（非结束）判定。 */
  const paused = (): boolean => !running && !state.over

  /** 关卡推进后同步「本关起手分」（过关加分已计入）。 */
  const syncLevel = (): void => {
    if (state.level !== curLevel) {
      curLevel = state.level
      levelStartScore = state.score
    }
  }

  const renderNow = (): void => {
    renderDominoShuffle(ctx, state, paused(), helpOpen, drag, 16)
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
    if (state.over || paused()) return
    const idx = tileAt(state, p.x, p.y)
    if (idx === null) return
    // 点点流：已有选中且与按下张相邻 → 直接交换。
    if (state.selected !== null && Math.abs(idx - state.selected) === 1) {
      attemptSwap(state, state.selected, idx)
      syncLevel()
    } else {
      selectTile(state, idx)
      if (state.selected === idx) {
        drag = { index: idx, x: p.x, y: p.y }
        canvas.setPointerCapture(e.pointerId)
      }
    }
    loop.markDirty()
    renderNow()
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (drag === null) return
    const p = toLogical(e)
    drag = { index: drag.index, x: p.x, y: p.y }
    loop.markDirty()
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (drag === null) return
    const p = toLogical(e)
    const from = drag.index
    drag = null
    const target = tileAt(state, p.x, p.y)
    if (target !== null && target !== from && Math.abs(target - from) === 1) {
      // 拖拽流：松手落在相邻格 → 交换。
      attemptSwap(state, from, target)
      syncLevel()
    } else if (target !== null && target !== from) {
      // 拖到不相邻格：改为选中目标。
      selectTile(state, target)
    }
    loop.markDirty()
    renderNow()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === 'KeyH') {
      event.preventDefault()
      if (!state.over && !helpOpen && !paused()) requestHint(state)
    } else if (event.code === 'KeyR') {
      event.preventDefault()
      reset()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      if (!state.over) togglePause()
    }
  }

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    reportScore()
    // 棋盘静态：仅脏标记 / 粒子存活 / 拖拽幽灵时重绘。
    if (f.render || dominoParticlesActive() || drag !== null) {
      renderDominoShuffle(ctx, state, false, helpOpen, drag, 16)
    }
  }
  const loop = createFrameLoop(frame, { mode: 'dirty' })

  const reset = (): void => {
    if (state.over && state.win) {
      state = createDominoShuffle(seed, 1, 0)
      levelStartScore = 0
      curLevel = 1
    } else {
      state = createDominoShuffle(seed, state.level, levelStartScore)
    }
    helpOpen = false
    drag = null
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
    },
  }
}

export const dominoshuffleGame: MiniGameDefinition = {
  id: 'dominoshuffle',
  title: '骨牌对对 DominoShuffle',
  icon: '🁄',
  description: '一排骨牌要按大小重排——每张只能和相邻的交换，步数有限快排好。',
  controls: [
    '点相邻两张骨牌交换（也可拖拽）· H 提示 · R 重开本关 · P 暂停',
    '排成升序过关；步数预算见下方进度条，锁定骨牌不可换',
  ],
  create: createDominoShuffleGame,
}
