import {
  AutoTokenizer,
  AutoModel,
  FeatureExtractionPipeline,
  env,
} from '@huggingface/transformers';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { getStore } from '../server/store.mjs';
import { AnalyticsService } from '../server/analytics/service.mjs';
import {
  MODEL_ID,
  MODEL_KEY,
  MODEL_REVISION,
  buildSessions,
  retainedState,
} from '../server/analytics/domain.mjs';
config({ path: process.env.USOVIA_WORKER_ENV_FILE || '.env.local', quiet: true });
// Downloads contain model assets only. Captured text never leaves this process.
env.cacheDir = resolve(process.env.USOVIA_MODEL_CACHE || '.runtime/semantic-models');
if (process.env.USOVIA_MODELS_OFFLINE === '1') env.allowRemoteModels = false;
const store = getStore(),
  analytics = new AnalyticsService(store),
  owner = randomUUID();
let extractor,
  stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
function chunks(session) {
  const pieces = [];
  for (const prompt of session.embeddingPrompts) {
    const tokens = extractor.tokenizer.encode(prompt, { add_special_tokens: false });
    for (let offset = 0; offset < tokens.length; offset += 126)
      pieces.push(
        extractor.tokenizer.decode(tokens.slice(offset, offset + 126), {
          skip_special_tokens: true,
        }),
      );
  }
  const selected = pieces.length > 8 ? [...pieces.slice(0, 4), ...pieces.slice(-4)] : pieces;
  if (!selected.length) selected.push('Consulta sin texto');
  return {
    selected,
    limited:
      pieces.length > 8 || selected.some((text) => extractor.tokenizer.encode(text).length > 128),
    total: pieces.length,
  };
}
async function run() {
  const raw = await store.read((s) => s);
  if (store.sql && retainedState(raw).events.length !== raw.events.length)
    await store.transact((s) => {
      s.events = retainedState(s).events;
    });
  await analytics.repository.workerHeartbeat(owner, MODEL_KEY);
  const snapshot = await analytics.snapshot();
  if (!snapshot.documents.some((d) => d.status !== 'ready' && d.attempts < 3))
    return { completed: 0 };
  if (!extractor) {
    const cachedPath = resolve(env.cacheDir, MODEL_ID, MODEL_REVISION);
    const cached = await Promise.all(
      ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].map(
        (file) =>
          access(resolve(cachedPath, file)).then(
            () => true,
            () => false,
          ),
      ),
    ).then((found) => found.every(Boolean));
    if (process.env.USOVIA_MODELS_OFFLINE === '1' && !cached)
      throw new Error('Pinned model assets are missing from the private cache.');
    const modelSource = cached ? cachedPath : MODEL_ID;
    const options = {
      revision: cached ? 'main' : MODEL_REVISION,
      dtype: 'q8',
      device: 'cpu',
      local_files_only: process.env.USOVIA_MODELS_OFFLINE === '1',
    };
    // Explicit components use the pinned revision even when metadata discovery is offline.
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelSource, options),
      AutoModel.from_pretrained(modelSource, options),
    ]);
    extractor = new FeatureExtractionPipeline({ task: 'feature-extraction', tokenizer, model });
  }
  extractor.tokenizer.config.model_max_length = 128;
  const jobs = await analytics.repository.claim(8, owner);
  let completed = 0,
    failed = 0;
  for (const job of jobs) {
    try {
      if (job.model !== MODEL_KEY) throw new Error('Model version mismatch');
      const session = buildSessions(await analytics.state()).find(
        (s) => s.key === job.key && s.promptHash === job.sourceHash,
      );
      if (!session) {
        await analytics.repository.reconcile(buildSessions(await analytics.state()), MODEL_KEY);
        continue;
      }
      const input = chunks(session),
        output = await extractor(input.selected, { pooling: 'mean', normalize: true });
      const matrix = output.tolist(),
        vector = Array.from(
          { length: matrix[0].length },
          (_, i) => matrix.reduce((n, row) => n + row[i], 0) / matrix.length,
        ),
        norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
      const current = buildSessions(await analytics.state()).find(
        (s) => s.key === job.key && s.promptHash === job.sourceHash,
      );
      if (!current) {
        await analytics.repository.reconcile(buildSessions(await analytics.state()), MODEL_KEY);
        continue;
      }
      if (
        await analytics.repository.complete(
          job,
          vector.map((v) => v / norm),
          {
            revision: MODEL_REVISION,
            maxTokens: 128,
            chunks: input.selected.length,
            availableChunks: input.total,
            limited: input.limited,
          },
        )
      )
        completed++;
    } catch {
      failed++;
      await analytics.repository.failed(job);
      console.error('Semantic job failed; retry is bounded.');
    }
  }
  return { completed, failed };
}
try {
  let total = 0;
  do {
    const result = await run();
    total += result.completed;
    if (result.failed) process.exitCode = 1;
    console.log(JSON.stringify({ completed: result.completed, total }));
    if (process.argv.includes('--once')) {
      if (!result.completed) break;
      continue;
    }
    await new Promise((r) => setTimeout(r, 5000));
  } while (!stopping);
} finally {
  await extractor?.dispose();
  analytics.repository.close();
  await store.sql?.end({ timeout: 5 });
}
