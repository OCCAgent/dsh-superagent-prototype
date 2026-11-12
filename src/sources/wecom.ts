/** WeCom intelligent-robot Source: a WebSocket long connection carries chat messages into Triggers and replies back on it. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import WebSocket from 'ws'
import { key, type OutboundMessage, type Trigger } from '../core/index.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'

export const SOURCE = 'wecom'
/** The aibot long-connection gateway; the bot authenticates with `aibot_subscribe` and never needs a public callback URL. */
const WS_URL = 'wss://openws.work.weixin.qq.com'
const HEARTBEAT_MS = 30_000
const HEARTBEAT_MISSES = 3
const ACK_TIMEOUT_MS = 10_000
const AUTH_TIMEOUT_MS = 15_000
/** `aibot_send_msg` and `stream` reject a body over 20480 utf8 bytes; keep a margin for chunk markers. */
const CONTENT_LIMIT = 18_000

const ConfigSchema = z.object({
  /** Bot credential JSON written by the operator. Empty reads stateDir/wecom/bot.json. */
  botFile: z.string().default(''),
  directMessages: z.boolean().default(true),
  groups: z.array(z.object({ id: z.string().min(1), name: z.string().trim().max(60).optional() }).strict())
    .refine(groups => new Set(groups.map(group => group.id)).size === groups.length, 'Duplicate chat IDs').default([]),
}).strict()
export type WecomConfig = z.infer<typeof ConfigSchema>

const BotSchema = z.object({ botId: z.string().min(1), secret: z.string().min(1) })
export type WecomBot = z.infer<typeof BotSchema>

const MediaSchema = z.looseObject({ url: z.string().optional(), aeskey: z.string().optional() })
const MessageSchema = z.looseObject({
  msgid: z.string().min(1),
  chatid: z.string().optional(),
  chattype: z.string().optional(),
  from: z.looseObject({ userid: z.string().optional() }).optional(),
  msgtype: z.string().optional(),
  createtime: z.number().optional(),
  text: z.looseObject({ content: z.string().optional() }).optional(),
  voice: z.looseObject({ content: z.string().optional() }).optional(),
  image: MediaSchema.optional(),
  file: MediaSchema.optional(),
  video: MediaSchema.optional(),
  mixed: z.looseObject({
    msg_item: z.array(z.looseObject({
      msgtype: z.string().optional(),
      text: z.looseObject({ content: z.string().optional() }).optional(),
      voice: z.looseObject({ content: z.string().optional() }).optional(),
      image: MediaSchema.optional(),
      file: MediaSchema.optional(),
      video: MediaSchema.optional(),
    })).optional(),
  }).optional(),
})
export type WecomMessage = z.infer<typeof MessageSchema>

interface Frame { cmd?: string; headers?: { req_id?: string }; body?: unknown; errcode?: number; errmsg?: string }
interface Pending { resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface CloseReason { contended?: boolean; fatal?: boolean; detail?: string }

const PLACEHOLDERS: Record<string, string> = { image: '[图片]', file: '[文件]', video: '[视频]' }

/** The message body an agent reads: typed text, WeCom's voice transcript, or a placeholder for media it cannot read yet. */
export function wecomText(message: WecomMessage): string {
  const type = (message.msgtype ?? '').toLowerCase()
  if (type === 'text') return message.text?.content?.trim() ?? ''
  if (type === 'voice') return message.voice?.content?.trim() ?? ''
  if (type === 'mixed') {
    const runs: string[] = []
    for (const item of message.mixed?.msg_item ?? []) {
      const itemType = (item.msgtype ?? '').toLowerCase()
      const text = itemType === 'text' ? item.text?.content?.trim() : itemType === 'voice' ? item.voice?.content?.trim() : undefined
      if (text) runs.push(text)
      else if (PLACEHOLDERS[itemType]) runs.push(PLACEHOLDERS[itemType])
    }
    return runs.join('\n')
  }
  return PLACEHOLDERS[type] ?? ''
}

/**
 * Maps one aibot message to a Trigger. `reqId` is the frame's own `req_id`, which is also the reply anchor: a reply
 * reuses it, so the thread address has to carry it until the reply goes out.
 */
export function wecomTrigger(message: WecomMessage, reqId: string, now = new Date()): Trigger | undefined {
  const text = wecomText(message)
  if (!text) return undefined
  const chatType = (message.chattype ?? 'single').toLowerCase() === 'group' ? 'group' : 'single'
  const userId = message.from?.userid ?? ''
  const chatId = message.chatid ?? userId
  const thread = chatType === 'group' ? `group:${chatId}` : `user:${userId}`
  const at = Number.isFinite(message.createtime) ? new Date((message.createtime as number) * 1000) : now
  return {
    id: key(SOURCE, message.msgid),
    source: SOURCE,
    threads: [{ source: SOURCE, id: thread }],
    actor: { source: SOURCE, id: userId },
    human: true,
    addressed: chatType === 'group' ? 'mention' : 'direct',
    at: at.toISOString(),
    text,
    channel: { source: SOURCE, thread: `wecom:${thread}`,
      address: { user: userId, chat: chatId, chatType, req: reqId, message: message.msgid } },
    meta: { userId, msgId: message.msgid, chatId, chatType, reqId },
  }
}

/** Splits a reply into bodies the platform accepts, preferring a line boundary when one falls near the end. */
export function replyChunks(text: string, limit = CONTENT_LIMIT): string[] {
  if (Buffer.byteLength(text, 'utf8') <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (Buffer.byteLength(rest, 'utf8') > limit) {
    let cut = limit
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > limit) cut -= 1
    const newline = rest.lastIndexOf('\n', cut)
    if (newline > cut / 2) cut = newline + 1
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) chunks.push(rest)
  return chunks
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

/** One live aibot WebSocket: subscribes, heartbeats, routes pushes, and correlates outbound acks by `req_id`. */
class Connection {
  private readonly socket: WebSocket
  private readonly pending = new Map<string, Pending>()
  private readonly ready: Promise<void>
  private readonly closedSignal: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private resolveClosed!: () => void
  private heartbeat?: ReturnType<typeof setInterval>
  private readonly replyChains = new Map<string, Promise<void>>()
  private misses = 0
  private subscribed = false
  private finished = false
  reason: CloseReason = {}

  constructor(private readonly bot: WecomBot, private readonly onMessage: (message: WecomMessage, reqId: string) => void,
    private readonly onNotice: (detail: string) => void) {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.closedSignal = new Promise(resolve => { this.resolveClosed = resolve })
    // `ws` writes canonical `Upgrade`/`Connection` headers; the gateway answers 404 to lowercase ones, which is what
    // the browser and Node built-in WebSocket clients send, so this Source cannot use those.
    this.socket = new WebSocket(WS_URL, { handshakeTimeout: 15_000 })
    this.socket.on('open', () => { void this.subscribe() })
    this.socket.on('message', data => { this.receive(data.toString()) })
    this.socket.on('close', (code, reason) => { this.finish({ detail: `connection closed (${code}${reason.length ? ` ${reason.toString()}` : ''})` }) })
    this.socket.on('error', error => { this.finish({ detail: `socket error: ${error.message}` }) })
    this.socket.on('unexpected-response', (_request, response) => {
      this.finish({ fatal: true, detail: `handshake refused with HTTP ${response.statusCode}` })
    })
  }

  get connected(): boolean { return this.subscribed && !this.finished }

  /** Resolves once the bot subscribed, rejects when the gateway refused the credentials or the socket died first. */
  async open(): Promise<void> { await this.ready }

  async done(): Promise<void> { await this.closedSignal }

  private async subscribe(): Promise<void> {
    try {
      const frame = await this.exchange('aibot_subscribe', { bot_id: this.bot.botId, secret: this.bot.secret }, AUTH_TIMEOUT_MS)
      if (frame.errcode !== 0) {
        this.rejectReady(new Error(`wecom: aibot_subscribe rejected with errcode ${frame.errcode ?? 'unknown'} ${frame.errmsg ?? ''}`.trim()))
        this.finish({ fatal: true, detail: `subscribe rejected: ${frame.errmsg ?? frame.errcode ?? ''}` })
        return
      }
      this.subscribed = true
      this.resolveReady()
      this.heartbeat = setInterval(() => { this.beat() }, HEARTBEAT_MS)
      this.onNotice('connected')
    } catch (error) {
      this.rejectReady(error as Error)
      this.finish({ fatal: true, detail: String(error) })
    }
  }

  private beat(): void {
    if (this.misses >= HEARTBEAT_MISSES) {
      this.finish({ detail: 'heartbeat timeout' })
      return
    }
    this.misses += 1
    this.exchange('ping', undefined, ACK_TIMEOUT_MS)
      .then(() => { this.misses = 0; this.onNotice('connected') })
      .catch(() => { /* a missed pong counts toward the heartbeat budget */ })
  }

  private receive(text: string): void {
    if (!text) return
    let frame: Frame
    try { frame = JSON.parse(text) as Frame } catch { return }
    if (frame.cmd === 'aibot_msg_callback') {
      const parsed = MessageSchema.safeParse(frame.body)
      if (!parsed.success) return
      const reqId = frame.headers?.req_id ?? ''
      try { this.onMessage(parsed.data, reqId) } catch { /* a callback failure never kills the socket */ }
      return
    }
    if (frame.cmd === 'aibot_event_callback') {
      const event = (frame.body as { event?: { eventtype?: string } } | undefined)?.event
      // A newer subscriber kicked this connection; reconnecting would kick it back, so the loop stops instead.
      if (event?.eventtype === 'disconnected_event') this.finish({ contended: true, detail: 'another connection subscribed' })
      return
    }
    const reqId = frame.headers?.req_id ?? ''
    const pending = reqId ? this.pending.get(reqId) : undefined
    if (!pending) return
    this.pending.delete(reqId)
    clearTimeout(pending.timer)
    pending.resolve(frame)
  }

  private exchange(cmd: string, body: unknown, timeout = ACK_TIMEOUT_MS): Promise<Frame> {
    const reqId = randomId(cmd)
    return new Promise((resolve, reject) => {
      if (this.finished) { reject(new Error('wecom: connection closed')); return }
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error(`wecom: ${cmd} ack timeout`))
      }, timeout)
      this.pending.set(reqId, { resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ cmd, headers: { req_id: reqId }, ...(body === undefined ? {} : { body }) }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(reqId)
        reject(error as Error)
      }
    })
  }

  /**
   * Replies in the message's own `req_id` window. Frames for one `req_id` are chained: the gateway echoes only the
   * `req_id`, so two in flight at once would make the acks indistinguishable.
   */
  respond(reqId: string, text: string): Promise<void> {
    const previous = this.replyChains.get(reqId) ?? Promise.resolve()
    const sending = previous.then(() => this.sendReply(reqId, text), () => this.sendReply(reqId, text))
    const chain = sending.then(() => undefined, () => undefined)
    this.replyChains.set(reqId, chain)
    void chain.then(() => { if (this.replyChains.get(reqId) === chain) this.replyChains.delete(reqId) })
    return sending
  }

  private async sendReply(reqId: string, text: string): Promise<void> {
    for (const chunk of replyChunks(text)) {
      const frame = await this.replyFrame(reqId, chunk)
      if (frame.errcode !== 0) throw new Error(`wecom: aibot_respond_msg errcode ${frame.errcode ?? 'unknown'} ${frame.errmsg ?? ''}`.trim())
    }
  }

  private replyFrame(reqId: string, chunk: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
      if (this.finished) { reject(new Error('wecom: connection closed')); return }
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error('wecom: aibot_respond_msg ack timeout'))
      }, ACK_TIMEOUT_MS)
      this.pending.set(reqId, { resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ cmd: 'aibot_respond_msg', headers: { req_id: reqId }, body: { msgtype: 'text', text: { content: chunk } } }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(reqId)
        reject(error as Error)
      }
    })
  }

  /** Sends outside a request window; `aibot_send_msg` takes markdown and rejects plain text. */
  async send(chat: string, chatType: 'single' | 'group', text: string): Promise<void> {
    for (const chunk of replyChunks(text)) {
      const frame = await this.exchange('aibot_send_msg', {
        chatid: chat, chat_type: chatType === 'group' ? 2 : 1, msgtype: 'markdown', markdown: { content: chunk },
      })
      if (frame.errcode !== 0) throw new Error(`wecom: aibot_send_msg errcode ${frame.errcode ?? 'unknown'} ${frame.errmsg ?? ''}`.trim())
    }
  }

  close(): void { this.finish({ detail: 'closed by the Source' }) }

  private finish(reason: CloseReason): void {
    if (this.finished) return
    this.finished = true
    this.reason = reason
    if (this.heartbeat) clearInterval(this.heartbeat)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason.detail ?? 'wecom: connection closed'))
    }
    this.pending.clear()
    try { this.socket.close() } catch { /* already closing */ }
    this.rejectReady(new Error(reason.detail ?? 'wecom: connection closed'))
    this.resolveClosed()
  }
}

/** The subscribed connection of this process, used by the outbound adapter; one bot has at most one live connection. */
let live: Connection | undefined

async function loadBot(file: string): Promise<WecomBot> {
  return BotSchema.parse(JSON.parse(await readFile(file, 'utf8')))
}

export async function sendWecom(message: OutboundMessage): Promise<'sent' | 'gone'> {
  const address = message.channel.address
  const chat = String(address.chat ?? '')
  const chatType = address.chatType === 'group' ? 'group' : 'single'
  const reqId = String(address.req ?? '')
  const connection = live
  if (!connection || !connection.connected) return 'gone'
  if (reqId) {
    try {
      await connection.respond(reqId, message.text)
      return 'sent'
    } catch {
      // The reply window may have closed while the request was assessed; the proactive path below still reaches the chat.
    }
  }
  if (!chat) throw new Error('Missing WeCom reply target')
  await connection.send(chat, chatType, message.text)
  return 'sent'
}

export const wecomKind: SourceKind<WecomConfig> = {
  kind: SOURCE,
  title: { zh: '企业微信智能机器人', en: 'WeCom intelligent robot' },
  description: { zh: '通过长连接接收企业微信智能机器人的单聊和群聊消息，回复发回同一会话。',
    en: 'Receives single and group chat messages of an Enterprise WeChat intelligent robot over a long connection and replies to the same conversation.' },
  schema: ConfigSchema,
  fields: [
    { key: 'botFile', type: 'text', label: { zh: '机器人凭据文件', en: 'Bot credential file' },
      hint: { zh: '机器人 ID 和 Secret 的 JSON。留空时读取 stateDir/wecom/bot.json。', en: 'JSON with the bot ID and secret. Empty reads stateDir/wecom/bot.json.' } },
    { key: 'directMessages', type: 'switch', label: { zh: '接收单聊', en: 'Direct messages' } },
    { key: 'groups', type: 'rows', label: { zh: '接收的群聊', en: 'Group chats' }, columns: [
      { key: 'id', type: 'text', label: { zh: '群聊 chatid', en: 'Chat ID' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
  ],
  health: [SOURCE],
  scope({ meta }, config) {
    if ((meta.chatType ?? 'single') !== 'group') {
      return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    }
    const chatId = String(meta.chatId ?? '')
    return config.groups.some(group => group.id === chatId)
      ? { listened: true, observed: false, row: 'group' }
      : { listened: false, reason: 'group_not_allowed' }
  },
  channel: {
    allowed: address => Boolean(address.chat),
    send: (_host, message) => sendWecom(message),
    link: address => ({ url: '', label: { zh: `企业微信会话 ${address.chat ?? ''}`, en: `WeCom chat ${address.chat ?? ''}` } }),
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().min(1), name: z.string().trim().max(100).optional() }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' }, columns: [
      { key: 'id', type: 'text', label: { zh: '发送者 userid', en: 'Sender userid' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] }],
    explicit: { zh: '名单里的人单聊机器人，或在群里 @机器人。', en: 'Someone on the list messages the bot directly, or mentions it in a group.' },
    rows: () => [
      { id: 'direct', label: { zh: '单聊', en: 'Direct messages' }, note: { zh: '一对一对话', en: 'One-to-one conversation' },
        cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: false } },
      { id: 'group', label: { zh: '群聊', en: 'Group chats' }, note: { zh: '被 @ 的群消息', en: 'Mentions in a group' },
        cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: false } },
    ],
  },
}

export const name = 'dsh-superagent-wecom'
export const inject = ['orchestrator']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(wecomKind), 'wecom: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runWecom(sourceContext(ctx.orchestrator, wecomKind), controller.signal)
    return async () => { controller.abort(); await running }
  })
}

export async function runWecom(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  if (!ctx.configured()) { ctx.report(SOURCE, health('paused', 'setupPending')); return }
  let failures = 0
  let received = 0
  let backoff = 1000
  while (!signal.aborted) {
    const config = ctx.config<WecomConfig>(SOURCE)
    if (!config) { ctx.report(SOURCE, health('paused', 'sourceOff')); await delay(5000, undefined, { signal }).catch(() => {}); continue }
    const botFile = config.botFile || join(ctx.deployment.stateDir, 'wecom', 'bot.json')
    let bot: WecomBot
    try { bot = await loadBot(botFile) } catch {
      ctx.report(SOURCE, health('paused', 'wecomBotMissing'))
      await delay(10_000, undefined, { signal }).catch(() => {})
      continue
    }
    const connection = new Connection(bot, (message, reqId) => {
      const trigger = wecomTrigger(message, reqId)
      if (!trigger) return
      void Promise.resolve(ctx.receive(trigger)).then(() => {
        received += 1
        ctx.report(SOURCE, { state: 'ready', detail: `connected; ${received} messages`, at: new Date().toISOString() })
      }).catch((error: unknown) => { ctx.report(SOURCE, health('error', 'pollFailures', { count: '1', error: String(error) })) })
    }, detail => {
      ctx.report(SOURCE, { state: 'ready', detail: `${detail}; ${received} messages`, at: new Date().toISOString() })
    })
    live = connection
    try {
      await connection.open()
      failures = 0
      backoff = 1000
      ctx.report(SOURCE, { state: 'ready', detail: `connected; ${received} messages`, at: new Date().toISOString() })
      await connection.done()
    } catch (error) {
      failures += 1
      if (connection.reason.fatal) {
        ctx.report(SOURCE, health('error', 'pollFailures', { count: String(failures), error: String(error) }))
        live = undefined
        return
      }
      if (!signal.aborted) ctx.report(SOURCE, health('error', 'pollFailures', { count: String(failures), error: String(error) }))
    } finally {
      live = undefined
    }
    if (connection.reason.contended && !signal.aborted) { ctx.report(SOURCE, health('error', 'wecomContended')); return }
    if (signal.aborted) return
    await delay(backoff, undefined, { signal }).catch(() => {})
    backoff = Math.min(backoff * 2, 30_000)
  }
}
