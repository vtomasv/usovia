import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { FileStore } from '../server/store.mjs';
import { HubService } from '../server/service.mjs';
import { AnalyticsRepository } from '../server/analytics/repository.mjs';
import { ExportService } from '../server/analytics/export.mjs';
import {
  feedbackSignal,
  evaluateOutcome,
  validateFilters,
  MODEL_KEY,
} from '../server/analytics/domain.mjs';
import { semanticGraph } from '../server/analytics/semantic.mjs';
import { parquetReadObjects, parquetMetadata } from 'hyparquet';
import { handle } from '../server/http.mjs';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'usovia-analytics-'));
  const store = new FileStore(join(dir, 'state.json')),
    hub = new HubService(store);
  const additionalRepositories = [];
  t.after(async () => {
    for (const repository of additionalRepositories) repository.close();
    hub.analytics.repository.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, hub, additionalRepositories };
}
async function participant(hub, department = 'Operaciones') {
  const a = await hub.createAccount({
      department,
      country: 'Chile',
      office: 'Santiago',
      tags: ['equipo-a'],
    }),
    i = await hub.activate({ activationCode: a.activationCode });
  await hub.consent(i.token, {
    version: 1,
    scopes: { capture: true, shareText: true, captureResponses: true, reportStatus: false },
  });
  return { ...i, account: a.account };
}
async function session(
  hub,
  i,
  {
    accepted = true,
    prompt = 'Redacta una respuesta empática al cliente por una devolución.',
    response = 'Hola [CLIENTE], estos son los pasos para solicitar la devolución.',
    status = 'complete',
  } = {},
) {
  const conversationId = randomUUID(),
    events = [
      {
        id: randomUUID(),
        conversationId,
        turnIndex: 1,
        sessionSource: 'explicit',
        redactedText: prompt,
        redactedResponse: response,
        responseStatus: status,
        provider: 'ollama',
        model: 'test-model',
        channel: 'chat_usovia',
        upstreamStatus: 200,
      },
    ];
  if (accepted)
    events.push({
      id: randomUUID(),
      conversationId,
      turnIndex: 2,
      sessionSource: 'explicit',
      redactedText: 'Perfecto, esto resuelve el caso.',
      redactedResponse: 'Gracias por confirmar.',
      responseStatus: 'complete',
      provider: 'ollama',
      channel: 'chat_usovia',
      upstreamStatus: 200,
    });
  await hub.ingest(i.token, { consentVersion: 1, events });
  return { key: i.installationId + ':' + conversationId, events };
}
const vector = (slot = 0) => Array.from({ length: 16 }, (_, i) => (i === slot ? 1 : 0));

test('outcomes require explicit evidence; generated success, HTTP 200, quotations and negated thanks do not validate work', async (t) => {
  const { hub } = await fixture(t),
    i = await participant(hub);
  await session(hub, i, {
    accepted: false,
    response: 'Esta solución es perfecta y funciona correctamente.',
  });
  let d = await hub.analytics.dashboard();
  assert.equal(d.summary.validated, 0);
  assert.equal(d.summary.unknown, 1);
  assert.equal(feedbackSignal('Gracias, pero no funciona.'), 'negative');
  assert.equal(feedbackSignal('Perfecto, pero todavía falla.'), null);
  assert.equal(feedbackSignal('Redacta un correo que diga perfecto, ya funciona.'), null);
  assert.equal(feedbackSignal('El cliente dice "no funciona". Redacta una respuesta.'), null);
  await session(hub, i);
  d = await hub.analytics.dashboard();
  assert.equal(d.summary.positiveSignals, 1);
  assert.equal(d.summary.validated, 0);
});
test('review is versioned, re-redacted and tied to complete captured context; a later turn invalidates previous validation', async (t) => {
  const { hub } = await fixture(t),
    i = await participant(hub),
    s = await session(hub, i);
  let p = await hub.analytics.session({ key: s.key });
  await hub.analytics.review({
    key: s.key,
    version: p.version,
    eventId: s.events[0].id,
    decision: 'validated',
    note: 'Validé los pasos con persona@example.invalid y una revisión de política.',
  });
  let d = await hub.analytics.dashboard();
  assert.equal(d.summary.validated, 1);
  assert.ok(!JSON.stringify(d.solutions).includes('persona@example.invalid'));
  await assert.rejects(
    hub.analytics.review({
      key: s.key,
      version: 'old-version',
      eventId: s.events[0].id,
      decision: 'validated',
      note: 'Verificación completa de la solución.',
    }),
    (e) => e.status === 409,
  );
  await hub.ingest(i.token, {
    consentVersion: 1,
    events: [
      {
        id: randomUUID(),
        conversationId: s.events[0].conversationId,
        turnIndex: 3,
        sessionSource: 'explicit',
        redactedText: 'Ajusta el resultado para el caso nuevo.',
        redactedResponse: 'Resultado ajustado.',
        responseStatus: 'complete',
      },
    ],
  });
  d = await hub.analytics.dashboard();
  assert.equal(d.summary.validated, 0);
  assert.equal(d.sessions[0].outcome.reviewStale, true);
  const incomplete = await session(hub, i, { accepted: false, status: 'truncated' });
  p = await hub.analytics.session({ key: incomplete.key });
  await assert.rejects(
    hub.analytics.review({
      key: incomplete.key,
      version: p.version,
      eventId: incomplete.events[0].id,
      decision: 'validated',
      note: 'Intento validar una respuesta recortada.',
    }),
    (e) => e.status === 400,
  );
});
test('session filters retain full conversation context, validate dates and do not mix accounts with identical prompts', async (t) => {
  const { hub } = await fixture(t),
    a = await participant(hub, 'Atención'),
    b = await participant(hub, 'Finanzas');
  await session(hub, a);
  await session(hub, b);
  const d = await hub.analytics.dashboard({ account: a.account.id, query: 'devolución' });
  assert.equal(d.summary.sessions, 1);
  assert.equal(d.summary.turns, 2);
  assert.equal(d.sessions[0].account.id, a.account.id);
  assert.equal(d.categories[0].id, 'customer');
  assert.throws(
    () => validateFilters({ from: '2026-02-30' }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => validateFilters({ from: '2026-10-11', to: '2026-10-01' }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => validateFilters({ category: 'untrusted' }),
    (e) => e.status === 400,
  );
});
test('account directory searches accents and groups on the server, pages results and never exposes activation or installation credentials', async (t) => {
  const { hub } = await fixture(t);
  for (let n = 0; n < 23; n++)
    await hub.createAccount({
      department: 'Operación',
      country: 'Chile',
      office: 'Santiago',
      tags: ['equipo norte'],
    });
  const first = await hub.analytics.directory({ query: 'operacion norte' }),
    second = await hub.analytics.directory({ query: 'operacion norte', page: '1' });
  assert.equal(first.total, 23);
  assert.equal(first.accounts.length, 20);
  assert.equal(second.accounts.length, 3);
  assert.equal(new Set([...first.accounts, ...second.accounts].map((a) => a.id)).size, 23);
  assert.ok(!JSON.stringify(first).includes('activationHash'));
  assert.ok(!JSON.stringify(first).includes('tokenHash'));
});
test('semantic leases are exclusive across connections and old completion cannot overwrite a changed document', async (t) => {
  const { hub, dir, additionalRepositories } = await fixture(t),
    i = await participant(hub);
  await session(hub, i, { accepted: false });
  const snapshot = await hub.analytics.snapshot(),
    repository = hub.analytics.repository,
    other = new AnalyticsRepository({ path: join(dir, 'state.json.analytics.sqlite') });
  additionalRepositories.push(other);
  const [a, b] = await Promise.all([repository.claim(1, 'worker-a'), other.claim(1, 'worker-b')]);
  assert.equal(a.length + b.length, 1);
  const job = a[0] || b[0];
  const changed = { ...snapshot.sessions[0], promptHash: 'changed-hash' };
  await repository.reconcile([changed], MODEL_KEY);
  assert.equal(await repository.complete(job, vector()), false);
  const [current] = await repository.claim(1, 'worker-c');
  assert.equal(await repository.complete(current, vector()), true);
  const entries = await repository.entries();
  assert.equal(entries.documents[0].sourceHash, 'changed-hash');
  assert.equal(entries.documents[0].status, 'ready');
});
test('erasure fences stale reconciliation and reviews, invalidates exports and accepts newly authorized epochs', async (t) => {
  const { hub } = await fixture(t),
    i = await participant(hub),
    s = await session(hub, i);
  const snapshot = await hub.analytics.snapshot(),
    [job] = await hub.analytics.repository.claim(1, 'worker-a'),
    p = await hub.analytics.session({ key: s.key }),
    exports = new ExportService(hub.analytics),
    m = await exports.create({ dataset: 'turns', includeText: true });
  const erased = await hub.erase(i.token);
  assert.equal(await hub.analytics.repository.complete(job, vector()), false);
  await hub.analytics.repository.reconcile(snapshot.sessions, MODEL_KEY);
  assert.equal((await hub.analytics.repository.entries()).documents.length, 0);
  await assert.rejects(
    hub.analytics.repository.review(snapshot.sessions[0], {
      eventId: s.events[0].id,
      decision: 'validated',
      note: 'Stale review attempt.',
    }),
    (e) => e.status === 409,
  );
  await assert.rejects(exports.part(m.id, 0), (e) => e.status === 410);
  assert.equal((await hub.analytics.dashboard()).summary.sessions, 0);
  await hub.consent(i.token, {
    version: erased.consentVersion + 1,
    scopes: { capture: true, shareText: true, captureResponses: true, reportStatus: false },
  });
  await hub.ingest(i.token, {
    consentVersion: erased.consentVersion + 1,
    events: [
      {
        id: randomUUID(),
        redactedText: 'Una consulta nueva autorizada después del borrado.',
        redactedResponse: 'Respuesta nueva.',
        responseStatus: 'complete',
      },
    ],
  });
  assert.equal((await hub.analytics.snapshot()).documents.length, 1);
  assert.ok(p.version);
});
test('real Parquet round-trips Unicode, dates, null responses and schema metadata without leaking credentials', async (t) => {
  const { hub } = await fixture(t),
    i = await participant(hub);
  await session(hub, i, {
    prompt: 'Redacta un correo para persona@example.invalid: ¡devolución y Unicode ✓!',
  });
  await hub.ingest(i.token, {
    consentVersion: 1,
    events: [
      {
        id: randomUUID(),
        redactedText: 'Una consulta sin respuesta capturada para comprobar valores nulos.',
      },
    ],
  });
  const service = new ExportService(hub.analytics),
    manifest = await service.create({ dataset: 'turns', includeText: true });
  const p = await service.part(manifest.id, 0),
    file = p.bytes.buffer.slice(p.bytes.byteOffset, p.bytes.byteOffset + p.bytes.byteLength),
    rows = await parquetReadObjects({ file });
  assert.equal(rows.length, 3);
  assert.ok(rows[0].observed_at instanceof Date);
  assert.ok(rows.some((row) => row.prompt_redacted.includes('Unicode ✓')));
  assert.ok(rows.some((row) => row.response_redacted === null && !row.response_present));
  assert.ok(!JSON.stringify(rows).includes('persona@example.invalid'));
  assert.ok(!JSON.stringify(rows).includes(i.token));
  assert.ok(!('tokenHash' in rows[0]));
  assert.equal(
    parquetMetadata(file).key_value_metadata.find((x) => x.key === 'usovia.schema_version').value,
    '1',
  );
  const metadata = await service.create({ dataset: 'turns', includeText: false }),
    metaPart = await service.part(metadata.id, 0),
    metaRows = await parquetReadObjects({
      file: metaPart.bytes.buffer.slice(
        metaPart.bytes.byteOffset,
        metaPart.bytes.byteOffset + metaPart.bytes.byteLength,
      ),
    });
  assert.ok(!('prompt_redacted' in metaRows[0]));
});
test('export splits large text below response limits and drops changed rows instead of silently mixing snapshots', async (t) => {
  const { hub, store } = await fixture(t),
    i = await participant(hub);
  for (let n = 0; n < 90; n++)
    await session(hub, i, {
      accepted: false,
      prompt: 'A'.repeat(12000),
      response: 'B'.repeat(12000),
    });
  const service = new ExportService(hub.analytics),
    manifest = await service.create({ dataset: 'turns', includeText: true });
  assert.ok(manifest.parts.length > 1);
  let count = 0;
  for (const part of manifest.parts) {
    const p = await service.part(manifest.id, part.index);
    assert.ok(p.bytes.length < 4 * 1024 * 1024);
    count += p.rows;
  }
  assert.equal(count, 90);
  const firstPart = await service.part(manifest.id, 0);
  const [firstRow] = await parquetReadObjects({
    file: firstPart.bytes.buffer.slice(
      firstPart.bytes.byteOffset,
      firstPart.bytes.byteOffset + firstPart.bytes.byteLength,
    ),
  });
  await store.transact((s) => {
    s.events.find((e) => e.id === firstRow.event_id).redactedText = 'Changed after the snapshot';
  });
  const changed = await service.part(manifest.id, 0);
  assert.equal(changed.unavailable, 1);
});
test('empty Parquet exports are readable and review status is never inferred from embedding proximity', async (t) => {
  const { hub } = await fixture(t),
    exports = new ExportService(hub.analytics),
    m = await exports.create({ dataset: 'sessions', includeText: false }),
    part = await exports.part(m.id, 0);
  assert.deepEqual(
    await parquetReadObjects({
      file: part.bytes.buffer.slice(
        part.bytes.byteOffset,
        part.bytes.byteOffset + part.bytes.byteLength,
      ),
    }),
    [],
  );
  const i = await participant(hub);
  await session(hub, i, { accepted: false });
  let snapshot = await hub.analytics.snapshot();
  const [job] = await hub.analytics.repository.claim(1, 'worker');
  await hub.analytics.repository.complete(job, vector());
  snapshot = await hub.analytics.snapshot();
  assert.equal(snapshot.sessions[0].outcome.status, 'unknown');
  const clone = {
    ...snapshot.sessions[0],
    key: 'other',
    accountId: 'other',
    account: { ...snapshot.sessions[0].account, id: 'other' },
    outcome: evaluateOutcome(snapshot.sessions[0]),
  };
  const graph = semanticGraph(
    [...snapshot.sessions, clone],
    [...snapshot.documents, { ...snapshot.documents[0], key: 'other' }],
  );
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.nodes.filter((n) => n.status === 'validated').length, 0);
  assert.equal(graph.indexedSessions, 2);
});
test('admin-only analytics and binary exports reject client bearer credentials and cross-origin writes', async (t) => {
  const { hub } = await fixture(t),
    i = await participant(hub);
  await session(hub, i);
  const previous = {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PUBLIC_HUB_URL: process.env.PUBLIC_HUB_URL,
  };
  process.env.ADMIN_PASSWORD = 'analytics-test-admin-password';
  process.env.SESSION_SECRET = 'analytics-test-secret-with-more-than-32-chars';
  process.env.PUBLIC_HUB_URL = 'http://127.0.0.1';
  const server = createServer((req, res) => handle(req, res, hub));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((r) => server.close(r));
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const url = `http://127.0.0.1:${server.address().port}/api/`;
  for (const route of ['analytics', 'accounts', 'analytics/session?key=x'])
    assert.equal(
      (await fetch(url + route, { headers: { Authorization: 'Bearer ' + i.token } })).status,
      401,
    );
  const login = await fetch(url + 'login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
    }),
    cookie = login.headers.get('set-cookie');
  assert.equal(login.status, 200);
  const blocked = await fetch(url + 'analytics/exports', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'https://untrusted.invalid',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dataset: 'turns', includeText: true }),
  });
  assert.equal(blocked.status, 403);
  const create = await fetch(url + 'analytics/exports', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset: 'turns', includeText: false }),
  });
  assert.equal(create.status, 201);
  const manifest = await create.json(),
    part = await fetch(new URL(manifest.parts[0].url, url), { headers: { Cookie: cookie } });
  assert.equal(part.status, 200);
  assert.equal(part.headers.get('content-type'), 'application/vnd.apache.parquet');
  assert.equal(
    Buffer.from(await part.arrayBuffer())
      .subarray(0, 4)
      .toString(),
    'PAR1',
  );
  assert.equal((await fetch(new URL(manifest.parts[0].url, url))).status, 401);
});

test('worker retries are bounded, lost leases are reclaimed, tenants are isolated and derived retention expires', async (t) => {
  const { hub, dir, additionalRepositories } = await fixture(t),
    i = await participant(hub);
  await session(hub, i, { accepted: false });
  const { sessions } = await hub.analytics.snapshot();
  let now = Date.now();
  const repository = new AnalyticsRepository({
    path: join(dir, 'queue.sqlite'),
    tenant: 'team-a',
    clock: () => now,
  });
  const other = new AnalyticsRepository({
    path: join(dir, 'queue.sqlite'),
    tenant: 'team-b',
    clock: () => now,
  });
  additionalRepositories.push(repository, other);
  await repository.reconcile(sessions, MODEL_KEY);
  assert.equal((await other.entries()).documents.length, 0);
  assert.equal((await other.claim()).length, 0);
  const [lost] = await repository.claim(1, 'lost');
  assert.equal((await repository.claim(1, 'next')).length, 0);
  now += 300001;
  const [second] = await repository.claim(1, 'next');
  assert.ok(second);
  assert.equal(await repository.complete(lost, vector()), false);
  await repository.failed(second);
  assert.equal((await repository.claim()).length, 0);
  now += 30001;
  const [last] = await repository.claim(1, 'last');
  await repository.failed(last);
  now += 30001;
  assert.equal((await repository.claim()).length, 0);
  assert.equal((await repository.entries()).documents[0].attempts, 3);
  await repository.putExport({ id: 'qa-manifest', parts: [] });
  assert.ok(await repository.getExport('qa-manifest'));
  now += 30 * 60000 + 1;
  assert.equal(await repository.getExport('qa-manifest'), null);
  now = sessions[0].expiresAt + 1;
  await repository.reconcile(sessions, MODEL_KEY);
  assert.equal((await repository.entries()).documents.length, 0);
});
test('semantic cluster counts include indexed sessions beyond the drawing limit and ignore stale model versions', async (t) => {
  const { hub } = await fixture(t),
    i = await participant(hub);
  await session(hub, i, { accepted: false });
  const { sessions } = await hub.analytics.snapshot();
  const clones = Array.from({ length: 5 }, (_, n) => ({ ...sessions[0], key: 'key-' + n }));
  const documents = clones.map((s) => ({
    key: s.key,
    sourceHash: s.promptHash,
    model: MODEL_KEY,
    status: 'ready',
    vector: vector(),
  }));
  const graph = semanticGraph(clones, documents, { maxNodes: 2 });
  assert.equal(graph.visibleSessions, 2);
  assert.equal(graph.indexedSessions, 5);
  assert.ok(graph.clusters.some((c) => c.sessions > 2));
  assert.ok(
    graph.edges.every(
      (e) =>
        graph.nodes.some((n) => n.key === e.source) && graph.nodes.some((n) => n.key === e.target),
    ),
  );
  assert.equal(
    semanticGraph(
      clones,
      documents.map((d) => ({ ...d, model: 'obsolete' })),
    ).indexedSessions,
    0,
  );
});
