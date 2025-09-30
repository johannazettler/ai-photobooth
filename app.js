(function () {
  const V = 'AI HUB Photobooth v13.2.1 (2025-09-22)';

  // ===== Konfig =====
  const safeMarginX = 150;   // px Abstand vom linken Rand (Druck-Sicherheitsrand)
  const safeMarginY = 32;    // px Abstand vom unteren Rand (Druck-Sicherheitsrand)
  const maxLogoRel  = 0.18;  // max. 18% der jeweiligen Kantenlänge

  // Logo-Rechteck: skaliert das Bild proportional und platziert es unten links
  function computeLogoRect(canvasW, canvasH, imgW, imgH) {
    const maxW = Math.round(canvasW * maxLogoRel);
    const maxH = Math.round(canvasH * maxLogoRel);
    const s = Math.min(maxW / imgW, maxH / imgH, 1);
    const w = Math.round(imgW * s);
    const h = Math.round(imgH * s);
    const x = safeMarginX;
    const y = canvasH - safeMarginY - h;
    return { x, y, w, h };
  }

  // ===== Helpers für DOM =====
  const el = (id) => document.getElementById(id);
  const S = {
    preview: el('screenPreview'), captured: el('screenCaptured'), style: el('screenStyle'), gen: el('screenGenerate'), result: el('screenResult'),
    video: el('video'), canvas: el('canvas'), count: el('count'), flash: el('flash'),
    shoot: el('shootBtn'), cont: el('continueBtn'), retry: el('retryBtn'),
    styleGrid: el('styleGrid'), custom: el('customStyle'), startGen: el('startGenBtn'), prompt: el('promptOut'), resultBox: el('resultBox'),
    finalImg: el('finalImg'), print: el('printBtn'), share: el('shareBtn'), /* gmail: el('gmailBtn'), */ restartBig: el('restartBigBtn'),
    restyle: el('restyleBtn'),
    reuseNote: el('reuseNote'),
    restartFab: el('restartFab'), settingsFab: el('settingsFab'), settings: el('settings'), closeSettings: el('closeSettings'),
    cameraSel: el('cameraSel'), apiKey: el('apiKey'), version: el('versionText'),
    onboard: el('onboard'), obCamera: el('obCamera'), obGrantCam: el('obGrantCam'), obApiKey: el('obApiKey'), obDone: el('obDone'), obMissing: el('obMissing'), obDriveStatus: el('obDriveStatus'),
    driveConn: el('driveConnect'), driveStatus: el('driveStatus'),
    qr: el('qrModal'), qrBox: el('qrBox'), qrLink: el('qrLink'), qrClose: el('qrClose'),
    logoFile: document.getElementById('logoFile'),
    logoPreview: document.getElementById('logoPreview'),
    logoClear: document.getElementById('logoClear'),
    obDriveConn: el('obDriveConnect'),
  };

  // ===== State =====
  let logoData = localStorage.getItem('pb_logo_data') || null;  // Data-URL
  let logoImg = null;                                           // gecachtes Image
  let stream = null, devices = [], perm = 'prompt';
  const styles = ['Puppet Style', 'Anime', 'Studio Ghibli', 'Simpsons', 'Ninja Turtles', '90s Aesthetic', 'LEGO Style', 'Black and White 4K', 'Vintage Travel Poster' ];
  let chosen = styles[0];
  let capturedData = null;  // gespeichertes Foto

  // Drive state
  const drive = { clientId: '', token: null, tokenClient: null, authorized: (localStorage.getItem('drive_authorized') === '1') };
  let driveFolder = JSON.parse(localStorage.getItem('drive_folder') || 'null');

  // ===== Utils =====
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isLocal = () => ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const show = (node) => node.classList.add('active');
  const hide = (node) => node.classList.remove('active');
  function showScreen(name) {
    [S.preview, S.captured, S.style, S.gen, S.result].forEach(hide);
    ({ preview: show, captured: show, style: show, gen: show, result: show })[name](
      { preview: S.preview, captured: S.captured, style: S.style, gen: S.gen, result: S.result }[name]
    );
    if (name === 'preview') ensurePreview();
  }
  const active = () => !!(stream && stream.getTracks().some(t => t.readyState === 'live'));
  function stopCam() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }

  // ===== Logo setzen & cachen =====
  function setLogo(dataUrl) {
    logoData = dataUrl;
    if (dataUrl) {
      localStorage.setItem('pb_logo_data', dataUrl);
      S.logoPreview.src = dataUrl;
      logoImg = new Image(); logoImg.src = dataUrl;
    } else {
      localStorage.removeItem('pb_logo_data');
      S.logoPreview.removeAttribute('src');
      logoImg = null;
    }
  }

  // ===== Kamera =====
  async function listCams() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      devices = devs.filter(d => d.kind === 'videoinput');
      const opts = ['<option value="">(Standard)</option>'].concat(
        devices.map(d => `<option value="${d.deviceId}">${d.label || 'Kamera'}</option>`)
      ).join('');
      S.cameraSel.innerHTML = opts;
      S.obCamera.innerHTML = opts;
    } catch (e) {
      console.warn('enumerateDevices fehlgeschlagen:', e);
    }
  }

  async function startCam() {
    try {
      const id = sessionStorage.getItem('camera_id') || '';
      const constraints = {
        audio: false,
        video: id ? { deviceId: { exact: id } } : { facingMode: 'user' }
      };
      stopCam();
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      S.video.srcObject = stream;
      sessionStorage.setItem('pb_perm_granted', '1');
      return true;
    } catch (e) {
      console.error('getUserMedia fehlgeschlagen:', e);
      alert('Kamera konnte nicht gestartet werden. Bitte Berechtigung prüfen.');
      return false;
    }
  }

  async function ensurePreview() {
    if (active()) return;
    const ok = sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted';
    if (ok) { await startCam(); await waitReady(); }
  }

  async function waitReady(timeout = 8000) {
    if (S.video.readyState >= 2 && S.video.videoWidth && S.video.videoHeight) return true;
    return await new Promise(res => {
      const on = () => { if (S.video.videoWidth && S.video.videoHeight) { off(); res(true); } };
      const off = () => { S.video.removeEventListener('loadedmetadata', on); S.video.removeEventListener('canplay', on); };
      S.video.addEventListener('loadedmetadata', on);
      S.video.addEventListener('canplay', on);
      setTimeout(() => { off(); res(false); }, timeout);
    });
  }

  // ===== Aufnahme / Zeichnen =====
  function draw() {
    if (!S.video.videoWidth || !S.video.videoHeight) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = S.video.videoWidth;
    const H = S.video.videoHeight;
    const cw = 1800, ch = 1200; // 3:2
    S.canvas.width = cw * dpr; S.canvas.height = ch * dpr;
    const ctx = S.canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Video proportional in 3:2 einpassen (cover)
    const rVid = W / H, rCan = cw / ch;
    let sx = 0, sy = 0, sw = W, sh = H;
    if (rVid > rCan) { // Video zu breit
      const targetW = H * rCan;
      sx = (W - targetW) / 2;
      sw = targetW;
    } else { // Video zu hoch
      const targetH = W / rCan;
      sy = (H - targetH) / 2;
      sh = targetH;
    }
    ctx.drawImage(S.video, sx, sy, sw, sh, 0, 0, cw, ch);

    // Wasserzeichen / Logo
    if (logoImg) {
      const { x, y, w, h } = computeLogoRect(cw, ch, logoImg.naturalWidth || logoImg.width, logoImg.naturalHeight || logoImg.height);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logoImg, x, y, w, h);
      ctx.restore();
    } else {
      // Fallback-Label
      const ctx2 = ctx;
      ctx2.save();
      ctx2.globalAlpha = .65;
      ctx2.fillStyle = '#1f2937';
      ctx2.font = 'bold 28px system-ui,Segoe UI,Roboto';
      const x = safeMarginX, y = ch - safeMarginY - 22;
      ctx2.fillText('AI Hub', x, y);
      ctx2.restore();
    }
  }

  async function shutter() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ac = new AC(); const out = ac.createGain(); out.gain.value = .8; out.connect(ac.destination);
    const osc = ac.createOscillator(); osc.type = 'square'; const og = ac.createGain();
    og.gain.setValueAtTime(.0001, ac.currentTime); og.gain.exponentialRampToValueAtTime(.6, ac.currentTime + .006);
    og.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .09);
    osc.frequency.setValueAtTime(190, ac.currentTime); osc.connect(og).connect(out);
    const nb = ac.createBuffer(1, ac.sampleRate * .04, ac.sampleRate); const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const noise = ac.createBufferSource(); noise.buffer = nb; const ng = ac.createGain(); ng.gain.value = .45; noise.connect(ng).connect(out);
    osc.start(); noise.start(); osc.stop(ac.currentTime + .1); noise.stop(ac.currentTime + .05);
  }
  function flash() { S.flash.classList.add('on'); setTimeout(() => S.flash.classList.remove('on'), 180); }

  async function shoot() {
    if (!S.preview.classList.contains('active')) return;

    if (!active()) {
      const asked = sessionStorage.getItem('pb_perm_asked') === '1';
      if (!asked) { sessionStorage.setItem('pb_perm_asked', '1'); const ok = await startCam(); if (!ok) return; }
      else if (sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted') { const ok = await startCam(); if (!ok) return; }
    }
    const ready = await waitReady(); if (!ready) { alert('Kamera noch nicht bereit.'); return; }

    flash(); await shutter(); draw();

    // Aufnahme für spätere Restyles einfrieren
    try { capturedData = S.canvas.toDataURL('image/png'); }
    catch { capturedData = null; }

    showScreen('captured');
  }

  async function retry() {
    capturedData = null; // Reset, damit bei „Neu starten“ wieder frische Aufnahme genutzt wird
    showScreen('preview');
  }

  // ===== Styles =====
  function renderStyles() {
    const html = styles.map(s => {
      const sel = (s === chosen) ? 'style="outline:2px solid var(--primary)"' : '';
      return `<button class="style" data-style="${s}" ${sel}>${s}</button>`;
    }).join('');
    S.styleGrid.innerHTML = html;
    S.styleGrid.querySelectorAll('.style').forEach(btn => {
      btn.addEventListener('click', () => {
        chosen = btn.getAttribute('data-style');
        renderStyles();
      });
    });
  }

  function promptText(styleName, extra) {
    const STYLE = (styleName || chosen || '').trim() || 'Default Style';
    const EXTRA = (extra || S.custom.value || '').trim();
    return [
      `Erzeuge aus dem Foto denselben Bildinhalt in folgendem Stil: ${STYLE}.`,
      EXTRA ? `Zusatz: ${EXTRA}` : '',
      '- Erhalte gleiche Personen/Objekte, Bildausschnitt und Stimmung.',
      '- Übernehme Pose, Blickrichtung und ungefähre Beleuchtung.',
      '- Kein Text im Bild.',
      '- Ausgabe: 1800×1200 (3:2, 148mm×100mm Print, Querformat), 1 Bild.',
      '- Hintergrund sauber, stiltypisch.',
      '- Übernehme bei Gruppenbildern alle Personen im Vordergrund'
    ].filter(Boolean).join('\n');
  }

  async function pngBlob() {
    if (capturedData) {
      const r = await fetch(capturedData);
      return await r.blob();
    }
    return new Promise(res => S.canvas.toBlob(b => res(b), 'image/png'));
  }

  async function compose(src) {
    const img = await new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = src; });
    const W = 1800, H = 1200;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    // Bild einpassen (cover)
    const rImg = img.width / img.height, rOut = W / H;
    let dx = 0, dy = 0, dw = W, dh = H;
    if (rImg > rOut) { dh = H; dw = H * rImg; dx = (W - dw) / 2; }
    else { dw = W; dh = W / rImg; dy = (H - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);

    // Logo drüberlegen (wie bei Aufnahme)
    if (logoImg) {
      const { x, y, w, h } = computeLogoRect(W, H, logoImg.naturalWidth || logoImg.width, logoImg.naturalHeight || logoImg.height);
      ctx.drawImage(logoImg, x, y, w, h);
    } else {
      ctx.save();
      ctx.globalAlpha = .65; ctx.fillStyle = '#1f2937'; ctx.font = 'bold 28px system-ui,Segoe UI,Roboto';
      const x = safeMarginX, y = H - safeMarginY - 22;
      ctx.fillText('AI Hub', x, y);
      ctx.restore();
    }
    return out.toDataURL('image/jpeg', .95);
  }

  async function toOpenAI() {
    const key = (S.apiKey.value || '').trim() || (S.obApiKey.value || '').trim();
    if (!key) { alert('Bitte OpenAI API-Key setzen.'); openSettings(); return; }

    const p = promptText();
    S.prompt.value = p;
    showScreen('gen');
    S.resultBox.innerHTML = '<div class="progress"><span class="hourglass">⏳</span> Bilderstellung läuft…</div>';

    try {
      const fd = new FormData();
      fd.append('model', 'gpt-image-1');
      fd.append('prompt', p);
      fd.append('image', await pngBlob(), 'input.png');
      fd.append('size', '1792x1024');

      const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json(); const b64 = j?.data?.[0]?.b64_json;
      if (!b64) throw new Error('Keine Bilddaten empfangen.');

      let url = 'data:image/png;base64,' + b64;
      url = await compose(url);

      S.resultBox.innerHTML = '';
      const img = new Image(); img.src = url; img.alt = 'Generiertes Bild';
      img.style.maxWidth = '100%'; img.style.maxHeight = '100%';
      S.resultBox.appendChild(img);
      S.finalImg.src = url;
      showScreen('result');
    } catch (e) {
      console.warn('Erster Edit fehlgeschlagen, versuche Fallback 1024x1024:', e);
      try {
        const fd2 = new FormData();
        fd2.append('model', 'gpt-image-1');
        fd2.append('prompt', p);
        fd2.append('image', await pngBlob(), 'input.png');
        fd2.append('size', '1024x1024');

        const r2 = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd2 });
        if (!r2.ok) throw new Error(await r2.text());
        const j2 = await r2.json(); const b642 = j2?.data?.[0]?.b64_json;
        if (!b642) throw new Error('Keine Bilddaten im Fallback.');

        let url2 = 'data:image/png;base64,' + b642;
        url2 = await compose(url2);

        S.resultBox.innerHTML = '';
        const img2 = new Image(); img2.src = url2; img2.alt = 'Generiertes Bild';
        img2.style.maxWidth = '100%'; img2.style.maxHeight = '100%';
        S.resultBox.appendChild(img2);
        S.finalImg.src = url2;
        showScreen('result');
      } catch (err) {
        console.error(err);
        S.resultBox.innerHTML = '<div class="progress">❗ Fehler bei der KI-Generierung. Details in der Konsole.</div>';
      }
    }
  }

  // ===== Drive / Teilen =====
  async function ensureToken({ interactive = false } = {}) {
    try {
      if (!drive.tokenClient) {
        drive.clientId = document.querySelector('meta[name="google-signin-client_id"]').content;
        drive.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: drive.clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          prompt: '', // leise, falls bereits autorisiert
          callback: (resp) => { drive.token = resp.access_token; localStorage.setItem('drive_authorized', '1'); },
        });
      }
      if (!drive.token) {
        if (interactive) {
          await new Promise((res, rej) => drive.tokenClient.requestAccessToken({
            prompt: '', callback: (resp) => { if (resp?.access_token) { drive.token = resp.access_token; localStorage.setItem('drive_authorized', '1'); res(); } else rej(new Error('Tokenfehler')); }
          }));
        }
      }
      return drive.token || null;
    } catch (e) {
      console.error('OAuth Fehler:', e);
      return null;
    }
  }

  function setDriveStatus() {
    const ok = !!drive.token || localStorage.getItem('drive_authorized') === '1';
    const txt = ok ? 'Verbunden' : 'Nicht verbunden';
    S.driveStatus.textContent = txt; S.obDriveStatus.textContent = txt;
  }

  function dataURLtoJpeg(dataUrl) {
    const s = dataUrl.split(',')[1]; const bin = atob(s);
    const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'image/jpeg' });
  }

  async function createFolderIfNeeded() {
    if (driveFolder?.id) return driveFolder;
    const t = await ensureToken({ interactive: true });
    if (!t) throw new Error('Drive nicht verbunden');
    const name = 'AIHBOOTH_' + new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, ':');
    const r = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!r.ok) throw new Error(await r.text());
    const f = await r.json();
    driveFolder = { id: f.id, name: name };
    localStorage.setItem('drive_folder', JSON.stringify(driveFolder));
    setDriveStatus();
    return driveFolder;
  }

  async function uploadShare(dataUrl) {
    const t = await ensureToken({ interactive: true });
    if (!t) throw new Error('Keine Drive-Berechtigung');
    const folder = await createFolderIfNeeded();

    // 1) Datei hochladen
    const meta = { name: 'AIHUB_' + Date.now() + '.jpg', mimeType: 'image/jpeg', parents: [folder.id] };
    const boundary = 'foo_bar_baz_' + Math.random().toString(36).slice(2);
    const body = [
      '--' + boundary,
      'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta),
      '--' + boundary,
      'Content-Type: image/jpeg', '', // Binärdaten folgen
      await (async () => {
        const blob = dataURLtoJpeg(dataUrl);
        const buf = await blob.arrayBuffer();
        return new Blob([buf]);
      })(),
      '--' + boundary + '--', ''
    ];

    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: new Blob(body)
    });
    if (!r.ok) throw new Error(await r.text());
    const file = await r.json();

    // 2) Öffentlich lesbar machen
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });

    // 3) Direktlink
    return `https://drive.google.com/uc?id=${file.id}`;
  }

  async function openShareWindow() {
    const w = window.open('', '_blank', 'noopener');
    if (!w) { alert('Bitte Pop-ups erlauben, um den Link zu öffnen.'); return; }

    w.document.open();
    w.document.write(`<!doctype html>
    <meta charset="utf-8">
    <title>Hochladen…</title>
    <style>
      html,body{height:100%;margin:0;font-family:system-ui,Segoe UI,Roboto}
      .box{height:100%;display:grid;place-items:center}
      .card{padding:20px;border:1px solid #e5eef8;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,.06)}
      .muted{color:#64748b}
      .btn{display:inline-block;margin-top:12px;padding:.6rem .9rem;border-radius:999px;border:1px solid #e5eef8;text-decoration:none}
    </style>
    <body>
      <div class="box">
        <div class="card">
          <div>📤 <strong>Hochladen zu Google Drive…</strong></div>
          <div class="muted" id="msg">Bitte warten…</div>
          <div id="fallback" style="display:none">
            <a id="openLink" class="btn" target="_self" rel="noopener">Link im selben Tab öffnen</a>
          </div>
        </div>
      </div>
    </body>`);
    w.document.close();

    try {
      const link = await uploadShare(S.finalImg.src);

      // Versuche, direkt auf die URL zu navigieren
      try {
        w.location.replace(link);
      } catch {
        w.document.getElementById('msg').textContent = 'Fertig! Öffne den Link:';
        const a = w.document.getElementById('openLink');
        a.href = link;
        w.document.getElementById('fallback').style.display = 'block';
      }

      // Zusätzlich QR anzeigen
      S.qrBox.innerHTML = '';
      const img = new Image();
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(link);
      img.alt = 'QR';
      S.qrBox.appendChild(img);
      S.qrLink.textContent = link;
      S.qr.style.display = 'flex';
    } catch (e) {
      console.error('Teilen fehlgeschlagen:', e);
      alert('Teilen fehlgeschlagen. Details in der Konsole.');
      try { w.close(); } catch {}
    }
  }

  // ===== Permissions (Indicator) =====
  (async function checkPerm() {
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: 'camera' });
        perm = st.state; st.onchange = () => { perm = st.state; };
        return;
      }
    } catch {}
    perm = sessionStorage.getItem('pb_perm_granted') ? 'granted' : 'prompt';
  })();

  // ===== Settings & Onboarding =====
  function openSettings() {
    S.settings.style.display = 'flex';
    S.version.textContent = V;
    S.cameraSel.value = sessionStorage.getItem('camera_id') || '';
    S.apiKey.value = sessionStorage.getItem('openai_api_key') || '';
    setDriveStatus();

    if (logoData) {
      S.logoPreview.src = logoData;
      if (!logoImg || logoImg.src !== logoData) { logoImg = new Image(); logoImg.src = logoData; }
    } else {
      S.logoPreview.removeAttribute('src');
    }
  }
  function closeSettings() { S.settings.style.display = 'none'; }

  function missingList() {
    const out = [];
    if (!sessionStorage.getItem('camera_id')) out.push('• Kamera wählen');
    if (!(sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted')) out.push('• Kamerazugriff erlauben');
    if (!sessionStorage.getItem('openai_api_key')) out.push('• OpenAI API Key setzen');
    if (!driveFolder) out.push('• Drive verbinden (Ordner wird automatisch angelegt)');
    return out;
  }

  function openOnboardingIfNeeded() {
    const miss = missingList();
    if (miss.length) {
      S.onboard.style.display = 'flex';
      S.obMissing.textContent = 'Bitte noch erledigen:\n' + miss.join('\n');
    } else {
      S.onboard.style.display = 'none';
    }
  }

  // ===== Events =====
  S.shoot.addEventListener('click', shoot);
  S.cont.addEventListener('click', (e) => {
    e?.preventDefault?.();
    if (S.reuseNote) S.reuseNote.style.display = 'none';
    showScreen('style');
    try {
      if (S.styleGrid) renderStyles();
    } catch (err) {
      console.error('renderStyles() fehlgeschlagen:', err);
    }
  });
  S.retry.addEventListener('click', retry);

  // WICHTIG: Restyle-Button (auf Ergebnis-Screen)
  S.restyle?.addEventListener('click', () => {
    if (S.reuseNote) S.reuseNote.style.display = 'block'; // Hinweis zeigen
    showScreen('style');
    try { if (S.styleGrid) renderStyles(); } catch {}
  });

  S.startGen.addEventListener('click', async () => {
    sessionStorage.setItem('openai_api_key', (S.apiKey.value || '').trim());
    try { await toOpenAI(); } catch (e) { console.error(e); }
  });

  S.print.addEventListener('click', () => {
    const w = window.open('', '_blank', 'noopener,width=900,height=620');
    if (!w) return alert('Pop-up blockiert.');
    w.document.write(`<img src="${S.finalImg.src}" style="max-width:100%">`);
    w.document.close(); w.focus(); w.print?.();
  });

  S.share.addEventListener('click', openShareWindow);
  // S.gmail?.addEventListener('click', ...);

  S.restartFab.addEventListener('click', retry);
  S.restartBig.addEventListener('click', retry);

  S.settingsFab.addEventListener('click', openSettings);
  S.closeSettings.addEventListener('click', closeSettings);
  S.settings.addEventListener('click', (e) => { if (e.target === S.settings) closeSettings(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.qr.style.display === 'flex') S.qr.style.display = 'none';
      if (S.onboard.style.display === 'flex') {/* Pflicht: nicht schließen */ }
      if (S.settings.style.display === 'flex') closeSettings();
    }
  });

  S.cameraSel.addEventListener('change', () => { sessionStorage.setItem('camera_id', S.cameraSel.value || ''); });

  // Logo Events
  S.logoFile?.addEventListener('change', () => {
    const f = S.logoFile.files && S.logoFile.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => setLogo(r.result); r.readAsDataURL(f);
  });
  S.logoClear?.addEventListener('click', () => setLogo(null));

  // Drive buttons
  S.driveConn.addEventListener('click', async () => { await ensureToken({ interactive: true }); setDriveStatus(); });
  S.qrClose.addEventListener('click', () => { S.qr.style.display = 'none'; });
  S.qr.addEventListener('click', (e) => { if (e.target === S.qr) S.qr.style.display = 'none'; });

  // Onboarding
  S.obGrantCam.addEventListener('click', async () => { sessionStorage.setItem('camera_id', S.obCamera.value || ''); await startCam(); await waitReady(); });
  S.obDriveConn.addEventListener('click', async () => {
    await ensureToken({ interactive: true });
    if (!driveFolder) { try { await createFolderIfNeeded(); } catch (e) { } }
    setDriveStatus();
  });
  S.obDone.addEventListener('click', () => { S.onboard.style.display = 'none'; });

  // ===== Init =====
  (async function init() {
    await listCams();
    if (!(sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted')) {
      const ok = await startCam(); if (ok) await waitReady();
    }

    setDriveStatus();
    openOnboardingIfNeeded();
    if (S.reuseNote) S.reuseNote.style.display = 'none';

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', listCams);
    }

    if (logoData) { logoImg = new Image(); logoImg.src = logoData; }
  })();
})();
