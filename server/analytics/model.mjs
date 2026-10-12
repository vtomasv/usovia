import {
  AutoTokenizer,
  AutoModel,
  FeatureExtractionPipeline,
  env,
} from '@huggingface/transformers';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MODEL_ID, MODEL_REVISION } from './domain.mjs';
const ASSETS = [
  ['config.json', 673, '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7'],
  ['tokenizer.json', 17082913, 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441'],
  [
    'tokenizer_config.json',
    496,
    '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
  ],
  [
    'onnx/model_quantized.onnx',
    118308126,
    '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
  ],
];
let loading;
async function assets() {
  const path = resolve(tmpdir(), 'usovia-models', MODEL_REVISION);
  for (const [file, size, hash] of ASSETS) {
    const target = resolve(path, file);
    let bytes;
    try {
      bytes = await readFile(target);
    } catch {}
    if (bytes?.length === size && createHash('sha256').update(bytes).digest('hex') === hash)
      continue;
    const response = await fetch(
      `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error('Approved model asset unavailable');
    const announced = Number(response.headers.get('content-length'));
    if (announced && announced > size) throw new Error('Model asset exceeds expected size');
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > size) throw new Error('Model asset exceeds expected size');
      chunks.push(Buffer.from(chunk));
    }
    bytes = Buffer.concat(chunks);
    if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error('Model asset integrity check failed');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return path;
}
export function getEncoder() {
  if (!loading)
    loading = (async () => {
      const path = await assets();
      env.allowRemoteModels = false;
      const options = {
        local_files_only: true,
        dtype: 'q8',
        device: 'cpu',
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
      };
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(path, options),
        AutoModel.from_pretrained(path, options),
      ]);
      tokenizer.config.model_max_length = 128;
      const extractor = new FeatureExtractionPipeline({
        task: 'feature-extraction',
        tokenizer,
        model,
      });
      return async (session) => {
        const pieces = [];
        for (const text of session.embeddingPrompts) {
          const ids = tokenizer.encode(text, { add_special_tokens: false });
          for (let i = 0; i < ids.length; i += 126)
            pieces.push(tokenizer.decode(ids.slice(i, i + 126), { skip_special_tokens: true }));
        }
        const selected = pieces.length > 8 ? [...pieces.slice(0, 4), ...pieces.slice(-4)] : pieces;
        if (!selected.length) selected.push('Consulta sin texto');
        const output = await extractor(selected, { pooling: 'mean', normalize: true }),
          matrix = output.tolist(),
          vector = Array.from(
            { length: matrix[0].length },
            (_, i) => matrix.reduce((n, row) => n + row[i], 0) / matrix.length,
          ),
          norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
        return {
          vector: vector.map((v) => v / norm),
          metadata: {
            revision: MODEL_REVISION,
            maxTokens: 128,
            chunks: selected.length,
            availableChunks: pieces.length,
            limited:
              pieces.length > 8 || selected.some((text) => tokenizer.encode(text).length > 128),
            execution: 'vercel_private_cpu',
          },
        };
      };
    })().catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
