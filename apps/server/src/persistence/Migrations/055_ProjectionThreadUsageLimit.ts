import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  // Guarded so the column survives renumbering if upstream claims this id.
  if (!columns.some((column) => column.name === "usage_limit_json")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN usage_limit_json TEXT`;
  }
});
