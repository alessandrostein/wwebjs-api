const fsp = require('fs').promises
const axios = require('axios')
const qrcode = require('qrcode-terminal')
const { sessionFolderPath, presenceReleaseUrl, presenceReleaseToken, servicePort, globalApiKey } = require('../config')
const { sendErrorResponse } = require('../utils')
const { logger } = require('../logger')

const localApiHeaders = () => (globalApiKey ? { 'x-api-key': globalApiKey } : {})

const resolveLidToPhone = async (sessionId, contactId) => {
  const res = await axios.post(
    `http://127.0.0.1:${servicePort}/client/getContactById/${sessionId}`,
    { contactId },
    { headers: localApiHeaders(), timeout: 5000 }
  )
  return res?.data?.contact?.id?.user || null
}

const replyToWhatsApp = async (sessionId, chatId, quotedMessageId, text) => {
  await axios.post(
    `http://127.0.0.1:${servicePort}/client/sendMessage/${sessionId}`,
    { chatId, contentType: 'string', content: text, options: { quotedMessageId } },
    { headers: localApiHeaders(), timeout: 10000 }
  )
}

const normalizeKeyword = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, '')

const forwardPresenceRelease = async (body) => {
  if (!presenceReleaseUrl || !presenceReleaseToken) return
  if (body?.dataType !== 'message') return
  const msg = body?.data?.message
  const from = msg?.from || ''
  const fromMe = msg?._data?.id?.fromMe === true
  if (fromMe || from.endsWith('@g.us')) return

  const sessionId = body.sessionId
  const messageId = msg?._data?.id?._serialized || msg?.id?._serialized
  const messageBody = msg?.body || msg?._data?.body || ''

  let phoneNumber = null
  if (from.endsWith('@c.us')) {
    phoneNumber = from.slice(0, -'@c.us'.length)
  } else if (from.endsWith('@lid') && sessionId) {
    try {
      phoneNumber = await resolveLidToPhone(sessionId, from)
    } catch (err) {
      logger.warn({ err: err.message, from }, 'failed to resolve @lid contact')
      return
    }
  }
  if (!phoneNumber) return

  let replyText = null
  let responseSuccess = false
  try {
    const res = await axios.post(presenceReleaseUrl, { phone_number: phoneNumber }, {
      headers: { Authorization: `Bearer ${presenceReleaseToken}` },
      timeout: 5000
    })
    replyText = res.data?.message || null
    responseSuccess = res.data?.success === true
  } catch (err) {
    const status = err.response?.status
    replyText = err.response?.data?.message || 'Não consegui processar a liberação agora. Tenta de novo em alguns instantes.'
    logger.warn({ err: err.message, status, phoneNumber }, 'presence release webhook failed')
  }

  // Reply unconditionally only on confirmed release; otherwise require the
  // explicit trigger phrase to avoid spamming users in unrelated chats.
  if (!responseSuccess && !normalizeKeyword(messageBody).includes('continuarjogando')) return
  if (!replyText || !sessionId || !messageId) return
  try {
    await replyToWhatsApp(sessionId, from, messageId, replyText)
  } catch (err) {
    logger.warn({ err: err.message, phoneNumber }, 'failed to reply to whatsapp')
  }
}

/**
 * Responds to request with 'pong'
 *
 * @function ping
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const ping = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Health check'
    #swagger.description = 'Responds to request with "pong" message'
    #swagger.responses[200] = {
      description: "Response message",
      content: {
        "application/json": {
          example: {
            success: true,
            message: "pong"
          }
        }
      }
    }
  */
  res.json({ success: true, message: 'pong' })
}

/**
 * Example local callback that generates a QR code and writes a log file
 *
 * @function localCallbackExample
 * @async
 * @param {Object} req - Express request object containing a body object with dataType and data
 * @param {string} req.body.dataType - Type of data (in this case, 'qr')
 * @param {Object} req.body.data - Data to generate a QR code from
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const localCallbackExample = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Local callback'
    #swagger.description = 'Used to generate a QR code and writes a log file. ONLY FOR DEVELOPMENT/TEST PURPOSES.'
    #swagger.responses[200] = {
      description: "Response message",
      content: {
        "application/json": {
          example: {
            success: true
          }
        }
      }
    }
  */
  try {
    const { dataType, data } = req.body
    if (dataType === 'qr') { qrcode.generate(data.qr, { small: true }) }
    await fsp.mkdir(sessionFolderPath, { recursive: true })
    await fsp.writeFile(`${sessionFolderPath}/message_log.txt`, `${JSON.stringify(req.body)}\r\n`, { flag: 'a+' })
    forwardPresenceRelease(req.body)
    res.json({ success: true })
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error(error, 'Failed to handle local callback')
    sendErrorResponse(res, 500, error.message)
  }
}

module.exports = { ping, localCallbackExample }
