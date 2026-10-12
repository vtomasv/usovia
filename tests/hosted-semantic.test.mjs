import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileStore } from '../server/store.mjs';
import { HubService } from '../server/service.mjs';
import { runHostedBatch } from '../server/analytics/hosted.mjs';
import { signature, validSemanticRequest } from '../server/analytics/dispatch.mjs';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'usovia-hosted-')),
    hub = new HubService(new FileStore(join(dir, 'state.json')));
  t.after(async () => {
    hub.analytics.repository.close();
    await rm(dir, { recursive: true, force: true });
  });
  const a = await hub.createAccount({ department: 'Controlled test' }),
    i = await hub.activate({ activationCode: a.activationCode });
  await hub.consent(i.token, {
    version: 1,
    scopes: { capture: true, shareText: true, captureResponses: true, reportStatus: false },
  });
  await hub.ingest(i.token, {
    consentVersion: 1,
    events: [
      {
        id: randomUUID(),
        redactedText: 'Analiza el presupuesto del ejemplo controlado.',
        redactedResponse: 'Resultado controlado.',
        responseStatus: 'complete',
      },
    ],
  });
  return { hub, i };
}
const vector = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : 0));
test('private semantic invocation needs a fresh signed POST, not a client token or a replayed old header', () => {
  const secret = 'controlled-private-signing-key-with-32-chars',
    now = Date.now(),
    time = String(now),
    req = {
      method: 'POST',
      headers: { 'x-usovia-time': time, 'x-usovia-signature': signature(time, secret) },
    };
  assert.equal(validSemanticRequest(req, secret, now), true);
  assert.equal(validSemanticRequest({ ...req, method: 'GET' }, secret, now), false);
  assert.equal(validSemanticRequest(req, secret, now + 120001), false);
  assert.equal(
    validSemanticRequest(
      { ...req, headers: { ...req.headers, 'x-usovia-signature': 'a'.repeat(64) } },
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    validSemanticRequest(
      { method: 'POST', headers: { authorization: 'Bearer endpoint-token' } },
      secret,
      now,
    ),
    false,
  );
});
test('bounded hosted execution completes queued vectors and does not load a model again when no work remains', async (t) => {
  const { hub } = await fixture(t);
  let loads = 0;
  const loadEncoder = async () => {
    loads++;
    return async () => ({ vector, metadata: { execution: 'controlled-test' } });
  };
  let result = await runHostedBatch(hub.analytics, { loadEncoder });
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal((await hub.analytics.dashboard()).semantic.indexedSessions, 1);
  result = await runHostedBatch(hub.analytics, { loadEncoder });
  assert.equal(result.completed, 0);
  assert.equal(loads, 1);
});
test('hosted inference cannot store a vector after the participant erases the conversation', async (t) => {
  const { hub, i } = await fixture(t);
  const result = await runHostedBatch(hub.analytics, {
    loadEncoder: async () => async () => {
      await hub.erase(i.token);
      return { vector, metadata: {} };
    },
  });
  assert.equal(result.completed, 0);
  assert.equal((await hub.analytics.repository.entries()).documents.length, 0);
});
test('model initialization failures preserve source and enter bounded retry state', async (t) => {
  const { hub } = await fixture(t);
  const result = await runHostedBatch(hub.analytics, {
    loadEncoder: async () => {
      throw new Error('Controlled model failure');
    },
  });
  assert.equal(result.reason, 'model_unavailable');
  assert.equal(result.failed, 1);
  const snapshot = await hub.analytics.snapshot();
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.documents[0].status, 'failed');
  assert.equal(snapshot.documents[0].attempts, 1);
});
