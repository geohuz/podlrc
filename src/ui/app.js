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
    return;
  }
  btn.style.display = '';
  var html = '<div class="rd-header">Recent Files</div>';
  _recentFiles.forEach(function(p, i) {
    var name = p.split('/').pop().replace(/\.mp3$/i, '');
    var dir = p.substring(0, p.lastIndexOf('/'));
    html += '<div class="recent-item" data-idx="' + i + '">' +
      '<span class="ri-name">' + esc(name) + '</span>' +
      '<span class="ri-path">' + esc(dir) + '</span></div>';
  });
  dd.innerHTML = html;
  dd.querySelectorAll('.recent-item').forEach(function(el) {
    el.onclick = function(e) {
      e.stopPropagation();
      clearWordPopup();
      var idx = parseInt(this.getAttribute('data-idx'));
      window.external.invoke(JSON.stringify({cmd: 'openRecent', path: _recentFiles[idx]}));
      dd.classList.remove('open');
    };
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
    return;
  }
  btn.style.display = '';
  var entries = allEntries;
  if (_wordFilter === 'current') {
    entries = allEntries.filter(function(e) { return e.file === _currentFile; });
  }
  entries.sort(function(a, b) { return a.word.localeCompare(b.word); });
  var title = podcastTitle(_currentFile);
  var html = '<div class="wp-list">' +
    '<div class="wp-header">' +
      '<div class="rd-header">Vocabulary</div>' +
      '<div class="wp-filter">' +
        '<button type="button" class="' + (_wordFilter === 'current' ? 'active' : '') +
          '" onclick="setWordFilter(event, &quot;current&quot;)" title="' + esc(title) + '">' + esc(title) + '</button>' +
        '<button type="button" class="' + (_wordFilter === 'all' ? 'active' : '') +
          '" onclick="setWordFilter(event, &quot;all&quot;)">All</button>' +
      '</div>' +
    '</div>';
  if (entries.length === 0) {
    html += '<div class="wp-empty">No saved words for this podcast.</div>';
  }
  entries.forEach(function(e) {
    html += '<div class="wp-item" data-file="' + esc(e.file) + '" data-ms="' + e.timeMs + '">' +
      '<span class="wp-toggle" title="Expand definition">▶</span>' +
      '<span class="wp-word">' + esc(e.word) + '</span>' +
      '<span class="wp-definition">' + (formatDictionaryDefinition(e.definition, e.word) || 'Looking up definition...') + '</span>' +
      '<span class="wp-del" data-word="' + esc(e.word) + '" data-file="' + esc(e.file) + '" data-ms="' + e.timeMs + '">&times;</span>' +
      '</div>';
  });
  html += '</div>';
  panel.innerHTML = html;
  panel.querySelectorAll('.wp-item').forEach(function(el) {
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
  });
  panel.querySelectorAll('.wp-del').forEach(function(el) {
    el.addEventListener('click', function(ev) {
      ev.stopPropagation();
      window.external.invoke(JSON.stringify({
        cmd: 'removeWord',
        word: el.getAttribute('data-word')
      }));
    });
  });
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
        el.insertAdjacentHTML(
          'beforeend',
          '<span class="word-remove" title="Remove from Vocabulary">&times;</span>'
        );
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
function buildWordSpans(text) {
  var out = '';
  var re = /([a-zA-Z0-9'\-]+)/g;
  var idx = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.substring(idx, m.index));
    out += '<span class="word" data-word="' + esc(m[1]) +
      '" data-offset="' + m.index + '">' + esc(m[1]) + '</span>';
    idx = m.index + m[1].length;
  }
  out += esc(text.substring(idx));
  return out;
}

function renderLines(lines) {
  _lines = lines;
  _activeIdx = -1;
  var container = document.getElementById('lrc-container');
  container.innerHTML = '';
  lines.forEach(function(line, i) {
    var div = document.createElement('div');
    div.className = 'lrc-line';
    div.innerHTML = '<span class="lrc-time">' +
      fmtTime(line.timeStartMs) + '</span>' +
      '<span class="lrc-text">' + buildWordSpans(line.text) + '</span>';
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
    container.appendChild(div);
  });
  updateWordHighlights();
}

/* ── dictionary popup ── */
function showPopup(word, x, y) {
  var popup = document.getElementById('dict-popup');
  _visibleLookupWord = word;
  popup.classList.add('visible');
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  popup.innerHTML = '<div class="dw">' + esc(word) + '</div><div class="dm">Looking up...</div>';
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
      var content = displayDefinition
        ? '<div class="dd">' + displayDefinition + '</div>'
        : '<div class="dm">No definition found</div>';
      document.getElementById('dict-popup').innerHTML =
        '<div class="dw">' + esc(word) + '</div>' + content;
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
  var icon = document.getElementById('vol-icon');
  if (pct == 0) {
    icon.innerHTML = '<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/>';
  } else if (pct < 30) {
    icon.innerHTML = '<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/>';
  } else {
    icon.innerHTML = '<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/>';
  }
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
