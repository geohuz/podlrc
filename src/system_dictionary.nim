when defined(macosx):
  {.compile("native/macos_dictionary.c", "").}

  proc podDictionaryLookup(word: cstring): cstring {.
    importc: "pod_dictionary_lookup", cdecl
  .}
  proc podDictionaryLookupContext(
      word, context: cstring; offset: clong): cstring {.
    importc: "pod_dictionary_lookup_context", cdecl
  .}
  proc podDictionaryFree(text: cstring) {.
    importc: "pod_dictionary_free", cdecl
  .}

proc lookupDefinition*(word: string): string =
  ## Returns the first definition selected by the active macOS dictionaries.
  when defined(macosx):
    let text = podDictionaryLookup(word.cstring)
    if text != nil:
      result = $text
      podDictionaryFree(text)

proc lookupDefinition*(word, context: string; offset: int): string =
  ## Returns a definition using macOS phrase detection around offset when possible.
  when defined(macosx):
    let text = podDictionaryLookupContext(
      word.cstring, context.cstring, clong(offset))
    if text != nil:
      result = $text
      podDictionaryFree(text)
