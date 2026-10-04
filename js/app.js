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
let CURRENT_VIEW = 'artist';  // 'artist' | 'topfive'
let TF_DATA = null;           // TopFive.buildTopFive() result
let TF_YEAR = null;
let TF_WINDOW = 'full';       // 'full' | 'wrapped'
let TF_METRIC = 'minutes';    // top-five ranking: 'minutes' | 'plays'

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
    const { records, fileCount } = await collectRecordsFromFiles(fileList, (msg) => setStatus(msg));
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
    setStatus('Building your Top Five by year…');
    await new Promise((r) => setTimeout(r, 30));
    TF_DATA = TopFive.buildTopFive(records);
    TF_YEAR = defaultTopFiveYear(TF_DATA);
    ALL_DATA = data;
    progressTrack.hidden = true;
    uploadSection.hidden = true;
    viewTabs.hidden = !TF_DATA.year_list.length;
    picker.hidden = false;
    pickerStatusEl.hidden = false;
    pickerStatusEl.textContent = `${ALL_DATA.index.length.toLocaleString()} artists found (3+ plays) · ${records.length.toLocaleString()} total plays`;
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

function resetSaveBtn(btn, label, delay) {
  setTimeout(() => {
    btn.disabled = false;
    label.textContent = 'Save as PNG';
  }, delay);
}

// Shared by the artist dashboard and the Top Five view.
async function saveAsPng(btn, label, target, baseName) {
  if (typeof html2canvas !== 'function') return;
  btn.disabled = true;
  label.textContent = 'Rendering…';
  document.body.classList.add('capturing');
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const canvas = await html2canvas(target, { backgroundColor: bg, scale: 2, useCORS: true });
    document.body.classList.remove('capturing');
    const safeName = baseName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'rewind';
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = safeName + '_rewind.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    label.textContent = 'Saved';
    resetSaveBtn(btn, label, 1800);
  } catch (err) {
    document.body.classList.remove('capturing');
    console.error(err);
    label.textContent = 'Could not save';
    resetSaveBtn(btn, label, 2200);
  }
}

savePngBtn.addEventListener('click', () => {
  if (!CURRENT_NAME) return;
  saveAsPng(savePngBtn, savePngLabel, document.getElementById('dashboard'), CURRENT_NAME);
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
    if (CURRENT_NAME && ALL_DATA && CURRENT_VIEW === 'artist') {
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
  document.getElementById('kpi2Sub').textContent = s.played_through_rate + '% played through';
  document.getElementById('kpi3Value').textContent = s.unique_tracks.toLocaleString();
  document.getElementById('kpi3Sub').textContent = 'across ' + s.unique_albums + ' releases';
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
    'Source: your Spotify Extended Streaming History · filtered to ' + name + ' · generated ' +
    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('footerFact').textContent =
    'Biggest single day: ' + s.peak_day + ' with ' + s.peak_day_count + ' plays. Most often on ' + s.top_platform +
    ' (' + s.top_platform_count + ' plays).';

  renderLineChart(data);
  renderYearChart(data);
  if (s.has_era_grouping) renderEras(data);
  renderBars(data);
  if (s.has_trend_data) renderTrends(data);
  renderMini('dowHost', data.dow, 'day', 'plays');
  renderMini('daypartHost', data.daypart, 'part', 'plays');
  renderAlbums(data);

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
  arr.forEach((d, i) => {
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

/* ==================== view tabs ==================== */
const viewTabs = document.getElementById('viewTabs');
const artistView = document.getElementById('artistView');
const topFiveView = document.getElementById('topFive');

function showView(view) {
  CURRENT_VIEW = view;
  viewTabs.querySelectorAll('.view-tab').forEach((b) => {
    const on = b.dataset.view === view;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  artistView.hidden = view !== 'artist';
  topFiveView.hidden = view !== 'topfive';
  hideTip();
  if (view === 'topfive') {
    resetAccent();
    renderTopFive();
  } else if (CURRENT_NAME) {
    applyArtistColors(CURRENT_NAME, ALL_DATA.artists[CURRENT_NAME]);
  }
}

// The Top Five view isn't about one artist, so it uses the default palette.
function resetAccent() {
  const root = document.documentElement.style;
  ['--accent', '--accent-soft', '--on-accent'].forEach((p) => root.removeProperty(p));
}

viewTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-tab');
  if (btn) showView(btn.dataset.view);
});
viewTabs.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const next = CURRENT_VIEW === 'artist' ? 'topfive' : 'artist';
  showView(next);
  viewTabs.querySelector(`[data-view="${next}"]`).focus();
});

/* ==================== top five ==================== */
const TF_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TF_WINDOW_LABEL = { full: 'Full Year', wrapped: 'Wrapped window' };

function tfDate(s, withYear = true) {
  const [y, m, d] = s.split('-').map(Number);
  return TF_MONTHS[m - 1] + ' ' + d + (withYear ? ', ' + y : '');
}
function tfRange([a, b]) {
  return a.slice(0, 4) === b.slice(0, 4) ? tfDate(a, false) + ' – ' + tfDate(b) : tfDate(a) + ' – ' + tfDate(b);
}
const tfPct = (x) => Math.round(x * 100) + '%';
const tfNum = (n) => Number(n).toLocaleString();

// Most recent year that's finished and has data; otherwise the latest year.
function defaultTopFiveYear(tf) {
  const done = tf.year_list.find((y) => !tf.years[y].full.flags.in_progress && !tf.years[y].full.flags.empty);
  return done !== undefined ? done : tf.year_list[0];
}

function stepYear(delta) {
  // year_list is newest first, so "previous year" is further along the list
  const list = TF_DATA.year_list;
  const i = list.indexOf(TF_YEAR) - delta;
  if (i < 0 || i >= list.length) return;
  TF_YEAR = list[i];
  renderTopFive();
}

function setWindow(kind) {
  if (kind === TF_WINDOW) return;
  TF_WINDOW = kind;
  renderTopFive();
}

const tfSaveBtn = document.getElementById('tfSavePngBtn');
tfSaveBtn.addEventListener('click', () => {
  if (TF_YEAR === null) return;
  saveAsPng(tfSaveBtn, document.getElementById('tfSavePngLabel'), topFiveView,
    `top_five_${TF_YEAR}_${TF_WINDOW === 'wrapped' ? 'wrapped_window' : 'full_year'}`);
});

document.getElementById('tfPrev').addEventListener('click', () => stepYear(-1));
document.getElementById('tfNext').addEventListener('click', () => stepYear(1));
document.getElementById('tfYears').addEventListener('click', (e) => {
  const btn = e.target.closest('.year-pill');
  if (!btn) return;
  TF_YEAR = +btn.dataset.year;
  renderTopFive();
});
const tfWindowGroup = document.getElementById('tfWindow');
tfWindowGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-window]');
  if (btn) setWindow(btn.dataset.window);
});
tfWindowGroup.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  setWindow(TF_WINDOW === 'full' ? 'wrapped' : 'full');
  tfWindowGroup.querySelector(`[data-window="${TF_WINDOW}"]`).focus();
});
// Left/right arrows step through years anywhere on the Top Five view
// (except while typing, or inside a control that uses arrows itself).
document.addEventListener('keydown', (e) => {
  if (CURRENT_VIEW !== 'topfive' || !TF_DATA) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.target.closest('input, textarea, select, [role="tablist"], [role="radiogroup"]')) return;
  e.preventDefault();
  stepYear(e.key === 'ArrowLeft' ? -1 : 1);
});

function renderTopFive() {
  if (!TF_DATA || TF_YEAR === null) return;
  const year = TF_YEAR;
  const entry = TF_DATA.years[year];
  const w = entry[TF_WINDOW];
  topFiveView.dataset.window = TF_WINDOW;

  document.getElementById('tfTitle').textContent = 'Your ' + year + ', top five';

  // year pills, oldest -> newest left to right; * marks a partial year
  const pills = document.getElementById('tfYears');
  pills.innerHTML = TF_DATA.year_list.slice().reverse().map((y) => {
    const f = TF_DATA.years[y].full.flags;
    const partial = f.in_progress || f.ends_early || f.starts_late;
    return `<button class="year-pill" data-year="${y}" aria-pressed="${y === year}"` +
      (partial ? ' title="Partial year"' : '') + `>${y}` +
      (partial ? '<span class="partial" aria-label=", partial year">*</span>' : '') + `</button>`;
  }).join('');
  // Center the active pill in the strip (scrolls only the strip, never the page).
  const active = pills.querySelector('[aria-pressed="true"]');
  if (active) pills.scrollLeft = active.offsetLeft - pills.offsetLeft - (pills.clientWidth - active.offsetWidth) / 2;
  const idx = TF_DATA.year_list.indexOf(year);
  document.getElementById('tfPrev').disabled = idx >= TF_DATA.year_list.length - 1;
  document.getElementById('tfNext').disabled = idx <= 0;

  tfWindowGroup.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.window === TF_WINDOW;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });

  // active window + its date range (and the slice the export actually covers)
  let rangeHtml = `<b>${TF_WINDOW_LABEL[TF_WINDOW]}</b> · ${tfRange(w.range)}`;
  if (w.covered && (w.covered[0] !== w.range[0] || w.covered[1] !== w.range[1])) {
    rangeHtml += ` · data ${tfRange(w.covered)}`;
  }
  document.getElementById('tfRange').innerHTML = rangeHtml;
  const cfg = TF_DATA.config;
  document.getElementById('tfRangeNote').textContent = TF_WINDOW === 'wrapped'
    ? "Approximates the period Spotify's Wrapped covers" +
      (cfg.wrapped_excludes_incognito ? ', minus Private Session plays' : '') + ' · ' + cfg.time_zone + ' time'
    : 'Plays of ' + cfg.min_seconds + 's+ · ' + cfg.time_zone + ' time';

  renderTfBanner(w, year);

  const body = document.getElementById('tfBody');
  if (w.flags.empty) {
    body.innerHTML = `<section class="card tf-empty"><h3>Nothing to show here</h3>` +
      `<p>No plays of ${cfg.min_seconds}s or more fall inside the ${TF_WINDOW_LABEL[TF_WINDOW]} for ${year}.</p></section>`;
    return;
  }
  body.innerHTML = tfKpis(w) + tfTopCard(w) +
    `<div class="row-2">${tfPersonalityCard(w)}${tfHighlightsCard(w)}</div>` +
    tfClockCard(w) + tfDiscoveryCard(w) + tfYoyCard(w, year) + tfDiffCard(entry, year);
}

function tfDelta(cur, prev) {
  if (!prev) return '<span class="tf-delta">new</span>';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return '<span class="tf-delta">±0%</span>';
  return `<span class="tf-delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

function tfYoyCard(w, year) {
  const y = w.yoy;
  if (!y) {
    return `<section class="card"><div class="card-head"><h2>Year over year</h2></div>
      <p class="note">There's no ${year - 1} listening in your export to compare ${year} with.</p></section>`;
  }
  const notes = [];
  if (y.basis === 'same_span') notes.push(`Compares ${tfRange(w.covered)} with ${tfRange(y.span)}, since ${year}'s data stops there.`);
  if (y.prev_sparse) notes.push(`${y.prev_year} is a light year in your export, so these swings look bigger than they are.`);
  const row = (label, k) => `<tr><td>${label}</td><td class="num">${tfNum(y.previous[k])}</td><td class="num">${tfNum(y.current[k])}</td><td class="num">${tfDelta(y.current[k], y.previous[k])}</td></tr>`;
  const moves = y.top_artists.map((a) => {
    let move;
    if (a.prev_rank === null) move = `<span class="tf-delta up">new · not played in ${y.prev_year}</span>`;
    else if (a.prev_rank === a.rank) move = `<span class="tf-delta">= same spot</span>`;
    else if (a.prev_rank > a.rank) move = `<span class="tf-delta up">▲ from #${tfNum(a.prev_rank)}</span>`;
    else move = `<span class="tf-delta down">▼ from #${a.prev_rank}</span>`;
    return `<div class="tf-row"><div class="tf-rank">${a.rank}</div><div class="tf-main">${tfArtistName(a.name, 'tf-name')}</div><div class="tf-val">${move}</div></div>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><h2>${year} vs. ${y.prev_year}</h2><span class="note">${TF_WINDOW_LABEL[TF_WINDOW]}, ${y.basis === 'same_span' ? 'same dates' : 'same window'} both years</span></div>
    ${notes.length ? `<p class="note tf-card-note">${notes.join(' ')}</p>` : ''}
    <div class="tf-yoy">
      <div class="table-scroll"><table>
        <thead><tr><th></th><th class="num">${y.prev_year}</th><th class="num">${year}</th><th class="num">Change</th></tr></thead>
        <tbody>${row('Minutes', 'minutes')}${row('Plays', 'plays')}${row('Artists', 'unique_artists')}${row('New artists', 'new_artists')}</tbody>
      </table></div>
      <div class="tf-list"><h3>Top artists, then vs. now</h3>${moves}</div>
    </div>
  </section>`;
}

const TF_STATUS = {
  up: ['up', '▲ climbed'], down: ['down', '▼ slipped'], entered: ['up', 'joins in Full Year'],
  dropped: ['down', 'drops out'], same: ['', '= unchanged'],
};

function tfDiffCard(entry, year) {
  const diff = entry.diff;
  if (!diff) return '';
  const cutoff = tfDate(entry.wrapped.range[1], false);
  const m = TF_METRIC;
  const facts = [];
  const after = diff.after_cutoff;
  if (entry.full.flags.in_progress && entry.wrapped.flags.in_progress) {
    facts.push(`The ${cutoff} cutoff hasn't passed yet, so both windows hold the same days so far.`);
  } else if (after.plays) {
    facts.push(`<b>${tfNum(after.minutes)} min</b> (${tfNum(after.plays)} plays) came after ${cutoff}, the stretch Wrapped never counts.`);
  } else {
    facts.push(`Nothing was played after ${cutoff}.`);
  }
  if (diff.incognito_excluded && diff.incognito_excluded.plays) {
    facts.push(`<b>${tfNum(diff.incognito_excluded.minutes)} min</b> of Private Session listening is left out of the Wrapped window.`);
  }
  const rank = (r) => (r === null ? '—' : '#' + tfNum(r));
  const lists = [['Artists', 'artists'], ['Songs', 'tracks'], ['Albums', 'albums']].map(([title, cat]) => {
    const rows = diff.categories[cat][m];
    const changed = rows.filter((r) => r.status !== 'same');
    const body = changed.length
      ? changed.map((r) => {
        const [cls, label] = TF_STATUS[r.status];
        const name = cat === 'artists' ? tfArtistName(r.name, 'tf-name') : `<span class="tf-name">${esc(r.name)}</span>`;
        const sub = cat === 'artists' ? '' : `<div class="tf-sub">${esc(r.artist)}</div>`;
        return `<div class="tf-row tf-diff-row"><div class="tf-main"><div class="tf-name-line">${name}</div>${sub}</div>` +
          `<div class="tf-val"><span class="tf-ranks">${rank(r.wrapped_rank)} → ${rank(r.full_rank)}</span><span class="tf-delta ${cls}">${label}</span></div></div>`;
      }).join('')
      : '<div class="note">Same top five either way.</div>';
    return `<div class="tf-list"><h3>${title}</h3>${body}</div>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><h2>Wrapped window vs. Full Year</h2><span class="note">rank in Wrapped window → rank in Full Year, ${m === 'plays' ? 'by plays' : 'by minutes'}</span></div>
    <p class="tf-diff-facts">${facts.join(' ')}</p>
    ${diff.changed ? `<div class="tf-top-grid">${lists}</div>` : `<p class="note">Your top fives come out identical whichever window you use.</p>`}
  </section>`;
}

// Hover tooltips for anything in the Top Five body carrying data-tip (HTML, pre-escaped).
document.getElementById('tfBody').addEventListener('pointermove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(e.clientX, e.clientY, el.dataset.tip);
  else hideTip();
});
document.getElementById('tfBody').addEventListener('pointerleave', hideTip);

function tfHour(h) {
  const suffix = h < 12 ? 'am' : 'pm';
  return (h % 12 === 0 ? 12 : h % 12) + suffix;
}
const TF_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function tfPersonalityCard(w) {
  const p = w.personality;
  const m = p.metrics;
  const traits = p.traits.length
    ? `<div class="tf-traits">${p.traits.map((t) => `<span class="tf-trait" data-tip="${escAttr(esc(t.blurb))}">${esc(t.name)}</span>`).join('')}</div>`
    : '';
  const facts = [
    ['Top 5 artists', tfPct(m.top5_artist_share) + ' of minutes'],
    ['After 10pm', tfPct(m.night_share) + ' of minutes'],
    ['Picked, not shuffled', tfPct(m.curated_share)],
    ['Plays per song', m.plays_per_track.toFixed(1)],
  ];
  if (m.new_artist_share !== null) facts.splice(1, 0, ['From new artists', tfPct(m.new_artist_share) + ' of minutes']);
  // Older exports don't record skips at all, so a 0% skip rate means "unknown".
  if (m.skip_rate > 0) facts.push(['Skipped', tfPct(m.skip_rate) + ' of starts']);
  return `<section class="card tf-persona">
    <div class="card-head"><h2>Listening personality</h2></div>
    <div class="tf-persona-name">${esc(p.name)}</div>
    <p class="tf-persona-blurb">${esc(p.blurb)}</p>
    ${traits}
    <dl class="tf-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="note">A rule-of-thumb read of your habits, not Spotify's own formula.</div>
  </section>`;
}

function tfHighlightsCard(w) {
  const d = w.top_day, o = w.obsession, s = w.streaks;
  const item = (label, value, sub) =>
    `<div class="tf-hl"><div class="label">${label}</div><div class="tf-hl-value">${value}</div><div class="tf-hl-sub">${sub}</div></div>`;
  return `<section class="card">
    <div class="card-head"><h2>Highlights</h2></div>
    <div class="tf-hl-grid">
      ${item('Biggest day', tfDate(d.date), `${tfNum(d.minutes)} min · top song <b>${esc(d.top_track.name)}</b>`)}
      ${item('Most-replayed in a day', esc(o.name), `${o.plays}× on ${tfDate(o.date)} · ${esc(o.artist)}`)}
      ${item('Longest streak', `${tfNum(s.listening.days)} day${s.listening.days === 1 ? '' : 's'}`, `listening every day, ${tfRange([s.listening.start, s.listening.end])}`)}
      ${item('Artist streak', `${tfNum(s.artist.days)} day${s.artist.days === 1 ? '' : 's'}`, `${esc(s.artist.name)} every day, ${tfRange([s.artist.start, s.artist.end])}`)}
    </div>
  </section>`;
}

// Column chart in the existing mini-chart style; labels[i] may be '' to skip a label.
function tfColumns(values, labels, tips, peakIdx, cls) {
  const max = Math.max(...values, 1);
  return `<div class="mini-chart ${cls || ''}">` + values.map((v, i) => {
    const pct = Math.max((v / max) * 100, 2);
    return `<div class="mini-col${i === peakIdx ? ' is-peak' : ''}" data-tip="${tips[i]}">` +
      `<div class="mini-bar-track"><div class="mini-bar" style="height:${pct}%"></div></div>` +
      `<div class="mini-label">${labels[i]}</div></div>`;
  }).join('') + `</div>`;
}

function tfClockCard(w) {
  const c = w.clock;
  const hourLabels = c.hours.map((_, h) => (h % 3 === 0 ? tfHour(h).replace('m', '') : ''));
  const hourTips = c.hours.map((v, h) => `<b>${tfNum(v)}</b> min · ${tfHour(h)}–${tfHour((h + 1) % 24)}`);
  const dayTips = c.weekdays.map((v, i) => `<b>${tfNum(v)}</b> min · ${TF_WEEKDAYS[i]}s`);
  return `<section class="card">
    <div class="card-head">
      <h2>When you listen</h2>
      <span class="note">peak hour <b>${tfHour(c.peak_hour)}</b> · peak day <b>${TF_WEEKDAYS[c.peak_weekday]}</b> · ${esc(TF_DATA.config.time_zone)} time</span>
    </div>
    <div class="tf-clock">
      <div><h3 class="tf-sub-h">By hour</h3>${tfColumns(c.hours, hourLabels, hourTips, c.peak_hour, 'tf-hours')}</div>
      <div><h3 class="tf-sub-h">By day of week</h3>${tfColumns(c.weekdays, TF_WEEKDAYS.map((d) => d.slice(0, 3)), dayTips, c.peak_weekday)}</div>
    </div>
  </section>`;
}

function tfDiscoveryCard(w) {
  const d = w.discovery;
  if (!d.reliable) {
    return `<section class="card">
      <div class="card-head"><h2>New vs. returning artists</h2></div>
      <p class="note">Your history only starts ${tfDate(TF_DATA.config.data_range[0])}, so there isn't a full year before ${TF_YEAR}
      to tell a genuinely new artist from one you just hadn't played yet inside this export.</p>
    </section>`;
  }
  const total = d.new_artists + d.returning_artists;
  const newPct = total ? (d.new_artists / total) * 100 : 0;
  return `<section class="card">
    <div class="card-head">
      <h2>New vs. returning artists</h2>
      <span class="note">"new" = first ever play of theirs falls in this window</span>
    </div>
    <div class="shuffle-bar" data-tip="<b>${tfNum(d.new_artists)}</b> new · <b>${tfNum(d.returning_artists)}</b> returning">
      <div class="shuffle-seg repeat" style="width:${newPct}%">${newPct >= 15 ? tfNum(d.new_artists) + ' new' : ''}</div>
      <div class="shuffle-seg shuffle" style="width:${100 - newPct}%">${100 - newPct >= 15 ? tfNum(d.returning_artists) + ' returning' : ''}</div>
    </div>
    <div class="shuffle-caption">New artists took ${tfPct(d.new_minutes_share)} of your listening time; the rest went to artists you already knew.</div>
    <div class="tf-new">${tfList('Top new discoveries', d.top_new, 'artists', 'minutes')}</div>
  </section>`;
}

// Top-five list sections inside #tfBody (re-rendered with the body).
const tfBodyEl = document.getElementById('tfBody');
tfBodyEl.addEventListener('click', (e) => {
  const metricBtn = e.target.closest('button[data-metric]');
  if (metricBtn && metricBtn.dataset.metric !== TF_METRIC) {
    TF_METRIC = metricBtn.dataset.metric;
    renderTopFive();
    tfBodyEl.querySelector(`button[data-metric="${TF_METRIC}"]`).focus();
    return;
  }
  const artistBtn = e.target.closest('button[data-artist]');
  if (artistBtn && ALL_DATA.artists[artistBtn.dataset.artist]) {
    showView('artist');
    selectArtist(artistBtn.dataset.artist);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
tfBodyEl.addEventListener('keydown', (e) => {
  const group = e.target.closest('[data-metric-group]');
  if (!group || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  TF_METRIC = TF_METRIC === 'minutes' ? 'plays' : 'minutes';
  renderTopFive();
  tfBodyEl.querySelector(`button[data-metric="${TF_METRIC}"]`).focus();
});

// esc() leaves double quotes alone, which is fine for text but not inside attribute values.
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

// Artist name as a link into the deep-dive when that artist has one (3+ plays).
function tfArtistName(name, cls) {
  if (ALL_DATA && ALL_DATA.artists[name]) {
    return `<button class="tf-link ${cls}" data-artist="${escAttr(name)}" title="Open ${escAttr(name)} in the artist deep-dive">${esc(name)}</button>`;
  }
  return `<span class="${cls}">${esc(name)}</span>`;
}

function tfValue(item, metric) {
  return metric === 'plays' ? `${tfNum(item.plays)} plays` : `${tfNum(Math.round(item.minutes))} min`;
}

function tfList(title, top, kind, metric) {
  if (!top.items.length) return `<div class="tf-list"><h3>${title}</h3><div class="note">Nothing here yet</div></div>`;
  const other = metric === 'plays' ? 'minutes' : 'plays';
  const rows = top.items.map((it) => {
    const name = kind === 'artists' ? tfArtistName(it.name, 'tf-name') : `<span class="tf-name">${esc(it.name)}</span>`;
    const sub = kind === 'artists' ? '' : `<div class="tf-sub">${tfArtistName(it.artist, '')}</div>`;
    return `<div class="tf-row${it.rank === 1 ? ' is-first' : ''}">` +
      `<div class="tf-rank">${it.rank}</div>` +
      `<div class="tf-main"><div class="tf-name-line">${name}${it.tied ? '<span class="tf-tie" title="Tied with another entry on ' + metric + '">tie</span>' : ''}</div>${sub}</div>` +
      `<div class="tf-val" title="${tfValue(it, other)}">${tfValue(it, metric)}</div></div>`;
  }).join('');
  const more = top.more_tied ? `<div class="note tf-more">+ ${top.more_tied} more tied at #${top.items[top.items.length - 1].rank}</div>` : '';
  return `<div class="tf-list"><h3>${title}</h3>${rows}${more}</div>`;
}

function tfTopCard(w) {
  const m = TF_METRIC;
  return `<section class="card">
    <div class="card-head">
      <h2>Your top five</h2>
      <div class="seg small" role="radiogroup" aria-label="Rank by" data-metric-group>
        <button role="radio" data-metric="minutes" aria-checked="${m === 'minutes'}" tabindex="${m === 'minutes' ? 0 : -1}">By minutes</button>
        <button role="radio" data-metric="plays" aria-checked="${m === 'plays'}" tabindex="${m === 'plays' ? 0 : -1}">By plays</button>
      </div>
    </div>
    <div class="tf-top-grid">
      ${tfList('Artists', w.top.artists[m], 'artists', m)}
      ${tfList('Songs', w.top.tracks[m], 'tracks', m)}
      ${tfList('Albums', w.top.albums[m], 'albums', m)}
    </div>
    <div class="note tf-foot">Genres aren't part of Spotify's streaming-history export, so there's no top-genres list. Ties share a rank.</div>
  </section>`;
}

function renderTfBanner(w, year) {
  const f = w.flags;
  const notes = [];
  if (!f.empty && f.in_progress) {
    notes.push(`<strong>${year} isn't over yet.</strong> This covers ${tfRange(w.covered)}; the window runs through ${tfDate(w.range[1])}.`);
  } else if (!f.empty && f.ends_early) {
    notes.push(`<strong>Your export ends ${tfDate(w.covered[1])}</strong>, before this window does, so later listening is missing.`);
  }
  if (f.starts_late) {
    notes.push(`<strong>Your history starts ${tfDate(TF_DATA.config.data_range[0])}</strong>, partway through ${year}.`);
  }
  if (!f.empty && f.sparse) {
    notes.push(`<strong>Light year:</strong> only ${tfNum(w.totals.plays)} plays across ${tfNum(w.totals.active_days)} ` +
      `day${w.totals.active_days === 1 ? '' : 's'}, so these rankings rest on very little listening.`);
  }
  const banner = document.getElementById('tfBanner');
  banner.innerHTML = notes.map((n) => `<p>${n}</p>`).join('');
  banner.hidden = !notes.length;
}

function tfTile(label, value, sub, title) {
  return `<div class="kpi"><div class="label">${label}</div>` +
    `<div class="value truncate"${title ? ` title="${escAttr(title)}"` : ''}>${value}</div><div class="sub">${sub}</div></div>`;
}

function tfKpis(w) {
  const t = w.totals;
  const hours = Math.round(t.minutes / 60).toLocaleString();
  const newLine = w.discovery.reliable ? `${tfNum(w.discovery.new_artists)} new to you` : 'new vs. returning n/a';
  return `<section class="kpis">` +
    tfTile('Minutes listened', tfNum(t.minutes), `~${hours} hours · ${tfNum(Math.round(t.avg_minutes_per_day))}/day`) +
    tfTile('Plays', tfNum(t.plays), `${tfNum(t.active_days)} of ${tfNum(t.covered_days)} days active`) +
    tfTile('Artists', tfNum(t.unique_artists), newLine) +
    tfTile('Tracks', tfNum(t.unique_tracks), `from ${tfNum(t.unique_albums)} albums`) +
    tfTile('On shuffle', tfPct(t.shuffle_share), 'of minutes listened') +
    `</section>`;
}
