## LRC file parser — extracts timestamped transcript lines.
##
## Supports:
##   [mm:ss.xx]  line-level timestamps
##   [ti:Title] [ar:Artist]  inline metadata tags
##   <mm:ss.xx>  enhanced word-level timestamps (parsed, not exposed yet)

import std/[strutils, parseutils, tables, algorithm]

type
  TranscriptLine* = object
    timeStartMs*: int64    ## line start, milliseconds
    text*: string          ## display text (tags stripped)

  LrcFile* = object
    title*: string
    artist*: string
    lines*: seq[TranscriptLine]

proc parseTimestamp(s: string, start: int): (int64, int) =
  ## Parse [mm:ss.xx] or <mm:ss.xx> starting at `start`.
  ## Returns (milliseconds, chars consumed).
  var mm, ss, xx: int
  var pos = start
  pos += parseInt(s, mm, pos)
  if pos >= s.len or s[pos] notin {':', '.'}:
    return (-1'i64, 0)
  pos.inc()
  pos += parseInt(s, ss, pos)
  if pos >= s.len or s[pos] != '.':
    return (-1'i64, 0)
  pos.inc()
  pos += parseInt(s, xx, pos)
  result = (int64(mm * 60_000 + ss * 1000 + xx * 10), pos - start)

proc stripWordTags(text: string): string =
  ## Remove <mm:ss.xx> word-level tags from display text.
  result = newStringOfCap(text.len)
  var i = 0
  while i < text.len:
    if text[i] == '<':
      var (_, n) = parseTimestamp(text, i + 1)
      if n > 0:
        i += n + 2  # skip past <ts>
        continue
    result.add text[i]
    i.inc()

proc parseLrc*(content: string): LrcFile =
  for rawLine in content.splitLines():
    var line = rawLine.strip()
    if line.len == 0: continue

    # Handle metadata tags
    if line.len > 7 and line[0] == '[':
      let close = line.find(']')
      if close > 1 and line[1] notin Digits:
        let tagEnd = line.find(':', 1)
        if tagEnd > 1 and tagEnd < close:
          let key = line[1..<tagEnd].strip
          let val = line[tagEnd+1..<close].strip
          case key
          of "ti": result.title = val
          of "ar": result.artist = val
          else: discard
        continue

    # Parse line-level timestamps: multiple [ts] per line supported
    var pos = 0
    while pos < line.len and line[pos] == '[':
      let (ms, n) = parseTimestamp(line, pos + 1)
      if ms < 0:
        break
      # Check closing bracket
      let closeBracket = pos + 1 + n
      if closeBracket >= line.len or line[closeBracket] != ']':
        break
      pos = closeBracket + 1
      let text = line[pos..^1].stripWordTags().strip()
      if text.len > 0:
        result.lines.add TranscriptLine(timeStartMs: ms, text: text)

  # Sort by timestamp (some LRC files are unordered)
  result.lines.sort do (a, b: TranscriptLine) -> int:
    cmp(a.timeStartMs, b.timeStartMs)

export TranscriptLine, LrcFile
