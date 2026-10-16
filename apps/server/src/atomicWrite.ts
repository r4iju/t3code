import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Writes through a sibling temp file so readers never see a partial file. */
export const writeFileAtomically = (input: {
  readonly filePath: string;
  readonly contents: Uint8Array;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const targetDirectory = path.dirname(input.filePath);

      yield* fs.makeDirectory(targetDirectory, { recursive: true });
      const tempDirectory = yield* fs.makeTempDirectoryScoped({
        directory: targetDirectory,
        prefix: `${path.basename(input.filePath)}.`,
      });
      const tempPath = path.join(tempDirectory, "contents.tmp");

      yield* fs.writeFile(tempPath, input.contents);
      yield* fs.rename(tempPath, input.filePath);
    }),
  );

export const writeFileStringAtomically = (input: {
  readonly filePath: string;
  readonly contents: string;
}) =>
  writeFileAtomically({
    filePath: input.filePath,
    contents: new TextEncoder().encode(input.contents),
  });
