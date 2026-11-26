// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderBloom } from '../src/client/games/bloom/render.ts'
import { clickCell, generateBoard, type BloomState } from '../src/client/games/bloom/logic.ts'

function makeCtx(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 600
  const ctx = canvas.getContext('2d')!
  return ctx
}

describe('bloom render full playthrough crash hunt', () => {
  it('renders every frame of a full playthrough without throwing', () => {
    for (const seed of [123, 456, 789, 2024]) {
      const st = generateBoard(1, seed)
      if (st === null) continue
      const ctx = makeCtx()
      const particles = { size: () => 0, tick: () => {}, burst: () => {} }
      let steps: Array<{ index: number, layer: number }> = []
      let t = 0
      let clickNo = 0
      while (st.status === 'playing') {
        let idx = -1
        for (let i = 0; i < st.grid.length; i++) if (st.grid[i].kind === 'bud') { idx = i; break }
        if (idx < 0) break
        const r = clickCell(st, idx)
        clickNo += 1
        if (r === null) break
        steps = r.steps
        t = 0
        // render frames through the anim lifecycle (t from 0 to done+2s)
        for (let frameNo = 0; frameNo < 240; frameNo += 1) {
          t += 0.016
          let maxLayer = 0
          for (const s of steps) if (s.layer > maxLayer) maxLayer = s.layer
          const anim = t < maxLayer * 0.4 + 1.6 ? { steps, t } : null
          expect(() => renderBloom(ctx, st, {
            paused: false, helpOpen: false, hoverIndex: -1, cursorIndex: -1, anim, winText: null,
          }, undefined, 16)).not.toThrow()
        }
      }
      // final state renders (won/lost overlay)
      expect(() => renderBloom(ctx, st, {
        paused: false, helpOpen: false, hoverIndex: -1, cursorIndex: -1, anim: null, winText: null,
      }, undefined, 16)).not.toThrow()
      console.log('seed', seed, 'settled:', st.status, 'clicks:', clickNo)
    }
  })
})
