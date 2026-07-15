## AudioEngine — background-thread audio playback with lock-free position tracking.
##
## Wraps miniaudio. The engine runs on a dedicated thread; the UI reads
## `currentPositionMs` (Atomic) without ever blocking the render loop.

import std/[atomics, os, locks]
import miniaudio

type
  EngineCmd = enum
    cmdNone, cmdPlay, cmdPause, cmdStop, cmdSeek

  AudioEngine* = ref object
    engine: Engine
    sound: Sound
    thread: Thread[AudioEngine]
    running: Atomic[bool]
    paused: Atomic[bool]
    cmdLock: Lock
    pendingCmd: EngineCmd
    cmdArg: int64
    currentPositionMs*: Atomic[int64]
    durationMs: int64

proc engineLoop(ctx: AudioEngine) {.thread.} =
  var sound = ctx.sound

  while ctx.running.load(moRelaxed):
    var cmd: EngineCmd
    var arg: int64
    {.locks: [ctx.cmdLock].}:
      withLock ctx.cmdLock:
        cmd = ctx.pendingCmd
        arg = ctx.cmdArg
        ctx.pendingCmd = cmdNone

    case cmd
    of cmdPlay:
      sound.start()
      ctx.paused.store(false, moRelaxed)

    of cmdPause:
      sound.stop()
      ctx.paused.store(true, moRelaxed)

    of cmdStop:
      sound.stop()
      ctx.running.store(false, moRelaxed)

    of cmdSeek:
      sound.seekToMs(arg)
      ctx.currentPositionMs.store(sound.positionMs(), moRelaxed)

    of cmdNone:
      discard

    # Update shared position for UI
    if sound.isPlaying():
      ctx.currentPositionMs.store(sound.positionMs(), moRelaxed)

    os.sleep(16)  # ~60 Hz refresh

  sound.stop()

proc sendCmd(ctx: AudioEngine, cmd: EngineCmd, arg: int64 = 0) =
  {.locks: [ctx.cmdLock].}:
    withLock ctx.cmdLock:
      ctx.pendingCmd = cmd
      ctx.cmdArg = arg

proc newAudioEngine*(filePath: string): AudioEngine =
  result = AudioEngine()
  result.engine = newEngine()
  result.sound = result.engine.loadSound(filePath)
  result.durationMs = result.sound.durationMs()
  result.running.store(true, moRelaxed)
  result.paused.store(true, moRelaxed)
  result.pendingCmd = cmdNone
  result.cmdLock.initLock()
  result.thread.createThread(engineLoop, result)

proc delete*(ctx: AudioEngine) =
  ctx.sendCmd(cmdStop)
  ctx.thread.joinThread()
  ctx.cmdLock.deinitLock()
  ctx.sound.unload()
  ctx.engine.delete()

proc play*(ctx: AudioEngine) =
  ctx.sendCmd(cmdPlay)

proc pause*(ctx: AudioEngine) =
  ctx.sendCmd(cmdPause)

proc seek*(ctx: AudioEngine, ms: int64) =
  ctx.sendCmd(cmdSeek, ms)

proc isPlaying*(ctx: AudioEngine): bool =
  not ctx.paused.load(moRelaxed)

proc position*(ctx: AudioEngine): int64 =
  ctx.currentPositionMs.load(moRelaxed)

proc duration*(ctx: AudioEngine): int64 =
  ctx.durationMs

proc setVolume*(ctx: AudioEngine, vol: float32) =
  ctx.sound.setVolume(vol)

proc getVolume*(ctx: AudioEngine): float32 =
  ctx.sound.getVolume()
