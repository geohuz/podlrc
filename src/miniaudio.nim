## Thin Nim wrapper around miniaudio via a small C translation unit.
## The C file (miniaudio_impl.c) compiles the single-header library and
## exposes opaque pointer-based functions.

{.compile("native/miniaudio_impl.c", "").}

type
  Engine* = distinct pointer
  Sound* = distinct pointer

# -- C imports ------------------------------------------------------------
proc pod_engine_new(): pointer {.importc, cdecl.}
proc pod_engine_delete(p: pointer) {.importc, cdecl.}
proc pod_sound_new(engine: pointer, filePath: cstring): pointer {.importc, cdecl.}
proc pod_sound_delete(p: pointer) {.importc, cdecl.}
proc pod_sound_start(p: pointer) {.importc, cdecl.}
proc pod_sound_stop(p: pointer) {.importc, cdecl.}
proc pod_sound_is_playing(p: pointer): cint {.importc, cdecl.}
proc pod_sound_get_cursor_pcm(p: pointer): uint64 {.importc, cdecl.}
proc pod_sound_get_sample_rate(p: pointer): uint32 {.importc, cdecl.}
proc pod_sound_seek_to_pcm(p: pointer, frame: uint64) {.importc, cdecl.}
proc pod_sound_get_duration_seconds(p: pointer): cfloat {.importc, cdecl.}
proc pod_sound_set_volume(p: pointer, vol: cfloat) {.importc, cdecl.}
proc pod_sound_get_volume(p: pointer): cfloat {.importc, cdecl.}

# -- Nim-friendly API ------------------------------------------------------

proc newEngine*(): Engine =
  ## Create and initialise a miniaudio engine (high-level API).
  let p = pod_engine_new()
  if p.isNil:
    raise (ref Defect)(msg: "Failed to initialise miniaudio engine")
  result = Engine(p)

proc delete*(e: Engine) =
  if e.pointer != nil:
    pod_engine_delete(e.pointer)

proc loadSound*(engine: Engine, filePath: string): Sound =
  let p = pod_sound_new(engine.pointer, filePath.cstring)
  if p.isNil:
    raise (ref Defect)(msg: "Failed to load sound: " & filePath)
  result = Sound(p)

proc unload*(s: Sound) =
  if s.pointer != nil:
    pod_sound_delete(s.pointer)

proc start*(s: Sound) =
  pod_sound_start(s.pointer)

proc stop*(s: Sound) =
  pod_sound_stop(s.pointer)

proc isPlaying*(s: Sound): bool =
  pod_sound_is_playing(s.pointer) != 0

proc cursorPcm*(s: Sound): uint64 =
  pod_sound_get_cursor_pcm(s.pointer)

proc sampleRate*(s: Sound): uint32 =
  pod_sound_get_sample_rate(s.pointer)

proc seekToPcm*(s: Sound, frame: uint64) =
  pod_sound_seek_to_pcm(s.pointer, frame)

proc durationSeconds*(s: Sound): float32 =
  pod_sound_get_duration_seconds(s.pointer)

proc positionMs*(s: Sound): int64 =
  let rate = s.sampleRate()
  if rate == 0: return 0
  int64(float64(s.cursorPcm()) / float64(rate) * 1000.0)

proc seekToMs*(s: Sound, ms: int64) =
  let rate = s.sampleRate()
  if rate == 0: return
  let frame = uint64(float64(ms) / 1000.0 * float64(rate))
  s.seekToPcm(frame)

proc durationMs*(s: Sound): int64 =
  int64(s.durationSeconds() * 1000.0)

proc setVolume*(s: Sound, vol: float32) =
  pod_sound_set_volume(s.pointer, cfloat(vol))

proc getVolume*(s: Sound): float32 =
  float32(pod_sound_get_volume(s.pointer))
