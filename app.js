// ============================================================
//  MON COURS — Version Web PeerJS (aucun serveur requis)
// ============================================================

const $ = (id) => document.getElementById(id);
const randomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// ============ ÉTAT ============
let role = null;
let peer = null;
let conn = null;          // DataConnection PeerJS
let call = null;          // MediaConnection PeerJS
let localStream = null;
let myCode = null;

let currentTool = 'pen';
let currentColor = '#2563eb';
let currentSize = 4;
let drawing = false;
let strokes = [];
let currentStroke = null;

// ============================================================
//  LOBBY
// ============================================================
document.querySelectorAll('.role-buttons button').forEach(btn => {
  btn.onclick = async () => {
    role = btn.dataset.role;

    // Demander les permissions caméra/micro
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      $('localVideo').srcObject = localStream;
    } catch (e) {
      console.warn('Média indisponible :', e);
      showToast('⚠️ Caméra/micro refusés — tu peux quand même dessiner');
    }

    document.querySelector('.role-buttons').classList.add('hidden');

    if (role === 'parent') {
      startAsParent();
    } else {
      $('childJoin').classList.remove('hidden');
      $('joinBtn').onclick = joinAsChild;
      $('codeInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') joinAsChild();
      });
    }
  };
});

// ============================================================
//  PARENT : crée la session
// ============================================================
function startAsParent() {
  myCode = randomCode();
  $('parentWait').classList.remove('hidden');
  $('myCode').textContent = myCode;

  peer = new Peer(myCode, {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  peer.on('open', (id) => {
    $('status').textContent = '✅ Session prête';
    $('status').style.color = '#10b981';
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      showToast('⚠️ Ce code existe déjà, recharge la page');
    } else {
      console.error(err);
      showToast('Erreur : ' + err.type);
    }
  });

  peer.on('connection', (c) => {
    conn = c;
    setupConnection();
  });

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

// ============================================================
//  ENFANT : rejoint la session
// ============================================================
function joinAsChild() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) return showToast('⚠️ Code invalide');

  peer = new Peer({
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  peer.on('open', () => {
    $('status').textContent = '🔗 Connexion...';
    conn = peer.connect(code, { reliable: true });

    conn.on('open', () => {
      // Rejoindre la salle
      enterClassroom(code);

      // Appeler le parent en vidéo
      if (localStream) {
        call = peer.call(code, localStream);
        call.on('stream', (stream) => {
          $('remoteVideo').srcObject = stream;
          $('waitingMsg').classList.add('hidden');
        });
      }

      setupConnection();
    });

    conn.on('error', (err) => {
      showToast('❌ Impossible de rejoindre');
      $('status').textContent = '❌ Connexion échouée';
    });
  });

  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      showToast('❌ Ce code n\'existe pas. Vérifie avec papa.');
      $('status').textContent = '❌ Code invalide';
    } else {
      showToast('Erreur : ' + err.type);
    }
  });
}

// ============================================================
//  CONNEXION ÉTABLIE (les 2 côtés)
// ============================================================
function setupConnection() {
  conn.on('open', () => {
    enterClassroom(myCode || conn.peer);
    $('connStatus').textContent = '🟢 Connecté';
  });

  conn.on('data', (msg) => {
    switch (msg.type) {
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
        showPointer(msg.data);
        break;
      case 'reaction':
        floatEmoji(msg.data);
        break;
      case 'background':
        setBackground(msg.data.url);
        break;
    }
  });

  conn.on('close', () => {
    $('connStatus').textContent = '🔴 Déconnecté';
    $('waitingMsg').classList.remove('hidden');
  });
}

// ============================================================
//  ENTRER DANS LA SALLE
// ============================================================
function enterClassroom(code) {
  $('lobby').classList.add('hidden');
  $('classroom').classList.remove('hidden');
  $('roomName').textContent = '📚 ' + code;
  setTimeout(() => { resizeCanvas(); }, 120);
}

// ============================================================
//  CANVAS
// ============================================================
const board = $('board');
const ctx = board.getContext('2d');

function resizeCanvas() {
  const rect = board.getBoundingClientRect();
  const data = board.toDataURL();
  board.width = rect.width;
  board.height = rect.height;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0);
  img.src = data;
}
window.addEventListener('resize', () => setTimeout(resizeCanvas, 100));
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));

// ============ OUTILS ============
function setTool(t) {
  currentTool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
  $({ pen:'penBtn', eraser:'eraserBtn', text:'textBtn', pointer:'pointerBtn' }[t]).classList.add('active');
}
$('penBtn').onclick = () => setTool('pen');
$('eraserBtn').onclick = () => setTool('eraser');
$('textBtn').onclick = () => setTool('text');
$('pointerBtn').onclick = () => setTool('pointer');

document.querySelectorAll('.color-dot').forEach(dot => {
  dot.onclick = () => {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    currentColor = dot.dataset.color;
    if (currentTool === 'eraser') setTool('pen');
  };
});

$('undoBtn').onclick = () => {
  strokes.pop();
  redrawAll();
  sendData({ type: 'undo' });
};

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

// ============ DESSIN ============
function getPos(e) {
  const r = board.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return { x: p.clientX - r.left, y: p.clientY - r.top };
}

function startDraw(e) {
  e.preventDefault();
  const pos = getPos(e);

  if (currentTool === 'pointer') {
    sendData({ type: 'pointer', data: pos });
    showPointer(pos);
    return;
  }
  if (currentTool === 'text') {
    const txt = prompt('Texte à écrire :');
    if (txt) {
      const s = { type:'text', x:pos.x, y:pos.y, text:txt, color:currentColor, size: currentSize * 4 };
      strokes.push(s); drawStroke(s);
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
}

function moveDraw(e) {
  if (!drawing || !currentStroke) return;
  e.preventDefault();
  const pos = getPos(e);
  const prev = currentStroke.points[currentStroke.points.length - 1];
  currentStroke.points.push(pos);

  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth = currentStroke.size;
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function endDraw() {
  if (!drawing) return;
  drawing = false;
  if (currentStroke && currentStroke.points.length > 1) {
    strokes.push(currentStroke);
    sendData({ type: 'draw', data: currentStroke });
  }
  currentStroke = null;
}

board.addEventListener('mousedown', startDraw);
board.addEventListener('mousemove', moveDraw);
board.addEventListener('mouseup', endDraw);
board.addEventListener('mouseleave', endDraw);
board.addEventListener('touchstart', startDraw, { passive: false });
board.addEventListener('touchmove', moveDraw, { passive: false });
board.addEventListener('touchend', endDraw);

function drawStroke(s) {
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
function showPointer(pos) {
  const dot = $('pointerDot');
  dot.classList.remove('hidden');
  dot.style.left = pos.x + 'px';
  dot.style.top = pos.y + 'px';
  clearTimeout(window._pt);
  window._pt = setTimeout(() => dot.classList.add('hidden'), 1500);
}

// ============ FOND (image uploadée) ============
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
}

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

// ============ MIC / CAM ============
$('micBtn').onclick = () => {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('micBtn').classList.toggle('off', !t.enabled);
  $('micBtn').querySelector('.icon').textContent = t.enabled ? '🎤' : '🔇';
};
$('camBtn').onclick = () => {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  t.enabled = !t.enabled;
  $('camBtn').classList.toggle('off', !t.enabled);
  $('camBtn').querySelector('.icon').textContent = t.enabled ? '📷' : '🚫';
};

// ============ DONNÉES ============
function sendData(obj) {
  if (conn && conn.open) conn.send(obj);
}

// ============ UI ============
$('helpBtn').onclick = () => $('helpModal').classList.remove('hidden');
$('closeHelp').onclick = () => $('helpModal').classList.add('hidden');
$('quitBtn').onclick = () => { if (confirm('Quitter la session ?')) location.reload(); };
$('toggleVideoBtn').onclick = () => {
  $('videoPanel').classList.toggle('hidden');
  setTimeout(resizeCanvas, 100);
};

function copyCode(code) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => showToast('📋 Code copié !'));
  } else {
    // fallback Android ancien
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
