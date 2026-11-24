/**
 * 骰子地牢游戏定义：把纯逻辑接成 {@link MiniGameInstance}——点骰子选中、
 * 点槽卡片分配（非法组合直接被 logic 拒绝并提示），结束回合由敌人模
 * 式机结算；强化阶段点三选一卡片。R 重开（新种子）、P 暂停、H 或「说
 * 明」按钮开合帮助面板（任何阶段 / 暂停均可用，画面最上层）。回合制、
 * dirty 调度：静止零重绘，粒子存活窗口内逐帧 markDirty。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { createDungeon, type SlotKind } from './logic.ts'
import {
  END_TURN_RECT,
  HELP_RECT,
  LOGICAL_H,
  LOGICAL_W,
  diceRects,
  dicedungeonBurst,
  dicedungeonParticlesActive,
  renderDiceDungeon,
  slotRects,
  unlockedSlots,
  upgradeRects,
} from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 初始种子：R 重开时换用时间戳低位。 */
const FIRST_SEED = 20261124

/** 点是否落在矩形内。 */
function inRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

function createDiceDungeonGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'ddg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: dicedungeon needs a 2d canvas context')
  const ctx = fit.ctx

  let engine = createDungeon(FIRST_SEED)
  let selectedDieId: number | null = null
  let showHelp = false
  let running = true
  let scoreReported = false
  /** 本回合每颗骰被放入的槽（渲染已用骰盖字用；endTurn 清空）。 */
  let slotOfDie: Record<number, SlotKind> = {}

  const reportScore = (): void => {
    if (scoreReported) return
    const v = engine.view()
    if (v.phase === 'dead' || v.phase === 'victory') {
      scoreReported = true
      options?.onScore?.(engine.score())
    }
  }

  /** 击杀 / 受击的粒子反馈（逻辑坐标）。 */
  const feedback = (): void => {
    const v = engine.view()
    if (v.phase === 'dead') dicedungeonBurst(320, 110, '#f7768e', 26)
    else if (v.phase === 'victory' || v.phase === 'upgrade') dicedungeonBurst(320, 110, '#e0af68', 26)
  }

  const onPointerDown = (event: PointerEvent): void => {
    // 帮助按钮任何时刻（含暂停 / 结束）优先响应，且开面板时屏蔽下层点击。
    const rect = canvas.getBoundingClientRect()
    const px = (event.clientX - rect.left) * (LOGICAL_W / rect.width)
    const py = (event.clientY - rect.top) * (LOGICAL_H / rect.height)
    if (inRect(px, py, HELP_RECT)) {
      showHelp = !showHelp
      loop.markDirty()
      return
    }
    if (showHelp) return
    const v = engine.view()
    if (v.phase === 'upgrade') {
      upgradeRects().forEach((r, i) => {
        if (inRect(px, py, r)) {
          engine.chooseUpgrade(i)
          selectedDieId = null
          slotOfDie = {}
          loop.markDirty()
        }
      })
      return
    }
    if (v.phase !== 'battle' || !running) return
    // 点骰子：选中 / 再点取消。
    diceRects(v.dice).forEach((r, i) => {
      const die = v.dice[i]!
      if (!inRect(px, py, r) || die.used) return
      selectedDieId = selectedDieId === die.id ? null : die.id
      loop.markDirty()
    })
    // 点槽卡片：分配选中的骰子。
    if (selectedDieId !== null) {
      for (const r of slotRects(unlockedSlots(v))) {
        if (!inRect(px, py, r)) continue
        if (engine.assign(selectedDieId, r.slot)) {
          slotOfDie[selectedDieId] = r.slot
          selectedDieId = null
          feedback()
        }
        loop.markDirty()
        break
      }
    }
    // 结束回合。
    if (inRect(px, py, END_TURN_RECT)) {
      engine.endTurn()
      selectedDieId = null
      slotOfDie = {}
      feedback()
      reportScore()
      loop.markDirty()
    }
  }

  const restart = (): void => {
    engine = createDungeon((Date.now() & 0x7fffffff) >>> 0)
    selectedDieId = null
    slotOfDie = {}
    scoreReported = false
    showHelp = false
    loop.markDirty()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
      return
    }
    if (event.code === 'KeyP') {
      event.preventDefault()
      togglePause()
      return
    }
    if (event.code === 'KeyH') {
      event.preventDefault()
      showHelp = !showHelp
      loop.markDirty()
    }
  }

  const togglePause = (): void => {
    if (running) pause()
    else resume()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    loop.markDirty()
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.resume()
    loop.markDirty()
  }

  // dirty 调度：回合制静止零重绘；粒子存活期间逐帧 markDirty。
  const loop = createFrameLoop(f => {
    if (dicedungeonParticlesActive()) loop.markDirty()
    if (f.render) {
      renderDiceDungeon(ctx, engine.view(), {
        selectedDieId,
        showHelp,
        paused: !running,
        slotOfDie,
      }, f.wallMs)
    }
  }, { mode: 'dirty' })

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  loop.start()
  loop.markDirty()

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

export const dicedungeonGame: MiniGameDefinition = {
  id: 'dicedungeon',
  title: '骰子地牢 DiceDungeon',
  icon: '⚔️',
  description: '掷出骰子分给攻击盾牌技能——每个点数都有用，就看你怎幺分。',
  controls: ['点骰子再点槽卡片分配，点「结束回合」', 'R 重开 · P 暂停 · H 或「说明」看规则'],
  create: createDiceDungeonGame,
}
