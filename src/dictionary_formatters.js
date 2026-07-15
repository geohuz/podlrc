// Dictionary formatter registry.
//
// podlrc does not choose the macOS Dictionary backend. Dictionary.app's user
// order decides the lookup result; this registry only recognizes returned HTML
// shapes and converts them into podlrc's normalized vocabulary-card markup.

var dictionaryFormatterRegistry = [
  noadFormatter,
  oaldpeAppleFormatter
];

function normalizeDictionaryDefinition(definition, word) {
  if (!definition) return {definition: '', source: ''};
  if (definition.indexOf('data-podlrc-dict=') >= 0) {
    return {definition: definition, source: 'macOS-normalized-html-v1'};
  }
  var doc = null;
  if (definition.indexOf('<') >= 0) {
    doc = new DOMParser().parseFromString(definition, 'text/html');
  }
  var html = '';
  var handlerName = 'plain';
  if (doc) {
    for (var i = 0; i < dictionaryFormatterRegistry.length; i++) {
      var handler = dictionaryFormatterRegistry[i];
      if (!handler.matches(doc)) continue;
      handlerName = handler.id;
      html = handler.format(doc, word);
      break;
    }
  }
  if (!html) {
    html = formatPlainDictionaryDefinition(definition, word, doc);
  }
  return {
    definition: '<div class="dict-normalized" data-podlrc-dict="' +
      esc(handlerName) + '">' + html + '</div>',
    source: 'macOS-normalized-html-v1:' + handlerName
  };
}

function formatDictionaryDefinition(definition, word) {
  if (!definition) return '';
  if (definition.indexOf('data-podlrc-dict=') >= 0) return definition;

  return normalizeDictionaryDefinition(definition, word).definition;
}
