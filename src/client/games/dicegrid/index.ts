/**
 * 骰子彩窗 DiceGrid 装配：纯逻辑接进面板生命周期。
 *
 * 交互：点候选骰选中 → 点彩窗空格放置（非法则提示）；选中后可点「弃骰」
 * 丢弃；R 同 seed 重开本关；P 暂停；任何阶段（含暂停/过关）可点「说明」
 * 开合帮助面板。过关后点击进入下一关（5 关循环）。dirty 渲染：仅状态
 * 变化时重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { computeScore, createGame, discardDie, LEVEL_COUNT, placeDie, type DiceGameState } from './logic.ts'
import {
  gridCellAt, inDiscardBtn, inHelpBtn, LOGICAL_H, LOGICAL_W, rackDieAt, renderDiceGrid,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

function createDiceGridGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: dicegrid needs a 2d canvas context')
  const ctx = fit.ctx

  let level = 1
  const baseSeed = ((Date.now() % 900000) + 1) >>> 0
  const seedFor = (lvl: number): number => (baseSeed + lvl * 1013) >>> 0
  let state: DiceGameState = createGame(level, seedFor(level))
  let selected: number | null = null
  let paused = false
  let helpOpen = false
  let flash = ''
  let reported = false

  const view = () => ({ selected, paused, helpOpen, flash })

  const restartLevel = (): void => {
    state = createGame(level, seedFor(level))
    selected = null
    flash = ''
    reported = false
  }

  const loadLevel = (lvl: number): void => {
    level = lvl
    restartLevel()
  }

  const onMouseDown = (event: MouseEvent): void => {
    focusGameHost(host)
    loop.markDirty()
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height

    // 说明按钮：任何阶段（暂停/过关）都可开合。
    if (inHelpBtn(x, y)) {
      helpOpen = !helpOpen
      return
    }
    // 帮助面板打开时，点面板外先收起面板，不吃掉本回合的其它操作。
    if (helpOpen) {
      helpOpen = false
      return
    }
    if (state.won) {
      loadLevel((level % LEVEL_COUNT) + 1)
      return
    }
    if (paused) return

    const rackIndex = rackDieAt(x, y, state.rack.length)
    if (rackIndex !== null) {
      selected = rackIndex
      flash = ''
      return
    }
    if (inDiscardBtn(x, y)) {
      if (selected === null) {
        flash = '先点一颗候选骰，再弃骰'
        return
      }
      discardDie(state, selected)
      selected = null
      flash = '已弃一颗（每颗扣 3 分）'
      return
    }
    const cell = gridCellAt(x, y)
    if (cell === null) return
    if (selected === null) {
      flash = '先在下方骰架点选一颗骰'
      return
    }
    const ok = placeDie(state, selected, cell.r, cell.c)
    if (!ok) {
      flash = '放不下：约束、同行列点数或相邻颜色冲突'
      return
    }
    selected = null
    flash = ''
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restartLevel()
      loop.markDirty()
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      helpOpen = !helpOpen
      loop.markDirty()
    }
  }

  const loop = createFrameLoop((f) => {
    if (state.won && !reported) {
      reported = true
      options?.onScore?.(computeScore(state.level, state.discarded))
      loop.markDirty()
    }
    if (f.render) renderDiceGrid(ctx, state, view())
  }, { mode: 'dirty' })

  const pause = (): void => {
    if (paused) return
    paused = true
    loop.pause()
    renderDiceGrid(ctx, state, view())
  }
  const resume = (): void => {
    if (!paused) return
    paused = false
    loop.resume()
    loop.markDirty()
  }
  const togglePause = (): void => {
    if (paused) resume()
    else pause()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  loop.start()
  renderDiceGrid(ctx, state, view())

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const dicegridGame: MiniGameDefinition = {
  id: 'dicegrid',
  title: '骰子彩窗 DiceGrid',
  icon: '⛪',
  description: '从骰子池里挑一颗放进彩窗格——同行同列不许同值同色，像彩色玻璃一样严丝合缝。',
  controls: ['点骰架选骰 → 点格子放置；「弃骰」丢弃（扣分）', 'R 重开 · P 暂停 · 点「说明」看规则'],
  create: createDiceGridGame,
}
