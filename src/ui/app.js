var state = {
  player: {
    lines: [],
    activeIndex: -1,
    duration: 0,
    playing: false,
    seeking: false,
    lrcSize: 100,
    volumeDragging: false,
    currentFile: ''
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
    hintTimer: null
  },
  dictionary: {
    requests: {},
    nextRequestId: 1,
    visibleWord: ''
  }
};

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

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function cloneTemplate(id) {
  var template = document.getElementById(id);
  return template.content.cloneNode(true);
}

function cloneTemplateElement(id) {
  return cloneTemplate(id).firstElementChild;
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

/* ── recent files ── */
function renderRecentDropdown() {
  var dd = document.getElementById('recent-dropdown');
  var btn = document.getElementById('btn-recent');
  if (state.recent.files.length === 0) {
    btn.style.display = 'none';
    dd.classList.remove('open');
    dd.replaceChildren();
    return;
  }
  btn.style.display = '';
  dd.replaceChildren(cloneTemplate('recent-dropdown-template'));
  var items = dd.querySelector('.recent-items');
  state.recent.files.forEach(function(p, i) {
    var name = p.split('/').pop().replace(/\.mp3$/i, '');
    var dir = p.substring(0, p.lastIndexOf('/'));
    var el = cloneTemplateElement('recent-item-template');
    el.dataset.index = String(i);
    el.querySelector('.ri-name').textContent = name;
    el.querySelector('.ri-path').textContent = dir;
    items.appendChild(el);
  });
}

function updateRecent(recent) {
  state.recent.files = recent || [];
  renderRecentDropdown();
  var er = document.getElementById('empty-recent');
  if (state.recent.files.length > 0) {
    var names = state.recent.files.slice(0, 3).map(function(p) {
      return p.split('/').pop().replace(/\.mp3$/i, '');
    });
    er.textContent = 'Recent: ' + names.join(' · ');
  } else {
    er.textContent = '';
  }
}

function toggleRecentDropdown(e) {
  e.stopPropagation();
  clearWordPopup();
  document.getElementById('word-panel').classList.remove('open');
  var dd = document.getElementById('recent-dropdown');
  dd.classList.toggle('open');
}

/* ── saved words ── */
function wordKey(word) {
  return (word || '').toLowerCase();
}

function isSavedWord(word) {
  return Object.prototype.hasOwnProperty.call(state.vocabulary.words, wordKey(word));
}

function updateWordPanel(words) {
  state.vocabulary.words = {};
  (words || []).forEach(function(w) {
    var key = wordKey(w.word);
    state.vocabulary.words[key] = w;
    delete state.vocabulary.pendingSaves[key];
  });
  renderWordPanel();
  updateWordHighlights();
  hydrateMissingDefinitions();
}

function renderWordPanel() {
  var panel = document.getElementById('word-panel');
  var btn = document.getElementById('btn-words');
  var allEntries = Object.values(state.vocabulary.words);
  if (allEntries.length === 0) {
    btn.style.display = 'none';
    panel.classList.remove('open');
    panel.replaceChildren();
    return;
  }
  btn.style.display = '';
  var entries = allEntries;
  if (state.vocabulary.filter === 'current') {
    entries = allEntries.filter(function(e) { return e.file === state.player.currentFile; });
  }
  entries.sort(function(a, b) { return a.word.localeCompare(b.word); });
  var title = podcastTitle(state.player.currentFile);
  var content = cloneTemplate('word-panel-template');
  var currentButton = content.querySelector('[data-filter="current"]');
  var allButton = content.querySelector('[data-filter="all"]');
  var empty = content.querySelector('.wp-empty');
  var items = content.querySelector('.wp-items');

  currentButton.textContent = title;
  currentButton.title = title;
  currentButton.classList.toggle('active', state.vocabulary.filter === 'current');
  allButton.classList.toggle('active', state.vocabulary.filter === 'all');
  empty.hidden = entries.length !== 0;

  entries.forEach(function(e) {
    var el = cloneTemplateElement('word-item-template');
    var definition = el.querySelector('.wp-definition');
    var remove = el.querySelector('.wp-del');

    el.dataset.file = e.file;
    el.dataset.ms = String(e.timeMs);
    el.querySelector('.wp-word').textContent = e.word;
    var formattedDefinition = formatDictionaryDefinition(e.definition, e.word);
    if (formattedDefinition) {
      definition.innerHTML = formattedDefinition;
    } else {
      definition.textContent = 'Looking up definition...';
    }
    remove.dataset.word = e.word;
    remove.title = 'Remove from Vocabulary';
    items.appendChild(el);
  });
  panel.replaceChildren(content);
}

function setWordFilter(ev, filter) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  state.vocabulary.filter = filter === 'all' ? 'all' : 'current';
  renderWordPanel();
}

function requestDictionaryDefinition(word, context, offset) {
  return new Promise(function(resolve) {
    var id = state.dictionary.nextRequestId++;
    state.dictionary.requests[id] = resolve;
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
  var resolve = state.dictionary.requests[response.id];
  delete state.dictionary.requests[response.id];
  if (resolve) resolve(response.definition || '');
}

function needsDefinitionHydration(entry) {
  if (!entry.definition) return true;
  return entry.source === 'macOS-normalized-html-v1:oaldpe-apple' &&
    entry.definition.indexOf('class="dict-head"') < 0;
}

function hydrateMissingDefinitions() {
  if (state.vocabulary.hydrationRunning) return;
  var entries = Object.values(state.vocabulary.words).filter(function(entry) {
    return needsDefinitionHydration(entry) &&
      !state.vocabulary.definitionRequests[wordKey(entry.word)];
  });
  if (entries.length === 0) return;

  state.vocabulary.hydrationRunning = true;
  function hydrateNext(index) {
    if (index >= entries.length) {
      state.vocabulary.hydrationRunning = false;
      hydrateMissingDefinitions();
      return;
    }
    var entry = entries[index];
    var key = wordKey(entry.word);
    state.vocabulary.definitionRequests[key] = true;
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
      delete state.vocabulary.definitionRequests[key];
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
        el.appendChild(cloneTemplateElement('word-remove-template'));
      } else if (!saved && remove) {
        remove.remove();
      }
    });
  });
}

function toggleWordPanel(e) {
  e.stopPropagation();
  clearWordPopup();
  document.getElementById('recent-dropdown').classList.remove('open');
  var panel = document.getElementById('word-panel');
  var opening = !panel.classList.contains('open');
  if (opening) {
    state.vocabulary.filter = 'current';
    renderWordPanel();
  }
  panel.classList.toggle('open');
}

/* ── word splitting ── */
function buildWordNodes(text) {
  var fragment = document.createDocumentFragment();
  var re = /([a-zA-Z0-9'\-]+)/g;
  var idx = 0, m;
  while ((m = re.exec(text)) !== null) {
    fragment.appendChild(document.createTextNode(text.substring(idx, m.index)));
    var word = cloneTemplateElement('lyric-word-template');
    word.dataset.word = m[1];
    word.dataset.offset = String(m.index);
    word.textContent = m[1];
    fragment.appendChild(word);
    idx = m.index + m[1].length;
  }
  fragment.appendChild(document.createTextNode(text.substring(idx)));
  return fragment;
}

function renderLines(lines) {
  state.player.lines = lines;
  state.player.activeIndex = -1;
  var container = document.getElementById('lrc-container');
  var content = document.createDocumentFragment();
  lines.forEach(function(line, i) {
    var div = cloneTemplateElement('lrc-line-template');
    div.dataset.index = String(i);
    div.querySelector('.lrc-time').textContent = fmtTime(line.timeStartMs);
    div.querySelector('.lrc-text').appendChild(buildWordNodes(line.text));
    content.appendChild(div);
  });
  container.replaceChildren(content);
  updateWordHighlights();
}

/* ── dictionary popup ── */
function showPopup(word, x, y) {
  var popup = document.getElementById('dict-popup');
  state.dictionary.visibleWord = word;
  popup.classList.add('visible');
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  var content = cloneTemplate('dictionary-popup-template');
  content.querySelector('.dw').textContent = word;
  content.querySelector('.dd').hidden = true;
  content.querySelector('.dm').textContent = 'Looking up...';
  popup.replaceChildren(content);
}

function hidePopup() {
  var popup = document.getElementById('dict-popup');
  popup.classList.remove('visible');
  state.dictionary.visibleWord = '';
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
    if (state.dictionary.visibleWord === word) {
      var popup = document.getElementById('dict-popup');
      var definitionNode = popup.querySelector('.dd');
      var messageNode = popup.querySelector('.dm');
      if (displayDefinition) {
        definitionNode.innerHTML = displayDefinition;
        definitionNode.hidden = false;
        messageNode.hidden = true;
      } else {
        definitionNode.replaceChildren();
        definitionNode.hidden = true;
        messageNode.textContent = 'No definition found';
        messageNode.hidden = false;
      }
    }
    return normalized;
  });
}

function onWordClick(el, event) {
  var word = el.getAttribute('data-word') || el.textContent.trim();
  var popup = document.getElementById('dict-popup');
  var shouldClosePopup = popup.classList.contains('visible') &&
    state.dictionary.visibleWord === word && el.classList.contains('selected');
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
  if (lineIdx >= 0 && lineIdx < state.player.lines.length) {
    var timeMs = state.player.lines[lineIdx].timeStartMs;
    var lineText = state.player.lines[lineIdx].text || '';
    var wordOffset = parseInt(el.getAttribute('data-offset'));
    if (isNaN(wordOffset)) wordOffset = 0;
    var key = wordKey(word);
    if (isSavedWord(word)) {
      lookupWord(word, lineText, wordOffset);
    } else if (state.vocabulary.pendingSaves[key]) {
      lookupWord(word, lineText, wordOffset);
    } else {
      state.vocabulary.pendingSaves[key] = true;
      lookupWord(word, lineText, wordOffset).then(function(normalized) {
        if (!normalized.definition) {
          delete state.vocabulary.pendingSaves[key];
          return;
        }
        sendCommand('addWord', {
          word: word,
          definition: normalized.definition,
          source: normalized.source,
          timeMs: timeMs
        });
      });
    }
  } else {
    lookupWord(word);
  }

  event.preventDefault();
}

/* ── delegated collection events ── */
var recentDropdown = document.getElementById('recent-dropdown');
recentDropdown.addEventListener('click', function(event) {
  var item = closestEventTarget(event, '.recent-item');
  if (!item || !recentDropdown.contains(item)) return;

  event.stopPropagation();
  clearWordPopup();
  var index = parseInt(item.dataset.index);
  var path = state.recent.files[index];
  if (path) sendCommand('openRecent', {path: path});
  recentDropdown.classList.remove('open');
});

var wordPanel = document.getElementById('word-panel');
wordPanel.addEventListener('click', function(event) {
  var filterButton = closestEventTarget(event, '[data-filter]');
  if (filterButton && wordPanel.contains(filterButton)) {
    setWordFilter(event, filterButton.dataset.filter);
    return;
  }

  var remove = closestEventTarget(event, '.wp-del');
  if (remove && wordPanel.contains(remove)) {
    event.stopPropagation();
    sendCommand('removeWord', {word: remove.dataset.word});
    return;
  }

  var item = closestEventTarget(event, '.wp-item');
  if (!item || !wordPanel.contains(item)) return;
  if (closestEventTarget(event, '.wp-toggle')) {
    event.stopPropagation();
    item.classList.toggle('expanded');
    return;
  }

  clearWordPopup();
  sendCommand('openWordRef', {
    file: item.dataset.file,
    ms: parseInt(item.dataset.ms)
  });
  wordPanel.classList.remove('open');
});

var lrcContainer = document.getElementById('lrc-container');
lrcContainer.addEventListener('click', function(event) {
  var line = closestEventTarget(event, '.lrc-line');
  if (!line || !lrcContainer.contains(line)) return;
  var lineIndex = parseInt(line.dataset.index);
  var lyric = state.player.lines[lineIndex];
  if (!lyric) return;

  if (closestEventTarget(event, '.lrc-time')) {
    event.stopPropagation();
    sendCommand('seek', {ms: lyric.timeStartMs});
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
    document.getElementById('recent-dropdown').classList.remove('open');
  }
  if (!e.target.closest('#btn-words') && !e.target.closest('#word-panel')) {
    document.getElementById('word-panel').classList.remove('open');
  }
});

/* ── font size zoom ── */
function setLrcSize(pct, persist) {
  state.player.lrcSize = Math.max(60, Math.min(200, pct));
  document.documentElement.style.setProperty('--lrc-size', (state.player.lrcSize * 0.16).toFixed(1) + 'px');
  var hint = document.getElementById('zoom-hint');
  hint.textContent = 'Font: ' + state.player.lrcSize + '%';
  hint.classList.add('show');
  clearTimeout(state.ui.hintTimer);
  state.ui.hintTimer = setTimeout(function() { hint.classList.remove('show'); }, 1800);
  if (persist !== false) {
    sendCommand('saveConfig', {lrcSize: state.player.lrcSize});
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

/* ── state update ── */
function updateProgressTrack(value) {
  // value: 0-1000 from the range input
  var pct = (value / 10).toFixed(1);
  if (pct > 100) pct = 100;
  var bar = document.getElementById('progress-bar');
  bar.style.background = 'linear-gradient(to right, #777 0%, #777 ' + pct + '%, #404040 ' + pct + '%)';
}

function updateVolumeIcon(value) {
  document.getElementById('vol-muted').style.display = value == 0 ? '' : 'none';
  document.getElementById('vol-low').style.display = value == 0 ? 'none' : '';
  document.getElementById('vol-high').style.display = value >= 30 ? '' : 'none';
}

function updateState(data) {
  if (data.loaded === false) return;

  if (data.loaded === true) {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('lrc-container').classList.remove('hidden');
    document.getElementById('playbar').classList.remove('hidden');
  }

  if (data.currentFile !== undefined) {
    var nextFile = data.currentFile || '';
    if (nextFile !== state.player.currentFile) {
      state.player.currentFile = nextFile;
      if (Object.keys(state.vocabulary.words).length > 0) renderWordPanel();
    }
  }

  if (data.lines !== undefined) {
    renderLines(data.lines);
    updateWordHighlights();
  }

  if (data.activeIndex !== undefined && data.activeIndex !== state.player.activeIndex) {
    var container = document.getElementById('lrc-container');
    var prev = container.querySelector('.lrc-line.active');
    if (prev) prev.classList.remove('active');
    state.player.activeIndex = data.activeIndex;
    if (state.player.activeIndex >= 0 && state.player.activeIndex < container.children.length) {
      var el = container.children[state.player.activeIndex];
      el.classList.add('active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // Volume sync (initial only — don't fight user dragging)
  if (data.volume !== undefined && !state.player.volumeDragging) {
    var vpct = Math.round(data.volume * 100);
    var vb = document.getElementById('volume-bar');
    if (Math.abs(vpct - vb.value) > 2) {
      vb.value = vpct;
      vb.style.background = 'linear-gradient(to right, #999 0%, #999 ' + vpct + '%, #404040 ' + vpct + '%)';
    }
    updateVolumeIcon(vpct);
  }

  if (data.duration !== undefined) state.player.duration = data.duration;
  if (data.playing !== undefined) {
    var wasPlaying = state.player.playing;
    state.player.playing = data.playing;
    if (state.player.playing !== wasPlaying) {
      document.getElementById('icon-play').style.display = state.player.playing ? 'none' : '';
      document.getElementById('icon-pause').style.display = state.player.playing ? '' : 'none';
      document.getElementById('btn-play').setAttribute('title', state.player.playing ? 'Pause' : 'Play');
    }
  }
  document.getElementById('time-duration').textContent = fmtTime(state.player.duration);

  if (!state.player.seeking) {
    var pos = data.position || 0;
    var val = state.player.duration > 0 ? Math.round((pos / state.player.duration) * 1000) : 0;
    document.getElementById('progress-bar').value = val;
    updateProgressTrack(val);
    document.getElementById('time-current').textContent = fmtTime(pos);
  }

  if (data.recent) {
    updateRecent(data.recent);
  }
  if (data.words) {
    updateWordPanel(data.words);
  }
}

/* ── polling ── */
function pollState() {
  sendCommand('getState');
}

/* ── button events ── */
document.getElementById('btn-open').onclick = function() {
  clearWordPopup();
  document.getElementById('recent-dropdown').classList.remove('open');
  document.getElementById('word-panel').classList.remove('open');
  sendCommand('open');
};
document.getElementById('btn-recent').onclick = toggleRecentDropdown;
document.getElementById('btn-words').onclick = toggleWordPanel;
document.getElementById('btn-play').onclick = function() {
  sendCommand(state.player.playing ? 'pause' : 'play');
};
document.getElementById('btn-skip-back').onclick = function() {
  sendCommand('seekBack');
};
document.getElementById('btn-skip-fwd').onclick = function() {
  sendCommand('seekFwd');
};

var volumeBar = document.getElementById('volume-bar');
volumeBar.addEventListener('mousedown', function() {
  state.player.volumeDragging = true;
  document.body.classList.add('volume-dragging');
});
function endVolumeDrag() {
  state.player.volumeDragging = false;
  document.body.classList.remove('volume-dragging');
}
document.addEventListener('mouseup', endVolumeDrag);
window.addEventListener('blur', endVolumeDrag);
volumeBar.oninput = function() {
  sendCommand('setVolume', {vol: volumeBar.value / 100});
  var pct = volumeBar.value;
  volumeBar.style.background = 'linear-gradient(to right, #999 0%, #999 ' + pct + '%, #404040 ' + pct + '%)';
  updateVolumeIcon(pct);
};

var progressBar = document.getElementById('progress-bar');
progressBar.oninput = function() {
  state.player.seeking = true;
  document.body.classList.add('seeking');
  updateProgressTrack(progressBar.value);
  if (state.player.duration > 0) {
    var ms = Math.round((progressBar.value / 1000) * state.player.duration);
    document.getElementById('time-current').textContent = fmtTime(ms);
  }
};
progressBar.onchange = function() {
  document.body.classList.remove('seeking');
  if (state.player.duration > 0) {
    var ms = Math.round((progressBar.value / 1000) * state.player.duration);
    sendCommand('seek', {ms: ms});
  }
  state.player.seeking = false;
};

/* ── keyboard shortcuts ── */
document.addEventListener('keydown', function(e) {
  var meta = e.metaKey || e.ctrlKey;
  if (e.code === 'Space' && !meta) {
    e.preventDefault();
    sendCommand(state.player.playing ? 'pause' : 'play');
  } else if (e.code === 'ArrowLeft' && !meta) {
    e.preventDefault();
    sendCommand('seekBack');
  } else if (e.code === 'ArrowRight' && !meta) {
    e.preventDefault();
    sendCommand('seekFwd');
  } else if ((e.code === 'ArrowUp' || e.key === 'ArrowUp') && !meta) {
    e.preventDefault();
    if (state.player.lines.length > 0) {
      var idx = state.player.activeIndex > 0 ? state.player.activeIndex - 1 : 0;
      sendCommand('seek', {ms: state.player.lines[idx].timeStartMs});
    }
  } else if ((e.code === 'ArrowDown' || e.key === 'ArrowDown') && !meta) {
    e.preventDefault();
    if (state.player.lines.length > 0) {
      var idx = state.player.activeIndex >= 0 && state.player.activeIndex < state.player.lines.length - 1 ? state.player.activeIndex + 1 : state.player.lines.length - 1;
      sendCommand('seek', {ms: state.player.lines[idx].timeStartMs});
    }
  } else if (meta && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
    e.preventDefault();
    setLrcSize(state.player.lrcSize + 10);
  } else if (meta && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
    e.preventDefault();
    setLrcSize(state.player.lrcSize - 10);
  } else if (meta && e.code === 'Digit0') {
    e.preventDefault();
    setLrcSize(100);
  } else if (e.code === 'Escape') {
    hidePopup();
  } else if (e.code === 'Enter' && !meta) {
    e.preventDefault();
    if (state.player.lines.length > 0 && state.player.activeIndex >= 0 && state.player.activeIndex < state.player.lines.length) {
      sendCommand('seek', {ms: state.player.lines[state.player.activeIndex].timeStartMs});
    }
  }
}, true);

setInterval(pollState, 400);
pollState();
