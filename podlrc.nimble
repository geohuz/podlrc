version       = "0.1.1"
author        = "geohuz"
description   = "Minimal Podcast Player for macOS"
license       = "MIT"

requires "nim >= 2.0.0"

task verify_audio, "Run miniaudio MP3 playback validation":
  exec "nim c -r --path:src --app:console --passL:\"-framework CoreAudio -framework AudioToolbox\" tools/verify_audio.nim"

task release, "Build macOS release archive":
  exec "sh tools/release.sh"
