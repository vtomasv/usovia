import { mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS usovia_semantic_documents (
 tenant_id TEXT NOT NULL, session_key TEXT NOT NULL, account_id TEXT NOT NULL, installation_id TEXT NOT NULL,
 source_hash TEXT NOT NULL, model_id TEXT NOT NULL, consent_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', embedding_json TEXT,
 metadata_json TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until BIGINT,
 expires_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY(tenant_id,session_key)
);
CREATE INDEX IF NOT EXISTS usovia_semantic_queue ON usovia_semantic_documents(tenant_id,status,lease_until);
CREATE TABLE IF NOT EXISTS usovia_session_reviews (
 tenant_id TEXT NOT NULL, session_key TEXT NOT NULL, account_id TEXT NOT NULL, installation_id TEXT NOT NULL,
 source_hash TEXT NOT NULL, event_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL,
 reviewed_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY(tenant_id,session_key)
);
CREATE TABLE IF NOT EXISTS usovia_analytics_workers (
 tenant_id TEXT NOT NULL, worker_id TEXT NOT NULL, model_id TEXT NOT NULL, last_seen BIGINT NOT NULL,
 PRIMARY KEY(tenant_id,worker_id)
);
CREATE TABLE IF NOT EXISTS usovia_analytics_erasure_fences (
 tenant_id TEXT NOT NULL, installation_id TEXT NOT NULL, consent_version INTEGER NOT NULL, expires_at BIGINT NOT NULL,
 PRIMARY KEY(tenant_id,installation_id)
);
CREATE TABLE IF NOT EXISTS usovia_session_review_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_key TEXT NOT NULL, installation_id TEXT NOT NULL,
 source_hash TEXT NOT NULL, event_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL, reviewed_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS usovia_analytics_exports (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, manifest_json TEXT NOT NULL, expires_at BIGINT NOT NULL,
 PRIMARY KEY(tenant_id,id)
);`;
export class AnalyticsRepository {
  constructor({ sql, path, tenant = 'usovia-demo', clock = Date.now }) {
    this.sql = sql;
    this.path = path;
    this.tenant = tenant;
    this.clock = clock;
    this.ready = null;
    this.tail = Promise.resolve();
  }
  async init() {
    if (!this.ready)
      this.ready = (async () => {
        if (this.sql) {
          await this.sql.unsafe(SCHEMA);
          return;
        }
        await mkdir(dirname(this.path), { recursive: true });
        const { DatabaseSync } = await import('node:sqlite');
        this.db = new DatabaseSync(this.path);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;' + SCHEMA);
        await chmod(this.path, 0o600);
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    return this.ready;
  }
  async transact(fn) {
    await this.init();
    if (this.sql) return this.sql.begin((sql) => fn((q, p = []) => sql.unsafe(q, p)));
    let release;
    const previous = this.tail;
    this.tail = new Promise((r) => (release = r));
    await previous;
    const query = (q, p = []) => {
      const args = [];
      q = q.replace(/\$(\d+)/g, (_, n) => {
        args.push(p[Number(n) - 1]);
        return '?';
      });
      return this.db.prepare(q).all(...args);
    };
    let begun = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      begun = true;
      const result = await fn(query);
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      if (begun) this.db.exec('ROLLBACK');
      throw e;
    } finally {
      release();
    }
  }
  async reconcile(documents, model) {
    return this.transact(async (query) => {
      const now = this.clock();
      const fences = new Map(
        (
          await query(
            'SELECT installation_id,consent_version FROM usovia_analytics_erasure_fences WHERE tenant_id=$1 AND expires_at>$2',
            [this.tenant, now],
          )
        ).map((r) => [r.installation_id, r.consent_version]),
      );
      documents = documents.filter(
        (d) => !fences.has(d.installationId) || d.consentVersion > fences.get(d.installationId),
      );
      if (documents.length) {
        const params = [];
        const tuples = documents.map((d) => {
          const start = params.length;
          params.push(
            this.tenant,
            d.key,
            d.accountId,
            d.installationId,
            d.promptHash,
            model,
            d.consentVersion,
            d.expiresAt,
            now,
          );
          return '(' + Array.from({ length: 9 }, (_, i) => '$' + (start + i + 1)).join(',') + ')';
        });
        await query(
          `INSERT INTO usovia_semantic_documents(tenant_id,session_key,account_id,installation_id,source_hash,model_id,consent_version,expires_at,updated_at) VALUES ${tuples.join(',')}
       ON CONFLICT(tenant_id,session_key) DO UPDATE SET
       source_hash=excluded.source_hash, model_id=excluded.model_id, consent_version=excluded.consent_version, expires_at=excluded.expires_at,
       status=CASE WHEN usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id THEN 'queued' ELSE usovia_semantic_documents.status END,
       embedding_json=CASE WHEN usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id THEN NULL ELSE usovia_semantic_documents.embedding_json END,
       metadata_json=CASE WHEN usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id THEN NULL ELSE usovia_semantic_documents.metadata_json END,
       attempts=CASE WHEN usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id THEN 0 ELSE usovia_semantic_documents.attempts END,
       lease_owner=CASE WHEN usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id THEN NULL ELSE usovia_semantic_documents.lease_owner END,
       lease_until=CASE WHEN usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id THEN NULL ELSE usovia_semantic_documents.lease_until END
       WHERE usovia_semantic_documents.source_hash<>excluded.source_hash OR usovia_semantic_documents.model_id<>excluded.model_id OR usovia_semantic_documents.expires_at<>excluded.expires_at OR usovia_semantic_documents.consent_version<>excluded.consent_version`,
          params,
        );
      }
      const params = [this.tenant, now, ...documents.map((d) => d.key)],
        scope = documents.length
          ? ' OR session_key NOT IN (' + documents.map((_, i) => '$' + (i + 3)).join(',') + ')'
          : '';
      await query(
        `DELETE FROM usovia_semantic_documents WHERE tenant_id=$1 AND (expires_at<=$2${scope})`,
        params,
      );
      if (!documents.length)
        await query('DELETE FROM usovia_semantic_documents WHERE tenant_id=$1', [this.tenant]);
      await query(
        `DELETE FROM usovia_session_reviews WHERE tenant_id=$1 AND (expires_at<=$2${scope})`,
        params,
      );
      if (!documents.length)
        await query('DELETE FROM usovia_session_reviews WHERE tenant_id=$1', [this.tenant]);
      await query(
        `DELETE FROM usovia_session_review_audit WHERE tenant_id=$1 AND (expires_at<=$2${scope})`,
        params,
      );
      if (!documents.length)
        await query('DELETE FROM usovia_session_review_audit WHERE tenant_id=$1', [this.tenant]);
      await query(
        'DELETE FROM usovia_analytics_erasure_fences WHERE tenant_id=$1 AND expires_at<=$2',
        [this.tenant, now],
      );
      await query('DELETE FROM usovia_analytics_exports WHERE tenant_id=$1 AND expires_at<=$2', [
        this.tenant,
        now,
      ]);
    });
  }
  async entries() {
    return this.transact(async (query) => {
      const documents = await query(
        'SELECT session_key,source_hash,model_id,status,embedding_json,metadata_json,attempts FROM usovia_semantic_documents WHERE tenant_id=$1 AND expires_at>$2',
        [this.tenant, this.clock()],
      );
      const reviews = await query(
        'SELECT * FROM usovia_session_reviews WHERE tenant_id=$1 AND expires_at>$2',
        [this.tenant, this.clock()],
      );
      const [worker] = await query(
        'SELECT last_seen,model_id FROM usovia_analytics_workers WHERE tenant_id=$1 ORDER BY last_seen DESC LIMIT 1',
        [this.tenant],
      );
      return {
        worker: worker
          ? {
              lastSeen: new Date(Number(worker.last_seen)).toISOString(),
              recent: this.clock() - Number(worker.last_seen) < 90000,
              model: worker.model_id,
            }
          : null,
        documents: documents.map((d) => ({
          key: d.session_key,
          sourceHash: d.source_hash,
          model: d.model_id,
          status: d.status,
          vector: d.embedding_json ? JSON.parse(d.embedding_json) : null,
          metadata: d.metadata_json ? JSON.parse(d.metadata_json) : null,
          attempts: d.attempts,
        })),
        reviews: reviews.map((r) => ({
          key: r.session_key,
          sourceHash: r.source_hash,
          eventId: r.event_id,
          decision: r.decision,
          note: r.note,
          reviewedAt: new Date(Number(r.reviewed_at)).toISOString(),
        })),
      };
    });
  }
  async review(session, input) {
    return this.transact(async (query) => {
      const [fence] = await query(
        'SELECT consent_version FROM usovia_analytics_erasure_fences WHERE tenant_id=$1 AND installation_id=$2 AND expires_at>$3',
        [this.tenant, session.installationId, this.clock()],
      );
      if (fence && session.consentVersion <= fence.consent_version)
        throw Object.assign(new Error('La sesión fue retirada.'), { status: 409 });
      await query(
        `INSERT INTO usovia_session_reviews(tenant_id,session_key,account_id,installation_id,source_hash,event_id,decision,note,reviewed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(tenant_id,session_key) DO UPDATE SET source_hash=excluded.source_hash,event_id=excluded.event_id,decision=excluded.decision,note=excluded.note,reviewed_at=excluded.reviewed_at,expires_at=excluded.expires_at`,
        [
          this.tenant,
          session.key,
          session.accountId,
          session.installationId,
          session.snapshotHash,
          input.eventId,
          input.decision,
          input.note,
          this.clock(),
          session.expiresAt,
        ],
      );
      await query(
        'INSERT INTO usovia_session_review_audit(id,tenant_id,session_key,installation_id,source_hash,event_id,decision,note,reviewed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          randomUUID(),
          this.tenant,
          session.key,
          session.installationId,
          session.snapshotHash,
          input.eventId,
          input.decision,
          input.note,
          this.clock(),
          session.expiresAt,
        ],
      );
    });
  }
  async removeReview(key, sourceHash) {
    return this.transact(async (query) => {
      for (const table of ['usovia_session_reviews', 'usovia_session_review_audit'])
        await query(
          `DELETE FROM ${table} WHERE tenant_id=$1 AND session_key=$2 AND source_hash=$3`,
          [this.tenant, key, sourceHash],
        );
    });
  }
  async workerHeartbeat(owner, model) {
    return this.transact(async (query) => {
      await query('DELETE FROM usovia_analytics_workers WHERE tenant_id=$1 AND last_seen<$2', [
        this.tenant,
        this.clock() - 86400000,
      ]);
      await query(
        'INSERT INTO usovia_analytics_workers(tenant_id,worker_id,model_id,last_seen) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,worker_id) DO UPDATE SET last_seen=excluded.last_seen,model_id=excluded.model_id',
        [this.tenant, owner, model, this.clock()],
      );
    });
  }
  async claim(limit = 8, owner = randomUUID()) {
    return this.transact(async (query) => {
      const now = this.clock();
      const jobs = await query(
        `SELECT session_key,source_hash,model_id,installation_id FROM usovia_semantic_documents WHERE tenant_id=$1 AND expires_at>$2 AND attempts<3 AND (status='queued' OR (status='processing' AND lease_until<$2) OR (status='failed' AND updated_at<$3)) ORDER BY updated_at,session_key LIMIT ${Math.max(1, Math.min(16, limit))}${this.sql ? ' FOR UPDATE SKIP LOCKED' : ''}`,
        [this.tenant, now, now - 30000],
      );
      for (const job of jobs)
        await query(
          "UPDATE usovia_semantic_documents SET status='processing',lease_owner=$3,lease_until=$4,attempts=attempts+1,updated_at=$5 WHERE tenant_id=$1 AND session_key=$2",
          [this.tenant, job.session_key, owner, now + 300000, now],
        );
      return jobs.map((j) => ({
        key: j.session_key,
        sourceHash: j.source_hash,
        model: j.model_id,
        installationId: j.installation_id,
        owner,
      }));
    });
  }
  async complete(job, vector, metadata = {}) {
    if (
      !Array.isArray(vector) ||
      vector.length < 16 ||
      vector.length > 4096 ||
      vector.some((v) => typeof v !== 'number' || !Number.isFinite(v))
    )
      throw new Error('Invalid embedding vector');
    const norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
    if (norm < 0.99 || norm > 1.01) throw new Error('Embedding vector must be normalized');
    return this.transact(async (query) => {
      const rows = await query(
        "UPDATE usovia_semantic_documents SET status='ready',embedding_json=$6,metadata_json=$7,lease_owner=NULL,lease_until=NULL,updated_at=$8 WHERE tenant_id=$1 AND session_key=$2 AND source_hash=$3 AND model_id=$4 AND lease_owner=$5 AND status='processing' AND expires_at>$8 RETURNING session_key",
        [
          this.tenant,
          job.key,
          job.sourceHash,
          job.model,
          job.owner,
          JSON.stringify(vector),
          JSON.stringify(metadata),
          this.clock(),
        ],
      );
      return rows.length > 0;
    });
  }
  async failed(job) {
    return this.transact((query) =>
      query(
        "UPDATE usovia_semantic_documents SET status='failed',lease_owner=NULL,lease_until=NULL,updated_at=$6 WHERE tenant_id=$1 AND session_key=$2 AND source_hash=$3 AND model_id=$4 AND lease_owner=$5",
        [this.tenant, job.key, job.sourceHash, job.model, job.owner, this.clock()],
      ),
    );
  }
  async eraseInstallation(id, consentVersion) {
    return this.transact(async (query) => {
      await query(
        `INSERT INTO usovia_analytics_erasure_fences(tenant_id,installation_id,consent_version,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,installation_id) DO UPDATE SET consent_version=CASE WHEN usovia_analytics_erasure_fences.consent_version>excluded.consent_version THEN usovia_analytics_erasure_fences.consent_version ELSE excluded.consent_version END,expires_at=excluded.expires_at`,
        [this.tenant, id, consentVersion, this.clock() + 7 * 86400000],
      );
      for (const table of [
        'usovia_semantic_documents',
        'usovia_session_reviews',
        'usovia_session_review_audit',
      ])
        await query(`DELETE FROM ${table} WHERE tenant_id=$1 AND installation_id=$2`, [
          this.tenant,
          id,
        ]);
      // Export manifests contain only identifiers. Invalidate them too on erasure.
      await query('DELETE FROM usovia_analytics_exports WHERE tenant_id=$1', [this.tenant]);
    });
  }
  async putExport(manifest) {
    return this.transact(async (query) => {
      await query('DELETE FROM usovia_analytics_exports WHERE tenant_id=$1 AND expires_at<=$2', [
        this.tenant,
        this.clock(),
      ]);
      const existing = await query('SELECT id FROM usovia_analytics_exports WHERE tenant_id=$1', [
        this.tenant,
      ]);
      if (existing.length >= 20)
        throw Object.assign(
          new Error('Hay demasiadas exportaciones activas. Espera a que expiren.'),
          { status: 429 },
        );
      await query(
        'INSERT INTO usovia_analytics_exports(tenant_id,id,manifest_json,expires_at) VALUES($1,$2,$3,$4)',
        [this.tenant, manifest.id, JSON.stringify(manifest), this.clock() + 30 * 60000],
      );
    });
  }
  async getExport(id) {
    return this.transact(async (query) => {
      const [row] = await query(
        'SELECT manifest_json FROM usovia_analytics_exports WHERE tenant_id=$1 AND id=$2 AND expires_at>$3',
        [this.tenant, id, this.clock()],
      );
      return row ? JSON.parse(row.manifest_json) : null;
    });
  }
  close() {
    this.db?.close();
  }
}
const repositories = new WeakMap();
export function repositoryFor(store) {
  if (!repositories.has(store))
    repositories.set(
      store,
      new AnalyticsRepository(
        store.sql
          ? { sql: store.sql, tenant: store.tenant }
          : {
              path: store.path + '.analytics.sqlite',
              tenant: process.env.TENANT_ID || 'usovia-demo',
            },
      ),
    );
  return repositories.get(store);
}
