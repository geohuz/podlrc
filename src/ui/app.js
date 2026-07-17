// VanJS 1.6.0 is vendored with the application so the UI remains offline.
var tags = van.tags;
var div = tags.div;
var span = tags.span;
var button = tags.button;
var input = tags.input;
var audioTag = tags.audio;
var svgTags = van.tags('http://www.w3.org/2000/svg');
var svg = svgTags.svg;
var path = svgTags.path;
var polygon = svgTags.polygon;
var group = svgTags.g;
var line = svgTags.line;
var rect = svgTags.rect;

// One application state root: presentation fields are reactive, while runtime
// bookkeeping is kept as one plain object that VanX never proxies.
var app = vanX.reactive({
  player: {loaded: false, playing: false, position: 0, duration: 0, volume: 80, seeking: false, volumeDragging: false},
  recent: {files: [], open: false},
  vocabulary: {entries: [], total: 0, filter: 'current', open: false, expanded: ''},
  dictionary: {visible: false, word: '', definition: '', loading: false, left: 0, top: 0},
  zoomHint: {text: 'Font: 100%', visible: false},
  runtime: vanX.noreactive({
    player: {
      lines: [],
      activeIndex: -1,
      lrcSize: 100,
      currentFile: '',
      audio: null,
      pendingPosition: 0
    },
    recent: {
      files: []
    },
    vocabulary: {
      words: {},
      filter: 'current',
      definitionRequests: {},
      hydrationRunning: false,
      pendingSaves: {}
    },
    ui: {
      hintTimer: null,
      windowSizeTimer: null
    },
    dictionary: {
      requests: {},
      nextRequestId: 1,
      visibleWord: ''
    }
  })
});

function sendCommand(cmd, payload) {
  var message = Object.assign({}, payload || {});
  message.cmd = cmd;
  window.external.invoke(JSON.stringify(message));
}

function fmtTime(ms) {
  if (ms <= 0) return '00:00';
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  return m.toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0');
}

function mount(container, component) {
  container.replaceChildren();
  van.add(container, component);
}

function closestEventTarget(event, selector) {
  var target = event.target;
  if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
  return target && target.closest ? target.closest(selector) : null;
}

function podcastTitle(path) {
  if (!path) return 'Current';
  return path.split('/').pop().replace(/\.[^.]+$/i, '') || 'Current';
}

function RecentDropdown() {
  return div({id: 'recent-dropdown', class: function() {
    return app.recent.open ? 'open' : '';
  }}, function() {
    return div(
      div({class: 'rd-header'}, 'Recent Files'),
      div({class: 'recent-items'}, app.recent.files.map(function(path, index) {
        var slash = path.lastIndexOf('/');
        return div({class: 'recent-item', onclick: function() {
          clearWordPopup();
          sendCommand('openRecent', {path: path});
          app.recent.open = false;
        }},
          span({class: 'ri-name'}, path.slice(slash + 1).replace(/\.mp3$/i, '')),
          span({class: 'ri-path'}, slash >= 0 ? path.slice(0, slash) : '')
        );
      }))
    );
  });
}

function VocabularyDefinition(entry) {
  var definition = span({class: 'wp-definition'});
  var formatted = formatDictionaryDefinition(entry.definition, entry.word);
  if (formatted) {
    definition.innerHTML = formatted;
  } else {
    definition.textContent = 'Looking up definition...';
  }
  return definition;
}

function VocabularyItem(entry) {
  return div({class: function() {
    return app.vocabulary.expanded === entry.word ? 'wp-item expanded' : 'wp-item';
  }, onclick: function() {
    clearWordPopup();
    sendCommand('openWordRef', {file: entry.file, ms: entry.timeMs});
    app.vocabulary.open = false;
  }},
    span({class: 'wp-toggle', title: 'Expand definition', onclick: function(event) {
      event.stopPropagation();
      app.vocabulary.expanded = app.vocabulary.expanded === entry.word ? '' : entry.word;
    }}, '\u25b6'),
    span({class: 'wp-word'}, entry.word),
    VocabularyDefinition(entry),
    span({class: 'wp-del', title: 'Remove from Vocabulary', onclick: function(event) {
      event.stopPropagation();
      sendCommand('removeWord', {word: entry.word});
    }}, '\u00d7')
  );
}

function VocabularyPanel() {
  return div({id: 'word-panel', class: function() {
    return app.vocabulary.open ? 'open' : '';
  }}, function() {
    var entries = app.vocabulary.entries;
    var title = podcastTitle(app.runtime.player.currentFile);
    var filter = app.vocabulary.filter;
    return div({class: 'wp-list'},
      div({class: 'wp-header'},
        div({class: 'rd-header'}, 'Vocabulary'),
        div({class: 'wp-filter'},
          button({type: 'button', title: title, onclick: function() {
            setWordFilter(null, 'current');
          }, class: filter === 'current' ? 'active' : ''}, title),
          button({type: 'button', onclick: function() {
            setWordFilter(null, 'all');
          }, class: filter === 'all' ? 'active' : ''}, 'All')
        )
      ),
      div({class: 'wp-empty', hidden: entries.length !== 0}, 'No saved words for this podcast.'),
      div({class: 'wp-items'}, entries.map(VocabularyItem))
    );
  });
}

function LyricWord(word, offset) {
  return span({class: 'word', 'data-word': word, 'data-offset': String(offset)}, word);
}

function LyricLine(line, index) {
  return div({class: 'lrc-line', 'data-index': String(index)},
    span({class: 'lrc-time'}, fmtTime(line.timeStartMs)),
    span({class: 'lrc-text'}, buildWordNodes(line.text))
  );
}

function PopupDefinition(definition) {
  var content = div({class: 'dd'});
  content.innerHTML = definition;
  return content;
}

function DictionaryPopup() {
  return div({id: 'dict-popup', class: function() {
    return app.dictionary.visible ? 'visible' : '';
  }, style: function() {
    return 'left:' + app.dictionary.left + 'px;top:' + app.dictionary.top + 'px';
  }}, div({class: 'dict-popup-content'}, function() {
    if (app.dictionary.loading) {
      return div(div({class: 'dw'}, app.dictionary.word), div({class: 'dm'}, 'Looking up...'));
    }
    if (app.dictionary.definition) {
      return div(div({class: 'dw'}, app.dictionary.word), PopupDefinition(app.dictionary.definition));
    }
    return div(div({class: 'dw'}, app.dictionary.word), div({class: 'dm'}, 'No definition found'));
  }));
}

function TitleBar() {
  return div({id: 'title-bar'},
    button({id: 'btn-open', onclick: openFile}, 'Open File'),
    button({id: 'btn-recent', style: function() {
      return app.recent.files.length === 0 ? 'display:none' : '';
    }, onclick: toggleRecentDropdown}, 'Recent'),
    button({id: 'btn-words', style: function() {
      return app.vocabulary.total === 0 ? 'display:none' : '';
    }, onclick: toggleWordPanel}, 'Vocabulary'),
    RecentDropdown(),
    VocabularyPanel(),
    span({id: 'zoom-hint', class: function() {
      return app.zoomHint.visible ? 'show' : '';
    }}, function() { return app.zoomHint.text; })
  );
}

function MainContent() {
  return [
    div({id: 'empty-state', class: function() {
      return app.player.loaded ? 'hidden' : '';
    }},
      svg({viewBox: '0 0 24 24', fill: 'currentColor', opacity: '0.35'},
        path({d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z'})
      ),
      div({class: 'hint'}, 'Open an MP3 + LRC file to start'),
      div({style: 'margin-top:8px;font-size:13px;color:#444'}, function() {
        var names = app.recent.files.slice(0, 3).map(function(file) {
          return file.split('/').pop().replace(/\.mp3$/i, '');
        });
        return names.length > 0 ? 'Recent: ' + names.join(' \u00b7 ') : '';
      })
    ),
    div({id: 'lrc-container', class: function() {
      return app.player.loaded ? '' : 'hidden';
    }})
  ];
}

function progressValue() {
  return app.player.duration > 0 ? Math.round((app.player.position / app.player.duration) * 1000) : 0;
}

function progressStyle() {
  var pct = Math.min(100, progressValue() / 10).toFixed(1);
  return 'background:linear-gradient(to right, #777 0%, #777 ' + pct + '%, #404040 ' + pct + '%)';
}

function volumeStyle() {
  var volume = app.player.volume;
  return 'background:linear-gradient(to right, #999 0%, #999 ' + volume + '%, #404040 ' + volume + '%)';
}

function PlayIcon() {
  return svg({viewBox: '0 0 24 24', fill: 'currentColor'},
    path({d: 'M8 5.14v14l11-7-11-7z', style: function() {
      return app.player.playing ? 'display:none' : '';
    }}),
    group({style: function() { return app.player.playing ? '' : 'display:none'; }},
      rect({x: '6', y: '4', width: '4', height: '16', rx: '1.2'}),
      rect({x: '14', y: '4', width: '4', height: '16', rx: '1.2'})
    )
  );
}

function VolumeIcon() {
  return svg({viewBox: '0 0 24 24', fill: 'currentColor', width: '16', height: '16', style: 'flex-shrink:0;opacity:0.5'},
    polygon({points: '11,5 6,9 2,9 2,15 6,15 11,19'}),
    group({style: function() { return app.player.volume === 0 ? 'display:none' : ''; }},
      path({d: 'M15.54 8.46a5 5 0 010 7.07'})
    ),
    group({style: function() { return app.player.volume >= 30 ? '' : 'display:none'; }},
      path({d: 'M19.07 4.93a10 10 0 010 14.14'})
    ),
    group({style: function() { return app.player.volume === 0 ? '' : 'display:none'; }},
      line({x1: '23', y1: '9', x2: '17', y2: '15', stroke: 'currentColor', 'stroke-width': '2'}),
      line({x1: '17', y1: '9', x2: '23', y2: '15', stroke: 'currentColor', 'stroke-width': '2'})
    )
  );
}

function onProgressInput(event) {
  app.player.seeking = true;
  var position = app.player.duration > 0 ? Math.round((event.target.value / 1000) * app.player.duration) : 0;
  app.player.position = position;
}

function finishProgressDrag(event) {
  var position = app.player.duration > 0 ? Math.round((event.target.value / 1000) * app.player.duration) : 0;
  app.player.position = position;
  app.player.seeking = false;
  if (app.runtime.player.audio && app.player.duration > 0) {
    app.runtime.player.audio.currentTime = position / 1000;
    persistPlaybackPosition();
  }
}

function onVolumeInput(event) {
  app.player.volume = Number(event.target.value);
  if (app.runtime.player.audio) app.runtime.player.audio.volume = app.player.volume / 100;
}

function updateActiveLine(positionMs) {
  var index = findActiveIndex(app.runtime.player.lines, positionMs);
  if (index === app.runtime.player.activeIndex) return;
  var container = document.getElementById('lrc-container');
  var previous = container.querySelector('.lrc-line.active');
  if (previous) previous.classList.remove('active');
  app.runtime.player.activeIndex = index;
  if (index >= 0 && index < container.children.length) {
    var line = container.children[index];
    line.classList.add('active');
    line.scrollIntoView({block: 'center', behavior: 'smooth'});
  }
}

function findActiveIndex(lines, positionMs) {
  var index = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].timeStartMs > positionMs) break;
    index = i;
  }
  return index;
}

function persistPlaybackPosition() {
  var audio = app.runtime.player.audio;
  if (!audio || !app.runtime.player.currentFile) return;
  sendCommand('savePlaybackState', {
    file: app.runtime.player.currentFile,
    position: Math.round(audio.currentTime * 1000)
  });
}

function onAudioTimeUpdate() {
  var audio = app.runtime.player.audio;
  if (!audio || app.player.seeking) return;
  app.player.position = Math.round(audio.currentTime * 1000);
  updateActiveLine(app.player.position);
}

function onAudioMetadata() {
  var audio = app.runtime.player.audio;
  app.player.duration = Math.round(audio.duration * 1000);
  if (app.runtime.player.pendingPosition > 0) {
    audio.currentTime = app.runtime.player.pendingPosition / 1000;
    app.runtime.player.pendingPosition = 0;
  }
}

function onAudioPlay() { app.player.playing = true; }
function onAudioPause() {
  app.player.playing = false;
  persistPlaybackPosition();
}
function onAudioEnded() {
  app.player.playing = false;
  persistPlaybackPosition();
}
function onAudioVolume() {
  if (app.runtime.player.audio) app.player.volume = Math.round(app.runtime.player.audio.volume * 100);
}

function AudioPlayer() {
  var audio = audioTag({id: 'audio-player', preload: 'metadata',
    onloadedmetadata: onAudioMetadata,
    ontimeupdate: onAudioTimeUpdate,
    onplay: onAudioPlay,
    onpause: onAudioPause,
    onended: onAudioEnded,
    onvolumechange: onAudioVolume
  });
  app.runtime.player.audio = audio;
  return audio;
}

function fileUrl(path) {
  return 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function loadAudio(path, position) {
  var audio = app.runtime.player.audio;
  if (!audio || !path) return;
  var url = fileUrl(path);
  audio.pause();
  audio.src = url;
  audio.volume = app.player.volume / 100;
  app.runtime.player.pendingPosition = position || 0;
  audio.load();
}

function Playbar() {
  return div({id: 'playbar', class: function() {
    var classes = [];
    if (!app.player.loaded) classes.push('hidden');
    if (app.player.seeking) classes.push('seeking');
    if (app.player.volumeDragging) classes.push('volume-dragging');
    return classes.join(' ');
  }},
    AudioPlayer(),
    button({class: 'btn-sm', title: 'Back 10s', onclick: function() {
      var audio = app.runtime.player.audio;
      if (audio) audio.currentTime = Math.max(audio.currentTime - 10, 0);
    }},
      svg({viewBox: '0 0 24 24', fill: 'currentColor'}, polygon({points: '13,6 7,12 13,18'}), polygon({points: '19,6 19,18 13,12', opacity: '0.5'}))
    ),
    button({class: 'btn-lg', title: function() { return app.player.playing ? 'Pause' : 'Play'; }, onclick: function() {
      var audio = app.runtime.player.audio;
      if (!audio) return;
      if (audio.paused) audio.play(); else audio.pause();
    }}, PlayIcon()),
    button({class: 'btn-sm', title: 'Forward 10s', onclick: function() {
      var audio = app.runtime.player.audio;
      if (audio) audio.currentTime = Math.min(audio.currentTime + 10, audio.duration || audio.currentTime + 10);
    }},
      svg({viewBox: '0 0 24 24', fill: 'currentColor'}, polygon({points: '11,6 17,12 11,18'}), polygon({points: '5,6 5,18 11,12', opacity: '0.5'}))
    ),
    div({id: 'progress-group'},
      span({class: 'time-label'}, function() { return fmtTime(app.player.position); }),
      input({type: 'range', id: 'progress-bar', min: '0', max: '1000', value: function() { return progressValue(); }, style: progressStyle, oninput: onProgressInput, onchange: finishProgressDrag}),
      span({class: 'time-label'}, function() { return fmtTime(app.player.duration); })
    ),
    div({id: 'volume-container'},
      VolumeIcon(),
      input({type: 'range', id: 'volume-bar', min: '0', max: '100', value: function() { return app.player.volume; }, style: volumeStyle, onmousedown: function() { app.player.volumeDragging = true; }, oninput: onVolumeInput})
    )
  );
}

/* ── recent files ── */
function renderRecentDropdown() {
  if (app.runtime.recent.files.length === 0) {
    app.recent.open = false;
    app.recent.files = [];
    return;
  }
  app.recent.files = app.runtime.recent.files;
}

function updateRecent(recent) {
  app.runtime.recent.files = recent || [];
  renderRecentDropdown();
}

function toggleRecentDropdown(e) {
  e.stopPropagation();
  clearWordPopup();
  app.vocabulary.open = false;
  app.recent.open = !app.recent.open;
}

function openFile() {
  clearWordPopup();
  app.recent.open = false;
  app.vocabulary.open = false;
  sendCommand('open');
}

/* ── saved words ── */
function wordKey(word) {
  return (word || '').toLowerCase();
}

function isSavedWord(word) {
  return Object.prototype.hasOwnProperty.call(app.runtime.vocabulary.words, wordKey(word));
}

function updateWordPanel(words) {
  app.runtime.vocabulary.words = {};
  (words || []).forEach(function(w) {
    var key = wordKey(w.word);
    app.runtime.vocabulary.words[key] = w;
    delete app.runtime.vocabulary.pendingSaves[key];
  });
  renderWordPanel();
  updateWordHighlights();
  hydrateMissingDefinitions();
}

function renderWordPanel() {
  var allEntries = Object.values(app.runtime.vocabulary.words);
  app.vocabulary.total = allEntries.length;
  if (allEntries.length === 0) {
    app.vocabulary.open = false;
    app.vocabulary.entries = [];
    return;
  }
  var entries = allEntries;
  if (app.runtime.vocabulary.filter === 'current') {
    entries = allEntries.filter(function(e) { return e.file === app.runtime.player.currentFile; });
  }
  entries.sort(function(a, b) { return a.word.localeCompare(b.word); });
  app.vocabulary.entries = entries;
}

function setWordFilter(ev, filter) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  app.runtime.vocabulary.filter = filter === 'all' ? 'all' : 'current';
  app.vocabulary.filter = app.runtime.vocabulary.filter;
  renderWordPanel();
}

function requestDictionaryDefinition(word, context, offset) {
  return new Promise(function(resolve) {
    var id = app.runtime.dictionary.nextRequestId++;
    app.runtime.dictionary.requests[id] = {resolve: resolve, word: word};
    setTimeout(function() {
      var payload = {id: id, word: word};
      if (context !== undefined && context !== null) payload.context = context;
      if (offset !== undefined && offset !== null) payload.offset = offset;
      sendCommand('lookupWord', payload);
    }, 0);
  });
}

/* PODLRC_DICTIONARY_FORMATTERS */
function resolveDictionaryLookup(response) {
  var request = app.runtime.dictionary.requests[response.id];
  delete app.runtime.dictionary.requests[response.id];
  if (!request) return;

  var definition = response.definition || '';
  if (app.runtime.dictionary.visibleWord === request.word) {
    var normalized = normalizeDictionaryDefinition(definition, request.word);
    setDictionaryPopup({
      definition: normalized.definition,
      loading: false
    });
  }
  request.resolve(definition);
}

function needsDefinitionHydration(entry) {
  if (!entry.definition) return true;
  return entry.source === 'macOS-normalized-html-v1:oaldpe-apple' &&
    entry.definition.indexOf('class="dict-head"') < 0;
}

function hydrateMissingDefinitions() {
  if (app.runtime.vocabulary.hydrationRunning) return;
  var entries = Object.values(app.runtime.vocabulary.words).filter(function(entry) {
    return needsDefinitionHydration(entry) &&
      !app.runtime.vocabulary.definitionRequests[wordKey(entry.word)];
  });
  if (entries.length === 0) return;

  app.runtime.vocabulary.hydrationRunning = true;
  function hydrateNext(index) {
    if (index >= entries.length) {
      app.runtime.vocabulary.hydrationRunning = false;
      hydrateMissingDefinitions();
      return;
    }
    var entry = entries[index];
    var key = wordKey(entry.word);
    app.runtime.vocabulary.definitionRequests[key] = true;
    requestDictionaryDefinition(entry.word).then(function(definition) {
      if (!definition) return;
      var normalized = normalizeDictionaryDefinition(definition, entry.word);
      sendCommand('setWordDefinition', {
        word: entry.word,
        definition: normalized.definition,
        source: normalized.source,
        file: entry.file,
        timeMs: entry.timeMs
      });
    }).then(function() {
      hydrateNext(index + 1);
    }, function() {
      // A failed hydration stays marked for this session to avoid a retry loop.
      hydrateNext(index + 1);
    });
  }
  hydrateNext(0);
}

function updateWordHighlights() {
  document.querySelectorAll('.lrc-line').forEach(function(lineEl, lineIdx) {
    lineEl.querySelectorAll('.word').forEach(function(el) {
      var word = el.getAttribute('data-word') || el.textContent.trim();
      var saved = wordKey(word) !== '' && isSavedWord(word);
      el.classList.toggle('saved', saved);
      var remove = el.querySelector('.word-remove');
      if (saved && !remove) {
        el.appendChild(span({class: 'word-remove', title: 'Remove from Vocabulary'}, '\u00d7'));
      } else if (!saved && remove) {
        remove.remove();
      }
    });
  });
}

function toggleWordPanel(e) {
  e.stopPropagation();
  clearWordPopup();
  app.recent.open = false;
  var opening = !app.vocabulary.open;
  if (opening) {
    app.runtime.vocabulary.filter = 'current';
    app.vocabulary.filter = 'current';
    renderWordPanel();
  }
  app.vocabulary.open = opening;
}

/* ── word splitting ── */
function buildWordNodes(text) {
  var fragment = document.createDocumentFragment();
  var re = /([a-zA-Z0-9'\-]+)/g;
  var idx = 0, m;
  while ((m = re.exec(text)) !== null) {
    fragment.appendChild(document.createTextNode(text.substring(idx, m.index)));
    fragment.appendChild(LyricWord(m[1], m.index));
    idx = m.index + m[1].length;
  }
  fragment.appendChild(document.createTextNode(text.substring(idx)));
  return fragment;
}

function renderLines(lines) {
  app.runtime.player.lines = lines;
  app.runtime.player.activeIndex = -1;
  var container = document.getElementById('lrc-container');
  mount(container, lines.map(LyricLine));
  updateWordHighlights();
}

/* ── dictionary popup ── */
function setDictionaryPopup(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'visible')) {
    app.dictionary.visible = patch.visible;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'word')) {
    app.dictionary.word = patch.word;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'definition')) {
    app.dictionary.definition = patch.definition;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'loading')) {
    app.dictionary.loading = patch.loading;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'left')) {
    app.dictionary.left = patch.left;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'top')) {
    app.dictionary.top = patch.top;
  }
}

function showPopup(word, x, y) {
  app.runtime.dictionary.visibleWord = word;
  setDictionaryPopup({
    visible: true,
    word: word,
    definition: '',
    loading: true,
    left: x,
    top: y
  });
}

function hidePopup() {
  setDictionaryPopup({visible: false, loading: false});
  app.runtime.dictionary.visibleWord = '';
}

function clearWordPopup() {
  hidePopup();
  document.querySelectorAll('.word.selected').forEach(function(w) {
    w.classList.remove('selected');
  });
  window.getSelection().removeAllRanges();
}

function lookupWord(word, context, offset) {
  return requestDictionaryDefinition(word, context, offset).then(function(definition) {
    var normalized = normalizeDictionaryDefinition(definition, word);
    var displayDefinition = normalized.definition;
    if (app.runtime.dictionary.visibleWord === word) {
      setDictionaryPopup({definition: displayDefinition, loading: false});
    }
    return normalized;
  });
}

function onWordClick(el, event) {
  var word = el.getAttribute('data-word') || el.textContent.trim();
  var shouldClosePopup = app.dictionary.visible &&
    app.runtime.dictionary.visibleWord === word && el.classList.contains('selected');
  if (shouldClosePopup) {
    hidePopup();
    el.classList.remove('selected');
    window.getSelection().removeAllRanges();
    event.preventDefault();
    return;
  }

  document.querySelectorAll('.word.selected').forEach(function(w) {
    w.classList.remove('selected');
  });
  el.classList.add('selected');

  var sel = window.getSelection();
  var range = document.createRange();
  range.selectNodeContents(el.firstChild || el);
  sel.removeAllRanges();
  sel.addRange(range);

  var rect = el.getBoundingClientRect();
  var popW = 360;
  var left = Math.min(rect.left + window.scrollX, window.innerWidth - popW - 20);
  left = Math.max(left, 20);
  var top = rect.bottom + window.scrollY + 4;
  if (top + 200 > window.innerHeight) {
    top = rect.top + window.scrollY - 210;
  }
  showPopup(word, left, top);

  var lineEl = el.closest('.lrc-line');
  var lineIdx = lineEl ? parseInt(lineEl.dataset.index) : -1;
  if (lineIdx >= 0 && lineIdx < app.runtime.player.lines.length) {
    var timeMs = app.runtime.player.lines[lineIdx].timeStartMs;
    var lineText = app.runtime.player.lines[lineIdx].text || '';
    var wordOffset = parseInt(el.getAttribute('data-offset'));
    if (isNaN(wordOffset)) wordOffset = 0;
    var key = wordKey(word);
    if (isSavedWord(word)) {
      lookupWord(word, lineText, wordOffset);
    } else if (app.runtime.vocabulary.pendingSaves[key]) {
      lookupWord(word, lineText, wordOffset);
    } else {
      app.runtime.vocabulary.pendingSaves[key] = true;
      lookupWord(word, lineText, wordOffset).then(function(normalized) {
        if (!normalized.definition) {
          delete app.runtime.vocabulary.pendingSaves[key];
          return;
        }
        sendCommand('addWord', {
          word: word,
          definition: normalized.definition,
          source: normalized.source,
          file: app.runtime.player.currentFile,
          timeMs: timeMs
        });
      });
    }
  } else {
    lookupWord(word);
  }

  event.preventDefault();
}

function bindReactiveUi() {
  mount(document.getElementById('title-bar-host'), TitleBar());
  mount(document.getElementById('content-host'), MainContent());
  mount(document.getElementById('dictionary-popup-host'), DictionaryPopup());
  mount(document.getElementById('playbar-host'), Playbar());
}

bindReactiveUi();

var lrcContainer = document.getElementById('lrc-container');
lrcContainer.addEventListener('click', function(event) {
  var line = closestEventTarget(event, '.lrc-line');
  if (!line || !lrcContainer.contains(line)) return;
  var lineIndex = parseInt(line.dataset.index);
  var lyric = app.runtime.player.lines[lineIndex];
  if (!lyric) return;

  if (closestEventTarget(event, '.lrc-time')) {
    event.stopPropagation();
    clearWordPopup();
    if (app.runtime.player.audio) app.runtime.player.audio.currentTime = lyric.timeStartMs / 1000;
    persistPlaybackPosition();
    return;
  }

  var word = closestEventTarget(event, '.word');
  if (!word) return;
  event.stopPropagation();
  if (closestEventTarget(event, '.word-remove')) {
    sendCommand('removeWord', {
      word: word.dataset.word || word.textContent.trim()
    });
    return;
  }
  onWordClick(word, event);
});

document.addEventListener('click', function(e) {
  if (!e.target.closest('.word')) {
    clearWordPopup();
  }
  // Close dropdowns on outside click
  if (!e.target.closest('#btn-recent') && !e.target.closest('#recent-dropdown')) {
    app.recent.open = false;
  }
  if (!e.target.closest('#btn-words') && !e.target.closest('#word-panel')) {
    app.vocabulary.open = false;
  }
});

window.addEventListener('resize', function() {
  clearTimeout(app.runtime.ui.windowSizeTimer);
  app.runtime.ui.windowSizeTimer = setTimeout(function() {
    sendCommand('saveConfig', {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight
    });
  }, 250);
});

/* ── font size zoom ── */
function setLrcSize(pct, persist) {
  app.runtime.player.lrcSize = Math.max(60, Math.min(200, pct));
  document.documentElement.style.setProperty('--lrc-size', (app.runtime.player.lrcSize * 0.16).toFixed(1) + 'px');
  app.zoomHint.text = 'Font: ' + app.runtime.player.lrcSize + '%';
  app.zoomHint.visible = true;
  clearTimeout(app.runtime.ui.hintTimer);
  app.runtime.ui.hintTimer = setTimeout(function() { app.zoomHint.visible = false; }, 1800);
  if (persist !== false) {
    sendCommand('saveConfig', {lrcSize: app.runtime.player.lrcSize});
  }
}

/* ── init from host ── */
function initApp(config) {
  if (config.lrcSize) {
    setLrcSize(config.lrcSize, false);
  }
  if (config.recent) {
    updateRecent(config.recent);
  }
  if (config.initialState) {
    updateState(config.initialState);
  }
  requestAnimationFrame(function() {
    setTimeout(function() {
      sendCommand('ready');
    }, 0);
  });
}

function updateState(data) {
  if (data.loaded === false) return;

  if (data.loaded === true) {
    app.player.loaded = true;
  }

  if (data.currentFile !== undefined) {
    var nextFile = data.currentFile || '';
    if (nextFile !== app.runtime.player.currentFile) {
      app.runtime.player.currentFile = nextFile;
      if (Object.keys(app.runtime.vocabulary.words).length > 0) renderWordPanel();
    }
  }

  if (data.audioPath !== undefined) {
    app.runtime.player.currentFile = data.audioPath;
    loadAudio(data.audioPath, data.position || 0);
  }

  if (data.lines !== undefined) {
    renderLines(data.lines);
    updateWordHighlights();
  }

  // Volume sync (initial only — don't fight user dragging)
  if (data.volume !== undefined && !app.player.volumeDragging) {
    app.player.volume = Math.round(data.volume * 100);
  }

  if (data.position !== undefined && !app.player.seeking && data.audioPath === undefined) {
    app.player.position = data.position;
    updateActiveLine(data.position);
  }

  if (data.recent) {
    updateRecent(data.recent);
  }
  if (data.words) {
    updateWordPanel(data.words);
  }
}

function endVolumeDrag() {
  app.player.volumeDragging = false;
}
document.addEventListener('mouseup', endVolumeDrag);
window.addEventListener('blur', endVolumeDrag);

/* ── keyboard shortcuts ── */
document.addEventListener('keydown', function(e) {
  var meta = e.metaKey || e.ctrlKey;
  if (e.code === 'Space' && !meta) {
    e.preventDefault();
    var audio = app.runtime.player.audio;
    if (audio) { if (audio.paused) audio.play(); else audio.pause(); }
  } else if (e.code === 'ArrowLeft' && !meta) {
    e.preventDefault();
    if (app.runtime.player.audio) app.runtime.player.audio.currentTime = Math.max(app.runtime.player.audio.currentTime - 10, 0);
  } else if (e.code === 'ArrowRight' && !meta) {
    e.preventDefault();
    if (app.runtime.player.audio) app.runtime.player.audio.currentTime += 10;
  } else if ((e.code === 'ArrowUp' || e.key === 'ArrowUp') && !meta) {
    e.preventDefault();
    if (app.runtime.player.lines.length > 0) {
      var idx = app.runtime.player.activeIndex > 0 ? app.runtime.player.activeIndex - 1 : 0;
      if (app.runtime.player.audio) app.runtime.player.audio.currentTime = app.runtime.player.lines[idx].timeStartMs / 1000;
    }
  } else if ((e.code === 'ArrowDown' || e.key === 'ArrowDown') && !meta) {
    e.preventDefault();
    if (app.runtime.player.lines.length > 0) {
      var idx = app.runtime.player.activeIndex >= 0 && app.runtime.player.activeIndex < app.runtime.player.lines.length - 1 ? app.runtime.player.activeIndex + 1 : app.runtime.player.lines.length - 1;
      if (app.runtime.player.audio) app.runtime.player.audio.currentTime = app.runtime.player.lines[idx].timeStartMs / 1000;
    }
  } else if (meta && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
    e.preventDefault();
    setLrcSize(app.runtime.player.lrcSize + 10);
  } else if (meta && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
    e.preventDefault();
    setLrcSize(app.runtime.player.lrcSize - 10);
  } else if (meta && e.code === 'Digit0') {
    e.preventDefault();
    setLrcSize(100);
  } else if (e.code === 'Escape') {
    hidePopup();
  } else if (e.code === 'Enter' && !meta) {
    e.preventDefault();
    if (app.runtime.player.lines.length > 0 && app.runtime.player.activeIndex >= 0 && app.runtime.player.activeIndex < app.runtime.player.lines.length) {
      if (app.runtime.player.audio) app.runtime.player.audio.currentTime = app.runtime.player.lines[app.runtime.player.activeIndex].timeStartMs / 1000;
    }
  }
}, true);

setInterval(persistPlaybackPosition, 5000);
window.addEventListener('pagehide', persistPlaybackPosition);
window.addEventListener('beforeunload', persistPlaybackPosition);
