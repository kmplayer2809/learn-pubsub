import { isCommandName, type RedisCommandName } from './commands'
import type { NodeId, RedisTopology } from './types'

export interface RedisScriptedCommand {
  at: number
  clientId: NodeId
  name: RedisCommandName
  args: string[]
  tone?: string
}

export type RedisIssueCode = 'client-missing' | 'unknown-command' | 'no-clients' | 'maxmemory-noeviction'

export interface RedisValidationIssue {
  code: RedisIssueCode
  severity: 'error' | 'warning'
  nodeId?: string
  message: string
}

/**
 * A scripted command as it arrives *before* validation. `name` is only a
 * `string` here because the Sandbox console builds scripts from free text a
 * learner types — which is exactly the path `unknown-command` exists to catch.
 * A typed lesson's `RedisScriptedCommand[]` is assignable to this.
 */
export interface UnvalidatedScriptedCommand {
  at: number
  clientId: NodeId
  name: string
  args: string[]
  tone?: string
}

/**
 * Checks a topology and its scripted commands for problems the simulation
 * cannot run through (errors — the kernel is wired `fatal` on any of these)
 * or should warn a learner about before they watch it run (warnings).
 */
export function validateRedisTopology(
  topology: RedisTopology,
  script: readonly UnvalidatedScriptedCommand[],
): RedisValidationIssue[] {
  const issues: RedisValidationIssue[] = []
  const clientIds = new Set(topology.clients.map((client) => client.id))

  if (topology.clients.length === 0) {
    issues.push({
      code: 'no-clients',
      severity: 'warning',
      message: 'the topology has no clients, so no scripted command can ever run',
    })
  }

  for (const command of script) {
    if (!clientIds.has(command.clientId)) {
      issues.push({
        code: 'client-missing',
        severity: 'error',
        nodeId: command.clientId,
        message: `command ${command.name} names client ${command.clientId}, which does not exist`,
      })
    }

    // Unreachable from a typed lesson — `command.name` is statically a
    // `RedisCommandName` — but the Sandbox console builds scripts from free
    // text a learner types, which defeats that guarantee at the type
    // boundary. This is the runtime backstop for that path.
    if (!isCommandName(command.name)) {
      issues.push({
        code: 'unknown-command',
        severity: 'error',
        nodeId: command.clientId,
        message: `"${command.name}" is not a command this engine understands`,
      })
    }
  }

  const policy = topology.server.evictionPolicy ?? 'noeviction'
  if (topology.server.maxmemoryBytes !== undefined && policy === 'noeviction') {
    issues.push({
      code: 'maxmemory-noeviction',
      severity: 'warning',
      nodeId: topology.server.id,
      message: `${topology.server.label} sets maxmemory with the noeviction policy, so writes will start failing once memory fills up`,
    })
  }

  return issues
}
