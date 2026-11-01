import { expect, test } from 'claude-code/testing'

import { HUE, INK, chipSvg, roboSvg } from '../hooks/cache-art'

test('every drawing carries the light-theme palette swap', () => {
  for (const svg of [chipSvg('warm').source, roboSvg('cold')]) {
    expect(svg).toContain('@media (prefers-color-scheme: light)')
    expect(svg).toContain(`[fill="${HUE.warm}"]{fill:#b84a4a}`)
    expect(svg).toContain(`[stroke="${HUE.cold}"]{stroke:#3d8296}`)
    expect(svg).toContain(`[fill="${INK}"]{fill:#ffffff}`)
  }
})
