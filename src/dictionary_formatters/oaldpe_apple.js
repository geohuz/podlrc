function removeOaldpeNoise(doc) {
  if (!doc) return;
  doc.querySelectorAll(
    'script, style, .topic-g, [unbox="snippet"], ' +
    '[unbox="extra_examples"], [unbox="wordorigin"]'
  ).forEach(function(node) {
    node.remove();
  });
  doc.querySelectorAll('.box_title, .prefix').forEach(function(node) {
    var title = node.textContent.replace(/\s+/g, ' ').trim();
    if (/^(Oxford Collocations Dictionary|Extra Examples|Word Origin|Topics)\b/i.test(title)) {
      var container = node.closest('.collapse, .unbox, .topic-g') || node.parentElement;
      if (container) container.remove();
    }
  });
  doc.querySelectorAll('.collapse').forEach(function(node) {
    if (!node.textContent.trim()) node.remove();
  });
}

function formatOaldpeDefinition(doc, word) {
  removeOaldpeNoise(doc);
  var senses = Array.from(doc.querySelectorAll('li.sense'));
  if (senses.length === 0) return '';

  var html = '';
  var headword = dictionaryNodeText(
    doc.querySelector('.webtop > .headword, .top-container .headword, h1.headword')
  ) || word;
  var pron = dictionaryNodeText(
    doc.querySelector('.webtop > .phonetics, .top-container .phonetics')
  );
  if (headword || pron) {
    html += '<div class="dict-head">';
    if (headword) html += '<span class="dict-headword">' + esc(headword) + '</span>';
    if (pron) html += '<span class="dict-pron">' + esc(pron) + '</span>';
    html += '</div>';
  }

  html += senses.map(function(sense, index) {
    var numberNode = sense.querySelector('.iteration');
    var number = dictionaryNodeText(numberNode) ||
      sense.getAttribute('sensenum') || String(index + 1);
    var formNode = sense.querySelector('.sensetop .cf') || sense.querySelector('.cf');
    var definitionNode = sense.querySelector('.def');
    var translationNode = sense.querySelector('deft chn');
    var form = dictionaryNodeText(formNode, 'chn, labelx, xt, unxt');
    var english = dictionaryNodeText(definitionNode, 'chn, deft, xt, unxt, .sound');
    var translation = dictionaryNodeText(translationNode);
    var main = '<div class="dict-main"><span class="dict-number">' +
      esc(number) + '</span>';
    if (form) main += '<span class="dict-form">' + esc(form) + '</span>';
    main += esc(english);
    if (translation) {
      main += '<span class="dict-translation">' + esc(translation) + '</span>';
    }
    main += '</div>';

    var examples = '';
    sense.querySelectorAll('ul.examples > li').forEach(function(item) {
      var phrase = dictionaryNodeText(item.querySelector('.cf'), 'chn, labelx');
      var exampleNode = item.querySelector('.x, .unx');
      var example = dictionaryNodeText(
        exampleNode, 'chn, xt, unxt, .sound, example-audio, example-audio-ai'
      );
      var exampleTranslation = dictionaryNodeText(
        item.querySelector('xt chn, unxt chn')
      );
      if (!phrase && !example && !exampleTranslation) return;

      examples += '<div class="dict-example">';
      if (phrase) examples += '<span class="dict-form">' + esc(phrase) + '</span>';
      if (example) examples += '<span class="dict-example-en">' + esc(example) + '</span>';
      if (exampleTranslation) {
        examples += '<span class="dict-example-zh">' +
          esc(exampleTranslation) + '</span>';
      }
      examples += '</div>';
    });

    return '<div class="dict-sense">' + main + examples + '</div>';
  }).join('');
  return html;
}

var oaldpeAppleFormatter = {
  id: 'oaldpe-apple',
  label: 'OALDPE Apple',
  description: 'Oxford Advanced Learner Dictionary package for Apple Dictionary',
  matches: function(doc) {
    return !!doc.querySelector('oaldpe, .oaldpe, li.sense');
  },
  format: formatOaldpeDefinition
};
