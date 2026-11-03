// ============================================================
//  MON COURS v4 — Application complète temps réel
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

// Monde 3000x3000 pour scroll + zoom
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
  setTimeout(() => { initCanvas(); },
