version       = "0.1.4"
author        = "geohuz"
description   = "Minimal Podcast Player for macOS"
license       = "MIT"

requires "nim >= 2.0.0"

task release, "Build macOS release archive":
  exec "sh tools/release.sh"
