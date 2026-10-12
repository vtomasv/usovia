import { randomUUID } from 'node:crypto';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  validateFilters,
  selectSessions,
  solutionFor,
  digest,
  RETENTION,
  fail,
} from './domain.mjs';
import { redact } from '../../shared/analysis.mjs';
const MAX_SOURCE_BYTES = 2 * 1024 * 1024,
  MAX_FILE_BYTES = 4 * 1024 * 1024;
const dimensions = (s) => ({
  schema_version: 1,
  session_key: s.key,
  account_id: s.accountId,
  account_label: s.account.label,
  department: s.account.department,
  country: s.account.country,
  office: s.account.office,
  tags_json: JSON.stringify(s.account.tags),
  outcome_status: s.outcome.status,
  outcome_source: s.outcome.source,
});
function rowsFor(sessions, dataset, includeText) {
  if (dataset === 'turns')
    return sessions.flatMap((s) =>
      s.turns.map((t) => ({
        ...dimensions(s),
        row_id: t.id,
        event_id: t.id,
        installation_id: s.installationId,
        turn_index: t.turnIndex || 1,
        received_at: t.receivedAt,
        observed_at: t.observedAt,
        provider: t.provider,
        model: t.model || '',
        channel: t.channel,
        category: s.work.primary,
        response_present: typeof t.redactedResponse === 'string',
        response_status: t.responseStatus || 'not_authorized',
        upstream_status: t.upstreamStatus ?? null,
        prompt_truncated: !!t.promptTruncated,
        response_truncated: !!t.responseTruncated,
        model_limited: !!t.modelLimited,
        prompt_redactions: t.redactions || 0,
        response_redactions: t.responseRedactions || 0,
        ...(includeText
          ? {
              prompt_redacted: redact(t.redactedText).text,
              response_redacted:
                typeof t.redactedResponse === 'string' ? redact(t.redactedResponse).text : null,
            }
          : {}),
      })),
    );
  if (dataset === 'sessions')
    return sessions.map((s) => ({
      ...dimensions(s),
      row_id: s.key,
      installation_id: s.installationId,
      first_at: s.firstAt,
      last_at: s.lastAt,
      turn_count: s.turns.length,
      answer_count: s.turns.filter((t) => typeof t.redactedResponse === 'string').length,
      category: s.work.primary,
      has_gaps: s.hasGaps,
      limited: s.limited,
      review_stale: s.outcome.reviewStale,
      reviewed_at: s.outcome.reviewedAt || null,
      ...(includeText
        ? {
            evidence_redacted: redact(s.outcome.evidence).text,
            prompts_redacted: s.turns
              .map((t) => redact(t.redactedText).text)
              .join('\n\n')
              .slice(0, 12000),
            context_text_truncated: s.turns.map((t) => t.redactedText).join('\n\n').length > 12000,
          }
        : {}),
    }));
  return sessions
    .filter((s) => ['validated', 'positive_signal'].includes(s.outcome.status))
    .flatMap((s) => {
      const solution = solutionFor(s);
      return solution
        ? [
            {
              ...dimensions(s),
              row_id: s.key,
              event_id: solution.eventId,
              title: solution.title,
              category: s.work.primary,
              validated: s.outcome.status === 'validated',
              complete: solution.complete,
              limited: solution.limited,
              last_at: solution.lastAt,
              ...(includeText
                ? {
                    prompt_redacted: solution.prompt,
                    response_redacted: solution.response,
                    evidence_redacted: redact(solution.evidence).text,
                  }
                : {}),
            },
          ]
        : [];
    });
}
const BOOL = new Set([
  'response_present',
  'prompt_truncated',
  'response_truncated',
  'model_limited',
  'has_gaps',
  'limited',
  'review_stale',
  'validated',
  'complete',
  'context_text_truncated',
]);
const INT = new Set([
  'schema_version',
  'turn_index',
  'upstream_status',
  'prompt_redactions',
  'response_redactions',
  'turn_count',
  'answer_count',
]);
const DATES = new Set(['received_at', 'observed_at', 'first_at', 'last_at', 'reviewed_at']);
const KEYS = {
  turns: [
    'schema_version',
    'row_id',
    'session_key',
    'account_id',
    'account_label',
    'department',
    'country',
    'office',
    'tags_json',
    'outcome_status',
    'outcome_source',
    'event_id',
    'installation_id',
    'turn_index',
    'received_at',
    'observed_at',
    'provider',
    'model',
    'channel',
    'category',
    'response_present',
    'response_status',
    'upstream_status',
    'prompt_truncated',
    'response_truncated',
    'model_limited',
    'prompt_redactions',
    'response_redactions',
  ],
  sessions: [
    'schema_version',
    'row_id',
    'session_key',
    'account_id',
    'account_label',
    'department',
    'country',
    'office',
    'tags_json',
    'outcome_status',
    'outcome_source',
    'installation_id',
    'first_at',
    'last_at',
    'turn_count',
    'answer_count',
    'category',
    'has_gaps',
    'limited',
    'review_stale',
    'reviewed_at',
  ],
  solutions: [
    'schema_version',
    'row_id',
    'session_key',
    'account_id',
    'account_label',
    'department',
    'country',
    'office',
    'tags_json',
    'outcome_status',
    'outcome_source',
    'event_id',
    'title',
    'category',
    'validated',
    'complete',
    'limited',
    'last_at',
  ],
};
const TEXT_KEYS = {
  turns: ['prompt_redacted', 'response_redacted'],
  sessions: ['evidence_redacted', 'prompts_redacted', 'context_text_truncated'],
  solutions: ['prompt_redacted', 'response_redacted', 'evidence_redacted'],
};
function encode(rows, manifest) {
  const keys = [
    ...KEYS[manifest.dataset],
    ...(manifest.includeText ? TEXT_KEYS[manifest.dataset] : []),
  ];
  return Buffer.from(
    parquetWriteBuffer({
      columnData: keys.map((name) => ({
        name,
        type: BOOL.has(name)
          ? 'BOOLEAN'
          : INT.has(name)
            ? 'INT32'
            : DATES.has(name)
              ? 'TIMESTAMP'
              : 'STRING',
        data: rows.map((row) => {
          const value = row[name] ?? null;
          return value !== null && DATES.has(name) ? new Date(value) : value;
        }),
      })),
      rowGroupSize: 100,
      statistics: false,
      kvMetadata: [
        { key: 'usovia.schema_version', value: '1' },
        { key: 'usovia.dataset', value: manifest.dataset },
        { key: 'usovia.snapshot_at', value: manifest.createdAt },
        { key: 'usovia.text_included', value: String(manifest.includeText) },
        { key: 'usovia.filters', value: JSON.stringify(manifest.filters) },
        { key: 'usovia.retention', value: JSON.stringify(RETENTION) },
        {
          key: 'usovia.outcomes',
          value: 'positive_signal is not validated; HTTP 200 is not business success',
        },
      ],
    }),
  );
}
export class ExportService {
  constructor(analytics) {
    this.analytics = analytics;
  }
  async create(input) {
    if (
      !['turns', 'sessions', 'solutions'].includes(input.dataset) ||
      typeof input.includeText !== 'boolean'
    )
      fail(400, 'Selecciona un dataset y declara si incluye texto.');
    const filters = validateFilters(input.filters || {}),
      snapshot = await this.analytics.snapshot(),
      sessions = selectSessions(snapshot.sessions, filters),
      rows = rowsFor(sessions, input.dataset, input.includeText),
      createdAt = new Date().toISOString(),
      id = randomUUID();
    const safeFilters = {
      ...filters,
      ...(filters.query ? { query: redact(filters.query).text } : {}),
    };
    const manifest = {
      id,
      dataset: input.dataset,
      includeText: input.includeText,
      filters: safeFilters,
      createdAt,
      rowCount: rows.length,
      schemaVersion: 1,
      parts: [],
    };
    let chunk = [],
      bytes = 0;
    for (const row of rows) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (chunk.length && (bytes + size > MAX_SOURCE_BYTES || chunk.length >= 100)) {
        manifest.parts.push(chunk);
        chunk = [];
        bytes = 0;
      }
      chunk.push({ id: row.row_id, hash: digest(JSON.stringify(row)) });
      bytes += size;
    }
    if (chunk.length || !manifest.parts.length) manifest.parts.push(chunk);
    // Verify each planned file against the serverless response limit before persisting.
    const byId = new Map(rows.map((row) => [row.row_id, row]));
    for (let i = 0; i < manifest.parts.length; i++) {
      const part = manifest.parts[i],
        file = encode(
          part.map((x) => byId.get(x.id)),
          manifest,
        );
      if (file.length > MAX_FILE_BYTES) {
        if (part.length < 2) fail(413, 'El registro excede el límite de exportación.');
        const mid = Math.ceil(part.length / 2);
        manifest.parts.splice(i, 1, part.slice(0, mid), part.slice(mid));
        i--;
      }
    }
    await this.analytics.repository.putExport(manifest);
    return this.publicManifest(manifest);
  }
  publicManifest(m) {
    return {
      id: m.id,
      dataset: m.dataset,
      includeText: m.includeText,
      filters: m.filters,
      createdAt: m.createdAt,
      expiresAt: new Date(Date.parse(m.createdAt) + 30 * 60000).toISOString(),
      rowCount: m.rowCount,
      schemaVersion: 1,
      columns: [...KEYS[m.dataset], ...(m.includeText ? TEXT_KEYS[m.dataset] : [])].map((name) => ({
        name,
        type: BOOL.has(name)
          ? 'BOOLEAN'
          : INT.has(name)
            ? 'INT32'
            : DATES.has(name)
              ? 'TIMESTAMP_MILLIS'
              : 'STRING',
      })),
      retention: RETENTION,
      parts: m.parts.map((p, i) => ({
        index: i,
        rows: p.length,
        filename: `usovia-${m.dataset}-${m.createdAt.slice(0, 10)}-part-${String(i + 1).padStart(3, '0')}.parquet`,
        url: `/api/analytics/exports/${m.id}/${i}.parquet`,
      })),
    };
  }
  async part(id, index) {
    const manifest = await this.analytics.repository.getExport(id);
    if (!manifest) fail(410, 'La exportación expiró o fue invalidada por un borrado.');
    if (!Number.isInteger(index) || !manifest.parts[index]) fail(404, 'Parte no encontrada.');
    const snapshot = await this.analytics.snapshot(),
      current = rowsFor(snapshot.sessions, manifest.dataset, manifest.includeText),
      byId = new Map(current.map((row) => [row.row_id, row])),
      rows = [];
    for (const entry of manifest.parts[index]) {
      const row = byId.get(entry.id);
      if (row && digest(JSON.stringify(row)) === entry.hash) rows.push(row);
    }
    const bytes = encode(rows, manifest);
    if (bytes.length > MAX_FILE_BYTES) fail(413, 'Parte demasiado grande.');
    return {
      bytes,
      filename: this.publicManifest(manifest).parts[index].filename,
      rows: rows.length,
      unavailable: manifest.parts[index].length - rows.length,
    };
  }
}
