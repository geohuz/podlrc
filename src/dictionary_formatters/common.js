function esc(value) {
  var node = document.createElement('div');
  node.textContent = value == null ? '' : String(value);
  return node.innerHTML;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeDictionarySections(text) {
  var sectionPattern = /(Oxford Collocations Dictionary(?:牛津搭配词典)?|Topics|Extra Examples(?:更多例句)?|Word Origin(?:词源)?)/;
  var boundaryPattern = /\s[2-9](?=(?:\s|\u00a0|\[|\(|[A-Za-z]))|Oxford Collocations Dictionary|Topics|Extra Examples|Word Origin|Idioms\b|Phrasal Verbs\b|(?:[a-z-]+\s+)?(?:noun|verb|adjective|adverb|combining form)\s+\//i;
  var section = sectionPattern.exec(text);

  while (section) {
    var contentStart = section.index + section[0].length;
    var tail = text.substring(contentStart);
    var boundary = boundaryPattern.exec(tail);
    text = text.substring(0, section.index) +
      (boundary ? tail.substring(boundary.index) : '');
    section = sectionPattern.exec(text);
  }
  return text;
}

function cleanDictionaryDefinition(definition, word) {
  var text = (definition || '').trim();
  if (word) {
    text = text.replace(new RegExp('^' + escapeRegExp(word) + '\\b\\s*', 'i'), '');
  }

  text = removeDictionarySections(text);

  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;；])/g, '$1')
    .trim();
}

function dictionaryNodeText(node, removeSelector) {
  if (!node) return '';
  var clone = node.cloneNode(true);
  if (removeSelector) {
    clone.querySelectorAll(removeSelector).forEach(function(child) {
      child.remove();
    });
  }
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function dictionaryPlainLines(node) {
  var blockTags = {
    ADDRESS: true, ARTICLE: true, ASIDE: true, BLOCKQUOTE: true,
    DD: true, DIV: true, DL: true, DT: true, FIGCAPTION: true,
    FIGURE: true, FOOTER: true, H1: true, H2: true, H3: true,
    H4: true, H5: true, H6: true, HEADER: true, HR: true,
    LI: true, MAIN: true, NAV: true, OL: true, P: true,
    PRE: true, SECTION: true, TABLE: true, TR: true, UL: true
  };
  var chunks = [];
  function walk(current) {
    if (current.nodeType === Node.TEXT_NODE) {
      chunks.push(current.nodeValue);
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (current.tagName === 'BR' || blockTags[current.tagName]) chunks.push('\n');
    Array.from(current.childNodes).forEach(walk);
    if (blockTags[current.tagName]) chunks.push('\n');
  }
  walk(node);
  var seen = {};
  return chunks.join('')
    .split(/\n+/)
    .map(function(line) {
      return cleanDictionaryDefinition(line, '');
    })
    .filter(function(line) {
      if (!line || seen[line]) return false;
      seen[line] = true;
      return true;
    });
}

function formatPlainDictionaryDefinition(definition, word, doc) {
  var lines = doc ? dictionaryPlainLines(doc.body) : [];
  if (lines.length === 0) {
    var fallback = doc ? doc.body.textContent : definition;
    var plain = cleanDictionaryDefinition(fallback, word);
    if (plain) lines = [plain];
  }
  return lines.slice(0, 8).map(function(line) {
    return '<div class="dict-plain-line">' + esc(line) + '</div>';
  }).join('');
}
