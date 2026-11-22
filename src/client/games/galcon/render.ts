/**
 * 星域征服 Galcon 渲染层：深空星空、星球径向渐变 + 兵力大字 + 归属
 * 色环、产兵脉冲、选中高亮圈、飞行舰队（小三角群 + 尾迹）、兵力对
 * 比条、局分 HUD、暂停与胜负 overlay。纯 canvas 绘制，状态全部来自
 * logic；无 DOM、无副作用。
 */
import {
  THEME, accent, glow, noGlow, drawBackground, drawOverlay, hudPair, createParticles,
} from '../theme.ts'
import {
  W, H, ROUND_MS, fleetPos, planetById, totalTroops,
  type GalconState, type Planet, type Owner,
} from './logic.ts'

/** 渲染器句柄。 */
export interface GalconRenderer {
  /** 绘制一帧完整场景（含 HUD 与 overlay）。 */
  draw(ctx: CanvasRenderingContext2D, state: GalconState, paused: boolean): void
  /** 在某点触发占领 / 击退爆点粒子。 */
  burst(x: number, y: number, color?: string): void
}

/** 一颗背景星。 */
interface Star { x: number, y: number, r: number, alpha: number, layer: number }

/** seed 确定性生成三层背景星空。 */
function generateStars(seed: number): Star[] {
  let a = seed >>> 0
  const rng = () => {
    a = (a + 0x9e3779b9) | 0
    let t = Math.imul(a ^ (a >>> 16), 2246822507)
    t = (t ^ Math.imul(t ^ (t >>> 13), 3266489909)) >>> 0
    return t / 4294967296
  }
  return Array.from({ length: 90 }, () => ({
    x: rng() * W,
    y: rng() * H,
    r: 0.6 + rng() * 1.6,
    alpha: 0.25 + rng() * 0.6,
    layer: Math.floor(rng() * 3),
  }))
}

/** 归属方主色。 */
function ownerColor(owner: Owner): string {
  if (owner === 'player') return accent(0)
  if (owner === 'ai') return THEME.bad
  return '#8b8fa3'
}

/**
 * 创建渲染器（星空按 seed 缓存一份）。
 * @param seed - 与逻辑侧相同的注入种子。
 * @returns 渲染器句柄。
 */
export function createGalconRenderer(seed: number): GalconRenderer {
  const stars = generateStars(seed)
  const particles = createParticles()

  /** 画一颗星球：渐变本体 + 高光 + 归属色环 + 产兵脉冲 + 兵力大字。 */
  const drawPlanet = (ctx: CanvasRenderingContext2D, p: Planet, state: GalconState): void => {
    const color = ownerColor(p.owner)
    // 产兵脉冲：归属方星球呼吸环。
    if (p.owner !== 'neutral') {
      const pulse = 0.5 + 0.5 * Math.sin(state.timeMs / 420 + p.id)
      ctx.globalAlpha = 0.14 + pulse * 0.18
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r + 5 + pulse * 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    // 本体：径向渐变（光源左上）。
    const grad = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.15, p.x, p.y, p.r)
    if (p.owner === 'neutral') {
      grad.addColorStop(0, '#a8aab8')
      grad.addColorStop(1, '#4a4c5c')
    } else {
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.35, color)
      grad.addColorStop(1, p.owner === 'player' ? '#2c4a86' : '#7a2c3c')
    }
    glow(ctx, color, 14)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fill()
    noGlow(ctx)
    // 归属色环。
    ctx.strokeStyle = color
    ctx.lineWidth = p.owner === 'neutral' ? 1.5 : 2.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r + 2, 0, Math.PI * 2)
    ctx.stroke()
    // 兵力大字：白色粗体，垂直光学居中。
    ctx.font = 'bold ' + Math.max(12, Math.round(p.r * 0.66)) + 'px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(String(Math.floor(p.troops)), p.x, p.y + 1)
    ctx.textBaseline = 'alphabetic'
  }

  const draw = (ctx: CanvasRenderingContext2D, state: GalconState, paused: boolean): void => {
    drawBackground(ctx, W, H)
    // 星空缓移。
    const t = state.timeMs / 1000
    for (const s of stars) {
      ctx.globalAlpha = s.alpha * (0.5 + s.layer * 0.25)
      ctx.fillStyle = '#c8d0f0'
      ctx.fillRect((s.x + t * (0.6 + s.layer * 0.8)) % W, s.y, s.r, s.r)
    }
    ctx.globalAlpha = 1

    // 选中高亮圈：旋转虚线 + 派兵预览（50% 数字随选中集显示）。
    for (const id of state.selectedIds) {
      const p = planetById(state, id)
      if (p === null || p.owner !== 'player') continue
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate((state.timeMs / 900) % (Math.PI * 2))
      ctx.strokeStyle = THEME.gold
      ctx.lineWidth = 2
      ctx.setLineDash([7, 5])
      ctx.beginPath()
      ctx.arc(0, 0, p.r + 7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    for (const p of state.planets) drawPlanet(ctx, p, state)

    // 飞行舰队：沿航线的小三角群（数量随兵力）+ 渐隐尾迹。
    for (const f of state.fleets) {
      const a = planetById(state, f.fromId)
      const b = planetById(state, f.toId)
      if (a === null || b === null) continue
      const pos = fleetPos(state, f)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const color = ownerColor(f.owner)
      // 尾迹：朝反方向的渐隐短线。
      const trailLen = 26
      const tail = ctx.createLinearGradient(
        pos.x - Math.cos(ang) * trailLen, pos.y - Math.sin(ang) * trailLen, pos.x, pos.y,
      )
      tail.addColorStop(0, 'rgba(0,0,0,0)')
      tail.addColorStop(1, color)
      ctx.strokeStyle = tail
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.moveTo(pos.x - Math.cos(ang) * trailLen, pos.y - Math.sin(ang) * trailLen)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      ctx.globalAlpha = 1
      // 三角群：1 + floor(count/12) 枚，横向编队。
      const ships = Math.min(5, 1 + Math.floor(f.count / 12))
      for (let i = 0; i < ships; i += 1) {
        const off = (i - (ships - 1) / 2) * 7
        const sx = pos.x - Math.sin(ang) * off
        const sy = pos.y + Math.cos(ang) * off
        glow(ctx, color, 6)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(sx + Math.cos(ang) * 5, sy + Math.sin(ang) * 5)
        ctx.lineTo(sx - Math.cos(ang) * 4 - Math.sin(ang) * 4, sy - Math.sin(ang) * 4 + Math.cos(ang) * 4)
        ctx.lineTo(sx - Math.cos(ang) * 4 + Math.sin(ang) * 4, sy - Math.sin(ang) * 4 - Math.cos(ang) * 4)
        ctx.closePath()
        ctx.fill()
        noGlow(ctx)
      }
      // 兵力小字：舰队旁标注。
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillStyle = color
      ctx.fillText(String(f.count), pos.x + 10, pos.y - 8)
    }

    particles.tick(ctx, 16)

    // ---- HUD 顶栏 ----
    // 左列（左锚 x=12，宽约 110）：局号 + 积分。
    hudPair(ctx, 12, 22, '局', (state.matchIndex + 1) + '/' + 3)
    hudPair(ctx, 12, 44, '积分', String(state.totalScore))
    // 中块：兵力对比条（x 330..630，y 14..22）+ 居中说明（y 36）。
    const mine = totalTroops(state, 'player')
    const foe = totalTroops(state, 'ai')
    const share = mine + foe > 0 ? mine / (mine + foe) : 0.5
    ctx.fillStyle = 'rgba(34,34,50,0.9)'
    ctx.fillRect(330, 14, 300, 8)
    ctx.fillStyle = accent(0)
    ctx.fillRect(330, 14, 300 * share, 8)
    ctx.fillStyle = THEME.bad
    ctx.fillRect(330 + 300 * share, 14, 300 * (1 - share), 8)
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('兵力对比', 480, 36)
    // 右列（右锚 x=W-12，向左最多约 110）：双方兵力 + 剩余时间。
    hudPair(ctx, W - 12, 22, '我方', String(Math.floor(mine)), 'right', accent(0))
    hudPair(ctx, W - 12, 44, '敌方', String(Math.floor(foe)), 'right', THEME.bad)
    const leftS = Math.max(0, Math.ceil((ROUND_MS - state.roundMs) / 1000))
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillStyle = leftS <= 20 ? THEME.gold : THEME.textMuted
    ctx.fillText('剩余 ' + leftS + 's', W - 12, 60)

    // 底部常驻速览（一行，左锚，宽约 470）。
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('点己方星球选中 · 点目标派 50% 兵力 · 空格全选 · R 重开 · P 暂停', 12, H - 12)

    // ---- overlay ----
    const wins = state.results.filter((r) => r === 'win').length
    if (paused && state.phase === 'playing') {
      drawOverlay(ctx, W, H, '暂停', '空格 / P 继续 · R 重开整场')
    } else if (state.phase === 'won') {
      drawOverlay(ctx, W, H, '星域易主', '本局胜利 · 积分 ' + state.totalScore + ' · 空格进入下一局', THEME.good)
    } else if (state.phase === 'lost') {
      drawOverlay(ctx, W, H, '星域失守', '本局失利 · 空格进入下一局', THEME.bad)
    } else if (state.phase === 'matchOver') {
      drawOverlay(ctx, W, H, '征服终局', '3 局 ' + wins + ' 胜 · 总积分 ' + state.totalScore + ' · R 重开整场', wins >= 2 ? THEME.good : THEME.bad)
    }
  }

  return {
    draw,
    burst(x, y, color = THEME.gold): void {
      particles.burst(x, y, color, 14, 150)
    },
  }
}
