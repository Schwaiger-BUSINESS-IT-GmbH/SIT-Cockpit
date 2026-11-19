// SIT-Time Frontend (Vanilla JS, keine Build-Tools)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  user: null,
  settings: { roundMinutes: 15 },
  timers: [],
  history: [],
  clockOffset: 0,  // Server-Zeit minus Client-Zeit
  articles: null,
  booking: null,   // Timer, der gerade gebucht wird
  booked: {},      // ticketId -> { at, data | error }
  bookedOpen: new Set(),
};

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    redirect: 'manual',
  }).catch(() => null);
  // Microsoft-Anmeldung (Easy Auth) abgelaufen → Azure leitet um; Seite neu laden startet den Login
  if (!res || res.type === 'opaqueredirect' || res.status === 0) {
    if (navigator.onLine) location.reload();
    throw new Error(navigator.onLine ? 'Anmeldung abgelaufen – lade neu…' : 'Keine Verbindung');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Bitte neu anmelden'); }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

// ---------- Helpers ----------
const now = () => Date.now() + state.clockOffset;
const elapsed = (t) => t.segments.reduce((s, g) => s + ((g.end ?? now()) - g.start), 0);
const isRunning = (t) => t.segments.length && t.segments.at(-1).end == null;

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function fmtMin(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
function roundUp(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const r = state.settings.roundMinutes;
  return r > 0 ? Math.ceil(min / r) * r : min;
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isErr ? 5000 : 2500);
}

// ---------- Views ----------
function showLogin() {
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
  $('#token').focus();
}

async function showApp() {
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#user-name').textContent = state.user.name;
  $('#app-version').textContent = state.version ? `SIT-Time v${state.version}` : '';
  let tab = 'tickets';
  try { tab = localStorage.getItem('sit.tab') || 'tickets'; } catch { /* egal */ }
  selectTab(tab === 'work' ? 'work' : 'tickets');
  if (tab !== 'work') loadWork().catch(() => {}); // für den Status-Punkt im Tab
  await Promise.all([loadTimers(), searchTickets()]);
}

// ---------- Login ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    const { user } = await api('/login', { method: 'POST', body: { token: $('#token').value } });
    $('#token').value = '';
    const me = await api('/me');
    state.user = user;
    state.settings = me.settings;
    state.version = me.version;
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('#logout').addEventListener('click', async () => {
  const r = await fetch('/api/logout', { method: 'POST' }).then((x) => x.json()).catch(() => ({}));
  state.user = null;
  state.articles = null;
  if (r.logoutUrl) location.href = r.logoutUrl; // auch von Microsoft abmelden
  else showLogin();
});

$('#forget-token').addEventListener('click', async () => {
  if (!confirm('Gespeicherten weclapp-Token entfernen? Danach musst du ihn neu eingeben (z.B. einen erneuerten Token).')) return;
  await fetch('/api/token', { method: 'DELETE' }).catch(() => {});
  state.user = null;
  state.articles = null;
  showLogin();
});

// ---------- Timer ----------
async function loadTimers() {
  const t0 = Date.now();
  const data = await api('/timers');
  state.clockOffset = data.serverNow - Math.round((t0 + Date.now()) / 2);
  state.timers = data.timers;
  state.history = data.history;
  renderTimers();
  renderHistory();
  loadAllBooked();
}

function renderTimers() {
  const wrap = $('#timers');
  $('#timers-empty').hidden = state.timers.length > 0;
  // Offene Notiz-Felder nicht beim Tippen zerstören
  const focused = document.activeElement?.dataset?.note;
  wrap.innerHTML = state.timers.map((t) => {
    const run = isRunning(t);
    return `
    <article class="timer ${run ? 'running' : ''}" data-id="${t.id}">
      <div class="timer-top">
        <div>
          <div class="ticket-no">${esc(t.ticket.number)}</div>
          <div class="ticket-subject">${esc(t.ticket.subject)}</div>
          ${t.ticket.customer ? `<div class="ticket-customer">${esc(t.ticket.customer)}</div>` : ''}
        </div>
        <div>
          <div class="clock" data-clock="${t.id}">${fmtClock(elapsed(t))}</div>
          <div class="state">${run ? 'läuft' : 'pausiert'}</div>
        </div>
      </div>
      <div class="booked" data-booked="${esc(t.ticket.id)}">${bookedHtml(t.ticket.id)}</div>
      <textarea rows="2" data-note="${t.id}" placeholder="Notizen für die Beschreibung (optional)…">${esc(t.note)}</textarea>
      <div class="timer-actions">
        ${run
          ? `<button class="btn pause" data-act="pause">❚❚ Pause</button>`
          : `<button class="btn run" data-act="resume">▶ Weiter</button>`}
        <button class="btn primary" data-act="stop">■ Stopp &amp; buchen</button>
        <button class="btn ghost photo" data-act="photo" title="Foto zum Ticket hochladen" aria-label="Foto hochladen">📷 Foto${t.photos?.length ? `<span class="badge">${t.photos.length}</span>` : ''}</button>
        <button class="btn ghost danger" data-act="discard" title="Timer verwerfen">🗑</button>
      </div>
      <div class="upload-status" data-upload="${t.id}" hidden></div>
    </article>`;
  }).join('');
  if (focused) {
    const el = wrap.querySelector(`[data-note="${focused}"]`);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  updateTitle();
}

// ---------- Bereits gebuchte Zeiten pro Ticket ----------
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function bookedHtml(ticketId) {
  const b = state.booked[ticketId];
  if (!b) return '<span class="booked-sum muted">Gebuchte Zeiten werden geladen…</span>';
  if (b.error) return `<span class="booked-sum muted" title="${esc(b.error)}">Gebuchte Zeiten nicht verfügbar: ${esc(b.error)}</span>`;
  const d = b.data;
  if (!d.count) return '<span class="booked-sum muted">Noch keine Zeiten gebucht</span>';
  const open = state.bookedOpen.has(ticketId) ? ' open' : '';
  return `
    <details${open} data-booked-toggle="${esc(ticketId)}">
      <summary class="booked-sum">
        <span>Bereits gebucht <b>${fmtMin(d.totalMinutes)}</b></span>
        <span class="muted">· davon ich ${fmtMin(d.mineMinutes)} · ${d.count} ${d.count === 1 ? 'Eintrag' : 'Einträge'}</span>
      </summary>
      <ul class="booked-list">
        ${d.entries.map((e) => `
          <li class="${e.mine ? 'mine' : ''}">
            <span class="b-date">${fmtDate(e.date)}</span>
            <span class="b-user">${esc(e.mine ? 'Ich' : e.user || '–')}</span>
            <span class="b-desc" title="${esc(e.description)}">${esc(e.description)}${e.billable ? '' : ' <em class="muted">(n. abr.)</em>'}</span>
            <span class="b-dur">${fmtMin(e.minutes)}</span>
          </li>`).join('')}
      </ul>
    </details>`;
}

async function loadBooked(ticketId, force = false) {
  const cur = state.booked[ticketId];
  if (!force && cur && Date.now() - cur.at < 120000) return;
  try {
    const data = await api(`/tickets/${encodeURIComponent(ticketId)}/booked`);
    state.booked[ticketId] = { at: Date.now(), data };
  } catch (ex) {
    state.booked[ticketId] = { at: Date.now(), error: ex.message || 'Fehler' };
  }
  const el = document.querySelector(`[data-booked="${CSS.escape(ticketId)}"]`);
  if (el) el.innerHTML = bookedHtml(ticketId);
}

function loadAllBooked() {
  for (const t of state.timers) loadBooked(t.ticket.id);
}

// Lange Beschreibung: Maus drüber = Tooltip + Aufklappen, Tippen (Handy) = auf-/zuklappen
document.addEventListener('click', (e) => {
  const li = e.target.closest('.booked-list li');
  if (li) li.classList.toggle('expanded');
});

document.addEventListener('toggle', (e) => {
  const id = e.target?.dataset?.bookedToggle;
  if (!id) return;
  if (e.target.open) state.bookedOpen.add(id); else state.bookedOpen.delete(id);
}, true);

function updateTitle() {
  const run = state.timers.find(isRunning);
  document.title = run ? `▶ ${fmtClock(elapsed(run))} · ${run.ticket.number}` : 'SIT-Time';
}

setInterval(() => {
  for (const t of state.timers) {
    const el = document.querySelector(`[data-clock="${t.id}"]`);
    if (el) el.textContent = fmtClock(elapsed(t));
  }
  if (state.booking) $('#bk-measured').textContent = fmtClock(elapsed(state.booking));
  updateTitle();
}, 1000);

$('#timers').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.timer').dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'photo') {
      photoTarget = id;
      $('#photo-input').value = '';
      $('#photo-input').click();
      return;
    }
    if (act === 'discard') {
      if (!confirm('Timer verwerfen? Die Zeit wird nicht gebucht.')) return;
      await api(`/timers/${id}`, { method: 'DELETE' });
      toast('Timer verworfen');
    } else if (act === 'stop') {
      await api(`/timers/${id}/stop`, { method: 'POST' });
      await loadTimers();
      return openBooking(state.timers.find((t) => t.id === id));
    } else {
      await api(`/timers/${id}/${act}`, { method: 'POST' });
    }
    await loadTimers();
  } catch (ex) { toast(ex.message, true); }
});

// Notizen automatisch speichern
const noteTimers = {};
$('#timers').addEventListener('input', (e) => {
  const id = e.target.dataset.note;
  if (!id) return;
  const t = state.timers.find((x) => x.id === id);
  if (t) t.note = e.target.value;
  clearTimeout(noteTimers[id]);
  noteTimers[id] = setTimeout(() => api(`/timers/${id}`, { method: 'PATCH', body: { note: e.target.value } }).catch(() => {}), 600);
});

// ---------- Fotos ----------
let photoTarget = null;

// Bild im Browser verkleinern (max. 1600 px, JPEG ~82 %) – spart Datenvolumen unterwegs
async function compressImage(file, maxSide = 1600, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (/^image\/(jpeg|png)$/.test(file.type)) return file; // unverändert hochladen
    throw new Error(`Bildformat ${file.type || 'unbekannt'} wird nicht unterstützt`);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Komprimieren fehlgeschlagen'))), 'image/jpeg', quality));
}

function setUploadStatus(id, text, isErr = false) {
  const el = document.querySelector(`[data-upload="${id}"]`);
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', isErr);
}

$('#photo-input').addEventListener('change', async (e) => {
  const id = photoTarget;
  const files = [...(e.target.files || [])];
  if (!id || !files.length) return;
  let ok = 0;
  for (const [i, f] of files.entries()) {
    setUploadStatus(id, `Lade Foto ${i + 1} von ${files.length} hoch…`);
    try {
      const blob = await compressImage(f);
      const res = await fetch(`/api/timers/${id}/photos`, {
        method: 'POST', body: blob, credentials: 'same-origin', redirect: 'manual',
        headers: { 'Content-Type': blob.type || 'image/jpeg' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      ok++;
    } catch (ex) {
      setUploadStatus(id, ex.message, true);
      toast(ex.message, true);
      await loadTimers();
      return;
    }
  }
  await loadTimers();
  toast(`✓ ${ok} ${ok === 1 ? 'Foto' : 'Fotos'} ans Ticket angehängt`);
});

// ---------- Ticketsuche ----------
let searchSeq = 0;
async function searchTickets() {
  const seq = ++searchSeq;
  const q = $('#search').value.trim();
  const mine = $('#mine').checked ? '1' : '';
  const stateEl = $('#tickets-state');
  stateEl.hidden = false;
  stateEl.textContent = 'Suche…';
  try {
    const { tickets } = await api(`/tickets?q=${encodeURIComponent(q)}&mine=${mine}`);
    if (seq !== searchSeq) return;
    state.tickets = tickets;
    $('#tickets').innerHTML = tickets.map((t, i) => `
      <li class="clickable" data-i="${i}">
        <div class="grow">
          <div class="ticket-no">${esc(t.number)} ${t.customer ? `<span class="muted">· ${esc(t.customer)}</span>` : ''}</div>
          <div class="ticket-subject">${esc(t.subject)}</div>
        </div>
        ${t.status ? `<span class="status">${esc(t.status)}</span>` : ''}
        <button class="play" aria-label="Timer starten">▶</button>
      </li>`).join('');
    stateEl.hidden = tickets.length > 0;
    stateEl.textContent = 'Keine Tickets gefunden.';
  } catch (ex) {
    if (seq !== searchSeq) return;
    stateEl.textContent = ex.message;
  }
}

let debounce;
$('#search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(searchTickets, 300); });
$('#mine').addEventListener('change', searchTickets);

$('#tickets').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  const ticket = state.tickets[Number(li.dataset.i)];
  try {
    const r = await api('/timers', { method: 'POST', body: { ticket } });
    await loadTimers();
    toast(`Timer gestartet: ${ticket.number}${r.clockedIn ? ' · automatisch eingestempelt' : ''}`);
    if (r.clockedIn) loadWork().catch(() => {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (ex) { toast(ex.message, true); }
});

// ---------- Heute gebucht ----------
function renderHistory() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = state.history.filter((h) => h.bookedAt >= start.getTime());
  $('#history').innerHTML = today.map((h) => `
    <li>
      <div class="grow">
        <div class="ticket-no">${esc(h.ticket.number)}${h.ticket.customer ? ` · ${esc(h.ticket.customer)}` : ''}${h.billable ? '' : ' <span class="muted">· nicht abrechenbar</span>'}</div>
        <div class="ticket-subject">${esc(h.description)}</div>
      </div>
      <span class="dur">${fmtMin(h.minutes)}</span>
    </li>`).join('');
  $('#history-empty').hidden = today.length > 0;
  const total = today.reduce((s, h) => s + h.minutes, 0);
  $('#today-total').textContent = total ? fmtMin(total) : '';
  $('#today-total').hidden = !total;
}

// ---------- Buchungsdialog ----------
const dlg = $('#book-dialog');

function updateHours() {
  const m = Number($('#bk-minutes').value) || 0;
  $('#bk-hours').textContent = m ? `= ${(m / 60).toLocaleString('de-AT', { maximumFractionDigits: 2 })} h` : '';
}

async function openBooking(timer) {
  if (!timer) return;
  state.booking = timer;
  $('#bk-number').textContent = timer.ticket.number;
  $('#bk-subject').textContent = timer.ticket.subject;
  $('#bk-measured').textContent = fmtClock(elapsed(timer));
  $('#bk-minutes').value = roundUp(elapsed(timer));
  // Optionale Start-/Endzeit: vorbelegt mit Timer-Start und Start + Dauer
  const st = timer.segments[0]?.start ?? now();
  $('#bk-times').hidden = true;
  $('#bk-times-toggle').setAttribute('aria-expanded', 'false');
  $('#bk-times-toggle').textContent = 'Start/Ende anpassen';
  $('#bk-date').value = localDay(st);
  $('#bk-start').value = timeOf(st);
  syncEndFromMinutes();
  const nPhotos = timer.photos?.length || 0;
  $('#bk-desc').value = [timer.note || '', nPhotos ? `(${nPhotos} ${nPhotos === 1 ? 'Foto' : 'Fotos'} im Ticket angehängt)` : '']
    .filter(Boolean).join('\n');
  $('#bk-billable').checked = true;
  $('#bk-error').hidden = true;
  updateHours();
  dlg.showModal();
  setTimeout(() => $('#bk-desc').focus(), 50);

  const sel = $('#bk-target');
  const lbl = $('#bk-target-label');
  sel.innerHTML = '<option value="">Lädt…</option>';
  $('#bk-place-wrap').hidden = true;
  $('#bk-article-wrap').hidden = true;
  $('#bk-user-wrap').hidden = true;
  $('#bk-user').dataset.task = '';
  state.bookingMode = null;
  state.bookingTasks = [];
  const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  try {
    const o = await api(`/tickets/${encodeURIComponent(timer.ticket.id)}/options`);
    if (state.booking !== timer) return;
    if (o.tasks.length) {
      state.bookingMode = 'task';
      lbl.textContent = 'Aufgabe';
      const open = o.tasks.filter((t) => !t.done);
      const list = open.length ? open : o.tasks;
      sel.innerHTML = (list.length > 1 ? '<option value="">– bitte wählen –</option>' : '') +
        list.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}${t.article ? ` · ${esc(t.article)}` : ''}</option>`).join('');
      const lastTask = ls(`sit.lastTask.${timer.ticket.id}`);
      if (lastTask && list.some((t) => t.id === lastTask)) sel.value = lastTask;
      state.bookingTasks = list;
      if (o.articles.length) {
        const last = ls('sit.lastArticle');
        const as = $('#bk-article');
        as.innerHTML = '<option value="">– bitte wählen –</option>' +
          o.articles.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.number ? ` (${esc(x.number)})` : ''}</option>`).join('');
        if (last && o.articles.some((x) => x.id === last)) as.value = last;
        else if (o.articles.length === 1) as.value = o.articles[0].id;
      }
      updateArticleNeed();
    } else if (o.taskRequired) {
      state.bookingMode = 'task';
      lbl.textContent = 'Aufgabe';
      sel.innerHTML = '<option value="">Keine Aufgabe am Ticket</option>';
      showBookError('Dieses Ticket hat keine Dienstleistungsaufgabe. Bitte in weclapp eine Aufgabe anlegen, dann kann gebucht werden.');
    } else {
      state.bookingMode = 'article';
      lbl.textContent = 'Dienstleistung';
      const last = ls('sit.lastArticle');
      sel.innerHTML = '<option value="">– bitte wählen –</option>' +
        o.articles.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.number ? ` (${esc(x.number)})` : ''}</option>`).join('');
      if (last && o.articles.some((x) => x.id === last)) sel.value = last;
      else if (o.articles.length === 1) sel.value = o.articles[0].id;
    }
    if (o.places.length) {
      const ps = $('#bk-place');
      ps.innerHTML = '<option value="">– keiner –</option>' +
        o.places.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      const lastPlace = ls('sit.lastPlace');
      if (lastPlace && o.places.some((p) => p.id === lastPlace)) ps.value = lastPlace;
      $('#bk-place-wrap').hidden = false;
    }
  } catch (ex) {
    sel.innerHTML = '<option value="">Konnte nicht geladen werden</option>';
    showBookError(ex.message);
  }
}

// Zeigt die Dienstleistungs-Auswahl, wenn die gewählte Aufgabe keinen Artikel hat und abrechenbar gebucht wird
function needsArticle() {
  if (state.bookingMode !== 'task' || !$('#bk-billable').checked) return false;
  const t = state.bookingTasks.find((x) => x.id === $('#bk-target').value);
  return Boolean(t && !t.hasArticle);
}
function updateArticleNeed() {
  $('#bk-article-wrap').hidden = !needsArticle();
  updateAssignee();
}
$('#bk-target').addEventListener('change', updateArticleNeed);

// weclapp: Zeit nur für Bearbeiter der Aufgabe. Bin ich keiner -> mich hinzufügen oder für einen Bearbeiter buchen
function selectedTask() {
  return state.bookingMode === 'task' ? state.bookingTasks.find((x) => x.id === $('#bk-target').value) : null;
}
function assigneeChoiceNeeded() {
  const t = selectedTask();
  return Boolean(t && Array.isArray(t.assignees) && !t.assignees.some((a) => String(a.id) === String(state.user?.id)));
}
function updateAssignee() {
  const wrap = $('#bk-user-wrap');
  if (!assigneeChoiceNeeded()) { wrap.hidden = true; return; }
  const t = selectedTask();
  const sel = $('#bk-user');
  const key = t.id;
  if (sel.dataset.task !== key) {
    sel.innerHTML = `<option value="me">Ich (werde als Bearbeiter eingetragen)</option>` +
      t.assignees.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (Bearbeiter)</option>`).join('');
    sel.dataset.task = key;
  }
  const names = t.assignees.map((a) => a.name).join(', ') || 'niemand';
  $('#bk-user-hint').textContent = sel.value === 'me'
    ? `Du bist kein Bearbeiter dieser Aufgabe (Bearbeiter: ${names}). Du wirst beim Buchen hinzugefügt.`
    : 'Die Zeit wird auf diese Person gebucht, mit dem Vermerk „erfasst von …“ in der Beschreibung.';
  wrap.hidden = false;
}
$('#bk-user').addEventListener('change', updateAssignee);
$('#bk-billable').addEventListener('change', updateArticleNeed);

function closeBooking() {
  state.booking = null;
  dlg.close();
}

function showBookError(msg) {
  const el = $('#bk-error');
  el.textContent = msg;
  el.hidden = false;
}

// ---- Optionale Start-/Endzeit ----
const timesOpen = () => !$('#bk-times').hidden;
function bookingRange() {
  const d = $('#bk-date').value, s = $('#bk-start').value, e = $('#bk-end').value;
  if (!d || !s) return null;
  const start = atTime(d, s);
  let end = e ? atTime(d, e) : null;
  if (end != null && end <= start) end += 864e5; // über Mitternacht
  return { start, end };
}
function syncEndFromMinutes() {
  const r = bookingRange();
  if (!r) return;
  $('#bk-end').value = timeOf(r.start + (Number($('#bk-minutes').value) || 0) * 60000);
}
function syncMinutesFromTimes() {
  const r = bookingRange();
  if (!r || r.end == null) return;
  $('#bk-minutes').value = Math.max(1, Math.round((r.end - r.start) / 60000));
  updateHours();
}
$('#bk-times-toggle').addEventListener('click', () => {
  const open = !timesOpen();
  $('#bk-times').hidden = !open;
  $('#bk-times-toggle').setAttribute('aria-expanded', String(open));
  $('#bk-times-toggle').textContent = open ? 'Ohne Start/Ende buchen' : 'Start/Ende anpassen';
  if (open) syncEndFromMinutes();
});
$('#bk-start').addEventListener('change', syncMinutesFromTimes);
$('#bk-end').addEventListener('change', syncMinutesFromTimes);
$('#bk-date').addEventListener('change', syncMinutesFromTimes);

$('#bk-minutes').addEventListener('input', () => { updateHours(); syncEndFromMinutes(); });
dlg.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
  const inp = $('#bk-minutes');
  inp.value = Math.max(1, (Number(inp.value) || 0) + Number(b.dataset.step));
  updateHours();
  syncEndFromMinutes();
}));
$('#bk-close').addEventListener('click', closeBooking);
$('#bk-cancel').addEventListener('click', closeBooking);
dlg.addEventListener('cancel', () => { state.booking = null; });

$('#book-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = state.booking;
  if (!t) return;
  const body = {
    taskId: state.bookingMode === 'task' ? $('#bk-target').value : undefined,
    articleId: state.bookingMode === 'article' ? $('#bk-target').value : undefined,
    assignArticleId: needsArticle() ? ($('#bk-article').value || undefined) : undefined,
    addMeAsAssignee: assigneeChoiceNeeded() && $('#bk-user').value === 'me' ? true : undefined,
    bookForUserId: assigneeChoiceNeeded() && $('#bk-user').value !== 'me' ? $('#bk-user').value : undefined,
    placeOfServiceId: $('#bk-place-wrap').hidden ? undefined : ($('#bk-place').value || undefined),
    description: $('#bk-desc').value.trim(),
    durationMinutes: Number($('#bk-minutes').value),
    startTime: timesOpen() ? bookingRange()?.start : undefined,
    billable: $('#bk-billable').checked,
  };
  if (!body.description) return showBookError('Bitte eine Beschreibung eingeben.');
  if (timesOpen() && !body.startTime) return showBookError('Bitte Datum und Startzeit angeben.');
  if (body.startTime && body.startTime > now() + 5 * 60000) return showBookError('Die Startzeit liegt in der Zukunft.');
  if (!body.taskId && !body.articleId) return showBookError(state.bookingMode === 'article' ? 'Bitte eine Dienstleistung wählen.' : 'Bitte eine Aufgabe wählen.');
  if (needsArticle() && !body.assignArticleId) return showBookError('Die Aufgabe hat keinen Dienstleistungsartikel: bitte eine Dienstleistung wählen – oder „Abrechenbar“ abwählen.');
  const btn = $('#bk-submit');
  btn.disabled = true;
  btn.textContent = 'Buche…';
  try {
    await api(`/timers/${t.id}/book`, { method: 'POST', body });
    try {
      if (body.articleId || body.assignArticleId) localStorage.setItem('sit.lastArticle', body.articleId || body.assignArticleId);
      if (body.taskId) localStorage.setItem(`sit.lastTask.${t.ticket.id}`, body.taskId);
      if (body.placeOfServiceId) localStorage.setItem('sit.lastPlace', body.placeOfServiceId);
    } catch { /* egal */ }
    closeBooking();
    delete state.booked[t.ticket.id];
    loadBooked(t.ticket.id, true);
    toast(`✓ ${fmtMin(body.durationMinutes)} auf ${t.ticket.number} gebucht`);
    await loadTimers();
  } catch (ex) {
    showBookError(`Buchung fehlgeschlagen: ${ex.message}. Der Timer bleibt erhalten.`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'In weclapp buchen';
  }
});

// ---------- Sync zwischen Geräten ----------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) {
    loadTimers().catch(() => {});
    loadWork().catch(() => {});
  }
});
setInterval(() => {
  if (state.user && document.visibilityState === 'visible' && !document.activeElement?.dataset?.note) {
    loadTimers().catch(() => {});
    if (work.tab === 'work' && !document.querySelector('dialog[open]')) loadWork().catch(() => {});
  }
}, 30000);

// ============================================================
// ---------- Arbeitszeit & Abwesenheiten ----------
// ============================================================
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const work = { data: null, week: null, dayDate: null, tab: 'tickets' };

const hm = (min) => {
  const neg = min < 0; min = Math.abs(Math.round(min));
  return `${neg ? '−' : ''}${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
};
const signedHm = (min) => (min > 0 ? '+' : '') + hm(min);
const fmtDay = (d, opts = { weekday: 'short', day: '2-digit', month: '2-digit' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('de-AT', opts);
const timeOf = (ms) => new Date(ms).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
const localDay = (ms = now()) => {
  const x = new Date(ms);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
function shiftDay(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return localDay(x.getTime()); }
const atTime = (d, hhmm) => new Date(`${d}T${hhmm}:00`).getTime();

function selectTab(tab) {
  work.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#view-tickets').hidden = tab !== 'tickets';
  $('#view-work').hidden = tab !== 'work';
  try { localStorage.setItem('sit.tab', tab); } catch { /* egal */ }
  if (tab === 'work') loadWork().catch((e) => toast(e.message, true));
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

async function loadWork() {
  const q = work.week ? `?week=${work.week}` : '';
  setWork(await api('/work' + q));
}
function setWork(d) {
  work.data = d;
  work.week = d.weekStart;
  renderWork();
  if (work.dayDate) renderDayDialog();
}

// Heutige Ist-Zeit live mitrechnen (Server liefert Stand zum Abrufzeitpunkt)
function todayIstMin() {
  const d = work.data;
  if (!d) return 0;
  const t = d.today;
  return t.entries.reduce((s, e) => s + ((e.end ?? now()) - e.start), 0) / 60000;
}

function renderWorkClock() {
  const d = work.data;
  if (!d) return;
  const st = d.status;
  const card = $('#workclock');
  card.classList.toggle('running', st === 'work');
  card.classList.toggle('break', st === 'break');
  $('#wc-date').textContent = fmtDay(d.today.date, { weekday: 'long', day: '2-digit', month: 'long' });
  const ist = todayIstMin();
  const first = d.today.entries[0];
  $('#wc-status').textContent = st === 'work' ? 'Eingestempelt' : st === 'break' ? 'Pause' : (d.today.entries.length ? 'Ausgestempelt' : 'Nicht eingestempelt');
  const parts = [];
  if (first) parts.push(`seit ${timeOf(first.start)}`);
  const brk = d.today.breakMin; // Server rechnet eine laufende Pause mit ein
  if (brk) parts.push(`Pause ${hm(brk)}`);
  if (d.today.absence) parts.push(d.today.absence.label + (d.today.absence.half ? ' (½)' : ''));
  if (d.today.holiday) parts.push(d.today.holiday);
  $('#wc-sub').textContent = parts.join(' · ');
  $('#wc-clock').textContent = hm(ist);
  const soll = d.today.sollMin;
  $('#wc-soll').textContent = soll ? `Soll ${hm(soll)} · ${signedHm(ist + d.today.creditMin - soll)}` : 'kein Soll';

  const acts = $('#wc-actions');
  const html = st === 'work'
    ? `<button class="btn pause" data-clock="pause">❚❚ Pause</button><button class="btn primary" data-clock="out">■ Gehen</button>`
    : st === 'break'
      ? `<button class="btn run" data-clock="resume">▶ Weiter</button><button class="btn primary" data-clock="out">■ Gehen</button>`
      : `<button class="btn run block" data-clock="in">▶ Kommen</button>`;
  if (acts.dataset.st !== st) { acts.innerHTML = html; acts.dataset.st = st; }

  const sync = $('#wc-sync');
  if (d.weclapp) {
    sync.hidden = false;
    sync.classList.toggle('err', !d.weclapp.ok);
    sync.textContent = d.weclapp.ok ? '✓ mit weclapp-Arbeitszeit synchronisiert' : `⚠ weclapp-Arbeitszeit nicht erreichbar: ${d.weclapp.error}`;
  } else sync.hidden = true;

  const dot = $('#work-dot');
  dot.hidden = st === 'off';
  dot.classList.toggle('break', st === 'break');
}

function renderWork() {
  const d = work.data;
  renderWorkClock();
  const bal = $('#st-balance');
  bal.textContent = signedHm(d.balanceMin) + ' h';
  bal.className = 'stat-value ' + (d.balanceMin > 0 ? 'pos' : d.balanceMin < 0 ? 'neg' : '');
  const v = d.vacation;
  $('#st-year').textContent = v.year;
  $('#st-vacation').textContent = `${String(v.remaining).replace('.', ',')} Tage`;
  $('#st-vacation-sub').textContent = `von ${String(v.entitlement).replace('.', ',')} · ${String(v.planned).replace('.', ',')} geplant`;

  const today = d.today.date;
  $('#wk-label').textContent = `${fmtDay(d.week[0].date, { day: '2-digit', month: '2-digit' })} – ${fmtDay(d.week[6].date, { day: '2-digit', month: '2-digit' })}`;
  $('#week').innerHTML = d.week.map((w) => {
    const ist = w.date === today ? todayIstMin() : w.istMin;
    const diff = ist + w.creditMin - w.sollMin;
    const off = !w.sollMin && !ist;
    const info = [
      w.absence ? `<span class="badge-abs ${esc(w.absence.type)}">${esc(w.absence.label)}${w.absence.half ? ' ½' : ''}</span>` : '',
      w.holiday ? esc(w.holiday) : '',
      w.entries.length ? w.entries.map((e) => `${timeOf(e.start)}–${e.end ? timeOf(e.end) : '…'}`).join(', ') : '',
    ].filter(Boolean).join(' ');
    const showDiff = w.date <= today && (w.sollMin || ist);
    return `<li class="clickable ${w.date === today ? 'today' : ''} ${off ? 'off' : ''}" data-day="${w.date}">
      <span class="w-day">${WD[w.weekday]} ${fmtDay(w.date, { day: '2-digit', month: '2-digit' })}</span>
      <span class="w-info">${info || (w.sollMin || w.beforeStart ? '' : '<span class="muted">frei</span>')}</span>
      <span class="w-diff ${showDiff ? (diff > 0 ? 'pos' : diff < 0 ? 'neg' : '') : ''}">${showDiff ? signedHm(diff) : ''}</span>
      <span class="dur">${ist ? hm(ist) : (w.sollMin ? '–' : '')}</span>
    </li>`;
  }).join('');
  const wIst = d.week.reduce((s, w) => s + (w.date === today ? todayIstMin() : w.istMin), 0);
  const wSoll = d.week.reduce((s, w) => s + w.sollMin, 0);
  const wCredit = d.week.reduce((s, w) => s + w.creditMin, 0);
  $('#wk-sum').textContent = `Woche: Ist ${hm(wIst)}${wCredit ? ` + ${hm(wCredit)} Abwesenheit` : ''} · Soll ${hm(wSoll)}`;

  $('#absences').innerHTML = d.absences.map((a) => `
    <li>
      <div class="grow">
        <div class="ticket-no"><span class="badge-abs ${esc(a.type)}">${esc(a.label)}</span>${a.days ? `${String(a.days).replace('.', ',')} ${a.days === 1 ? 'Tag' : 'Tage'}` : ''}</div>
        <div class="ticket-subject">${a.from === a.to ? fmtDay(a.from, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) + (a.half ? ' (halber Tag)' : '') : `${fmtDay(a.from, { day: '2-digit', month: '2-digit', year: 'numeric' })} – ${fmtDay(a.to, { day: '2-digit', month: '2-digit', year: 'numeric' })}`}</div>
        ${a.note ? `<div class="ticket-customer">${esc(a.note)}</div>` : ''}
      </div>
      <button class="btn ghost danger small" data-abs-del="${esc(a.id)}" title="Löschen">🗑</button>
    </li>`).join('');
  $('#absences-empty').hidden = d.absences.length > 0;
}

$('#wc-actions').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-clock]');
  if (!b) return;
  b.disabled = true;
  try {
    const d = await api('/work/clock', { method: 'POST', body: { action: b.dataset.clock, week: work.week } });
    setWork(d);
    if (b.dataset.clock === 'pause' || b.dataset.clock === 'out') loadTimers().catch(() => {});
    toast({ in: 'Eingestempelt', resume: 'Weiter geht’s', pause: 'Pause – Ticket-Timer angehalten', out: 'Ausgestempelt – schönen Feierabend!' }[b.dataset.clock]);
  } catch (ex) { toast(ex.message, true); } finally { b.disabled = false; }
});

$('#wk-prev').addEventListener('click', () => { work.week = shiftDay(work.week, -7); loadWork().catch((e) => toast(e.message, true)); });
$('#wk-next').addEventListener('click', () => { work.week = shiftDay(work.week, 7); loadWork().catch((e) => toast(e.message, true)); });

// ---- Tag korrigieren ----
const dayDlg = $('#day-dialog');
$('#week').addEventListener('click', (e) => {
  const li = e.target.closest('[data-day]');
  if (!li) return;
  work.dayDate = li.dataset.day;
  $('#day-error').hidden = true;
  $('#day-from').value = ''; $('#day-to').value = '';
  renderDayDialog();
  dayDlg.showModal();
});
function renderDayDialog() {
  const w = work.data.week.find((x) => x.date === work.dayDate);
  $('#day-title').textContent = fmtDay(work.dayDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const entries = w?.entries || [];
  $('#day-entries').innerHTML = entries.map((e) => `
    <li data-entry="${esc(e.id)}">
      <input type="time" value="${timeOf(e.start)}" data-f="start" aria-label="Beginn">
      <span>–</span>
      ${e.end ? `<input type="time" value="${timeOf(e.end)}" data-f="end" aria-label="Ende">` : '<span class="muted">läuft</span>'}
      <span>
        <button type="button" class="btn ghost small" data-entry-save title="Speichern">✓</button>
        <button type="button" class="btn ghost danger small" data-entry-del title="Löschen">🗑</button>
      </span>
    </li>`).join('');
  $('#day-empty').hidden = entries.length > 0;
}
function dayError(msg) { const el = $('#day-error'); el.textContent = msg; el.hidden = false; }
$('#day-entries').addEventListener('click', async (e) => {
  const li = e.target.closest('[data-entry]');
  if (!li) return;
  const id = li.dataset.entry;
  try {
    if (e.target.closest('[data-entry-del]')) {
      if (!confirm('Eintrag löschen?')) return;
      await api(`/work/entries/${id}`, { method: 'DELETE' });
    } else if (e.target.closest('[data-entry-save]')) {
      const s = li.querySelector('[data-f=start]').value;
      const en = li.querySelector('[data-f=end]')?.value;
      let end = en ? atTime(work.dayDate, en) : undefined;
      if (end && end <= atTime(work.dayDate, s)) end += 864e5; // über Mitternacht
      await api(`/work/entries/${id}`, { method: 'PUT', body: { start: atTime(work.dayDate, s), end } });
      toast('Gespeichert');
    } else return;
    $('#day-error').hidden = true;
    await loadWork();
  } catch (ex) { dayError(ex.message); }
});
$('#day-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('#day-from').value, to = $('#day-to').value;
  if (!from || !to) return dayError('Bitte Beginn und Ende angeben.');
  let end = atTime(work.dayDate, to);
  const start = atTime(work.dayDate, from);
  if (end <= start) end += 864e5;
  try {
    await api('/work/entries', { method: 'POST', body: { start, end } });
    $('#day-from').value = ''; $('#day-to').value = '';
    $('#day-error').hidden = true;
    await loadWork();
  } catch (ex) { dayError(ex.message); }
});
dayDlg.addEventListener('close', () => { work.dayDate = null; });

// ---- Abwesenheit ----
const absDlg = $('#abs-dialog');
function updateAbsForm() {
  const one = $('#abs-from').value && $('#abs-from').value === $('#abs-to').value;
  $('#abs-half-wrap').hidden = !one;
  if (!one) $('#abs-half').checked = false;
  const t = $('#abs-type').value;
  $('#abs-info').textContent = t === 'za'
    ? 'Zeitausgleich baut Überstunden ab (kein Zeitgutschrift).'
    : t === 'urlaub' ? 'Wird vom Urlaubsanspruch abgezogen (nur Arbeitstage, ohne Feiertage).' : 'Die Sollzeit wird gutgeschrieben.';
}
$('#abs-new').addEventListener('click', () => {
  const types = work.data?.types || {};
  $('#abs-type').innerHTML = Object.entries(types).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const t = localDay();
  $('#abs-from').value = t; $('#abs-to').value = t;
  $('#abs-note').value = ''; $('#abs-half').checked = false;
  $('#abs-error').hidden = true;
  updateAbsForm();
  absDlg.showModal();
});
$('#abs-type').addEventListener('change', updateAbsForm);
$('#abs-from').addEventListener('change', () => {
  if (!$('#abs-to').value || $('#abs-to').value < $('#abs-from').value) $('#abs-to').value = $('#abs-from').value;
  updateAbsForm();
});
$('#abs-to').addEventListener('change', updateAbsForm);
$('#abs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/work/absences', { method: 'POST', body: {
      type: $('#abs-type').value, from: $('#abs-from').value, to: $('#abs-to').value,
      half: $('#abs-half').checked, note: $('#abs-note').value.trim(),
    } });
    absDlg.close();
    toast('Abwesenheit eingetragen');
    await loadWork();
  } catch (ex) { const el = $('#abs-error'); el.textContent = ex.message; el.hidden = false; }
});
$('#absences').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-abs-del]');
  if (!b || !confirm('Abwesenheit löschen?')) return;
  try { await api(`/work/absences/${b.dataset.absDel}`, { method: 'DELETE' }); await loadWork(); } catch (ex) { toast(ex.message, true); }
});

// ---- Einstellungen ----
const setDlg = $('#set-dialog');
$('#work-settings').addEventListener('click', () => {
  const s = work.data.settings;
  $('#set-hours').value = s.weeklyHours;
  $('#set-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((n) =>
    `<label><input type="checkbox" value="${n}" ${s.workdays.includes(n) ? 'checked' : ''}> ${WD[n]}</label>`).join('');
  $('#set-vac').value = s.vacationDays;
  $('#set-carry').value = s.vacationCarry;
  $('#set-start').value = s.startDate;
  $('#set-balance').value = Math.round((s.startBalanceMin / 60) * 100) / 100;
  $('#set-error').hidden = true;
  setDlg.showModal();
});
$('#set-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/work/settings', { method: 'PUT', body: {
      weeklyHours: Number($('#set-hours').value),
      workdays: [...$('#set-days').querySelectorAll('input:checked')].map((i) => Number(i.value)),
      vacationDays: Number($('#set-vac').value),
      vacationCarry: Number($('#set-carry').value),
      startDate: $('#set-start').value,
      startBalanceMin: Math.round(Number($('#set-balance').value) * 60),
    } });
    setDlg.close();
    toast('Gespeichert');
    await loadWork();
  } catch (ex) { const el = $('#set-error'); el.textContent = ex.message; el.hidden = false; }
});

// Schließen-Buttons aller Arbeitszeit-Dialoge
for (const dl of [dayDlg, absDlg, setDlg]) dl.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dl.close()));

// Live-Uhr
setInterval(() => {
  if (work.data && work.data.status === 'work' && work.tab === 'work') {
    $('#wc-clock').textContent = hm(todayIstMin());
    const row = document.querySelector(`#week [data-day="${work.data.today.date}"] .dur`);
    if (row) row.textContent = hm(todayIstMin());
  }
}, 15000);

// ---------- Start ----------
(async () => {
  try {
    const me = await api('/me');
    state.user = me.user;
    state.settings = me.settings;
    state.version = me.version;
    showApp();
  } catch {
    showLogin();
  }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/zeiten/sw.js', { scope: '/zeiten/' }).catch(() => {});
