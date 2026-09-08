# Voice input and read aloud

Transcription edits a composer draft. It does not submit an agent turn. Audio is
temporary client input, and only normal message submission sends the resulting
text. The current implementation transcribes locally on supported iOS devices;
environment-backed transcription is not implemented. System dictation tools need
no integration because both composers are ordinary text inputs.

## Read aloud

Synthesis is environment-owned so that every client, local or remote, hears the
same voice from one configuration and no device holds a speech-service key. A
client asks for a message by id over the `speech.synthesize` RPC; the environment
resolves the text from its read model, runs the
[shared speech-text preparation](../../packages/shared/src/speechText.ts), calls
the configured OpenAI-shaped endpoint, caches the file under the userdata `speech`
directory, and answers with a signed URL on the existing asset route. Audio never
travels over the WebSocket, and the asset route's signing, expiry, and range
support apply unchanged. Clients run the same preparation only to decide whether a
message has anything to read, so the control and the spoken text cannot disagree.

The cache key hashes base URL, model, voice, and prepared text, so changing the
voice never replays the old one and a repeat listen never contacts the service.
The API key follows the usage-limit-source pattern: it lives in the secret store,
`settings.json` holds the redaction sentinel, and a client that echoes the
sentinel keeps the stored key. The base URL is deliberately allowed to be plain
HTTP because the environment owner picks it and local model servers rarely
terminate TLS. The [client controller](../../packages/client-runtime/src/read-aloud/controller.ts)
enforces one playback per client and invalidates late results after a stop; the
players it drives are the only platform-specific code.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results.
