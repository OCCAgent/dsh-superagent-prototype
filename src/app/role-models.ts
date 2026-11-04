/** Resolves and seeds per-role default models on Sessions without mutating the global DSH default. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { RoleModel } from '../policy.ts'

/** Resolve a configured route through the live provider; catalog membership is not a restriction. */
export async function resolveRoleModel(ctx: Context, model: RoleModel): Promise<ModelSelection> {
  const value = await ctx.llm.resolveCallConfig({ provider: model.provider, model: model.model,
    ...(model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } : {}) })
  return { provider: value.provider, model: value.model, ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}

const sameSelection = (a: ModelSelection, b: ModelSelection): boolean =>
  a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort

/** Whether a Session route is the model a role names, ignoring effort when the model leaves it to the provider. */
const followsRole = (selection: ModelSelection, model: RoleModel): boolean =>
  selection.provider === model.provider && selection.model === model.model
  && (model.reasoningEffort === undefined || selection.reasoningEffort === model.reasoningEffort)

/** The route a Session currently takes: its latest request header or durable selection, whichever was recorded last. */
export function currentRoleSelection(agent: Agent): ModelSelection | undefined {
  const event = agent.session.snapshotEvents().findLast(item => item.type === 'request/header' || item.type === 'model/selection')
  if (!event) return undefined
  if (event.type === 'model/selection') {
    const { provider, model, reasoningEffort } = event.data
    return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) }) }
  }
  const { provider, model, reasoningEffort } = event.data.header.config
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) }) }
}

/** The newest injected selection per Agent, so a superseded injection stops applying itself during a later step. */
const injections = new WeakMap<Agent, number>()

/** Apply `selected` to the next request that enters prompt assembly, then leave routing to the Session's recorded selection. */
function injectSelection(ctx: Context, agent: Agent, selected: ModelSelection): void {
  const generation = (injections.get(agent) ?? 0) + 1
  injections.set(agent, generation)
  let pending = true
  let assembled: ModelSelection | undefined
  agent.ctx.effect(() => {
    const disposers = [
      agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const selection = pending && injections.get(agent) === generation ? selected : undefined
        const result = await next()
        assembled = selection
        return selection ? { ...result, variables: { ...result.variables, provider: selection.provider, model: selection.model } } : result
      }, { prepend: true }),
      agent.ctx.on('agent/request', async (_payload, next) => {
        const result = await next()
        if (!assembled || injections.get(agent) !== generation) return result
        const { reasoningEffort: _inherited, ...rest } = result
        return { ...rest, ...assembled }
      }, { prepend: true }),
      ctx.on('session/event', (session, event) => {
        if (session === agent.session && (event.type === 'request/header' || event.type === 'model/selection')) pending = false
      }),
    ]
    return () => disposers.forEach(dispose => dispose())
  })
}

/** Seed a role's configured model onto a brand-new session before its first request, leaving later manual or durable selections intact. */
export async function initializeRoleModel(ctx: Context, agent: Agent, model: RoleModel | null): Promise<void> {
  if (!model) return
  if (agent.session.requestHeader() || agent.session.snapshotEvents().some(event => event.type === 'model/selection')) return
  const selected = await resolveRoleModel(ctx, model)
  // Avoid selectModel because it mutates the global DSH default; inject the selection for the initial request only.
  agent.session.append('model/selection', selected)
  injectSelection(ctx, agent, selected)
  await ctx.sessionPersistence.flush()
}

/**
 * Switch an existing Session to `model` for its next request while it still follows `expected`, leaving a different model
 * chosen inside the Session alone. Returns whether the Session was switched.
 */
export async function retargetRoleModel(ctx: Context, agent: Agent, model: RoleModel | null, expected: RoleModel | null): Promise<boolean> {
  if (!model) return false
  const current = currentRoleSelection(agent)
  if (current !== undefined && expected !== null && !followsRole(current, expected)) return false
  const selected = await resolveRoleModel(ctx, model)
  if (current !== undefined && sameSelection(current, selected)) return false
  agent.session.append('model/selection', selected)
  injectSelection(ctx, agent, selected)
  await ctx.sessionPersistence.flush()
  return true
}
