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
  doAssert "macOS-normalized-html-v1:oaldpe-apple" in html
  doAssert "window.van=O" in html
  doAssert "window.vanX=" in html
  doAssert "VanJS 1.6.0" in html
  doAssert "queueMicrotask" in html
  doAssert html.find("window.van=O") < html.find("var tags = van.tags")
  doAssert html.find("window.vanX=") < html.find("var ui = vanX.reactive")
  doAssert html.count("window.external.invoke") == 1
  doAssert "recentDropdown.addEventListener('click'" in html
  doAssert "wordPanel.addEventListener('click'" in html
  doAssert "lrcContainer.addEventListener('click'" in html
  doAssert "function RecentDropdown" in html
  doAssert "function VocabularyPanel" in html
  doAssert "function bindReactiveUi" in html
  doAssert "insertAdjacentHTML" notin html
  doAssert "<\\/script>" in html
