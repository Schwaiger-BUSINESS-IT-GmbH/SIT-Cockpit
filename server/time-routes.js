// SIT-Time (Ticket-Zeiterfassung + Arbeitszeit) als Modul im Cockpit.
// Routen 1:1 aus SIT-Time übernommen; Login/Session teilt sich das Cockpit.
import express from 'express';
import { config } from './config.js';
import * as wc from './weclapp.js';
import * as store from './store.js';
import * as work from './worktime.js';

export function registerTimeRoutes(api, h) {
  // ---------- weclapp-Daten ----------
  api.get('/tickets', h(async (req, res) => {
    const tickets = await wc.searchTickets(req.session.token, {
      q: req.query.q, mine: req.query.mine === '1', userId: req.session.userId,
    });
    res.json({ tickets });
  }));
  
  api.get('/tickets/:id/booked', h(async (req, res) => {
    res.json(await wc.ticketBookedTimes(req.session.token, req.params.id, req.session.userId));
  }));
  
  api.get('/debug/hr', h(async (req, res) => res.json(await wc.hrEndpoints(req.session.token, req.query.detail === '1'))));
  api.get('/debug/documents', h(async (req, res) => res.json(await wc.documentEndpoints(req.session.token))));
  
  api.get('/debug/timerecord', h(async (req, res) => {
    if (req.query.ticket) return res.json(await wc.diagnoseTicket(req.session.token, req.query.ticket));
    res.json({ baseUrl: config.weclappBaseUrl, fields: await wc.timeRecordShape(req.session.token, req.query.ticketId) });
  }));
  
  // Buchungsoptionen für ein Ticket: Aufgaben (v2), Leistungsorte, ggf. Artikel-Fallback
  api.get('/tickets/:id/options', h(async (req, res) => {
    const token = req.session.token;
    const [tasks, places, fields] = await Promise.all([
      wc.ticketTasks(token, req.params.id).catch(() => []),
      wc.placesOfService(token),
      wc.timeRecordNeedsTask(token),
    ]);
    // Artikel auch laden, wenn eine Aufgabe keinen Dienstleistungsartikel hat (wird dann beim Buchen gesetzt)
    const needArticles = (!tasks.length && fields.articleId !== false) || tasks.some((t) => !t.hasArticle);
    const articles = needArticles ? await wc.serviceArticles(token).catch(() => []) : [];
    res.json({ tasks, places, articles, taskRequired: fields.taskId === true });
  }));
  
  api.get('/articles', h(async (req, res) => {
    res.json({ articles: await wc.serviceArticles(req.session.token) });
  }));
  
  // ---------- Timer ----------
  const uid = (req) => req.session.userId;
  
  api.get('/timers', (req, res) => res.json(store.listTimers(uid(req))));
  
  api.post('/timers', h(async (req, res) => {
    const t = req.body?.ticket;
    if (!t?.id) return res.status(400).json({ error: 'Ticket fehlt' });
    const ticket = { id: String(t.id), number: t.number || '', subject: t.subject || '', customer: t.customer || '' };
    const timer = await store.startTimer(uid(req), ticket);
    // Wer an einem Ticket startet, arbeitet -> automatisch einstempeln
    const clockedIn = await clockInIfNeeded(req);
    res.json({ ...timer, clockedIn });
  }));
  
  api.post('/timers/:id/pause', h(async (req, res) => res.json(await store.pauseTimer(uid(req), req.params.id))));
  api.post('/timers/:id/resume', h(async (req, res) => {
    const timer = await store.resumeTimer(uid(req), req.params.id);
    const clockedIn = await clockInIfNeeded(req);
    res.json({ ...timer, clockedIn });
  }));
  api.post('/timers/:id/stop', h(async (req, res) => res.json(await store.stopTimer(uid(req), req.params.id))));
  api.patch('/timers/:id', h(async (req, res) => res.json(await store.updateNote(uid(req), req.params.id, req.body?.note))));
  api.delete('/timers/:id', h(async (req, res) => { await store.discardTimer(uid(req), req.params.id); res.json({ ok: true }); }));
  
  // Foto zum Ticket hochladen (Bild wird im Browser bereits verkleinert)
  api.post('/timers/:id/photos', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }), h(async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: 'Kein Bild empfangen' });
    const timer = store.getTimer(uid(req), req.params.id);
    const n = (timer.photos?.length || 0) + 1;
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    const ext = /png/.test(req.get('content-type') || '') ? 'png' : 'jpg';
    const fileName = `${timer.ticket.number || timer.ticket.id}_${stamp}_${n}.${ext}`.replace(/[^\w.-]+/g, '_');
    const doc = await wc.uploadTicketDocument(req.session.token, {
      ticketId: timer.ticket.id,
      fileName,
      contentType: req.get('content-type'),
      data: req.body,
      description: `Foto von ${req.session.name} via SIT-Time`,
    });
    const updated = await store.addPhoto(uid(req), timer.id, { name: fileName, at: Date.now(), documentId: doc?.id || null, size: req.body.length });
    res.json({ ok: true, fileName, photos: updated.photos.length });
  }));
  
  // Timer als Zeiterfassung ins weclapp-Ticket zurückschreiben
  api.post('/timers/:id/book', h(async (req, res) => {
    const { startTime, taskId, articleId, assignArticleId, bookForUserId, addMeAsAssignee, placeOfServiceId, description, durationMinutes, billable = true } = req.body || {};
    const desc = String(description || '').trim();
    const minutes = Number(durationMinutes);
    if (!desc) return res.status(400).json({ error: 'Beschreibung ist Pflicht' });
    if (!taskId && !articleId) return res.status(400).json({ error: 'Bitte Aufgabe bzw. Dienstleistung auswählen' });
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      return res.status(400).json({ error: 'Ungültige Dauer' });
    }
    if (startTime != null && startTime !== '') {
      const st = Number(startTime);
      if (!Number.isFinite(st) || st > Date.now() + 5 * 60000) return res.status(400).json({ error: 'Ungültige Startzeit' });
      if (st < Date.now() - 60 * 864e5) return res.status(400).json({ error: 'Startzeit liegt mehr als 60 Tage zurück' });
    }
  
    // Aufgabe ohne Dienstleistungsartikel: gewählten Artikel zuerst an der Aufgabe hinterlegen
    // Aufgabe gehört jemand anderem: mich als Bearbeiter hinzufügen (sonst lehnt weclapp die Zeit ab)
    let assignee = null;
    if (taskId && addMeAsAssignee) {
      try {
        assignee = await wc.addTaskAssignee(req.session.token, String(taskId), req.session.userId);
      } catch (e) {
        throw Object.assign(new Error(`Konnte dich nicht als Bearbeiter der Aufgabe eintragen: ${e.message}`), { status: 502 });
      }
    }
    const forOther = bookForUserId && String(bookForUserId) !== String(req.session.userId);
    const bookingUserId = forOther ? String(bookForUserId) : req.session.userId;
    const recordDesc = forOther ? `${desc}\n(erfasst von ${req.session.name})` : desc;
  
    let assigned = null;
    if (taskId && assignArticleId && billable) {
      try {
        assigned = await wc.setTaskArticle(req.session.token, String(taskId), String(assignArticleId));
      } catch (e) {
        if (assignee?.changed) await assignee.undo();
        throw Object.assign(new Error(`Dienstleistung konnte nicht an der Aufgabe hinterlegt werden: ${e.message}`), { status: 502 });
      }
    }
  
    const timer = await store.stopTimer(uid(req), req.params.id);
    // Optional abweichender Beginn (Start/Ende im Dialog angepasst), max. 60 Tage zurück
    const custom = Number(startTime);
    const startDate = Number.isFinite(custom) && custom > Date.now() - 60 * 864e5 && custom <= Date.now() + 5 * 60000
      ? custom
      : timer.segments[0]?.start ?? Date.now();
    let record;
    try {
      record = await wc.createTimeRecord(req.session.token, {
        userId: bookingUserId,
        ticketId: timer.ticket.id,
        taskId: taskId ? String(taskId) : undefined,
        articleId: articleId ? String(articleId) : undefined,
        placeOfServiceId: placeOfServiceId ? String(placeOfServiceId) : undefined,
        description: recordDesc,
        startDate,
        durationSeconds: Math.round(minutes * 60),
        billable: Boolean(billable),
      });
    } catch (e) {
      // Buchung gescheitert -> gerade gesetzten Artikel an der Aufgabe wieder entfernen
      if (assigned?.changed) await assigned.undo();
      if (assignee?.changed) await assignee.undo();
      throw e;
    }
  
    await store.completeTimer(uid(req), timer.id, {
      id: record?.id,
      ticket: timer.ticket,
      description: desc,
      minutes,
      billable: Boolean(billable),
      startDate,
      bookedAt: Date.now(),
    });
    res.json({ ok: true, timeRecordId: record?.id });
  }));
  
  // ---------- Arbeitszeit & Abwesenheiten ----------
  // weclapp-Arbeitszeit (/attendance) ist führend; lokal wird nachgezogen
  async function syncAttendance(req) {
    if (!config.weclappAttendance) return null;
    try {
      const r = await wc.currentAttendance(req.session.token);
      await work.reconcile(uid(req), r);
      return { ok: true, state: r.state };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  
  // Beim Start eines Ticket-Timers einstempeln (weclapp + lokal). Fehler blockieren den Timer nicht.
  async function clockInIfNeeded(req) {
    try {
      if (config.weclappAttendance) {
        const cur = await wc.currentAttendance(req.session.token);
        if (cur.state === 'work') { await work.reconcile(uid(req), cur); return false; }
        const r = await wc.attendanceAction(req.session.token, 'in', req.session.userId);
        await work.reconcile(uid(req), r);
        return true;
      }
      return await work.ensureClockedIn(uid(req));
    } catch (e) {
      console.error('Automatisches Einstempeln fehlgeschlagen:', e.message);
      return false;
    }
  }
  
  api.get('/work', h(async (req, res) => {
    const weclapp = await syncAttendance(req);
    res.json({ ...work.overview(uid(req), req.query.week), weclapp });
  }));
  
  api.get('/debug/attendance', h(async (req, res) => res.json(await wc.attendanceDebug(req.session.token))));
  
  api.post('/work/clock', h(async (req, res) => {
    const action = String(req.body?.action || '');
    let weclapp = null;
    if (config.weclappAttendance) {
      try {
        const r = await wc.attendanceAction(req.session.token, action, req.session.userId);
        await work.reconcile(uid(req), r);
        weclapp = { ok: true, state: r.state };
      } catch (e) {
        if (e.status === 400 && !(e instanceof wc.WeclappError)) throw e;
        throw Object.assign(new Error(`weclapp-Arbeitszeit: ${e.message}`), { status: 502 });
      }
    } else {
      await work.clock(uid(req), action);
    }
    // Pause/Gehen hält laufende Ticket-Timer an
    if (action === 'pause' || action === 'out') {
      for (const t of store.listTimers(uid(req)).timers) if (t.running) await store.pauseTimer(uid(req), t.id);
    }
    res.json({ ...work.overview(uid(req), req.body?.week), weclapp });
  }));
  
  api.post('/work/entries', h(async (req, res) => { await work.addEntry(uid(req), req.body || {}); res.json({ ok: true }); }));
  api.put('/work/entries/:id', h(async (req, res) => { await work.updateEntry(uid(req), req.params.id, req.body || {}); res.json({ ok: true }); }));
  api.delete('/work/entries/:id', h(async (req, res) => { await work.deleteEntry(uid(req), req.params.id); res.json({ ok: true }); }));
  
  api.post('/work/absences', h(async (req, res) => res.json(await work.addAbsence(uid(req), req.body || {}))));
  api.delete('/work/absences/:id', h(async (req, res) => { await work.deleteAbsence(uid(req), req.params.id); res.json({ ok: true }); }));
  
  api.put('/work/settings', h(async (req, res) => { await work.saveSettings(uid(req), req.body || {}); res.json({ ok: true }); }));
  
}
