import std/[assertions, strutils]

import ui_assets

block assembles_embedded_player:
  let html = buildPlayerHtml("""{"probe":"</script>"}""")

  doAssert html.startsWith("<!DOCTYPE html>")
  doAssert "/* PODLRC_STYLES */" notin html
  doAssert "/* PODLRC_VAN */" notin html
  doAssert "/* PODLRC_VANX */" notin html
  doAssert "/* PODLRC_APP */" notin html
  doAssert "/* PODLRC_CONFIG */" notin html
  doAssert "/* PODLRC_DICTIONARY_FORMATTERS */" notin html
  doAssert "var dictionaryFormatterRegistry" in html
  doAssert "function esc(value)" in html
  doAssert "macOS-normalized-html-v1:oaldpe-apple" in html
  doAssert "window.van=O" in html
  doAssert "window.vanX=" in html
  doAssert "VanJS 1.6.0" in html
  doAssert "queueMicrotask" in html
  doAssert html.find("window.van=O") < html.find("var tags = van.tags")
  doAssert html.find("window.vanX=") < html.find("var app = vanX.reactive")
  doAssert "runtime: vanX.noreactive" in html
  doAssert "van.tags('http://www.w3.org/2000/svg')" in html
  doAssert html.count("window.external.invoke") == 1
  doAssert "lrcContainer.addEventListener('click'" in html
  doAssert "function RecentDropdown" in html
  doAssert "function VocabularyPanel" in html
  doAssert "function MainContent" in html
  doAssert "function Playbar" in html
  doAssert "function setDictionaryPopup" in html
  doAssert "function bindReactiveUi" in html
  doAssert "onclick: toggleRecentDropdown" in html
  doAssert "oninput: onProgressInput" in html
  doAssert "windowWidth: window.innerWidth" in html
  doAssert "id: 'audio-player'" in html
  doAssert "function loadAudio(path, position)" in html
  doAssert "sendCommand('savePlaybackState'" in html
  doAssert "app.runtime.player.audio.currentTime = lyric.timeStartMs / 1000" in html
  doAssert "setInterval(persistPlaybackPosition, 5000)" in html
  doAssert "sendCommand('seek'" notin html
  doAssert "van.derive" notin html
  doAssert "btn.style.display" notin html
  doAssert "delete app.runtime.vocabulary.definitionRequests" notin html
  doAssert "insertAdjacentHTML" notin html
  doAssert "<\\/script>" in html
