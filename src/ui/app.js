var _lines = [];
var _activeIdx = -1;
var _duration = 0;
var _playing = false;
var _seeking = false;
var _lrcSize = 100;
var _volDragging = false;
var _dictTimer = null;
var _recentFiles = [];
var _currentFile = '';
var _dictionaryRequests = {};
var _nextDictionaryRequest = 1;
var _visibleLookupWord = '';
var _wordFilter = 'current';

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

function podcastTitle(path) {
  if (!path) return 'Current';
  return path.split('/').pop().replace(/\.[^.]+$/i, '') || 'Current';
}

/* ── recent files ── */
function renderRecentDropdown() {
  var dd = document.getElementById('recent-dropdown');
  var btn = document.getElementById('btn-recent');
  if (_recentFiles.length === 0) {
    btn.style.display = 'none';
    dd.classList.remove('open');
    dd.replaceChildren();
    return;
  }
  btn.style.display = '';
  dd.replaceChildren(cloneTemplate('recent-dropdown-template'));
  var items = dd.querySelector('.recent-items');
  _recentFiles.forEach(function(p, i) {
    var name = p.split('/').pop().replace(/\.mp3$/i, '');
    var dir = p.substring(0, p.lastIndexOf('/'));
    var el = cloneTemplateElement('recent-item-template');
    el.querySelector('.ri-name').textContent = name;
    el.querySelector('.ri-path').textContent = dir;
    el.onclick = function(e) {
      e.stopPropagation();
      clearWordPopup();
      window.external.invoke(JSON.stringify({cmd: 'openRecent', path: _recentFiles[i]}));
      dd.classList.remove('open');
    };
    items.appendChild(el);
  });
}

function updateRecent(recent) {
  _recentFiles = recent || [];
  renderRecentDropdown();
  var er = document.getElementById('empty-recent');
  if (_recentFiles.length > 0) {
    var names = _recentFiles.slice(0, 3).map(function(p) {
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
var _savedWords = {};
var _definitionRequests = {};
var _definitionHydrationRunning = false;
var _pendingWordSaves = {};

function wordKey(word) {
  return (word || '').toLowerCase();
}

function isSavedWord(word) {
  return Object.prototype.hasOwnProperty.call(_savedWords, wordKey(word));
}

function updateWordPanel(words) {
  _savedWords = {};
  (words || []).forEach(function(w) {
    var key = wordKey(w.word);
    _savedWords[key] = w;
    delete _pendingWordSaves[key];
  });
  renderWordPanel();
  updateWordHighlights();
  hydrateMissingDefinitions();
}

function renderWordPanel() {
  var panel = document.getElementById('word-panel');
  var btn = document.getElementById('btn-words');
  var allEntries = Object.values(_savedWords);
  if (allEntries.length === 0) {
    btn.style.display = 'none';
    panel.classList.remove('open');
    panel.replaceChildren();
    return;
  }
  btn.style.display = '';
  var entries = allEntries;
  if (_wordFilter === 'current') {
    entries = allEntries.filter(function(e) { return e.file === _currentFile; });
  }
  entries.sort(function(a, b) { return a.word.localeCompare(b.word); });
  var title = podcastTitle(_currentFile);
  var content = cloneTemplate('word-panel-template');
  var currentButton = content.querySelector('[data-filter="current"]');
  var allButton = content.querySelector('[data-filter="all"]');
  var empty = content.querySelector('.wp-empty');
  var items = content.querySelector('.wp-items');

  currentButton.textContent = title;
  currentButton.title = title;
  currentButton.classList.toggle('active', _wordFilter === 'current');
  allButton.classList.toggle('active', _wordFilter === 'all');
  currentButton.onclick = function(event) { setWordFilter(event, 'current'); };
  allButton.onclick = function(event) { setWordFilter(event, 'all'); };
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

    el.addEventListener('click', function(ev) {
      if (ev.target.classList.contains('wp-del')) return;
      if (ev.target.classList.contains('wp-toggle')) {
        ev.stopPropagation();
        el.classList.toggle('expanded');
        return;
      }
      clearWordPopup();
      var f = el.getAttribute('data-file');
      var ms = parseInt(el.getAttribute('data-ms'));
      window.external.invoke(JSON.stringify({cmd: 'openWordRef', file: f, ms: ms}));
      panel.classList.remove('open');
    });
    remove.addEventListener('click', function(ev) {
      ev.stopPropagation();
      window.external.invoke(JSON.stringify({
        cmd: 'removeWord',
        word: remove.dataset.word
      }));
    });
    items.appendChild(el);
  });
  panel.replaceChildren(content);
}

function setWordFilter(ev, filter) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  _wordFilter = filter === 'all' ? 'all' : 'current';
  renderWordPanel();
}

function requestDictionaryDefinition(word, context, offset) {
  return new Promise(function(resolve) {
    var id = _nextDictionaryRequest++;
    _dictionaryRequests[id] = resolve;
    setTimeout(function() {
      var message = {cmd: 'lookupWord', id: id, word: word};
      if (context !== undefined && context !== null) message.context = context;
      if (offset !== undefined && offset !== null) message.offset = offset;
      window.external.invoke(JSON.stringify(message));
    }, 0);
  });
}

/* PODLRC_DICTIONARY_FORMATTERS */
function resolveDictionaryLookup(response) {
  var resolve = _dictionaryRequests[response.id];
  delete _dictionaryRequests[response.id];
  if (resolve) resolve(response.definition || '');
}

function needsDefinitionHydration(entry) {
  if (!entry.definition) return true;
  return entry.source === 'macOS-normalized-html-v1:oaldpe-apple' &&
    entry.definition.indexOf('class="dict-head"') < 0;
}

function hydrateMissingDefinitions() {
  if (_definitionHydrationRunning) return;
  var entries = Object.values(_savedWords).filter(function(entry) {
    return needsDefinitionHydration(entry) &&
      !_definitionRequests[wordKey(entry.word)];
  });
  if (entries.length === 0) return;

  _definitionHydrationRunning = true;
  function hydrateNext(index) {
    if (index >= entries.length) {
      _definitionHydrationRunning = false;
      hydrateMissingDefinitions();
      return;
    }
    var entry = entries[index];
    var key = wordKey(entry.word);
    _definitionRequests[key] = true;
    requestDictionaryDefinition(entry.word).then(function(definition) {
      if (!definition) return;
      var normalized = normalizeDictionaryDefinition(definition, entry.word);
      window.external.invoke(JSON.stringify({
        cmd: 'setWordDefinition',
        word: entry.word,
        definition: normalized.definition,
        source: normalized.source,
        file: entry.file,
        timeMs: entry.timeMs
      }));
    }).then(function() {
      hydrateNext(index + 1);
    }, function() {
      delete _definitionRequests[key];
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
    _wordFilter = 'current';
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
  _lines = lines;
  _activeIdx = -1;
  var container = document.getElementById('lrc-container');
  var content = document.createDocumentFragment();
  lines.forEach(function(line, i) {
    var div = cloneTemplateElement('lrc-line-template');
    div.querySelector('.lrc-time').textContent = fmtTime(line.timeStartMs);
    div.querySelector('.lrc-text').appendChild(buildWordNodes(line.text));
    div.querySelector('.lrc-time').onclick = function(e) {
      e.stopPropagation();
      window.external.invoke(JSON.stringify({cmd: 'seek', ms: line.timeStartMs}));
    };
    div.querySelectorAll('.word').forEach(function(w) {
      w.addEventListener('click', function(e) {
        e.stopPropagation();
        if (e.target.classList.contains('word-remove')) {
          window.external.invoke(JSON.stringify({
            cmd: 'removeWord',
            word: w.getAttribute('data-word') || w.textContent.trim()
          }));
          return;
        }
        onWordClick(w, e);
      });
    });
    content.appendChild(div);
  });
  container.replaceChildren(content);
  updateWordHighlights();
}

/* ── dictionary popup ── */
function showPopup(word, x, y) {
  var popup = document.getElementById('dict-popup');
  _visibleLookupWord = word;
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
  _visibleLookupWord = '';
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
    if (_visibleLookupWord === word) {
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
    _visibleLookupWord === word && el.classList.contains('selected');
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
  var container = document.getElementById('lrc-container');
  var lineIdx = lineEl ? Array.prototype.indexOf.call(container.children, lineEl) : -1;
  if (lineIdx >= 0 && lineIdx < _lines.length) {
    var timeMs = _lines[lineIdx].timeStartMs;
    var lineText = _lines[lineIdx].text || '';
    var wordOffset = parseInt(el.getAttribute('data-offset'));
    if (isNaN(wordOffset)) wordOffset = 0;
    var key = wordKey(word);
    if (isSavedWord(word)) {
      lookupWord(word, lineText, wordOffset);
    } else if (_pendingWordSaves[key]) {
      lookupWord(word, lineText, wordOffset);
    } else {
      _pendingWordSaves[key] = true;
      lookupWord(word, lineText, wordOffset).then(function(normalized) {
        if (!normalized.definition) {
          delete _pendingWordSaves[key];
          return;
        }
        window.external.invoke(JSON.stringify({
          cmd: 'addWord',
          word: word,
          definition: normalized.definition,
          source: normalized.source,
          timeMs: timeMs
        }));
      });
    }
  } else {
    lookupWord(word);
  }

  event.preventDefault();
}

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
  _lrcSize = Math.max(60, Math.min(200, pct));
  document.documentElement.style.setProperty('--lrc-size', (_lrcSize * 0.16).toFixed(1) + 'px');
  var hint = document.getElementById('zoom-hint');
  hint.textContent = 'Font: ' + _lrcSize + '%';
  hint.classList.add('show');
  clearTimeout(_dictTimer);
  _dictTimer = setTimeout(function() { hint.classList.remove('show'); }, 1800);
  if (persist !== false) {
    window.external.invoke(JSON.stringify({cmd: 'saveConfig', lrcSize: _lrcSize}));
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
      window.external.invoke(JSON.stringify({cmd: 'ready'}));
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
    if (nextFile !== _currentFile) {
      _currentFile = nextFile;
      if (Object.keys(_savedWords).length > 0) renderWordPanel();
    }
  }

  if (data.lines !== undefined) {
    renderLines(data.lines);
    updateWordHighlights();
  }

  if (data.activeIndex !== undefined && data.activeIndex !== _activeIdx) {
    var container = document.getElementById('lrc-container');
    var prev = container.querySelector('.lrc-line.active');
    if (prev) prev.classList.remove('active');
    _activeIdx = data.activeIndex;
    if (_activeIdx >= 0 && _activeIdx < container.children.length) {
      var el = container.children[_activeIdx];
      el.classList.add('active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // Volume sync (initial only — don't fight user dragging)
  if (data.volume !== undefined && !_volDragging) {
    var vpct = Math.round(data.volume * 100);
    var vb = document.getElementById('volume-bar');
    if (Math.abs(vpct - vb.value) > 2) {
      vb.value = vpct;
      vb.style.background = 'linear-gradient(to right, #999 0%, #999 ' + vpct + '%, #404040 ' + vpct + '%)';
    }
    updateVolumeIcon(vpct);
  }

  if (data.duration !== undefined) _duration = data.duration;
  if (data.playing !== undefined) {
    var wasPlaying = _playing;
    _playing = data.playing;
    if (_playing !== wasPlaying) {
      document.getElementById('icon-play').style.display = _playing ? 'none' : '';
      document.getElementById('icon-pause').style.display = _playing ? '' : 'none';
      document.getElementById('btn-play').setAttribute('title', _playing ? 'Pause' : 'Play');
    }
  }
  document.getElementById('time-duration').textContent = fmtTime(_duration);

  if (!_seeking) {
    var pos = data.position || 0;
    var val = _duration > 0 ? Math.round((pos / _duration) * 1000) : 0;
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
  window.external.invoke(JSON.stringify({cmd: 'getState'}));
}

/* ── button events ── */
document.getElementById('btn-open').onclick = function() {
  clearWordPopup();
  document.getElementById('recent-dropdown').classList.remove('open');
  document.getElementById('word-panel').classList.remove('open');
  window.external.invoke(JSON.stringify({cmd: 'open'}));
};
document.getElementById('btn-recent').onclick = toggleRecentDropdown;
document.getElementById('btn-words').onclick = toggleWordPanel;
document.getElementById('btn-play').onclick = function() {
  window.external.invoke(JSON.stringify({cmd: _playing ? 'pause' : 'play'}));
};
document.getElementById('btn-skip-back').onclick = function() {
  window.external.invoke(JSON.stringify({cmd: 'seekBack'}));
};
document.getElementById('btn-skip-fwd').onclick = function() {
  window.external.invoke(JSON.stringify({cmd: 'seekFwd'}));
};

var volumeBar = document.getElementById('volume-bar');
volumeBar.addEventListener('mousedown', function() {
  _volDragging = true;
  document.body.classList.add('volume-dragging');
});
function endVolumeDrag() {
  _volDragging = false;
  document.body.classList.remove('volume-dragging');
}
document.addEventListener('mouseup', endVolumeDrag);
window.addEventListener('blur', endVolumeDrag);
volumeBar.oninput = function() {
  window.external.invoke(JSON.stringify({cmd: 'setVolume', vol: volumeBar.value / 100}));
  var pct = volumeBar.value;
  volumeBar.style.background = 'linear-gradient(to right, #999 0%, #999 ' + pct + '%, #404040 ' + pct + '%)';
  updateVolumeIcon(pct);
};

var progressBar = document.getElementById('progress-bar');
progressBar.oninput = function() {
  _seeking = true;
  document.body.classList.add('seeking');
  updateProgressTrack(progressBar.value);
  if (_duration > 0) {
    var ms = Math.round((progressBar.value / 1000) * _duration);
    document.getElementById('time-current').textContent = fmtTime(ms);
  }
};
progressBar.onchange = function() {
  document.body.classList.remove('seeking');
  if (_duration > 0) {
    var ms = Math.round((progressBar.value / 1000) * _duration);
    window.external.invoke(JSON.stringify({cmd: 'seek', ms: ms}));
  }
  _seeking = false;
};

/* ── keyboard shortcuts ── */
document.addEventListener('keydown', function(e) {
  var meta = e.metaKey || e.ctrlKey;
  if (e.code === 'Space' && !meta) {
    e.preventDefault();
    window.external.invoke(JSON.stringify({cmd: _playing ? 'pause' : 'play'}));
  } else if (e.code === 'ArrowLeft' && !meta) {
    e.preventDefault();
    window.external.invoke(JSON.stringify({cmd: 'seekBack'}));
  } else if (e.code === 'ArrowRight' && !meta) {
    e.preventDefault();
    window.external.invoke(JSON.stringify({cmd: 'seekFwd'}));
  } else if ((e.code === 'ArrowUp' || e.key === 'ArrowUp') && !meta) {
    e.preventDefault();
    if (_lines.length > 0) {
      var idx = _activeIdx > 0 ? _activeIdx - 1 : 0;
      window.external.invoke(JSON.stringify({cmd: 'seek', ms: _lines[idx].timeStartMs}));
    }
  } else if ((e.code === 'ArrowDown' || e.key === 'ArrowDown') && !meta) {
    e.preventDefault();
    if (_lines.length > 0) {
      var idx = _activeIdx >= 0 && _activeIdx < _lines.length - 1 ? _activeIdx + 1 : _lines.length - 1;
      window.external.invoke(JSON.stringify({cmd: 'seek', ms: _lines[idx].timeStartMs}));
    }
  } else if (meta && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
    e.preventDefault();
    setLrcSize(_lrcSize + 10);
  } else if (meta && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
    e.preventDefault();
    setLrcSize(_lrcSize - 10);
  } else if (meta && e.code === 'Digit0') {
    e.preventDefault();
    setLrcSize(100);
  } else if (e.code === 'Escape') {
    hidePopup();
  } else if (e.code === 'Enter' && !meta) {
    e.preventDefault();
    if (_lines.length > 0 && _activeIdx >= 0 && _activeIdx < _lines.length) {
      window.external.invoke(JSON.stringify({cmd: 'seek', ms: _lines[_activeIdx].timeStartMs}));
    }
  }
}, true);

setInterval(pollState, 400);
pollState();
