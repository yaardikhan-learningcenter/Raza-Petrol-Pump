window.ERP_CLOUD_OK = true;
/* =========================================================
   CLOUD LAYER — Firebase Auth (login) + Firestore (database)
   Replaces the old "save inside the HTML file" engine.

   Firestore layout:  collection "erp"  ->  one document per data section
     erp/meta, erp/tanks, erp/fuel, erp/nozzles, erp/oils, erp/customers, ...
     erp/tx_nozzleDiesel, erp/tx_creditSale, erp/tx_expenses, ...
   Each document = { json: "<stringified data>", by: "<tab id>", updatedAt }
   Only sections that changed are re-written (keeps it fast and cheap).
   ========================================================= */
var COLLECTION = 'erp';
var TX_KEYS = ['nozzleDiesel','nozzlePetrol','dip','creditSale','cashOils','purchases','receipts','payments','expenses','fundTransfer','partnersLedger','employeeLedger'];
var MASTER_ARRAYS = ['oils','customers','suppliers','banks','partners','employees','expenseHeads'];
var DEFAULT_EXPENSE_HEADS = ['Salaries','Electricity','Rent','Maintenance','Fuel Testing','Security','Stationery','Refreshment','Misc / Other'];
var MASTER_OBJECTS = ['meta','tanks','fuel','nozzles','calibration'];

var isDirty = false;
var saveState = 'idle';          // idle | saving | error | offline
var autoSaveTimer = null;
var lastSaved = {};              // docId -> json string last known to be in the cloud
var CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
var fbAuth = null, fbDb = null, unsubscribeSnap = null, appStarted = false;

/* ---------- helpers ---------- */
function $(id){ return document.getElementById(id); }
function configLooksEmpty(){
  var c = window.FIREBASE_CONFIG || {};
  return !c.apiKey || /PASTE/.test(c.apiKey) || /PASTE/.test(c.projectId || '');
}
function emptyTx(){ var t = {}; TX_KEYS.forEach(function(k){ t[k] = []; }); return t; }

/* Break DB into { docId: jsonString } (runtime-only _seq is stripped) */
function dbToChunks(){
  var out = {};
  MASTER_OBJECTS.forEach(function(k){ out[k] = JSON.stringify(DB[k] || {}); });
  MASTER_ARRAYS.forEach(function(k){ out[k] = JSON.stringify(DB[k] || []); });
  Object.keys(DB.tx).forEach(function(k){
    out['tx_' + k] = JSON.stringify(DB.tx[k], function(key, v){ return key === '_seq' ? undefined : v; });
  });
  return out;
}
function applyChunk(id, jsonStr){
  var v = JSON.parse(jsonStr);
  if (id.indexOf('tx_') === 0) DB.tx[id.slice(3)] = v; else DB[id] = v;
}
function ensureShape(){
  // first time after this upgrade: create the expense categories list from the old built-in list
  if (!DB.expenseHeads) DB.expenseHeads = DEFAULT_EXPENSE_HEADS.map(function(n, i){ return { id: 'EH_' + (i + 1), name: n }; });
  MASTER_OBJECTS.forEach(function(k){ if (!DB[k]) DB[k] = {}; });
  MASTER_ARRAYS.forEach(function(k){ if (!DB[k]) DB[k] = []; });
  if (!DB.tx) DB.tx = {};
  TX_KEYS.forEach(function(k){ if (!DB.tx[k]) DB.tx[k] = []; });
}

/* ---------- save status pill ---------- */
function updateSavePill(state){
  var pill = $('save-pill'); if (!pill) return;
  if (state) saveState = state;
  if (saveState === 'saving'){ pill.className = 'save-pill connected saving'; pill.innerHTML = '<span class="dot"></span> Saving…'; return; }
  if (saveState === 'error'){ pill.className = 'save-pill err'; pill.innerHTML = '<span class="dot"></span> Not saved — click to retry'; return; }
  pill.className = 'save-pill connected';
  pill.innerHTML = '<span class="dot"></span> ' + (isDirty ? 'Unsaved changes…' : 'Saved to cloud');
}
function updateUserChip(){
  var el = $('user-chip');
  if (el && fbAuth && fbAuth.currentUser) el.textContent = fbAuth.currentUser.email || '';
}

/* ---------- saving ---------- */
function markDirty(){
  isDirty = true;
  updateSavePill();
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function(){ saveToCloud(); }, 800);
}
function saveNow(){ clearTimeout(autoSaveTimer); return saveToCloud(false, true); }

async function saveToCloud(silent, force){
  if (!fbDb || !fbAuth.currentUser) return;
  var chunks = dbToChunks();
  var changed = Object.keys(chunks).filter(function(id){ return force === 'all' || lastSaved[id] !== chunks[id]; });
  if (!changed.length){ isDirty = false; updateSavePill('idle'); if (force === true) toast('Everything is already saved.', 'ok'); return; }
  updateSavePill('saving');
  try{
    var batch = fbDb.batch();
    changed.forEach(function(id){
      batch.set(fbDb.collection(COLLECTION).doc(id), {
        json: chunks[id], by: CLIENT_ID,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    changed.forEach(function(id){ lastSaved[id] = chunks[id]; });
    // anything edited while we were saving?
    var again = dbToChunks();
    var stillDirty = Object.keys(again).some(function(id){ return lastSaved[id] !== again[id]; });
    isDirty = stillDirty;
    updateSavePill('idle');
    if (stillDirty) markDirty();
    else if (!silent && force === true) toast('Saved to cloud.', 'ok');
  }catch(err){
    console.error(err);
    updateSavePill('error');
    toast('Could not save (' + (err.code || err.message) + '). Your data is still in this tab — check your internet and click the red pill to retry.', 'err');
  }
}

window.addEventListener('beforeunload', function(e){
  if (isDirty){ e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('online', function(){ if (isDirty) saveToCloud(); });

/* ---------- loading ---------- */
async function loadFromCloud(){
  var snap = await fbDb.collection(COLLECTION).get();
  if (snap.empty) return false;
  DB = { tx: emptyTx() };
  lastSaved = {};
  snap.forEach(function(doc){
    var d = doc.data();
    if (d && typeof d.json === 'string'){ applyChunk(doc.id, d.json); lastSaved[doc.id] = d.json; }
  });
  ensureShape();
  return true;
}

/* Live updates when someone else edits from another device */
function startRealtime(){
  if (unsubscribeSnap) unsubscribeSnap();
  unsubscribeSnap = fbDb.collection(COLLECTION).onSnapshot(function(snap){
    var applied = false;
    snap.docChanges().forEach(function(ch){
      if (ch.type === 'removed') return;
      var d = ch.doc.data({ serverTimestamps: 'estimate' });
      if (!d || typeof d.json !== 'string') return;
      if (ch.doc.metadata.hasPendingWrites || d.by === CLIENT_ID) return;   // our own write
      if (lastSaved[ch.doc.id] === d.json) return;                          // nothing new
      if (isDirty){ toast('Another device saved changes. Finish & save yours, then reload the page to see theirs.', 'warn'); return; }
      applyChunk(ch.doc.id, d.json); lastSaved[ch.doc.id] = d.json; applied = true;
    });
    if (applied){
      stampSeq();
      if (!document.getElementById('modal-backdrop').classList.contains('show')){ renderAll(); toast('Updated from another device.', 'ok'); }
      else toast('Data was updated from another device — close this form and reopen the page.', 'warn');
    }
  }, function(err){ console.warn('Realtime listener:', err); });
}

function bootApp(){
  ensureShape();
  stampSeq();
  hideLogin();
  isDirty = false;
  renderAll();
  updateSavePill('idle');
  if (!appStarted){ appStarted = true; }
  startRealtime();
}

/* ---------- export / import ---------- */
function exportJSON(){
  var copy = JSON.parse(JSON.stringify(DB, function(k, v){ return k === '_seq' ? undefined : v; }));
  downloadBlob('raza-petroleum-services-data-' + todayISO() + '.json', JSON.stringify(copy, null, 2), 'application/json');
  toast('Backup downloaded (JSON).', 'ok');
}
function readJsonFile(cb){
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = function(e){
    var f = e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if (!parsed.tx || !parsed.meta) throw new Error('This file does not look like a valid ERP data export.');
        cb(parsed);
      }catch(err){ toast('Import failed: ' + err.message, 'err'); showLoginMsg('Import failed: ' + err.message); }
    };
    reader.readAsText(f);
  };
  inp.click();
}
function triggerImportJSON(){
  if (!confirm('Importing REPLACES all data in the cloud with the contents of the file. Download a backup first if unsure.\n\nContinue?')) return;
  readJsonFile(async function(parsed){
    DB = parsed; ensureShape(); stampSeq();
    renderAll();
    await saveToCloud(true, 'all');
    toast('Data imported and saved to cloud.', 'ok');
  });
}

/* ---------- login screen ---------- */
function showLogin(html){ $('login-card').innerHTML = html; $('login-overlay').classList.add('show'); }
function hideLogin(){ $('login-overlay').classList.remove('show'); }
function showLoginMsg(m){ var e = $('login-err'); if (e) e.textContent = m; }

function renderLoginForm(){
  showLogin(
    '<div class="login-logo">⛽</div><h2>Raza Petroleum Services</h2>' +
    '<div class="login-sub">ERP &amp; Accounting — please sign in</div>' +
    '<form id="login-form" onsubmit="return doLogin(event)">' +
    '<label for="login-email">Email</label><input id="login-email" type="email" autocomplete="username" required>' +
    '<label for="login-pass">Password</label><input id="login-pass" type="password" autocomplete="current-password" required>' +
    '<button class="login-btn" id="login-btn" type="submit">Sign in</button></form>' +
    '<div class="login-err" id="login-err"></div>' +
    '<button class="login-link" type="button" onclick="doReset()">Forgot password?</button>'
  );
}
async function doLogin(e){
  e.preventDefault();
  var btn = $('login-btn'); btn.disabled = true; showLoginMsg('');
  try{
    await fbAuth.signInWithEmailAndPassword($('login-email').value.trim(), $('login-pass').value);
  }catch(err){
    btn.disabled = false;
    var msg = {'auth/invalid-credential':'Wrong email or password.','auth/wrong-password':'Wrong email or password.','auth/user-not-found':'Wrong email or password.',
      'auth/too-many-requests':'Too many attempts. Wait a few minutes and try again.','auth/network-request-failed':'No internet connection.'}[err.code];
    showLoginMsg(msg || ('Sign-in failed: ' + (err.code || err.message)));
  }
  return false;
}
async function doReset(){
  var em = $('login-email').value.trim();
  if (!em){ showLoginMsg('Type your email above first, then click "Forgot password?".'); return; }
  try{ await fbAuth.sendPasswordResetEmail(em); showLoginMsg('Password reset email sent (check spam too).'); }
  catch(err){ showLoginMsg('Could not send reset email: ' + (err.code || err.message)); }
}
function logout(){
  if (isDirty && !confirm('You have unsaved changes. Log out anyway?')) return;
  if (unsubscribeSnap){ unsubscribeSnap(); unsubscribeSnap = null; }
  fbAuth.signOut();
}

function renderFirstRun(){
  showLogin(
    '<div class="login-logo">☁️</div><h2>Cloud database is empty</h2>' +
    '<div class="login-sub">First-time setup</div>' +
    '<p class="login-note">Upload your existing data file (the <b>.json</b> exported from the old ERP) to fill the cloud database. This is done only once.</p>' +
    '<button class="login-btn" onclick="firstRunImport()">Choose data .json file</button>' +
    '<div class="login-err" id="login-err"></div>' +
    '<button class="login-link" type="button" onclick="logout()">Log out</button>'
  );
}
function firstRunImport(){
  readJsonFile(async function(parsed){
    DB = parsed; ensureShape();
    showLoginMsg('Uploading…');
    lastSaved = {};
    await saveToCloud(true, 'all');
    if (saveState === 'error'){ showLoginMsg('Upload failed — check the Firestore rules (README Step 4).'); return; }
    bootApp(); toast('Data uploaded to the cloud.', 'ok');
  });
}

function renderSetupNeeded(){
  showLogin(
    '<div class="login-logo">🛠️</div><h2>Cloud not configured yet</h2>' +
    '<p class="login-note">Open <b>firebase-config.js</b> and paste your Firebase settings (see README.md, Step 2). Then reload this page.</p>'
  );
}
function renderAccessDenied(){
  showLogin(
    '<div class="login-logo">🔒</div><h2>Access denied</h2>' +
    '<p class="login-note">You are logged in but this account is not allowed to open the database. Ask the owner to add your email to <b>firestore.rules</b> (README Step 4).</p>' +
    '<button class="login-btn" onclick="logout()">Log out</button>'
  );
}

/* ---------- start-up ---------- */
(function init(){
  if (configLooksEmpty()){ renderSetupNeeded(); return; }
  if (typeof firebase === 'undefined'){
    showLogin('<div class="login-logo">📡</div><h2>Cannot reach Firebase</h2><p class="login-note">Check your internet connection and reload the page.</p>');
    return;
  }
  firebase.initializeApp(window.FIREBASE_CONFIG);
  fbAuth = firebase.auth();
  fbDb = firebase.firestore();
  showLogin('<div class="login-logo">⛽</div><h2>Loading…</h2>');
  fbAuth.onAuthStateChanged(async function(user){
    if (!user){ appStarted = false; renderLoginForm(); return; }
    showLogin('<div class="login-logo">⛽</div><h2>Loading your data…</h2>');
    try{
      var has = await loadFromCloud();
      if (has) bootApp(); else renderFirstRun();
    }catch(err){
      console.error(err);
      if (err.code === 'permission-denied') renderAccessDenied();
      else showLogin('<div class="login-logo">📡</div><h2>Could not load data</h2><p class="login-note">' + esc(err.code || err.message) + '</p><button class="login-btn" onclick="location.reload()">Retry</button>');
    }
  });
})();
