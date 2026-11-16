import type { PlanRole, PlanRun } from '../types'
import { buildDiagnostics, buildSteps, parsePreview } from './plan'

export const urn = (type: string, name: string, stack = 'dev', project = 'demo') =>
  `urn:pulumi:${stack}::${project}::${type}::${name}`

const STACK = urn('pulumi:pulumi:Stack', 'demo-dev')
const MAP = urn('acme:core:Map', 'settings')
const SVC = urn('acme:core:Service', 'web')
const SECRET = urn('acme:core:Secret', 'token')
const OLD = urn('acme:core:Bucket', 'legacy')
const NEW = urn('acme:core:Queue', 'jobs')
const DISK = urn('acme:core:Component$acme:core:Disk', 'data')
const LOOKUP = urn('acme:core:Zone', 'lookup')

const update = (target: string, group: string, key: string, from: unknown, to: unknown) => ({
  op: 'update',
  urn: target,
  provider: 'urn:pulumi:dev::demo::pulumi:providers:acme::default::1',
  diffReasons: [group],
  oldState: { urn: target, id: 'x', inputs: { [group]: { [key]: from } } },
  newState: { urn: target, inputs: { [group]: { [key]: to } } },
  detailedDiff: { [`${group}.${key}`]: { kind: 'update', inputDiff: true } },
})

const opaque = {
  op: 'update',
  urn: SECRET,
  oldState: { urn: SECRET, id: 's', inputs: { value: '[secret]' } },
  newState: { urn: SECRET, inputs: { value: '[secret]' } },
  detailedDiff: {},
}

const read = { op: 'read', urn: LOOKUP, newState: { urn: LOOKUP, id: 'z' } }

export const baselinePreview = {
  config: {},
  steps: [
    { op: 'same', urn: STACK },
    update(MAP, 'data', 'key', 'a', 'b'),
    update(SVC, 'spec', 'port', 80, 81),
    opaque,
    { op: 'delete', urn: OLD, oldState: { urn: OLD, id: 'legacy-1', inputs: { name: 'legacy' } } },
    read,
  ],
  diagnostics: [{ message: 'shared note', severity: 'info' }],
  duration: 4_500_000_000,
  changeSummary: { update: 3, delete: 1, same: 10 },
}

export const branchPreview = {
  config: {},
  steps: [
    { op: 'same', urn: STACK },
    update(MAP, 'data', 'key', 'a', 'b'),
    update(SVC, 'spec', 'port', 80, 82),
    opaque,
    { op: 'create', urn: NEW, newState: { urn: NEW, inputs: { name: 'jobs', retries: 3 } } },
    {
      op: 'create-replacement',
      urn: DISK,
      replaceReasons: ['size'],
      oldState: { urn: DISK, id: 'd1', inputs: { size: 10 } },
      newState: { urn: DISK, inputs: { size: 20 } },
      detailedDiff: { size: { kind: 'update-replace', inputDiff: true } },
    },
    {
      op: 'delete-replaced',
      urn: DISK,
      replaceReasons: ['size', 'zone'],
      oldState: { urn: DISK, id: 'd1', inputs: { size: 10 } },
    },
    read,
  ],
  diagnostics: [
    { message: 'shared note', severity: 'info' },
    { message: 'new warning', severity: 'warning', urn: SVC },
  ],
  duration: 5_000_000_000,
  changeSummary: { update: 3, create: 1, replace: 1, same: 10 },
}

export function toRun(preview: unknown, role: PlanRole, label = ''): PlanRun {
  const parsed = parsePreview(JSON.stringify(preview))
  const { steps, sameCount } = buildSteps(parsed.steps)

  return {
    role,
    label,
    project: 'demo',
    stack: 'dev',
    previewPath: `/tmp/${role}.json`,
    worktree: '/tmp/wt',
    registeredAt: 0,
    durationSec: 1,
    changeSummary: parsed.changeSummary,
    git: { isAvailable: false, reason: 'test' },
    steps,
    diagnostics: buildDiagnostics(parsed.diagnostics),
    sameCount,
  }
}

export const URNS = { MAP, SVC, SECRET, OLD, NEW, DISK, LOOKUP }

export function applyPreview(stack: string, { isExtra = false, isError = false } = {}) {
  const queue = urn('acme:core:Queue', 'jobs', stack)
  const web = urn('acme:core:Service', 'web', stack)
  const extra = urn('acme:core:Queue', 'more', stack)

  return {
    config: {},
    steps: [
      { op: 'same', urn: urn('pulumi:pulumi:Stack', `demo-${stack}`, stack) },
      { op: 'create', urn: queue, newState: { urn: queue, inputs: { name: 'jobs' } } },
      {
        op: 'update',
        urn: web,
        oldState: { urn: web, id: 'w', inputs: { port: 80 } },
        newState: { urn: web, inputs: { port: 81 } },
        detailedDiff: { port: { kind: 'update', inputDiff: true } },
      },
      ...(isExtra ? [{ op: 'create', urn: extra, newState: { urn: extra, inputs: { name: 'more' } } }] : []),
    ],
    diagnostics: isError ? [{ message: 'boom', severity: 'error' }] : [],
    duration: 2_000_000_000,
    changeSummary: { create: isExtra ? 2 : 1, update: 1, same: 3 },
  }
}

export function preMergePreview(stack: string) {
  const web = urn('acme:core:Service', 'web', stack)
  const legacy = urn('acme:core:Bucket', 'legacy', stack)
  const [same, , update] = applyPreview(stack).steps

  return {
    config: {},
    steps: [same, update, { op: 'delete', urn: legacy, oldState: { urn: legacy, id: 'legacy-1', inputs: { name: 'legacy' } } }].filter(
      step => step !== undefined && (step.urn !== web || step.op === 'update'),
    ),
    diagnostics: [],
    duration: 2_000_000_000,
    changeSummary: { update: 1, delete: 1, same: 3 },
  }
}
