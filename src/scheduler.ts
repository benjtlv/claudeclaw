import { CronExpressionParser } from 'cron-parser';

import { AGENT_ID, ALLOWED_CHAT_ID, agentMcpAllowlist } from './config.js';
import {
  getDueTasks,
  getSession,
  logConversationTurn,
  logTaskEvent,
  markTaskRunning,
  updateTaskAfterRun,
  resetStuckTasks,
  claimNextMissionTask,
  completeMissionTask,
  markMissionCallback,
  resetStuckMissionTasks,
  deleteScheduledTask,
} from './db.js';
import type { MissionTask } from './db.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import { runAgent } from './agent.js';
import { formatForTelegram, splitMessage } from './bot.js';
import { emitChatEvent } from './state.js';

type Sender = (text: string) => Promise<void>;

/** Max time (ms) a scheduled task can run before being killed. */
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let sender: Sender;

/**
 * In-memory set of task IDs currently being executed.
 * Acts as a fast-path guard alongside the DB-level lock in markTaskRunning.
 */
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
let schedulerAgentId = 'main';

export function initScheduler(send: Sender, agentId = 'main'): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  schedulerAgentId = agentId;

  // Recover tasks stuck in 'running' from a previous crash
  const recovered = resetStuckTasks(agentId);
  if (recovered > 0) {
    logger.warn({ recovered, agentId }, 'Reset stuck tasks from previous crash');
  }
  const recoveredMission = resetStuckMissionTasks(agentId);
  if (recoveredMission > 0) {
    logger.warn({ recovered: recoveredMission, agentId }, 'Reset stuck mission tasks from previous crash');
  }

  setInterval(() => void runDueTasks(), 60_000);
  logger.info({ agentId }, 'Scheduler started (checking every 60s)');
}

async function runDueTasks(): Promise<void> {
  const tasks = getDueTasks(schedulerAgentId);

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, 'Running due scheduled tasks');
  }

  for (const task of tasks) {
    // In-memory guard: skip if already running in this process
    if (runningTaskIds.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already running, skipping duplicate fire');
      continue;
    }

    // Compute next occurrence BEFORE executing so we can lock the task
    // in the DB immediately, preventing re-fire on subsequent ticks.
    const nextRun = computeNextRun(task.schedule);
    runningTaskIds.add(task.id);
    markTaskRunning(task.id, nextRun);

    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    // Route through the message queue so scheduled tasks wait for any
    // in-flight user message to finish before running. This prevents
    // two Claude processes from hitting the same session simultaneously.
    const chatId = ALLOWED_CHAT_ID || 'scheduler';
    messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        const isSilent = !!task.silent;

        if (!isSilent) {
          await sender(`Scheduled task running: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? '...' : ''}"`);
        }

        // Run as a fresh agent call (no session — scheduled tasks are autonomous)
        const runId = `${task.id}-${Math.floor(Date.now() / 1000)}`;
        logTaskEvent(runId, 'scheduled', schedulerAgentId, 'start', `Prompt: ${task.prompt.slice(0, 500)}`);
        const result = await runAgent(task.prompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist,
          (eventType, content) => { try { logTaskEvent(runId, 'scheduled', schedulerAgentId, eventType, content); } catch { /* don't break task */ } });
        clearTimeout(timeout);

        if (result.aborted) {
          if (task.one_shot) {
            deleteScheduledTask(task.id);
          } else {
            updateTaskAfterRun(task.id, nextRun, 'Timed out after 10 minutes', 'timeout');
          }
          if (!isSilent) {
            await sender(`⏱ Task timed out after 10m: "${task.prompt.slice(0, 60)}..." — killed.`);
          }
          logger.warn({ taskId: task.id, oneShot: !!task.one_shot }, 'Task timed out');
          return;
        }

        const text = result.text?.trim() || 'Task completed with no output.';
        if (!isSilent) {
          for (const chunk of splitMessage(formatForTelegram(text))) {
            await sender(chunk);
          }
        }

        // Inject task output into the active chat session so user replies have context
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${task.prompt}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        if (task.one_shot) {
          deleteScheduledTask(task.id);
          logger.info({ taskId: task.id, silent: isSilent }, 'One-shot task complete, deleted');
        } else {
          updateTaskAfterRun(task.id, nextRun, text, 'success');
          logger.info({ taskId: task.id, nextRun, silent: isSilent }, 'Task complete, next run scheduled');
        }
      } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (task.one_shot) {
          deleteScheduledTask(task.id);
        } else {
          updateTaskAfterRun(task.id, nextRun, errMsg.slice(0, 500), 'failed');
        }

        logger.error({ err, taskId: task.id }, 'Scheduled task failed');
        try {
          if (!task.silent) {
            await sender(`❌ Task failed: "${task.prompt.slice(0, 60)}..." — ${errMsg.slice(0, 200)}`);
          }
        } catch {
          // ignore send failure
        }
      } finally {
        runningTaskIds.delete(task.id);
      }
    });
  }

  // Also check for queued mission tasks (one-shot async tasks from Mission Control)
  await runDueMissionTasks();
}

async function runDueMissionTasks(): Promise<void> {
  const mission = claimNextMissionTask(schedulerAgentId);
  if (!mission) return;

  const missionKey = 'mission-' + mission.id;
  if (runningTaskIds.has(missionKey)) return;
  runningTaskIds.add(missionKey);

  logger.info({ missionId: mission.id, title: mission.title }, 'Running mission task');

  const chatId = ALLOWED_CHAT_ID || 'mission';
  messageQueue.enqueue(chatId, async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

    try {
      const runId = `mission-${mission.id}-${Math.floor(Date.now() / 1000)}`;
      logTaskEvent(runId, 'mission', schedulerAgentId, 'start', `${mission.title}: ${mission.prompt.slice(0, 500)}`);
      const result = await runAgent(mission.prompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist,
        (eventType, content) => { try { logTaskEvent(runId, 'mission', schedulerAgentId, eventType, content); } catch { /* don't break task */ } });
      clearTimeout(timeout);

      if (result.aborted) {
        completeMissionTask(mission.id, null, 'failed', 'Timed out after 10 minutes');
        logger.warn({ missionId: mission.id }, 'Mission task timed out');
        try { await sender('Mission task timed out: "' + mission.title + '"'); } catch {}
        void fireMissionCallback(mission, 'failed', null, 'Timed out after 10 minutes');
      } else {
        const text = result.text?.trim() || 'Task completed with no output.';
        completeMissionTask(mission.id, text, 'completed');
        logger.info({ missionId: mission.id }, 'Mission task completed');

        // Send result to Telegram
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject into conversation context so agent can reference it
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', '[Mission task: ' + mission.title + ']: ' + mission.prompt, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        void fireMissionCallback(mission, 'completed', text, null);
      }

      emitChatEvent({
        type: 'mission_update' as 'progress',
        chatId,
        content: JSON.stringify({
          id: mission.id,
          status: result.aborted ? 'failed' : 'completed',
          title: mission.title,
        }),
      });
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = err instanceof Error ? err.message : String(err);
      completeMissionTask(mission.id, null, 'failed', errMsg.slice(0, 500));
      logger.error({ err, missionId: mission.id }, 'Mission task failed');
      void fireMissionCallback(mission, 'failed', null, errMsg.slice(0, 500));
    } finally {
      runningTaskIds.delete(missionKey);
    }
  });
}

/**
 * POST the completion webhook for a mission task if one is configured.
 * Merges caller-supplied payload with task outcome fields and retries
 * up to 3 times with exponential backoff. Never throws.
 */
async function fireMissionCallback(
  mission: MissionTask,
  status: 'completed' | 'failed',
  result: string | null,
  error: string | null,
): Promise<void> {
  if (!mission.callback_url) return;

  let userPayload: Record<string, unknown> = {};
  let userHeaders: Record<string, string> = {};
  try {
    if (mission.callback_payload) userPayload = JSON.parse(mission.callback_payload);
  } catch (e) {
    logger.warn({ missionId: mission.id, err: e }, 'Invalid callback_payload JSON, sending empty');
  }
  try {
    if (mission.callback_headers) userHeaders = JSON.parse(mission.callback_headers);
  } catch (e) {
    logger.warn({ missionId: mission.id, err: e }, 'Invalid callback_headers JSON, ignoring');
  }

  const body = JSON.stringify({
    ...userPayload,
    task_id: mission.id,
    title: mission.title,
    assigned_agent: mission.assigned_agent,
    status,
    result,
    error,
    completed_at: Math.floor(Date.now() / 1000),
  });

  const method = mission.callback_method || 'POST';
  const maxAttempts = 3;
  let attempt = 0;
  let lastErr = '';

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(mission.callback_url, {
        method,
        headers: { 'Content-Type': 'application/json', ...userHeaders },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        markMissionCallback(mission.id, 'sent', attempt);
        logger.info({ missionId: mission.id, attempt, status: res.status }, 'Mission callback delivered');
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }

  markMissionCallback(mission.id, 'failed', attempt);
  logger.error({ missionId: mission.id, attempts: attempt, err: lastErr }, 'Mission callback failed');
}

export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
