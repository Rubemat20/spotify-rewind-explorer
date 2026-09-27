// Light/dark variant per artist slot. A few original hues (index 0 light,
// 1 dark, 4 dark, 7 light) were nudged just enough that whichever of
// white/near-black text pickOnAccent() below chooses still clears WCAG
// 4.5:1 when painted directly on the color (the shuffle-bar "on repeat"
// badge) -- the rest were already fine and are untouched.
const PALETTE = [
  ['#1f6ec2', '#3987e5'], ['#eb6834', '#dc6536'], ['#1baf7a', '#199e70'], ['#eda100', '#c98500'],
  ['#e87ba4', '#d85f8b'], ['#008300', '#008300'], ['#4a3aa7', '#9085e9'], ['#e65a59', '#e66767'],
];

function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

function relLuminance(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hexA, hexB) {
  const a = relLuminance(hexA), b = relLuminance(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
// Text painted directly on an artist's accent color (the shuffle-bar "on
// repeat" segment) needs whichever of white/near-black clears 4.5:1 --
// a single fixed color fails against several PALETTE hues.
function pickOnAccent(bgHex) {
  return contrastRatio(bgHex, '#ffffff') >= contrastRatio(bgHex, '#211f19') ? '#ffffff' : '#211f19';
}

function accentForArtist(name) {
  return PALETTE[hashName(name) % PALETTE.length];
}

function releasePaletteFor(accentIdx, n) {
  const pool = PALETTE.filter((_, i) => i !== accentIdx);
  return pool.slice(0, n);
}

let ALL_DATA = null;
let CURRENT_NAME = null;

const tip = document.getElementById('tip');
function showTip(x, y, htmlStr) {
  tip.innerHTML = htmlStr;
  tip.style.left = x + 'px';
  tip.style.top = (y - 12) + 'px';
  tip.classList.add('show');
}
function hideTip() { tip.classList.remove('show'); }

function clearHost(id) { document.getElementById(id).innerHTML = ''; }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ==================== upload ==================== */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const progressTrack = document.getElementById('progressTrack');
const uploadSection = document.getElementById('uploadSection');
const picker = document.getElementById('picker');
const pickerStatusEl = document.getElementById('pickerStatus');

function setStatus(text, isError) {
  uploadStatus.textContent = text || '';
  uploadStatus.classList.toggle('is-error', !!isError);
}

['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'dragend', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});
dropzone.addEventListener('drop', (e) => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) handleFiles(files);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
});

async function handleFiles(fileList) {
  progressTrack.hidden = false;
  setStatus('Reading files…');
  try {
    const { records, fileCount, extended } = await collectRecordsFromFiles(fileList, (msg) => setStatus(msg));
    setStatus(`Crunching ${records.length.toLocaleString()} plays from ${fileCount} file${fileCount === 1 ? '' : 's'}…`);
    // Yield one frame so the status text actually paints before the
    // (synchronous, occasionally chunky) aggregation pass runs.
    await new Promise((r) => setTimeout(r, 30));
    const data = aggregateAllArtists(records, (phase, done, total) => {
      setStatus(`Aggregating artists… ${done.toLocaleString()}/${total.toLocaleString()}`);
    });
    if (!data.index.length) {
      throw new Error('No artist had 3 or more plays in that file -- nothing to show.');
    }
    ALL_DATA = data;
    progressTrack.hidden = true;
    uploadSection.hidden = true;
    picker.hidden = false;
    pickerStatusEl.hidden = false;
    pickerStatusEl.textContent = `${ALL_DATA.index.length.toLocaleString()} artists found (3+ plays) · ${records.length.toLocaleString()} total plays` +
      (extended ? '' : ' · basic streaming history, so album, shuffle and skip stats are left out');
    selectArtist(ALL_DATA.index[0].name);
  } catch (err) {
    progressTrack.hidden = true;
    setStatus(err.message || 'Something went wrong reading that file.', true);
    console.error(err);
  }
}

/* ==================== picker ==================== */
const pickerInput = document.getElementById('pickerInput');
const pickerList = document.getElementById('pickerList');
let activeIdx = -1;
let currentMatches = [];

function renderPickerList(query) {
  const q = query.trim().toLowerCase();
  let matches;
  if (!q) {
    matches = ALL_DATA.index.slice(0, 50);
  } else {
    matches = ALL_DATA.index.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 50);
  }
  currentMatches = matches;
  activeIdx = -1;
  pickerInput.setAttribute('aria-expanded', 'true');
  pickerInput.removeAttribute('aria-activedescendant');
  if (!matches.length) {
    pickerList.innerHTML = '<div class="picker-empty">No artist matches "' + esc(query) + '"</div>';
    pickerList.classList.add('open');
    return;
  }
  pickerList.innerHTML = matches.map((a, i) => (
    '<div class="picker-item" id="picker-item-' + i + '" role="option" aria-selected="false" data-i="' + i + '">' +
      '<span class="pi-name">' + esc(a.name) + '</span>' +
      '<span class="pi-meta">' + a.plays.toLocaleString() + ' plays</span>' +
    '</div>'
  )).join('');
  pickerList.classList.add('open');
  [...pickerList.querySelectorAll('.picker-item')].forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const i = parseInt(el.dataset.i, 10);
      selectArtist(currentMatches[i].name);
    });
  });
}

pickerInput.addEventListener('input', () => renderPickerList(pickerInput.value));
pickerInput.addEventListener('focus', () => renderPickerList(pickerInput.value));
pickerInput.addEventListener('keydown', (e) => {
  if (!pickerList.classList.contains('open')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx = Math.min(activeIdx + 1, currentMatches.length - 1);
    updateActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = Math.max(activeIdx - 1, 0);
    updateActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIdx >= 0 && currentMatches[activeIdx]) selectArtist(currentMatches[activeIdx].name);
  } else if (e.key === 'Escape') {
    closePickerList();
  }
});
document.addEventListener('click', (e) => {
  if (!document.getElementById('picker').contains(e.target)) {
    closePickerList();
  }
});
function closePickerList() {
  pickerList.classList.remove('open');
  pickerInput.setAttribute('aria-expanded', 'false');
  pickerInput.removeAttribute('aria-activedescendant');
}
function updateActive() {
  [...pickerList.querySelectorAll('.picker-item')].forEach((el, i) => {
    const isActive = i === activeIdx;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', String(isActive));
  });
  if (activeIdx >= 0 && currentMatches[activeIdx]) {
    pickerInput.setAttribute('aria-activedescendant', 'picker-item-' + activeIdx);
  } else {
    pickerInput.removeAttribute('aria-activedescendant');
  }
}

function selectArtist(name) {
  pickerInput.value = name;
  closePickerList();
  renderArtist(name);
}

/* ==================== save as PNG (plain browser download) ==================== */
const savePngBtn = document.getElementById('savePngBtn');
const savePngLabel = document.getElementById('savePngLabel');

function resetSaveBtn(delay) {
  setTimeout(() => {
    savePngBtn.disabled = false;
    savePngLabel.textContent = 'Save as PNG';
  }, delay);
}

savePngBtn.addEventListener('click', async () => {
  if (!CURRENT_NAME || typeof html2canvas !== 'function') return;
  savePngBtn.disabled = true;
  savePngLabel.textContent = 'Rendering…';
  document.body.classList.add('capturing');
  try {
    const target = document.getElementById('dashboard');
    const bg = getComputedStyle(document.body).backgroundColor;
    const canvas = await html2canvas(target, { backgroundColor: bg, scale: 2, useCORS: true });
    document.body.classList.remove('capturing');
    const safeName = CURRENT_NAME.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'artist';
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = safeName + '_rewind.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    savePngLabel.textContent = 'Saved';
    resetSaveBtn(1800);
  } catch (err) {
    document.body.classList.remove('capturing');
    console.error(err);
    savePngLabel.textContent = 'Could not save';
    resetSaveBtn(2200);
  }
});

/* ==================== main render ==================== */
function isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyArtistColors(name, data) {
  const [accentLight, accentDark] = accentForArtist(name);
  const accentIdx = hashName(name) % PALETTE.length;
  const useDark = isDarkMode();
  const root = document.documentElement.style;
  const accent = useDark ? accentDark : accentLight;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-soft', accent + '20');
  root.setProperty('--on-accent', pickOnAccent(accent));

  const relPalette = releasePaletteFor(accentIdx, 6);
  const releases = data.releases_for_band || [];
  const releaseSlots = {};
  releases.forEach((rel, i) => {
    if (i >= relPalette.length) return;
    const slot = i + 1;
    releaseSlots[rel.name] = slot;
    root.setProperty('--rel-' + slot, useDark ? relPalette[i][1] : relPalette[i][0]);
  });
  window.RELEASE_SLOTS = releaseSlots;
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (CURRENT_NAME && ALL_DATA) {
      applyArtistColors(CURRENT_NAME, ALL_DATA.artists[CURRENT_NAME]);
    }
  });
}

function renderArtist(name) {
  const data = ALL_DATA.artists[name];
  if (!data) return;
  CURRENT_NAME = name;
  const s = data.summary;

  applyArtistColors(name, data);

  document.getElementById('artistTitle').textContent = name + ', on repeat';
  document.getElementById('rangeChip').textContent = s.first_listen + '   →   ' + s.last_listen;

  const minutesInt = Math.round(s.total_minutes);
  const hours = Math.round((s.total_minutes / 60) * 10) / 10;
  document.getElementById('kpi1Value').textContent = minutesInt.toLocaleString();
  document.getElementById('kpi1Sub').textContent = '~' + hours.toLocaleString() + ' hours, total';
  document.getElementById('kpi2Value').textContent = s.total_plays.toLocaleString();
  document.getElementById('kpi2Sub').textContent = s.extended
    ? s.played_through_rate + '% played through'
    : s.over_30s_rate + '% past 30 seconds';
  document.getElementById('kpi3Value').textContent = s.unique_tracks.toLocaleString();
  document.getElementById('kpi3Sub').textContent = s.extended ? 'across ' + s.unique_albums + ' releases' : 'different songs';
  const kpi4 = document.getElementById('kpi4Value');
  kpi4.textContent = s.first_listen_month;
  kpi4.title = s.first_track;
  document.getElementById('kpi4Sub').textContent = s.first_track;
  const kpi5 = document.getElementById('kpi5Value');
  kpi5.textContent = s.top_track;
  kpi5.title = s.top_track;
  document.getElementById('kpi5Sub').textContent = s.top_track_plays + ' plays';

  const months = data.monthly;
  const monthName = (m) => {
    const [yr, mo] = m.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[parseInt(mo, 10) - 1] + ' ' + yr;
  };
  document.getElementById('monthlyNote').textContent =
    'plays per month, ' + monthName(months[0].month) + ' – ' + monthName(months[months.length - 1].month);

  document.getElementById('bandLegend').innerHTML = (data.releases_for_band || []).slice(0, 6).map((r, i) => (
    '<span class="item"><span class="swatch" style="background:var(--rel-' + (i + 1) + ')"></span>' + esc(r.name) + '</span>'
  )).join('');

  document.getElementById('eraSection').hidden = !s.has_era_grouping;
  document.getElementById('trendSection').hidden = !s.has_trend_data;
  document.querySelectorAll('.release-only').forEach((el) => { el.hidden = !s.extended; });
  document.getElementById('shuffleSection').hidden = !s.extended;
  document.getElementById('albumSection').hidden = !s.extended;

  const repeatPct = Math.round((100 - s.shuffle_pct) * 10) / 10;
  const shufflePct = s.shuffle_pct;
  const repeatSeg = document.getElementById('repeatSeg');
  const shuffleSeg = document.getElementById('shuffleSeg');
  repeatSeg.style.width = repeatPct + '%';
  shuffleSeg.style.width = shufflePct + '%';
  repeatSeg.textContent = repeatPct >= 15 ? repeatPct + '% on repeat' : '';
  shuffleSeg.textContent = shufflePct >= 15 ? shufflePct + '% shuffle' : '';
  document.getElementById('shuffleCaption').textContent = shufflePct >= 50
    ? shufflePct + '% of your ' + name + ' streams were on shuffle — more algorithm than intention.'
    : 'Only ' + shufflePct + '% of your ' + name + ' streams were on shuffle — you mostly know exactly which song you want.';

  document.getElementById('footerSource').textContent =
    'Source: your Spotify ' + (s.extended ? 'Extended ' : '') + 'Streaming History · filtered to ' + name + ' · generated ' +
    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('footerFact').textContent =
    'Biggest single day: ' + s.peak_day + ' with ' + s.peak_day_count + ' plays.' +
    (s.extended ? ' Most often on ' + s.top_platform + ' (' + s.top_platform_count + ' plays).' : '');

  renderLineChart(data);
  renderYearChart(data);
  if (s.has_era_grouping) renderEras(data);
  renderBars(data);
  if (s.has_trend_data) renderTrends(data);
  renderMini('dowHost', data.dow, 'day', 'plays');
  renderMini('daypartHost', data.daypart, 'part', 'plays');
  if (s.extended) renderAlbums(data);

  document.getElementById('dashboard').hidden = false;
}

function releaseColor(name) {
  const slot = window.RELEASE_SLOTS[name];
  return slot ? `var(--rel-${slot})` : 'var(--line-strong)';
}

/* ---------------- monthly line chart + release band ---------------- */
function renderLineChart(data) {
  clearHost('lineChartHost');
  const arr = data.monthly;
  const W = 848, H = 250, padL = 42, padR = 12, padT = 18, padB = 56;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxPlays = Math.max(...arr.map((d) => d.plays), 1);
  const yMax = Math.ceil((maxPlays + 2) / 10) * 10;
  const n = arr.length;
  const x = (i) => padL + (i / (n - 1)) * plotW;
  const y = (v) => padT + plotH - (v / yMax) * plotH;

  const linePts = arr.map((d, i) => `${x(i)},${y(d.plays)}`).join(' ');
  const areaPts = `${x(0)},${y(0)} ` + linePts + ` ${x(n - 1)},${y(0)}`;

  let peakIdx = 0;
  arr.forEach((d, i) => { if (d.plays > arr[peakIdx].plays) peakIdx = i; });
  const peak = arr[peakIdx];
  const yTicks = [0, yMax / 2, yMax];

  const xLabels = [];
  arr.forEach((d, i) => {
    const [yr, mo] = d.month.split('-');
    if (mo === '01') xLabels.push({ i, label: yr });
  });
  if (xLabels.length === 0 || xLabels[0].i > 1) {
    xLabels.unshift({ i: 0, label: arr[0].month.split('-')[0] });
  }
  const monthName = (m) => {
    const [yr, mo] = m.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[parseInt(mo, 10) - 1] + ' ' + yr;
  };

  const bandY = padT + plotH + 12, bandH = 14, sliceW = plotW / (n - 1);

  let svg = `<svg class="line-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="overflow:visible; display:block;">`;
  yTicks.forEach((t) => {
    svg += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" />`;
    svg += `<text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11">${t.toLocaleString()}</text>`;
  });
  svg += `<line class="axis-line" x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}" />`;
  svg += `<polygon class="area" points="${areaPts}" />`;
  svg += `<polyline class="series-line" points="${linePts}" />`;
  svg += `<circle class="peak-dot" cx="${x(peakIdx)}" cy="${y(peak.plays)}" r="4.5" />`;
  const peakLabelAnchor = peakIdx > n - 6 ? 'end' : 'middle';
  svg += `<text class="peak-label" x="${x(peakIdx)}" y="${y(peak.plays) - 12}" text-anchor="${peakLabelAnchor}">${peak.plays} plays · ${monthName(peak.month)}</text>`;
  arr.forEach((d, i) => {
    svg += `<circle class="hover-dot" data-i="${i}" cx="${x(i)}" cy="${y(d.plays)}" r="4" />`;
  });
  svg += `<line class="crosshair" id="crosshair" y1="${padT}" y2="${padT + plotH}" x1="0" x2="0" />`;
  if (data.summary.extended) arr.forEach((d, i) => {
    const segX = Math.max(padL, x(i) - sliceW / 2) + 1;
    const segW = Math.max(sliceW - 2, 1);
    const color = d.dominant_release ? releaseColor(d.dominant_release) : 'var(--line-strong)';
    svg += `<rect class="band-seg" data-i="${i}" x="${segX}" y="${bandY}" width="${segW}" height="${bandH}" rx="2" fill="${color}" />`;
  });
  xLabels.forEach(({ i, label }) => {
    svg += `<text x="${x(i)}" y="${bandY + bandH + 16}" text-anchor="start" font-size="11">${label}</text>`;
  });
  svg += `<rect class="hit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH + bandH + 20}" id="hitrect" />`;
  svg += `</svg>`;

  const host = document.getElementById('lineChartHost');
  host.innerHTML = svg;
  const svgEl = host.querySelector('svg');
  const hitrect = host.querySelector('#hitrect');
  const crosshair = host.querySelector('#crosshair');
  const dots = [...host.querySelectorAll('.hover-dot')];

  function pointerToIndex(clientX) {
    const rect = svgEl.getBoundingClientRect();
    const scale = W / rect.width;
    const localX = (clientX - rect.left) * scale;
    let idx = Math.round(((localX - padL) / plotW) * (n - 1));
    return Math.max(0, Math.min(n - 1, idx));
  }
  function handleMove(clientX, clientY) {
    const idx = pointerToIndex(clientX);
    dots.forEach((d) => (d.style.opacity = 0));
    dots[idx].style.opacity = 1;
    crosshair.style.opacity = 1;
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width / W;
    crosshair.setAttribute('x1', x(idx));
    crosshair.setAttribute('x2', x(idx));
    const d = arr[idx];
    const relLine = d.dominant_release ? `<br>${esc(d.dominant_release)}` : '';
    showTip(rect.left + x(idx) * scale, rect.top + y(d.plays) * scale,
      `<b>${d.plays}</b> play${d.plays === 1 ? '' : 's'} · ${d.minutes.toFixed(1)} min<br>${monthName(d.month)}${relLine}`);
  }
  hitrect.addEventListener('pointermove', (e) => handleMove(e.clientX, e.clientY));
  hitrect.addEventListener('pointerleave', () => {
    hideTip();
    crosshair.style.opacity = 0;
    dots.forEach((d) => (d.style.opacity = 0));
  });
}

/* ---------------- by year columns ---------------- */
function renderYearChart(data) {
  clearHost('yearChartHost');
  const years = data.yearly;
  const max = Math.max(...years.map((d) => d.plays), 1);
  const host = document.getElementById('yearChartHost');
  years.forEach((d) => {
    const pct = Math.max((d.plays / max) * 100, 3);
    const col = document.createElement('div');
    col.className = 'year-col';
    col.innerHTML = `
      <div class="year-value">${d.plays.toLocaleString()}</div>
      <div class="year-bar-track"><div class="year-bar" style="height:${pct}%"></div></div>
      <div class="year-label">${d.year}</div>`;
    col.addEventListener('pointermove', (e) => {
      showTip(e.clientX, e.clientY, `<b>${d.plays.toLocaleString()}</b> plays · ${d.minutes.toLocaleString()} min<br>${d.year}`);
    });
    col.addEventListener('pointerleave', hideTip);
    host.appendChild(col);
  });
}

/* ---------------- top tracks bars ---------------- */
function renderBars(data) {
  clearHost('barsHost');
  const tracks = data.top_tracks;
  const max = Math.max(...tracks.map((t) => t.plays), 1);
  const host = document.getElementById('barsHost');
  tracks.forEach((t) => {
    const pct = (t.plays / max) * 100;
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-meta">
        <span class="swatch" style="background:${releaseColor(t.release)}"></span>
        <div class="bar-meta-text"><div class="bar-track"></div><div class="bar-album"></div></div>
      </div>
      <div class="bar-track-wrap"><div class="bar-track-bg"></div><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-value">${t.plays}</div>`;
    row.querySelector('.bar-track').textContent = t.track;
    row.querySelector('.bar-album').textContent = t.album;
    row.addEventListener('pointermove', (e) => {
      showTip(e.clientX, e.clientY, `<b>${t.plays}</b> plays · ${t.minutes.toFixed(1)} min<br>${esc(t.track)}`);
    });
    row.addEventListener('pointerleave', hideTip);
    host.appendChild(row);
  });
}

/* ---------------- by era bars ---------------- */
function renderEras(data) {
  clearHost('erasHost');
  const eras = data.eras;
  const max = Math.max(...eras.map((e) => e.minutes), 1);
  const host = document.getElementById('erasHost');
  eras.forEach((e) => {
    const pct = (e.minutes / max) * 100;
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-meta">
        <span class="swatch" style="background:${releaseColor(e.era)}"></span>
        <div class="bar-meta-text"><div class="bar-track"></div><div class="bar-album"></div></div>
      </div>
      <div class="bar-track-wrap"><div class="bar-track-bg"></div><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-value">${e.minutes.toFixed(0)}m</div>`;
    row.querySelector('.bar-track').textContent = e.era;
    row.querySelector('.bar-album').textContent = e.album_count > 1 ? `${e.album_count} versions combined` : '1 release';
    row.addEventListener('pointermove', (ev) => {
      showTip(ev.clientX, ev.clientY, `<b>${e.plays.toLocaleString()}</b> plays · ${e.minutes.toLocaleString()} min<br>${esc(e.era)}`);
    });
    row.addEventListener('pointerleave', hideTip);
    host.appendChild(row);
  });
}

/* ---------------- mini bar charts ---------------- */
function renderMini(hostId, items, labelKey, valueKey) {
  clearHost(hostId);
  const host = document.getElementById(hostId);
  const max = Math.max(...items.map((d) => d[valueKey]), 1);
  items.forEach((d) => {
    const pct = Math.max((d[valueKey] / max) * 100, 3);
    const col = document.createElement('div');
    col.className = 'mini-col';
    col.innerHTML = `
      <div class="mini-count">${d[valueKey].toLocaleString()}</div>
      <div class="mini-bar-track"><div class="mini-bar" style="height:${pct}%"></div></div>
      <div class="mini-label"></div>`;
    col.querySelector('.mini-label').textContent = d[labelKey];
    col.addEventListener('pointermove', (e) => {
      showTip(e.clientX, e.clientY, `<b>${d[valueKey].toLocaleString()}</b> plays · ${esc(String(d[labelKey]))}`);
    });
    col.addEventListener('pointerleave', hideTip);
    host.appendChild(col);
  });
}

/* ---------------- rising & cooling ---------------- */
function renderTrendList(hostId, rows, direction) {
  clearHost(hostId);
  const host = document.getElementById(hostId);
  if (!rows || !rows.length) {
    host.innerHTML = '<div class="trend-row"><span class="trend-name" style="color:var(--muted);font-weight:400;">Not enough data yet</span></div>';
    return;
  }
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'trend-row';
    const pct = Math.round((r.ratio - 1) * 100);
    const label = direction === 'up' ? `+${pct}%` : `${pct}%`;
    row.innerHTML = `
      <span class="trend-name"></span>
      <span class="trend-delta ${direction}">${direction === 'up' ? '▲' : '▼'} ${label}</span>`;
    row.querySelector('.trend-name').textContent = r.name;
    row.addEventListener('pointermove', (e) => {
      showTip(e.clientX, e.clientY, `<b>${r.first_plays}</b> plays early → <b>${r.second_plays}</b> plays recently<br>${esc(r.name)}`);
    });
    row.addEventListener('pointerleave', hideTip);
    host.appendChild(row);
  });
}
function renderTrends(data) {
  renderTrendList('risingTracksHost', data.rising_tracks, 'up');
  renderTrendList('coolingTracksHost', data.cooling_tracks, 'down');
  renderTrendList('risingAlbumsHost', data.rising_albums, 'up');
  renderTrendList('coolingAlbumsHost', data.cooling_albums, 'down');
}

/* ---------------- albums table ---------------- */
function renderAlbums(data) {
  clearHost('albumBody');
  const albums = data.albums;
  const max = Math.max(...albums.map((a) => a.minutes), 1);
  const body = document.getElementById('albumBody');
  albums.forEach((a) => {
    const pct = (a.minutes / max) * 100;
    const color = releaseColor(a.release);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="album-name-cell"><span class="swatch" style="background:${color}"></span><span class="album-name"></span></div></td>
      <td class="num"></td><td class="num"></td>
      <td class="spark-cell"><div class="spark-track"><div class="spark-fill" style="width:${pct}%;background:${color}"></div></div></td>`;
    tr.querySelector('.album-name').textContent = a.album;
    tr.children[1].textContent = a.plays.toLocaleString();
    tr.children[2].textContent = a.minutes.toFixed(1);
    body.appendChild(tr);
  });
  const rest = data.albums_rest;
  if (rest) {
    const pct = Math.max((rest.minutes / max) * 100, 1);
    const tr = document.createElement('tr');
    tr.className = 'rest-row';
    tr.innerHTML = `
      <td><div class="album-name-cell"><span class="swatch" style="background:var(--line-strong)"></span><span class="album-name"></span></div></td>
      <td class="num"></td><td class="num"></td>
      <td class="spark-cell"><div class="spark-track"><div class="spark-fill" style="width:${pct}%;background:var(--line-strong)"></div></div></td>`;
    tr.querySelector('.album-name').textContent = '+ ' + rest.count + ' more releases';
    tr.children[1].textContent = rest.plays.toLocaleString();
    tr.children[2].textContent = rest.minutes.toFixed(1);
    body.appendChild(tr);
  }
}
