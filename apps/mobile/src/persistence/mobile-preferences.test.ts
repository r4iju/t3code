import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({}));

import * as MobileDatabase from "./mobile-database";
import * as MobileSecureStorage from "./mobile-secure-storage";
import * as MobilePreferences from "./mobile-preferences";

describe("background connection preferences", () => {
  it.effect("loads the opt-in from storage and preserves switching it off", () =>
    Effect.gen(function* () {
      let stored = { payload: JSON.stringify({ keepConnectedInBackground: true }), updatedAt: 1 };
      const store = yield* MobilePreferences.make().pipe(
        Effect.provideService(MobileDatabase.MobileDatabase, {
          loadCache: () => Effect.die("Unexpected cache access"),
          listCache: () => Effect.die("Unexpected cache access"),
          saveCache: () => Effect.die("Unexpected cache access"),
          removeCache: () => Effect.die("Unexpected cache access"),
          clearCacheKind: () => Effect.die("Unexpected cache access"),
          clearEnvironmentCache: () => Effect.die("Unexpected cache access"),
          clearAllCaches: Effect.die("Unexpected cache access"),
          inspectCaches: Effect.die("Unexpected cache access"),
          loadPreferencesJson: Effect.sync(() => Option.some(stored)),
          savePreferencesJson: (payload, updatedAt) =>
            Effect.sync(() => {
              stored = { payload, updatedAt };
            }),
        }),
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, {
          getItem: () => Effect.succeed(null),
          setItem: () => Effect.void,
          removeItem: () => Effect.void,
        }),
      );
      expect(yield* store.load).toEqual({ keepConnectedInBackground: true });
      yield* store.savePatch({ keepConnectedInBackground: false });
      expect(yield* store.load).toEqual({ keepConnectedInBackground: false });
    }),
  );
});
