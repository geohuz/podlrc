## Compare seek strategies for long-distance MP3 seeks.

import std/[os, strformat]
import miniaudio

let filePath = paramStr(1)
echo "Loading: ", filePath

var engine = newEngine()
var sound = engine.loadSound(filePath)
let dur = sound.durationMs()
echo fmt"Duration: {dur} ms"

# ── Strategy A: stop + seekToMs + start ──
echo "\n=== Strategy A: stop + seek + start ==="
sound.start()
sleep(500)
sound.stop()
sound.seekToMs(20 * 60 * 1000)  # 20 min in
sound.start()
sleep(500)
echo fmt"after 500ms:  playing={sound.isPlaying()}, pos={sound.positionMs()}"
sleep(2000)
echo fmt"after 2500ms: playing={sound.isPlaying()}, pos={sound.positionMs()}"
sound.stop()

# ── Strategy B: seekToMs while playing (no stop) ──
echo "\n=== Strategy B: seek while playing ==="
sound.seekToMs(5000)  # back to 5s first
sound.start()
sleep(1000)
echo fmt"at 5s: playing={sound.isPlaying()}, pos={sound.positionMs()}"

sound.seekToMs(20 * 60 * 1000)  # long jump while playing
sleep(500)
echo fmt"after 500ms:  playing={sound.isPlaying()}, pos={sound.positionMs()}"
sleep(2000)
echo fmt"after 2500ms: playing={sound.isPlaying()}, pos={sound.positionMs()}"
sound.stop()

# ── Strategy C: seekToMs + start (no stop) ──
echo "\n=== Strategy C: seek + start (no prior stop) ==="
sound.seekToMs(5 * 60 * 1000)  # 5 min (medium jump)
sound.start()
sleep(500)
echo fmt"after 500ms:  playing={sound.isPlaying()}, pos={sound.positionMs()}"
sleep(2000)
echo fmt"after 2500ms: playing={sound.isPlaying()}, pos={sound.positionMs()}"
sound.stop()

sound.seekToMs(20 * 60 * 1000)  # 20 min (long jump)
sound.start()
sleep(500)
echo fmt"after 500ms:  playing={sound.isPlaying()}, pos={sound.positionMs()}"
sleep(2000)
echo fmt"after 2500ms: playing={sound.isPlaying()}, pos={sound.positionMs()}"
sound.stop()

# ── Strategy D: stop + seek + start + poll until advancing ──
echo "\n=== Strategy D: stop + seek + start + wait for advance ==="
sound.stop()
sound.seekToMs(30 * 60 * 1000)  # 30 min in
sound.start()
var pos0 = sound.positionMs()
echo fmt"  t=0:    playing={sound.isPlaying()}, pos={pos0}"
for i in 1..20:
  sleep(200)
  let pos = sound.positionMs()
  let adv = pos != pos0
  echo fmt"  t={i*200}ms: playing={sound.isPlaying()}, pos={pos}, advancing={adv}"
  if adv:
    sleep(2000)
    echo fmt"  after +2s: pos={sound.positionMs()} (continuing: {sound.positionMs() > pos})"
    break

sound.stop()
sound.unload()
engine.delete()
echo "\nDone."
