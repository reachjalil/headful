import { now } from "./domain/security.ts";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import { mkdirSync, chmodSync, lstatSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/** Headful's local CRM records are deliberately separate from T3's session database. */
export class LocalStore {
  readonly db: DatabaseSync;
  readonly homeDir: string;
  constructor(homeDir: string) {
    this.homeDir = homeDir;
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    const directory = lstatSync(homeDir);
    if (
      directory.isSymbolicLink() ||
      !directory.isDirectory() ||
      directory.uid !== process.getuid?.()
    )
      throw new Error("Headful storage must be a directory owned by your Mac account.");
    chmodSync(homeDir, 0o700);
    const filename = join(homeDir, "headful.sqlite");
    try {
      const file = lstatSync(filename);
      if (file.isSymbolicLink() || !file.isFile() || file.uid !== process.getuid?.())
        throw new Error("Unsafe Headful SQLite file.");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT 'local-headful-owner',
        application_id TEXT NOT NULL, label TEXT NOT NULL, salesforce_org_id TEXT NOT NULL,
        salesforce_user_id TEXT NOT NULL, instance_origin TEXT NOT NULL, username TEXT NOT NULL,
        alias TEXT NOT NULL, color TEXT NOT NULL, agent_enabled INTEGER NOT NULL DEFAULT 0,
        connection_version INTEGER NOT NULL DEFAULT 1, is_sandbox INTEGER,
        organization_name TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE(salesforce_org_id,salesforce_user_id));
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,org_id TEXT NOT NULL,
        permission_set_id TEXT NOT NULL,kind TEXT NOT NULL,envelope TEXT NOT NULL,
        digest TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,execution_started_at INTEGER);
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,grant_id TEXT,org_id TEXT NOT NULL,
        intent TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,envelope TEXT NOT NULL,
        digest TEXT,record_id TEXT,execution_started_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_reviews (
        token_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,grant_id TEXT,org_id TEXT NOT NULL,
        target_id TEXT NOT NULL,operation TEXT NOT NULL,revision INTEGER NOT NULL,
        digest TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0,approved_at INTEGER);
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,org_id TEXT,target_id TEXT,created_at INTEGER NOT NULL);
      PRAGMA user_version=1;`);
    // A process restart cannot establish whether a previously dispatched write completed.
    this.db.exec(
      "UPDATE workflows SET status='execution_unknown' WHERE status IN ('creating','access_applying'); UPDATE proposals SET status='execution_unknown' WHERE status='executing'",
    );
  }
  prepare(sql: string) {
    const statement = this.db.prepare(sql);
    return {
      bind: (...values: SQLInputValue[]) => ({
        first: async <T>() => (statement.get(...values) as T | undefined) ?? null,
        all: async <T>() => ({ results: statement.all(...values) as T[] }),
        run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
      }),
    };
  }
  preference<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM preferences WHERE key=?").get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  }
  setPreference(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  activity(kind: string, orgId: string | null = null, targetId: string | null = null) {
    this.db
      .prepare("INSERT INTO activity(kind,org_id,target_id,created_at) VALUES (?,?,?,?)")
      .run(kind, orgId, targetId, now());
  }
  close() {
    this.db.close();
  }
}
export class Store extends Context.Service<Store, { readonly store: LocalStore }>()(
  "t3/headful/Store",
) {}
export const layer = (homeDir: string) =>
  Layer.sync(Store, () => Store.of({ store: new LocalStore(homeDir) }));
