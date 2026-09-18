import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { applyForkSchema, releaseRetiredForkMigrations } from "./ForkSchema.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const columnNames = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{
      readonly name: string;
    }>`SELECT name FROM pragma_table_info(${table})`;
    return columns.map((column) => column.name);
  });

const startUp = Effect.gen(function* () {
  yield* releaseRetiredForkMigrations();
  yield* runMigrations();
  yield* applyForkSchema();
});

it.layer(NodeSqliteClient.layerMemory())("ForkSchema on a fresh database", (it) => {
  it.effect("adds last seen next to upstream's schema and is safe to repeat", () =>
    Effect.gen(function* () {
      yield* startUp;
      yield* startUp;

      assert.include(yield* columnNames("auth_sessions"), "last_seen_at");
      assert.include(yield* columnNames("projection_thread_messages"), "context_json");
    }),
  );
});

it.layer(NodeSqliteClient.layerMemory())(
  "ForkSchema on a database that recorded the fork's migration 51",
  (it) => {
    it.effect("runs upstream's migration 51 instead of skipping it", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 50 });
        yield* sql`ALTER TABLE auth_sessions ADD COLUMN last_seen_at TEXT`;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (51, 'AuthSessionLastSeenAt')
        `;

        yield* startUp;

        assert.include(yield* columnNames("projection_thread_messages"), "context_json");
        assert.include(yield* columnNames("projection_threads"), "title_state_json");
        const recorded = yield* sql<{ readonly name: string }>`
          SELECT name FROM effect_sql_migrations WHERE migration_id = 51
        `;
        assert.deepEqual(
          recorded.map((row) => row.name),
          ["ProjectionThreadMessageContext"],
        );
      }),
    );
  },
);
