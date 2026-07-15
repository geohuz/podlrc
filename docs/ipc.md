# Frontend-host IPC

podlrc runs its frontend in a native WebView. The frontend and Nim host exchange
JSON messages directly; there is no HTTP server or WebSocket layer.

## Transport

The frontend sends one JSON object at a time through the WebView bridge:

```js
window.external.invoke(JSON.stringify({cmd: "seek", ms: 12000}));
```

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
| `getState` | none | Reads the current playback position and active lyric | `updateState()` when audio is loaded |
| `open` | none | Opens the native MP3 file dialog | Full `updateState()` after selection |
| `openRecent` | `path: string` | Opens a recent file and restores its position | Full `updateState()` |
| `play` | none | Starts playback | None |
| `pause` | none | Pauses playback | None |
| `toggle` | none | Toggles playback | None |
| `seek` | `ms: int` | Seeks to an absolute millisecond position | None |
| `seekBack` | none | Seeks backward 10 seconds | None |
| `seekFwd` | none | Seeks forward 10 seconds | None |
| `setVolume` | `vol: float` | Sets volume using the `0.0..1.0` scale | None |
| `saveConfig` | `lrcSize?: int` | Persists supported UI settings | None |
| `lookupWord` | `id: int`, `word: string`, `context?: string`, `offset?: int` | Queries macOS Dictionary; context lookup is used only when both optional fields are present | `resolveDictionaryLookup()` |
| `addWord` | `word: string`, `timeMs: int`, `definition?: string`, `source?: string`, `file?: string` | Adds or updates a vocabulary entry; `file` defaults to the current audio file | `updateWordPanel()` |
| `removeWord` | `word: string` | Removes the word case-insensitively | `updateWordPanel()` |
| `setWordDefinition` | `word: string`, `definition: string`, `file: string`, `timeMs: int`, `source?: string` | Replaces the stored definition for an existing word | `updateWordPanel()` on success |
| `openWordRef` | `file: string`, `ms: int` | Opens the source podcast and seeks to the saved position | Full `updateState()` |
| `ready` | none | Finishes previous-session restoration after the DOM is ready | Full `updateState()` when a session exists |

Example correlated dictionary lookup:

```js
var id = nextRequestId++;
pendingLookups[id] = resolve;
window.external.invoke(JSON.stringify({
  cmd: "lookupWord",
  id: id,
  word: "trilogy",
  context: "a trilogy of films",
  offset: 2
}));
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
| `position` | `int` | Current position in milliseconds |
| `duration` | `int` | Audio duration in milliseconds |
| `playing` | `boolean` | Current playback state |
| `activeIndex` | `int` | Highlighted lyric index, or `-1` |
| `volume` | `float` | Current volume on the `0.0..1.0` scale |

The polling response normally contains only `position`, `playing`, and
`activeIndex`. File loading sends the full state.

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

1. Add a small frontend wrapper in `src/ui/app.js` that sends a JSON object with
   a unique `cmd` name.
2. Add the matching branch to `handleMessage()` in `src/main.nim`.
3. Validate required fields at the host boundary before changing application
   state.
4. If a response is needed, add or reuse a stable JavaScript entry point and
   serialize the response through `JsonNode`.
5. Document the fields and response behavior in this file.

Keep commands domain-oriented (`seek`, `lookupWord`, `removeWord`) rather than
exposing arbitrary JavaScript evaluation or filesystem operations.
