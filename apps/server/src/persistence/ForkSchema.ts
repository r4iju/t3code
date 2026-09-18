/**
 * Schema this fork adds on top of upstream's, applied outside the numbered migrations.
 *
 * The migrator runs only ids above the highest one recorded, so a fork migration that takes an
 * id makes every database that ran it skip whatever upstream later ships under that id. Keeping
 * fork schema here leaves the numbered migrations identical to upstream's; each step must be
 * idempotent because it runs on every startup.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Ids the fork once recorded in effect_sql_migrations. Releasing them lets upstream's migration
// with the same id run; the schema they added is re-applied by `applyForkSchema`.
const retiredForkMigrations: ReadonlyArray<readonly [id: number, name: string]> = [
  [51, "AuthSessionLastSeenAt"],
];

export const releaseRetiredForkMigrations = Effect.fn("releaseRetiredForkMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;

  for (const [id, name] of retiredForkMigrations) {
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${id} AND name = ${name}`;
  }
});

export const applyForkSchema = Effect.fn("applyForkSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;
  if (!sessionColumns.some((column) => column.name === "last_seen_at")) {
    yield* sql`ALTER TABLE auth_sessions ADD COLUMN last_seen_at TEXT`;
  }
});
