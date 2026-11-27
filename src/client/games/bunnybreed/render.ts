/**
 * 兔子育种 BunnyBreed 渲染层：农场兔舍 4x2 卡位（兔头+基因型徽章、
 * 选中高亮连线、达标金环）、右上育种目标与 Punnett 子代概率预览
 * （按选中数 0/1/2 显式分支）、容量/代数 HUD、配种/放归按钮与说明
 * 按钮 + 帮助面板（渲染末尾最上层）。纯绘制，无状态。
 *
 * 布局核算（720x560 逻辑画布，两两不相交、不越界）：
 * - HUD 行基线 y26：左「关卡」x16 左锚、中「容量」x246 居中、右「剩余」
 *   x704 右锚，三段文本净距 ≥120px。
 * - 兔舍面板 16-476 x 48-500；兔卡 4x2（卡 105x214、列距 8、行距 8，
 *   卡中心横距 113px，卡内居中文本宽 ≤90px，同带相邻卡净距 ≥23px；
 *   基因型徽章（卡顶+152 基线）与表现型文本（卡顶+184）不同水平带。
 * - 目标面板 480-704 x 48-180；Punnett 预览面板 480-704 x 192-484
 *   （行内基因型 x492 左锚、概率 x692 右锚，净距 ≥100px）。
 * - 底部按钮带 y520-548：配种 16-104、放归 112-200；提示文本居中 x400
 *   （约 300-500，与按钮矩形净距 ≥100px）；说明按钮 644-704 x 528-552。
 * - 帮助面板 80-640 x 250-530（仅打开时叠加，最上层）。
 * 无反引号模板字符串。
 */
import type { Genes, LevelData, OffspringStat, Rabbit } from './logic.ts'
import { phenotype } from './logic.ts'
import { accent, drawBackground, glow, hudPair, noGlow, roundRectPath, THEME } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 720
export const LOGICAL_H = 560

/** 通用矩形（逻辑坐标）。 */
interface Rect { x: number; y: number; w: number; h: number }

/** 兔舍面板矩形（逻辑坐标）。 */
const PEN: Rect = { x: 16, y: 48, w: 460, h: 452 }
/** 兔卡网格：4 列 x 2 行，卡 105x214，含 8px 边距与间隙。 */
const CARD_W = 105
const CARD_H = 214
const CARD_GAP = 8
/** 目标面板矩形。 */
const TARGET_PANEL: Rect = { x: 480, y: 48, w: 224, h: 132 }
/** Punnett 子代预览面板矩形。 */
const PREVIEW_PANEL: Rect = { x: 480, y: 192, w: 224, h: 292 }
/** 配种按钮矩形（左下）。 */
export const BREED_BTN = { x: 16, y: 520, w: 88, h: 28 }
/** 放归按钮矩形（配种按钮右侧）。 */
export const RELEASE_BTN = { x: 112, y: 520, w: 88, h: 28 }
/** 说明按钮矩形（右下角，60x24）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: LOGICAL_H - 32, w: 60, h: 24 }

/** 帮助面板矩形。 */
const HELP_PANEL = { x: 80, y: 250, w: 560, h: 280 }
/** 帮助面板文案（15px 大字，完整规则 + 易误解点）。 */
const HELP_LINES = [
  '玩法速览',
  '· 每只兔两个基因座：毛色 B 黑显 / b 褐隐、毛型 S 短显 / s 长隐（如 Bb Ss）',
  '· 点选两只亲本 → 「配种」：每窝 4 仔按 Punnett 16 格等概率分离组合',
  '· 右侧预览实时显示这对亲本子代各基因型的概率——先算后配，不靠运气',
  '· 目标按关卡指定（基因型或表现型）；第 5 关需两只指定兔同时在舍',
  '· 空位不足 4 仔时先点兔选中、再「放归」腾位——放归的兔不可找回',
  '· 易误解：表现型看不出杂合——Bb 是黑毛但藏着 b，纯种要看基因型徽章',
  '· R 重开本关 · P 暂停 · 代数预算用尽未达标判负 · 过关自动进下一关',
]

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  /** 关卡数据（容量、目标）。 */
  data: LevelData
  /** 在场兔子（槽位顺序）。 */
  rabbits: Rabbit[]
  /** 已选亲本 id 列表（0-2 个）。 */
  selected: number[]
  /** 选中亲本数量（预览面板按 0/1/2 显式分支）。 */
  selectedCount: number
  /** 两亲本已选时的子代概率表（否则 null）。 */
  punnett: OffspringStat[] | null
  /** HUD 关卡值（如 1/5）。 */
  hudLevel: string
  /** 在场兔数。 */
  count: number
  /** 剩余代数。 */
  genLeft: number
  /** 配种按钮是否可用（2 亲本 + 空位足 + 进行中）。 */
  breedEnabled: boolean
  /** 放归按钮是否可用（恰好 1 只选中 + 进行中）。 */
  releaseEnabled: boolean
  /** 兔子是否匹配目标（含双目标任一条），与兔一一对应。 */
  matchFlags: boolean[]
}

/**
 * 兔卡槽位矩形（4 列 x 2 行）。
 * @param slot - 0 起槽位下标。
 * @returns 卡片矩形。
 */
function cardRect(slot: number): Rect {
  const col = slot % 4
  const row = Math.floor(slot / 4)
  return { x: 24 + col * (CARD_W + CARD_GAP), y: 56 + row * (CARD_H + CARD_GAP), w: CARD_W, h: CARD_H }
}

/**
 * 命中测试：逻辑坐标转兔卡槽位。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的槽位下标（未命中为 null）。
 */
export function rabbitSlotAt(px: number, py: number): number | null {
  const col = Math.floor((px - 24) / (CARD_W + CARD_GAP))
  const row = Math.floor((py - 56) / (CARD_H + CARD_GAP))
  if (col < 0 || row < 0 || col > 3 || row > 1) return null
  const r = cardRect(row * 4 + col)
  if (px < r.x || py < r.y || px > r.x + r.w || py > r.y + r.h) return null
  return row * 4 + col
}

/** 毛色规格标签。 */
function colorSpecLabel(spec: string): string {
  if (spec === 'BB') return 'BB 纯合黑'
  if (spec === 'Bb') return 'Bb 杂合黑'
  if (spec === 'bb') return 'bb 纯合褐'
  if (spec === 'black') return '黑（BB/Bb）'
  return '任意'
}

/** 毛型规格标签。 */
function furSpecLabel(spec: string): string {
  if (spec === 'SS') return 'SS 纯合短'
  if (spec === 'Ss') return 'Ss 杂合短'
  if (spec === 'ss') return 'ss 纯合长'
  if (spec === 'short') return '短（SS/Ss）'
  return '任意'
}

/**
 * 目标面板文本行（单目标 2 行 + 注 / 双目标 4 行）。
 * @param data - 关卡数据。
 * @returns 文本行列表。
 */
function targetLines(data: LevelData): string[] {
  const c1 = colorSpecLabel(data.target.color)
  const f1 = furSpecLabel(data.target.fur)
  if (data.target2 === null) return ['毛色：' + c1, '毛型：' + f1]
  const c2 = colorSpecLabel(data.target2.color)
  const f2 = furSpecLabel(data.target2.fur)
  return ['其一 毛色：' + c1, '其一 毛型：' + f1, '其二 毛色：' + c2, '其二 毛型：' + f2]
}

/**
 * 画兔头：耳 + 头圆 + 眼鼻，毛色按表现型、长毛加蓬松虚线圈。
 * @param ctx - 画布上下文。
 * @param cx - 头心 x。
 * @param cy - 头心 y。
 * @param genes - 基因型。
 */
function drawBunnyHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, genes: Genes): void {
  const ph = phenotype(genes)
  const body = ph.black ? '#4a4a62' : '#a8703f'
  const edge = ph.black ? '#7a7a9c' : '#d09a62'
  // 长毛：蓬松虚线圈（显式分支，短毛不画）。
  if (ph.longFur) {
    ctx.save()
    ctx.strokeStyle = 'rgba(226,226,238,0.4)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(cx, cy, 27, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  // 双耳（圆角胶囊）+ 耳内粉。
  ctx.fillStyle = body
  roundRectPath(ctx, cx - 15, cy - 46, 10, 30, 5)
  ctx.fill()
  roundRectPath(ctx, cx + 5, cy - 46, 10, 30, 5)
  ctx.fill()
  ctx.fillStyle = '#e8a0a8'
  roundRectPath(ctx, cx - 12.5, cy - 41, 5, 18, 2.5)
  ctx.fill()
  roundRectPath(ctx, cx + 7.5, cy - 41, 5, 18, 2.5)
  ctx.fill()
  // 头圆。
  ctx.fillStyle = body
  glow(ctx, body, 8)
  ctx.beginPath()
  ctx.arc(cx, cy, 20, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = edge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  // 眼 + 鼻。
  ctx.fillStyle = '#e2e2ee'
  ctx.beginPath()
  ctx.arc(cx - 7, cy - 4, 2.6, 0, Math.PI * 2)
  ctx.moveTo(cx + 4.4, cy - 4)
  ctx.arc(cx + 7, cy - 4, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1e1e2a'
  ctx.beginPath()
  ctx.arc(cx - 7, cy - 4, 1.2, 0, Math.PI * 2)
  ctx.moveTo(cx + 5.8, cy - 4)
  ctx.arc(cx + 7, cy - 4, 1.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#e8a0a8'
  ctx.beginPath()
  ctx.arc(cx, cy + 4, 2.2, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * 画一张兔卡：面板底 + 选中高亮 + 兔头 + 基因型徽章 + 表现型 +
 * 达标金环（匹配目标显式分支）。
 * @param ctx - 画布上下文。
 * @param rabbit - 兔子。
 * @param slot - 槽位下标。
 * @param selected - 是否已选为亲本。
 * @param matches - 是否匹配目标。
 */
function drawCard(ctx: CanvasRenderingContext2D, rabbit: Rabbit, slot: number, selected: boolean, matches: boolean): void {
  const r = cardRect(slot)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 12)
  ctx.fill()
  if (selected) {
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 2
    glow(ctx, accent(0), 12)
    ctx.stroke()
    noGlow(ctx)
  } else {
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.lineWidth = 1
  const cx = r.x + r.w / 2
  const cy = r.y + 82
  drawBunnyHead(ctx, cx, cy, rabbit.genes)
  // 达标金环：匹配目标的兔头像外套一圈金环（显式分支）。
  if (matches) {
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(cx, cy, 33, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
  }
  // 基因型徽章（定宽居中，不随字宽漂移）。
  const badge = rabbit.genes.color + ' ' + rabbit.genes.fur
  const bw = 64
  ctx.fillStyle = selected ? accent(0) : THEME.panelEdge
  roundRectPath(ctx, cx - bw / 2, r.y + 138, bw, 20, 8)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.fillStyle = selected ? '#15151b' : THEME.text
  ctx.fillText(badge, cx, r.y + 152)
  // 表现型（与徽章不同水平带，基线差 32px）。
  const ph = phenotype(rabbit.genes)
  const pheno = (ph.black ? '黑毛' : '褐毛') + '·' + (ph.longFur ? '长' : '短')
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(pheno, cx, r.y + 184)
  // 槽位号（淡，卡左上角）。
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(226,226,238,0.25)'
  ctx.fillText(String(slot + 1), r.x + 12, r.y + 18)
}

/**
 * 画一只面板（圆角矩形 + 边框 + 居中标题）。
 * @param ctx - 画布上下文。
 * @param panel - 面板矩形。
 * @param title - 标题。
 */
function drawPanel(ctx: CanvasRenderingContext2D, panel: Rect, title: string): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, panel.x, panel.y, panel.w, panel.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText(title, panel.x + panel.w / 2, panel.y + 22)
}

/**
 * 画一个操作按钮：可用亮边、不可用淡化。
 * @param ctx - 画布上下文。
 * @param btn - 按钮矩形。
 * @param label - 按钮文本。
 * @param enabled - 是否可用。
 * @param edgeColor - 可用时的描边色。
 */
function drawButton(ctx: CanvasRenderingContext2D, btn: Rect, label: string, enabled: boolean, edgeColor: string): void {
  ctx.fillStyle = enabled ? THEME.panel : 'rgba(30,30,42,0.6)'
  roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 8)
  ctx.fill()
  ctx.strokeStyle = enabled ? edgeColor : THEME.panelEdge
  ctx.lineWidth = enabled ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = enabled ? THEME.text : THEME.textMuted
  ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 5)
}

/**
 * 整帧绘制：背景 + HUD + 兔舍兔卡 + 选中连线 + 目标/预览面板 + 底部
 * 按钮/提示 + 说明按钮与帮助面板（末尾最上层）。overlay 由 index 层
 * 随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen = false): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD 行（基线 y26）：左关卡、中容量、右剩余代（右锚）。
  hudPair(ctx, 16, 26, '关卡', view.hudLevel)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = view.count >= view.data.capacity ? THEME.bad : THEME.text
  ctx.fillText('兔舍 ' + view.count + '/' + view.data.capacity, 246, 26)
  hudPair(ctx, 704, 26, '剩余', view.genLeft + ' 代', 'right', view.genLeft > 0 ? THEME.text : THEME.bad)

  // 兔舍底板。
  ctx.fillStyle = 'rgba(30,30,42,0.5)'
  roundRectPath(ctx, PEN.x, PEN.y, PEN.w, PEN.h, 16)
  ctx.fill()

  // 兔卡：槽位 0..7，仅画在场兔（空槽不画）。
  for (let slot = 0; slot < view.rabbits.length && slot < 8; slot += 1) {
    const rabbit = view.rabbits[slot]!
    drawCard(ctx, rabbit, slot, view.selected.includes(rabbit.id), view.matchFlags[slot] === true)
  }

  // 两只亲本均已选：头像间高亮虚线连线。
  if (view.selectedCount === 2 && view.selected.length === 2) {
    const i1 = view.rabbits.findIndex((r) => r.id === view.selected[0])
    const i2 = view.rabbits.findIndex((r) => r.id === view.selected[1])
    if (i1 >= 0 && i2 >= 0) {
      const a = cardRect(i1)
      const b = cardRect(i2)
      ctx.save()
      ctx.strokeStyle = accent(0)
      ctx.lineWidth = 2
      ctx.setLineDash([6, 5])
      ctx.beginPath()
      ctx.moveTo(a.x + a.w / 2, a.y + 82)
      ctx.lineTo(b.x + b.w / 2, b.y + 82)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 育种目标面板。
  drawPanel(ctx, TARGET_PANEL, '育种目标')
  ctx.textAlign = 'left'
  ctx.font = '600 12px system-ui, sans-serif'
  const lines = targetLines(view.data)
  lines.forEach((line, i) => {
    ctx.fillStyle = THEME.text
    ctx.fillText(line, TARGET_PANEL.x + 12, TARGET_PANEL.y + 46 + i * 20)
  })
  ctx.fillStyle = THEME.textMuted
  if (view.data.target2 === null) {
    ctx.fillText('（任意一只达标即过关）', TARGET_PANEL.x + 12, TARGET_PANEL.y + 112)
  } else {
    ctx.fillText('（两只同时在舍）', TARGET_PANEL.x + 12, TARGET_PANEL.y + 112)
  }

  // Punnett 预览面板：按 selectedCount 0/1/2 显式分支。
  drawPanel(ctx, PREVIEW_PANEL, '子代可能（Punnett）')
  if (view.selectedCount === 2 && view.punnett !== null) {
    // 已选两只：逐行列出基因型与概率（左基因型、右概率，净距 ≥100px）。
    ctx.font = '600 13px system-ui, sans-serif'
    view.punnett.forEach((stat, i) => {
      const y = PREVIEW_PANEL.y + 50 + i * 26
      ctx.textAlign = 'left'
      ctx.fillStyle = THEME.text
      ctx.fillText(stat.label, PREVIEW_PANEL.x + 12, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = accent(2)
      ctx.fillText(Math.round(stat.frac * 100) + '%', PREVIEW_PANEL.x + PREVIEW_PANEL.w - 12, y)
    })
    ctx.textAlign = 'center'
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('每窝 4 仔独立抽样 · 点「配种」落窝', PREVIEW_PANEL.x + PREVIEW_PANEL.w / 2, PREVIEW_PANEL.y + PREVIEW_PANEL.h - 10)
  } else if (view.selectedCount === 1) {
    // 进行中（已选一只）：提示再选一只。
    ctx.textAlign = 'center'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('已选 1 只亲本', PREVIEW_PANEL.x + PREVIEW_PANEL.w / 2, PREVIEW_PANEL.y + 60)
    ctx.fillText('再点一只查看子代可能', PREVIEW_PANEL.x + PREVIEW_PANEL.w / 2, PREVIEW_PANEL.y + 84)
  } else {
    // 未选：初始提示。
    ctx.textAlign = 'center'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('点选两只亲本', PREVIEW_PANEL.x + PREVIEW_PANEL.w / 2, PREVIEW_PANEL.y + 60)
    ctx.fillText('实时预览子代基因型概率', PREVIEW_PANEL.x + PREVIEW_PANEL.w / 2, PREVIEW_PANEL.y + 84)
  }

  // 底部提示（居中 x400，与两侧按钮矩形净距 ≥100px）。
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点兔选亲本 · 配种后点 1 只可放归', 400, 539)

  // 配种 / 放归按钮。
  drawButton(ctx, BREED_BTN, '配种', view.breedEnabled, accent(2))
  drawButton(ctx, RELEASE_BTN, '放归', view.releaseEnabled, THEME.bad)

  // 说明按钮（60x24，任何阶段可点，画在渲染末尾最上层）。
  const hb = HELP_BTN
  drawButton(ctx, hb, '说明', true, helpOpen ? accent(2) : THEME.panelEdge)

  // 帮助面板（最上层，仅 helpOpen 时）。
  if (helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.92)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 15px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 14, HELP_PANEL.y + 28 + i * 24)
    })
  }
}
