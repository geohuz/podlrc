# Frontend-host IPC

podlrc runs its frontend in a native WebView. The frontend and Nim host exchange
JSON messages directly; there is no HTTP server or WebSocket layer.

## Frontend rendering

The UI uses vendored copies of VanJS 1.6.0 and VanX 0.6.3 (`src/ui/vendor/`) for
component DOM construction and field-level reactive presentation state. They are
embedded by `ui_assets.nim` before `app.js`, so there is no runtime network, npm,
or bundler dependency. `app.js` keeps the stable bridge functions
(`sendCommand`, `updateState`, `updateWordPanel`, and `resolveDictionaryLookup`)
as the host-facing API.

Playback is owned by the browser's native `<audio>` element. The host sends an
`audioPath` and LRC lines when a file opens; audio events update position,
duration, playing state, volume, and the active lyric locally. There is no
400ms playback polling IPC. Playback position is sent back through the
throttled `savePlaybackState` command.

The frontend has one `app = vanX.reactive(...)` state root. Presentation fields
such as panel visibility, Vocabulary entries, popup data, and playback controls
are reactive. `app.runtime` is wrapped with `vanX.noreactive()` and holds lyric
lines, dictionary request resolvers, pending saves, timers, and other operational
state. Read reactive subfields inside Van binding functions; do not alias a
nested reactive object before reading it.

## Transport

The frontend sends one JSON object at a time through the centralized
`sendCommand()` bridge:

```js
// Playback seeking is local to the browser audio element.
audio.currentTime = 12;
```

`sendCommand()` is the only frontend function that calls
`window.external.invoke`. Keeping serialization at this boundary prevents
rendering and event code from duplicating transport details.

The Nim host parses the object and dispatches on `cmd` in `handleMessage()`.
Most commands are fire-and-forget. Dictionary lookup is the exception: it uses
an integer request `id` to match an asynchronous response.

The host calls stable JavaScript entry points with `w.eval()`:

```nim
discard w.eval(cstring("updateState(" & $stateJson & ");"))
```

Always construct host-to-frontend payloads as `JsonNode` values and serialize
them with `$`. Do not interpolate unescaped user or file content into JavaScript.

## Frontend to host

Every message requires a string `cmd` field.

| Command | Fields | Host behavior | Response |
|---|---|---|---|
| `open` | none | Opens the native MP3 file dialog | Full `updateState()` after selection |
| `openRecent` | `path: string` | Opens a recent file and restores its position | Full `updateState()` |
| `savePlaybackState` | `file: string`, `position: int` | Persists the browser audio position | None |
| `saveConfig` | `lrcSize?: int`, `windowWidth?: int`, `windowHeight?: int` | Persists supported UI settings | None |
| `lookupWord` | `id: int`, `word: string`, `context?: string`, `offset?: int` | Queries macOS Dictionary; context lookup is used only when both optional fields are present | `resolveDictionaryLookup()` |
| `addWord` | `word: string`, `timeMs: int`, `definition?: string`, `source?: string`, `file?: string` | Adds or updates a vocabulary entry; `file` defaults to the current audio file | `updateWordPanel()` |
| `removeWord` | `word: string` | Removes the word case-insensitively | `updateWordPanel()` |
| `setWordDefinition` | `word: string`, `definition: string`, `file: string`, `timeMs: int`, `source?: string` | Replaces the stored definition for an existing word | `updateWordPanel()` on success |
| `openWordRef` | `file: string`, `ms: int` | Opens the source podcast and seeks to the saved position | Full `updateState()` |
| `ready` | none | Legacy no-op retained for older embedded pages | None |

Example correlated dictionary lookup:

```js
var id = nextRequestId++;
pendingLookups[id] = resolve;
sendCommand("lookupWord", {
  id: id,
  word: "trilogy",
  context: "a trilogy of films",
  offset: 2
});
```

## Host to frontend

### `updateState(state)`

Accepts a partial or full player state. The frontend must leave fields unchanged
when they are absent.

| Field | Type | Meaning |
|---|---|---|
| `loaded` | `boolean` | Shows the loaded player UI when true |
| `lines` | `LyricLine[]` | Replaces the rendered LRC lines |
| `recent` | `string[]` | Replaces the recent file list |
| `words` | `WordEntry[]` | Replaces the vocabulary cache |
| `currentFile` | `string` | Absolute path of the active audio file |
| `audioPath` | `string` | Absolute path loaded by the browser `<audio>` element |
| `position` | `int` | Resume position in milliseconds for initial file loading |
| `activeIndex` | `int` | Initial highlighted lyric index, or `-1` |

File loading sends the full state. Subsequent playback state is produced by
the browser audio element and is not sent as host polling responses.

### `updateWordPanel(words)`

Replaces the frontend vocabulary cache after a host-side write.

### `resolveDictionaryLookup(response)`

Completes a pending dictionary request:

```text
{
  id: int,
  definition: string
}
```

`definition` is the raw DictionaryServices result. The frontend formatter
registry normalizes it before display or storage.

## Failure behavior

There is currently no generic acknowledgement or error response. Malformed
messages are caught at the host boundary and logged to the terminal as
`handleMessage error`. Unknown `cmd` values are ignored. A command that needs
recoverable frontend-visible errors should define an explicit correlated
response instead of relying on terminal output.

## Shared data shapes

```text
LyricLine {
  timeStartMs: int,
  text: string
}

WordEntry {
  word: string,
  definition: string,
  source: string,
  file: string,
  timeMs: int
}
```

`definition` may contain podlrc's normalized dictionary HTML. Treat it as
formatted application data, not plain text.

## Startup configuration

`ui_assets.nim` embeds a JSON object into the generated page. `index.html`
passes it to `initApp(config)` after `DOMContentLoaded`:

```text
{
  lrcSize: int,
  recent: string[],
  initialState: PlayerState | null
}
```

The assembler escapes `</` sequences so stored content cannot terminate the
configuration script early.

## Adding a command

1. Send the domain action through `sendCommand()` in `src/ui/app.js` using a
   unique `cmd` name.
2. Add the matching branch to `handleMessage()` in `src/main.nim`.
3. Validate required fields at the host boundary before changing application
   state.
4. If a response is needed, add or reuse a stable JavaScript entry point and
   serialize the response through `JsonNode`.
5. Document the fields and response behavior in this file.

Keep commands domain-oriented (`seek`, `lookupWord`, `removeWord`) rather than
exposing arbitrary JavaScript evaluation or filesystem operations.
