'use strict';
/* Pure parsers for Escape from Tarkov log text and screenshot names. No Electron, no file access, so they can be tested anywhere.
   The game's log wording changes between patches, so every pattern here is deliberately forgiving and unknown lines are ignored. */

const MAP_ALIASES = [
  [/factory/i, 'factory'], [/bigmap|customs/i, 'customs'], [/woods/i, 'woods'], [/shoreline/i, 'shoreline'],
  [/rezerv|reserve/i, 'reserve'], [/lighthouse/i, 'lighthouse'], [/interchange/i, 'interchange'],
  [/tarkovstreets|streets/i, 'streets-of-tarkov'], [/sandbox|groundzero|ground_zero/i, 'ground-zero'],
  [/laboratory|\blabs?\b|the_lab/i, 'the-lab'], [/labyrinth/i, 'the-labyrinth'], [/icebreaker/i, 'icebreaker'], [/terminal/i, 'terminal']
];
/* normal raid length in minutes (used only to show a countdown) */
const RAID_MINUTES = { 'factory':20, 'customs':40, 'woods':45, 'shoreline':45, 'reserve':45, 'lighthouse':45, 'interchange':45, 'streets-of-tarkov':50, 'ground-zero':25, 'the-lab':40, 'the-labyrinth':45, 'icebreaker':45, 'terminal':45 };

function mapFromLocation(s){
  const t = String(s || '');
  for(const [re, k] of MAP_ALIASES) if(re.test(t)) return k;
  return null;
}

/* "2025-10-17 14:22:33.123|..." -> ms since epoch (local time, like the game writes it) */
function lineTime(line){
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(line);
  if(!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].slice(0, 3).padEnd(3, '0') : 0).getTime();
}

/* application.log: which map is loading, which server, when the raid starts and ends */
function parseApplication(text, now){
  const out = [];
  for(const line of String(text).split(/\r?\n/)){
    if(!line) continue;
    const ts = lineTime(line) || now || Date.now();
    let m;
    if(/NetworkGameCreate|profileStatus/i.test(line) && /Location:\s*\w+/.test(line)){
      const loc = /Location:\s*([\w-]+)/.exec(line), ip = /Ip:\s*([\d.]+)/i.exec(line), port = /Port:\s*(\d+)/i.exec(line), mode = /GameMode:\s*(\w+)/i.exec(line), rm = /RaidMode:\s*(\w+)/i.exec(line);
      const map = mapFromLocation(loc && loc[1]);
      if(map) out.push({ type:'loading', map, mode:mode ? mode[1] : '', raidMode:rm ? rm[1] : '', ip:ip ? ip[1] : '', port:port ? +port[1] : 0, ts });
      continue;
    }
    if((m = /scene preset path:\s*maps\/([\w-]+?)(?:_preset)?\.bundle/i.exec(line))){
      const map = mapFromLocation(m[1]); if(map) out.push({ type:'scene', map, ts }); continue;
    }
    if(/\b(GameStarted|Game started|raid started|StartedRaid)\b/i.test(line)){ out.push({ type:'start', ts }); continue; }
    if(/UserMatchOver|Network game exit|GameEnded|raid ended|EndedRaid|Matching exit/i.test(line)){ out.push({ type:'end', ts }); continue; }
  }
  return out;
}

/* notifications.log: quests (and flea payouts) arrive as chat messages. Messages are JSON, often spread over many lines, so we scan the raw text. */
const QUEST_RE = /"templateId"\s*:\s*"([0-9a-f]{24}) (description|failMessageText|successMessageText)"/g;
const STATUS = { description:'started', failMessageText:'failed', successMessageText:'finished' };
const ROUBLES = '5449016a4bdc2d6f028b456f';
function parseNotifications(text){
  const out = [], s = String(text);
  /* match start / raid end arrive as small JSON messages under a timestamped "Got notification | Name" line */
  const NOTE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)[^\n]*?Got notification \| (UserConfirmed|UserMatchOver)[^\n]*\r?\n(\{[\s\S]*?\r?\n\})/gm;
  let nm;
  while((nm = NOTE.exec(s))){
    let j; try{ j = JSON.parse(nm[3]); }catch(e){ continue; }
    const ts = lineTime(nm[1]);
    if(nm[2] === 'UserConfirmed'){
      const map = mapFromLocation(j.location);
      if(map) out.push({ type:'loading', map, mode:j.mode || '', raidMode:j.raidMode || '', ip:j.ip || '', port:+j.port || 0, ts, msg:j.eventId || null });
    } else out.push({ type:'end', ts, msg:j.eventId || null });
  }
  /* split into messages so each quest line pairs with its own timestamp */
  const parts = s.split(/(?="type"\s*:\s*"new_message")/);
  for(const part of parts){
    let m; QUEST_RE.lastIndex = 0;
    const dt = /"dt"\s*:\s*(\d{9,11})/.exec(part), id = /"_id"\s*:\s*"([0-9a-f]{24,26})"/.exec(part);
    while((m = QUEST_RE.exec(part))) out.push({ type:'quest', id:m[1], status:STATUS[m[2]], ts:dt ? +dt[1] * 1000 : null, msg:id ? id[1] : null });
    /* flea market / trader payouts: add up the roubles attached to a type-4 message */
    if(/"type"\s*:\s*4\b/.test(part) && part.includes(ROUBLES)){
      let total = 0; const re = new RegExp('"_tpl"\\s*:\\s*"' + ROUBLES + '"[\\s\\S]{0,300}?"StackObjectsCount"\\s*:\\s*(\\d+)', 'g'); let r;
      while((r = re.exec(part))) total += +r[1];
      if(total) out.push({ type:'earned', roubles:total, ts:dt ? +dt[1] * 1000 : null, msg:id ? id[1] : null });
    }
  }
  return out;
}

/* screenshot name -> position + facing (same rules as the website) */
const NUM = /^-?\d+(?:[.,]\d+)?$/;
const nums = c => { const a = c.split(',').map(t => t.trim()).filter(Boolean); return a.length && a.every(t => NUM.test(t)) ? a.map(t => parseFloat(t.replace(',', '.'))) : null; };
function parseShot(name){
  const base = String(name).replace(/\.(png|jpe?g|bmp|webp)$/i, '').replace(/\s*\(\d+\)\s*$/, ''), ch = base.split('_');
  let pos = null, rot = null;
  ch.forEach(c => { if(!c.includes(',')) return; const n = nums(c); if(!n) return; if(n.length === 3 && !pos) pos = n; else if(n.length === 4 && !rot) rot = n; });
  if(!pos) return null;
  return { name:String(name), x:pos[0], y:pos[1], z:pos[2], q:rot || null };
}

module.exports = { mapFromLocation, lineTime, parseApplication, parseNotifications, parseShot, RAID_MINUTES, MAP_ALIASES };
