/**
 * 密码转盘画布渲染：黄铜双环转轮（外环密文字母、内环随偏移转动的明文
 * 环）、密文卷轴（提示揭示的字母绿色显示）、频率直方图（密文频率 vs
 * 英文常见频率金色刻度）、解码预览框、密钥参数行、关卡/提示/得分 HUD、
 * 提交与提示按钮、说明按钮 + 帮助面板（渲染末尾最上层）与结束遮罩。
 * 全部为无状态绘制：闪烁与帮助开关由调用方（index.ts）传入。
 */
import type { CipherWheelState } from './logic.ts'
import { AFFINE_MULTIPLIERS, ENGLISH_FREQ, LEVELS, decryptPreview, letterCounts, revealedAt } from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 680
export const LOGICAL_H = 520

// —— 布局常量（矩形两两不相交，见提交报告核算） ——
/** 转轮面板。 */
const WHEEL = { x: 16, y: 44, w: 280, h: 280 }
/** 转轮圆心。 */
const CENTER = { x: 156, y: 184 }
/** 外环密文字母半径。 */
const R_OUTER = 104
/** 内环明文字母半径。 */
const R_INNER = 74
/** 中央读数圆半径。 */
const R_HUB = 46
/** 密钥槽 / 仿射芯片面板。 */
const KEYPanel = { x: 16, y: 336, w: 280, h: 64 }
/** 密文卷轴。 */
const SCROLL = { x: 312, y: 44, w: 352, h: 124 }
/** 频率直方图。 */
const FREQ = { x: 312, y: 184, w: 352, h: 150 }
/** 解码预览框。 */
const PREVIEW = { x: 312, y: 350, w: 352, h: 56 }
/** 提交按钮。 */
const SUBMIT = { x: 312, y: 416, w: 72, h: 34 }
/** 提示按钮。 */
const HINT = { x: 396, y: 416, w: 56, h: 34 }
/** 说明按钮（60x24，最上层）。 */
const HELP = { x: 604, y: 466, w: 60, h: 24 }
/** 帮助面板。 */
const HELP_PANEL = { x: 90, y: 70, w: 500, h: 380 }

/** 每行密文字符步进（等宽字体定宽排布，不错位）。 */
const CHAR_STEP = 14
/** 密文每行字符数（按卷轴内宽定死）。 */
const CHARS_PER_ROW = 23

/** 渲染所需的运行时输入（由 index.ts 持有）。 */
export interface CipherRenderOpts {
  paused: boolean
  /** 提交反馈闪烁：'none' 无，'good' 绿，'bad' 红。 */
  flash: 'none' | 'good' | 'bad'
  /** 帮助面板是否打开（任何阶段可开合）。 */
  helpOpen: boolean
  /** 是否正在拖动转轮（高亮转轮边缘）。 */
  dragging: boolean
}

/** 命中转轮面板（拖动调整偏移）。 */
export function wheelAt(x: number, y: number): boolean {
  return x >= WHEEL.x && x <= WHEEL.x + WHEEL.w && y >= WHEEL.y && y <= WHEEL.y + WHEEL.h
}

/** 命中转轮外环字母带，返回字母序号（0..25），未命中为 null。 */
export function wheelLetterAt(x: number, y: number): number | null {
  const dx = x - CENTER.x
  const dy = y - CENTER.y
  const r = Math.hypot(dx, dy)
  if (r < R_INNER - 10 || r > R_OUTER + 10) return null
  let ang = Math.atan2(dy, dx) + Math.PI / 2
  ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const step = (Math.PI * 2) / 26
  return Math.round(ang / step) % 26
}

/** 命中维吉尼亚密钥槽，返回槽索引，未命中为 null。 */
export function slotAt(x: number, y: number, slotCount: number): number | null {
  if (slotCount <= 0) return null
  const step = 46
  const startX = KEYPanel.x + (KEYPanel.w - slotCount * step + 6) / 2
  for (let i = 0; i < slotCount; i += 1) {
    const sx = startX + i * step
    if (x >= sx && x <= sx + 40 && y >= KEYPanel.y + 10 && y <= KEYPanel.y + 50) return i
  }
  return null
}

/** 命中仿射乘数芯片，返回芯片下标，未命中为 null。 */
export function aChipAt(x: number, y: number): number | null {
  for (let i = 0; i < AFFINE_MULTIPLIERS.length; i += 1) {
    const cx = KEYPanel.x + 8 + i * 22
    if (x >= cx && x <= cx + 20 && y >= KEYPanel.y + 22 && y <= KEYPanel.y + 44) return i
  }
  return null
}

/** 命中提交按钮。 */
export function submitAt(x: number, y: number): boolean {
  return x >= SUBMIT.x && x <= SUBMIT.x + SUBMIT.w && y >= SUBMIT.y && y <= SUBMIT.y + SUBMIT.h
}

/** 命中提示按钮。 */
export function hintAt(x: number, y: number): boolean {
  return x >= HINT.x && x <= HINT.x + HINT.w && y >= HINT.y && y <= HINT.y + HINT.h
}

/** 命中说明按钮（60x24）。 */
export function helpAt(x: number, y: number): boolean {
  return x >= HELP.x && x <= HELP.x + HELP.w && y >= HELP.y && y <= HELP.y + HELP.h
}

/**
 * 绘制一帧。
 * @param ctx - 画布上下文（逻辑坐标已由 fitCanvas 变换）。
 * @param state - 游戏状态。
 * @param opts - 运行时渲染输入。
 */
export function renderCipherWheel(ctx: CanvasRenderingContext2D, state: CipherWheelState, opts: CipherRenderOpts): void {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  const cfg = LEVELS[state.level] ?? LEVELS[0]!

  // HUD：关卡 / 提示 / 得分。
  hudPair(ctx, 16, 26, '关卡 ', (state.level + 1) + '/' + LEVELS.length)
  hudPair(ctx, 300, 26, '提示 ', state.hintsUsed + '/2')
  hudPair(ctx, LOGICAL_W - 16, 26, '得分 ', String(state.score), 'right', THEME.gold)

  drawWheel(ctx, state, opts)
  drawKeyPanel(ctx, state)
  drawScroll(ctx, state)
  if (cfg.freqChart) drawFreqChart(ctx, state)
  else drawNoChartNote(ctx)
  drawPreview(ctx, state, opts)
  drawButtons(ctx, state, opts)
  drawRevealedLegend(ctx, state)

  ctx.textBaseline = 'alphabetic'
  if (state.phase === 'won') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '密码大师', '五关全破 · 得分 ' + state.score + ' · 按 R 重开', THEME.gold)
  } else if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续', THEME.text)
  }

  // 说明按钮与帮助面板画在渲染函数末尾，位于一切之上。
  drawHelp(ctx, opts)
}

/** 黄铜转轮：外环密文字母（固定）、内环明文环（随偏移转动）、中央读数。 */
function drawWheel(ctx: CanvasRenderingContext2D, state: CipherWheelState, opts: CipherRenderOpts): void {
  const edge = opts.dragging ? THEME.gold : THEME.panelEdge
  glow(ctx, edge, opts.dragging ? 14 : 4)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, WHEEL.x, WHEEL.y, WHEEL.w, WHEEL.h, 14)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = edge
  ctx.lineWidth = 1.5
  ctx.stroke()

  const kind = state.challenge.kind
  const offset = kind === 'vigenere'
    ? (state.wheel.keyOffsets[state.wheel.selectedSlot] ?? 0)
    : state.wheel.shift

  // 外环（黄铜字母环）：密文字母固定排布。
  glow(ctx, THEME.gold, 6)
  ctx.beginPath()
  ctx.arc(CENTER.x, CENTER.y, R_OUTER + 8, 0, Math.PI * 2)
  ctx.fillStyle = '#2a2318'
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(CENTER.x, CENTER.y, R_OUTER - 12, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(224,175,104,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const step = (Math.PI * 2) / 26
  for (let i = 0; i < 26; i += 1) {
    const ang = -Math.PI / 2 + i * step
    ctx.fillStyle = THEME.text
    ctx.fillText(String.fromCharCode(65 + i), CENTER.x + Math.cos(ang) * R_OUTER, CENTER.y + Math.sin(ang) * R_OUTER + 1)
  }

  // 内环：明文字母环，整体旋转 offset 格。
  ctx.beginPath()
  ctx.arc(CENTER.x, CENTER.y, R_INNER + 10, 0, Math.PI * 2)
  ctx.strokeStyle = accent(2)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  for (let i = 0; i < 26; i += 1) {
    const ang = -Math.PI / 2 + (((i - offset) % 26) + 26) % 26 * step
    ctx.fillStyle = accent(2)
    ctx.fillText(String.fromCharCode(65 + i), CENTER.x + Math.cos(ang) * R_INNER, CENTER.y + Math.sin(ang) * R_INNER + 1)
  }

  // 顶部指针。
  ctx.fillStyle = THEME.bad
  ctx.beginPath()
  ctx.moveTo(CENTER.x, CENTER.y - R_OUTER + 2)
  ctx.lineTo(CENTER.x - 6, CENTER.y - R_OUTER - 10)
  ctx.lineTo(CENTER.x + 6, CENTER.y - R_OUTER - 10)
  ctx.closePath()
  ctx.fill()

  // 中央读数圆：类型相关偏移 + 数字缓冲。
  glow(ctx, THEME.gold, 8)
  ctx.beginPath()
  ctx.arc(CENTER.x, CENTER.y, R_HUB, 0, Math.PI * 2)
  ctx.fillStyle = '#1c1a26'
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.fillStyle = THEME.gold
  const label = kind === 'affine'
    ? 'a=' + state.wheel.multiplier + ' b=' + offset
    : kind === 'vigenere'
      ? '槽' + (state.wheel.selectedSlot + 1) + ' +' + offset
      : '+' + offset
  ctx.fillText(label, CENTER.x, CENTER.y - 8)
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = state.wheel.digitBuffer === '' ? THEME.textMuted : accent(0)
  ctx.fillText(state.wheel.digitBuffer === '' ? '拖/↑↓/数字' : '键入 ' + state.wheel.digitBuffer, CENTER.x, CENTER.y + 16)
  ctx.textBaseline = 'alphabetic'

  // 维吉尼亚：指示选中槽对应的转轮。
  if (kind === 'vigenere') {
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('转轮当前控制选中密钥槽', CENTER.x, WHEEL.y + WHEEL.h - 10)
  }
}

/** 密钥面板：维吉尼亚密钥槽（可点选）/ 仿射互质芯片 / 凯撒提示文案。 */
function drawKeyPanel(ctx: CanvasRenderingContext2D, state: CipherWheelState): void {
  const cfg = LEVELS[state.level] ?? LEVELS[0]!
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, KEYPanel.x, KEYPanel.y, KEYPanel.w, KEYPanel.h, 10)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  const kind = state.challenge.kind
  if (kind === 'vigenere') {
    const n = state.wheel.keyOffsets.length
    const stepV = 46
    const startX = KEYPanel.x + (KEYPanel.w - n * stepV + 6) / 2
    for (let i = 0; i < n; i += 1) {
      const sx = startX + i * stepV
      const selected = i === state.wheel.selectedSlot
      const color = selected ? THEME.gold : accent(i % 8)
      glow(ctx, color, selected ? 10 : 3)
      ctx.fillStyle = selected ? 'rgba(224,175,104,0.16)' : THEME.panel
      roundRectPath(ctx, sx, KEYPanel.y + 10, 40, 40, 8)
      ctx.fill()
      noGlow(ctx)
      ctx.strokeStyle = color
      ctx.lineWidth = selected ? 2 : 1
      ctx.stroke()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 16px system-ui, sans-serif'
      ctx.fillStyle = selected ? THEME.gold : THEME.text
      ctx.fillText(String.fromCharCode(65 + (state.wheel.keyOffsets[i] ?? 0)), sx + 20, KEYPanel.y + 30)
    }
    ctx.textBaseline = 'alphabetic'
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('密钥长 ' + cfg.keyLen + ' · 点击选槽，←→ 切换', KEYPanel.x + 8, KEYPanel.y + 60)
  } else if (kind === 'affine') {
    for (let i = 0; i < AFFINE_MULTIPLIERS.length; i += 1) {
      const m = AFFINE_MULTIPLIERS[i]!
      const cx = KEYPanel.x + 8 + i * 22
      const selected = m === state.wheel.multiplier
      ctx.fillStyle = selected ? 'rgba(224,175,104,0.2)' : THEME.panel
      roundRectPath(ctx, cx, KEYPanel.y + 22, 20, 22, 5)
      ctx.fill()
      ctx.strokeStyle = selected ? THEME.gold : THEME.panelEdge
      ctx.lineWidth = selected ? 2 : 1
      ctx.stroke()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillStyle = selected ? THEME.gold : THEME.textMuted
      ctx.fillText(String(m), cx + 10, KEYPanel.y + 34)
    }
    ctx.textBaseline = 'alphabetic'
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('乘数 a（点击选择） · 转轮管 b', KEYPanel.x + 8, KEYPanel.y + 16)
  } else {
    ctx.textAlign = 'left'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('凯撒密码：整段同移——对齐转轮，E 高频常是突破口', KEYPanel.x + 10, KEYPanel.y + 38)
  }
}

/** 密文卷轴：等宽定宽字母行；提示揭示的字母以绿色明文显示，未解灰色。 */
function drawScroll(ctx: CanvasRenderingContext2D, state: CipherWheelState): void {
  const cfg = LEVELS[state.level] ?? LEVELS[0]!
  glow(ctx, THEME.panelEdge, 4)
  ctx.fillStyle = '#1d1a15'
  roundRectPath(ctx, SCROLL.x, SCROLL.y, SCROLL.w, SCROLL.h, 12)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.gold
  const header = cfg.kind === 'vigenere' ? cfg.name + ' · 密钥长 ' + cfg.keyLen : cfg.name + ' 移位密码'
  ctx.fillText('密文 · ' + header, SCROLL.x + 14, SCROLL.y + 22)
  ctx.font = 'bold 15px monospace'
  const chars = [...state.challenge.cipherText]
  const rows = Math.ceil(chars.length / CHARS_PER_ROW)
  const startY = SCROLL.y + 56
  for (let i = 0; i < chars.length; i += 1) {
    const row = Math.floor(i / CHARS_PER_ROW)
    const col = i % CHARS_PER_ROW
    const rowX = SCROLL.x + (SCROLL.w - Math.min(chars.length - row * CHARS_PER_ROW, CHARS_PER_ROW) * CHAR_STEP) / 2
    const x = rowX + col * CHAR_STEP
    const y = startY + row * 20
    const solved = revealedAt(state, i)
    ctx.fillStyle = solved === null ? 'rgba(226,226,238,0.62)' : THEME.good
    ctx.fillText(solved === null ? chars[i]! : solved, x, y)
  }
}

/** 频率直方图：密文字母频率柱 vs 英文常见频率金色刻度。 */
function drawFreqChart(ctx: CanvasRenderingContext2D, state: CipherWheelState): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, FREQ.x, FREQ.y, FREQ.w, FREQ.h, 10)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('频率分析', FREQ.x + 14, FREQ.y + 20)
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.fillStyle = THEME.gold
  ctx.fillText('金色刻度 = 英文常见频率', FREQ.x + 78, FREQ.y + 20)

  const counts = letterCounts(state.challenge.cipherText)
  const total = state.challenge.cipherText.length
  let maxPct = 12
  for (let i = 0; i < 26; i += 1) {
    const pct = total > 0 ? (counts[i]! * 100) / total : 0
    if (pct > maxPct) maxPct = pct
  }
  const chartX = FREQ.x + 16
  const chartW = FREQ.w - 32
  const barStep = chartW / 26
  const barW = barStep - 1.5
  const baseY = FREQ.y + 118
  const chartH = 78
  for (let i = 0; i < 26; i += 1) {
    const pct = total > 0 ? (counts[i]! * 100) / total : 0
    const h = Math.max(pct > 0 ? 2 : 0, (pct / maxPct) * chartH)
    ctx.fillStyle = accent(i % 8)
    ctx.fillRect(chartX + i * barStep, baseY - h, barW, h)
    // 英文参考刻度。
    const refY = baseY - (ENGLISH_FREQ[i]! / maxPct) * chartH
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(chartX + i * barStep, refY)
    ctx.lineTo(chartX + i * barStep + barW, refY)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = '600 9px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(String.fromCharCode(65 + i), chartX + i * barStep + barW / 2, baseY + 12)
  }
}

/** 第 5 关硬模式：不画频率图，给出提示语。 */
function drawNoChartNote(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, FREQ.x, FREQ.y, FREQ.w, FREQ.h, 10)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.fillStyle = THEME.bad
  ctx.fillText('硬模式 · 频率分析不可用', FREQ.x + FREQ.w / 2, FREQ.y + 70)
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('只靠转轮直觉与提示破译', FREQ.x + FREQ.w / 2, FREQ.y + 96)
}

/** 解码预览框：按当前转轮实时解出的明文（等宽定宽）。 */
function drawPreview(ctx: CanvasRenderingContext2D, state: CipherWheelState, opts: CipherRenderOpts): void {
  const edge = opts.flash === 'good' ? THEME.good : opts.flash === 'bad' ? THEME.bad : THEME.panelEdge
  glow(ctx, edge, opts.flash === 'none' ? 4 : 12)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h, 10)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = edge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('解码预览', PREVIEW.x + 14, PREVIEW.y + 20)

  const kind = state.challenge.kind
  const param = kind === 'affine'
    ? 'a=' + state.wheel.multiplier + ' b=' + state.wheel.shift
    : kind === 'vigenere'
      ? '钥匙=' + state.wheel.keyOffsets.map((k) => String.fromCharCode(65 + k)).join('')
      : '偏移=' + state.wheel.shift
  ctx.textAlign = 'right'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = accent(1)
  ctx.fillText(param, PREVIEW.x + PREVIEW.w - 14, PREVIEW.y + 20)

  // 动态文本定宽步进排布，参数行右锚不与预览字母重叠。
  ctx.textAlign = 'left'
  ctx.font = 'bold 15px monospace'
  ctx.fillStyle = accent(5)
  const preview = decryptPreview(state.challenge, state.wheel)
  const chars = [...preview]
  const rows = Math.ceil(chars.length / CHARS_PER_ROW)
  for (let i = 0; i < chars.length; i += 1) {
    const row = Math.floor(i / CHARS_PER_ROW)
    const col = i % CHARS_PER_ROW
    const rowX = PREVIEW.x + (PREVIEW.w - Math.min(chars.length - row * CHARS_PER_ROW, CHARS_PER_ROW) * CHAR_STEP) / 2
    ctx.fillText(chars[i]!, rowX + col * CHAR_STEP, PREVIEW.y + 42)
  }
}

/** 底部按钮与状态文字。 */
function drawButtons(ctx: CanvasRenderingContext2D, state: CipherWheelState, opts: CipherRenderOpts): void {
  drawBtn(ctx, SUBMIT, '提交', THEME.good, opts.flash === 'good')
  const hintLeft = state.hintsUsed < 2
  drawBtn(ctx, HINT, '提示', hintLeft ? accent(1) : THEME.panelEdge, false)
  ctx.textAlign = 'left'
  ctx.font = '600 13px system-ui, sans-serif'
  const status = state.phase === 'won'
    ? '通关！'
    : opts.flash === 'good' ? '正确！进入下一关'
      : opts.flash === 'bad' ? '还不对，再转转'
        : 'Enter 提交 · H 提示'
  ctx.fillStyle = opts.flash === 'bad' ? THEME.bad : opts.flash === 'good' ? THEME.good : THEME.textMuted
  ctx.fillText(status, HINT.x + HINT.w + 16, SUBMIT.y + 22)
}

/** 一个圆角按钮。 */
function drawBtn(ctx: CanvasRenderingContext2D, rect: { x: number, y: number, w: number, h: number }, label: string, color: string, bright: boolean): void {
  glow(ctx, color, bright ? 14 : 5)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 8)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = color
  ctx.lineWidth = bright ? 2 : 1.2
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 14px system-ui, sans-serif'
  ctx.fillStyle = color
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

/** 已揭示映射图例（提示结果，绿色箭头）。 */
function drawRevealedLegend(ctx: CanvasRenderingContext2D, state: CipherWheelState): void {
  ctx.textAlign = 'left'
  ctx.font = '600 13px system-ui, sans-serif'
  if (state.revealed.length === 0) {
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('H 提示：揭示一个密文字母的明文对照（每关限 2 次）', 16, 488)
    return
  }
  const text = state.revealed.map((p) => p.from + '→' + p.to).join('  ')
  ctx.fillStyle = THEME.good
  ctx.fillText('已揭示  ' + text, 16, 488)
}

/** 说明按钮（60x24）与帮助面板（渲染末尾、最上层，任何阶段可开合）。 */
function drawHelp(ctx: CanvasRenderingContext2D, opts: CipherRenderOpts): void {
  if (!opts.helpOpen) {
    drawBtn(ctx, HELP, '说明', accent(0), false)
    return
  }
  ctx.fillStyle = 'rgba(13,13,20,0.78)'
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  glow(ctx, accent(0), 12)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 14)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = accent(0)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 18px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('密码转盘 · 玩法说明', HELP_PANEL.x + HELP_PANEL.w / 2, HELP_PANEL.y + 42)
  ctx.textAlign = 'left'
  ctx.font = '600 15px system-ui, sans-serif'
  const lines = [
    '每关密文由凯撒 / 仿射 / 维吉尼亚之一加密',
    '拖转轮或 ↑↓、数字键设偏移，预览实时更新',
    '维吉尼亚：点击 / ←→ 选槽，逐槽设偏移',
    '仿射：点互质芯片选 a，转轮控制移位 b',
    '频率图金色刻度=英文常见频率，高频对齐 E/T',
    'H 揭示一个字母对照（限 2 次，每次扣 15 分）',
    'Enter 提交：解对过关计分，共 5 关递进',
    '易误解：维吉尼亚每槽只管轮到它的字母',
  ]
  lines.forEach((line, i) => {
    ctx.fillStyle = i === lines.length - 1 ? THEME.gold : THEME.text
    ctx.fillText(line, HELP_PANEL.x + 28, HELP_PANEL.y + 84 + i * 30)
  })
  ctx.textAlign = 'center'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点击任意处或「说明」按钮关闭', HELP_PANEL.x + HELP_PANEL.w / 2, HELP_PANEL.y + HELP_PANEL.h - 20)
  // 关闭态按钮画在面板之上，保持可点击关闭。
  drawBtn(ctx, HELP, '说明', accent(0), true)
}
