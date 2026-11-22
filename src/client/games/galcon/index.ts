/**
 * 星域征服 Galcon 游戏定义：把纯逻辑接成 {@link MiniGameInstance}——
 * continuous 帧循环推进模拟与渲染。点击己方星球选中（再点该星=全选
 * 己方），点目标星球从所有选中星球各派 50% 兵力；空格=全选己方（局
 * 末=进入下一局）、R 重开整场（3 局积分清零）、P 暂停。得分经
 * onScore 上报（面板管理最高分）。
 */
import type {
  MiniGameDefinition,
  MiniGameInstance,
  MiniGameMountOptions,
} from '../types.ts'
import {
  createGalcon, stepGalcon, selectPlanet, selectAllOwn, nextMatch, restartMatch,
  planetById, W, H,
  type GalconState,
} from './logic.ts'
import { createGalconRenderer } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { createFrameLoop, type FrameInfo } from '../frame-scheduler.ts'

/** 每场种子：挂载时取一次，整场 3 局与其重开共用基种子。 */
function dailySeed(): number {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function createGalconGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  canvas.style.touchAction = 'none'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, W, H)
  if (fit === null) throw new Error('dsh-minigames: galcon needs a 2d canvas context')
  const ctx = fit.ctx

  const seed = dailySeed()
  let state: GalconState = createGalcon(seed)
  const renderer = createGalconRenderer(seed)
  let running = false
  let lastScore = -1
  let prevPhase: GalconState['phase'] = state.phase

  const toLogical = (e: PointerEvent): { x: number, y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * W,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * H,
    }
  }

  const onPointerDown = (e: PointerEvent): void => {
    focusGameHost(host)
    if (!running || state.phase !== 'playing') return
    e.preventDefault()
    const pt = toLogical(e)
    // 命中测试：点半径 r+8 内取最近星球；点空处清空选中。
    let hit: { id: number, d: number } | null = null
    for (const p of state.planets) {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y)
      if (d <= p.r + 8 && (hit === null || d < hit.d)) hit = { id: p.id, d }
    }
    if (hit === null) {
      state.selectedIds = []
      return
    }
    const before = state.fleets.length
    const action = selectPlanet(state, hit.id)
    if (action === 'launch' && state.fleets.length > before) {
      const f = state.fleets[state.fleets.length - 1]!
      const src = planetById(state, f.fromId)
      if (src !== null) renderer.burst(src.x, src.y, '#e0af68')
    }
  }
  canvas.addEventListener('pointerdown', onPointerDown)

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    // 修饰键组合（Ctrl/Cmd+R 刷新等）是浏览器命令，不作为游戏输入。
    if (event.ctrlKey || event.altKey || event.metaKey) return
    switch (event.code) {
      case 'Space':
        event.preventDefault()
        if (state.phase === 'playing') selectAllOwn(state)
        else if (state.phase === 'won' || state.phase === 'lost') nextMatch(state)
        break
      case 'KeyP':
        event.preventDefault()
        if (running) pause()
        else resume()
        break
      case 'KeyR':
        event.preventDefault()
        restartMatch(state)
        running = false
        resume()
        break
    }
  }
  document.addEventListener('keydown', onKeyDown)

  const reportScore = (): void => {
    if (state.totalScore === lastScore) return
    lastScore = state.totalScore
    options?.onScore?.(state.totalScore)
  }

  const frame = (f: FrameInfo): void => {
    if (!running) return
    stepGalcon(state, f.dt * 1000)
    // 局末爆点：在最后一颗星球位置撒粒子一次。
    if (prevPhase === 'playing' && state.phase !== 'playing' && state.phase !== 'matchOver') {
      const p = state.planets.find((q) => q.owner === 'player') ?? state.planets[0]
      if (p !== undefined) {
        renderer.burst(p.x, p.y, state.phase === 'won' ? '#9ece6a' : '#f7768e')
      }
    }
    prevPhase = state.phase
    reportScore()
    if (f.render || state.phase !== 'playing') renderer.draw(ctx, state, !running)
  }
  const loop = createFrameLoop(frame)

  const pause = (): void => {
    if (!running) return
    running = false
    loop.pause()
    renderer.draw(ctx, state, true)
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.resume()
  }

  focusGameHost(host)
  renderer.draw(ctx, state, false)

  return {
    start(): void {
      if (running) return
      running = true
      loop.start()
    },
    pause,
    resume,
    destroy(): void {
      running = false
      loop.destroy()
      canvas.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      fit.dispose()
    },
  }
}

/** 星域征服 Galcon：派兵攻占星球，扩张要快、留守要够，3 局积分定胜负。 */
export const galconGame: MiniGameDefinition = {
  id: 'galcon',
  title: '星域征服 Galcon',
  icon: '🛸',
  description: '派兵攻打邻近星球——扩张要快，留守要够，全图一统。',
  controls: [
    '点己方星球选中，再点同一颗=全选己方；点目标星球=从所有选中星球各派 50% 兵力（飞行按距离耗时）',
    '到达结算：己方星叠加兵力；敌方/中立星对冲（攻-防），正差占领',
    '只有归属方产兵（速率随星球大小）；胜利=全图归一（含在途舰队），超时兵多者胜、平兵判负',
    'AI 每隔数秒集火最弱目标并回防受攻星球，随局数加快',
    '空格：全选己方 / 局间流转 · P：暂停 · R：重开整场（3 局积分制）',
  ],
  create: createGalconGame,
}
