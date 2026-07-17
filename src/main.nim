import std/[os, json, strutils, times]

import webview
import lrc, audio_engine, system_dictionary, ui_assets

const DictionarySource = "macOS-normalized-html-v1"

const DataDir = getHomeDir() / ".podlrc"
const RecentPath = DataDir / "recent.json"
const ConfigPath = DataDir / "config.json"
const WordsPath = DataDir / "words.json"
const MaxRecent = 20
const DefaultWindowWidth = 800
const DefaultWindowHeight = 600

proc loadRecent(): seq[string] =
  if fileExists(RecentPath):
    try:
      let data = parseJson(readFile(RecentPath))
      for item in data:
        let p = item.getStr()
        if fileExists(p):
          result.add(p)
    except: discard

proc saveRecent(paths: seq[string]) =
  createDir(DataDir)
  var arr = newJArray()
  for p in paths:
    arr.add(%p)
  writeFile(RecentPath, $arr)

proc addRecent(path: string) =
  var recent = loadRecent()
  var i = 0
  while i < recent.len:
    if recent[i] == path:
      recent.delete(i)
    else:
      inc i
  recent.insert(path, 0)
  if recent.len > MaxRecent:
    recent.setLen(MaxRecent)
  saveRecent(recent)

proc loadConfig(): JsonNode =
  if fileExists(ConfigPath):
    try:
      result = parseJson(readFile(ConfigPath))
    except: discard
  if result.isNil:
    result = newJObject()
  if not result.hasKey("lrcSize"):
    result["lrcSize"] = %100

proc saveConfig(lrcSize: int, lastFile = "", lastPosMs: int64 = 0) =
  createDir(DataDir)
  var cfg = loadConfig()
  cfg["lrcSize"] = %lrcSize
  if lastFile.len > 0:
    cfg["lastFile"] = %lastFile
    cfg["lastPosMs"] = %lastPosMs
  writeFile(ConfigPath, $cfg)

proc saveWindowSize(width, height: int) =
  createDir(DataDir)
  var cfg = loadConfig()
  cfg["windowWidth"] = %clamp(width, 480, 4000)
  cfg["windowHeight"] = %clamp(height, 360, 3000)
  writeFile(ConfigPath, $cfg)

proc loadWindowSize(cfg: JsonNode): tuple[width, height: int] =
  result = (DefaultWindowWidth, DefaultWindowHeight)
  if cfg.hasKey("windowWidth") and cfg["windowWidth"].kind == JInt:
    result.width = clamp(cfg["windowWidth"].getInt(), 480, 4000)
  if cfg.hasKey("windowHeight") and cfg["windowHeight"].kind == JInt:
    result.height = clamp(cfg["windowHeight"].getInt(), 360, 3000)

proc savePlaybackState(path: string, posMs: int64) =
  createDir(DataDir)
  var cfg = loadConfig()
  let position = max(posMs, 0'i64)
  cfg["lastFile"] = %path
  cfg["lastPosMs"] = %position
  if not cfg.hasKey("playbackPositions") or cfg["playbackPositions"].kind != JObject:
    cfg["playbackPositions"] = newJObject()
  cfg["playbackPositions"][path] = %position
  writeFile(ConfigPath, $cfg)

proc loadPlaybackPosition(path: string): int64 =
  let cfg = loadConfig()
  if cfg.hasKey("playbackPositions") and
      cfg["playbackPositions"].kind == JObject and
      cfg["playbackPositions"].hasKey(path):
    return max(cfg["playbackPositions"][path].getInt(), 0'i64)
  if cfg.hasKey("lastFile") and cfg["lastFile"].getStr() == path and
      cfg.hasKey("lastPosMs"):
    result = max(cfg["lastPosMs"].getInt(), 0'i64)

type
  WordEntry = object
    word: string
    definition: string
    source: string
    file: string
    timeMs: int64

proc sameWordEntry(entry: WordEntry; word: string): bool =
  cmpIgnoreCase(entry.word, word) == 0

proc findWordEntry(entries: seq[WordEntry]; word: string): int =
  for i, entry in entries:
    if entry.sameWordEntry(word):
      return i
  -1

proc loadWords(): seq[WordEntry] =
  if fileExists(WordsPath):
    try:
      let data = parseJson(readFile(WordsPath))
      for item in data:
        let source = if item.hasKey("source"): item["source"].getStr() else: ""
        let entry = WordEntry(
          word: item["word"].getStr(),
          definition: if item.hasKey("definition"): item["definition"].getStr() else: "",
          source: source,
          file: item["file"].getStr(),
          timeMs: item["timeMs"].getInt(),
        )
        let existing = result.findWordEntry(entry.word)
        if existing < 0:
          result.add(entry)
        elif entry.definition.len > 0 and result[existing].definition.len == 0:
          result[existing].definition = entry.definition
          result[existing].source = entry.source
    except: discard

proc saveWords(entries: seq[WordEntry]) =
  createDir(DataDir)
  var unique: seq[WordEntry]
  for entry in entries:
    let existing = unique.findWordEntry(entry.word)
    if existing < 0:
      unique.add(entry)
    elif entry.definition.len > 0:
      unique[existing] = entry
  var arr = newJArray()
  for e in unique:
    var obj = newJObject()
    obj["word"] = %e.word
    obj["definition"] = %e.definition
    obj["source"] = %e.source
    obj["file"] = %e.file
    obj["timeMs"] = %e.timeMs
    arr.add(obj)
  writeFile(WordsPath, $arr)

proc normalizeDictionarySource(source: string): string =
  if source.startsWith(DictionarySource):
    source
  else:
    DictionarySource

proc addWord(word, definition, source, file: string, timeMs: int64): bool =
  ## Returns true if a new word was added, false if an existing word was updated.
  var entries = loadWords()
  let existing = entries.findWordEntry(word)
  if existing >= 0:
    if definition.len > 0:
      entries[existing].definition = definition
      entries[existing].source = normalizeDictionarySource(source)
      saveWords(entries)
      return false
    saveWords(entries)
    return false
  entries.add(WordEntry(
    word: word,
    definition: definition,
    source: normalizeDictionarySource(source),
    file: file,
    timeMs: timeMs
  ))
  saveWords(entries)
  return true

proc removeWord(word: string): bool =
  var entries = loadWords()
  var changed = false
  var i = 0
  while i < entries.len:
    if entries[i].sameWordEntry(word):
      entries.delete(i)
      changed = true
    else:
      inc i
  if changed:
    saveWords(entries)
  changed

proc setWordDefinition(word, definition, source, file: string, timeMs: int64): bool =
  var entries = loadWords()
  let existing = entries.findWordEntry(word)
  if existing >= 0:
    entries[existing].definition = definition
    entries[existing].source = normalizeDictionarySource(source)
    saveWords(entries)
    return true

proc wordsJson(): JsonNode =
  var arr = newJArray()
  for e in loadWords():
    var obj = newJObject()
    obj["word"] = %e.word
    obj["definition"] = %e.definition
    obj["source"] = %e.source
    obj["file"] = %e.file
    obj["timeMs"] = %e.timeMs
    arr.add(obj)
  result = arr

proc linesJson(lrc: LrcFile): JsonNode =
  result = newJArray()
  for line in lrc.lines:
    var obj = newJObject()
    obj["timeStartMs"] = %line.timeStartMs
    obj["text"] = %line.text
    result.add(obj)

proc findActiveIndex(lrc: LrcFile, posMs: int64): int =
  result = -1
  for i in 0 ..< lrc.lines.len:
    if lrc.lines[i].timeStartMs <= posMs:
      result = i
    else:
      break

proc buildResumeState(cfg: JsonNode): JsonNode =
  result = newJNull()
  if not cfg.hasKey("lastFile"):
    return

  let path = cfg["lastFile"].getStr()
  if not fileExists(path):
    return

  let posMs = if cfg.hasKey("lastPosMs"): cfg["lastPosMs"].getInt() else: 0'i64
  let lrcPath = path.changeFileExt("lrc")
  var lrc = if fileExists(lrcPath):
    parseLrc(readFile(lrcPath))
  else:
    LrcFile(lines: @[])
  lrc.title = path.extractFilename()

  var state = newJObject()
  state["loaded"] = %true
  state["lines"] = linesJson(lrc)
  state["words"] = wordsJson()
  state["currentFile"] = %path
  state["position"] = %posMs
  state["playing"] = %false
  state["activeIndex"] = %findActiveIndex(lrc, posMs)
  result = state

proc buildHtml(): string =
  let cfg = loadConfig()
  let lrcSize = cfg["lrcSize"].getInt()
  let initialState = buildResumeState(cfg)
  var recentJson = newJArray()
  for path in loadRecent():
    recentJson.add(%path)

  var config = newJObject()
  config["lrcSize"] = %lrcSize
  config["recent"] = recentJson
  config["initialState"] = initialState
  result = buildPlayerHtml($config)

var gEngine: AudioEngine
var gLrc: LrcFile
var gCurrentFile: string
var gPendingResumeFile: string
var gPendingResumePos: int64

var gCachedLinesJson: string
var gCachedRecentJson: string
var gCachedWordsJson: string

proc saveCurrentPlaybackState() =
  if gCurrentFile.len > 0 and gEngine != nil:
    savePlaybackState(gCurrentFile, gEngine.position())

proc buildFullStateJson(): string =
  let linesArr = linesJson(gLrc)
  gCachedLinesJson = $linesArr
  gCachedRecentJson = $(%loadRecent())
  gCachedWordsJson = $(wordsJson())
  var js = newJObject()
  js["loaded"] = %true
  js["lines"] = linesArr
  js["recent"] = parseJson(gCachedRecentJson)
  js["words"] = parseJson(gCachedWordsJson)
  js["currentFile"] = %gCurrentFile
  js["position"] = %(if gEngine.isNil: 0'i64 else: gEngine.position())
  js["duration"] = %(if gEngine.isNil: 0'i64 else: gEngine.duration())
  js["playing"] = %(if not gEngine.isNil: gEngine.isPlaying() else: false)
  js["activeIndex"] = %(if gEngine.isNil: -1 else: findActiveIndex(gLrc, gEngine.position()))
  js["volume"] = %(if gEngine.isNil: 0.8 else: gEngine.getVolume())
  result = $js

proc pushFullState(w: Webview) =
  let json = buildFullStateJson()
  discard w.eval(cstring("updateState(" & json & ");"))

proc loadFile(w: Webview, path: string, seekMs: int64 = 0) =
  saveCurrentPlaybackState()
  w.setTitle(path.extractFilename().cstring)
  if gEngine != nil:
    gEngine.delete()
    gEngine = nil
  gEngine = newAudioEngine(path)
  addRecent(path)
  let lrcPath = path.changeFileExt("lrc")
  if fileExists(lrcPath):
    gLrc = parseLrc(readFile(lrcPath))
  else:
    gLrc = LrcFile(
      title: path.extractFilename(),
      lines: @[]
    )
  gLrc.title = path.extractFilename()
  gCurrentFile = path
  if seekMs > 0:
    gEngine.seek(seekMs)
    sleep(100)
    gEngine.pause()
  else:
    gEngine.play()
  savePlaybackState(path, max(seekMs, 0'i64))
  pushFullState(w)

proc handleMessage(w: Webview, arg: string) =
  try:
    let msg = parseJson(arg)
    let cmd = msg["cmd"].getStr()

    case cmd
    of "getState":
      if gEngine != nil:
        var js = newJObject()
        js["position"] = %gEngine.position()
        js["playing"] = %gEngine.isPlaying()
        js["activeIndex"] = %findActiveIndex(gLrc, gEngine.position())
        discard w.eval(cstring("updateState(" & $js & ");"))

    of "open":
      let path = w.dialogOpen("Open MP3 File")
      if path.len > 0 and fileExists(path):
        loadFile(w, path, loadPlaybackPosition(path))

    of "openRecent":
      let path = msg["path"].getStr()
      if fileExists(path):
        loadFile(w, path, loadPlaybackPosition(path))

    of "play":
      if gEngine != nil:
        gEngine.play()

    of "pause":
      if gEngine != nil:
        gEngine.pause()

    of "seek":
      if gEngine != nil:
        let ms = msg["ms"].getInt()
        gEngine.seek(ms)

    of "seekBack":
      if gEngine != nil:
        let pos = gEngine.position()
        gEngine.seek(max(pos - 10000, 0'i64))

    of "seekFwd":
      if gEngine != nil:
        let pos = gEngine.position()
        let dur = gEngine.duration()
        gEngine.seek(min(pos + 10000, dur))

    of "toggle":
      if gEngine != nil:
        if gEngine.isPlaying():
          gEngine.pause()
        else:
          gEngine.play()

    of "setVolume":
      if gEngine != nil:
        let vol = msg["vol"].getFloat()
        gEngine.setVolume(float32(vol))

    of "saveConfig":
      if msg.hasKey("lrcSize"):
        saveConfig(msg["lrcSize"].getInt())
      if msg.hasKey("windowWidth") and msg.hasKey("windowHeight"):
        saveWindowSize(
          msg["windowWidth"].getInt(), msg["windowHeight"].getInt())

    of "lookupWord":
      var response = newJObject()
      let word = msg["word"].getStr()
      response["id"] = %msg["id"].getInt()
      if msg.hasKey("context") and msg.hasKey("offset"):
        response["definition"] = %lookupDefinition(
          word, msg["context"].getStr(), msg["offset"].getInt())
      else:
        response["definition"] = %lookupDefinition(word)
      discard w.eval(cstring("resolveDictionaryLookup(" & $response & ");"))

    of "addWord":
      let word = msg["word"].getStr()
      let file = if msg.hasKey("file"): msg["file"].getStr() else: gCurrentFile
      if file.len > 0:
        let definition = if msg.hasKey("definition"): msg["definition"].getStr() else: ""
        let source = if msg.hasKey("source"): msg["source"].getStr() else: ""
        let timeMs = msg["timeMs"].getInt()
        discard addWord(word, definition, source, file, timeMs)
        gCachedWordsJson = $(wordsJson())
        discard w.eval(cstring("updateWordPanel(" & gCachedWordsJson & ");"))

    of "removeWord":
      let word = msg["word"].getStr()
      discard removeWord(word)
      gCachedWordsJson = $(wordsJson())
      discard w.eval(cstring("updateWordPanel(" & gCachedWordsJson & ");"))

    of "setWordDefinition":
      let word = msg["word"].getStr()
      let definition = msg["definition"].getStr()
      let source = if msg.hasKey("source"): msg["source"].getStr() else: ""
      let file = msg["file"].getStr()
      let timeMs = msg["timeMs"].getInt()
      if definition.len > 0 and setWordDefinition(word, definition, source, file, timeMs):
        gCachedWordsJson = $(wordsJson())
        discard w.eval(cstring("updateWordPanel(" & gCachedWordsJson & ");"))

    of "openWordRef":
      let refFile = msg["file"].getStr()
      let refMs = msg["ms"].getInt()
      if fileExists(refFile):
        loadFile(w, refFile, refMs)

    of "ready":
      if gPendingResumeFile.len > 0 and fileExists(gPendingResumeFile):
        loadFile(w, gPendingResumeFile, gPendingResumePos)

    else: discard

  except:
    echo "handleMessage error: ", getCurrentExceptionMsg()

proc main() =
  # Resolve the previous session before the page can send its ready message.
  let cfg = loadConfig()
  if cfg.hasKey("lastFile"):
    let lastFile = cfg["lastFile"].getStr()
    let lastPos = if cfg.hasKey("lastPosMs"): cfg["lastPosMs"].getInt() else: 0'i64
    if fileExists(lastFile):
      gPendingResumeFile = lastFile
      gPendingResumePos = lastPos

  let html = buildHtml()
  let stamp = getTime().toUnix()
  let htmlPath = getTempDir() / ("podlrc_" & $stamp & ".html")
  writeFile(htmlPath, html)
  let url = "file://" & htmlPath
  echo "HTML: ", html.len, " bytes"

  let windowTitle = if gPendingResumeFile.len > 0:
    gPendingResumeFile.extractFilename()
  else:
    "podcast player"
  let windowSize = loadWindowSize(cfg)
  var w = newWebView(
    windowTitle, url, windowSize.width, windowSize.height,
    true, false, handleMessage)
  if w.isNil:
    echo "Failed to create webview"
    quit(1)

  w.run()

  saveCurrentPlaybackState()

  removeFile(htmlPath)

when isMainModule:
  main()
