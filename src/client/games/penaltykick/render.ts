/**
 * 点球大战 PenaltyKick 渲染层：门线视角球场（球门六区分格 + 球网）、
 * 守门员扑救动画、足球飞行弧线、力度滑条（风险段红显）、比分板（五轮
 * 点球格 ●/✗/○ + 骤死轮追加）、AI 热区预读金框、说明按钮 + 帮助面板
 * （渲染末尾最上层）。纯绘制，无状态；布局常量集中声明并核算互不
 * 遮挡：HUD 带 y26（左 x16 / 中 x360 居中 / 右 x704 右锚，净距 ≥140px）；
 * 点球格行 y58/y82（左标签 x16 结束 ~x42，右统计 x~616 起，净距 >570px）；
 * 球门 200-520 x 96-256；预读/结果文本 y292/y330（模式互斥不同时出现）；
 * 力度带 y512（标签右锚 244，数值左锚 462，净距 218px）；底提示带 y540
 * （居中 ≤340px 宽即 190-530，与说明按钮 644-704 净距 ≥114px）；说明按钮
 * 644-704 x 528-552。全部在 720x560 逻辑画布内。无反引号模板字符串。
 */
import type { KickRecord, MatchState, Zone } from './logic.ts'
import { MAX_POWER, MIN_POWER, MISS_THRESHOLD, REGULATION_KICKS } from './logic.ts'
import { accent, drawBackground, glow, hudPair, noGlow, roundRectPath, THEME } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 720
export const LOGICAL_H = 560

/** 球门矩形（门线视角，含六区网格）。 */
export const GOAL = { x: 200, y: 96, w: 320, h: 160 }
/** 力度滑条矩形。 */
export const POWER_BAR = { x: 252, y: 500, w: 200, h: 16 }
/** 力度滑条的可点命中区（比滑条本体外扩，便于拖拽）。 */
export const POWER_HIT = { x: 240, y: 488, w: 224, h: 40 }
/** 点球点。 */
export const PEN_SPOT = { x: LOGICAL_W / 2, y: 462 }
/** 说明按钮矩形（右下角，60x24）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: LOGICAL_H - 32, w: 60, h: 24 }

/** 帮助面板矩形。 */
const HELP_PANEL = { x: 80, y: 336, w: 560, h: 212 }
/** 帮助面板文案（15px 大字，完整规则 + 易误解点）。 */
const HELP_LINES = [
  '点球大战规则',
  '· 玩家 5 轮罚球 + 5 轮扑救（AI 罚球），进球多者胜；常规 5 轮平局进入骤死轮',
  '· 罚球：点击球门六格（左/右 × 高/中/低）选落点，拖动底部滑条或 W/S 调力度',
  '· 力度越高越贴角越难被扑，但超过 75% 开始有打飞风险，满力度 15% 踢飞过横梁',
  '· 守门员 AI 统计你的射门习惯：连续踢同一路线会被精准预判——勤换角度',
  '· 扑救：AI 射门前有 1 秒「站位预读」（金色高亮 = AI 热区提示），点击一格扑救',
  '· 扑对 AI 射门所在格即扑出；预读提示约 1/4 是假动作，等级越高假动作越多',
  '· 空格射门 · R 重开整场 · P 暂停 · 胜场越多 AI 越狡猾（进度自动保存）',
]

const FONT = 'system-ui, sans-serif'

/** 一格球门区的逻辑矩形。 */
export interface ZoneRect { x: number; y: number; w: number; h: number }

/**
 * 六区中某一格的矩形（行×列均分球门）。
 * @param zone - 区号（行*2+列）。
 * @returns 该格矩形。
 */
export function zoneRect(zone: Zone): ZoneRect {
  const row = Math.floor(zone / 2)
  const col = zone % 2
  const w = GOAL.w / 2
  const h = GOAL.h / 3
  return { x: GOAL.x + col * w, y: GOAL.y + row * h, w, h }
}

/**
 * 六区中某一格的中心点（球飞行的落点/守门员扑向点）。
 * @param zone - 区号。
 * @returns 中心坐标。
 */
export function zoneCenter(zone: Zone): { x: number; y: number } {
  const r = zoneRect(zone)
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/**
 * 命中测试：逻辑坐标落在球门哪一格。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的区号，球门外返回 null。
 */
export function zoneFromPoint(px: number, py: number): Zone | null {
  if (px < GOAL.x || px >= GOAL.x + GOAL.w || py < GOAL.y || py >= GOAL.y + GOAL.h) return null
  const row = Math.floor((py - GOAL.y) / (GOAL.h / 3))
  const col = Math.floor((px - GOAL.x) / (GOAL.w / 2))
  return (row * 2 + col) as Zone
}

/**
 * 命中测试：拖拽位置换算力度（越界自动收敛）。
 * @param px - 逻辑 x。
 * @returns 对应力度。
 */
export function powerFromPoint(px: number): number {
  const f = (px - POWER_BAR.x) / POWER_BAR.w
  return MIN_POWER + (MAX_POWER - MIN_POWER) * Math.min(1, Math.max(0, f))
}

/** 渲染阶段：罚球瞄准 / 扑救预读 / 罚球动画 / 终局（渲染按此显式分派）。 */
export type SceneMode = 'shoot' | 'read' | 'anim' | 'over'

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  /** 渲染阶段（显式分派源）。 */
  mode: SceneMode
  /** 比赛逻辑状态。 */
  state: MatchState
  /** 罚球阶段当前瞄准区。 */
  aimZone: Zone
  /** 罚球阶段当前力度。 */
  power: number
  /** 鼠标悬停的球门区（可空）。 */
  hoverZone: Zone | null
  /** 进行中的罚球动画（anim 阶段非空）：记录 + 进度 t∈[0,1]。 */
  anim: { record: KickRecord; t: number } | null
  /** 预读剩余秒数（read 阶段，<=0 表示已到时待点击）。 */
  countdown: number
  /** 累计时钟秒（脉冲动画）。 */
  clock: number
}

function ease(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 球的落点（打飞时越过横梁）。 */
function ballTarget(record: KickRecord): { x: number; y: number } {
  const c = zoneCenter(record.shot.zone)
  if (record.result === 'miss') {
    return { x: c.x + (record.shot.zone % 2 === 0 ? -18 : 18), y: GOAL.y - 34 }
  }
  return c
}

/**
 * 画足球（白圆 + 辉光 + 侧影）。
 * @param ctx - 画布上下文。
 * @param x - 中心 x。
 * @param y - 中心 y。
 */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(x + 2, y + 8, 9, 3.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f4f4f6'
  glow(ctx, '#f4f4f6', 10)
  ctx.beginPath()
  ctx.arc(x, y, 9, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = '#1e1e2a'
  ctx.beginPath()
  ctx.arc(x - 3, y - 2, 2.2, 0, Math.PI * 2)
  ctx.arc(x + 4, y + 3, 1.8, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * 画一名守门员（罚球动画中为扑救方：玩家射→AI 守，AI 射→玩家守）。
 * 从球门中心扑向所选区，带倾倒姿态。
 * @param ctx - 画布上下文。
 * @param ctx - 画布上下文。
 * @param diveZone - 扑向的区。
 * @param t - 扑救进度 0（站立）→ 1（到位）。
 * @param color - 队伍主色。
 */
function drawKeeper(ctx: CanvasRenderingContext2D, diveZone: Zone, t: number, color: string): void {
  const homeX = LOGICAL_W / 2
  const homeY = GOAL.y + GOAL.h - 10
  const c = zoneCenter(diveZone)
  const x = lerp(homeX, c.x, ease(t))
  const y = lerp(homeY, c.y + 10, ease(t))
  const dir = diveZone % 2 === 0 ? -1 : 1
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(dir * t * 0.9)
  ctx.fillStyle = color
  glow(ctx, color, 8)
  roundRectPath(ctx, -7, -12, 14, 30, 6)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = '#e8e8f0'
  ctx.beginPath()
  ctx.arc(0, -18, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(dir * (10 + 8 * t), -8 - 6 * t, 5.5, 0, Math.PI * 2)
  ctx.arc(-dir * 8, -6, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * 画球场（门线视角）：草坪条纹、门线、禁区弧、点球点。
 * @param ctx - 画布上下文。
 */
function drawField(ctx: CanvasRenderingContext2D): void {
  const top = GOAL.y + GOAL.h
  ctx.fillStyle = '#20301f'
  ctx.fillRect(0, top, LOGICAL_W, LOGICAL_H - top)
  for (let i = 0; i < 6; i += 1) {
    if (i % 2 === 0) continue
    ctx.fillStyle = 'rgba(226,226,238,0.03)'
    ctx.fillRect((i * LOGICAL_W) / 6, top, LOGICAL_W / 6, LOGICAL_H - top)
  }
  ctx.strokeStyle = 'rgba(233,233,240,0.55)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, top)
  ctx.lineTo(LOGICAL_W, top)
  ctx.stroke()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(233,233,240,0.35)'
  ctx.beginPath()
  ctx.arc(PEN_SPOT.x, GOAL.y + GOAL.h + 30, 120, 0.25 * Math.PI, 0.75 * Math.PI)
  ctx.stroke()
  ctx.fillStyle = 'rgba(233,233,240,0.5)'
  ctx.beginPath()
  ctx.arc(PEN_SPOT.x, PEN_SPOT.y, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 1
}

/**
 * 画球门：深色门内 + 球网线 + 门柱横梁 + 六区网格；按渲染阶段显式高亮：
 * shoot——瞄准格蓝亮 + 悬停淡蓝；read——预读金框脉冲；anim/over——仅网格。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawGoal(ctx: CanvasRenderingContext2D, view: SceneView): void {
  ctx.fillStyle = '#141922'
  ctx.fillRect(GOAL.x, GOAL.y, GOAL.w, GOAL.h)
  ctx.strokeStyle = 'rgba(226,226,238,0.10)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < 16; i += 1) {
    ctx.moveTo(GOAL.x + (i * GOAL.w) / 16, GOAL.y)
    ctx.lineTo(GOAL.x + (i * GOAL.w) / 16, GOAL.y + GOAL.h)
  }
  for (let i = 1; i < 8; i += 1) {
    ctx.moveTo(GOAL.x, GOAL.y + (i * GOAL.h) / 8)
    ctx.lineTo(GOAL.x + GOAL.w, GOAL.y + (i * GOAL.h) / 8)
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(226,226,238,0.22)'
  ctx.beginPath()
  ctx.moveTo(GOAL.x + GOAL.w / 2, GOAL.y)
  ctx.lineTo(GOAL.x + GOAL.w / 2, GOAL.y + GOAL.h)
  ctx.moveTo(GOAL.x, GOAL.y + GOAL.h / 3)
  ctx.lineTo(GOAL.x + GOAL.w, GOAL.y + GOAL.h / 3)
  ctx.moveTo(GOAL.x, GOAL.y + (2 * GOAL.h) / 3)
  ctx.lineTo(GOAL.x + GOAL.w, GOAL.y + (2 * GOAL.h) / 3)
  ctx.stroke()
  if (view.mode === 'shoot') {
    const aim = zoneRect(view.aimZone)
    ctx.fillStyle = 'rgba(122,162,247,0.26)'
    ctx.fillRect(aim.x + 2, aim.y + 2, aim.w - 4, aim.h - 4)
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 2
    ctx.strokeRect(aim.x + 2, aim.y + 2, aim.w - 4, aim.h - 4)
    if (view.hoverZone !== null && view.hoverZone !== view.aimZone) {
      const hov = zoneRect(view.hoverZone)
      ctx.fillStyle = 'rgba(122,162,247,0.10)'
      ctx.fillRect(hov.x + 2, hov.y + 2, hov.w - 4, hov.h - 4)
    }
  } else if (view.mode === 'read' && view.state.hint !== null) {
    const pulse = 0.5 + 0.5 * Math.sin(view.clock * 6)
    const hint = zoneRect(view.state.hint)
    ctx.fillStyle = 'rgba(224,175,104,' + (0.10 + 0.14 * pulse) + ')'
    ctx.fillRect(hint.x + 2, hint.y + 2, hint.w - 4, hint.h - 4)
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2
    ctx.strokeRect(hint.x + 2, hint.y + 2, hint.w - 4, hint.h - 4)
    if (view.hoverZone !== null) {
      const hov = zoneRect(view.hoverZone)
      ctx.strokeStyle = accent(0)
      ctx.lineWidth = 2
      ctx.strokeRect(hov.x + 3, hov.y + 3, hov.w - 6, hov.h - 6)
    }
  }
  ctx.strokeStyle = '#e8e8f0'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(GOAL.x, GOAL.y + GOAL.h + 3)
  ctx.lineTo(GOAL.x, GOAL.y)
  ctx.lineTo(GOAL.x + GOAL.w, GOAL.y)
  ctx.lineTo(GOAL.x + GOAL.w, GOAL.y + GOAL.h + 3)
  ctx.stroke()
  ctx.lineWidth = 1
}

/**
 * 画一行点球格（● 进球 / ✗ 失手 / ○ 未罚，当前脚金圈）。
 * @param ctx - 画布上下文。
 * @param state - 比赛状态。
 * @param shooter - 哪一方的一行。
 * @param y - 行基线 y。
 * @param active - 当轮是否轮到该方罚球。
 */
function drawPipRow(ctx: CanvasRenderingContext2D, state: MatchState, shooter: 'player' | 'ai', y: number, active: boolean): void {
  const kicks = state.records.filter((r) => r.shooter === shooter)
  const slots = Math.min(Math.max(REGULATION_KICKS, kicks.length + (active ? 1 : 0)), 8)
  for (let i = 0; i < slots; i += 1) {
    const cx = 64 + i * 26
    const kick = kicks[i]
    if (kick === undefined) {
      ctx.strokeStyle = active && i === kicks.length ? THEME.gold : 'rgba(226,226,238,0.3)'
      ctx.lineWidth = active && i === kicks.length ? 2 : 1
      ctx.beginPath()
      ctx.arc(cx, y - 4, 7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    } else if (kick.result === 'goal') {
      const color = shooter === 'player' ? THEME.good : THEME.bad
      ctx.fillStyle = color
      glow(ctx, color, 6)
      ctx.beginPath()
      ctx.arc(cx, y - 4, 7, 0, Math.PI * 2)
      ctx.fill()
      noGlow(ctx)
    } else {
      const color = shooter === 'player' ? THEME.bad : THEME.good
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx - 5, y - 9)
      ctx.lineTo(cx + 5, y + 1)
      ctx.moveTo(cx + 5, y - 9)
      ctx.lineTo(cx - 5, y + 1)
      ctx.stroke()
      ctx.lineWidth = 1
    }
  }
}

/**
 * 画力度滑条：蓝色安全段 / 红色风险段（超过 75%）、75% 分界刻度、旋钮。
 * @param ctx - 画布上下文。
 * @param power - 当前力度。
 */
function drawPowerBar(ctx: CanvasRenderingContext2D, power: number): void {
  const f = (power - MIN_POWER) / (MAX_POWER - MIN_POWER)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, POWER_BAR.x, POWER_BAR.y, POWER_BAR.w, POWER_BAR.h, 8)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(POWER_BAR.x + 2, POWER_BAR.y + 2, POWER_BAR.w - 4, POWER_BAR.h - 4, 6)
  ctx.clip()
  const riskF = (MISS_THRESHOLD - MIN_POWER) / (MAX_POWER - MIN_POWER)
  ctx.fillStyle = accent(0)
  ctx.fillRect(POWER_BAR.x, POWER_BAR.y, riskF * POWER_BAR.w, POWER_BAR.h)
  ctx.fillStyle = THEME.bad
  ctx.fillRect(POWER_BAR.x + riskF * POWER_BAR.w, POWER_BAR.y, POWER_BAR.w, POWER_BAR.h)
  ctx.fillStyle = 'rgba(13,13,20,' + (0.55 * (1 - f)) + ')'
  ctx.fillRect(POWER_BAR.x + f * POWER_BAR.w, POWER_BAR.y, POWER_BAR.w, POWER_BAR.h)
  ctx.restore()
  ctx.strokeStyle = 'rgba(226,226,238,0.6)'
  ctx.beginPath()
  ctx.moveTo(POWER_BAR.x + riskF * POWER_BAR.w, POWER_BAR.y - 3)
  ctx.lineTo(POWER_BAR.x + riskF * POWER_BAR.w, POWER_BAR.y + POWER_BAR.h + 3)
  ctx.stroke()
  ctx.fillStyle = '#f4f4f6'
  glow(ctx, '#f4f4f6', 8)
  ctx.beginPath()
  ctx.arc(POWER_BAR.x + f * POWER_BAR.w, POWER_BAR.y + POWER_BAR.h / 2, 7, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
}

/** 结果文案（玩家视角配色）。 */
function resultText(record: KickRecord): { text: string; color: string } {
  if (record.shooter === 'player') {
    if (record.result === 'goal') return { text: '进球！', color: THEME.good }
    if (record.result === 'saved') return { text: '被扑出！', color: THEME.bad }
    return { text: '打飞了！', color: THEME.bad }
  }
  if (record.result === 'goal') return { text: 'AI 得分', color: THEME.bad }
  if (record.result === 'saved') return { text: '扑出！', color: THEME.good }
  return { text: 'AI 打飞', color: THEME.gold }
}

/**
 * 整帧绘制：背景 + HUD + 点球格 + 球门 + 球场 + 守门员/球（按阶段显式
 * 分派）+ 力度滑条 + 阶段提示 + 说明按钮与帮助面板（末尾最上层）。
 * overlay 由 index 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen = false): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  const state = view.state

  // HUD 带 y26：左比分、中阶段（居中）、右轮次（右锚）。
  hudPair(ctx, 16, 26, '比分', state.playerGoals + ' : ' + state.aiGoals)
  ctx.font = '600 13px ' + FONT
  ctx.textAlign = 'center'
  const roundText = state.suddenDeath ? '骤死 · 第 ' + state.round + ' 组' : '第 ' + state.round + '/' + REGULATION_KICKS + ' 组'
  if (view.mode === 'shoot') {
    ctx.fillStyle = accent(0)
    ctx.fillText('你罚球 · 选格调力后空格射门', LOGICAL_W / 2, 26)
  } else if (view.mode === 'read') {
    ctx.fillStyle = THEME.gold
    ctx.fillText('AI 罚球 · 站位预读', LOGICAL_W / 2, 26)
  } else if (view.mode === 'anim') {
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(roundText, LOGICAL_W / 2, 26)
  } else {
    ctx.fillStyle = state.outcome === 'win' ? THEME.good : THEME.bad
    ctx.fillText(state.outcome === 'win' ? '你赢了 ' + roundText : '你输了 ' + roundText, LOGICAL_W / 2, 26)
  }
  hudPair(ctx, LOGICAL_W - 16, 26, '轮次', roundText, 'right')

  // 点球格两行 y58/y82：左标签 + 右统计（右锚）。
  ctx.font = '600 13px ' + FONT
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  ctx.fillText('你', 16, 58)
  ctx.fillText('电脑', 16, 82)
  drawPipRow(ctx, state, 'player', 58, view.mode === 'shoot')
  drawPipRow(ctx, state, 'ai', 82, view.mode === 'read')
  const aiKicks = state.records.filter((r) => r.shooter === 'ai').length
  hudPair(ctx, LOGICAL_W - 16, 58, '扑救', state.playerSaves + '/' + aiKicks, 'right', THEME.gold)
  const playerKicks = state.records.filter((r) => r.shooter === 'player').length
  const playerGoalsN = state.records.filter((r) => r.shooter === 'player' && r.result === 'goal').length
  hudPair(ctx, LOGICAL_W - 16, 82, '命中', playerGoalsN + '/' + playerKicks, 'right')

  drawGoal(ctx, view)
  drawField(ctx)

  // 守门员与球：按渲染阶段显式三分（未进行/进行中/已结束静止帧）。
  if (view.anim !== null) {
    const record = view.anim.record
    const t = Math.min(1, view.anim.t)
    drawKeeper(ctx, record.counter, t, record.shooter === 'player' ? THEME.bad : accent(0))
    const target = ballTarget(record)
    const bx = lerp(PEN_SPOT.x, target.x, ease(t))
    const by = lerp(PEN_SPOT.y, target.y, ease(t)) - Math.sin(Math.PI * t) * 70
    drawBall(ctx, bx, by)
    if (t >= 0.75) {
      const rt = resultText(record)
      ctx.textAlign = 'center'
      ctx.font = 'bold 22px ' + FONT
      ctx.fillStyle = rt.color
      ctx.fillText(rt.text, LOGICAL_W / 2, 330)
      ctx.font = '600 13px ' + FONT
    }
  } else {
    drawKeeper(ctx, 2, 0, view.mode === 'read' ? accent(0) : THEME.bad)
    drawBall(ctx, PEN_SPOT.x, PEN_SPOT.y)
  }

  // 预读倒计时 / 预读提示文本（read 阶段独占 y292 带）。
  if (view.mode === 'read') {
    ctx.textAlign = 'center'
    ctx.font = '600 16px ' + FONT
    ctx.fillStyle = THEME.gold
    if (view.countdown > 0) {
      ctx.fillText('站位预读 ' + view.countdown.toFixed(1) + 's', LOGICAL_W / 2, 292)
    } else {
      ctx.fillText('点击球门一格扑救！', LOGICAL_W / 2, 292)
    }
    ctx.font = '600 13px ' + FONT
  }

  // 力度滑条（仅罚球瞄准阶段）。
  if (view.mode === 'shoot') {
    drawPowerBar(ctx, view.power)
    ctx.textAlign = 'right'
    ctx.font = '600 13px ' + FONT
    ctx.fillStyle = view.power > MISS_THRESHOLD ? THEME.bad : THEME.textMuted
    ctx.fillText('力度', POWER_BAR.x - 8, POWER_BAR.y + 13)
    ctx.textAlign = 'left'
    ctx.fillStyle = view.power > MISS_THRESHOLD ? THEME.bad : THEME.text
    ctx.fillText(Math.round(view.power * 100) + '%', POWER_BAR.x + POWER_BAR.w + 10, POWER_BAR.y + 13)
  }

  // 底部提示带 y540（居中）。
  ctx.textAlign = 'center'
  ctx.font = '600 13px ' + FONT
  ctx.fillStyle = THEME.textMuted
  if (view.mode === 'shoot') {
    ctx.fillText('←→↑↓/点击球门选格 · 拖滑条/W S 调力度 · 空格射门', LOGICAL_W / 2, 540)
  } else if (view.mode === 'read') {
    ctx.fillText('金色格为 AI 热区预读 · 点击球门一格扑救', LOGICAL_W / 2, 540)
  } else if (view.mode === 'over') {
    ctx.fillStyle = THEME.text
    ctx.fillText('按 R 或点击任意处重开', LOGICAL_W / 2, 540)
  }

  // 说明按钮（60x24，任何阶段可点，画在渲染末尾最上层）。
  const hb = HELP_BTN
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 8)
  ctx.fill()
  ctx.strokeStyle = helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px ' + FONT
  ctx.fillStyle = helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 16)

  // 帮助面板（最上层，仅 helpOpen 时）。
  if (helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.92)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 15px ' + FONT
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 14, HELP_PANEL.y + 28 + i * 23)
    })
  }
}
