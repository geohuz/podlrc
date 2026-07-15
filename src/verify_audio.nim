## verify_audio — miniaudio MP3 playback validation
##
## Plays an MP3 file via miniaudio / CoreAudio and continuously prints
## the current playback position with millisecond precision.
##
## Usage: verify_audio <path/to/file.mp3>

import std/[os, strformat, strutils, posix]
import posix/termios
import miniaudio

const
  SeekDeltaMs  = 5000'i64   # 5 s seek step
  RefreshMs    = 100         # status-refresh interval

# ------------------------------------------------------------------
# Non-blocking keyboard check (POSIX termios)
# ------------------------------------------------------------------
proc kbhit(): bool =
  var fds: TFdSet
  var tv = Timeval(tv_sec: posix.Time(0), tv_usec: posix.Suseconds(0))
  FD_ZERO(fds)
  FD_SET(STDIN_FILENO.cint, fds)
  select(STDIN_FILENO.cint + 1, addr fds, nil, nil, addr tv) > 0

proc getch(): char =
  var c: char
  discard posix.read(STDIN_FILENO, addr c, 1)
  result = c

proc enableRawMode() =
  var t: termios.Termios
  discard termios.tcGetAttr(STDIN_FILENO, addr t)
  t.c_lflag = t.c_lflag and not termios.Cflag(termios.ECHO or termios.ICANON)
  t.c_cc[termios.VMIN] = char(0)
  t.c_cc[termios.VTIME] = char(0)
  discard termios.tcSetAttr(STDIN_FILENO, termios.TCSANOW, addr t)

proc disableRawMode() =
  var t: termios.Termios
  discard termios.tcGetAttr(STDIN_FILENO, addr t)
  t.c_lflag = t.c_lflag or termios.Cflag(termios.ECHO or termios.ICANON)
  discard termios.tcSetAttr(STDIN_FILENO, termios.TCSANOW, addr t)

# ------------------------------------------------------------------
# Display helpers
# ------------------------------------------------------------------
proc fmtTime(ms: int64): string =
  let totalSec = ms div 1000
  let min = totalSec div 60
  let sec = totalSec mod 60
  let msPart = ms mod 1000
  &"{min:02}:{sec:02}.{msPart:03}"

proc drawBar(current, total: int64, width: int = 40): string =
  if total == 0: return ""
  let filled = int(float64(current) / float64(total) * float64(width))
  "[" & "#".repeat(filled) & "-".repeat(width - filled) & "]"

proc clearLine() =
  stdout.write "\r\e[2K"
  stdout.flushFile()

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
proc runInteractive(sound: Sound, durationMs: int64) =
  echo "Controls: [space] play/pause  [← →] seek ±5s  [q] quit"
  echo "────────────────────────────────────────────────────"

  sound.start()
  enableRawMode()

  var running  = true
  var paused   = false
  var lastPos  = -1'i64

  while running:
    while kbhit():
      case getch()
      of ' ':
        if paused:
          sound.start()
          paused = false
        else:
          sound.stop()
          paused = true
      of 'q', 'Q':
        running = false
      of '\e':
        if kbhit() and getch() == '[':
          case getch()
          of 'D':
            var t = sound.positionMs() - SeekDeltaMs
            if t < 0: t = 0
            sound.seekToMs(t)
          of 'C':
            var t = sound.positionMs() + SeekDeltaMs
            if t > durationMs: t = durationMs
            sound.seekToMs(t)
          else: discard
      else: discard

    let pos = sound.positionMs()
    if pos != lastPos:
      lastPos = pos
      let state = if not sound.isPlaying(): "⏸" else: "▶"
      clearLine()
      stdout.write &"{state}  {fmtTime(pos)} / {fmtTime(durationMs)}  {drawBar(pos, durationMs)}"
      stdout.flushFile()
    elif not sound.isPlaying() and not paused:
      lastPos = -1

    sleep(RefreshMs div 2)

  disableRawMode()
  sound.stop()

proc runTest(sound: Sound, durationMs: int64, seconds: int) =
  echo &"Test mode: playing for {seconds} seconds, printing position every 500ms..."
  echo "────────────────────────────────────────────────────"

  sound.start()
  let deadline = durationMs.min(int64(seconds) * 1000)
  var lastPrinted = -1'i64

  while sound.isPlaying() and sound.positionMs() < deadline:
    let pos = sound.positionMs()
    if pos - lastPrinted >= 500:
      lastPrinted = pos
      echo &"  positionMs = {pos}  ({fmtTime(pos)})  PCM frames = {sound.cursorPcm()}"
    sleep(50)

  sound.stop()
  let final = sound.positionMs()
  echo &"  final positionMs = {final}  ({fmtTime(final)})"
  echo "Test complete."

proc main() =
  if paramCount() < 1:
    echo "Usage: verify_audio [--test <seconds>] <path/to/file.mp3>"
    echo "       verify_audio <path/to/file.mp3>     (interactive mode)"
    quit 1

  var testSec = 0
  var filePath: string

  if paramStr(1) == "--test":
    if paramCount() < 3:
      echo "Usage: verify_audio --test <seconds> <path/to/file.mp3>"
      quit 1
    testSec = parseInt(paramStr(2))
    filePath = paramStr(3)
  else:
    filePath = paramStr(1)

  if not fileExists(filePath):
    echo &"File not found: {filePath}"
    quit 1

  echo &"Loading: {filePath}"
  let engine = newEngine()
  let sound  = engine.loadSound(filePath)

  let durationMs = sound.durationMs()
  let rateHz     = sound.sampleRate()
  echo &"Sample rate : {rateHz} Hz"
  echo &"Duration    : {fmtTime(durationMs)}"
  echo ""

  if testSec > 0:
    runTest(sound, durationMs, testSec)
  else:
    runInteractive(sound, durationMs)

  sound.unload()
  engine.delete()
  echo "Done."

when isMainModule:
  main()
