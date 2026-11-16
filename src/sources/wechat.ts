/** WeChat ClawBot (iLink) Source: text messages in direct chats become Triggers, replies go back through the bot. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { key, type OutboundMessage, type Trigger } from '../core/index.ts'
import { record } from '../kv.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'

export const SOURCE = 'wechat'
const CURSOR = record<string>('wechat-cursor')
const DEFAULT_ACCOUNT = join(homedir(), '.dsh/state/superagent/wechat/account.json')
let accountFile = DEFAULT_ACCOUNT

const ConfigSchema = z.object({
  /** ClawBot account JSON written by the login helper. Empty reads stateDir/wechat/account.json. */
  accountFile: z.string().default(''),
  directMessages: z.boolean().default(true),
  users: z.array(z.object({ id: z.string().min(1), name: z.string().trim().max(60).optional() }).strict())
    .refine(users => new Set(users.map(user => user.id)).size === users.length, 'Duplicate user IDs').default([]),
}).strict()
export type WechatConfig = z.infer<typeof ConfigSchema>

const AccountSchema = z.object({ token: z.string().min(1), baseurl: z.string().default('https://ilinkai.weixin.qq.com') })
type Account = z.infer<typeof AccountSchema>

const MessageSchema = z.looseObject({
  message_id: z.number(), from_user_id: z.string(), to_user_id: z.string().optional(),
  message_type: z.number(), context_token: z.string().optional(), group_id: z.string().optional(),
  root_id: z.number().optional(), create_time_ms: z.number(),
  item_list: z.array(z.looseObject({ type: z.number(), text_item: z.looseObject({ text: z.string() }).optional(),
    image_item: z.looseObject({ aeskey: z.string() }).optional() })).default([]),
})
type Message = z.infer<typeof MessageSchema>

const UpdatesSchema = z.looseObject({ ret: z.number().optional(), get_updates_buf: z.string().optional(), msgs: z.array(MessageSchema).optional() })

function headers(token?: string): Record<string, string> {
  return { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(String(randomInt(0, 0xFFFFFFFF))).toString('base64'),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function loadAccount(): Promise<Account> {
  return AccountSchema.parse(JSON.parse(await readFile(accountFile, 'utf8')))
}

async function call<T>(account: Account, path: string, body: unknown, signal: AbortSignal, timeout = 95_000): Promise<T> {
  const response = await fetch(`${account.baseurl.replace(/\/$/, '')}/${path}`, {
    method: 'POST', headers: headers(account.token), body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`wechat ${path}: HTTP ${response.status} ${text.slice(0, 200)}`)
  return JSON.parse(text) as T
}

/** Text of a message; an image-only message carries a placeholder because the Source does not read media yet. */
export function wechatText(message: Message): string {
  const text = message.item_list.filter(item => item.type === 1).map(item => item.text_item?.text ?? '').join('\n').trim()
  if (text) return text
  return message.item_list.some(item => item.type === 2) ? '[图片]' : ''
}

export function wechatTrigger(message: Message): Trigger | undefined {
  const text = wechatText(message)
  if (!text) return undefined
  const direct = !message.group_id
  const thread = direct ? message.from_user_id : `${message.group_id}:${message.root_id || message.message_id}`
  return {
    id: key(SOURCE, String(message.message_id)),
    source: SOURCE,
    threads: [{ source: SOURCE, id: thread }],
    actor: { source: SOURCE, id: message.from_user_id },
    human: true,
    ...(direct ? { addressed: 'direct' as const } : {}),
    at: new Date(message.create_time_ms).toISOString(),
    text,
    channel: { source: SOURCE, thread: `wechat:${thread}`,
      address: { user: message.from_user_id, context: message.context_token ?? '', message: String(message.message_id) } },
    meta: { userId: message.from_user_id, messageId: String(message.message_id), groupId: message.group_id ?? '' },
  }
}

export async function sendWechat(message: OutboundMessage): Promise<'sent' | 'gone'> {
  const account = await loadAccount()
  const user = String(message.channel.address.user ?? '')
  const context = String(message.channel.address.context ?? '')
  if (!user || !context) throw new Error('Missing WeChat reply target')
  const clientId = `openclaw-weixin-${createHash('sha256').update(message.id).digest('hex').slice(0, 32)}`
  const response = await fetch(`${account.baseurl.replace(/\/$/, '')}/ilink/bot/sendmessage`, {
    method: 'POST', headers: headers(account.token),
    body: JSON.stringify({ msg: { from_user_id: '', to_user_id: user, client_id: clientId, message_type: 2,
      message_state: 2, context_token: context, item_list: [{ type: 1, text_item: { text: message.text } }] },
    base_info: { channel_version: '1.0.2' } }),
    signal: AbortSignal.timeout(40_000),
  })
  const text = await response.text()
  if (response.ok) return 'sent'
  if (response.status === 400 && /context|token|expired/i.test(text)) return 'gone'
  throw new Error(`wechat send: HTTP ${response.status} ${text.slice(0, 200)}`)
}

export const wechatKind: SourceKind<WechatConfig> = {
  kind: SOURCE,
  title: { zh: '微信 ClawBot', en: 'WeChat ClawBot' },
  description: { zh: '接收微信 ClawBot 私聊里的文本消息，回复发回同一对话。', en: 'Receives text messages in WeChat ClawBot direct chats and replies to the same conversation.' },
  schema: ConfigSchema,
  fields: [
    { key: 'accountFile', type: 'text', label: { zh: 'ClawBot 账号文件', en: 'ClawBot account file' },
      hint: { zh: '登录助手写出的 JSON（token、baseurl）。留空时读取 stateDir/wechat/account.json。', en: 'The JSON written by the login helper (token, baseurl). Empty reads stateDir/wechat/account.json.' } },
    { key: 'directMessages', type: 'switch', label: { zh: '接收私聊', en: 'Direct messages' } },
    { key: 'users', type: 'rows', label: { zh: '已知用户', en: 'Known users' }, columns: [
      { key: 'id', type: 'text', label: { zh: '用户 ID', en: 'User ID' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
  ],
  health: [SOURCE],
  scope({ meta }, config) {
    if (!meta.groupId) return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    return { listened: false, reason: 'group_messages_not_supported' }
  },
  channel: {
    allowed: address => Boolean(address.user),
    send: (_host, message) => sendWechat(message),
    link: address => ({ url: '', label: { zh: `微信用户 ${address.user ?? ''}`, en: `WeChat user ${address.user ?? ''}` } }),
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().min(1), name: z.string().trim().max(100).optional() }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' }, columns: [
      { key: 'id', type: 'text', label: { zh: '发送者', en: 'Sender' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] }],
    explicit: { zh: '名单里的人给机器人发私聊。', en: 'Someone on the list sends the bot a direct message.' },
    rows: () => [{ id: 'direct', label: { zh: '私聊', en: 'Direct messages' }, note: { zh: '一对一对话', en: 'One-to-one conversation' },
      cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: false } }],
  },
}

export const name = 'dsh-superagent-wechat'
export const inject = ['orchestrator']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(wechatKind), 'wechat: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runWechat(sourceContext(ctx.orchestrator, wechatKind), controller.signal)
    return async () => { controller.abort(); await running }
  })
}

export async function runWechat(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  if (!ctx.configured()) { ctx.report(SOURCE, health('paused', 'setupPending')); return }
  let failures = 0
  while (!signal.aborted) {
    const config = ctx.config<WechatConfig>(SOURCE)
    if (!config) { ctx.report(SOURCE, health('paused', 'sourceOff')); await delay(5000, undefined, { signal }).catch(() => {}); continue }
    accountFile = config.accountFile || join(ctx.deployment.stateDir, 'wechat', 'account.json')
    try {
      const account = await loadAccount()
      const at = new Date().toISOString()
      const updates = await call<z.infer<typeof UpdatesSchema>>(account, 'ilink/bot/getupdates',
        { get_updates_buf: ctx.state.get(CURSOR) ?? '', base_info: { channel_version: '1.0.2' } }, signal)
      let received = 0
      for (const message of updates.msgs ?? []) {
        const trigger = wechatTrigger(message)
        if (!trigger) continue
        await ctx.receive(trigger)
        received += 1
      }
      if (updates.get_updates_buf) ctx.state.set(CURSOR, updates.get_updates_buf)
      failures = 0
      ctx.report(SOURCE, { state: 'ready', detail: `${received} messages`, at })
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= 3) ctx.report(SOURCE, health('error', 'pollFailures', { count: String(failures), error: String(error) }))
      await delay(3000, undefined, { signal }).catch(() => {})
    }
  }
}
