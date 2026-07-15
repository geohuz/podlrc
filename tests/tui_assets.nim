import std/[assertions, strutils]

import ui_assets

block assembles_embedded_player:
  let html = buildPlayerHtml("""{"probe":"</script>"}""")

  doAssert html.startsWith("<!DOCTYPE html>")
  doAssert "/* PODLRC_STYLES */" notin html
  doAssert "/* PODLRC_APP */" notin html
  doAssert "/* PODLRC_CONFIG */" notin html
  doAssert "/* PODLRC_DICTIONARY_FORMATTERS */" notin html
  doAssert "var dictionaryFormatterRegistry" in html
  doAssert "macOS-normalized-html-v1:oaldpe-apple" in html
  doAssert "id=\"word-panel-template\"" in html
  doAssert "id=\"lrc-line-template\"" in html
  doAssert "id=\"dictionary-popup-template\"" in html
  doAssert "var html = '<div class=\"rd-header\">Recent Files</div>'" notin html
  doAssert "html += '<div class=\"wp-item\" data-file='" notin html
  doAssert "insertAdjacentHTML" notin html
  doAssert "<\\/script>" in html
