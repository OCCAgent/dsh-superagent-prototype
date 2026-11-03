/**
 * Third-layer composite scenario: one Feishu request goes through intake, a worker's decomposition, a queued second
 * request, a person's change, a host restart and a merge acceptance on the real Runtime composition.
 *
 * The model-dependent steps (the router decision and the worker's reports) are scripted, so this measures the coordination
 * path the composite scenario depends on, not model quality. Its readiness case records the unlinked cross-channel gap the
 * evaluation found, so the live run stays gated. `experiments/layer3/README.md` states both boundaries; the machine-readable
 * result is `experiments/layer3/results/layer3-composite.json`.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Trigger } from '../src/core/index.ts'
import { CHAT, feishu, startRuntime, type Host } from './fixtures/host.ts'

interface StageResult { stage: string; held: boolean; evidence: Record<string, unknown> }
const results: Record<string, unknown> = {
  environment: { harness: 'in-memory Runtime + fake DSH host', repeats: 1, maxWorkers: 1 },
  composite: {}, readiness_gate: {}, verdict: {},
}

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })
afterAll(() => {
  const composite = results.composite as { held?: boolean }
  const gate = results.readiness_gate as { met?: boolean; blocked_by?: string }
  results.verdict = {
    composite_mechanism_held: composite.held === true,
    live_gate_met: gate.met === true,
    blocked_by: gate.met === true ? null : gate.blocked_by ?? null,
    rule: 'the composite path may run only when every readiness criterion holds; a failing criterion names the layer.',
  }
  const file = join(process.cwd(), 'experiments/layer3/results/layer3-composite.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`)
})

const settingsOf = (target: Host) => target.runtime.store.settings()
const assignmentState = (target: Host, ticketId: string) => target.runtime.store.tickets.get(ticketId)!.assignments.at(-1)!.state
const reportOf = (target: Host, ticketId: string) => target.runtime.store.tickets.get(ticketId)!.assignments.at(-1)!.report
async function receive(target: Host, trigger: Trigger) {
  target.runtime.receive(trigger)
  await target.runtime.idle()
}
/** JSON payloads the worker of `ticketId` received. */
const workerDeliveries = (target: Host, ticketId: string) => target.deliveries.mock.calls
  .map(([call]) => call).filter(call => call.sessionId === `worker-${ticketId}`)

describe('layer 3 composite scenario', () => {
  it('carries one request through decomposition, a queued request, a person change, a restart and a merge acceptance', async () => {
    host = await startRuntime()
    host.runtime.store.saveSettings({ ...settingsOf(host), executor: { ...settingsOf(host).executor, maxWorkers: 1 } })

    // 1. Requirement: one person's Feishu mention becomes a ticket and a running assignment, with its own directory.
    const request = feishu('1', '@bot 把学习网站整合为可发布版：统一配色、补测试日志、无死链、开汇总 PR、给验收报告')
    host.runtime.receive(request)
    await host.runtime.idle()
    const accepted = await host.route({ kind: 'accept', trigger_id: request.id, title: 'Layer 3 composite release', worktree_name: 'composite-release', acknowledgement: '收到，开始做。' })
    await host.runtime.idle()
    const ticketId = (accepted.ticket as { ticket_id: string }).ticket_id
    const ticket = host.runtime.store.tickets.get(ticketId)!
    const directory = ticket.execution!.directory
    const worker = `worker-${ticketId}`
    const requirementDelivered = workerDeliveries(host, ticketId).some(call => call.text.includes(request.id))
    const startedRunning = assignmentState(host, ticketId) === 'running'
    expect(startedRunning).toBe(true)
    expect(existsSync(directory)).toBe(true)
    expect(requirementDelivered).toBe(true)

    // 2. Decomposition: the worker states its work units before executing; the report is retained on the assignment.
    await host.runTool(worker, 'orchestrator_report', {
      state: 'progress',
      summary: '拆解：WU-A 统一 Ben 配色；WU-B 测试日志补阶段 1 实测数据；WU-C 全站死链自检与汇总 PR。单 worker 顺序执行，先 WU-A。',
    })
    const plan = reportOf(host, ticketId)?.summary ?? ''
    const decompositionRetained = plan.includes('WU-A') && plan.includes('WU-C')

    // 3. Execution keeps accepting work while the only slot is busy: the second request waits in its own directory.
    const second = await host.acceptedTicket(feishu('2', '@bot 另一个独立请求：修正页面标题'))
    const queued = assignmentState(host, second.ticket.id)
    const directories = [ticket, second.ticket].map(item => item.execution!.directory)
    const crosstalk = workerDeliveries(host, ticketId).some(call => call.text.includes(second.ticket.id) || call.text.includes(second.ticket.execution!.directory))
    expect(queued).toBe('pending')
    expect(new Set(directories).size).toBe(2)
    expect(crosstalk).toBe(false)

    // 4. Person change: a same-thread follow-up reaches the running ticket and starts no new ticket or Eval.
    const change = feishu('9', '决策：配色统一 OK，但首页标语换成“让智能体接管长程工作”。', { mentions: [], root_id: 'om_1' })
    await receive(host, change)
    const changed = host.runtime.store.tickets.get(ticketId)!
    const changeAttached = changed.inputs.some(input => input.kind === 'trigger' && input.triggerId === change.id)
    const changeDelivered = workerDeliveries(host, ticketId).some(call => call.text.includes(change.id))
    const newTickets = host.runtime.store.tickets.list().filter(item => item.origin.triggerId === change.id)
    expect(changeAttached).toBe(true)
    expect(changeDelivered).toBe(true)
    expect(newTickets).toHaveLength(0)

    // 5. Acceptance delivery: the ticket's PR is bound, the worker reports ready over it, and the person gets the link.
    host.runtime.engine.bindThread(ticketId, { source: 'github', id: '200' }, true)
    await host.runTool(worker, 'orchestrator_report', { state: 'ready', summary: '汇总 PR #200 已交付：WU-A/B/C 完成，自检 0 error，附 Before/After 与发布建议。' })
    expect(host.runtime.store.tickets.get(ticketId)!.ended).toBeUndefined()
    const replied = await host.runTool(host.runtime.masterId, 'orchestrator_reply', { ticket_id: ticketId, purpose: 'result', text: '第三层复合场景已交付：[PR #200](https://github.com/acme/widgets/pull/200) 待验收。' })
    expect(replied).toEqual({ status: 'sent' })
    const prLinkSent = replied.status === 'sent'

    // 6. Recovery: a host restart keeps the ticket, its PR, its directory and the change, and does not duplicate the ticket.
    const beforeRestart = host.runtime.store.tickets.get(ticketId)!
    const next = await host.restartHost()
    await next.idle()
    const recovered = next.store.tickets.get(ticketId)!
    const recoveryNote = recovered.inputs.some(input => input.kind === 'text' && (input.text ?? '').includes('host restarted'))
    const changeSurvived = recovered.inputs.some(input => input.kind === 'trigger' && input.triggerId === change.id)
    const prSurvived = recovered.follows?.some(item => item.thread === 'github:200') === true
    const recoveryStates = beforeRestart.assignments.map(item => item.state)
    // The worker had already reported ready and waits for the merge, so the host keeps its Session instead of adding a
    // restoration note (that note is for an interrupted running report; see the four-feature persistence baseline).
    expect(recoveryNote).toBe(false)
    expect(recovered.assignments).toHaveLength(beforeRestart.assignments.length)
    expect(changeSurvived).toBe(true)
    expect(prSurvived).toBe(true)
    expect(existsSync(recovered.execution!.directory)).toBe(true)
    expect(next.store.tickets.list().filter(item => item.id === ticketId)).toHaveLength(1)
    expect(recovered.ended).toBeUndefined()

    // 7. Acceptance: the person's merge after the restart ends the ticket as merged and notifies the conversation.
    const sent: string[] = []
    const send = next.sources.send.bind(next.sources)
    vi.spyOn(next.sources, 'send').mockImplementation(async (message, commands) => {
      sent.push(message.text)
      return send(message, commands)
    })
    const queuedNotices: string[] = []
    const queue = next.outbox.send.bind(next.outbox)
    vi.spyOn(next.outbox, 'send').mockImplementation(message => { queuedNotices.push(message.text); queue(message) })
    next.engine.threadClosed({ source: 'github', id: '200' }, 'merged', new Date().toISOString())
    await next.idle()
    await next.outbox.sent()
    const ended = next.store.tickets.get(ticketId)!
    const notice = queuedNotices.find(text => text.includes('#200')) ?? sent.find(text => text.includes('#200'))
    expect(ended.ended?.outcome).toBe('merged')
    expect(notice).toBeTruthy()

    const stages: StageResult[] = [
      { stage: 'requirement', held: startedRunning && existsSync(directory), evidence: { assignment_running: startedRunning, directory_created: existsSync(directory), requirement_delivered: requirementDelivered } },
      { stage: 'decomposition', held: decompositionRetained, evidence: { work_units: 3, report_retained: decompositionRetained } },
      { stage: 'execution', held: queued === 'pending' && new Set(directories).size === 2 && !crosstalk, evidence: { max_workers: 1, second_request: queued, distinct_directories: new Set(directories).size, crosstalk: crosstalk ? 1 : 0 } },
      { stage: 'change', held: changeAttached && changeDelivered && newTickets.length === 0, evidence: { attached: changeAttached, delivered: changeDelivered, new_tickets: newTickets.length } },
      { stage: 'recovery', held: changeSurvived && prSurvived && existsSync(recovered.execution!.directory) && recovered.assignments.length === beforeRestart.assignments.length, evidence: { mode: 'restart after a ready report keeps the Session; an interrupted running report gets a restoration note (four-feature D1/D2)', recovery_note: recoveryNote, change_survived: changeSurvived, pr_survived: prSurvived, directory_preserved: existsSync(recovered.execution!.directory), duplicate_tickets: 0, assignment_states_before: recoveryStates, assignment_state_after: assignmentState(host, ticketId) } },
      { stage: 'acceptance', held: ended.ended?.outcome === 'merged' && prLinkSent, evidence: { outcome: ended.ended?.outcome, result_replied: prLinkSent, merge_notice: notice ?? null } },
    ]
    results.composite = {
      held: stages.every(stage => stage.held),
      stages,
      human_interventions: { decision: 2, corrective: 0, note: 'the request and the same-thread change are decisions; no corrective intervention was needed' },
      token_budget: { cap_total_tokens_per_work_unit: 26_100_000, measured_here: false, note: 'the mechanism harness scripts model steps, so token cost is measured from the live session logs instead' },
    }
    expect(stages.filter(stage => !stage.held)).toEqual([])
  })

  it('readiness gate: an unlinked change in another chat is a separate candidate, so the live run stays gated', async () => {
    host = await startRuntime()
    const configured = settingsOf(host)
    host.runtime.store.saveSettings({ ...configured, sources: { ...configured.sources, feishu: { enabled: true,
      config: { ...configured.sources.feishu!.config, chats: [{ chatId: CHAT, listen: 'all' }, { chatId: 'oc_team2', listen: 'all' }] } } } })
    const first = await host.acceptedTicket(feishu('1', '@bot 把设置页的保存按钮改成绿色'))
    const unlinked = feishu('2', '@bot 把设置页保存按钮改成蓝色', { chat_id: 'oc_team2' })
    await receive(host, unlinked)
    const ticket = host.runtime.store.tickets.get(first.ticket.id)!
    const attached = ticket.inputs.some(input => input.kind === 'trigger' && input.triggerId === unlinked.id)
    const card = host.relays(host.runtime.masterId).filter(item => item.kind === 'candidate' && item.trigger_id === unlinked.id).at(-1)
    results.readiness_gate = {
      met: false,
      criterion: 'a person\'s same-task change on an unlinked channel must attach to the existing ticket',
      case: 'chat A request, chat B change with no explicit reference',
      attached: attached ? 1 : 0,
      related_tickets_seen: card?.tickets_total ?? 0,
      blocked_by: 'C4/architecture',
      reason: 'Correlation adds context but never routes; only the originating thread, a ticket PR thread or an explicit pointer attaches. The same-thread form passes (tested above and observed live); the unlinked cross-channel form has no path.',
    }
    expect(attached).toBe(false)
    expect(card?.tickets_total).toBe(0)
  })
})
