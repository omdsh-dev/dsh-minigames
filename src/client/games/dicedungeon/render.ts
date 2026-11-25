/**
 * 骰子地牢画布渲染：暗色地牢风——顶部 HUD（层数 / 生命 / 护盾 / 回合）、
 * 敌人立绘牌（HP 条 + 意图 + 灼烧图标）、大点数骰子行、三 / 四张槽卡片、
 * 强化三选一卡片、结束回合按钮、帮助按钮 + 帮助面板（渲染函数末尾最上
 * 层绘制，任何阶段与暂停均可开合）、死亡 / 通关 / 暂停 overlay。全部使用
 * 共享视觉套件（../theme.ts）。所有交互矩形由本模块统一导出，index 层
 * 命中测试与绘制共用同一份几何，杜绝错位。
 */
import type { DieView, DungeonView, SlotKind, UpgradeView } from './logic.ts'
import { FIREBALL_NEED, LIFESTEAL_NEED, MAX_FLOOR } from './logic.ts'
import { THEME, accent, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

export const LOGICAL_W = 640
export const LOGICAL_H = 420

/** 帮助按钮（60×24，左下角）。 */
export const HELP_RECT = { x: 14, y: 382, w: 60, h: 24 }
/** 结束回合按钮（战斗阶段右下角）。 */
export const END_TURN_RECT = { x: 520, y: 376, w: 106, h: 34 }
/** 敌人面板矩形（顶部居中）。 */
const ENEMY_RECT = { x: 200, y: 44, w: 240, h: 100 }
/** 骰子行几何。 */
const DICE_SIZE = 52
const DICE_GAP = 18
const DICE_Y = 164
/** 槽卡片几何（最多 4 张，整体居中）。 */
const SLOT_W = 132
const SLOT_H = 84
const SLOT_GAP = 12
const SLOT_Y = 248
/** 强化卡片几何（3 张居中）。 */
const UPG_W = 170
const UPG_H = 168
const UPG_GAP = 20
const UPG_Y = 116

/**
 * 按实测宽度把文案贪心折成最多 maxLines 行（CJK 友好：逐字断行，
 * 不依赖空格）。渲染层用 ctx.measureText 做宽度函数，测试可用
 * 固定字宽桩验证断行逻辑。超过 maxLines 时末行截断加省略号。
 * @param text 待折行文案
 * @param maxWidth 单行最大宽度（px，含省略号占用）
 * @param measureWidth 以目标字体测量字符串宽度的函数
 * @param maxLines 最大行数（至少 1）
 * @returns 折行结果（至少 1 行，均不超过 maxWidth，除非单个字形本身超宽）
 */
export function wrapTextByMeasure(
  text: string,
  maxWidth: number,
  measureWidth: (s: string) => number,
  maxLines = 2,
): string[] {
  const lines: string[] = []
  let current = ''
  const flush = (): void => {
    lines.push(current)
    current = ''
  }
  for (const ch of text) {
    const next = current + ch
    if (measureWidth(next) > maxWidth && current !== '' && lines.length < maxLines - 1) {
      flush()
      current = ch
      continue
    }
    current = next
  }
  if (current !== '' || lines.length === 0) flush()
  if (lines.length > maxLines) lines.length = maxLines
  // 末行仍超宽（maxLines=1 或极端长词）时按字形截断加省略号（预留省略号宽度）。
  let last = lines[lines.length - 1]!
  while (measureWidth(last + '…') > maxWidth && last.length > 1) last = last.slice(0, -1)
  if (last !== lines[lines.length - 1]) lines[lines.length - 1] = last + '…'
  return lines
}

/** 槽的展示元数据（顺序即渲染顺序）。 */
const SLOT_META: Record<SlotKind, { title: string; hint: string; color: string }> = {
  attack: { title: '⚔ 攻击', hint: '造成等值伤害', color: accent(4) },
  shield: { title: '🛡 护盾', hint: '获得等值格挡', color: accent(0) },
  fireball: { title: '🔥 火球', hint: '≥4 点：点燃灼烧', color: accent(3) },
  lifesteal: { title: '🩸 吸血', hint: '≥5 点：回复生命', color: accent(4) },
}

/** 当前已解锁槽列表（火球 / 吸血随层数解锁）。 */
export function unlockedSlots(v: DungeonView): SlotKind[] {
  const slots: SlotKind[] = ['attack', 'shield']
  if (v.player.hasFireball) slots.push('fireball')
  if (v.player.hasLifesteal) slots.push('lifesteal')
  return slots
}

/** 每颗骰子的命中矩形（与绘制共用几何）。 */
export function diceRects(dice: DieView[]): { x: number; y: number; w: number; h: number }[] {
  const n = dice.length
  const total = n * DICE_SIZE + (n - 1) * DICE_GAP
  const x0 = (LOGICAL_W - total) / 2
  return dice.map((_, i) => ({ x: x0 + i * (DICE_SIZE + DICE_GAP), y: DICE_Y, w: DICE_SIZE, h: DICE_SIZE }))
}

/** 每张槽卡片的命中矩形。 */
export function slotRects(slots: SlotKind[]): { x: number; y: number; w: number; h: number; slot: SlotKind }[] {
  const total = slots.length * SLOT_W + (slots.length - 1) * SLOT_GAP
  const x0 = (LOGICAL_W - total) / 2
  return slots.map((slot, i) => ({ x: x0 + i * (SLOT_W + SLOT_GAP), y: SLOT_Y, w: SLOT_W, h: SLOT_H, slot }))
}

/** 三张强化卡片的命中矩形。 */
export function upgradeRects(): { x: number; y: number; w: number; h: number }[] {
  const total = 3 * UPG_W + 2 * UPG_GAP
  const x0 = (LOGICAL_W - total) / 2
  return [0, 1, 2].map(i => ({ x: x0 + i * (UPG_W + UPG_GAP), y: UPG_Y, w: UPG_W, h: UPG_H }))
}

/** 各点数的九宫点阵（-1/0/1 坐标）。 */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
}

/** 一颗骰面（白底圆角 + 点阵；used 变暗并盖槽名）。 */
function drawDie(ctx: CanvasRenderingContext2D, x: number, y: number, die: DieView, selected: boolean, slotLabel: string | null): void {
  ctx.save()
  if (die.used) ctx.globalAlpha = 0.38
  roundRectPath(ctx, x, y, DICE_SIZE, DICE_SIZE, 10)
  ctx.fillStyle = die.used ? '#8f88a8' : '#efedf7'
  glow(ctx, selected ? accent(5) : '#c9c6dd', selected ? 14 : 5)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = selected ? accent(5) : THEME.panelEdge
  ctx.lineWidth = selected ? 3 : 1.5
  ctx.stroke()
  const cx = x + DICE_SIZE / 2
  const cy = y + DICE_SIZE / 2
  ctx.fillStyle = '#26232f'
  for (const [px, py] of PIPS[die.value]!) {
    ctx.beginPath()
    ctx.arc(cx + px * 13, cy + py * 13, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (slotLabel !== null) {
    ctx.globalAlpha = 0.95
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.text
    ctx.fillText(slotLabel, cx, y + DICE_SIZE - 6)
  }
  ctx.restore()
}

/** 敌人面板：名字、HP 条、灼烧图标与层数、意图文案。 */
function drawEnemy(ctx: CanvasRenderingContext2D, v: DungeonView): void {
  const { x, y, w, h } = ENEMY_RECT
  roundRectPath(ctx, x, y, w, h, 12)
  ctx.fillStyle = THEME.panel
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText(v.enemy.name + '  F' + String(v.floor) + '/' + String(MAX_FLOOR), x + w / 2, y + 26)
  // HP 条（面板内边距 16）。
  const barX = x + 16
  const barY = y + 38
  const barW = w - 32
  const barH = 12
  roundRectPath(ctx, barX, barY, barW, barH, 6)
  ctx.fillStyle = '#26232f'
  ctx.fill()
  const ratio = Math.max(0, v.enemy.hp / v.enemy.maxHp)
  if (ratio > 0) {
    roundRectPath(ctx, barX, barY, Math.max(6, barW * ratio), barH, 6)
    ctx.fillStyle = THEME.bad
    glow(ctx, THEME.bad, 6)
    ctx.fill()
    noGlow(ctx)
  }
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(String(Math.max(0, v.enemy.hp)) + ' / ' + String(v.enemy.maxHp), x + w / 2, barY + 26)
  // 灼烧图标（底部独立行，与首行意图文案不同行，杜绝横向挤撞）。
  if (v.enemy.burn > 0) {
    ctx.font = '13px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.gold
    ctx.fillText('灼烧×' + String(v.enemy.burn), x + 12, y + h - 10)
  }
  // 意图文案（首行右对齐；灼烧已移到底部独立行，两者不再同行）。
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillStyle = v.enemy.charging ? THEME.bad : THEME.textMuted
  ctx.fillText(v.intent, x + w - 12, y + 20)
}

/** HUD：层数 / 生命 / 护盾（左），回合（右）。 */
function drawHud(ctx: CanvasRenderingContext2D, v: DungeonView): void {
  hudPair(ctx, 14, 26, '层', String(v.floor) + '/' + String(MAX_FLOOR))
  hudPair(ctx, 96, 26, '生命', String(v.player.hp) + '/' + String(v.player.maxHp), 'left', v.player.hp <= 6 ? THEME.bad : THEME.text)
  hudPair(ctx, 216, 26, '护盾', String(v.player.shield), 'left', accent(0))
  hudPair(ctx, LOGICAL_W - 14, 26, '回合', String(v.turn), 'right')
}

/** 一张槽卡片：标题、说明、选中骰子是否满足门槛。 */
function drawSlotCard(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, slot: SlotKind, v: DungeonView, selectedDie: DieView | null): void {
  const meta = SLOT_META[slot]
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 12)
  ctx.fillStyle = THEME.panel
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.fillStyle = meta.color
  ctx.fillText(meta.title, r.x + r.w / 2, r.y + 30)
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(meta.hint, r.x + r.w / 2, r.y + 54)
  // 门槛提示：选中骰子点数不足时标红（攻击 / 护盾恒可放）。
  if (selectedDie !== null) {
    const need = slot === 'fireball' ? FIREBALL_NEED : slot === 'lifesteal' ? LIFESTEAL_NEED : 0
    const ok = need === 0 || selectedDie.value >= need
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.fillStyle = ok ? THEME.good : THEME.bad
    ctx.fillText(ok ? '可放入 ' + String(selectedDie.value) : '需 ≥' + String(need), r.x + r.w / 2, r.y + 76)
  }
}

/** 帮助面板（15-16px 大字，8 行完整规则 + 易误解点）。 */
const HELP_LINES: string[] = [
  '· 每回合掷骰，点一颗骰子再点槽卡片分配；每颗骰只能用一次。',
  '· ⚔ 攻击：造成等值伤害。🛡 护盾：获得等值格挡，保留到被消耗。',
  '· 🔥 火球：≥4 的骰点燃敌人，每层每回合灼烧并逐回合衰减一层。',
  '· 🩸 吸血：≥5 的骰回复等值生命（强化后额外加成）。',
  '· 火球槽第 1 胜后解锁、吸血槽第 2 胜后解锁；每胜 +4 最大生命。',
  '· 胜利间隙三选一：多一颗骰（上限 4）/ 技能威力 / 篝火回血。',
  '· 敌人意图牌会预告：固定每回合出手、蓄力隔回合重击、间隔休整。',
  '· 注意：护盾不随回合清零；灼烧在敌人行动前结算。R 重开 · P 暂停。',
]

/** 结束层：帮助按钮 + 帮助面板（渲染函数最末绘制，始终最上层）。 */
function drawHelpTop(ctx: CanvasRenderingContext2D, showHelp: boolean): void {
  const { x, y, w, h } = HELP_RECT
  roundRectPath(ctx, x, y, w, h, 6)
  ctx.fillStyle = THEME.panel
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.fill()
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText(showHelp ? '关闭' : '说明', x + w / 2, y + 16)
  if (!showHelp) return
  // 面板本体。
  const px = 56
  const py = 70
  const pw = LOGICAL_W - 112
  const ph = 300
  roundRectPath(ctx, px, py, pw, ph, 14)
  ctx.fillStyle = 'rgba(20,20,30,0.97)'
  ctx.strokeStyle = accent(0)
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('规则说明', px + 20, py + 32)
  ctx.font = '15px system-ui, sans-serif'
  let ly = py + 62
  for (const line of HELP_LINES) {
    ctx.fillStyle = THEME.text
    ctx.fillText(line, px + 20, ly)
    ly += 28
  }
}

/** 粒子系统（模块级共享，击杀 / 重击时迸发）。 */
const particles = createParticles()

/** 粒子是否仍在存活（index 层据此逐帧 markDirty）。 */
export function dicedungeonParticlesActive(): boolean {
  return particles.size() > 0
}

/** 在逻辑坐标迸发一簇粒子。 */
export function dicedungeonBurst(x: number, y: number, color: string, count: number): void {
  particles.burst(x, y, color, count)
}

/** 槽名的单字短标（盖在已用骰子上）。 */
function shortSlotLabel(slot: SlotKind): string {
  if (slot === 'attack') return '攻'
  if (slot === 'shield') return '盾'
  if (slot === 'fireball') return '火'
  return '血'
}

/** 渲染一帧（index 层在 dirty 帧调用）。 */
export function renderDiceDungeon(
  ctx: CanvasRenderingContext2D,
  v: DungeonView,
  ui: { selectedDieId: number | null; showHelp: boolean; paused: boolean; slotOfDie: Record<number, SlotKind> },
  dtMs: number,
): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  if (v.phase === 'upgrade') {
    // 强化阶段：三张卡片 + 标题。
    ctx.textAlign = 'center'
    ctx.font = 'bold 20px system-ui, sans-serif'
    ctx.fillStyle = THEME.gold
    ctx.fillText('胜利！选择一项强化', LOGICAL_W / 2, 92)
    const rects = upgradeRects()
    const cards = v.upgradeChoices ?? []
    rects.forEach((r, i) => {
      const card: UpgradeView | undefined = cards[i]
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 14)
      ctx.fillStyle = THEME.panel
      ctx.strokeStyle = accent(i)
      ctx.lineWidth = 2
      glow(ctx, accent(i), 8)
      ctx.fill()
      noGlow(ctx)
      ctx.stroke()
      if (card === undefined) return
      ctx.textAlign = 'center'
      ctx.font = 'bold 17px system-ui, sans-serif'
      ctx.fillStyle = accent(i)
      ctx.fillText(card.title, r.x + r.w / 2, r.y + 44)
      // desc 12px 最多两行自动折行（内容宽 154px，卡片高 168 足够容纳）。
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillStyle = THEME.textMuted
      const descLines = wrapTextByMeasure(card.desc, r.w - 16, s => ctx.measureText(s).width, 2)
      const firstY = descLines.length === 1 ? r.y + 76 : r.y + 72
      descLines.forEach((line, li) => {
        ctx.fillText(line, r.x + r.w / 2, firstY + li * 18)
      })
    })
  } else {
    drawHud(ctx, v)
    drawEnemy(ctx, v)
    // 骰子行。
    const rects = diceRects(v.dice)
    v.dice.forEach((die, i) => {
      const r = rects[i]!
      const usedSlot = ui.slotOfDie[die.id]
      const label = die.used ? (usedSlot === undefined ? '已用' : shortSlotLabel(usedSlot)) : null
      drawDie(ctx, r.x, r.y, die, ui.selectedDieId === die.id && !die.used, label)
    })
    if (v.phase === 'battle') {
      // 槽卡片行。
      const selected = ui.selectedDieId === null ? null : v.dice.find(d => d.id === ui.selectedDieId && !d.used) ?? null
      for (const r of slotRects(unlockedSlots(v))) drawSlotCard(ctx, r, r.slot, v, selected)
      // 结束回合按钮。
      const b = END_TURN_RECT
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 8)
      ctx.fillStyle = accent(2)
      glow(ctx, accent(2), 8)
      ctx.fill()
      noGlow(ctx)
      ctx.font = 'bold 15px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#14141c'
      ctx.fillText('结束回合', b.x + b.w / 2, b.y + 22)
    }
    // 结算说明行（居中，两侧无其它元素）。
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(v.lastEvent, LOGICAL_W / 2, 368)
  }
  // 粒子在场景之上、overlay 之下。
  particles.tick(ctx, dtMs)
  if (v.phase === 'dead') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '倒在第 ' + String(v.floor) + ' 层', 'R 重开一局', THEME.bad)
  } else if (v.phase === 'victory') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '通关！', '地牢之主已被讨伐 · R 再来一局', THEME.gold)
  } else if (ui.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', 'P 继续 · R 重开', THEME.text)
  }
  // 帮助按钮 + 面板永远最后绘制（最上层，任何阶段 / 暂停可开合）。
  drawHelpTop(ctx, ui.showHelp)
}
