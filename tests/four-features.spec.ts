/**
 * Second-layer validation: the four Super-agent features on the real Runtime composition.
 *
 * Each experiment drives the real Engine, Store, subscriptions, gates, outbox and Executor slots through an in-memory DSH
 * host, with the model-dependent steps (router decisions and worker reports) scripted. It measures the coordination
 * guarantees, not model quality; `experiments/four-features/README.md` states that boundary and the live protocol.
 *
 * Each feature has a typical case, a perturbed case, and — for continuity and proactivity — a "should not happen"
 * negative case. The machine-readable result is `experiments/four-features/results/four-features.json`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { branchCiTrigger, commentTrigger } from '../src/sources/github-trigger.ts'
import { CHAT, feishu, startRuntime, type Host } from './fixtures/host.ts'
import { waitUntil } from './fixtures/async.ts'
import type { Trigger } from '../src/core/index.ts'

interface FeatureResults {
  environment: Record<string, unknown>
  continuity: Record<string, unknown>
  productivity: Record<string, unknown>
  proactivity: Record<string, unknown>
  persistence: Record<string, unknown>
  verdict: Record<string, unknown>
}
const results: FeatureResults = {
  environment: { harness: 'in-memory Runtime + fake DSH host', repeats: 1, maxWorkers: null },
  continuity: {}, productivity: {}, proactivity: {}, persistence: {}, verdict: {},
}

let host: Host | undefined
afterEach(async () => {
  await host?.stop()
  host = undefined
})
afterAll(() => {
  const held = (['continuity', 'productivity', 'proactivity', 'persistence'] as const).filter(feature => results[feature].held === true)
  const failed = (['continuity', 'productivity', 'proactivity', 'persistence'] as const).filter(feature => results[feature].held !== true)
  results.verdict = { features_held: held.length, features_total: 4, exit_criterion_met: held.length >= 3, held, failed,
    rule: 'at least three of four features hold; a failure names its architecture or implementation layer' }
  const file = join(process.cwd(), 'experiments/four-features/results/four-features.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`)
})

/** Receive one Trigger and let every queued pass run. */
async function receive(target: Host, trigger: Trigger) {
  target.runtime.receive(trigger)
  await target.runtime.idle()
}

function ruleAssessments(target: Host, matched: string[] = []) {
  return target.runtime.store.settings().policy.rules.filter(rule => rule.enabled)
    .map(rule => ({ rule_id: rule.id, matched: matched.includes(rule.id), reason: matched.includes(rule.id) ? 'matched by this experiment' : 'not this rule' }))
}
function settingsOf(target: Host) {
  return target.runtime.store.settings()
}
function assignmentState(target: Host, ticketId: string) {
  return target.runtime.store.tickets.get(ticketId)!.assignments.at(-1)!.state
}

describe('four features', () => {
  it('continuity: typical linked follow-up, negative unrelated chatter, and the specified unlinked cross-channel case', async () => {
    host = await startRuntime()
    // One shared base environment: two Feishu chats and the GitHub repository; only the case varies.
    const configured = settingsOf(host)
    host.runtime.store.saveSettings({ ...configured, sources: { ...configured.sources, feishu: { enabled: true,
      config: { ...configured.sources.feishu!.config, chats: [{ chatId: CHAT, listen: 'all' }, { chatId: 'oc_team2', listen: 'all' }] } } } })
    const { ticket, sessionId } = await host.acceptedTicket(feishu('1', '@bot 把设置页的保存按钮改成绿色'))
    const ticketCount = host.runtime.store.tickets.list().length
    host.runtime.engine.bindThread(ticket.id, { source: 'github', id: '42' }, true)

    // Typical: a requirement on the ticket PR, a different channel that does not quote the Feishu request.
    const cross = commentTrigger({
      id: 7001, body: '按钮文字也改成「保存」', user: { login: 'alice' },
      html_url: 'https://github.com/acme/widgets/pull/42#issuecomment-7001', created_at: '2026-09-09T00:10:00Z',
    }, { number: 42, isPr: true, url: 'https://github.com/acme/widgets/pull/42' }, 'conversation', 'agent-bot')
    await receive(host, cross)
    const ticketAfterCross = host.runtime.store.tickets.get(ticket.id)!
    const crossDelivered = ticketAfterCross.inputs.some(input => input.kind === 'trigger' && input.triggerId === cross.id)

    // Negative: unrelated chatter on another thread must not reach the ticket; the same-thread follow-up still does.
    const noise = feishu('2', '今天的午饭吃什么', { mentions: [], chat_id: 'oc_team2' })
    await receive(host, noise)
    const same = feishu('3', '下面再加一行说明', { mentions: [], root_id: 'om_1' })
    await receive(host, same)
    const ticketAfterPerturb = host.runtime.store.tickets.get(ticket.id)!
    const noiseLeaked = ticketAfterPerturb.inputs.some(input => input.kind === 'trigger' && input.triggerId === noise.id)
    const sameDelivered = ticketAfterPerturb.inputs.some(input => input.kind === 'trigger' && input.triggerId === same.id)

    // The case the spec calls for: a requirement on an unlinked channel, with no reference, should be recognised as an
    // update to the same task. The candidate carries no related ticket, so the system offers it as separate work.
    const unlinked = feishu('4', '@bot 设置页保存按钮改成蓝色', { chat_id: 'oc_team2' })
    await receive(host, unlinked)
    const card = host.relays(host.runtime.masterId).filter(item => item.kind === 'candidate' && item.trigger_id === unlinked.id).at(-1)
    const unlinkedDelivered = host.runtime.store.tickets.get(ticket.id)!.inputs.some(input => input.kind === 'trigger' && input.triggerId === unlinked.id)
    const accepted = await host.route({ kind: 'accept', trigger_id: unlinked.id, title: 'Blue save button', worktree_name: 'blue-save', acknowledgement: '收到。' })

    const linkedOk = crossDelivered && sameDelivered && !noiseLeaked
    const unlinkedOk = unlinkedDelivered && card?.tickets_total === 1
    results.continuity = {
      held: linkedOk && unlinkedOk,
      spec_case_met: unlinkedOk,
      cases: [
        { id: 'C1', kind: 'typical', scenario: 'PR comment on the ticket PR, no direct reference', attributed: crossDelivered ? 1 : 0, expected: 1, pass: crossDelivered },
        { id: 'C2', kind: 'negative', scenario: 'unrelated chatter on another thread must not attach', unrelated_leaked: noiseLeaked ? 1 : 0, expected: 0, pass: !noiseLeaked && sameDelivered },
        { id: 'C3', kind: 'specified-unlinked', scenario: 'requirement in Feishu chat B, no reference to chat A', auto_attributed: unlinkedDelivered ? 1 : 0, expected: 1, related_tickets_seen: card?.tickets_total ?? 0, pass: unlinkedOk },
      ],
      base_environment: { chats: 2, github_repository: 1 },
      new_tickets_from_linked_followups: host.runtime.store.tickets.list().length - ticketCount - 1,
      human_clarifications: 0,
      failure_layer: linkedOk && !unlinkedOk ? 'architecture' : null,
      failure_reason: linkedOk && !unlinkedOk
        ? 'The only structural links are the originating thread, a ticket PR thread and a trigger shared by several threads; Correlation adds context but never routes, so an unlinked channel yields a separate candidate carrying 0 related tickets. Attaching it would need an explicit pointer or the router attaching by meaning, which the assessment prompt does not ask for.'
        : null,
    }
    expect(crossDelivered).toBe(true)
    expect(noiseLeaked).toBe(false)
    expect(sameDelivered).toBe(true)
    expect(unlinkedDelivered).toBe(false)
    expect(card?.tickets_total).toBe(0)
    expect((accepted.ticket as { ticket_id: string }).ticket_id).not.toBe(ticket.id)
  })

  it('productivity: typical burst and perturbed steering while every worker slot is busy', async () => {
    host = await startRuntime()
    host.runtime.store.saveSettings({ ...settingsOf(host), executor: { ...settingsOf(host).executor, maxWorkers: 1 } })
    const tasks = [await host.acceptedTicket(feishu('1', '@bot 修复登录页的回归'))]
    for (const id of ['2', '3', '4', '5']) tasks.push(await host.acceptedTicket(feishu(id, `@bot 独立任务 ${id}`)))
    const one = tasks[0]!
    const two = tasks[1]!

    const runningWorkers = () => [...host!.agents.values()].filter(agent => agent.id !== host!.runtime.masterId && agent.status === 'running').length
    const busyStates = tasks.slice(1).map(item => assignmentState(host!, item.ticket.id))
    expect(busyStates).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(host.runtime.effects.pending('launch')).toBe(true)
    expect(runningWorkers()).toBe(1)

    // Perturbed: a person's follow-up reaches the running ticket while four launches queue, without waiting for a slot.
    const steer = feishu('20', '补充：只改移动端', { mentions: [], root_id: 'om_1' })
    await receive(host, steer)
    const steered = host.deliveries.mock.calls.some(([call]) => call.sessionId === `worker-${one.ticket.id}` && call.text.includes(steer.id))
    expect(steered).toBe(true)

    // Free the slot: the next queued ticket starts; still one worker at a time.
    const first = host.agents.get(one.sessionId)!
    first.status = 'idle'
    host.ctx.emit('agent/status', { agent: first, status: 'idle' } as never)
    await host.runtime.pump()
    await host.runtime.idle()
    await waitUntil(() => assignmentState(host!, two.ticket.id) === 'running')
    expect(runningWorkers()).toBe(1)

    const directories = tasks.map(item => item.ticket.execution!.directory)
    const deliveries = host.deliveries.mock.calls.map(([call]) => call)
    let crosstalk = 0
    for (const item of tasks) {
      const own = deliveries.filter(call => call.sessionId === `worker-${item.ticket.id}`).map(call => call.text).join('\n')
      for (const other of tasks.filter(candidate => candidate.ticket.id !== item.ticket.id)) {
        if (own.includes(other.ticket.id) || own.includes(other.ticket.execution!.directory)) crosstalk++
      }
    }
    results.environment = { ...results.environment, maxWorkers: 1 }
    results.productivity = {
      held: busyStates.every(state => state === 'pending') && runningWorkers() === 1 && steered && crosstalk === 0 && new Set(directories).size === tasks.length,
      cases: [
        { id: 'P1', kind: 'typical', scenario: 'five independent requests, one worker slot, a high-priority request accepted while saturated', accepted_while_busy: 4, queued: 4, max_parallel_workers: 1 },
        { id: 'P2', kind: 'perturbed', scenario: 'a person\'s follow-up to the running ticket during the queue', delivered_without_slot: steered ? 1 : 0 },
      ],
      submitted: 5, accepted_while_all_slots_busy: 4, distinct_work_directories: new Set(directories).size,
      crosstalk_events: crosstalk, human_clarifications: 0,
      failure_layer: crosstalk > 0 ? 'implementation' : null,
    }
    expect(new Set(directories).size).toBe(tasks.length)
    expect(crosstalk).toBe(0)
  })

  it('proactivity: observe mode first, then auto mode on the same sources and rule; neutral stays silent in both', async () => {
    host = await startRuntime()
    const base = settingsOf(host)
    const ciRule = { id: 'ci-fix', name: 'Fix failing CI', enabled: true,
      instruction: 'A default-branch CI failure authorizes a ticket to fix the failing check.' }
    // One base environment: observe mode, default-branch CI observed, its admission cell proposes candidates, rule enabled.
    host.runtime.store.saveSettings({ ...base, eval: { ...base.eval, mode: 'observe' },
      sources: { ...base.sources, github: { enabled: true, config: { ...base.sources.github!.config, observeCi: true } } },
      policy: { ...base.policy, rules: [...base.policy.rules, ciRule],
        sources: { ...base.policy.sources, github: { ...base.policy.sources.github!, admission: { ci: { unlistedUnaddressed: 'inferred' } } } } } })

    // Neutral in observe mode: the unlisted sender is dropped by the gate; a listed sender's observation is assessed and ignored.
    const neutralObserve = feishu('9', '这个接口的返回格式好像和文档不一致', { mentions: [], sender_id: 'ou_guest' })
    await receive(host, neutralObserve)
    const neutralObserveCandidate = host.candidates().includes(neutralObserve.id)
    const chattyObserve = feishu('10', '这个接口的返回格式好像和文档不一致', { mentions: [] })
    await receive(host, chattyObserve)
    await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: chattyObserve.id })
    await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', {
      trigger_id: chattyObserve.id, decision: 'ignore', rule_assessments: ruleAssessments(host), title: 'Observation', scope: 'none',
      reason: 'Discussion only; no rule matches.', direction: { implementation_requested: false, target_basis: 'undetermined',
        requires_design_decision: false, evidence: 'The message reports an observation, not an implementation request.' },
    })
    const observeNeutralTickets = host.runtime.store.tickets.list().length

    // Observe positive: CI fails with no mention; the matching assessment is recorded as would-accept, not as a ticket.
    const observeCi = branchCiTrigger('main', 'abc1234', 1, 'CI failed 1/2 on main at abc1234: test', 'https://github.com/acme/widgets/commit/abc1234')
    await receive(host, observeCi)
    const observeCandidate = host.candidates().includes(observeCi.id)
    await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: observeCi.id })
    const observed = await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', {
      trigger_id: observeCi.id, decision: 'accept', rule_assessments: ruleAssessments(host, ['ci-fix']), title: 'Fix the failing default-branch CI',
      worktree_name: 'fix-ci', scope: 'Fix the failing test on main.', intent_evidence: 'CI failed 1/2 on main at abc1234: test',
      reason: 'The ci-fix rule covers this failure.', direction: { implementation_requested: true, target_basis: 'existing-standard',
        requires_design_decision: false, evidence: 'The green default branch is the established state; the CI names the failing check.' },
    })
    const observeTickets = host.runtime.store.tickets.list().length
    const observeAudit = host.runtime.store.decisions.byThread('github:ci:main')[0]?.audit
    expect(observed).toMatchObject({ decision: 'ignore', reason: expect.stringContaining('Observe mode') })
    expect(observeAudit).toMatchObject({ would_accept: true })

    // Switch the same environment to auto and repeat the positive case; also repeat the neutral cases in auto mode.
    const autoSettings = settingsOf(host)
    host.runtime.store.saveSettings({ ...autoSettings, eval: { ...autoSettings.eval, mode: 'auto' } })
    const neutralAuto = feishu('11', '这个接口的返回格式好像和文档不一致', { mentions: [], sender_id: 'ou_guest' })
    await receive(host, neutralAuto)
    const neutralAutoCandidate = host.candidates().includes(neutralAuto.id)
    const chattyAuto = feishu('12', '这个接口的返回格式好像和文档不一致', { mentions: [] })
    await receive(host, chattyAuto)
    await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: chattyAuto.id })
    await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', {
      trigger_id: chattyAuto.id, decision: 'ignore', rule_assessments: ruleAssessments(host), title: 'Observation', scope: 'none',
      reason: 'Discussion only; no rule matches.', direction: { implementation_requested: false, target_basis: 'undetermined',
        requires_design_decision: false, evidence: 'The message reports an observation, not an implementation request.' },
    })
    const neutralAutoTickets = host.runtime.store.tickets.list().length

    const ci = branchCiTrigger('main', 'def5678', 2, 'CI failed 2/2 on main at def5678: lint, e2e', 'https://github.com/acme/widgets/commit/def5678')
    await receive(host, ci)
    await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: ci.id })
    const accepted = await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', {
      trigger_id: ci.id, decision: 'accept', rule_assessments: ruleAssessments(host, ['ci-fix']), title: 'Fix the failing default-branch CI',
      worktree_name: 'fix-ci', scope: 'Fix the failing lint and e2e checks on main.', intent_evidence: 'CI failed 2/2 on main at def5678: lint, e2e',
      acknowledgement: '收到，修复 main 上的 CI 失败。', reason: 'The ci-fix rule covers this failure.',
      direction: { implementation_requested: true, target_basis: 'existing-standard', requires_design_decision: false,
        evidence: 'The green default branch is the established state; the CI names the failing checks.' },
    })
    const ticket = host.runtime.store.tickets.get((accepted.ticket as { ticket_id: string }).ticket_id)!

    // Perturbed: a CI success on another branch reaches assessment but matches no failure rule; no work is created.
    const passed = branchCiTrigger('staging', 'aaa2222', 3, 'CI passed 2/2 on staging at aaa2222', 'https://github.com/acme/widgets/commit/aaa2222')
    await receive(host, passed)
    await host.runTool(host.runtime.masterId, 'orchestrator_eval', { trigger_id: passed.id })
    await host.runTool(host.runtime.masterId, 'orchestrator_eval_decide', {
      trigger_id: passed.id, decision: 'ignore', rule_assessments: ruleAssessments(host), title: 'CI passed', scope: 'none',
      reason: 'A passing CI is not a failure to fix.', direction: { implementation_requested: false, target_basis: 'undetermined',
        requires_design_decision: false, evidence: 'The CI passed; there is no failure.' },
    })
    const afterPassed = host.runtime.store.tickets.list().length

    results.proactivity = {
      held: observeCandidate && observeTickets === 0 && observeAudit?.would_accept === true && neutralObserveCandidate === false
        && observeNeutralTickets === 0 && neutralAutoCandidate === false && neutralAutoTickets === 0 && afterPassed === 1
        && ticket.mandate.strength === 'inferred',
      cases: [
        { id: 'A1', kind: 'typical (observe)', scenario: 'CI failure, rule enabled, observe mode, no mention', candidate: observeCandidate ? 1 : 0, would_accept: observeAudit?.would_accept === true ? 1 : 0, tickets: observeTickets },
        { id: 'A2', kind: 'typical (auto)', scenario: 'the same CI failure after switching to auto', tickets: 1, strength: ticket.mandate.strength, matched_rules: ticket.mandate.basis && 'rules' in ticket.mandate.basis ? ticket.mandate.basis.rules : undefined },
        { id: 'A3', kind: 'negative (observe)', scenario: 'neutral unaddressed discussion in observe mode', candidates: 0, tickets: observeNeutralTickets },
        { id: 'A4', kind: 'negative (auto)', scenario: 'neutral unaddressed discussion in auto mode', candidates: 0, tickets: neutralAutoTickets },
        { id: 'A5', kind: 'perturbed', scenario: 'CI success on another branch under the same rule', tickets: 0 },
      ],
      observe_candidates: observeCandidate ? 1 : 0, observe_would_accept: observeAudit?.would_accept === true ? 1 : 0,
      observe_tickets: observeTickets, auto_tickets: 1, neutral_observe_tickets: observeNeutralTickets,
      neutral_auto_tickets: neutralAutoTickets, ci_ticket_strength: ticket.mandate.strength, human_clarifications: 0,
      failure_layer: !observeCandidate || observeTickets > 0 || observeAudit?.would_accept !== true || neutralObserveCandidate
        || observeNeutralTickets > 0 || neutralAutoCandidate || neutralAutoTickets > 0 || afterPassed !== 1 ? 'implementation' : null,
    }
    expect(ticket.mandate).toMatchObject({ strength: 'inferred', basis: expect.objectContaining({ rules: ['ci-fix'] }) })
    expect(host.runtime.store.tickets.list()).toHaveLength(1)
  })

  it('persistence: typical mid-turn restart and perturbed restart before the first report', async () => {
    host = await startRuntime()
    host.runtime.store.saveSettings({ ...settingsOf(host), executor: { ...settingsOf(host).executor, maxWorkers: 1 } })
    const one = await host.acceptedTicket(feishu('1', '@bot 跑完整测试套件并修复'))
    const directory = one.ticket.execution!.directory
    expect(existsSync(directory)).toBe(true)
    await host.runTool(one.sessionId, 'orchestrator_report', { state: 'progress', summary: 'running the full test suite' })
    const next = await host.restartHost()
    await next.idle()
    const recovered = next.store.tickets.get(one.ticket.id)!
    const note = recovered.inputs.some(input => input.kind === 'text' && input.text.includes('host restarted'))
    const states = recovered.assignments.map(assignment => assignment.state)
    expect(states[0]).toBe('ended')
    expect(states.at(-1)).toMatch(/^(pending|running)$/)
    expect(note).toBe(true)
    expect(existsSync(recovered.execution!.directory)).toBe(true)
    expect(recovered.execution!.directory).toBe(directory)
    expect(host.agents.has(`worker-${one.ticket.id}`)).toBe(true)
    await host.stop()

    // Second host: restart after dispatch but before any worker report, with another ticket still queued.
    host = await startRuntime()
    host.runtime.store.saveSettings({ ...settingsOf(host), executor: { ...settingsOf(host).executor, maxWorkers: 1 } })
    const first = await host.acceptedTicket(feishu('1', '@bot 生成发布说明'))
    const queued = await host.acceptedTicket(feishu('2', '@bot 更新架构文档'))
    const firstDirectory = first.ticket.execution!.directory
    expect(existsSync(firstDirectory)).toBe(true)
    expect(assignmentState(host, queued.ticket.id)).toBe('pending')
    const second = await host.restartHost()
    await second.idle()
    const firstRecovered = second.store.tickets.get(first.ticket.id)!
    const secondRecovered = second.store.tickets.get(queued.ticket.id)!
    const firstNote = firstRecovered.inputs.some(input => input.kind === 'text' && input.text.includes('host restarted'))
    const firstState = firstRecovered.assignments.at(-1)!.state
    const queuedState = secondRecovered.assignments.at(-1)!.state
    expect(firstNote).toBe(true)
    expect(firstState).toMatch(/^(pending|running)$/)
    expect(queuedState).toMatch(/^(pending|running)$/)
    // Both survive, and the recovered launch still respects the one-slot limit.
    expect([firstState, queuedState].filter(state => state === 'running')).toHaveLength(1)
    expect(existsSync(firstRecovered.execution!.directory)).toBe(true)
    expect(firstRecovered.execution!.directory).toBe(firstDirectory)
    expect(host.agents.has(`worker-${first.ticket.id}`)).toBe(true)
    expect(second.store.tickets.list().filter(ticket => ticket.id === first.ticket.id)).toHaveLength(1)
    expect(second.store.tickets.list().filter(ticket => ticket.id === queued.ticket.id)).toHaveLength(1)

    const d1Ok = note && states[0] === 'ended' && states.at(-1) !== 'ended' && existsSync(recovered.execution!.directory)
      && recovered.execution!.directory === directory
    const d2Ok = firstNote && firstState !== 'ended' && queuedState !== 'ended' && existsSync(firstRecovered.execution!.directory)
    results.persistence = {
      held: d1Ok && d2Ok,
      cases: [
        { id: 'D1', kind: 'typical', scenario: 'host stops while the only worker is busy', recovered: d1Ok ? 1 : 0, recovery_note: note, assignment_states: states, ticket_directory_preserved: 1, session_reused: 1 },
        { id: 'D2', kind: 'perturbed', scenario: 'host stops after dispatch, before the first report, with another ticket queued', recovered: d2Ok ? 1 : 0, queued_preserved: queuedState !== 'ended' ? 1 : 0, ticket_directory_preserved: 1, session_reused: 1 },
      ],
      in_flight_restarts: 2, human_steps: 0, duplicate_tickets: 0,
    }
  })
})
