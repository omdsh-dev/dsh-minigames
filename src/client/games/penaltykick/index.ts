/**
 * 点球大战 PenaltyKick 游戏入口：把纯逻辑与渲染层接成 MiniGameInstance。
 * 交互：罚球阶段点击球门六格选落点（←→↑↓ 可调）、拖动滑条或 W/S 调
 * 力度、空格射门；扑救阶段看 1 秒站位预读（金框热区）后点击一格扑救
 * （到时自动按提示扑）；R 重开整场 · P 暂停。胜场累计为等级（AI 更狡
 * 猾），level-progress 持久化。帧循环 continuous（守门员/足球动画、预
 * 读脉冲）；挂载时先立即渲染一帧再启动循环，帧回调 try-catch 包裹
 * （渲染异常只记录不中断 rAF 链）。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import { clampPower, confirmDive, confirmShoot, matchScore, MAX_POWER, MIN_POWER, newMatch, type KickRecord, type MatchState, type Zone } from './logic.ts'
import { HELP_BTN, LOGICAL_H, LOGICAL_W, PEN_SPOT, POWER_HIT, powerFromPoint, renderScene, type SceneView, zoneCenter, zoneFromPoint } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { readLevel, saveLevel } from '../level-progress.ts'
import { THEME, createParticles, drawOverlay } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

/** 罚球动画时长（秒）。 */
const KICK_ANIM_S = 0.7
/** 结果定格时长（秒）。 */
const SETTLE_S = 0.9
/** 站位预读时长（秒），到时未点则自动按提示扑。 */
const PRE_READ_S = 1.0
/** 键盘步进力度。 */
const POWER_STEP = 0.05

/** 进行中的罚球动画（含定格段）。 */
interface AnimState {
  record: KickRecord
  t: number
  settle: number
}

function freshSeed(): number {
  return (Date.now() % 2147483647) >>> 0
}

function createPenaltyKickGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const particles = createParticles()

  const initialFit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (initialFit === null) throw new Error('dsh-minigames: penaltykick needs a 2d canvas context')
  const fit = initialFit
  const ctx = fit.ctx

  let level = readLevel('penaltykick')
  let state: MatchState = newMatch(freshSeed(), level)
  let anim: AnimState | null = null
  let countdown = 0
  let clock = 0
  let aimZone: Zone = 0
  let power = 0.6
  let hoverZone: Zone | null = null
  let dragging = false
  let helpOpen = false
  let paused = false
  let scored = false

  const mode = (): 'shoot' | 'read' | 'anim' | 'over' => {
    if (anim !== null) return 'anim'
    if (state.phase === 'over') return 'over'
    if (state.phase === 'keep') return 'read'
    return 'shoot'
  }

  const view = (): SceneView => ({
    mode: mode(),
    state,
    aimZone,
    power,
    hoverZone,
    anim: anim === null ? null : { record: anim.record, t: Math.min(1, anim.t) },
    countdown: Math.max(0, countdown),
    clock,
  })

  const restart = (): void => {
    level = readLevel('penaltykick')
    state = newMatch(freshSeed(), level)
    anim = null
    countdown = 0
    aimZone = 0
    power = 0.6
    hoverZone = null
    dragging = false
    paused = false
    scored = false
    loop.markDirty()
  }

  const finishMatch = (): void => {
    if (scored || state.phase !== 'over') return
    scored = true
    options?.onScore?.(matchScore(state))
    if (state.outcome === 'win') {
      saveLevel('penaltykick', level + 1)
      particles.burst(LOGICAL_W / 2, 300, THEME.good, 26, 190)
    } else {
      particles.burst(LOGICAL_W / 2, 300, THEME.bad, 16, 150)
    }
  }

  const doShoot = (): void => {
    if (paused || anim !== null || state.phase !== 'shoot') return
    const record = confirmShoot(state, aimZone, power)
    anim = { record, t: 0, settle: SETTLE_S }
    loop.markDirty()
  }

  const doDive = (zone: Zone): void => {
    if (paused || anim !== null || state.phase !== 'keep') return
    const record = confirmDive(state, zone)
    anim = { record, t: 0, settle: SETTLE_S }
    const c = zoneCenter(record.shot.zone)
    if (record.result === 'goal') {
      particles.burst(c.x, c.y, record.shooter === 'player' ? THEME.good : THEME.bad, 18, 160)
    } else if (record.result === 'saved') {
      particles.burst(c.x, c.y, record.shooter === 'player' ? THEME.bad : THEME.good, 14, 130)
    }
    loop.markDirty()
  }

  const render = (dtMs: number): void => {
    renderScene(ctx, view(), helpOpen)
    particles.tick(ctx, dtMs)
    if (paused) {
      drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · R 重开整场')
    } else if (state.phase === 'over' && anim === null) {
      const title = state.outcome === 'win' ? '比赛胜利' : '比赛告负'
      drawOverlay(ctx, LOGICAL_W, LOGICAL_H, title, '得分 ' + matchScore(state) + ' · 按 R 或点击重开', state.outcome === 'win' ? THEME.good : THEME.bad)
    }
  }

  const loop = createFrameLoop((frame) => {
    // 帧回调整体 try-catch：渲染异常杀死 rAF 链是历史事故，只记录不中断。
    try {
      if (!paused) clock += frame.dt
      if (anim !== null && !paused) {
        if (anim.t < 1) anim.t = Math.min(1, anim.t + frame.dt / KICK_ANIM_S)
        else if (anim.settle > 0) anim.settle -= frame.dt
        else {
          const wasPlayerKick = anim.record.shooter === 'player'
          const record = anim.record
          anim = null
          if (wasPlayerKick && state.phase === 'keep') {
            countdown = PRE_READ_S
          } else if (state.phase === 'over') {
            finishMatch()
          }
          if (record.result === 'goal' && record.shooter === 'player') {
            const c = zoneCenter(record.shot.zone)
            particles.burst(c.x, c.y, THEME.good, 18, 160)
          }
        }
        loop.markDirty()
      } else if (state.phase === 'keep' && !paused) {
        countdown -= frame.dt
        if (countdown <= 0 && state.hint !== null) {
          // 预读到时未点：自动按提示格扑救（跟随预读的默认行为）。
          doDive(state.hint)
        }
        loop.markDirty()
      }
      if (frame.render || particles.size() > 0 || anim !== null) render(frame.wallMs)
    } catch (err) {
      console.error('dsh-minigames penaltykick frame error', err)
    }
  }, { mode: 'continuous' })

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
    if (x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (paused) return
    const current = mode()
    if (current === 'over') {
      restart()
      return
    }
    if (current === 'anim') return
    if (current === 'read') {
      const zone = zoneFromPoint(x, y)
      if (zone !== null) doDive(zone)
      return
    }
    if (x >= POWER_HIT.x && x <= POWER_HIT.x + POWER_HIT.w && y >= POWER_HIT.y && y <= POWER_HIT.y + POWER_HIT.h) {
      dragging = true
      power = clampPower(powerFromPoint(x))
      loop.markDirty()
      return
    }
    const zone = zoneFromPoint(x, y)
    if (zone !== null) {
      aimZone = zone
      loop.markDirty()
    }
  }

  const onMouseMove = (event: MouseEvent): void => {
    const { x, y } = toLogical(event)
    if (dragging) {
      power = clampPower(powerFromPoint(x))
      loop.markDirty()
      return
    }
    const zone = zoneFromPoint(x, y)
    if (zone !== hoverZone) {
      hoverZone = zone
      loop.markDirty()
    }
  }

  const onMouseUp = (): void => {
    dragging = false
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    const key = event.key
    if (key === ' ') {
      event.preventDefault()
      doShoot()
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      if (paused || mode() !== 'shoot') return
      const col = aimZone % 2
      const nextCol = col === 0 ? 1 : 0
      aimZone = (Math.floor(aimZone / 2) * 2 + nextCol) as Zone
      loop.markDirty()
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault()
      if (paused || mode() !== 'shoot') return
      const row = Math.floor(aimZone / 2)
      const nextRow = key === 'ArrowUp' ? Math.max(0, row - 1) : Math.min(2, row + 1)
      aimZone = (nextRow * 2 + (aimZone % 2)) as Zone
      loop.markDirty()
    } else if (key === 'w' || key === 'W') {
      event.preventDefault()
      if (paused || mode() !== 'shoot') return
      power = clampPower(power + POWER_STEP)
      loop.markDirty()
    } else if (key === 's' || key === 'S') {
      event.preventDefault()
      if (paused || mode() !== 'shoot') return
      power = clampPower(power - POWER_STEP)
      loop.markDirty()
    } else if (key === 'r' || key === 'R') {
      event.preventDefault()
      restart()
    } else if (key === 'p' || key === 'P') {
      event.preventDefault()
      paused = !paused
      loop.markDirty()
    }
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
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
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

/** 点球大战：MiniGameDefinition 导出（id/title/icon/description/controls）。 */
export const penaltykickGame: MiniGameDefinition = {
  id: 'penaltykick',
  title: '点球大战 PenaltyKick',
  icon: '⚽',
  description: '往哪个角踢，守门员会扑哪个角——五轮点球的心理博弈。',
  controls: [
    '罚球：点击/方向键选球门格子，拖滑条或 W/S 调力度，空格射门；扑救：金框预读后点击一格——完整规则点游戏内右下角「说明」',
    'R：重开整场 · P：暂停',
  ],
  create: createPenaltyKickGame,
}
