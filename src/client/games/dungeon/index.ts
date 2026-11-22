/**
 * 「像素地牢」游戏定义：把纯逻辑（./logic.ts）与像素渲染（./render.ts）
 * 接成 {@link MiniGameInstance}。方向键 / WASD 回合制移动，R 重开
 * （死亡后金币减半传承），P 暂停。回合制盘面用 dirty 渲染——只在
 * 移动 / 拾取 / 胜负 / 浮动数字未消失时重绘。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { createRun, computeVisible, playerTurn, scoreOf, type Dir, type DungeonState } from './logic.ts'
import { FLOAT_MS, LOGICAL_H, LOGICAL_W, burstAt, cellCenter, floatFromEvent, particlesActive, renderDungeon, type FloatText } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 固定地图种子：R 重开 / 死亡重来都回到同一张地牢（确定性）。 */
const RUN_SEED = 20261122

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

function createDungeonGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: dungeon needs a 2d canvas context')
  const ctx = fit.ctx

  let state: DungeonState = createRun(RUN_SEED)
  let running = false
  let paused = false
  const floats: FloatText[] = []
  let lastScore = -1

  const reportScore = (): void => {
    const score = scoreOf(state)
    if (score === lastScore) return
    lastScore = score
    options?.onScore?.(score)
  }

  const applyEvents = (events: ReturnType<typeof playerTurn>): void => {
    for (const event of events) {
      const f = floatFromEvent(event)
      if (f !== null) floats.push(f)
      if (event.kind === 'kill' || event.kind === 'win') {
        const at = cellCenter(event.x, event.y)
        burstAt(at.px, at.py, event.kind === 'win' ? THEME_GOLD : THEME_BAD, event.kind === 'win' ? 26 : 12)
      }
    }
    reportScore()
  }

  const restart = (): void => {
    const inherited = state.status === 'dead' ? Math.floor(state.gold / 2) : 0
    state = createRun(RUN_SEED, inherited)
    floats.length = 0
    reportScore()
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
    if (!running || paused) return
    const dir = KEY_DIR[event.code]
    if (dir === undefined) return
    event.preventDefault()
    applyEvents(playerTurn(state, dir))
    loop.markDirty()
  }

  const draw = (dtMs: number): void => {
    renderDungeon(ctx, state, { visible: computeVisible(state.player.x, state.player.y), floats, paused, dtMs })
  }

  // dirty 渲染：浮动数字 / 粒子存续期间持续标记脏，直到安静下来。
  const loop = createFrameLoop(f => {
    if (floats.length > 0 || particlesActive()) {
      for (const fl of floats) fl.age += f.dt * 1000
      for (let i = floats.length - 1; i >= 0; i -= 1) {
        if (floats[i]!.age >= FLOAT_MS) floats.splice(i, 1)
      }
      loop.markDirty()
    }
    if (f.render) draw(f.dt * 1000)
  }, { mode: 'dirty' })

  const togglePause = (): void => {
    if (!running) return
    paused = !paused
    loop.markDirty()
  }
  const pause = (): void => {
    if (!running) return
    running = false
    paused = true
    loop.pause()
    draw(16)
  }
  const resume = (): void => {
    if (running) return
    running = true
    paused = false
    loop.markDirty()
    loop.resume()
  }

  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  reportScore()
  loop.start()
  draw(16)

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      fit.dispose()
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 击杀 / 通关粒子颜色（避免在事件处理里再 import theme）。 */
const THEME_BAD = '#f7768e'
const THEME_GOLD = '#e0af68'

/** 「像素地牢」定义：回合制 roguelike 地牢爬行。 */
export const dungeonGame: MiniGameDefinition = {
  id: 'dungeon',
  title: '像素地牢 Dungeon',
  icon: '🗝',
  description: '层层深入的地牢——剑与药水、怪物与宝箱，每一层都是新的。',
  controls: [
    '方向键 / WASD：回合制移动，你走一步怪物动一步',
    '走入怪物格=攻击（先手 2-4 伤害，怪反击）；药水 +8 血，宝箱给金币或攻+1',
    '找到 ▼ 楼梯下行，共 5 层越深越强，第 5 层击败龙王即通关',
    '火把只照亮半径 4 格，走过的区域保持微亮记忆',
    '死亡后按 R 重开：从第 1 层重来、金币减半传承 · P 暂停',
  ],
  create: createDungeonGame,
}
