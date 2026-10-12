import { randomUUID } from 'node:crypto';
import { buildSessions, MODEL_KEY } from './domain.mjs';
const owner = 'vercel-' + randomUUID();
let running;
export async function runHostedBatch(
  analytics,
  { loadEncoder = async () => (await import('./model.mjs')).getEncoder(), clock = Date.now } = {},
) {
  const started = clock(),
    snapshot = await analytics.snapshot();
  if (!snapshot.documents.some((d) => d.status !== 'ready' && d.attempts < 3))
    return { completed: 0, failed: 0 };
  const jobs = await analytics.repository.claim(4, owner);
  if (!jobs.length) return { completed: 0, failed: 0 };
  await analytics.repository.workerHeartbeat(owner, MODEL_KEY);
  let encoder;
  try {
    encoder = await loadEncoder();
  } catch {
    for (const job of jobs) await analytics.repository.failed(job);
    return { completed: 0, failed: jobs.length, reason: 'model_unavailable' };
  }
  let completed = 0,
    failed = 0;
  for (const job of jobs) {
    try {
      const before = buildSessions(await analytics.state()).find(
        (s) => s.key === job.key && s.promptHash === job.sourceHash,
      );
      if (!before) continue;
      const inferenceStarted = clock();
      const result = await encoder(before),
        current = buildSessions(await analytics.state()).find(
          (s) => s.key === job.key && s.promptHash === job.sourceHash,
        );
      if (
        current &&
        (await analytics.repository.complete(job, result.vector, {
          ...result.metadata,
          inferenceMilliseconds: clock() - inferenceStarted,
          rssBytes: process.memoryUsage().rss,
        }))
      )
        completed++;
    } catch {
      failed++;
      await analytics.repository.failed(job);
    }
  }
  await analytics.repository.workerHeartbeat(owner, MODEL_KEY);
  return {
    completed,
    failed,
    milliseconds: clock() - started,
    rssBytes: process.memoryUsage().rss,
  };
}
export function executeHosted(analytics) {
  if (!running)
    running = (async () => {
      const started = Date.now(),
        total = { completed: 0, failed: 0, milliseconds: 0, rssBytes: 0 };
      do {
        const batch = await runHostedBatch(analytics);
        total.completed += batch.completed;
        total.failed += batch.failed;
        total.rssBytes = Math.max(total.rssBytes, batch.rssBytes || 0);
        if (!batch.completed || Date.now() - started >= 40000) break;
      } while (true);
      total.milliseconds = Date.now() - started;
      return total;
    })().finally(() => {
      running = null;
    });
  return running;
}
