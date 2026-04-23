import fs from 'fs';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { PROJECT_ROOT, agentCwd } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

// ── MCP server loading ──────────────────────────────────────────────
// We read MCP configs from all sources Claude Code would discover,
// filter by the agent's allowlist, and pass them via `mcpServers` +
// `strictMcpConfig: true`. The --strict-mcp-config CLI flag tells
// Claude Code to ONLY use the MCPs we provide, ignoring all other
// sources (.mcp.json, settings.json, plugins).

// Matches SDK types: McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig
type McpServerEntry = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
} | {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
};

/**
 * Load MCP servers from ALL sources that Claude Code would discover:
 *  - settings.json (project + user)
 *  - .mcp.json (project cwd + user home ~/.claude/)
 *
 * When an allowlist is provided, only MCPs matching the allowlist are returned.
 * Combined with strictMcpConfig: true, this gives deterministic MCP control.
 */
function loadMcpServers(allowlist?: string[]): Record<string, McpServerEntry> {
  const merged: Record<string, McpServerEntry> = {};

  const cwd = agentCwd ?? PROJECT_ROOT;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';

  // All files that Claude Code reads for MCP server configs.
  // PROJECT_ROOT is included explicitly so sub-agents (whose cwd is their own
  // agent dir, e.g. agents/bob/) still see the repo-level .mcp.json where
  // shared MCP servers like render/context7 live.
  const mcpFiles = [
    // settings.json files (mcpServers key)
    { file: path.join(home, '.claude', 'settings.json'), key: 'mcpServers' },
    { file: path.join(PROJECT_ROOT, '.claude', 'settings.json'), key: 'mcpServers' },
    { file: path.join(cwd, '.claude', 'settings.json'), key: 'mcpServers' },
    // .mcp.json files (mcpServers key)
    { file: path.join(home, '.claude', '.mcp.json'), key: 'mcpServers' },
    { file: path.join(PROJECT_ROOT, '.mcp.json'), key: 'mcpServers' },
    { file: path.join(cwd, '.mcp.json'), key: 'mcpServers' },
  ];

  for (const { file, key } of mcpFiles) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const servers = raw?.[key];
      if (servers && typeof servers === 'object') {
        for (const [name, config] of Object.entries(servers)) {
          const cfg = config as Record<string, unknown>;
          // Support both stdio (command-based) and HTTP/URL-based MCP servers
          if (cfg.command && typeof cfg.command === 'string') {
            merged[name] = {
              command: cfg.command,
              ...(cfg.args ? { args: cfg.args as string[] } : {}),
              ...(cfg.env ? { env: cfg.env as Record<string, string> } : {}),
            };
          } else if ((cfg.type === 'http' || cfg.type === 'sse') && typeof cfg.url === 'string') {
            merged[name] = {
              type: cfg.type,
              url: cfg.url,
              ...(cfg.headers ? { headers: cfg.headers as Record<string, string> } : {}),
            };
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid — skip
    }
  }

  // If an allowlist is provided, only keep the MCPs in that list
  if (allowlist) {
    const allowed = new Set(allowlist);
    for (const name of Object.keys(merged)) {
      if (!allowed.has(name)) delete merged[name];
    }
  }

  return merged;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
  /** True if the SDK auto-compacted context during this turn */
  didCompact: boolean;
  /** Token count before compaction (if it happened) */
  preCompactTokens: number | null;
  /**
   * The cache_read_input_tokens from the LAST API call in the turn.
   * Unlike the cumulative cacheReadInputTokens, this reflects the actual
   * context window size (cumulative overcounts on multi-step tool-use turns).
   */
  lastCallCacheRead: number;
  /**
   * The input_tokens from the LAST API call in the turn.
   * This is the actual context window size: system prompt + conversation
   * history + tool results for that call. Use this for context warnings.
   */
  lastCallInputTokens: number;
}

/** Progress event emitted during agent execution for Telegram feedback. */
export interface AgentProgressEvent {
  type: 'task_started' | 'task_completed' | 'tool_active';
  description: string;
}

/** Map SDK tool names to human-readable labels. */
const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Grep: 'Searching code',
  Glob: 'Finding files',
  WebSearch: 'Web search',
  WebFetch: 'Fetching page',
  Agent: 'Sub-agent',
  NotebookEdit: 'Editing notebook',
  AskUserQuestion: 'User question',
};

function toolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  // MCP tools: mcp__server__tool → "server: tool"
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    return parts.length >= 3 ? `${parts[1]}: ${parts.slice(2).join(' ')}` : toolName;
  }
  return toolName;
}

export interface AgentResult {
  text: string | null;
  newSessionId: string | undefined;
  usage: UsageInfo | null;
  aborted?: boolean;
}

/**
 * A minimal AsyncIterable that yields a single user message then closes.
 * This is the format the Claude Agent SDK expects for its `prompt` parameter.
 * The SDK drives the agentic loop internally (tool use, multi-step reasoning)
 * and surfaces a final `result` event when done.
 */
async function* singleTurn(text: string): AsyncGenerator<{
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  };
}

/**
 * Run a single user message through Claude Code and return the result.
 *
 * Uses `resume` to continue the same session across Telegram messages,
 * giving Claude persistent context without re-sending history.
 *
 * Auth: The SDK spawns the `claude` CLI subprocess which reads OAuth auth
 * from ~/.claude/ automatically (the same auth used in the terminal).
 * No explicit token needed if you're already logged in via `claude login`.
 * Optionally override with CLAUDE_CODE_OAUTH_TOKEN in .env.
 *
 * @param message    The user's text (may include transcribed voice prefix)
 * @param sessionId  Claude Code session ID to resume, or undefined for new session
 * @param onTyping   Called every TYPING_REFRESH_MS while waiting — sends typing action to Telegram
 * @param onProgress Called when sub-agents start/complete — sends status updates to Telegram
 */
/** Callback fired for each meaningful SDK event during agent execution. */
export type AgentEventCallback = (eventType: string, content: string) => void;

export async function runAgent(
  message: string,
  sessionId: string | undefined,
  onTyping: () => void,
  onProgress?: (event: AgentProgressEvent) => void,
  model?: string,
  abortController?: AbortController,
  onStreamText?: (accumulatedText: string) => void,
  mcpAllowlist?: string[],
  onEvent?: AgentEventCallback,
): Promise<AgentResult> {
  // Read secrets from .env without polluting process.env.
  // CLAUDE_CODE_OAUTH_TOKEN is optional — the subprocess finds auth via ~/.claude/
  // automatically. Only needed if you want to override which account is used.
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);

  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  if (secrets.CLAUDE_CODE_OAUTH_TOKEN) {
    sdkEnv.CLAUDE_CODE_OAUTH_TOKEN = secrets.CLAUDE_CODE_OAUTH_TOKEN;
  }
  if (secrets.ANTHROPIC_API_KEY) {
    sdkEnv.ANTHROPIC_API_KEY = secrets.ANTHROPIC_API_KEY;
  }

  let newSessionId: string | undefined;
  let resultText: string | null = null;
  let usage: UsageInfo | null = null;
  let didCompact = false;
  let preCompactTokens: number | null = null;
  let lastCallCacheRead = 0;
  let lastCallInputTokens = 0;
  let streamedText = '';

  // Refresh typing indicator on an interval while Claude works.
  // Telegram's "typing..." action expires after ~5s.
  const typingInterval = setInterval(onTyping, 4000);

  try {
    // Load MCP servers from project + user settings files, filtered by agent allowlist
    const mcpServers = loadMcpServers(mcpAllowlist);
    const mcpServerNames = Object.keys(mcpServers);
    logger.info(
      { sessionId: sessionId ?? 'new', messageLen: message.length, mcpServers: mcpServerNames },
      'Starting agent query',
    );

    // When an allowlist is provided, pass strictMcpConfig: true which tells
    // the CLI: "Only use MCP servers from --mcp-config, ignoring all other
    // MCP configurations" (.mcp.json, settings.json, plugins -- everything).
    // We still include 'user' in settingSources so skills load normally.
    const hasAllowlist = mcpAllowlist !== undefined;
    const mcpOverrides = hasAllowlist
      ? { mcpServers: mcpServers as Record<string, McpServerEntry>, strictMcpConfig: true }
      : mcpServerNames.length > 0
        ? { mcpServers: mcpServers as Record<string, McpServerEntry> }
        : {};

    for await (const event of query({
      prompt: singleTurn(message),
      options: {
        // cwd = agent directory (if running as agent) or project root.
        // Claude Code loads CLAUDE.md from cwd via settingSources: ['project'].
        cwd: agentCwd ?? PROJECT_ROOT,

        // Resume the previous session for this chat (persistent context)
        resume: sessionId,

        // 'project' loads CLAUDE.md from cwd; 'user' loads ~/.claude/skills/.
        // strictMcpConfig prevents the CLI from loading MCPs from these sources.
        settingSources: ['project', 'user'],

        // Skip all permission prompts — this is a trusted personal bot on your own machine
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,

        // Pass secrets to the subprocess without polluting our own process.env
        env: sdkEnv,

        // MCPs loaded from all sources and filtered by the agent's allowlist.
        // With strictMcpConfig, the CLI uses ONLY these and ignores all others.
        ...mcpOverrides,

        // Stream partial text so Telegram can show progressive updates
        includePartialMessages: !!onStreamText,

        // Model override (e.g. 'claude-haiku-4-5', 'claude-sonnet-4-5')
        ...(model ? { model } : {}),

        // Abort support — signals the SDK to kill the subprocess
        ...(abortController ? { abortController } : {}),
      },
    })) {
      const ev = event as Record<string, unknown>;

      if (ev['type'] === 'system' && ev['subtype'] === 'init') {
        newSessionId = ev['session_id'] as string;
        logger.info({ newSessionId }, 'Session initialized');
        onEvent?.('system', `Session initialized: ${newSessionId}`);
      }

      // Detect auto-compaction (context window was getting full)
      if (ev['type'] === 'system' && ev['subtype'] === 'compact_boundary') {
        didCompact = true;
        const meta = ev['compact_metadata'] as { trigger: string; pre_tokens: number } | undefined;
        preCompactTokens = meta?.pre_tokens ?? null;
        logger.warn(
          { trigger: meta?.trigger, preCompactTokens },
          'Context window compacted',
        );
        onEvent?.('system', `Context compacted (trigger: ${meta?.trigger}, pre_tokens: ${preCompactTokens})`);
      }

      // Track per-call token usage and detect tool use from assistant message events.
      // Each assistant message represents one API call; its usage reflects
      // that single call's context size (not cumulative across the turn).
      if (ev['type'] === 'assistant') {
        const msg = ev['message'] as Record<string, unknown> | undefined;
        const msgUsage = msg?.['usage'] as Record<string, number> | undefined;
        const callCacheRead = msgUsage?.['cache_read_input_tokens'] ?? 0;
        const callInputTokens = msgUsage?.['input_tokens'] ?? 0;
        if (callCacheRead > 0) {
          lastCallCacheRead = callCacheRead;
        }
        if (callInputTokens > 0) {
          lastCallInputTokens = callInputTokens;
        }

        // Extract tool_use and text blocks from assistant content
        const content = msg?.['content'] as Array<{ type: string; name?: string; input?: unknown; text?: string }> | undefined;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use' && block.name) {
              if (onProgress) onProgress({ type: 'tool_active', description: toolLabel(block.name) });
              onEvent?.('tool_use', `${toolLabel(block.name)}${block.input ? ': ' + JSON.stringify(block.input).slice(0, 500) : ''}`);
            }
            if (block.type === 'text' && block.text) {
              onEvent?.('assistant_text', block.text.slice(0, 2000));
            }
          }
        }
      }

      // Sub-agent lifecycle events — surface to Telegram for user feedback
      if (ev['type'] === 'system' && ev['subtype'] === 'task_started') {
        const desc = (ev['description'] as string) ?? 'Sub-agent started';
        if (onProgress) onProgress({ type: 'task_started', description: desc });
        onEvent?.('system', `Sub-agent started: ${desc}`);
      }
      if (ev['type'] === 'system' && ev['subtype'] === 'task_notification') {
        const summary = (ev['summary'] as string) ?? 'Sub-agent finished';
        const status = (ev['status'] as string) ?? 'completed';
        if (onProgress) onProgress({
          type: 'task_completed',
          description: status === 'failed' ? `Failed: ${summary}` : summary,
        });
        onEvent?.('system', `Sub-agent ${status}: ${summary}`);
      }

      // Stream text deltas for progressive Telegram updates.
      // Only stream the outermost assistant response (parent_tool_use_id === null)
      // to avoid showing internal tool-use reasoning.
      if (ev['type'] === 'stream_event' && onStreamText && ev['parent_tool_use_id'] === null) {
        const streamEvent = ev['event'] as Record<string, unknown> | undefined;
        if (streamEvent?.['type'] === 'content_block_delta') {
          const delta = streamEvent['delta'] as Record<string, unknown> | undefined;
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            streamedText += delta['text'];
            onStreamText(streamedText);
          }
        }
        if (streamEvent?.['type'] === 'message_start') {
          streamedText = '';
        }
      }

      if (ev['type'] === 'result') {
        resultText = (ev['result'] as string | null | undefined) ?? null;

        // Extract usage info from result event
        const evUsage = ev['usage'] as Record<string, number> | undefined;
        if (evUsage) {
          usage = {
            inputTokens: evUsage['input_tokens'] ?? 0,
            outputTokens: evUsage['output_tokens'] ?? 0,
            cacheReadInputTokens: evUsage['cache_read_input_tokens'] ?? 0,
            totalCostUsd: (ev['total_cost_usd'] as number) ?? 0,
            didCompact,
            preCompactTokens,
            lastCallCacheRead,
            lastCallInputTokens,
          };
          logger.info(
            {
              inputTokens: usage.inputTokens,
              cacheReadTokens: usage.cacheReadInputTokens,
              lastCallCacheRead: usage.lastCallCacheRead,
              lastCallInputTokens: usage.lastCallInputTokens,
              costUsd: usage.totalCostUsd,
              didCompact,
            },
            'Turn usage',
          );
        }

        logger.info(
          { hasResult: !!resultText, subtype: ev['subtype'] },
          'Agent result received',
        );
        onEvent?.('result', `Cost: $${usage?.totalCostUsd?.toFixed(4) ?? '?'}, tokens: ${usage?.inputTokens ?? '?'}in/${usage?.outputTokens ?? '?'}out${didCompact ? ' (compacted)' : ''}`);
      }
    }
  } catch (err) {
    if (abortController?.signal.aborted) {
      logger.info('Agent query aborted by user');
      onEvent?.('abort', 'Agent aborted');
      return { text: null, newSessionId, usage, aborted: true };
    }
    throw err;
  } finally {
    clearInterval(typingInterval);
  }

  return { text: resultText, newSessionId, usage };
}
