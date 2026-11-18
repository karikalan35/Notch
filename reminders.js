// Scheduled reminders, saved in the app's data folder so they survive a restart.
const fs = require('fs');
class Reminders {
  constructor(file) { this.file = file || null; this.items = []; this.load(); }
  load() {
    if (!this.file) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(j)) this.items = j.filter(r => r && typeof r.id === 'string' && typeof r.text === 'string' && Number.isFinite(r.at));
    } catch (e) {}
  }
  save() { if (this.file) try { fs.writeFileSync(this.file, JSON.stringify(this.items)); } catch (e) {} }
  list() { return this.items.slice().sort((a, b) => a.at - b.at); }
  add(text, at) {
    text = String(text || '').trim().slice(0, 140); at = Number(at);
    if (!text || !Number.isFinite(at) || this.items.length >= 100) return null;
    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, at: Math.round(at) };
    this.items.push(r); this.save(); return r;
  }
  del(id) { this.items = this.items.filter(r => r.id !== id); this.save(); return this.list(); }
  hasDue(now) { return this.items.some(r => r.at <= now); }
  due(now) { const d = this.items.filter(r => r.at <= now).sort((a, b) => a.at - b.at); if (d.length) { this.items = this.items.filter(r => r.at > now); this.save(); } return d; }
}
module.exports = Reminders;
