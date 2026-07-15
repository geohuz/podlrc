import std/[os, json, strutils, times]

import webview
import lrc, audio_engine, system_dictionary

const DictionarySource = "macOS-normalized-html-v1"
const DictionaryFormattersJs =
  staticRead("dictionary_formatters/common.js") & "\n" &
  staticRead("dictionary_formatters/noad.js") & "\n" &
  staticRead("dictionary_formatters/oaldpe_apple.js") & "\n" &
  staticRead("dictionary_formatters.js")

const DataDir = getHomeDir() / ".podlrc"
const RecentPath = DataDir / "recent.json"
const ConfigPath = DataDir / "config.json"
const WordsPath = DataDir / "words.json"
const MaxRecent = 20

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

const PlayerHtml = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #111111;
    --surface: #1c1c1c;
    --text: #b3b3b3;
    --text-dim: #5a5a5a;
    --accent: #1ed760;
    --active: #ffffff;
    --progress: #404040;
    --lrc-size: 16px;
    --font-ui: -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--font-ui); height: 100vh;
    display: flex; flex-direction: column; overflow: hidden;
    user-select: none; -webkit-user-select: none;
  }

  /* ── Title bar ── */
  #title-bar {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 16px; background: var(--surface);
    border-bottom: 1px solid #2a2a2a; min-height: 52px;
    position: relative;
  }
  #btn-open, #btn-recent, #btn-words {
    background: var(--accent); border: none; color: #000;
    padding: 7px 16px; border-radius: 20px; font-size: 12px;
    font-weight: 600; cursor: pointer; white-space: nowrap;
    letter-spacing: 0.3px;
  }
  #btn-open:hover, #btn-recent:hover, #btn-words:hover { background: #1fdf64; }
  #btn-words { background: #555; color: #fff; }
  #btn-words:hover { background: #777; }
  #btn-recent { position: relative; padding-right: 26px; }
  #btn-recent::after {
    content: ''; position: absolute; right: 10px; top: 50%;
    transform: translateY(-50%);
    width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid #000;
  }
  #zoom-hint {
    font-size: 11px; color: var(--text-dim); margin-left: 6px;
    opacity: 0; transition: opacity 0.4s;
  }
  #zoom-hint.show { opacity: 1; }

  /* ── Recent dropdown ── */
  #recent-dropdown {
    position: absolute; top: 46px; left: 86px; z-index: 200;
    background: #2a2a2a; border: 1px solid #444; border-radius: 8px;
    min-width: 320px; max-width: 480px; box-shadow: 0 8px 30px rgba(0,0,0,0.6);
    display: none; flex-direction: column; padding: 4px 0;
    -webkit-user-select: none; user-select: none;
  }
  #recent-dropdown.open { display: flex; }
  .recent-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px; cursor: pointer; font-size: 13px;
    color: #ccc; transition: background 0.1s;
  }
  .recent-item:hover { background: #383838; }
  .recent-item .ri-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent-item .ri-path { font-size: 11px; color: #555; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rd-header {
    padding: 8px 14px 4px; font-size: 11px; color: #555;
    text-transform: uppercase; letter-spacing: 0.5px;
  }

  /* ── Word panel ── */
  #word-panel {
    position: absolute; top: 46px; left: 86px; z-index: 200;
    background: #2a2a2a; border: 1px solid #444; border-radius: 8px;
    width: 640px; max-width: calc(100vw - 110px);
    max-height: 420px; overflow: hidden;
    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
    display: none; flex-direction: column;
  }
  #word-panel.open { display: flex; }
  .wp-list {
    box-sizing: border-box; max-height: 420px; overflow-y: auto; overflow-x: hidden;
    padding: 8px 14px 8px 8px; scrollbar-gutter: stable;
  }
  .wp-list::-webkit-scrollbar { width: 4px; }
  .wp-list::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
  .wp-empty { padding: 20px 14px; font-size: 13px; color: #555; text-align: center; }
  .wp-item {
    display: grid; grid-template-columns: 16px minmax(0, 1fr) 28px;
    align-items: start; column-gap: 10px; row-gap: 8px;
    padding: 10px 12px; cursor: pointer; font-size: 13px;
    color: #ccc; border-radius: 6px; box-sizing: border-box; width: 100%;
    transition: background 0.1s;
  }
  .wp-item:hover { background: #383838; }
  .wp-item + .wp-item { margin-top: 4px; }
  .wp-toggle {
    grid-column: 1; grid-row: 1; width: 16px; color: #777; font-size: calc(var(--lrc-size) * 0.5);
    line-height: 1.35; cursor: pointer; transition: transform 0.12s, color 0.12s;
  }
  .wp-toggle:hover { color: #aaa; }
  .wp-item.expanded .wp-toggle { transform: rotate(90deg); color: #aaa; }
  .wp-word {
    grid-column: 2; grid-row: 1; min-width: 0;
    color: #8ab4ff; font-size: calc(var(--lrc-size) * 0.5); font-weight: 650;
    text-decoration: underline;
    text-underline-offset: 2px; cursor: pointer;
  }
  .wp-word:hover { color: #b7d0ff; }
  .wp-definition {
    display: none; grid-column: 2 / 4; grid-row: 2; min-width: 0;
    font-size: calc(var(--lrc-size) * 0.5); color: #f0f0f0; line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .wp-item.expanded .wp-definition { display: block; }
  .dict-sense + .dict-sense {
    margin-top: 9px; padding-top: 8px; border-top: 1px solid #3a3a3a;
  }
  .dict-main { color: #f4f4f4; }
  .dict-number { color: #4f8cff; font-weight: 750; margin-right: 6px; }
  .dict-form { color: #7fb0ff; font-weight: 650; margin-right: 5px; }
  .dict-translation { display: block; color: #fff; margin: 2px 0 0 18px; }
  .dict-example {
    position: relative; margin: 5px 0 0 18px; padding-left: 11px;
    color: #d7d7d7;
  }
  .dict-example::before {
    content: ''; position: absolute; left: 0; top: 0.65em;
    width: 4px; height: 4px; background: #777; transform: rotate(45deg);
  }
  .dict-example-en { font-style: italic; }
  .dict-example-zh { display: block; color: #fff; }
  .dict-plain-line + .dict-plain-line { margin-top: 6px; }
  .dict-head { margin-bottom: 7px; }
  .dict-headword { color: #fff; font-weight: 750; margin-right: 8px; }
  .dict-pron { color: #aaa; }
  .dict-pos { color: #999; font-weight: 650; margin: 4px 0 6px; }
  .wp-del {
    grid-column: 3; grid-row: 1; width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #777; font-size: 18px; cursor: pointer; line-height: 1;
  }
  .wp-del:hover { background: rgba(255,80,80,0.2); color: #f55; }
  .word.saved, .word.saved.selected { background: #2563eb; color: #fff; }
  .word-remove {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; margin-left: 5px; border-radius: 50%;
    font-size: 13px; line-height: 1; vertical-align: 1px;
    color: rgba(255,255,255,0.82); background: rgba(255,255,255,0.18);
    cursor: pointer;
  }
  .word-remove:hover { background: rgba(255,255,255,0.32); color: #fff; }

  /* ── LRC area ── */
  #lrc-container {
    flex: 1; overflow-y: auto; padding: 24px 0;
    scroll-behavior: smooth;
  }
  #lrc-container::-webkit-scrollbar { width: 6px; }
  #lrc-container::-webkit-scrollbar-track { background: transparent; }
  #lrc-container::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  .lrc-line {
    padding: 6px 24px; color: var(--text-dim);
    border-left: 3px solid transparent; line-height: 1.7;
    transition: all 0.2s; font-size: var(--lrc-size);
    display: flex; align-items: baseline;
  }
  .lrc-line:hover { color: #999; background: rgba(255,255,255,0.02); }
  .lrc-line.active {
    color: var(--active);
    background: rgba(30,215,96,0.06);
    border-left-color: var(--accent);
  }
  .lrc-time {
    font-size: calc(var(--lrc-size) * 0.7); color: #444;
    margin-right: 14px; flex-shrink: 0;
    width: 48px; text-align: right;
    transition: color 0.2s; cursor: pointer;
    padding-top: 0.15em;
  }
  .lrc-time:hover { color: #888; }
  .lrc-line.active .lrc-time { color: var(--accent); }
  .lrc-line.active .lrc-time:hover { color: #3beb7a; }
  .lrc-text { flex: 1; min-width: 0; }

  .word {
    cursor: pointer; border-radius: 3px; padding: 1px 2px;
    margin: 0 -2px; transition: background 0.1s;
    -webkit-user-select: text; user-select: text;
  }
  .word:hover { background: rgba(255,255,255,0.08); }
  .word.selected { background: rgba(30,215,96,0.25); color: #fff; }

  /* ── Dict popup ── */
  #dict-popup {
    position: fixed; z-index: 1000; max-width: 420px; min-width: 240px;
    max-height: min(440px, calc(100vh - 40px)); overflow-y: auto;
    background: #2a2a2a; border: 1px solid #444; border-radius: 10px;
    padding: 12px 16px; font-size: 13px; line-height: 1.6;
    color: #ccc; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    display: none;
    -webkit-user-select: text; user-select: text;
  }
  #dict-popup.visible { display: block; }
  #dict-popup .dw { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 6px; }
  #dict-popup .dp { font-size: 12px; color: var(--accent); margin-bottom: 8px; }
  #dict-popup .dm { font-size: 12px; color: #777; }
  #dict-popup .dd { margin-top: 4px; }
  #dict-popup .dict-sense + .dict-sense { border-top-color: #444; }

  /* ── Playback bar ── */
  #playbar {
    background: var(--surface); border-top: 1px solid #2a2a2a;
    padding: 8px 24px; display: flex; align-items: center;
    gap: 12px; min-height: 64px;
  }
  #playbar button {
    background: none; border: none; color: var(--text);
    cursor: pointer; display: flex; align-items: center;
    justify-content: center; transition: all 0.15s;
    flex-shrink: 0;
  }
  .btn-sm {
    width: 36px; height: 36px; border-radius: 50%;
    padding: 7px;
  }
  .btn-sm:hover { background: #333; }
  .btn-sm svg { width: 100%; height: 100%; fill: currentColor; }
  .btn-lg {
    width: 40px; height: 40px; border-radius: 50%;
    background: #fff !important; color: #000 !important; padding: 10px;
  }
  .btn-lg:hover { transform: scale(1.06); }
  .btn-lg svg { width: 100%; height: 100%; fill: currentColor; }

  #progress-group {
    flex: 0 1 520px; display: flex; align-items: center; gap: 8px;
  }
  #progress-bar {
    flex: 1; min-width: 0;
    -webkit-appearance: none; appearance: none;
    height: 2px; border-radius: 1px;
    outline: none; cursor: pointer;
    background: #404040;
    padding: 8px 0; margin: -8px 0;
    background-clip: content-box;
    -webkit-background-clip: content-box;
  }
  #progress-bar::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px;
    border-radius: 50%; background: #fff; cursor: pointer;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    opacity: 0; transition: opacity 0.15s;
  }
  #progress-bar:hover::-webkit-slider-thumb,
  #progress-bar:active::-webkit-slider-thumb,
  body.seeking #progress-bar::-webkit-slider-thumb { opacity: 1; }

  #volume-container {
    display: flex; align-items: center; gap: 6px;
    flex-shrink: 0; margin-left: auto;
  }
  #volume-bar {
    width: 96px; -webkit-appearance: none; appearance: none;
    height: 2px; border-radius: 1px;
    outline: none; cursor: pointer;
    background: linear-gradient(to right, #999 0%, #999 80%, #404040 80%);
  }
  #volume-bar::-webkit-slider-thumb {
    -webkit-appearance: none; width: 12px; height: 12px;
    border-radius: 50%; background: #fff; cursor: pointer;
    opacity: 0; transition: opacity 0.15s;
  }
  #volume-bar:hover::-webkit-slider-thumb,
  #volume-bar:active::-webkit-slider-thumb,
  body.volume-dragging #volume-bar::-webkit-slider-thumb { opacity: 1; }
  .time-label {
    font-family: 'SF Mono', 'Menlo', monospace; font-size: 11px;
    color: var(--text-dim); min-width: 38px; text-align: center;
    letter-spacing: 0.5px; flex-shrink: 0;
  }

  /* ── Empty state ── */
  #empty-state {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; color: #333; gap: 12px;
  }
  #empty-state svg { width: 56px; height: 56px; opacity: 0.4; }
  #empty-state .hint { font-size: 14px; color: #444; }

  .hidden { display: none !important; }
</style>
</head>
<body>

<div id="title-bar">
  <button id="btn-open">Open File</button>
  <button id="btn-recent" style="display:none">Recent</button>
  <button id="btn-words" style="display:none">Vocabulary</button>
  <div id="recent-dropdown"></div>
  <div id="word-panel"></div>
  <span id="zoom-hint">Font: 100%</span>
</div>

<div id="empty-state">
  <svg viewBox="0 0 24 24" fill="currentColor" opacity="0.35">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
  </svg>
  <div class="hint">Open an MP3 + LRC file to start</div>
  <div id="empty-recent" style="margin-top:8px;font-size:13px;color:#444;"></div>
</div>

<div id="lrc-container" class="hidden"></div>

<div id="dict-popup"></div>

<div id="playbar" class="hidden">
  <button class="btn-sm" title="Back 10s" id="btn-skip-back">
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="13,6 7,12 13,18"/>
      <polygon points="19,6 19,18 13,12" opacity="0.5"/>
    </svg>
  </button>
  <button class="btn-lg" title="Play" id="btn-play">
    <svg id="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>
    <svg id="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>
  </button>
  <button class="btn-sm" title="Forward 10s" id="btn-skip-fwd">
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="11,6 17,12 11,18"/>
      <polygon points="5,6 5,18 11,12" opacity="0.5"/>
    </svg>
  </button>
  <div id="progress-group">
    <span class="time-label" id="time-current">00:00</span>
    <input type="range" id="progress-bar" min="0" max="1000" value="0">
    <span class="time-label" id="time-duration">00:00</span>
  </div>
  <div id="volume-container">
    <svg viewBox="0 0 24 24" fill="currentColor" id="vol-icon" width="16" height="16" style="flex-shrink:0;opacity:0.5;">
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/>
    </svg>
    <input type="range" id="volume-bar" min="0" max="100" value="80">
  </div>
</div>

<script>
  var _lines = [];
  var _activeIdx = -1;
  var _duration = 0;
  var _playing = false;
  var _seeking = false;
  var _lrcSize = 100;
  var _volDragging = false;
  var _dictTimer = null;
  var _recentFiles = [];
  var _currentFile = '';
  var _dictionaryRequests = {};
  var _nextDictionaryRequest = 1;
  var _visibleLookupWord = '';

  function fmtTime(ms) {
    if (ms <= 0) return '00:00';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m.toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0');
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ── recent files ── */
  function renderRecentDropdown() {
    var dd = document.getElementById('recent-dropdown');
    var btn = document.getElementById('btn-recent');
    if (_recentFiles.length === 0) {
      btn.style.display = 'none';
      dd.classList.remove('open');
      return;
    }
    btn.style.display = '';
    var html = '<div class="rd-header">Recent Files</div>';
    _recentFiles.forEach(function(p, i) {
      var name = p.split('/').pop().replace(/\.mp3$/i, '');
      var dir = p.substring(0, p.lastIndexOf('/'));
      html += '<div class="recent-item" data-idx="' + i + '">' +
        '<span class="ri-name">' + esc(name) + '</span>' +
        '<span class="ri-path">' + esc(dir) + '</span></div>';
    });
    dd.innerHTML = html;
    dd.querySelectorAll('.recent-item').forEach(function(el) {
      el.onclick = function(e) {
        e.stopPropagation();
        clearWordPopup();
        var idx = parseInt(this.getAttribute('data-idx'));
        window.external.invoke(JSON.stringify({cmd: 'openRecent', path: _recentFiles[idx]}));
        dd.classList.remove('open');
      };
    });
  }

  function updateRecent(recent) {
    _recentFiles = recent || [];
    renderRecentDropdown();
    var er = document.getElementById('empty-recent');
    if (_recentFiles.length > 0) {
      var names = _recentFiles.slice(0, 3).map(function(p) {
        return p.split('/').pop().replace(/\.mp3$/i, '');
      });
      er.textContent = 'Recent: ' + names.join(' · ');
    } else {
      er.textContent = '';
    }
  }

  function toggleRecentDropdown(e) {
    e.stopPropagation();
    clearWordPopup();
    document.getElementById('word-panel').classList.remove('open');
    var dd = document.getElementById('recent-dropdown');
    dd.classList.toggle('open');
  }

  /* ── saved words ── */
  var _savedWords = {};
  var _definitionRequests = {};
  var _pendingWordSaves = {};

  function wordKey(word) {
    return (word || '').toLowerCase();
  }

  function isSavedWord(word) {
    return Object.prototype.hasOwnProperty.call(_savedWords, wordKey(word));
  }

  function updateWordPanel(words) {
    _savedWords = {};
    (words || []).forEach(function(w) {
      var key = wordKey(w.word);
      _savedWords[key] = w;
      delete _pendingWordSaves[key];
    });
    renderWordPanel();
    updateWordHighlights();
    hydrateMissingDefinitions();
  }

  function renderWordPanel() {
    var panel = document.getElementById('word-panel');
    var btn = document.getElementById('btn-words');
    var entries = Object.values(_savedWords);
    if (entries.length === 0) {
      btn.style.display = 'none';
      panel.classList.remove('open');
      return;
    }
    btn.style.display = '';
    entries.sort(function(a, b) { return a.word.localeCompare(b.word); });
    var html = '<div class="wp-list"><div class="rd-header">Vocabulary</div>';
    entries.forEach(function(e) {
      html += '<div class="wp-item" data-file="' + esc(e.file) + '" data-ms="' + e.timeMs + '">' +
        '<span class="wp-toggle" title="Expand definition">▶</span>' +
        '<span class="wp-word">' + esc(e.word) + '</span>' +
        '<span class="wp-definition">' + (formatDictionaryDefinition(e.definition, e.word) || 'Looking up definition...') + '</span>' +
        '<span class="wp-del" data-word="' + esc(e.word) + '" data-file="' + esc(e.file) + '" data-ms="' + e.timeMs + '">&times;</span>' +
        '</div>';
    });
    html += '</div>';
    panel.innerHTML = html;
    panel.querySelectorAll('.wp-item').forEach(function(el) {
      el.addEventListener('click', function(ev) {
        if (ev.target.classList.contains('wp-del')) return;
        if (ev.target.classList.contains('wp-toggle')) {
          ev.stopPropagation();
          el.classList.toggle('expanded');
          return;
        }
        clearWordPopup();
        var f = el.getAttribute('data-file');
        var ms = parseInt(el.getAttribute('data-ms'));
        window.external.invoke(JSON.stringify({cmd: 'openWordRef', file: f, ms: ms}));
        panel.classList.remove('open');
      });
    });
    panel.querySelectorAll('.wp-del').forEach(function(el) {
      el.addEventListener('click', function(ev) {
        ev.stopPropagation();
        window.external.invoke(JSON.stringify({
          cmd: 'removeWord',
          word: el.getAttribute('data-word')
        }));
      });
    });
  }

  function requestDictionaryDefinition(word, context, offset) {
    return new Promise(function(resolve) {
      var id = _nextDictionaryRequest++;
      _dictionaryRequests[id] = resolve;
      setTimeout(function() {
        var message = {cmd: 'lookupWord', id: id, word: word};
        if (context !== undefined && context !== null) message.context = context;
        if (offset !== undefined && offset !== null) message.offset = offset;
        window.external.invoke(JSON.stringify(message));
      }, 0);
    });
  }

""" & DictionaryFormattersJs & """

  function resolveDictionaryLookup(response) {
    var resolve = _dictionaryRequests[response.id];
    delete _dictionaryRequests[response.id];
    if (resolve) resolve(response.definition || '');
  }

  function hydrateMissingDefinitions() {
    Object.values(_savedWords).forEach(function(entry) {
      var key = wordKey(entry.word);
      if (entry.definition || _definitionRequests[key]) return;
      _definitionRequests[key] = true;
      requestDictionaryDefinition(entry.word).then(function(definition) {
        if (!definition) return;
        var normalized = normalizeDictionaryDefinition(definition, entry.word);
        window.external.invoke(JSON.stringify({
          cmd: 'setWordDefinition',
          word: entry.word,
          definition: normalized.definition,
          source: normalized.source,
          file: entry.file,
          timeMs: entry.timeMs
        }));
      });
    });
  }

  function updateWordHighlights() {
    document.querySelectorAll('.lrc-line').forEach(function(lineEl, lineIdx) {
      lineEl.querySelectorAll('.word').forEach(function(el) {
        var word = el.getAttribute('data-word') || el.textContent.trim();
        var saved = wordKey(word) !== '' && isSavedWord(word);
        el.classList.toggle('saved', saved);
        var remove = el.querySelector('.word-remove');
        if (saved && !remove) {
          el.insertAdjacentHTML(
            'beforeend',
            '<span class="word-remove" title="Remove from Vocabulary">&times;</span>'
          );
        } else if (!saved && remove) {
          remove.remove();
        }
      });
    });
  }

  function toggleWordPanel(e) {
    e.stopPropagation();
    clearWordPopup();
    document.getElementById('recent-dropdown').classList.remove('open');
    var panel = document.getElementById('word-panel');
    panel.classList.toggle('open');
  }

  /* ── word splitting ── */
  function buildWordSpans(text) {
    var out = '';
    var re = /([a-zA-Z0-9'\-]+)/g;
    var idx = 0, m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.substring(idx, m.index));
      out += '<span class="word" data-word="' + esc(m[1]) +
        '" data-offset="' + m.index + '">' + esc(m[1]) + '</span>';
      idx = m.index + m[1].length;
    }
    out += esc(text.substring(idx));
    return out;
  }

  function renderLines(lines) {
    _lines = lines;
    _activeIdx = -1;
    var container = document.getElementById('lrc-container');
    container.innerHTML = '';
    lines.forEach(function(line, i) {
      var div = document.createElement('div');
      div.className = 'lrc-line';
      div.innerHTML = '<span class="lrc-time">' +
        fmtTime(line.timeStartMs) + '</span>' +
        '<span class="lrc-text">' + buildWordSpans(line.text) + '</span>';
      div.querySelector('.lrc-time').onclick = function(e) {
        e.stopPropagation();
        window.external.invoke(JSON.stringify({cmd: 'seek', ms: line.timeStartMs}));
      };
      div.querySelectorAll('.word').forEach(function(w) {
        w.addEventListener('click', function(e) {
          e.stopPropagation();
          if (e.target.classList.contains('word-remove')) {
            window.external.invoke(JSON.stringify({
              cmd: 'removeWord',
              word: w.getAttribute('data-word') || w.textContent.trim()
            }));
            return;
          }
          onWordClick(w, e);
        });
      });
      container.appendChild(div);
    });
    updateWordHighlights();
  }

  /* ── dictionary popup ── */
  function showPopup(word, x, y) {
    var popup = document.getElementById('dict-popup');
    _visibleLookupWord = word;
    popup.classList.add('visible');
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.innerHTML = '<div class="dw">' + esc(word) + '</div><div class="dm">Looking up...</div>';
  }

  function hidePopup() {
    var popup = document.getElementById('dict-popup');
    popup.classList.remove('visible');
    _visibleLookupWord = '';
  }

  function clearWordPopup() {
    hidePopup();
    document.querySelectorAll('.word.selected').forEach(function(w) {
      w.classList.remove('selected');
    });
    window.getSelection().removeAllRanges();
  }

  function lookupWord(word, context, offset) {
    return requestDictionaryDefinition(word, context, offset).then(function(definition) {
      var normalized = normalizeDictionaryDefinition(definition, word);
      var displayDefinition = normalized.definition;
      if (_visibleLookupWord === word) {
        var content = displayDefinition
          ? '<div class="dd">' + displayDefinition + '</div>'
          : '<div class="dm">No definition found</div>';
        document.getElementById('dict-popup').innerHTML =
          '<div class="dw">' + esc(word) + '</div>' + content;
      }
      return normalized;
    });
  }

  function onWordClick(el, event) {
    var word = el.getAttribute('data-word') || el.textContent.trim();
    var popup = document.getElementById('dict-popup');
    var shouldClosePopup = popup.classList.contains('visible') &&
      _visibleLookupWord === word && el.classList.contains('selected');
    if (shouldClosePopup) {
      hidePopup();
      el.classList.remove('selected');
      window.getSelection().removeAllRanges();
      event.preventDefault();
      return;
    }

    document.querySelectorAll('.word.selected').forEach(function(w) {
      w.classList.remove('selected');
    });
    el.classList.add('selected');

    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el.firstChild || el);
    sel.removeAllRanges();
    sel.addRange(range);

    var rect = el.getBoundingClientRect();
    var popW = 360;
    var left = Math.min(rect.left + window.scrollX, window.innerWidth - popW - 20);
    left = Math.max(left, 20);
    var top = rect.bottom + window.scrollY + 4;
    if (top + 200 > window.innerHeight) {
      top = rect.top + window.scrollY - 210;
    }
    showPopup(word, left, top);

    var lineEl = el.closest('.lrc-line');
    var container = document.getElementById('lrc-container');
    var lineIdx = lineEl ? Array.prototype.indexOf.call(container.children, lineEl) : -1;
    if (lineIdx >= 0 && lineIdx < _lines.length) {
      var timeMs = _lines[lineIdx].timeStartMs;
      var lineText = _lines[lineIdx].text || '';
      var wordOffset = parseInt(el.getAttribute('data-offset'));
      if (isNaN(wordOffset)) wordOffset = 0;
      var key = wordKey(word);
      if (isSavedWord(word)) {
        lookupWord(word, lineText, wordOffset);
      } else if (_pendingWordSaves[key]) {
        lookupWord(word, lineText, wordOffset);
      } else {
        _pendingWordSaves[key] = true;
        lookupWord(word, lineText, wordOffset).then(function(normalized) {
          if (!normalized.definition) {
            delete _pendingWordSaves[key];
            return;
          }
          window.external.invoke(JSON.stringify({
            cmd: 'addWord',
            word: word,
            definition: normalized.definition,
            source: normalized.source,
            timeMs: timeMs
          }));
        });
      }
    } else {
      lookupWord(word);
    }

    event.preventDefault();
  }

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.word')) {
      clearWordPopup();
    }
    // Close dropdowns on outside click
    if (!e.target.closest('#btn-recent') && !e.target.closest('#recent-dropdown')) {
      document.getElementById('recent-dropdown').classList.remove('open');
    }
    if (!e.target.closest('#btn-words') && !e.target.closest('#word-panel')) {
      document.getElementById('word-panel').classList.remove('open');
    }
  });

  /* ── font size zoom ── */
  function setLrcSize(pct, persist) {
    _lrcSize = Math.max(60, Math.min(200, pct));
    document.documentElement.style.setProperty('--lrc-size', (_lrcSize * 0.16).toFixed(1) + 'px');
    var hint = document.getElementById('zoom-hint');
    hint.textContent = 'Font: ' + _lrcSize + '%';
    hint.classList.add('show');
    clearTimeout(_dictTimer);
    _dictTimer = setTimeout(function() { hint.classList.remove('show'); }, 1800);
    if (persist !== false) {
      window.external.invoke(JSON.stringify({cmd: 'saveConfig', lrcSize: _lrcSize}));
    }
  }

  /* ── init from host ── */
  function initApp(config) {
    if (config.lrcSize) {
      setLrcSize(config.lrcSize, false);
    }
    if (config.recent) {
      updateRecent(config.recent);
    }
    if (config.initialState) {
      updateState(config.initialState);
    }
    requestAnimationFrame(function() {
      setTimeout(function() {
        window.external.invoke(JSON.stringify({cmd: 'ready'}));
      }, 0);
    });
  }

  /* ── state update ── */
  function updateProgressTrack(value) {
    // value: 0-1000 from the range input
    var pct = (value / 10).toFixed(1);
    if (pct > 100) pct = 100;
    var bar = document.getElementById('progress-bar');
    bar.style.background = 'linear-gradient(to right, #777 0%, #777 ' + pct + '%, #404040 ' + pct + '%)';
  }

  function updateState(data) {
    if (data.loaded === false) return;

    if (data.loaded === true) {
      document.getElementById('empty-state').classList.add('hidden');
      document.getElementById('lrc-container').classList.remove('hidden');
      document.getElementById('playbar').classList.remove('hidden');
    }

    if (data.currentFile !== undefined) {
      _currentFile = data.currentFile || '';
    }

    if (data.lines !== undefined) {
      renderLines(data.lines);
      updateWordHighlights();
    }

    if (data.activeIndex !== undefined && data.activeIndex !== _activeIdx) {
      var container = document.getElementById('lrc-container');
      var prev = container.querySelector('.lrc-line.active');
      if (prev) prev.classList.remove('active');
      _activeIdx = data.activeIndex;
      if (_activeIdx >= 0 && _activeIdx < container.children.length) {
        var el = container.children[_activeIdx];
        el.classList.add('active');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    // Volume sync (initial only — don't fight user dragging)
    if (data.volume !== undefined && !_volDragging) {
      var vpct = Math.round(data.volume * 100);
      var vb = document.getElementById('volume-bar');
      if (Math.abs(vpct - vb.value) > 2) {
        vb.value = vpct;
        vb.style.background = 'linear-gradient(to right, #999 0%, #999 ' + vpct + '%, #404040 ' + vpct + '%)';
      }
    }

    if (data.duration !== undefined) _duration = data.duration;
    if (data.playing !== undefined) {
      var wasPlaying = _playing;
      _playing = data.playing;
      if (_playing !== wasPlaying) {
        document.getElementById('icon-play').style.display = _playing ? 'none' : '';
        document.getElementById('icon-pause').style.display = _playing ? '' : 'none';
        document.getElementById('btn-play').setAttribute('title', _playing ? 'Pause' : 'Play');
      }
    }
    document.getElementById('time-duration').textContent = fmtTime(_duration);

    if (!_seeking) {
      var pos = data.position || 0;
      var val = _duration > 0 ? Math.round((pos / _duration) * 1000) : 0;
      document.getElementById('progress-bar').value = val;
      updateProgressTrack(val);
      document.getElementById('time-current').textContent = fmtTime(pos);
    }

    if (data.recent) {
      updateRecent(data.recent);
    }
    if (data.words) {
      updateWordPanel(data.words);
    }
  }

  /* ── polling ── */
  function pollState() {
    window.external.invoke(JSON.stringify({cmd: 'getState'}));
  }

  /* ── button events ── */
  document.getElementById('btn-open').onclick = function() {
    clearWordPopup();
    document.getElementById('recent-dropdown').classList.remove('open');
    document.getElementById('word-panel').classList.remove('open');
    window.external.invoke(JSON.stringify({cmd: 'open'}));
  };
  document.getElementById('btn-recent').onclick = toggleRecentDropdown;
  document.getElementById('btn-words').onclick = toggleWordPanel;
  document.getElementById('btn-play').onclick = function() {
    window.external.invoke(JSON.stringify({cmd: _playing ? 'pause' : 'play'}));
  };
  document.getElementById('btn-skip-back').onclick = function() {
    window.external.invoke(JSON.stringify({cmd: 'seekBack'}));
  };
  document.getElementById('btn-skip-fwd').onclick = function() {
    window.external.invoke(JSON.stringify({cmd: 'seekFwd'}));
  };

  var volumeBar = document.getElementById('volume-bar');
  volumeBar.addEventListener('mousedown', function() {
    _volDragging = true;
    document.body.classList.add('volume-dragging');
  });
  function endVolumeDrag() {
    _volDragging = false;
    document.body.classList.remove('volume-dragging');
  }
  document.addEventListener('mouseup', endVolumeDrag);
  window.addEventListener('blur', endVolumeDrag);
  volumeBar.oninput = function() {
    window.external.invoke(JSON.stringify({cmd: 'setVolume', vol: volumeBar.value / 100}));
    var pct = volumeBar.value;
    volumeBar.style.background = 'linear-gradient(to right, #999 0%, #999 ' + pct + '%, #404040 ' + pct + '%)';
    var icon = document.getElementById('vol-icon');
    if (pct == 0) {
      icon.innerHTML = '<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/>';
    } else if (pct < 30) {
      icon.innerHTML = '<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/>';
    } else {
      icon.innerHTML = '<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/>';
    }
  };

  var progressBar = document.getElementById('progress-bar');
  progressBar.oninput = function() {
    _seeking = true;
    document.body.classList.add('seeking');
    updateProgressTrack(progressBar.value);
    if (_duration > 0) {
      var ms = Math.round((progressBar.value / 1000) * _duration);
      document.getElementById('time-current').textContent = fmtTime(ms);
    }
  };
  progressBar.onchange = function() {
    document.body.classList.remove('seeking');
    if (_duration > 0) {
      var ms = Math.round((progressBar.value / 1000) * _duration);
      window.external.invoke(JSON.stringify({cmd: 'seek', ms: ms}));
    }
    _seeking = false;
  };

  /* ── keyboard shortcuts ── */
  document.addEventListener('keydown', function(e) {
    var meta = e.metaKey || e.ctrlKey;
    if (e.code === 'Space' && !meta) {
      e.preventDefault();
      window.external.invoke(JSON.stringify({cmd: _playing ? 'pause' : 'play'}));
    } else if (e.code === 'ArrowLeft' && !meta) {
      e.preventDefault();
      window.external.invoke(JSON.stringify({cmd: 'seekBack'}));
    } else if (e.code === 'ArrowRight' && !meta) {
      e.preventDefault();
      window.external.invoke(JSON.stringify({cmd: 'seekFwd'}));
    } else if ((e.code === 'ArrowUp' || e.key === 'ArrowUp') && !meta) {
      e.preventDefault();
      if (_lines.length > 0) {
        var idx = _activeIdx > 0 ? _activeIdx - 1 : 0;
        window.external.invoke(JSON.stringify({cmd: 'seek', ms: _lines[idx].timeStartMs}));
      }
    } else if ((e.code === 'ArrowDown' || e.key === 'ArrowDown') && !meta) {
      e.preventDefault();
      if (_lines.length > 0) {
        var idx = _activeIdx >= 0 && _activeIdx < _lines.length - 1 ? _activeIdx + 1 : _lines.length - 1;
        window.external.invoke(JSON.stringify({cmd: 'seek', ms: _lines[idx].timeStartMs}));
      }
    } else if (meta && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
      e.preventDefault();
      setLrcSize(_lrcSize + 10);
    } else if (meta && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
      e.preventDefault();
      setLrcSize(_lrcSize - 10);
    } else if (meta && e.code === 'Digit0') {
      e.preventDefault();
      setLrcSize(100);
    } else if (e.code === 'Escape') {
      hidePopup();
    } else if (e.code === 'Enter' && !meta) {
      e.preventDefault();
      if (_lines.length > 0 && _activeIdx >= 0 && _activeIdx < _lines.length) {
        window.external.invoke(JSON.stringify({cmd: 'seek', ms: _lines[_activeIdx].timeStartMs}));
      }
    }
  }, true);

  setInterval(pollState, 400);
  pollState();
</script>
</body>
</html>
"""

proc buildHtml(): string =
  let cfg = loadConfig()
  let lrcSize = cfg["lrcSize"].getInt()
  let initialState = buildResumeState(cfg)
  var recentJson = newJArray()
  for p in loadRecent():
    recentJson.add(%p)
  var config = newJObject()
  config["lrcSize"] = %lrcSize
  config["recent"] = recentJson
  config["initialState"] = initialState
  let configJson = ($config).replace("</", "<\\/")

  result = PlayerHtml & """
<script>
document.addEventListener('DOMContentLoaded', function() {
  initApp(""" & configJson & """);
});
</script>
"""

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
  var w = newWebView(windowTitle, url, 800, 600, true, false, handleMessage)
  if w.isNil:
    echo "Failed to create webview"
    quit(1)

  w.run()

  saveCurrentPlaybackState()

  removeFile(htmlPath)

when isMainModule:
  main()
