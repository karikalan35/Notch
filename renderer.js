const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const n = $('#notch');
const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const ic = { pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>', play: '<path d="M7 4v16l13-8z"/>' };

/* ================= open / close =================
   The window is small while the notch is closed, so files can be dropped on it, and grows while it is open. */
let inside = false, winBig = false, closeT, shrinkT, holdUntil = 0;
const picking = () => !$('#picker').hidden;
const subOpen = () => !$('#sub').hidden;
const remindOpen = () => !$('#remind').hidden;
const hold = () => holdUntil > Date.now() || picking() || subOpen() || remindOpen();
async function openNotch(tab) {
  clearTimeout(closeT); clearTimeout(shrinkT);
  if (n.dataset.s === 'toast') { clearTimeout(noteT); noteBusy = false; }       // hovering a battery toast opens the notch instead
  if (!winBig) { winBig = true; await window.islet.size(true); }
  n.dataset.s = 'open';
  if (tab) setTab(tab);
}
function closeNotch() {
  n.dataset.s = 'rest';
  clearTimeout(shrinkT);
  shrinkT = setTimeout(() => { winBig = false; window.islet.size(false); }, 650);   // shrink after the closing animation
}
// opening and closing follow the real cursor position (below), not mouseenter/mouseleave: Chromium keeps a stale
// mouse position when the cursor leaves the non-focusable window and replays it as a fake mouseenter, which re-opened the notch
setInterval(() => { if (n.dataset.s === 'open' && !inside && !hold()) closeNotch(); }, 1000);
// the real cursor position (from the main process) is the truth; mouseenter/mouseleave can be missed.
// Checked on every tick (not only when the position changes), so nothing can keep the notch open once the cursor is away.
let outSince = 0, dbgAt = 0, opening = false;
window.islet.onCursor(c => {
  const r = n.getBoundingClientRect(), m = 6;
  inside = c.x >= r.left - m && c.x <= r.right + m && c.y >= r.top - m && c.y <= r.bottom + m;
  if (n.dataset.s === 'alert') { alertPaused = inside; return; }       // the reminder screen stays; hovering it pauses its countdown
  if (inside && n.dataset.s !== 'open' && !opening) { opening = true; openNotch().finally(() => { opening = false; }); }
  if (n.dataset.s !== 'open' || inside) { outSince = 0; return; }
  if (!outSince) outSince = Date.now();
  if (hold()) {                                           // why it is being kept open (written to %TEMP%\islet-hover.log)
    if (Date.now() - outSince > 5000 && Date.now() - dbgAt > 5000) {
      dbgAt = Date.now();
      window.islet.log('kept open: holdUntil=' + Math.max(0, holdUntil - Date.now()) + 'ms picker=' + picking() + ' sub=' + subOpen());
    }
    return;
  }
  if (Date.now() - outSince > 350) { outSince = 0; closeNotch(); }
});
$('#hide').onclick = () => window.islet.hide();

/* pin: when on, the notch stays above every other window; when off it behaves like a normal window */
let onTop = true;
function paintPin() {
  $('#pin').setAttribute('aria-pressed', onTop);
  const t = onTop ? 'Always on top: on (click to turn off)' : 'Always on top: off (click to turn on)';
  $('#pin').title = t; $('#pin').setAttribute('aria-label', t);
}
$('#pin').onclick = () => { onTop = !onTop; paintPin(); window.islet.setOnTop(onTop); };
window.islet.getOnTop().then(v => { onTop = v; paintPin(); });
window.islet.onOnTop(v => { onTop = v; paintPin(); });
paintPin();

/* ================= tabs ================= */
function setTab(k) {
  $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === k));
  $$('.pane').forEach(p => p.hidden = p.dataset.pane !== k);
  n.dataset.t = k;
  if (k === 'apps') loadApps();
  if (k === 'wid') widgets();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ================= closed notch: time, battery, privacy dots ================= */
function clockTick() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#rt').textContent = t; $('#clk').textContent = t;
  $('#dt').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
clockTick(); setInterval(clockTick, 5000);
if (navigator.getBattery) navigator.getBattery().then(b => {
  const show = () => {
    const pct = Math.round(b.level * 100);
    $('#rb').textContent = pct + '%'; $('#bat').textContent = pct + '%';
    $('#bst').textContent = b.charging ? 'Charging' : 'Battery';
    $('#bfill').setAttribute('width', String(Math.max(1, 12 * b.level)));
    $('#bfill').style.color = b.charging ? '#30d158' : (pct <= 15 ? '#ff453a' : '');
  };
  show();
  let wasCharging = b.charging, fullShown = b.charging && b.level >= 0.995;       // nothing is announced for the state the app starts in
  b.addEventListener('chargingchange', () => {
    show();
    const pct = Math.round(b.level * 100);
    if (b.charging && !wasCharging) { if (b.level >= 0.995) { fullShown = true; pushNote({ kind: 'full', pct }); } else pushNote({ kind: 'charging', pct }); }
    else if (!b.charging && wasCharging && b.level >= 0.995 && !fullShown) { fullShown = true; pushNote({ kind: 'full', pct }); }   // some laptops stop "charging" at 100%
    if (!b.charging && b.level < 0.995) fullShown = false;
    wasCharging = b.charging;
  });
  b.addEventListener('levelchange', () => {
    show();
    if (b.charging && b.level >= 0.995 && !fullShown) { fullShown = true; pushNote({ kind: 'full', pct: 100 }); }
    if (b.level < 0.97) fullShown = false;
  });
}); else { $('#rb').textContent = ''; $('#bat').textContent = 'n/a'; $('#bst').textContent = 'No battery'; }
const kinds = { mic: 'Microphone', cam: 'Camera', loc: 'Location' };
function applyPrivacy(p) {
  if (!p) return;
  Object.keys(kinds).forEach(k => $('#pd-' + k).classList.toggle('on', !!(p[k] && p[k].length)));
}
window.islet.getPrivacy().then(applyPrivacy); window.islet.onPrivacy(applyPrivacy);

/* ================= widgets ================= */
function widgets() {
  window.islet.uptime().then(s => {
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), d = Math.floor(h / 24);
    $('#up').textContent = d ? d + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  });
}
widgets(); setInterval(widgets, 30000);

/* ================= media ================= */
let media = null, artKey = '', iconFor = '';
let base = { pos: 0, at: 0, playing: false }, guardUntil = 0, drag = null;
const dur = () => media && media.dur > 0 && media.dur < 86400 ? media.dur : 0;
const rebase = (pos, playing) => { base = { pos, at: Date.now(), playing }; };
function localPos() {
  if (!media) return 0;
  const p = base.pos + (base.playing ? (Date.now() - base.at) / 1000 : 0);
  return dur() ? Math.min(p, dur()) : p;
}
let hasArt = false, iconUrl = '';
function paintCover() {
  const c = $('.cover');
  c.classList.toggle('has-art', hasArt);
  c.classList.toggle('big-icon', !hasArt && !!iconUrl);
}
const setArt = url => { hasArt = !!url; $('#art').style.backgroundImage = url ? 'url("' + url + '")' : ''; paintCover(); };
async function setIcon(exe) {                       // the source app's icon, and nothing else, in the corner of the banner
  if (exe === iconFor) return;
  iconFor = exe;
  const url = exe ? await window.islet.icon(exe) : '';
  if (iconFor === exe) { iconUrl = url || ''; $('#appicon').hidden = !url; $('#bigicon').hidden = !url; if (url) { $('#appicon').src = url; $('#bigicon').src = url; } paintCover(); }
}
function paintMedia() {
  const has = !!media, playing = has && base.playing;
  $('#mt').textContent = has ? (media.title || 'Unknown title') : 'Nothing playing';
  $('#ma').textContent = has ? (media.artist || (playing ? 'Playing' : 'Paused')) : 'Play something on your PC';
  ['#prev', '#play', '#next'].forEach(id => $(id).disabled = !has);
  $('#pi').innerHTML = playing ? ic.pause : ic.play;
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#art').classList.toggle('idle', !playing);
  $('#mini').classList.toggle('on', playing);
  $('#w1').classList.toggle('paused', !playing);
  $('#seek').classList.toggle('off', !canSeek());
  $('#seek').classList.toggle('live', has && !dur() && playing);
  tickProgress();
}
function tickProgress() {
  const has = !!media, d = dur(), p = drag ? drag.frac * d : localPos();
  $('#tn').textContent = fmt(has ? p : 0);
  $('#td').textContent = has ? (d ? fmt(d) : 'Live') : fmt(0);
  const pct = d ? Math.min(100, p / d * 100) : 0;
  $('#pb').style.width = pct + '%'; $('#knob').style.left = pct + '%';
}
/* switch source: shown only when two or more apps have media open; the chosen one plays, the others are paused */
const swIcons = new Map();
let swSig = '';
const appName = x => { const p = (x.exe || x.id || '').split(/[\\/!]/).pop().replace(/\.exe$/i, '').replace(/_.*$/, '').split('.').pop(); return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'App'; };
function swIcon(exe, img) {
  if (!exe) return;
  if (swIcons.has(exe)) { if (swIcons.get(exe)) img.src = swIcons.get(exe); return; }
  window.islet.icon(exe).then(u => { swIcons.set(exe, u || ''); if (u) img.src = u; });
}
function paintSessions() {
  const list = media && media.sessions && media.sessions.length > 1 ? media.sessions : [];
  $('#sw').hidden = !list.length; $('#mright').classList.toggle('multi', !!list.length);
  if (!list.length) { $('#swlist').hidden = true; swSig = ''; return; }
  const sig = JSON.stringify(list.map(x => [x.id, x.title, x.playing])) + media.sid;
  if (sig === swSig) return;
  swSig = sig;
  const box = $('#swlist'); box.textContent = '';
  list.forEach(x => {
    const b = document.createElement('button'); b.className = 'swrow'; b.setAttribute('aria-current', x.id === media.sid);
    const img = document.createElement('img'); img.alt = ''; swIcon(x.exe, img);
    const t = document.createElement('span'); t.className = 'st';
    const bt = document.createElement('b'); bt.textContent = x.title || appName(x);
    const sm = document.createElement('small'); sm.textContent = appName(x) + (x.artist ? ' \u00b7 ' + x.artist : '');
    t.append(bt, sm); b.append(img, t);
    if (x.playing) { const d = document.createElement('i'); d.className = 'pd'; b.appendChild(d); }
    b.onclick = e => { e.stopPropagation(); window.islet.media('select', x.id); box.hidden = true; };
    box.appendChild(b);
  });
}
$('#sw').onclick = e => { e.stopPropagation(); const box = $('#swlist'); box.hidden = !box.hidden; if (!box.hidden) swSig = ''; paintSessions(); };
function setMedia(m) {
  const prevKey = media && media.key;
  media = m && !m.none ? m : null;
  if (!media) { base.playing = false; artKey = ''; setArt(''); paintMedia(); setIcon(''); paintSessions(); return; }
  if (media.key !== artKey) { artKey = media.key; setArt(''); }
  if (media.art) setArt(media.art);
  // we keep our own running clock and only jump when the track changed, the user seeked, or the player disagrees by more than 3 seconds
  const guarded = guardUntil > Date.now(), playing = guarded ? base.playing : media.playing;
  if (media.key !== prevKey || Math.abs(media.pos - localPos()) > 3 || (!guarded && base.playing !== media.playing)) rebase(media.pos, playing);
  else base.playing = playing;
  paintMedia(); setIcon(media.exe || ''); paintSessions();
}
window.islet.getMedia().then(setMedia); window.islet.onMedia(setMedia);
setInterval(tickProgress, 250);                       // keeps the bar moving between updates
const guard = () => { guardUntil = Date.now() + 1500; };   // right after a click, ignore an old status from the player

$('#play').onclick = () => {                           // the button reacts at once, the player confirms a moment later
  if (!media) return;
  rebase(localPos(), !base.playing); guard(); paintMedia();
  window.islet.media('toggle');
};
$('#prev').onclick = () => window.islet.media('prev');
$('#next').onclick = () => window.islet.media('next');

/* click or drag the progress bar to jump to a point in the track */
const seekEl = $('#seek');
const canSeek = () => !!media && dur() > 0 && media.canSeek !== false;
const fracOf = e => { const r = seekEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
seekEl.addEventListener('pointerdown', e => {
  if (!canSeek()) return;
  seekEl.setPointerCapture(e.pointerId); seekEl.classList.add('drag'); drag = { frac: fracOf(e) }; tickProgress();
});
seekEl.addEventListener('pointermove', e => { if (drag) { drag.frac = fracOf(e); tickProgress(); } });
seekEl.addEventListener('pointerup', () => {
  if (!drag) return;
  const sec = drag.frac * dur(); drag = null; seekEl.classList.remove('drag');
  rebase(sec, base.playing); guard(); tickProgress();
  window.islet.media('seek', sec);
});
seekEl.addEventListener('pointercancel', () => { drag = null; seekEl.classList.remove('drag'); });
paintMedia();

/* ================= clipboard ================= */
let csT, clipList = [];
function copied() { const c = $('#cstat'); c.classList.add('on'); clearTimeout(csT); csT = setTimeout(() => c.classList.remove('on'), 1400); }
const svg = d => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
const PIN = svg('<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>'), DEL = svg('<path d="M6 6l12 12M18 6L6 18"/>');
function renderClips(list) {
  clipList = list || [];
  const p = $('#clips'); p.innerHTML = '';
  $('#cclear').disabled = !clipList.some(i => !i.pinned);
  if (!clipList.length) { p.innerHTML = '<p>Copy some text and it shows up here.</p>'; return; }
  clipList.forEach(it => {
    const row = document.createElement('div'); row.className = 'crow' + (it.pinned ? ' pinned' : '');
    const t = document.createElement('button'); t.className = 'ctext'; t.textContent = it.text; t.title = it.text;
    t.onclick = () => { window.islet.clipCopy(it.id); copied(); };
    const pin = document.createElement('button'); pin.className = 'cact cpin'; pin.innerHTML = PIN;
    pin.title = it.pinned ? 'Unpin' : 'Pin to the top'; pin.setAttribute('aria-label', pin.title);
    pin.onclick = () => window.islet.clipPin(it.id);
    const del = document.createElement('button'); del.className = 'cact cdel'; del.innerHTML = DEL;
    del.title = 'Delete'; del.setAttribute('aria-label', 'Delete this item');
    del.onclick = () => window.islet.clipDel(it.id);
    row.append(t, pin, del); p.appendChild(row);
  });
}
$('#cclear').onclick = () => window.islet.clipClear();
window.islet.getClips().then(renderClips); window.islet.onClips(renderClips);

/* ================= files: drop in, drag out ================= */
let shelf = [];
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
function renderShelf() {
  const l = $('#fl'); l.innerHTML = '';
  shelf.forEach(f => {
    const it = document.createElement('div'); it.className = 'fitem'; it.draggable = true; it.title = f.path;
    const img = document.createElement('img'); img.alt = ''; window.islet.icon(f.path).then(u => { if (u) img.src = u; else img.style.visibility = 'hidden'; });
    const em = document.createElement('em'); em.textContent = f.name; em.onclick = () => window.islet.openFile(f.path);
    const x = document.createElement('button'); x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Remove from the shelf'); x.onclick = () => { shelf = shelf.filter(y => y !== f); renderShelf(); };
    // dragging out: hand the real file to Windows so it can be dropped on the desktop, a folder or another app
    it.addEventListener('dragstart', e => { e.preventDefault(); holdUntil = Date.now() + 10000; window.islet.dragOut(f.path); });
    it.append(img, em, x); l.appendChild(it);
  });
  $('#ftxt').textContent = shelf.length ? shelf.length + (shelf.length > 1 ? ' files' : ' file') + ' on the shelf' : 'Drop files here';
  $('#fhint').style.visibility = shelf.length ? 'visible' : 'hidden';
}
function addToShelf(list) { (list || []).forEach(f => { if (!shelf.some(y => y.path === f.path)) shelf.push(f); }); renderShelf(); }
$('#pick').onclick = async () => addToShelf(await window.islet.pickFiles());
let dragLeaveT;
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); clearTimeout(dragLeaveT); holdUntil = Date.now() + 4000;
  if (n.dataset.s !== 'open' || n.dataset.t !== 'files') openNotch('files');
  $('#drop').classList.add('on');
}));
document.addEventListener('dragleave', e => {
  if (e.relatedTarget) return;
  $('#drop').classList.remove('on'); clearTimeout(dragLeaveT); dragLeaveT = setTimeout(() => { holdUntil = 0; }, 800);
});
document.addEventListener('drop', async e => {
  e.preventDefault(); $('#drop').classList.remove('on');
  if (!hasFiles(e)) return;
  const paths = [...e.dataTransfer.files].map(f => { try { return window.islet.pathFor(f); } catch (err) { return ''; } }).filter(Boolean);
  addToShelf(await window.islet.addFiles(paths));
  holdUntil = Date.now() + 1500;
});
renderShelf();

/* ================= controls ================= */
const fill = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
let muted = false, sendT = {}, warn = '';
const send = (cmd, val) => { clearTimeout(sendT[cmd]); sendT[cmd] = setTimeout(() => window.islet.sys(cmd, val), 60); };
$('#vs').oninput = e => { $('#vo').textContent = e.target.value; fill(e.target); send('vol', e.target.value); };
$('#bs').oninput = e => { $('#bo').textContent = e.target.value; fill(e.target); send('bri', e.target.value); };
const tile = k => $('.tile[data-k="' + k + '"]');
function paintTile(k, on, sub) {
  const t = tile(k); if (!t) return;
  t.dataset.on = !!on; t.querySelector('.tmain').setAttribute('aria-pressed', !!on); t.querySelector('small').textContent = sub;
}
function paintMic() { paintTile('mic', !muted, muted ? 'Muted' : 'On'); }
const flip = k => { const on = tile(k).dataset.on !== 'true'; paintTile(k, on, on ? 'On' : 'Off'); window.islet.sys(k, on ? 1 : 0); };
['wifi', 'bt', 'dark', 'night'].forEach(k => { tile(k).querySelector('.tmain').onclick = () => flip(k); });
tile('air').querySelector('.tmain').onclick = () => {
  const on = tile('air').dataset.on !== 'true';
  paintTile('air', on, on ? 'On' : 'Off');
  if (on) { paintTile('wifi', false, 'Off'); paintTile('bt', false, 'Off'); }
  window.islet.sys('air', on ? 1 : 0);
};
tile('mic').querySelector('.tmain').onclick = () => { muted = !muted; paintMic(); window.islet.sys('mic', muted ? 1 : 0); };
function applySys(s) {
  if (s.vol != null) { $('#vs').value = s.vol; $('#vo').textContent = s.vol; }
  if (s.bri != null) { $('#bs').value = s.bri; $('#bo').textContent = s.bri; }
  if (s.mic != null) { muted = !!s.mic; paintMic(); }
  [['wifi'], ['bt'], ['dark'], ['air'], ['night']].forEach(([k]) => {
    if (s[k] != null) paintTile(k, s[k] === 1, s[k] === 1 ? 'On' : 'Off');
    const bad = !!s['err_' + k] && s[k] == null, t = tile(k);
    if (bad) t.setAttribute('disabled-tile', ''); else t.removeAttribute('disabled-tile');
  });
  $('#bs').disabled = !!s.err_bri && s.bri == null;
  $('#brow').style.opacity = $('#bs').disabled ? .4 : 1;
  $('#vs').disabled = !!s.err_vol && s.vol == null;
  const names = { vol: 'volume', bri: 'brightness', mic: 'microphone', wifi: 'Wi-Fi', bt: 'Bluetooth', air: 'Airplane mode', dark: 'Dark Style', night: 'Night Light' };
  const bad = Object.keys(names).filter(k => s['err_' + k] && s[k] == null).map(k => names[k]);
  warn = bad.length ? 'Not available on this PC: ' + bad.join(', ') : '';
  $('#warn').textContent = warn;
  fill($('#vs')); fill($('#bs'));
}
fill($('#vs')); fill($('#bs'));
window.islet.getSys().then(applySys); window.islet.onSys(applySys);

/* Wi-Fi networks and Bluetooth devices, inside the Controls tab */
let subKind = null, wifiSel = null;
function openSub(kind) {
  subKind = kind; wifiSel = null; $('#sub').hidden = false; $('#spass').hidden = true; $('#smsg').textContent = '';
  $('#stitle').textContent = kind === 'wifi' ? 'Wi-Fi networks' : 'Bluetooth devices';
  $('#slist').innerHTML = '<p>Looking...</p>';
  window.islet.net(kind === 'wifi' ? 'wifiscan' : 'btscan');
}
async function closeSub() { $('#sub').hidden = true; subKind = null; wifiSel = null; await window.islet.focusable(false); }
$('#sback').onclick = closeSub;
$('#srefresh').onclick = () => { $('#slist').innerHTML = '<p>Looking...</p>'; window.islet.net(subKind === 'wifi' ? 'wifiscan' : 'btscan'); };
$$('[data-sub]').forEach(b => b.onclick = e => { e.stopPropagation(); openSub(b.dataset.sub); });
window.islet.onNet(m => {
  if (m.k === 'netmsg') { $('#smsg').textContent = m.v || ''; return; }
  if (m.k === 'wifilist' && subKind === 'wifi') renderWifi(m.v);
  if (m.k === 'btlist' && subKind === 'bt') renderBt(m.v);
});
function srow(name, meta, cur) {
  const r = document.createElement('div'); r.className = 'srow' + (cur ? ' cur' : '');
  const a = document.createElement('span'); a.className = 'sname'; a.textContent = name; a.title = name;
  const b = document.createElement('span'); b.className = 'smeta'; b.textContent = meta;
  r.append(a, b); return r;
}
function renderWifi(list) {
  const box = $('#slist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>No networks found. Switch Wi-Fi on first.</p>'; return; }
  list.forEach(n => {
    const r = srow(n.ssid, [n.secured ? 'Secured' : 'Open', n.signal ? n.signal + '%' : ''].filter(Boolean).join(' \u00b7 '), n.connected);
    const b = document.createElement('button'); b.className = 'tbtn';
    if (n.connected) { b.textContent = 'Disconnect'; b.onclick = () => { $('#smsg').textContent = 'Disconnecting...'; window.islet.net('wifidisc'); }; }
    else { b.textContent = 'Connect'; b.onclick = () => joinWifi(n); }
    r.appendChild(b); box.appendChild(r);
  });
}
function joinWifi(n) {
  if (n.secured && !n.saved) {                          // a new secured network needs its password; typing needs keyboard focus for a moment
    wifiSel = n; $('#spass').hidden = false; $('#spw').value = ''; $('#smsg').textContent = 'Password for ' + n.ssid;
    window.islet.focusable(true).then(() => $('#spw').focus());
    return;
  }
  $('#spass').hidden = true; window.islet.net('wificonn', { ssid: n.ssid, auth: n.auth });
}
$('#sjoin').onclick = () => {
  const pass = $('#spw').value;
  if (!wifiSel || !pass) return;
  window.islet.net('wificonn', { ssid: wifiSel.ssid, pass, auth: wifiSel.auth });
  $('#spass').hidden = true; $('#spw').value = ''; wifiSel = null; window.islet.focusable(false);
};
$('#spw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#sjoin').click(); });
function renderBt(list) {
  const box = $('#slist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>No paired devices found. Switch Bluetooth on first.</p>'; return; }
  list.forEach(d => box.appendChild(srow(d.name || 'Unknown device', d.connected ? 'Connected' : 'Paired', d.connected)));
  const p = document.createElement('p'); p.textContent = 'Windows does not let apps connect or pair devices; do that from the device.'; box.appendChild(p);
}

/* ================= applications ================= */
let apps = [], installed = null;
const letter = name => { const d = document.createElement('div'); d.className = 'aph'; d.textContent = (name || '?').trim().charAt(0).toUpperCase(); return d; };
function iconNode(path, name) {
  const img = document.createElement('img'); img.alt = '';
  const ph = letter(name);
  window.islet.icon(path).then(u => { if (u) { img.src = u; ph.replaceWith(img); } });
  return ph;
}
// the picker can hold hundreds of apps: an icon is only fetched when its row scrolls into view
const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); if (en.target._load) en.target._load(); } }), { root: $('#plist'), rootMargin: '80px' });
function iconNodeLazy(path, name) {
  const ph = letter(name);
  ph._load = () => window.islet.icon(path).then(u => { if (u) { const img = document.createElement('img'); img.alt = ''; img.src = u; ph.replaceWith(img); } });
  io.observe(ph); return ph;
}
function renderApps() {
  const g = $('#agrid'); g.innerHTML = '';
  apps.forEach(a => {
    const t = document.createElement('div'); t.className = 'atile'; t.setAttribute('role', 'button'); t.tabIndex = 0; t.title = a.name;
    t.onclick = () => window.islet.appsLaunch(a.path);
    t.onkeydown = e => { if (e.key === 'Enter') window.islet.appsLaunch(a.path); };
    const lab = document.createElement('span'); lab.textContent = a.name;
    const rm = document.createElement('button'); rm.className = 'arm'; rm.textContent = '\u00d7'; rm.title = 'Remove this shortcut'; rm.setAttribute('aria-label', 'Remove ' + a.name);
    rm.onclick = async e => { e.stopPropagation(); apps = await window.islet.appsRemove(a.path); renderApps(); };
    t.append(iconNode(a.path, a.name), lab, rm); g.appendChild(t);
  });
  const add = document.createElement('div'); add.className = 'atile add'; add.title = 'Add an application';
  add.setAttribute('role', 'button'); add.tabIndex = 0; add.setAttribute('aria-label', 'Add an application');
  const ph = document.createElement('div'); ph.className = 'aph';
  ph.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const lab = document.createElement('span'); lab.textContent = 'Add';
  add.append(ph, lab); add.onclick = openPicker; add.onkeydown = e => { if (e.key === 'Enter') openPicker(); }; g.appendChild(add);
}
async function loadApps() { apps = await window.islet.appsList(); renderApps(); }

async function openPicker() {
  $('#picker').hidden = false; $('#psearch').value = '';
  await window.islet.focusable(true); $('#psearch').focus();       // the notch normally never takes keyboard focus; it does while you type a search
  if (!installed) { $('#plist').innerHTML = '<p>Looking for installed apps...</p>'; installed = await window.islet.appsInstalled(); }
  renderPicker();
}
async function closePicker() { $('#picker').hidden = true; await window.islet.focusable(false); }
function renderPicker() {
  const q = $('#psearch').value.trim().toLowerCase();
  const list = (installed || []).filter(a => !q || a.name.toLowerCase().includes(q));
  const box = $('#plist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>' + (installed && installed.length ? 'No app matches that.' : 'No installed apps found here. Use Browse to pick one.') + '</p>'; return; }
  io.disconnect();
  list.forEach(a => {
    const added = apps.some(x => x.path.toLowerCase() === a.path.toLowerCase());
    const r = document.createElement('button'); r.className = 'prow' + (added ? ' added' : '');
    const nm = document.createElement('span'); nm.textContent = a.name + (added ? '  (added)' : '');
    r.append(iconNodeLazy(a.path, a.name), nm);
    if (!added) r.onclick = async () => { apps = await window.islet.appsAdd(a); renderApps(); renderPicker(); };
    box.appendChild(r);
  });
}
$('#psearch').oninput = renderPicker;
$('#pclose').onclick = closePicker;
$('#pbrowse').onclick = async () => { apps = await window.islet.appsBrowse(); renderApps(); renderPicker(); };



/* ================= notifications: battery toasts and the reminder screen =================
   A battery toast is a small, short pill. A reminder expands the notch into its full notification screen.
   Both remember what the notch was doing and go back to it, and they wait in a queue so they never overlap. */
const noteQ = [];
let noteBusy = false, noteT, alertCur = null, alertIv, alertLeft = 0, alertTotal = 1, alertPaused = false, prevS = { s: 'rest', t: 'music' };
const bolt = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>';
const check = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function pushNote(note) {
  note.born = Date.now();
  if (note.kind === 'reminder') noteQ.splice(noteQ.filter(x => x.kind === 'reminder').length, 0, note);   // reminders first, in order
  else noteQ.push(note);
  runNotes();
}
function runNotes() {
  for (let i = noteQ.length - 1; i >= 0; i--) if (noteQ[i].kind !== 'reminder' && Date.now() - noteQ[i].born > 15000) noteQ.splice(i, 1);   // an old battery toast is no longer news
  if (noteBusy || !noteQ.length) return;
  const i = noteQ.findIndex(x => x.kind === 'reminder' || n.dataset.s === 'rest');   // battery toasts wait while the notch is open
  if (i < 0) return;
  const note = noteQ.splice(i, 1)[0];
  noteBusy = true;
  (note.kind === 'reminder' ? showAlert(note) : showToast(note)).catch(() => { noteBusy = false; });
}
setInterval(runNotes, 500);

async function showToast(note) {
  const full = note.kind === 'full';
  $('#tic').innerHTML = full ? check : bolt;
  $('#tt').textContent = full ? 'Fully charged' : 'Charging';
  $('#tsub').textContent = full ? 'You can unplug the charger' : 'Charger connected';
  $('#tpct').textContent = (note.pct != null ? note.pct : 100) + '%';
  clearTimeout(shrinkT);
  await window.islet.size('toast'); winBig = false;
  n.dataset.s = 'toast';
  noteT = setTimeout(() => {                                  // back to the previous state (the closed notch)
    if (n.dataset.s === 'toast') closeNotch();
    noteBusy = false; setTimeout(runNotes, 700);
  }, full ? 4500 : 3500);
}

const clockOf = ms => {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
};
async function showAlert(note) {
  alertCur = note; prevS = { s: n.dataset.s === 'toast' ? 'rest' : n.dataset.s, t: n.dataset.t };
  const len = note.text.length;
  $('#amsg').className = 'amsg' + (len > 90 ? ' l' : len > 40 ? ' m' : '');
  $('#amsg').firstElementChild.textContent = note.text;
  $('#atime').textContent = clockOf(note.at);
  clearTimeout(shrinkT); clearTimeout(closeT); clearTimeout(noteT);
  if (!winBig) { winBig = true; await window.islet.size(true); }
  n.dataset.s = 'alert';
  alertTotal = alertLeft = Math.min(30000, Math.max(9000, 6000 + len * 90));       // long enough to read, longer for a longer message
  alertPaused = inside;
  $('#abarf').style.width = '100%';
  clearInterval(alertIv);
  alertIv = setInterval(() => {
    if (!alertPaused) alertLeft -= 100;
    $('#abarf').style.width = Math.max(0, alertLeft / alertTotal * 100) + '%';
    if (alertLeft <= 0) endAlert(false);
  }, 100);
}
function endAlert(snooze) {
  if (!alertCur) return;
  clearInterval(alertIv);
  const note = alertCur; alertCur = null;
  if (snooze) window.islet.remAdd({ text: note.text, at: Date.now() + 5 * 60000 });
  if (prevS.s === 'open') n.dataset.s = 'open';                // it was open: stay open (it closes by itself if the cursor is away)
  else closeNotch();                                           // it was closed: shrink back smoothly
  if (note.wasHidden && !noteQ.some(x => x.kind === 'reminder')) setTimeout(() => window.islet.hide(), 800);
  noteBusy = false; setTimeout(runNotes, 800);
}
$('#adone').onclick = () => endAlert(false);
$('#asnooze').onclick = () => endAlert(true);
window.islet.onReminder(r => pushNote({ kind: 'reminder', text: r.text, at: r.at, wasHidden: r.wasHidden }));
window.islet.onNoteTest(k => {
  if (k === 'reminder') pushNote({ kind: 'reminder', text: 'Team stand-up starts in 5 minutes', at: Date.now() });
  else pushNote({ kind: k, pct: k === 'full' ? 100 : 63 });
});

/* ================= reminders: the bell button ================= */
let remChip = 0;
const pad2 = v => String(v).padStart(2, '0');
const hhmm = ms => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
function renderRem(list) {
  const box = $('#rlist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>No reminders yet.</p>'; return; }
  list.forEach(x => {
    const row = document.createElement('div'); row.className = 'rrow';
    const tm = document.createElement('time'); tm.textContent = clockOf(x.at);
    const tx = document.createElement('span'); tx.textContent = x.text; tx.title = x.text;
    const del = document.createElement('button'); del.textContent = '\u00d7'; del.setAttribute('aria-label', 'Delete this reminder');
    del.onclick = async () => renderRem(await window.islet.remDel(x.id));
    row.append(tm, tx, del); box.appendChild(row);
  });
}
async function openRemind() {
  $('#remind').hidden = false; n.dataset.r = '1';
  remChip = 0; $('#rtime').value = hhmm(Date.now() + 10 * 60000); $('#rmsg').textContent = '';
  await window.islet.focusable(true); $('#rtext').focus();
  renderRem(await window.islet.remList());
}
async function closeRemind() { $('#remind').hidden = true; delete n.dataset.r; await window.islet.focusable(false); }
async function addRemind() {
  const text = $('#rtext').value.trim();
  if (!text) { $('#rmsg').textContent = 'Type what to remind you about.'; $('#rtext').focus(); return; }
  const v = $('#rtime').value;
  if (!/^\d\d:\d\d$/.test(v)) { $('#rmsg').textContent = 'Pick a time.'; return; }
  let at;
  if (remChip && hhmm(remChip) === v) at = remChip;                          // a quick button keeps its exact moment
  else {
    const d = new Date(); d.setHours(+v.slice(0, 2), +v.slice(3), 0, 0); at = d.getTime();
    if (at <= Date.now()) at += 86400000;                                      // that time has passed today: tomorrow
  }
  renderRem(await window.islet.remAdd({ text, at }));
  $('#rtext').value = ''; remChip = 0;
  $('#rmsg').textContent = 'Set for ' + clockOf(at);
}
$('#bell').onclick = () => (remindOpen() ? closeRemind() : openRemind());
$('#rclose').onclick = closeRemind;
$('#radd').onclick = addRemind;
$('#rtext').addEventListener('keydown', e => { if (e.key === 'Enter') addRemind(); });
$('#rtime').addEventListener('input', () => { remChip = 0; });
$$('.rchips [data-m]').forEach(b => b.onclick = () => { remChip = Date.now() + (+b.dataset.m) * 60000; $('#rtime').value = hhmm(remChip); });
