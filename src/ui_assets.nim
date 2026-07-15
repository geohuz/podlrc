import std/strutils

const
  IndexHtml = staticRead("ui/index.html")
  StylesCss = staticRead("ui/styles.css")
  AppJs = staticRead("ui/app.js")
  DictionaryFormattersJs =
    staticRead("dictionary_formatters/common.js") & "\n" &
    staticRead("dictionary_formatters/noad.js") & "\n" &
    staticRead("dictionary_formatters/oaldpe_apple.js") & "\n" &
    staticRead("dictionary_formatters.js")

proc buildPlayerHtml*(configJson: string): string =
  let safeConfigJson = configJson.replace("</", "<\\/")
  let appJs = AppJs.replace(
    "/* PODLRC_DICTIONARY_FORMATTERS */", DictionaryFormattersJs)
  result = IndexHtml
    .replace("/* PODLRC_STYLES */", StylesCss)
    .replace("/* PODLRC_APP */", appJs)
    .replace("/* PODLRC_CONFIG */", safeConfigJson)
