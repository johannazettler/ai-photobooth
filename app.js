(function () {
  const V = 'AI HUB Photobooth v13.2.1 (2025-09-22)';

  // ===== Konfig =====
  // Logo-Sicherheitsabstand (gegen Rand-Abschnitt beim Druck/Scan)
  const safeMarginX = 40;  // px Abstand vom rechten Rand (oben-rechts Platzierung)
  const safeMarginY = 40;  // px Abstand vom oberen Rand
  // Maximale Logo-Größe relativ zur Fläche (wie bisher)
  const maxLogoRel = 0.18;

  // ===== Helpers für DOM =====
  const el = (id) => document.getElementById(id);
  const S = {
    preview: el('screenPreview'), captured: el('screenCaptured'), style: el('screenStyle'), gen: el('screenGenerate'), result: el('screenResult'),
    video: el('video'), canvas: el('canvas'), count: el('count'), flash: el('flash'),
    shoot: el('shootBtn'), cont: el('continueBtn'), retry: el('retryBtn'),
    styleGrid: el('styleGrid'), custom: el('customStyle'), startGen: el('startGenBtn'), prompt: el('promptOut'), resultBox: el('resultBox'),
    finalImg: el('finalImg'), print: el('printBtn'), share: el('shareBtn'), /* gmail: el('gmailBtn'), */ restartBig: el('restartBigBtn'),
    restartFab: el('restartFab'), settingsFab: el('settingsFab'), settings: el('settings'), closeSettings: el('closeSettings'),
    cameraSel: el('cameraSel'), apiKey: el('apiKey'), version: el('versionText'),
    onboard: el('onboard'), obCamera: el('obCamera'), obGrantCam: el('obGrantCam'), obApi: el('obApiKey'), obDriveConn: el('obDriveConnect'), obDone: el('obDone'), obMissing: el('obMissing'), obDriveStatus: el('obDriveStatus'),
    driveConn: el('driveConnect'), driveStatus: el('driveStatus'),
    qr: el('qrModal'), qrBox: el('qrBox'), qrLink: el('qrLink'), qrClose: el('qrClose'),
    logoFile: document.getElementById('logoFile'),
    logoPreview: document.getElementById('logoPreview'),
    logoClear: document.getElementById('logoClear'),
  };

  // ===== State =====
  let logoData = localStorage.getItem('pb_logo_data') || null;  // Data-URL
  let logoImg = null;                                           // gecachtes Image
  let stream = null, devices = [], perm = 'prompt';
  const styles = ['Puppet Style', 'Anime', 'Studio Ghibli', 'Simpsons', 'Ninja Turtles', '90s Aesthetic', 'LEGO Style'];
  let chosen = styles[0];

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
    logoData = dataUrl || null;
    if (logoData) {
      S.logoPreview.src = logoData;
      localStorage.setItem('pb_logo_data', logoData);
      logoImg = new Image(); logoImg.src = logoData;
    } else {
      S.logoPreview.removeAttribute('src');
      localStorage.removeItem('pb_logo_data');
      logoImg = null;
    }
  }

  // ===== Kamera =====
  async function listCams() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter(d => d.kind === 'videoinput');
      const fill = (sel) => {
        sel.innerHTML = '';
        sel.add(new Option('System-Standard', ''));
        devices.forEach(d => sel.add(new Option(d.label || 'Kamera', d.deviceId)));
        const pref = sessionStorage.getItem('camera_id') || '';
        sel.value = pref;
      };
      fill(S.cameraSel); fill(S.obCamera);
    } catch (e) {
      console.warn('enumerateDevices() fehlgeschlagen:', e);
    }
  }

  async function startCam() {
    if (!navigator.mediaDevices?.getUserMedia) { alert('Browser unterstützt Kamera nicht.'); return false; }
    if (!isSecureContext && !isLocal()) {
      alert('Bitte die Seite über HTTPS oder http://localhost öffnen – sonst blockiert die Kamera.');
      return false;
    }
    try {
      if (active()) return true;

      const id = sessionStorage.getItem('camera_id') || '';
      const vc = { width: { ideal: 1800 }, height: { ideal: 1200 }, aspectRatio: 3 / 2, frameRate: { ideal: 30 } };
      if (id) vc.deviceId = { exact: id };

      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: vc });
      S.video.srcObject = stream;

      // Warten bis der Videostream nutzbar ist
      await S.video.play().catch(() => {});
      sessionStorage.setItem('pb_perm_granted', '1');
      await listCams();
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
    // wartet auf gültige Videoabmessungen
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
    // Falls doch noch nicht bereit: sanfter Bailout statt „leeres“ Bild
    if (!S.video.videoWidth || !S.video.videoHeight) {
      console.warn('Video ist noch nicht bereit – zeichne nicht.');
      return;
    }

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = 1800, H = 1200;   // Zielgröße
    S.canvas.width = Math.floor(W * dpr);
    S.canvas.height = Math.floor(H * dpr);
    const ctx = S.canvas.getContext('2d');

    // Kamera gespiegelt (Selfie)
    ctx.setTransform(-1, 0, 0, 1, S.canvas.width, 0);

    // Letterboxing „cover“-artig zuschneiden
    const vw = S.video.videoWidth, vh = S.video.videoHeight;
    const desired = S.canvas.width / S.canvas.height, va = vw / vh;
    let sx, sy, sw, sh;
    if (va > desired) { sh = vh; sw = Math.floor(sh * desired); sx = Math.floor((vw - sw) / 2); sy = 0; }
    else { sw = vw; sh = Math.floor(sw / desired); sx = 0; sy = Math.floor((vh - sh) / 2); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.video, sx, sy, sw, sh, 0, 0, S.canvas.width, S.canvas.height);

    // ---- Logo oben rechts (mit Safe-Margin) ----
    (function drawLogoOnCanvas(ctx, canvasW, canvasH) {
      const maxW = Math.round(canvasW * maxLogoRel);
      const maxH = Math.round(canvasH * maxLogoRel);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // zurücksetzen, damit das Logo nicht gespiegelt wird

      if (logoImg && (logoImg.complete || logoImg.naturalWidth)) {
        let w = logoImg.naturalWidth || logoImg.width;
        let h = logoImg.naturalHeight || logoImg.height;
        const s = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * s); h = Math.round(h * s);

        // oben rechts mit Sicherheitsabstand
        ctx.globalAlpha = 1.0;
        ctx.drawImage(logoImg, canvasW - w - safeMarginX, safeMarginY, w, h);
      } else {
        // Fallback-Text
        ctx.globalAlpha = .9;
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 54px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto';
        const text = 'AI Hub';
        const m = ctx.measureText(text);
        ctx.fillText(text, canvasW - m.width - safeMarginX, safeMarginY + 54);
      }
      ctx.restore();
    })(ctx, S.canvas.width, S.canvas.height);
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

    // Falls noch keine Berechtigung: ein Mal versuchen zu starten
    if (!active()) {
      const asked = sessionStorage.getItem('pb_perm_asked') === '1';
      if (!asked) { sessionStorage.setItem('pb_perm_asked', '1'); const ok = await startCam(); if (!ok) return; }
      else if (sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted') { const ok = await startCam(); if (!ok) return; }
    }

    // Sicherstellen, dass die Kamera wirklich liefert
    const ready = await waitReady();
    if (!ready) { alert('Kamera noch nicht bereit. Bitte kurz warten und erneut versuchen.'); return; }

    // Countdown & Foto
    S.count.style.display = 'block';
    for (let i = 5; i >= 1; i--) { S.count.textContent = String(i); await sleep(1000); }
    S.count.style.display = 'none';

    flash(); await shutter(); draw();
    showScreen('captured');
  }

  async function retry() {
    showScreen('preview');
    if ((sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted') && !active()) {
      const ok = await startCam(); if (ok) await waitReady();
    }
  }

  // ===== Styles, Prompt, Compose =====
  function renderStyles() {
    const emojis = ['🧸', '🌸', '🌀', '💛', '🐢', '📼', '🧱'];
    S.styleGrid.innerHTML = '';
    styles.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'tile'; b.type = 'button';
      b.setAttribute('aria-pressed', s === chosen ? 'true' : 'false');
      b.innerHTML = `<div class="thumb">${emojis[i % emojis.length]}</div><div class="label">${s}</div>`;
      b.addEventListener('click', () => {
        chosen = s; S.custom.value = '';[...S.styleGrid.children].forEach(c => c.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
      });
      S.styleGrid.appendChild(b);
    });
  }
  S.custom.addEventListener('input', () => {
    if ((S.custom.value || '').trim().length) { chosen = null;[...S.styleGrid.children].forEach(c => c.setAttribute('aria-pressed', 'false')); }
  });

  function promptText() {
    const free = (S.custom.value || '').trim(); const use = free ? free : (chosen || styles[0]);
    return [
      'Ich lade gleich ein Porträtfoto hoch. Wandle das Foto in den folgenden visuellen Stil um:',
      `Stil: ${use}`, '',
      'Anforderungen:',
      '- Erhalte realistische Gesichtszüge/Proportionen.',
      '- Übernehme Pose, Blickrichtung und ungefähre Beleuchtung.',
      '- Kein Text im Bild.',
      '- Ausgabe: 1800×1200 (3:2, 148mm×100mm Print, Querformat), 1 Bild.',
      '- Hintergrund sauber, stiltypisch.'
    ].join('\n');
  }

  async function pngBlob() { return new Promise(res => S.canvas.toBlob(b => res(b), 'image/png')); }

  async function compose(src) {
    // Ergebnisbild 1800x1200 mit Logo oben rechts + Safe-Margin
    const img = await new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = src; });
    const W = 1800, H = 1200;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d');

    // Bild mittig reinfitten (contain)
    const a = img.width / img.height, desired = W / H;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    let dw = W, dh = Math.round(W / a);
    if (dh > H) { dh = H; dw = Math.round(H * a); }
    const dx = Math.floor((W - dw) / 2), dy = Math.floor((H - dh) / 2);
    ctx.drawImage(img, dx, dy, dw, dh);

    // Logo oben rechts mit Sicherheitsabstand
    if (logoImg && (logoImg.complete || logoImg.naturalWidth)) {
      const maxW = Math.round(W * maxLogoRel), maxH = Math.round(H * maxLogoRel);
      let w = logoImg.naturalWidth || logoImg.width; let h = logoImg.naturalHeight || logoImg.height;
      const s = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * s); h = Math.round(h * s);
      ctx.drawImage(logoImg, W - w - safeMarginX, safeMarginY, w, h);
    } else {
      ctx.save(); ctx.globalAlpha = .25; ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 32px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto';
      const m = ctx.measureText('AI Hub'); ctx.fillText('AI Hub', W - m.width - safeMarginX, safeMarginY + 32);
      ctx.restore();
    }
    return out.toDataURL('image/jpeg', .95);
  }

  async function toOpenAI(p) {
    const key = sessionStorage.getItem('openai_api_key');
    if (!key) { S.resultBox.innerHTML = '<div class="progress">❗ Kein OpenAI API Key gesetzt. Bitte im ⚙️ Menü hinterlegen.</div>'; return; }
    try {
      const fd = new FormData();
      fd.append('model', 'gpt-image-1');
      fd.append('prompt', p);
      fd.append('image', await pngBlob(), 'input.png');
      fd.append('size', '1536x1024');

      const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const b64 = j?.data?.[0]?.b64_json;
      if (!b64) throw new Error('Unerwartete Antwort (keine Bilddaten).');

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

  // ===== Drive (kein Forced OAuth auf Reload) =====
  const loadClientId = async () => {
    if (drive.clientId) return drive.clientId;
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta?.content) { drive.clientId = meta.content.trim(); return drive.clientId; }
    return null;
  };
  const initToken = () => {
    if (!(window.google && google.accounts && google.accounts.oauth2) || !drive.clientId) return null;
    return google.accounts.oauth2.initTokenClient({
      client_id: drive.clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (resp) => { if (resp?.access_token) { drive.token = resp.access_token; setDriveStatus(); } }
    });
  };

  async function ensureToken(opts) {
    opts = opts || {};
    const interactive = !!opts.interactive;
    if (drive.token) return drive.token;
    await loadClientId();
    if (!drive.clientId) return null;
    drive.tokenClient = initToken();
    if (!drive.tokenClient) return null;

    if (drive.authorized) {
      try { drive.tokenClient.requestAccessToken({ prompt: 'none' }); } catch {}
      for (let i = 0; i < 20; i++) { if (drive.token) return drive.token; await sleep(100); }
    }
    if (interactive) {
      try { drive.tokenClient.requestAccessToken({ prompt: 'consent' }); } catch {}
      for (let i = 0; i < 50; i++) {
        if (drive.token) { localStorage.setItem('drive_authorized', '1'); drive.authorized = true; return drive.token; }
        await sleep(100);
      }
      return null;
    }
    return null;
  }

  function setDriveStatus() {
    const txt = [drive.token ? 'verbunden' : 'nicht verbunden', driveFolder ? ('Ordner: ' + (driveFolder.name || '')) : '']
      .filter(Boolean).join(' · ');
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
    const name = `AIHUB-Booth-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    const boundary = 'drive_' + Math.random().toString(36).slice(2);
    const meta = { name, mimeType: 'image/jpeg', parents: [folder.id] };
    const body = new Blob([
      '--' + boundary + '\r\n',
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(meta), '\r\n',
      '--' + boundary + '\r\n',
      'Content-Type: image/jpeg\r\n\r\n',
      dataURLtoJpeg(dataUrl), '\r\n',
      '--' + boundary + '--'
    ], { type: 'multipart/related; boundary=' + boundary });

    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { Authorization: 'Bearer ' + t }, body
    });
    if (!up.ok) throw new Error('Upload fehlgeschlagen: ' + await up.text());
    const file = await up.json();

    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
    return `https://drive.google.com/uc?id=${file.id}`;
  }

  // ===== QR =====
  let qrLoad = null;
  function loadQR() {
    if (window.QRCode) return Promise.resolve();
    if (qrLoad) return qrLoad;
    qrLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => res(); s.onerror = () => rej(new Error('QR-Code Bibliothek konnte nicht geladen werden'));
      document.head.appendChild(s);
    });
    return qrLoad;
  }
  async function makeQR(node, text) { await loadQR(); node.innerHTML = ''; new QRCode(node, { text, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M, margin: 2 }); }

  // ===== Permissions =====
  async function updPerm() {
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: 'camera' });
        perm = st.state; st.onchange = () => { perm = st.state; };
        return;
      }
    } catch {}
    perm = sessionStorage.getItem('pb_perm_granted') ? 'granted' : 'prompt';
  }

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
    if (miss.length) { S.onboard.style.display = 'flex'; S.obMissing.textContent = 'Bitte noch erledigen:\n' + miss.join('\n'); }
  }

  // ===== Events =====
  S.shoot.addEventListener('click', shoot);
  S.cont.addEventListener('click', () => { showScreen('style'); renderStyles(); });
  S.retry.addEventListener('click', retry);

  S.startGen.addEventListener('click', async () => {
    showScreen('gen');
    const p = promptText(); S.prompt.value = p;
    S.resultBox.innerHTML = '<div class="progress"><span class="hourglass">⏳</span> Die Bilderstellung läuft… das kann ca. 1 Minute dauern.</div>';
    await toOpenAI(p);
  });

S.print.addEventListener('click', async () => {
  if (!S.finalImg.src) { alert('Kein Bild vorhanden.'); return; }

  // 1) Tab sofort öffnen (vermeidet Popup-Blocker)
  const w = window.open('about:blank', '_blank'); // bewusst ohne "noopener" als Feature
  if (!w) { alert('Popup blockiert – bitte Popups für diese Seite erlauben.'); return; }

  // 2) Spinner/Status in neuem Tab rendern
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
    // 3) Upload (holt bei Bedarf OAuth-Token per Nutzerinteraktion)
    const link = await uploadShare(S.finalImg.src);

    // 4) Versuch: direkte Navigation im bereits geöffneten Tab
    try {
      w.location.href = link;           // primär
      // Safety-Nachschub: falls Navigation doch blockiert wird, zeig Button
      setTimeout(() => {
        try {
          if (w.location.href === 'about:blank') {
            const msg = w.document.getElementById('msg');
            const fb  = w.document.getElementById('fallback');
            const a   = w.document.getElementById('openLink');
            if (msg) msg.textContent = 'Navigation blockiert. Klicke auf den Button:';
            if (a)  { a.href = link; a.textContent = 'Zum Bild auf Google Drive'; }
            if (fb) fb.style.display = 'block';
          }
        } catch { /* ignorieren */ }
      }, 600);
    } catch {
      // 5) Fallback: manueller Button anzeigen
      const msg = w.document.getElementById('msg');
      const fb  = w.document.getElementById('fallback');
      const a   = w.document.getElementById('openLink');
      if (msg) msg.textContent = 'Navigation fehlgeschlagen. Klicke auf den Button:';
      if (a)  { a.href = link; a.textContent = 'Zum Bild auf Google Drive'; }
      if (fb) fb.style.display = 'block';
    }
  } catch (e) {
    // 6) Fehler im Upload -> im Tab anzeigen
    try {
      w.document.body.innerHTML = `
        <div class="box"><div class="card">
          <div>❗ <strong>Upload-Fehler</strong></div>
          <div class="muted" style="max-width:560px">${(e && e.message) || e}</div>
        </div></div>`;
    } catch { /* nichts */ }
  }
});

  S.share.addEventListener('click', async () => {
    if (!S.finalImg.src) return;
    try {
      const link = await uploadShare(S.finalImg.src);
      S.qrLink.textContent = link; await makeQR(S.qrBox, link);
      S.qr.style.display = 'flex';
    } catch (e) {
      S.qrLink.textContent = 'Fehler: ' + e.message;
      S.qrBox.innerHTML = ''; S.qr.style.display = 'flex';
    }
  });

  S.restartBig.addEventListener('click', retry);
  S.restartFab.addEventListener('click', retry);

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
    const miss = missingList();
    S.obMissing.textContent = miss.length ? ('Bitte noch erledigen:\n' + miss.join('\n')) : '';
  });
  S.obApi.addEventListener('input', () => {
    const k = S.obApi.value.trim();
    if (k) sessionStorage.setItem('openai_api_key', k);
    else sessionStorage.removeItem('openai_api_key');
  });
  S.obDone.addEventListener('click', () => {
    const miss = missingList();
    if (miss.length) { S.obMissing.textContent = 'Bitte noch erledigen:\n' + miss.join('\n'); return; }
    S.onboard.style.display = 'none';
  });

  // Permissions init
  async function initPerm() {
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: 'camera' });
        perm = st.state; st.onchange = () => perm = st.state;
      }
    } catch {}
  }

  // Init
  (async function init() {
    document.title = 'AI HUB Photobooth';
    S.version.textContent = V;

    await initPerm();
    await updPerm();
    await listCams();

    showScreen('preview');

    if ((sessionStorage.getItem('pb_perm_granted') === '1' || perm === 'granted') && !active()) {
      const ok = await startCam(); if (ok) await waitReady();
    }

    setDriveStatus();
    openOnboardingIfNeeded();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', listCams);
    }

    if (logoData) { logoImg = new Image(); logoImg.src = logoData; }
  })();
})();
