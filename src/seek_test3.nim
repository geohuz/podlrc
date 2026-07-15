## Test: tear down and recreate sound for long-distance seeks.

import std/[os, strformat]
import miniaudio

let filePath = paramStr(1)
echo "Loading: ", filePath

var engine = newEngine()
var sound = engine.loadSound(filePath)
let dur = sound.durationMs()
echo fmt"Duration: {dur} ms"

# ── Test: recreate sound + seek fresh ──
let target = 30 * 60 * 1000  # 30 minutes in
echo fmt"\n=== Recreate sound, seek to {target} ms ==="

sound.unload()
sound = engine.loadSound(filePath)
sound.seekToMs(target)
sound.start()

echo fmt"t=0:    playing={sound.isPlaying()}, pos={sound.positionMs()}"
for i in 1..15:
  sleep(200)
  let pos = sound.positionMs()
  echo fmt"t={i*200}ms: playing={sound.isPlaying()}, pos={pos}, advancing={pos != target}"
  if pos != target:
    sleep(3000)
    echo fmt"after +3s: pos={sound.positionMs()} (still advancing: {sound.positionMs() > pos})"
    break

sound.stop()

# ── Also test: stop, seek very far, start ──
let target2 = 50 * 60 * 1000
echo fmt"\n=== Another recreate, seek to {target2} ms ==="
sound.unload()
sound = engine.loadSound(filePath)
sound.seekToMs(target2)
sound.start()

echo fmt"t=0:    playing={sound.isPlaying()}, pos={sound.positionMs()}"
for i in 1..15:
  sleep(200)
  let pos = sound.positionMs()
  echo fmt"t={i*200}ms: playing={sound.isPlaying()}, pos={pos}, advancing={pos != target2}"
  if pos != target2:
    sleep(3000)
    echo fmt"after +3s: pos={sound.positionMs()}"
    break

sound.stop()
sound.unload()
engine.delete()
echo "\nDone."
