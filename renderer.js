const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const n = $('#notch');
let hoverT, playing = true, t = 41;
const started = Date.now();
const DUR = 198;

/* hover: open the notch and let it receive clicks; close and become click-through again when the pointer leaves */
n.addEventListener('mouseenter', () => { clearTimeout(hoverT); window.islet.setInteractive(true); n.dataset.s = 'open'; });
n.addEventListener('mouseleave', () => {
  hoverT = setTimeout(() => { n.dataset.s = 'rest'; window.islet.setInteractive(false); }, 300);
});

/* tabs */
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  $$('.pane').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
}));

/* demo music player (real now-playing comes in a later step) */
const ic = { pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>', play: '<path d="M7 4v16l13-8z"/>' };
const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
function music() {
  $('#tn').textContent = fmt(t); $('#pb').style.width = (t / DUR * 100) + '%';
  $('#pi').innerHTML = playing ? ic.pause : ic.play;
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#w1').classList.toggle('paused', !playing);
}
$('#play').onclick = () => { playing = !playing; music(); };
$('#prev').onclick = () => { t = 0; music(); };
$('#next').onclick = () => { t = 0; music(); };
setInterval(() => { if (playing) { t = (t + 1) % DUR; music(); } }, 1000);
music();

/* clipboard history from the main process */
function status(msg) { $('#status').textContent = msg; }
function renderClips(list) {
  const p = $('#clips'); p.innerHTML = '';
  if (!list.length) { p.innerHTML = '<p>Copy some text and it shows up here.</p>'; return; }
  list.slice(0, 4).forEach(text => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = () => { window.islet.copy(text); status('Copied again'); };
    p.appendChild(b);
  });
}
window.islet.getClips().then(renderClips);
window.islet.onClips(renderClips);

/* widgets */
function widgets() {
  const d = new Date();
  $('#clk').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#dt').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  $('#up').textContent = Math.floor((Date.now() - started) / 60000) + 'm';
}
widgets(); setInterval(widgets, 15000);
if (navigator.getBattery) navigator.getBattery().then(b => {
  const show = () => { $('#bat').textContent = Math.round(b.level * 100) + '%'; $('#bst').textContent = b.charging ? 'Charging' : 'Battery'; };
  show(); b.addEventListener('levelchange', show); b.addEventListener('chargingchange', show);
});

/* hide and quit */
$('#hide').onclick = () => window.islet.hide();
$('#quit').onclick = () => window.islet.quit();

/* file shelf: files are picked with a dialog, kept in memory, click a name to open it */
let shelf = [];
function renderShelf() {
  const l = $('#fl'); l.innerHTML = '';
  shelf.slice(-4).forEach(f => {
    const s = document.createElement('span');
    const e = document.createElement('em'); e.textContent = f.name; e.title = f.path; e.onclick = () => window.islet.openFile(f.path);
    const x = document.createElement('button'); x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Remove'); x.onclick = () => { shelf = shelf.filter(y => y !== f); renderShelf(); };
    s.append(e, x); l.appendChild(s);
  });
  $('#ftxt').textContent = shelf.length ? shelf.length + (shelf.length > 1 ? ' files' : ' file') + ' on the shelf' : 'No files on the shelf';
}
$('#pick').onclick = async () => {
  const picked = await window.islet.pickFiles();
  picked.forEach(f => { if (!shelf.some(y => y.path === f.path)) shelf.push(f); });
  renderShelf();
};

/* volume, brightness, microphone (Windows only; talks to a small PowerShell helper) */
const fill = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
let muted = false, sendT = {};
function send(cmd, val) { clearTimeout(sendT[cmd]); sendT[cmd] = setTimeout(() => window.islet.sys(cmd, val), 60); }
$('#vs').oninput = e => { $('#vo').textContent = e.target.value; fill(e.target); send('vol', e.target.value); };
$('#bs').oninput = e => { $('#bo').textContent = e.target.value; fill(e.target); send('bri', e.target.value); };
$('#mc').onclick = () => { muted = !muted; paintMic(); window.islet.sys('mic', muted ? 1 : 0); };
function paintMic() { $('#mc').textContent = muted ? 'Mic muted' : 'Mic on'; $('#mc').setAttribute('aria-pressed', muted); }
function applySys(s) {
  if (s.vol != null) { $('#vs').value = s.vol; $('#vo').textContent = s.vol; }
  if (s.bri != null) { $('#bs').value = s.bri; $('#bo').textContent = s.bri; }
  if (s.mic != null) { muted = !!s.mic; paintMic(); }
  $('#bs').disabled = !!s.err_bri && s.bri == null;
  $('#brow').style.opacity = $('#bs').disabled ? .4 : 1;
  $('#vs').disabled = !!s.err_vol && s.vol == null;
  const bad = [s.err_vol && s.vol == null && 'volume', s.err_bri && s.bri == null && 'brightness', s.err_mic && s.mic == null && 'microphone'].filter(Boolean);
  if (bad.length) status('Not available on this PC: ' + bad.join(', '));
  fill($('#vs')); fill($('#bs'));
}
fill($('#vs')); fill($('#bs'));
window.islet.getSys().then(applySys);
window.islet.onSys(applySys);
