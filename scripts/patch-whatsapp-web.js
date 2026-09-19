#!/usr/bin/env node
'use strict'

/**
 * Patches whatsapp-web.js in place for the media-send regression.
 *
 * processMediaData() returns a MediaData model whose private __x_id field is
 * spread into the outgoing Msg, overwriting the message's real id. Msg.initialize
 * then calls getValidatedSender() on an id that is gone and throws:
 *
 *   Data passed to getter must include an id property (it's how we memoize)
 *   but got undefined
 *
 * Every media send fails — any chat, any recipient, with or without isViewOnce.
 * Plain text is unaffected, which is why the outage looked partial.
 *
 * Upstream fix is open and unreleased (wwebjs/whatsapp-web.js#201923, issue
 * #201922), so we carry it here. Applying is idempotent: once a release ships
 * with the fix it is detected and left alone. A missing anchor FAILS the build,
 * so a future version never silently drops the patch.
 */

const fs = require('fs')
const path = require('path')

const TARGET = path.join(
  __dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js'
)

const MARKER = 'delete message.__x_id'

const ANCHOR = `            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)`

const FIX = `            ...extraOptions,
        };

        // MediaData is a model whose private __x_id field collides with Msg's
        // internal id field when its enumerable properties are spread above,
        // breaking getValidatedSender() during Msg initialization.
        delete message.__x_id;

        // Bot's won't reply if canonicalUrl is set (linking)`

/**
 * Pure half of the patch, so the contract is testable without a real install.
 *
 * @param {string} source contents of Injected/Utils.js
 * @returns {{status: 'patched'|'already-patched'|'anchor-missing', source: string, occurrences: number}}
 */
function applyMediaIdFix (source) {
  if (source.includes(MARKER)) {
    return { status: 'already-patched', source, occurrences: 0 }
  }

  const occurrences = source.split(ANCHOR).length - 1
  if (occurrences !== 1) {
    return { status: 'anchor-missing', source, occurrences }
  }

  return { status: 'patched', source: source.replace(ANCHOR, FIX), occurrences }
}

function main () {
  if (!fs.existsSync(TARGET)) {
    console.error(`[patch-wwebjs] not found: ${TARGET}`)
    process.exit(1)
  }

  const result = applyMediaIdFix(fs.readFileSync(TARGET, 'utf8'))

  if (result.status === 'already-patched') {
    console.log('[patch-wwebjs] media __x_id fix already present — nothing to do')
    return
  }

  if (result.status === 'anchor-missing') {
    console.error(
      `[patch-wwebjs] anchor matched ${result.occurrences} times (expected 1). ` +
      'whatsapp-web.js changed shape — recheck upstream #201923 before building.'
    )
    process.exit(1)
  }

  fs.writeFileSync(TARGET, result.source, 'utf8')
  console.log('[patch-wwebjs] media __x_id fix applied')
}

if (require.main === module) {
  main()
}

module.exports = { applyMediaIdFix, ANCHOR, MARKER, TARGET }
