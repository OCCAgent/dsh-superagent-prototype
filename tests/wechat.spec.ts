import { describe, expect, it } from 'vitest'
import { wechatText, wechatTrigger } from '../src/sources/wechat.ts'

const message = (over: Record<string, unknown> = {}) => ({
  message_id: 42, from_user_id: 'user@im.wechat', message_type: 1, create_time_ms: 1_760_000_000_000,
  context_token: 'ctx', item_list: [{ type: 1, text_item: { text: '你是谁' } }], ...over,
})

describe('wechat source', () => {
  it('maps a direct text message to a Trigger', () => {
    const trigger = wechatTrigger(message() as never)
    expect(trigger).toBeDefined()
    expect(trigger?.id).toMatch(/^[a-f0-9]{32}$/)
    expect(wechatTrigger(message() as never)?.id).toBe(trigger?.id)
    expect(trigger?.threads).toEqual([{ source: 'wechat', id: 'user@im.wechat' }])
    expect(trigger?.addressed).toBe('direct')
    expect(trigger?.channel?.address).toMatchObject({ user: 'user@im.wechat', context: 'ctx', message: '42' })
    expect(trigger?.text).toBe('你是谁')
  })

  it('keeps a group message on its root thread and does not mark it addressed', () => {
    const trigger = wechatTrigger(message({ group_id: 'chat@chatroom', root_id: 7 }) as never)
    expect(trigger?.threads[0]?.id).toBe('chat@chatroom:7')
    expect(trigger?.addressed).toBeUndefined()
  })

  it('turns an image-only message into a placeholder instead of dropping it', () => {
    expect(wechatText(message({ item_list: [{ type: 2, image_item: { aeskey: 'k' } }] }) as never)).toBe('[图片]')
    expect(wechatTrigger(message({ item_list: [{ type: 2, image_item: { aeskey: 'k' } }] }) as never)).toBeDefined()
  })

  it('drops a message with no text and no image', () => {
    expect(wechatTrigger(message({ item_list: [] }) as never)).toBeUndefined()
  })
})
