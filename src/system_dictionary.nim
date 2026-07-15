when defined(macosx):
  {.compile("native/macos_dictionary.c", "").}

  proc podDictionaryLookup(word: cstring): cstring {.
    importc: "pod_dictionary_lookup", cdecl
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
