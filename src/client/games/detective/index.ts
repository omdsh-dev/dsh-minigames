/**
 * 侦探推理游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 空格掷骰、
 * 点击高亮房间移动；进入房间自动弹盘问层（选嫌疑人 + 凶器，证人 AI 按
 * 发牌顺序亮一张匹配卡或无匹配触发锁定推断）；到中央大厅点击自身开启
 * 指认层（三要素，一局一次）；记事板自动维护排除/锁定标记。R 换种子
 * 重开、P 暂停、胜负后空格/点击再来一局；连胜经 onScore 上报。脏标记
 * 渲染：静止盘面零重绘，骰面动画与粒子期间逐帧。
 */
import type { MiniGameDefinition, MiniGameInstance, MiniGameMountOptions } from '../types.ts'
import {
  CENTER_ROOM, ROOMS, SUSPECTS, WEAPONS, accuse, cardName, createDetective, deriveNotes,
  moveTo, reachableRooms, rollDie, suggest, type DetectiveState,
} from './logic.ts'
import { renderDetective, roomAt, suggestHit, accuseHit, HELP_BTN, LOGICAL_W, LOGICAL_H, type DetectiveView } from './render.ts'
import { fitCanvas } from '../canvas-fit.ts'
import { focusGameHost, gameHasFocus } from '../focus.ts'
import { accent, createParticles } from '../theme.ts'
import { createFrameLoop } from '../frame-scheduler.ts'

const DICE_MS = 520
const BANNER_MS = 2600
const TOAST_MS = 1300

/** 每局新种子的来源：时间戳异或递增计数器。 */
let restartCounter = 0
function nextSeed(): number {
  restartCounter = (restartCounter + 1) >>> 0
  return (Date.now() ^ Math.imul(restartCounter, 0x9e3779b9)) >>> 0
}

/** 底牌揭示文本（胜/负覆盖层用）。 */
function revealText(s: DetectiveState): string {
  return SUSPECTS[s.secret.suspect]! + ' · ' + WEAPONS[s.secret.weapon]! + ' · ' + ROOMS[s.secret.room]!
}

function createDetectiveGame(host: HTMLElement, options?: MiniGameMountOptions): MiniGameInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'dmg-game-canvas'
  host.replaceChildren(canvas)
  const fit = fitCanvas(host, canvas, LOGICAL_W, LOGICAL_H)
  if (fit === null) throw new Error('dsh-minigames: detective needs a 2d canvas context')
  const ctx = fit.ctx

  let state = createDetective(nextSeed())
  let phase: 'idle' | 'move' | 'suggest' | 'accuse' = 'idle'
  let pickSuspect = -1
  let pickWeapon = -1
  let pickRoom = -1
  let diceFace = 0
  let diceMs = 0
  let banner = ''
  let bannerGood = false
  let bannerMs = 0
  let toast = ''
  let toastMs = 0
  let streak = 0
  let paused = false
  /** 说明面板开关。 */
  let helpOpen = false
  let running = false
  let lastScore = -1
  const particles = createParticles()

  const status = (): 'playing' | 'won' | 'lost' => (state.won === null ? 'playing' : state.won ? 'won' : 'lost')

  const reportScore = (): void => {
    if (streak === lastScore) return
    lastScore = streak
    options?.onScore?.(streak)
  }

  const say = (text: string): void => {
    toast = text
    toastMs = TOAST_MS
  }

  /** 结束一回合（盘问后）回到待掷。 */
  const endTurn = (): void => {
    phase = 'idle'
  }

  const doRoll = (): void => {
    if (status() !== 'playing' || paused) return
    if (phase === 'suggest' || phase === 'accuse') return
    if (state.steps > 0) {
      say('本回合还有 ' + state.steps + ' 步')
      return
    }
    const v = rollDie(state)
    if (v === 0) return
    diceFace = v
    diceMs = DICE_MS
    phase = 'move'
    if (reachableRooms(state).length === 0) {
      // 理论上 1 步总有邻格；兜底直接结束回合。
      state.steps = 0
      phase = 'idle'
    }
  }

  /** 点击棋盘：移动 / 在中央大厅原地再点开启指认。 */
  const clickRoom = (room: number): void => {
    if (phase === 'move' && room !== state.pos) {
      if (!moveTo(state, room)) {
        say('步数不够')
        return
      }
      if (room === CENTER_ROOM) {
        phase = 'idle'
      } else {
        pickSuspect = -1
        pickWeapon = -1
        phase = 'suggest'
      }
      return
    }
    if (phase === 'idle' && room === CENTER_ROOM && state.pos === CENTER_ROOM && status() === 'playing') {
      pickSuspect = -1
      pickWeapon = -1
      pickRoom = -1
      phase = 'accuse'
    }
  }

  /** 确认盘问：AI 亮牌 / 无匹配推断，横幅反馈后回待掷。 */
  const confirmSuggest = (): void => {
    const shown = suggest(state, pickSuspect, pickWeapon)
    if (shown === -1) return
    if (shown === null) {
      banner = '证人没有匹配的卡 · 未持有者已锁定'
      bannerGood = false
    } else {
      banner = '证人亮出：' + cardName(shown)
      bannerGood = true
      particles.burst(240, 280, accent(shown), 16, 130)
    }
    bannerMs = BANNER_MS
    endTurn()
  }

  /** 确认指认：胜负结算 + 覆盖层 + 粒子。 */
  const confirmAccuse = (): void => {
    const r = accuse(state, pickSuspect, pickWeapon, pickRoom)
    if (r === 'used') return
    if (r === 'win') {
      streak += 1
      particles.burst(LOGICAL_W / 2, LOGICAL_H / 2, '#9ece6a', 40, 190)
    } else {
      streak = 0
    }
    reportScore()
    phase = 'idle'
  }

  const restart = (): void => {
    if (status() === 'lost' && streak !== 0) {
      streak = 0
      reportScore()
    }
    state = createDetective(nextSeed())
    phase = 'idle'
    pickSuspect = -1
    pickWeapon = -1
    pickRoom = -1
    diceFace = 0
    diceMs = 0
    banner = ''
    bannerMs = 0
    toast = ''
    toastMs = 0
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!gameHasFocus(host)) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === 'Space') {
      event.preventDefault()
      if (!running || paused) return
      if (status() !== 'playing') restart()
      else doRoll()
      return
    }
    if (event.code === 'KeyR') {
      event.preventDefault()
      restart()
      return
    }
    if (event.code === 'KeyP') {
      if (status() === 'playing') paused = !paused
      return
    }
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!running) return
    const rect0 = canvas.getBoundingClientRect()
    const hx = ((event.clientX - rect0.left) * LOGICAL_W) / rect0.width
    const hy = ((event.clientY - rect0.top) * LOGICAL_H) / rect0.height
    // 说明按钮：任何阶段/暂停中都可开合。
    if (hx >= HELP_BTN.x && hx <= HELP_BTN.x + HELP_BTN.w && hy >= HELP_BTN.y && hy <= HELP_BTN.y + HELP_BTN.h) {
      helpOpen = !helpOpen
      loop.markDirty()
      return
    }
    if (paused) return
    if (status() !== 'playing') {
      restart()
      return
    }
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * LOGICAL_W) / rect.width
    const y = ((event.clientY - rect.top) * LOGICAL_H) / rect.height
    if (phase === 'suggest') {
      const hit = suggestHit(x, y)
      if (hit === 'cancel') endTurn()
      else if (hit === 'ok') { if (pickSuspect >= 0 && pickWeapon >= 0) confirmSuggest(); else say('先选嫌疑人与凶器') }
      else if (hit !== null && hit.type === 'suspect') pickSuspect = hit.index
      else if (hit !== null && hit.type === 'weapon') pickWeapon = hit.index
      return
    }
    if (phase === 'accuse') {
      const hit = accuseHit(x, y)
      if (hit === 'cancel') phase = 'idle'
      else if (hit === 'ok') {
        if (pickSuspect >= 0 && pickWeapon >= 0 && pickRoom >= 0) confirmAccuse()
        else say('三要素都要选')
      } else if (hit !== null && hit.type === 'suspect') pickSuspect = hit.index
      else if (hit !== null && hit.type === 'weapon') pickWeapon = hit.index
      else if (hit !== null && hit.type === 'room') pickRoom = hit.index
      return
    }
    const room = roomAt(x, y)
    if (room >= 0) clickRoom(room)
  }

  const view = (): DetectiveView => ({
    helpOpen,
    pos: state.pos,
    die: state.die,
    steps: state.steps,
    diceFace: diceMs > 0 ? diceFace : state.die,
    reachable: reachableRooms(state),
    hand: state.playerHand,
    notes: deriveNotes(state),
    phase,
    pickSuspect,
    pickWeapon,
    pickRoom,
    banner,
    bannerGood,
    toast,
    status: status(),
    reveal: revealText(state),
    streak,
    paused,
  })

  const loop = createFrameLoop(f => {
    const dtMs = f.dt * 1000
    const wasRolling = diceMs > 0
    diceMs = Math.max(0, diceMs - dtMs)
    if (wasRolling && diceMs > 0) {
      // 骰面滚动动画：快速轮换 1–3 的伪随机面。
      diceFace = 1 + ((diceFace + Math.floor(dtMs / 60)) % 3)
    }
    bannerMs = Math.max(0, bannerMs - dtMs)
    if (bannerMs === 0 && banner !== '') banner = ''
    toastMs = Math.max(0, toastMs - dtMs)
    if (toastMs === 0 && toast !== '') toast = ''
    const animating = diceMs > 0 || bannerMs > 0 || toastMs > 0 || particles.size() > 0
    if (f.render || animating) {
      renderDetective(ctx, view())
      particles.tick(ctx, dtMs)
      if (animating) loop.markDirty()
    }
  }, { mode: 'dirty' })

  const pause = (): void => {
    running = false
    loop.pause()
    renderDetective(ctx, view())
  }
  const resume = (): void => {
    if (running) return
    running = true
    loop.markDirty()
    loop.resume()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('keydown', onKeyDown)
  focusGameHost(host)
  running = true
  loop.start()
  renderDetective(ctx, view())

  return {
    start: resume,
    pause,
    resume,
    destroy: () => {
      running = false
      loop.destroy()
      fit.dispose()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}

export const detectiveGame: MiniGameDefinition = {
  id: 'detective',
  title: '侦探推理 Detective',
  icon: '🕵',
  description: '三张底牌藏在谁手里——走访房间、盘问线索，一次指认定输赢。',
  controls: [
    '空格掷骰、点击房间移动，进房盘问收集排除——完整规则点游戏内右上角「说明」',
    'R：换局重开 · P：暂停',
  ],
  create: createDetectiveGame,
}
