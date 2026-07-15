## Test program: short vs long seeks on an MP3 file.
## Usage:  ./seek_test <path_to_mp3>

import std/[os, strformat, times]
import miniaudio

let filePath = paramStr(1)
echo "Loading: ", filePath

var engine = newEngine()
var sound = engine.loadSound(filePath)
let dur = sound.durationMs()
echo fmt"Duration: {dur} ms ({dur.float/1000:.1f}s)"

proc seekAndCheck(ms: int64) =
  echo fmt"\n── seek to {ms} ms ({ms.float/1000:.1f}s) ──"
  sound.stop()
  sound.seekToMs(ms)
  sound.start()
  sleep(300)  # give the decoder time to produce audio
  let pos = sound.positionMs()
  let playing = sound.isPlaying()
  echo fmt"  isPlaying: {playing}"
  echo fmt"  position:  {pos} ms"
  if playing:
    sleep(2000)
    echo fmt"  position after 2s: {sound.positionMs()} ms (advancing: {sound.positionMs() > pos})"
  else:
    # Try a few more start calls to see if they help
    for i in 1 .. 10:
      sound.start()
      sleep(100)
      let p = sound.isPlaying()
      let pos2 = sound.positionMs()
      echo fmt"  retry {i}: playing={p}, pos={pos2} ms"
      if p:
        sleep(2000)
        echo fmt"  after 2s: {sound.positionMs()} ms (advancing: {sound.positionMs() > pos2})"
        break


# Test 1: Short seek
seekAndCheck(5000)

# Test 2: Another short seek
seekAndCheck(15000)

# Test 3: Long seek — jump 20 minutes forward (or half of total if shorter)
let longJump = min(20 * 60 * 1000, dur div 2)
seekAndCheck(longJump)

# Test 4: Jump back a shorter distance
seekAndCheck(longJump + 30000)

# Test 5: Seek near the end
let nearEnd = dur - 15000
echo fmt"\n── seek near end: {nearEnd} ms ──"
sound.stop()
sound.seekToMs(nearEnd)
sound.start()
sleep(500)
echo fmt"  isPlaying: {sound.isPlaying()}"
echo fmt"  position: {sound.positionMs()} ms"

sound.unload()
engine.delete()
echo "\nDone."
