version       = "0.1.0"
author        = "geohuz"
description   = "Minimal Podcast Player for macOS"
license       = "MIT"

requires "nim >= 2.0.0"

task verify_audio, "Run miniaudio MP3 playback validation":
  exec "nim c -r --app:console --passL:\"-framework CoreAudio -framework AudioToolbox\" src/verify_audio.nim"
