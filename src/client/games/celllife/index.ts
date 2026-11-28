/**
 * 生命播种 CellLife 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：摆放阶段点击起始区切换细胞；空格进化一步（进入观察阶段后不
 * 能再摆）；T 开关下一步预览；R 重摆本关；P 暂停。恰好 K 步后等于
 * 目标图案过关（onScore 计分、level-progress 持久化），步数用尽未达
 * 标判负可重摆。帧循环 dirty 按需重绘 + 进化动画逐帧；挂载时先立即
 * 渲染一帧再启动循环，帧回调 try-catch 包裹（渲染异常只记录不中断）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { buildLevel, cellIndex, computeScore, evolveOnce, GRID, LEVEL_COUNT, newGame, previewNext, resetPlacement, toggleCell, type GameState } from './logic.ts'
import { boardLayout, cellFromPoint, HELP_BTN, LOGICAL_H, LOGICAL_W, renderScene } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles, drawOverlay } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 每关固定种子：同关卡重开得到同一道题（确定性可复放）。 */
const GAME_SEED = 0x5eed1f4e

/** 进化动画时长（秒）：新生闪现/死亡淡出在此窗口内逐帧播放。 */
const EVOLVE_ANIM_S = 0.35

type Phase = 'play' | 'won' | 'failed'

function createCellLifeGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  let level = Math.min(LEVEL_COUNT - 1, Math.max(0, readLevel('celllife') - 1))
  let state: GameState = newGame(buildLevel(level, GAME_SEED))
  /** 进化动画：前一帧盘面与剩余进度（0 表示无动画）。 */
  let prevBoard: boolean[] | null = null
  let anim = 0
  let previewOn = false
  /** 说明面板开关。 */
  let helpOpen = false
  let paused = false
  let scoredLevel = -1
  /** H 提示剩余次数：从已知解自动摆/清一个细胞。 */
  let hintsLeft = 2

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: celllife needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  const render = (dtMs: number): void => {
    renderScene(ctx, {
      data: state.data,
      board: state.board,
      prevBoard,
      anim,
      placing: state.steps === 0 && state.phase === 'play',
      previewOn,
      previewBoard: previewOn ? previewNext(state) : null,
      hudLevel: (level + 1) + '/' + LEVEL_COUNT,
      steps: state.steps,
      hintsLeft,
    }, helpOpen)
    particles.tick(ctx, dtMs)
    const overlay = overlayText()
    if (overlay !== null) drawOverlay(ctx, LOGICAL_W, LOGICAL_H, overlay.title, overlay.subtitle)
  }

  const loop = createFrameLoop((frame) => {
    // 帧回调整体 try-catch：渲染异常杀死 rAF 链是历史事故，只记录不中断。
    try {
      if (anim > 0) {
        anim = Math.max(0, anim - frame.dt / EVOLVE_ANIM_S)
        if (anim === 0) prevBoard = null
        loop.markDirty()
      }
      if (frame.render || particles.size() > 0 || anim > 0) render(frame.wallMs)
    } catch (err) {
      console.error('dsh-minigames celllife frame error', err)
    }
  }, { mode: 'dirty' })

  const startLevel = (next: number): void => {
    level = Math.min(Math.max(next, 0), LEVEL_COUNT - 1)
    state = newGame(buildLevel(level, GAME_SEED))
    hintsLeft = 2
    prevBoard = null
    anim = 0
    paused = false
    loop.markDirty()
  }

  const restartLevel = (): void => {
    // R：重摆。进行中/判负时清盘重摆并计一次重摆；过关后重开整关。
    if (state.phase === 'won') {
      startLevel(level)
      return
    }
    state.resets += 1
    resetPlacement(state)
    hintsLeft = 2
    prevBoard = null
    anim = 0
    loop.markDirty()
  }

  const doEvolve = (): void => {
    if (paused || state.phase !== 'play' || state.steps >= state.data.steps) return
    prevBoard = state.board.slice()
    const result = evolveOnce(state)
    anim = 1
    if (result === 'won') {
      if (scoredLevel !== level) {
        scoredLevel = level
        options?.onScore?.(computeScore(level + 1, state.resets))
      }
      saveLevel('celllife', level + 2)
      particles.burst(LOGICAL_W / 2, 240, THEME.good, 26, 190)
    }
    loop.markDirty()
  }

  const overlayText = (): { title: string; subtitle: string } | null => {
    if (paused) return { title: '暂停', subtitle: '按 P 继续 · R 重摆本关' }
    if (state.phase === 'won') {
      if (level >= LEVEL_COUNT - 1) return { title: '全部通关', subtitle: '五关全部播种成功 · 点击回到第 1 关' }
      return { title: '过关', subtitle: '得分 ' + computeScore(level + 1, state.resets) + ' · 点击进入下一关' }
    }
    if (state.phase === 'failed') return { title: '步数用尽', subtitle: '图案与目标不符 · 点击或按 R 重摆' }
    return null
  }

  const toLogical = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * LOGICAL_W) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_H) / rect.height,
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    focusGameHost(host)
    const { x, y } = toLogical(event)
    // 说明按钮：任何阶段/暂停中都可开合。
    if (x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (paused) return
    if (state.phase === 'won') {
      startLevel(level + 1)
      return
    }
    if (state.phase === 'failed') {
      restartLevel()
      return
    }
    if (state.steps > 0) return
    const cell = cellFromPoint(boardLayout(), x, y)
    if (cell === null) return
    if (toggleCell(state, cell)) loop.markDirty()
  }

  /** H 提示：摆上已知解中缺失的一个细胞；若已多摆了错误的则先清掉一个。 */
  const applyHint = (): void => {
    if (hintsLeft <= 0 || paused || state.phase !== 'play' || state.steps > 0) return
    // 优先清除解中不存在的细胞（错误摆放）。
    const solSet = new Set(state.data.solution.map(c => cellIndex(c)))
    for (let k = 0; k < state.board.length; k += 1) {
      if (state.board[k] && !solSet.has(k)) {
        toggleCell(state, { x: k % GRID, y: Math.floor(k / GRID) })
        hintsLeft -= 1
        loop.markDirty()
        return
      }
    }
    // 再补上解中缺失的细胞。
    for (const c of state.data.solution) {
      const k = cellIndex(c)
      if (!state.board[k]) {
        toggleCell(state, c)
        hintsLeft -= 1
        loop.markDirty()
        return
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.key === ' ') {
      event.preventDefault()
      doEvolve()
    } else if (event.key === 't' || event.key === 'T') {
      event.preventDefault()
      previewOn = !previewOn
      loop.markDirty()
    } else if (event.key === 'h' || event.key === 'H') {
      event.preventDefault()
      applyHint()
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      restartLevel()
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      paused = !paused
      loop.markDirty()
    }
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('keydown', onKeyDown)

  // 挂载时立即渲染一帧（不依赖 rAF 首帧——避免黑屏事故），再启动循环。
  render(16)
  loop.start()

  return {
    start(): void {
      loop.start()
    },
    pause(): void {
      loop.pause()
    },
    resume(): void {
      loop.resume()
    },
    destroy(): void {
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 生命播种：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const celllifeGame: MiniGameDefinition = {
  id: 'celllife',
  title: '生命播种 CellLife',
  icon: '🦠',
  description: '摆下几个细胞按下进化——五步之后要长成目标的样子，一步都不能错。',
  controls: [
    '点击中心起始区放/撤细胞，空格进化一步——完整规则点游戏内右下角「说明」',
    'H：提示 · T：预览下一步 · R：重摆 · P：暂停',
  ],
  create: createCellLifeGame,
}
