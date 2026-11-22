/**
 * 韦恩图谜题定义：把纯逻辑接成 {@link MiniGameInstance}——点击或拖拽
 * 数字卡到韦恩图区域放置（点击空白 = 圆外），放对入区、放错红框并计
 * 步；R 重开、P 暂停。棋盘静态，走 dirty 按需帧循环（限时关每秒标脏）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { createVennGameState, maskAtPoint, mulberry32, placeCard, tick, type VennGameState } from './logic.ts'
import {
  LOGICAL_H, LOGICAL_W, anchorForMask, createVennParticles, inBoard, inPoolBand,
  poolCardAt, renderVennGame, type VennView,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'
import { THEME } from '../theme.ts'

/** 错放红框时长（毫秒）。 */
const FLASH_MS = 350
/** 判定为拖拽的指针位移阈值（px）。 */
const DRAG_SLOP = 6

function createVennGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: vennpuzzle needs a 2d canvas context')
  const ctx = fit.ctx

  const newRound = (): VennGameState => createVennGameState(mulberry32((Math.random() * 0xffffffff) >>> 0))
  let state = newRound()
  let running = true
  let lastScore = -1
  let lastShownSecond = -1
  const particles = createVennParticles()
  const view: VennView = {
    paused: false,
    pointer: null,
    held: null,
    wrongFlash: null,
    particles,
  }
  /** 按下时的指针与位移累计（区分点击与拖拽）。 */
  let downAt: { x: number; y: number } | null = null
  let moved = 0

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  const restart = (): void => {
    state = newRound()
    lastScore = -1
    view.held = null
    view.wrongFlash = null
    view.pointer = null
    reportScore()
    loop.markDirty()
  }

  const draw = (dtMs: number): void => {
    renderVennGame(ctx, state, view, dtMs)
  }

  /** 尝试把 held 放到 (x,y)。 */
  const tryPlace = (x: number, y: number): void => {
    if (view.held === null) return
    const num = view.held
    if (!inBoard(y)) return
    const mask = maskAtPoint(x, y, state.circles)
    const anchor = anchorForMask(mask, state.circleCount)
    const result = placeCard(state, num, mask)
    if (result === 'ok') {
      view.held = null
      particles.burst(anchor.x, anchor.y, THEME.good, 10, 140)
      reportScore()
    } else if (result === 'wrong') {
      view.wrongFlash = { x, y, ms: FLASH_MS }
      view.held = null
      particles.burst(x, y, THEME.bad, 8, 120)
    }
    loop.markDirty()
  }

  const toLogical = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const pt = toLogical(event)
    downAt = pt
    moved = 0
    view.pointer = pt
    if (view.held !== null) {
      // 已持牌：点板区放置；点另一张卡换牌；点池空白取消。
      if (inBoard(pt.y)) {
        tryPlace(pt.x, pt.y)
        return
      }
      const idx = poolCardAt(pt.x, pt.y, state.pool.length)
      if (idx !== null) {
        const next = state.pool[idx]!
        view.held = next
      } else if (inPoolBand(pt.y)) {
        view.held = null
      }
      loop.markDirty()
      return
    }
    const idx = poolCardAt(pt.x, pt.y, state.pool.length)
    if (idx !== null) {
      view.held = state.pool[idx]!
      loop.markDirty()
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (!running) return
    const pt = toLogical(event)
    if (downAt !== null) {
      moved += Math.abs(pt.x - view.pointer!.x) + Math.abs(pt.y - view.pointer!.y)
    }
    view.pointer = pt
    loop.markDirty()
  }

  const onMouseUp = (event: MouseEvent): void => {
    if (!running) return
    const pt = toLogical(event)
    if (view.held !== null && moved >= DRAG_SLOP) {
      // 拖拽释放：板区放置，池内取消。
      if (inBoard(pt.y)) tryPlace(pt.x, pt.y)
      else if (inPoolBand(pt.y)) {
        view.held = null
        loop.markDirty()
      }
    }
    downAt = null
  }

  const onMouseLeave = (): void => {
    view.pointer = null
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
    } else if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
    }
  }

  const loop = createFrameLoop((f) => {
    if (!running) return
    if (view.wrongFlash !== null) {
      view.wrongFlash.ms -= f.wallMs
      if (view.wrongFlash.ms <= 0) view.wrongFlash = null
      loop.markDirty()
    }
    if (state.phase === 'clear') loop.markDirty()
    const phaseChanged = tick(state, f.wallMs)
    if (state.phase === 'playing' && state.timeLimitMs !== null) {
      const sec = Math.ceil(Math.max(0, state.timeLimitMs - state.elapsedMs) / 1000)
      if (sec !== lastShownSecond) {
        lastShownSecond = sec
        loop.markDirty()
      }
    }
    if (phaseChanged) {
      reportScore()
      loop.markDirty()
    }
    if (f.render || state.levelClearMs > 0 || view.wrongFlash !== null || particles.size() > 0) {
      draw(f.wallMs)
    }
  })

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    view.paused = true
    loop.pause()
    draw(0)
  }
  const resume = (): void => {
    if (running) return
    running = true
    view.paused = false
    loop.resume()
    loop.markDirty()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  reportScore()
  loop.start()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const vennpuzzleGame: MiniGameDefinition = {
  id: 'vennpuzzle',
  title: '韦恩图谜题 VennPuzzle',
  icon: '♾️',
  description: '每个数字属于哪个圈？交集、并集、排除——集合的逻辑比想象中绕。',
  controls: [
    '点数字卡拿起（或直接拖拽），再点韦恩图区域放置',
    '合法 = 恰好满足该区每个圆的谓词、且不满足其余圆；点圆外空白 = 全不满足',
    '放错红框提示并可随时重放，错误越少得分越高；全部放对过关',
    '共 5 关：圆从 2 个到 3 个、干扰卡变多，第 4/5 关限时',
    'R 重开（换新牌局），P 暂停',
  ],
  create: createVennGame,
}
