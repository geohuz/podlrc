function removeNoadNoise(doc) {
  doc.querySelectorAll('.usage, .usg, .etym, .ety, .origin, [class*="usage"], [class*="origin"]').forEach(function(node) {
    node.remove();
  });
  Array.from(doc.querySelectorAll('*')).forEach(function(node) {
    var tag = node.tagName || '';
    var cls = String(node.className || '');
    if (!/^H[1-6]$/.test(tag) && !/(title|heading|header|label)/i.test(cls)) return;
    var heading = dictionaryNodeText(node);
    if (!/^(usage|origin)$/i.test(heading)) return;
    var container = node.closest('section, .entry, .block, .note, .subEntry, div') || node.parentElement;
    if (container) container.remove();
  });
}

function firstNoadText(doc, selectors) {
  for (var i = 0; i < selectors.length; i++) {
    var text = dictionaryNodeText(doc.querySelector(selectors[i]));
    if (text) return text;
  }
  return '';
}

function formatNoadDefinition(doc, word) {
  removeNoadNoise(doc);
  var html = '';
  var headword = firstNoadText(doc, ['.hw', 'h1', '[class*="headword"]']) || word;
  var pron = firstNoadText(doc, ['.pr .ph', '.prx .ph', '.ph', '[class*="pron"]']);
  var pos = firstNoadText(doc, ['.pos']);
  if (headword || pron) {
    html += '<div class="dict-head">';
    if (headword) html += '<span class="dict-headword">' + esc(headword) + '</span>';
    if (pron) html += '<span class="dict-pron">' + esc(pron) + '</span>';
    html += '</div>';
  }
  if (pos) html += '<div class="dict-pos">' + esc(pos) + '</div>';

  var definitions = Array.from(doc.querySelectorAll('.df, [class~="df"]'));
  var seen = {};
  definitions.forEach(function(node, index) {
    var text = dictionaryNodeText(node);
    if (!text || seen[text]) return;
    seen[text] = true;
    html += '<div class="dict-sense"><div class="dict-main"><span class="dict-number">' +
      esc(String(index + 1)) + '</span>' + esc(text) + '</div></div>';
  });

  if (!html || definitions.length === 0) {
    html += formatPlainDictionaryDefinition('', word, doc);
  }
  return html;
}

var noadFormatter = {
  id: 'noad',
  label: 'NOAD',
  description: 'New Oxford American Dictionary',
  matches: function(doc) {
    return !!doc.querySelector('.hw, .df, .sg, .pr, .x_xd0, .x_xd1');
  },
  format: formatNoadDefinition
};
