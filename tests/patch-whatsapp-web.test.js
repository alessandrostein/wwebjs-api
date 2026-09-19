'use strict'

const { applyMediaIdFix, ANCHOR, MARKER } = require('../scripts/patch-whatsapp-web')

// Shape of sendMessage() in whatsapp-web.js around the media spread.
const upstreamSource = `        const message = {
            ...content,
            ...options,
            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)
        if (botOptions) {
            delete message.canonicalUrl;
        }
`

describe('applyMediaIdFix', () => {
  it('drops __x_id right after the spread, before the message is used', () => {
    const result = applyMediaIdFix(upstreamSource)

    expect(result.status).toBe('patched')
    expect(result.source).toContain(MARKER)
    expect(result.source.indexOf(MARKER))
      .toBeLessThan(result.source.indexOf('if (botOptions)'))
  })

  // A released fix must not be patched on top of — the build runs on every image.
  it('leaves an already-fixed library untouched', () => {
    const fixed = applyMediaIdFix(upstreamSource).source
    const again = applyMediaIdFix(fixed)

    expect(again.status).toBe('already-patched')
    expect(again.source).toBe(fixed)
  })

  // Silently skipping here would ship an image that looks fine and drops every
  // media send, which is exactly the outage this patch exists for.
  it('reports a missing anchor instead of guessing', () => {
    expect(applyMediaIdFix('nothing like the real file').status).toBe('anchor-missing')
  })

  it('refuses an ambiguous anchor rather than patching the wrong call site', () => {
    const result = applyMediaIdFix(upstreamSource + upstreamSource)

    expect(result.status).toBe('anchor-missing')
    expect(result.occurrences).toBe(2)
  })

  it('anchors on the real spread, not on a comment', () => {
    expect(ANCHOR).toContain('...extraOptions')
  })
})
