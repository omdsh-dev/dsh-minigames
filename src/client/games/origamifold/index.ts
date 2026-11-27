/**
 * 折纸成方 OrigamiFold 游戏定义：把纯逻辑与渲染接成 MiniGameInstance——
 * 点击折线附近选择翻折侧执行折叠（250ms 翻折动画），R 重开本关、P 暂停、
 * H 或右下角按钮随时开合帮助面板。过关自动进入下一关（循环回到第 1 关
 * 时清零累计分），胜利时粒子庆祝并上报 onScore；dirty 模式按需重绘，
 * 折叠动画与粒子期间逐帧。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { LEVEL_COUNT, applyFold, generateLevel, type FoldMove, type FoldState } from './logic.ts'
import { LOGICAL_W, LOGICAL_H, ANIM_S, foldLineAt, helpButtonHit, renderOrigami, type FoldAnim } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { THEME, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const ADVANCE_MS = 1800

function createOrigamiFoldGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: origamifold needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  let level = 0
  let state: FoldState = freshLevel(0, 0)
  /** 折叠历史（供 Z 回退一步；重开/换关时清空）。 */
  let history: FoldState[] = []
  let running = false
  let helpOpen = false
  let hover: FoldMove | null = null
  /** 进行中的折叠动画（logic 已结算，动画纯表现，用折前快照绘制）。 */
  let anim: FoldAnim | null = null
  let winText: string | null = null
  let advanceTimer = 0
  let advanceRemaining = 0
  let advanceAt = 0
  let lastScore = -1
  const particles = createParticles()

  function freshLevel(next: number, carryScore: number): FoldState {
    const seed = (Math.random() * 0x7fffffff) | 0
    const generated = generateLevel(next, seed, carryScore)
    if (generated === null) throw new Error('dsh-minigames: origamifold level generation failed')
    return generated
  }

  const startLevel = (next: number, carryScore: number): void => {
    level = next
    state = freshLevel(next, carryScore)
    history = []
    winText = null
    hover = null
    anim = null
    clearTimeout(advanceTimer)
    advanceTimer = 0
    advanceRemaining = 0
    reportScore()
    repaint()
  }

  const scheduleAdvance = (delayMs: number): void => {
    advanceAt = performance.now() + delayMs
    advanceTimer = window.setTimeout(() => {
      advanceTimer = 0
      const next = (level + 1) % LEVEL_COUNT
      // 全部通关后循环回第 1 关并清零累计分（新一轮从零计）。
      startLevel(next, next === 0 ? 0 : state.score)
    }, delayMs)
  }

  const reportScore = (): void => {
    if (state.score === lastScore) return
    lastScore = state.score
    options?.onScore?.(state.score)
  }

  /** 暂停中 rAF 已停：直接整幅重绘；运行中交给 markDirty。 */
  const repaint = (): void => {
    if (running) {
      loop.markDirty()
      return
    }
    renderOrigami(ctx, state, view(), particles, 0)
  }

  const view = () => ({
    paused: !running,
    helpOpen,
    hover,
    anim,
    winText,
  })

  /** 执行一次折叠：结算状态、留下折前快照做动画、判胜负、上报分数。 */
  const doFold = (move: FoldMove): void => {
    if (state.status !== 'playing' || anim !== null) return
    const next = applyFold(state, move)
    if (next === null) return
    history.push(state)
    anim = { move, oldRows: state.rows, oldCols: state.cols, oldCells: state.cells, t: 0 }
    state = next
    reportScore()
    if (next.status === 'won') {
      winText = '第 ' + (next.level + 1) + ' 关 · 累计 ' + next.score + ' 分'
      particles.burst(LOGICAL_W / 2, LOGICAL_H / 2, THEME.good, 26, 180)
      if (running) scheduleAdvance(ADVANCE_MS)
      else advanceRemaining = ADVANCE_MS
    }
    repaint()
  }

  const toLogical = (event: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    const p = toLogical(event)
    // 说明按钮 / 面板永远最先命中（渲染时也画在最上层）。
    if (helpButtonHit(p.x, p.y)) {
      helpOpen = !helpOpen
      repaint()
      return
    }
    if (helpOpen) {
      helpOpen = false
      repaint()
      return
    }
    if (!running || state.status !== 'playing' || anim !== null) return
    const move = foldLineAt(p.x, p.y, state.rows, state.cols)
    if (move === null) return
    doFold(move)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!running || state.status !== 'playing' || anim !== null) return
    const p = toLogical(event)
    const move = foldLineAt(p.x, p.y, state.rows, state.cols)
    if (move === null) {
      if (hover !== null) {
        hover = null
        repaint()
      }
      return
    }
    if (move.k !== hover?.k || move.axis !== hover?.axis || move.side !== hover?.side) {
      hover = move
      repaint()
    }
  }

  /** Z：回退一步折叠（不可跨关；动画中/胜负结算后不可退）。 */
  const undoFold = (): void => {
    if (anim !== null || state.status !== 'playing') return
    const prev = history.pop()
    if (prev === undefined) return
    state = prev
    winText = null
    repaint()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    switch (event.code) {
      case 'KeyZ':
        event.preventDefault()
        undoFold()
        return
      case 'KeyR':
        event.preventDefault()
        startLevel(level, 0)
        return
      case 'KeyP':
        event.preventDefault()
        togglePause()
        return
      case 'KeyH':
        event.preventDefault()
        helpOpen = !helpOpen
        repaint()
        return
    }
  }

  const loop = createFrameLoop((f) => {
    // 渲染异常冒泡会杀死 rAF 链（画面冻结、点击无响应、无结算遮罩）——
    // 包一层让异常可见且不吞掉循环：抛错也继续调度下一帧。
    try {
      if (anim !== null) {
        anim.t += f.dt
        if (anim.t >= ANIM_S + 0.05) anim = null
      }
      const animating = anim !== null || particles.size() > 0
      if (f.render || animating) {
        renderOrigami(ctx, state, view(), particles, f.dt * 1000)
        if (animating) loop.markDirty()
      }
    } catch (e) {
      console.error('[dsh-minigames/origamifold] frame error:', e)
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
    renderOrigami(ctx, state, view(), particles, 0)
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

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  // 挂载立即渲染一帧：不依赖 rAF 首帧（黑屏事故的教训）。
  renderOrigami(ctx, state, view(), particles, 0)

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      clearTimeout(advanceTimer)
      advanceTimer = 0
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const origamifoldGame: MiniGameDefinition = {
  id: 'origamifold',
  title: '折纸成方 OrigamiFold',
  icon: '📄',
  description: '横折竖折层叠出目标图案——每折一次，纸的层数就翻一倍。',
  controls: [
    '点击折线附近折纸（点哪侧、哪侧折过去盖住另一侧）',
    'Z：回退一步 · R：重开 · P：暂停 · H / 右下角：说明',
  ],
  create: createOrigamiFoldGame,
}
