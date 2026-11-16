import { describe, expect, it } from 'vitest'
import { replyChunks, wecomKind, wecomText, wecomTrigger } from '../src/sources/wecom.ts'

const message = (over: Record<string, unknown> = {}) => ({
  msgid: 'msg-1', chatid: 'zhangsan', chattype: 'single', from: { userid: 'zhangsan' },
  msgtype: 'text', createtime: 1_760_000_000, text: { content: '你是谁' }, ...over,
})

describe('wecom source', () => {
  it('maps a single-chat text message to a Trigger', () => {
    const trigger = wecomTrigger(message() as never, 'req-1')
    expect(trigger).toBeDefined()
    expect(trigger?.id).toMatch(/^[a-f0-9]{32}$/)
    expect(wecomTrigger(message() as never, 'req-1')?.id).toBe(trigger?.id)
    expect(trigger?.threads).toEqual([{ source: 'wecom', id: 'user:zhangsan' }])
    expect(trigger?.addressed).toBe('direct')
    expect(trigger?.text).toBe('你是谁')
    expect(trigger?.channel?.address).toMatchObject({ user: 'zhangsan', chat: 'zhangsan', chatType: 'single', req: 'req-1', message: 'msg-1' })
    expect(trigger?.at).toBe(new Date(1_760_000_000_000).toISOString())
  })

  it('keeps a group message on the chat thread and marks it a mention', () => {
    const trigger = wecomTrigger(message({ chatid: 'chat-9', chattype: 'group', text: { content: '@机器人 帮我看看' } }) as never, 'req-2')
    expect(trigger?.threads).toEqual([{ source: 'wecom', id: 'group:chat-9' }])
    expect(trigger?.addressed).toBe('mention')
    expect(trigger?.channel?.address).toMatchObject({ chat: 'chat-9', chatType: 'group' })
  })

  it('turns media into a placeholder instead of dropping the message', () => {
    expect(wecomText(message({ msgtype: 'image', text: undefined, image: { url: 'https://x', aeskey: 'k' } }) as never)).toBe('[图片]')
    expect(wecomText(message({ msgtype: 'file', text: undefined, file: { url: 'https://x' } }) as never)).toBe('[文件]')
    expect(wecomTrigger(message({ msgtype: 'image', text: undefined, image: { url: 'https://x' } }) as never, 'req-3')).toBeDefined()
  })

  it('reads the transcript of a voice message', () => {
    expect(wecomText(message({ msgtype: 'voice', text: undefined, voice: { content: ' 看一下日志 ' } }) as never)).toBe('看一下日志')
  })

  it('flattens a mixed message in composition order', () => {
    const mixed = message({ msgtype: 'mixed', text: undefined, mixed: { msg_item: [
      { msgtype: 'text', text: { content: '这两处' } }, { msgtype: 'image', image: { url: 'https://x' } }, { msgtype: 'text', text: { content: '要改' } },
    ] } })
    expect(wecomText(mixed as never)).toBe('这两处\n[图片]\n要改')
  })

  it('drops a message with no readable body', () => {
    expect(wecomTrigger(message({ msgtype: 'event', text: undefined }) as never, 'req-4')).toBeUndefined()
    expect(wecomTrigger(message({ text: { content: '   ' } }) as never, 'req-5')).toBeUndefined()
  })

  it('chunks a long reply without losing bytes', () => {
    const text = Array.from({ length: 400 }, (_, index) => `第 ${index} 行，这是一段用于分片的文本。`).join('\n')
    const chunks = replyChunks(text, 2_000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 2_000)).toBe(true)
    expect(chunks.join('')).toBe(text)
  })
})

describe('wecom scope', () => {
  const config = (groups: { id: string }[] = []) => ({ botFile: '', directMessages: true, groups })

  it('listens to every group while the list is empty', () => {
    expect(wecomKind.scope?.({ meta: { chatType: 'group', chatId: 'chat-1' } }, config())).toMatchObject({ listened: true, row: 'group' })
  })

  it('narrows groups to the listed chats once one is listed', () => {
    expect(wecomKind.scope?.({ meta: { chatType: 'group', chatId: 'chat-1' } }, config([{ id: 'chat-2' }])))
      .toMatchObject({ listened: false, reason: 'group_not_allowed' })
    expect(wecomKind.scope?.({ meta: { chatType: 'group', chatId: 'chat-2' } }, config([{ id: 'chat-2' }])))
      .toMatchObject({ listened: true })
  })

  it('keeps direct messages behind their own switch', () => {
    expect(wecomKind.scope?.({ meta: { chatType: 'single' } }, { ...config(), directMessages: false }))
      .toMatchObject({ listened: false, reason: 'direct_messages_not_allowed' })
  })
})
