// ============================================================
//  MON COURS v5 — Dessin corrigé + Mode Déplacer
// ============================================================

const $ = (id) => document.getElementById(id);
const randomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// ============ ÉTAT GLOBAL ============
let role = null, peer = null, conn = null, call = null;
let localStream = null, myCode = null;
let currentChildName = null;

let currentTool = 'pen';
let currentColor = '#2563eb';
let currentSize = 4;
let strokes = [];
let canDraw = true;

const WORLD_W = 3000, WORLD_H = 3000;
let scale = 1;
const minScale = 0.3, maxScale = 4;

// Dessin temps réel
let drawing = false;
let currentStroke = null;
let pendingPoints = [];
let lastSendTime = 0;
const SEND_INTERVAL = 16;

// Compas
let compassMode = false;
let compassCenter = null;
let compassRadius = 0;
let remoteCompass = null;

// Règle
let rulerMode = false;
let rulerStart = null;
let rulerEnd = null;
let remoteRuler = null;

// ⭐ MODE DÉPLACEMENT
let panMode = false;

// Photo
let currentFacingMode = 'user';

// ============ STOCKAGE LOCAL ============
const DB_KEY = 'mon-cours-data';
const EDU_KEY = 'mon-cours-edu';

function getDB() { return JSON.parse(localStorage.getItem(DB_KEY) || '{"profiles":[],"lastParentId":null}'); }
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function getEduDB() { return JSON.parse(localStorage.getItem(EDU_KEY) || '{"exercises":[],"corrections":[],"responses":[]}'); }
function saveEduDB(db) { localStorage.setItem(EDU_KEY, JSON.stringify(db)); }

// ============ LOBBY ============
document.querySelectorAll('.role-buttons button').forEach(btn => {
  btn.onclick = async () => {
    role = btn.dataset.role;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: currentFacingMode },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      $('localVideo').srcObject = localStream;
    } catch (e) {
      console.warn(e);
      showToast('⚠️ Caméra/micro refusés');
    }
    document.querySelector('.role-buttons').classList.add('hidden');
    if (role === 'parent') {
      $('parentWait').classList.remove('hidden');
      $('parentPanelBtn').style.display = 'block';
      $('createSessionBtn').onclick = createParentSession;
    } else {
      $('childJoin').classList.remove('hidden');
      $('joinBtn').onclick = joinAsChild;
    }
  };
});

// ============ CRÉATION SESSION PARENT ============
function createParentSession() {
  const childName = $('parentChildName').value.trim();
  if (!childName) return showToast('⚠️ Entre le prénom de l\'enfant');
  currentChildName = childName;

  const db = getDB();
  let profile = db.profiles.find(p => p.name === childName);
  if (!profile) {
    profile = {
      name: childName,
      peerId: 'mc-' + childName.toLowerCase().replace(/\s/g, '') + '-' + Math.random().toString(36).substring(2, 6),
      createdAt: Date.now(),
      sessions: [],
      currentStrokes: [],
      currentBg: null
    };
    db.profiles.push(profile);
  }
  db.lastParentId = profile.peerId;
  saveDB(db);

  myCode = profile.peerId;
  $('codeDisplay').classList.remove('hidden');
  $('myCode').textContent = myCode;
  $('createSessionBtn').style.display = 'none';

  peer = new Peer(myCode, PEER_CONFIG);
  peer.on('open', () => {
    $('status').textContent = '✅ Session prête — envoie le code à ' + childName;
    $('status').style.color = '#10b981';
  });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') showToast('⚠️ Ce code existe déjà. Change de prénom ou recharge.');
    else showToast('Erreur : ' + err.type);
  });
  peer.on('connection', (c) => { conn = c; setupConnection(); });
  peer.on('call', (mediaCall) => {
    mediaCall.answer(localStream);
    call = mediaCall;
    mediaCall.on('stream', (stream) => {
      $('remoteVideo').srcObject = stream;
      $('waitingMsg').classList.add('hidden');
    });
  });

  $('copyCode').onclick = () => copyCode(myCode);
}

// ============ CONNEXION ENFANT ============
function joinAsChild() {
  const childName = $('childNameInput').value.trim();
  const code = $('codeInput').value.trim();
  if (!childName) return showToast('⚠️ Entre ton prénom');
  if (!code) return showToast('⚠️ Colle le code de papa');

  currentChildName = childName;
  myCode = code;

  peer = new Peer(PEER_CONFIG);
  peer.on('open', () => {
    $('status').textContent = '🔗 Connexion...';
    conn = peer.connect(code, { reliable: true });
    conn.on('open', () => {
      enterClassroom(code);
      if (localStream) {
        call = peer.call(code, localStream);
        call.on('stream', (stream) => {
          $('remoteVideo').srcObject = stream;
          $('waitingMsg').classList.add('hidden');
        });
      }
      setupConnection();
    });
    conn.on('error', () => showToast('❌ Connexion impossible'));
  });
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      showToast('❌ Code invalide — vérifie avec papa');
      $('status').textContent = '❌ Code invalide';
    } else showToast('Erreur : ' + err.type);
  });
}

const PEER_CONFIG = {
  debug: 1,
  config: { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]}
};

// ============ CONNEXION ÉTABLIE ============
function setupConnection() {
  conn.on('open', () => {
    enterClassroom(myCode || conn.peer);
    $('connStatus').textContent = '🟢 Connecté';
  });
  conn.on('data', handleIncoming);
  conn.on('close', () => {
    $('connStatus').textContent = '🔴 Déconnecté';
    $('waitingMsg').classList.remove('hidden');
  });
}

function enterClassroom(code) {
  $('lobby').classList.add('hidden');
  $('classroom').classList.remove('hidden');
  $('roomName').textContent = '📚 ' + code;
  setTimeout(() => { initCanvas(); }, 100);
}

// ============================================================
//  CANVAS
// ============================================================
const board = $('board');
const ctx = board.getContext('2d');
const viewport = $('canvasViewport');
const world = $('canvasWorld');

function initCanvas() {
  board.width = WORLD_W;
  board.height = WORLD_H;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  centerView();
}

function centerView() {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  viewport.scrollLeft = (WORLD_W * scale - vw) / 2;
  viewport.scrollTop = (WORLD_H * scale - vh) / 2;
}

// ============ ZOOM ============
function applyZoom() {
  world.style.transform = `scale(${scale})`;
  world.style.width = (WORLD_W * scale) + 'px';
  world.style.height = (WORLD_H * scale) + 'px';
  $('zoomLevel').textContent = Math.round(scale * 100) + '%';
}

$('zoomIn').onclick = () => { scale = Math.min(maxScale, scale + 0.25); applyZoom(); };
$('zoomOut').onclick = () => { scale = Math.max(minScale, scale - 0.25); applyZoom(); };

// ⭐ PINCEMENT 2 DOIGTS (fonctionne en mode dessin ET déplacement)
let pinchStartDist = 0, pinchStartScale = 1, pinchCenter = { x:0, y:0 };
let isPinching = false;

viewport.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    isPinching = true;
    if (drawing) {
      drawing = false;
      currentStroke = null;
      pendingPoints = [];
      redrawAll();
    }
    const t1 = e.touches[0], t2 = e.touches[1];
    pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    pinchStartScale = scale;
    const r = viewport.getBoundingClientRect();
    pinchCenter = {
      x: (t1.clientX + t2.clientX) / 2 - r.left,
      y: (t1.clientY + t2.clientY) / 2 - r.top
    };
  }
}, { passive: true });

viewport.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && isPinching) {
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const ratio = dist / pinchStartDist;
    const newScale = Math.max(minScale, Math.min(maxScale, pinchStartScale * ratio));

    const worldX = (viewport.scrollLeft + pinchCenter.x) / scale;
    const worldY = (viewport.scrollTop + pinchCenter.y) / scale;

    scale = newScale;
    applyZoom();

    viewport.scrollLeft = worldX * scale - pinchCenter.x;
    viewport.scrollTop = worldY * scale - pinchCenter.y;
  }
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    isPinching = false;
    pinchStartDist = 0;
  }
}, { passive: true });

// ============ OUTILS ============
function setTool(t) {
  currentTool = t;
  compassMode = false;
  rulerMode = false;
  panMode = false;
  viewport.classList.remove('pan-mode');
  document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
  const ids = { pen:'penBtn', eraser:'eraserBtn', text:'textBtn', pointer:'pointerBtn',
                ruler:'rulerBtn', compass:'compassBtn', letter:'letterBtn', paper:'paperBtn',
                pan:'panBtn' };
  if (ids[t]) $(ids[t]).classList.add('active');
}

$('penBtn').onclick = () => setTool('pen');
$('eraserBtn').onclick = () => setTool('eraser');
$('textBtn').onclick = () => setTool('text');
$('pointerBtn').onclick = () => setTool('pointer');

// ⭐ MODE DÉPLACEMENT
$('panBtn').onclick = () => {
  panMode = true;
  compassMode = false;
  rulerMode = false;
  viewport.classList.add('pan-mode');
  document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
  $('panBtn').classList.add('active');
  showToast('✋ Mode déplacement : glisse pour bouger le tableau');
};

$('rulerBtn').onclick = () => {
  setTool('ruler');
  rulerMode = true;
  showToast('📏 Règle : touche le départ, glisse vers l\'arrivée');
};
$('compassBtn').onclick = () => {
  setTool('compass');
  compassMode = true;
  showToast('🧭 Compas : touche le centre, éloigne ton doigt');
};
$('letterBtn').onclick = () => {
  const letter = prompt('Quelle lettre veux-tu apprendre ? (ex: A, b, 3)');
  if (letter && letter.length === 1) {
    sendData({ type: 'stroke-begin', data: { color: '#1e293b', size: 6, point: { x: 200, y: 200 } } });
    animateLetterRealtime(letter.toUpperCase(), 200, 200, 250);
  }
};
$('paperBtn').onclick = () => {
  if (world.classList.contains('paper-seyes')) {
    world.classList.remove('paper-seyes');
    world.classList.add('paper-simple');
    showToast('📄 Papier ligné simple (6e)');
  } else if (world.classList.contains('paper-simple')) {
    world.classList.remove('paper-simple');
    showToast('📄 Papier blanc');
  } else {
    world.classList.add('paper-seyes');
    showToast('📄 Papier Seyes (CP)');
  }
};

document.querySelectorAll('.color-dot').forEach(dot => {
  dot.onclick = () => {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    currentColor = dot.dataset.color;
    if (currentTool === 'eraser') setTool('pen');
  };
});

$('undoBtn').onclick = () => { strokes.pop(); redrawAll(); sendData({ type: 'undo' }); };
$('clearBtn').onclick = () => {
  if (!confirm('Effacer tout le tableau ?')) return;
  ctx.clearRect(0, 0, board.width, board.height);
  strokes = [];
  sendData({ type: 'clear' });
};
$('saveBtn').onclick = () => {
  const a = document.createElement('a');
  a.download = `cours-${Date.now()}.png`;
  a.href = board.toDataURL('image/png');
  a.click();
  showToast('💾 Image sauvegardée');
};

// ============ POSITION DANS LE MONDE ============
function getPos(e) {
  const r = board.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
  const x = (p.clientX - r.left) / scale;
  const y = (p.clientY - r.top) / scale;
  return { x, y };
}

// ============================================================
//  DESSIN TEMPS RÉEL
// ============================================================
function startDraw(e) {
  if (panMode) return;   // ⭐ en mode déplacement : on ne dessine pas
  if (!canDraw) return showToast('🙋 Demande la main à Papa/Maman');
  if (compassMode) return startCompass(e);
  if (rulerMode) return startRuler(e);

  e.preventDefault();
  const pos = getPos(e);

  if (currentTool === 'pointer') {
    sendData({ type: 'pointer', data: pos });
    showPointerAtWorld(pos.x, pos.y);
    return;
  }
  if (currentTool === 'text') {
    const txt = prompt('Quel texte ?');
    if (txt) {
      const s = { type:'text', x:pos.x, y:pos.y, text:txt, color:currentColor, size: currentSize*4 };
      strokes.push(s);
      drawStroke(s);
      sendData({ type: 'draw', data: s });
    }
    return;
  }

  drawing = true;
  currentStroke = {
    type: 'line',
    color: currentTool === 'eraser' ? '#ffffff' : currentColor,
    size: currentTool === 'eraser' ? currentSize * 5 : currentSize,
    points: [pos]
  };
  pendingPoints = [pos];
  sendData({ type: 'stroke-begin', data: { color: currentStroke.color, size: currentStroke.size, point: pos } });
}

function moveDraw(e) {
  if (panMode) return;   // ⭐
  if (compassMode && drawing) return moveCompass(e);
  if (rulerMode && drawing) return moveRuler(e);
  if (!drawing || !currentStroke) return;
  e.preventDefault();

  const pos = getPos(e);
  const prev = currentStroke.points[currentStroke.points.length - 1];
  currentStroke.points.push(pos);
  pendingPoints.push(pos);

  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth = currentStroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();

  const now = performance.now();
  if (now - lastSendTime >= SEND_INTERVAL && pendingPoints.length > 0) {
    sendData({ type: 'stroke-points', data: { points: pendingPoints } });
    pendingPoints = [];
    lastSendTime = now;
  }
}

function endDraw(e) {
  if (panMode) return;   // ⭐
  if (compassMode && drawing) return endCompass(e);
  if (rulerMode && drawing) return endRuler(e);
  if (!drawing) return;
  drawing = false;

  if (pendingPoints.length > 0) {
    sendData({ type: 'stroke-points', data: { points: pendingPoints } });
    pendingPoints = [];
  }
  sendData({ type: 'stroke-end' });

  if (currentStroke && currentStroke.points.length > 1) {
    strokes.push(currentStroke);
  }
  currentStroke = null;
}

board.addEventListener('pointerdown', startDraw);
board.addEventListener('pointermove', moveDraw);
board.addEventListener('pointerup', endDraw);
board.addEventListener('pointercancel', endDraw);
board.addEventListener('pointerleave', endDraw);

// ============================================================
//  RÉCEPTION
// ============================================================
let remoteStroke = null;

function handleIncoming(msg) {
  switch (msg.type) {
    case 'stroke-begin': {
      const d = msg.data;
      remoteStroke = { type: 'line', color: d.color, size: d.size, points: [d.point] };
      ctx.strokeStyle = d.color;
      ctx.lineWidth = d.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(d.point.x, d.point.y);
      break;
    }
    case 'stroke-points': {
      if (!remoteStroke) break;
      for (const p of msg.data.points) {
        const prev = remoteStroke.points[remoteStroke.points.length - 1];
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        remoteStroke.points.push(p);
      }
      break;
    }
    case 'stroke-end': {
      if (remoteStroke && remoteStroke.points.length > 1) strokes.push(remoteStroke);
      remoteStroke = null;
      break;
    }
    case 'compass-begin':
      remoteCompass = { ...msg.data, radius: 0 };
      break;
    case 'compass-move':
      if (remoteCompass) {
        remoteCompass.radius = msg.data.radius;
        redrawAll();
        drawCompassPreviewRemote(remoteCompass);
      }
      break;
    case 'compass-end':
      if (remoteCompass) {
        strokes.push({ type: 'compass-circle', cx: remoteCompass.cx, cy: remoteCompass.cy,
                       r: remoteCompass.radius, color: remoteCompass.color, size: remoteCompass.size });
      }
      remoteCompass = null;
      redrawAll();
      break;
    case 'ruler-begin':
      remoteRuler = { ...msg.data };
      break;
    case 'ruler-move':
      if (remoteRuler) {
        remoteRuler.x2 = msg.data.x2;
        remoteRuler.y2 = msg.data.y2;
        redrawAll();
        drawRulerLine(remoteRuler);
      }
      break;
    case 'ruler-end':
      if (remoteRuler) {
        strokes.push({ type: 'line', color: remoteRuler.color, size: remoteRuler.size,
                       points: [{ x: remoteRuler.x1, y: remoteRuler.y1 }, { x: remoteRuler.x2, y: remoteRuler.y2 }] });
      }
      remoteRuler = null;
      redrawAll();
      break;
    case 'draw':
      strokes.push(msg.data);
      drawStroke(msg.data);
      break;
    case 'clear':
      ctx.clearRect(0, 0, board.width, board.height);
      strokes = [];
      break;
    case 'undo':
      strokes.pop();
      redrawAll();
      break;
    case 'pointer':
      showPointerAtWorld(msg.data.x, msg.data.y);
      break;
    case 'reaction':
      floatEmoji(msg.data);
      break;
    case 'background':
      setBackground(msg.data.url);
      break;
    case 'clear-background':
      clearBackground();
      break;
    case 'child-away':
      showToast(`⚠️ L'enfant s'est absenté ${msg.data.duration}s`);
      $('controlStatus').textContent = `⚠️ Absent ${msg.data.duration}s`;
      break;
    case 'force-mic-off':
      if (localStream) { const t = localStream.getAudioTracks()[0]; if (t) { t.enabled = false; updateMicUI(false); } }
      showToast('🔇 Papa a coupé ton micro');
      break;
    case 'force-cam-off':
      if (localStream) { const t = localStream.getVideoTracks()[0]; if (t) { t.enabled = false; updateCamUI(false); } }
      showToast('📷 Papa a coupé ta caméra');
      break;
    case 'force-lock-draw':
      canDraw = false;
      showToast('🔒 Papa a bloqué ton dessin');
      break;
    case 'force-unlock-draw':
      canDraw = true;
      showToast('🔓 Papa t\'autorise à dessiner');
      break;
    case 'force-clear-board':
      ctx.clearRect(0, 0, board.width, board.height);
      strokes = [];
      break;
    case 'force-kick':
      alert('Papa a mis fin à la session');
      location.reload();
      break;
  }
}

// ============ COMPAS ============
function startCompass(e) {
  e.preventDefault();
  compassCenter = getPos(e);
  compassRadius = 0;
  drawing = true;
  sendData({ type: 'compass-begin', data: { cx: compassCenter.x, cy: compassCenter.y, color: currentColor, size: currentSize } });
}
function moveCompass(e) {
  e.preventDefault();
  const pos = getPos(e);
  compassRadius = Math.hypot(pos.x - compassCenter.x, pos.y - compassCenter.y);
  redrawAll();
  drawCompassPreview(compassCenter, compassRadius);
  sendData({ type: 'compass-move', data: { radius: compassRadius } });
}
function endCompass() {
  drawing = false;
  if (compassRadius > 10) {
    const stroke = { type: 'compass-circle', cx: compassCenter.x, cy: compassCenter.y, r: compassRadius, color: currentColor, size: currentSize };
    strokes.push(stroke);
    drawStroke(stroke);
    sendData({ type: 'compass-end' });
  }
  compassMode = false;
  compassCenter = null;
  compassRadius = 0;
  redrawAll();
}
function drawCompassPreview(center, radius) {
  if (!center || radius < 5) return;
  ctx.save();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(center.x, center.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  ctx.lineTo(center.x + radius, center.y);
  ctx.stroke();
  ctx.restore();
}
function drawCompassPreviewRemote(rc) {
  if (!rc || rc.radius < 5) return;
  ctx.save();
  ctx.strokeStyle = rc.color;
  ctx.lineWidth = rc.size;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(rc.cx, rc.cy, rc.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ============ RÈGLE ============
function startRuler(e) {
  e.preventDefault();
  rulerStart = getPos(e);
  rulerEnd = rulerStart;
  drawing = true;
  sendData({ type: 'ruler-begin', data: { x1: rulerStart.x, y1: rulerStart.y, x2: rulerStart.x, y2: rulerStart.y, color: currentColor, size: currentSize } });
}
function moveRuler(e) {
  e.preventDefault();
  rulerEnd = getPos(e);
  redrawAll();
  drawRulerLine({ x1: rulerStart.x, y1: rulerStart.y, x2: rulerEnd.x, y2: rulerEnd.y, color: currentColor, size: currentSize });
  sendData({ type: 'ruler-move', data: { x2: rulerEnd.x, y2: rulerEnd.y } });
}
function endRuler() {
  drawing = false;
  if (rulerStart && rulerEnd) {
    const dist = Math.hypot(rulerEnd.x - rulerStart.x, rulerEnd.y - rulerStart.y);
    if (dist > 5) {
      strokes.push({ type: 'line', color: currentColor, size: currentSize,
                     points: [{ x: rulerStart.x, y: rulerStart.y }, { x: rulerEnd.x, y: rulerEnd.y }] });
      sendData({ type: 'ruler-end' });
      showToast(`📏 ${(dist / 20).toFixed(1)} cm`);
    }
  }
  rulerMode = false;
  rulerStart = null;
  rulerEnd = null;
  redrawAll();
}
function drawRulerLine(r) {
  ctx.save();
  ctx.strokeStyle = r.color;
  ctx.lineWidth = r.size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r.x1, r.y1);
  ctx.lineTo(r.x2, r.y2);
  ctx.stroke();
  const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1;
  for (let d = 0; d <= len; d += 20) {
    const px = r.x1 + ux * d, py = r.y1 + uy * d;
    const perpX = -uy * 8, perpY = ux * 8;
    ctx.beginPath();
    ctx.moveTo(px - perpX, py - perpY);
    ctx.lineTo(px + perpX, py + perpY);
    ctx.stroke();
  }
  ctx.restore();
}

// ============ DESSIN DU STROKE ============
function drawStroke(s) {
  if (s.type === 'compass-circle') {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (s.type === 'text') {
    ctx.fillStyle = s.color;
    ctx.font = `bold ${s.size}px sans-serif`;
    ctx.fillText(s.text, s.x, s.y);
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.beginPath();
  s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();
}

function redrawAll() {
  ctx.clearRect(0, 0, board.width, board.height);
  strokes.forEach(drawStroke);
}

// ============ POINTEUR ============
function showPointerAtWorld(x, y) {
  const dot = $('pointerDot');
  dot.classList.remove('hidden');
  dot.style.left = (x * scale) + 'px';
  dot.style.top = (y * scale) + 'px';
  clearTimeout(window._pt);
  window._pt = setTimeout(() => dot.classList.add('hidden'), 1500);
}

// ============ ANIMATION LETTRE ============
async function animateLetterRealtime(letter, startX, startY, size = 200) {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = size * 2;
  offCanvas.height = size * 2;
  const offCtx = offCanvas.getContext('2d');
  offCtx.font = `bold ${size}px sans-serif`;
  offCtx.fillStyle = '#000';
  offCtx.fillText(letter, size * 0.3, size * 1.4);

  const imgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
  const pixels = imgData.data;
  const points = [];
  for (let py = 0; py < offCanvas.height; py += 4) {
    for (let px = 0; px < offCanvas.width; px += 4) {
      const idx = (py * offCanvas.width + px) * 4;
      if (pixels[idx + 3] > 100) points.push({ x: startX + px, y: startY + py });
    }
  }
  points.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const stroke = { type: 'line', color: '#1e293b', size: 6, points: [] };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    stroke.points.push(p);
    if (i > 0) {
      const prev = points[i - 1];
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    sendData({ type: 'stroke-points', data: { points: [p] } });
    await new Promise(r => setTimeout(r, 15));
  }
  strokes.push(stroke);
  sendData({ type: 'stroke-end' });
}

// ============ FOND (upload) ============
$('uploadBtn').onclick = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast('❌ Image trop lourde (max 5 Mo)');
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      setBackground(url);
      sendData({ type: 'background', data: { url } });
      showToast('✅ Exercice affiché');
    };
    reader.readAsDataURL(file);
  };
  input.click();
};

function setBackground(url) {
  const img = $('bgImage');
  img.src = url;
  img.classList.remove('hidden');
  $('removeBgBtn').style.display = 'flex';
}

$('removeBgBtn').onclick = () => {
  clearBackground();
  sendData({ type: 'clear-background' });
  showToast('🖼️ Photo enlevée');
};

function clearBackground() {
  $('bgImage').classList.add('hidden');
  $('bgImage').src = '';
  $('removeBgBtn').style.display = 'none';
}

// ============ CAMÉRA ============
async function switchCamera() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode, width: 1280, height: 720 },
      audio: true
    });
    $('localVideo').srcObject = localStream;
    if (call && call.peerConnection) {
      const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(localStream.getVideoTracks()[0]);
    }
    showToast('📷 Caméra changée');
  } catch (e) {
    showToast('❌ Impossible de changer');
  }
}
$('switchCamBtn').onclick = switchCamera;

// ============ PHOTO ============
$('photoBtn').onclick = async () => {
  if (!localStream) return showToast('❌ Caméra non disponible');
  const videoTrack = localStream.getVideoTracks()[0];
  try {
    const imageCapture = new ImageCapture(videoTrack);
    const blob = await imageCapture.takePhoto();
    const reader = new FileReader();
    reader.onload = () => {
      setBackground(reader.result);
      sendData({ type: 'background', data: { url: reader.result } });
      showToast('📸 Photo ajoutée au tableau');
    };
    reader.readAsDataURL(blob);
  } catch (e) {
    const canvas = document.createElement('canvas');
    canvas.width = $('localVideo').videoWidth;
    canvas.height = $('localVideo').videoHeight;
    canvas.getContext('2d').drawImage($('localVideo'), 0, 0);
    const url = canvas.toDataURL('image/jpeg');
    setBackground(url);
    sendData({ type: 'background', data: { url } });
    showToast('📸 Photo ajoutée au tableau');
  }
};

// ============ MIC/CAM TOGGLE ============
function updateMicUI(enabled) {
  $('micBtn').classList.toggle('off', !enabled);
  $('micBtn').querySelector('.icon').textContent = enabled ? '🎤' : '🔇';
}
function updateCamUI(enabled) {
  $('camBtn').classList.toggle('off', !enabled);
  $('camBtn').querySelector('.icon').textContent = enabled ? '📷' : '🚫';
}

$('micBtn').onclick = () => {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  t.enabled = !t.enabled;
  updateMicUI(t.enabled);
};
$('camBtn').onclick = () => {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  t.enabled = !t.enabled;
  updateCamUI(t.enabled);
};

// ============ RÉACTIONS ============
document.querySelectorAll('.reaction').forEach(b => {
  b.onclick = () => {
    const emoji = b.dataset.emoji;
    sendData({ type: 'reaction', data: emoji });
    floatEmoji(emoji);
  };
});
function floatEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * 60) + '%';
  el.style.bottom = '20%';
  $('reactionLayer').appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ============ ENVOI ============
function sendData(obj) {
  if (conn && conn.open) conn.send(obj);
}

// ============ CONTRÔLE PARENTAL ============
$('parentPanelBtn').onclick = () => $('parentPanel').classList.remove('hidden');
$('closeParentPanel').onclick = () => $('parentPanel').classList.add('hidden');

$('cutChildMic').onclick = () => { sendData({ type: 'force-mic-off' }); showToast('🎤 Micro enfant coupé'); };
$('cutChildCam').onclick = () => { sendData({ type: 'force-cam-off' }); showToast('📷 Caméra enfant coupée'); };
$('lockChildDraw').onclick = () => { sendData({ type: 'force-lock-draw' }); showToast('🔒 Dessin enfant bloqué'); };
$('unlockChildDraw').onclick = () => { sendData({ type: 'force-unlock-draw' }); showToast('🔓 Dessin enfant autorisé'); };
$('clearChildBoard').onclick = () => { sendData({ type: 'force-clear-board' }); showToast('🧹 Tableau enfant effacé'); };
$('kickChild').onclick = () => {
  if (confirm('Déconnecter l\'enfant ?')) {
    sendData({ type: 'force-kick' });
    showToast('🚪 Enfant déconnecté');
  }
};

// ============ DÉTECTION SORTIE ============
let lastHiddenTime = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    lastHiddenTime = Date.now();
  } else if (document.visibilityState === 'visible' && lastHiddenTime) {
    const duration = Math.round((Date.now() - lastHiddenTime) / 1000);
    showToast(`👋 Tu es revenu après ${duration}s`);
    sendData({ type: 'child-away', data: { duration, timestamp: Date.now() } });
    lastHiddenTime = null;
  }
});

// ============ EXERCICES / CORRECTIONS / RÉPONSES ============
function createExercise(title, content) {
  const db = getEduDB();
  const ex = { id: Date.now().toString(), title, content,
               createdAt: new Date().toISOString(), childName: currentChildName };
  db.exercises.push(ex);
  saveEduDB(db);
  return ex;
}

function createResponse(exerciseId, text) {
  const db = getEduDB();
  const resp = { id: Date.now().toString(), exerciseId, text,
                 createdAt: new Date().toISOString(), childName: currentChildName };
  db.responses.push(resp);
  saveEduDB(db);
  return resp;
}

function createCorrection(exerciseId, text) {
  const db = getEduDB();
  const corr = { id: Date.now().toString(), exerciseId, text,
                 createdAt: new Date().toISOString() };
  db.corrections.push(corr);
  saveEduDB(db);
  return corr;
}

function renderExercises() {
  const db = getEduDB();
  let html = '';
  if (db.exercises.length === 0) {
    html = '<p>Aucun exercice pour le moment.</p>';
  } else {
    db.exercises.forEach(ex => {
      const responses = db.responses.filter(r => r.exerciseId === ex.id);
      const corrections = db.corrections.filter(c => c.exerciseId === ex.id);
      html += `
        <div class="exercise-card">
          <h3>${ex.title}</h3>
          <p>${ex.content}</p>
          <small>📅 ${new Date(ex.createdAt).toLocaleString('fr-FR')}</small>
          ${responses.length > 0 ? `
            <div class="responses">
              <h4>📤 Réponses :</h4>
              ${responses.map(r => `<div class="response-item"><p>${r.text}</p></div>`).join('')}
            </div>
          ` : ''}
          ${corrections.length > 0 ? `
            <div class="corrections">
              <h4>✅ Corrections :</h4>
              ${corrections.map(c => `<div class="correction-item"><p>${c.text}</p></div>`).join('')}
            </div>
          ` : ''}
          ${role === 'parent'
            ? `<button onclick="addCorrection('${ex.id}')">➕ Correction</button>`
            : `<button onclick="addResponse('${ex.id}')">✍️ Répondre</button>`}
        </div>
      `;
    });
  }
  if (role === 'parent') {
    html += '<button class="btn-big btn-parent" onclick="newExercise()" style="margin-top:12px">➕ Nouvel exercice</button>';
  }
  $('exercisesList').innerHTML = html;
}

window.newExercise = () => {
  const title = prompt('Titre de l\'exercice :');
  if (!title) return;
  const content = prompt('Contenu / consigne :');
  if (!content) return;
  createExercise(title, content);
  renderExercises();
};

window.addResponse = (exId) => {
  const text = prompt('Ta réponse :');
  if (!text) return;
  createResponse(exId, text);
  renderExercises();
};

window.addCorrection = (exId) => {
  const text = prompt('Ta correction :');
  if (!text) return;
  createCorrection(exId, text);
  renderExercises();
};

$('exercisesBtn').onclick = () => {
  renderExercises();
  $('exercisesPanel').classList.remove('hidden');
};
$('closeExercises').onclick = () => $('exercisesPanel').classList.add('hidden');

// ============ UI ============
$('helpBtn').onclick = () => $('helpModal').classList.remove('hidden');
$('closeHelp').onclick = () => $('helpModal').classList.add('hidden');
$('quitBtn').onclick = () => { if (confirm('Quitter la session ?')) location.reload(); };
$('toggleVideoBtn').onclick = () => {
  $('videoPanel').classList.toggle('hidden');
};
$('resetViewBtn').onclick = () => {
  scale = 1;
  applyZoom();
  centerView();
};

function copyCode(code) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => showToast('📋 Code copié !'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('📋 Code copié !');
  }
}

function showToast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.add('hidden'), ms);
}
