import { randomUUID } from 'crypto';

import { getDb, hasTable } from '../../db/connection.js';
import { createMessagingGroupAgent, getMessagingGroupAgent } from '../../db/messaging-groups.js';
import { getSessionsByAgentGroup } from '../../db/sessions.js';
import { log } from '../../log.js';
import { registerResource } from '../crud.js';

/**
 * Re-project the agent_destinations table into every active session's
 * inbound.db so a running container picks up the change immediately
 * without waiting for the next spawn.
 */
async function projectDestinationsToSessions(agentGroupId: string): Promise<void> {
  if (!hasTable(getDb(), 'agent_destinations')) return;
  const { writeDestinations } = await import('../../modules/agent-to-agent/write-destinations.js');
  for (const session of getSessionsByAgentGroup(agentGroupId)) {
    try {
      writeDestinations(agentGroupId, session.id);
    } catch (err) {
      log.warn('Failed to project destinations to session inbound.db', { agentGroupId, sessionId: session.id, err });
    }
  }
}

registerResource({
  name: 'wiring',
  plural: 'wirings',
  table: 'messaging_group_agents',
  description:
    'Wiring — connects a messaging group to an agent group. Determines which agent handles messages from which chat. The same messaging group can be wired to multiple agents; the same agent can be wired to multiple messaging groups.',
  idColumn: 'id',
  columns: [
    { name: 'id', type: 'string', description: 'UUID.', generated: true },
    {
      name: 'messaging_group_id',
      type: 'string',
      description: 'The chat/channel to route from. References messaging_groups.id.',
      required: true,
    },
    {
      name: 'agent_group_id',
      type: 'string',
      description: 'The agent that handles messages. References agent_groups.id.',
      required: true,
    },
    {
      name: 'engage_mode',
      type: 'string',
      description:
        'When the agent engages. "mention" — only when @mentioned or in DMs. "mention-sticky" — once mentioned in a thread, the agent subscribes and responds to all subsequent messages in that thread without needing further mentions. "pattern" — matches every message against engage_pattern regex.',
      enum: ['pattern', 'mention', 'mention-sticky'],
      default: 'mention',
      updatable: true,
    },
    {
      name: 'engage_pattern',
      type: 'string',
      description:
        'Regex for engage_mode=pattern. Required when mode is pattern. Use "." to match every message (always-on). Ignored for mention modes.',
      updatable: true,
    },
    {
      name: 'sender_scope',
      type: 'string',
      description:
        '"all" — any sender (subject to unknown_sender_policy). "known" — only users with a role or membership in this agent group.',
      enum: ['all', 'known'],
      default: 'all',
      updatable: true,
    },
    {
      name: 'ignored_message_policy',
      type: 'string',
      description:
        'What happens to messages that don\'t trigger engagement. "drop" — agent never sees them. "accumulate" — stored as background context (trigger=0) so the agent has prior context when eventually triggered.',
      enum: ['drop', 'accumulate'],
      default: 'drop',
      updatable: true,
    },
    {
      name: 'session_mode',
      type: 'string',
      description:
        '"shared" — one session per (agent, messaging group). "per-thread" — separate session per thread/topic. "agent-shared" — one session across all messaging groups wired to this agent. Note: threaded adapters in group chats force per-thread regardless of this setting.',
      enum: ['shared', 'per-thread', 'agent-shared'],
      default: 'shared',
      updatable: true,
    },
    { name: 'created_at', type: 'string', description: 'Auto-set.', generated: true },
  ],
  operations: { list: 'open', get: 'open', update: 'approval' },
  customOperations: {
    create: {
      access: 'approval',
      description:
        'Wire a messaging group to an agent. Use --messaging-group-id, --agent-group-id, and optional mode flags. Also creates the agent_destinations row so the agent can immediately address this channel by name.',
      handler: async (args) => {
        const messagingGroupId = args.messaging_group_id as string;
        const agentGroupId = args.agent_group_id as string;
        if (!messagingGroupId) throw new Error('--messaging-group-id is required');
        if (!agentGroupId) throw new Error('--agent-group-id is required');

        const mga = {
          id: randomUUID(),
          messaging_group_id: messagingGroupId,
          agent_group_id: agentGroupId,
          engage_mode: (args.engage_mode as string) || 'mention',
          engage_pattern: (args.engage_pattern as string) || null,
          sender_scope: (args.sender_scope as string) || 'all',
          ignored_message_policy: (args.ignored_message_policy as string) || 'drop',
          session_mode: (args.session_mode as string) || 'shared',
          priority: 0,
          created_at: new Date().toISOString(),
        };

        // createMessagingGroupAgent also auto-creates the agent_destinations
        // row so the agent can address this channel by name in <message to="...">.
        createMessagingGroupAgent(mga as Parameters<typeof createMessagingGroupAgent>[0]);

        // Project updated destinations into any already-running session so
        // the agent doesn't have to wait for its next container wake.
        await projectDestinationsToSessions(agentGroupId);

        return mga;
      },
    },
    delete: {
      access: 'approval',
      description:
        'Remove a wiring. Use --id. Also removes the corresponding agent_destinations row and re-projects so the running container stops routing to this channel.',
      handler: async (args) => {
        const id = args.id as string;
        if (!id) throw new Error('--id is required');

        const mga = getMessagingGroupAgent(id);
        if (!mga) throw new Error(`Wiring not found: ${id}`);

        // Remove the wiring.
        getDb().prepare('DELETE FROM messaging_group_agents WHERE id = ?').run(id);

        // Remove the corresponding destination row if present. Guard on table
        // existence in case agent-to-agent module isn't installed.
        if (hasTable(getDb(), 'agent_destinations')) {
          getDb()
            .prepare(
              `DELETE FROM agent_destinations
               WHERE agent_group_id = ? AND target_type = 'channel' AND target_id = ?`,
            )
            .run(mga.agent_group_id, mga.messaging_group_id);

          await projectDestinationsToSessions(mga.agent_group_id);
        }

        return { deleted: id };
      },
    },
  },
});
