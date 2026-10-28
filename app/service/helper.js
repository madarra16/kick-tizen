'use strict';
// Network helper for the Kick app on Tizen 5 (2019) TVs: HLS playlists and video segments for
// AVPlay, and the app's Kick API calls and images (/f), all with fast name lookups.
//
// The TV's AVPlay asks servers for gzip-compressed playlists but cannot read them, and
// Kick's CDN (Amazon IVS) compresses playlists for clients that accept it, so playback
// fails with PLAYER_ERROR_NOT_SUPPORTED_FILE / CONNECTION_FAILED. This service fetches
// playlists without asking for compression and serves them on http://127.0.0.1:47820.
// Playlist and segment URIs are pointed back here too: AVPlay's own downloads use the slow
// system resolver below, which made opening a clip or jumping in it take 5 s. Segments are
// kept in memory (CACHE_MAX), and in videos the next AHEAD_S seconds are fetched ahead.
//
// Name lookups on these TVs often take 5 s: about one DNS packet in ten is lost on the Wi-Fi,
// and the system resolver waits 5 s before asking again. This Node (4.4) has no lookup cache
// either. A live stream reloads its playlist every 2 s, so without a cache, kept-alive
// connections and a resolver that retries quickly, the stream would starve and queued
// lookups would block Node's small thread pool.

var http = require('http');
var https = require('https');
var dns = require('dns');
var dgram = require('dgram');
var url = require('url');

var PORT = 47820, IMAGE_PORT = 47821;  // pictures on their own port, see core.js K.helper.url
var UA = 'samsung-agent/1.1';
var DNS_TTL_MS = 5 * 60 * 1000;
var DNS_RETRY_MS = 400, DNS_ROUNDS = 6;
var IPV4 = /^\d+\.\d+\.\d+\.\d+$/;
var CORS = { 'Access-Control-Allow-Origin': '*' };
var PROXY_TARGET = /^https:\/\/([a-z0-9-]+\.)*kick\.com\//i;
// Playlists and segments only from Kick and its video CDN (Amazon IVS). The helper answers any
// local caller with open CORS (the app needs that), so without this list a web page in the TV's
// browser could use it to read other machines on the home network.
var MEDIA_HOST = /^([a-z0-9-]+\.)*(kick\.com|live-video\.net)$/i;
function allowed(target) { var u = url.parse(target || ''); return u.protocol === 'https:' && MEDIA_HOST.test(u.hostname || ''); }
// A 1080p segment is about 2 MB in live streams and clips, 10.7 MB in recordings (10 s).
var CACHE_MAX = 48 * 1024 * 1024, AHEAD_S = 24, SEG_IDLE_MS = 15000;

// One kept-alive pool per host name: requests go to an IP address (see open()), and Cloudflare
// serves several Kick names from one address, so pools must not be shared between names.
var agents = {};
function agentFor(protocol, host) {
  var key = protocol + host;
  return agents[key] || (agents[key] = new (protocol === 'http:' ? http : https).Agent({ keepAlive: true, maxSockets: 6 }));
}

// A-record query; `new Buffer` because Node 4.4 has no Buffer.alloc.
function dnsQuery(id, host) {
  var labels = host.split('.'), size = 17, p = 12;
  labels.forEach(function (l) { size += l.length + 1; });
  var b = new Buffer(size);
  b.fill(0);
  b.writeUInt16BE(id, 0); b.writeUInt16BE(0x0100, 2); b.writeUInt16BE(1, 4);
  labels.forEach(function (l) { b[p++] = l.length; b.write(l, p, 'ascii'); p += l.length; });
  b.writeUInt16BE(1, p + 1); b.writeUInt16BE(1, p + 3);
  return b;
}

function skipName(b, p) {
  while (p < b.length) {
    if (b[p] === 0) { return p + 1; }
    if ((b[p] & 0xc0) === 0xc0) { return p + 2; }
    p += b[p] + 1;
  }
  return -1;
}

// First A record in the answer section (recursive servers include the CNAME chain), or null.
function firstA(b) {
  var p = 12, i, type, len;
  for (i = b.readUInt16BE(4); i > 0 && p >= 0; i--) { p = skipName(b, p); if (p >= 0) { p += 4; } }
  for (i = b.readUInt16BE(6); i > 0 && p >= 0; i--) {
    p = skipName(b, p);
    if (p < 0 || p + 10 > b.length) { return null; }
    type = b.readUInt16BE(p); len = b.readUInt16BE(p + 8); p += 10;
    if (type === 1 && len === 4 && p + 4 <= b.length) { return b[p] + '.' + b[p + 1] + '.' + b[p + 2] + '.' + b[p + 3]; }
    p += len;
  }
  return null;
}

// Ask every configured server at once and repeat every 400 ms, so a lost packet costs 0.4 s
// instead of 5 s. Anything unusual (no servers, odd names, all servers fail) goes to dns.lookup.
function fastLookup(host, cb) {
  var servers = [], name = host.replace(/\.$/, '');
  try { servers = dns.getServers().filter(function (s) { return IPV4.test(s); }); } catch (e) { /* use dns.lookup */ }
  if (!servers.length || IPV4.test(name) || !/^[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/.test(name)) {
    return dns.lookup(host, { family: 4 }, cb);
  }
  var id = 1 + Math.floor(Math.random() * 65534), packet = dnsQuery(id, name), sock = dgram.createSocket('udp4');
  var rounds = 0, failures = 0, done = false, timer;
  function finish(addr) {
    if (done) { return; }
    done = true; clearTimeout(timer);
    try { sock.close(); } catch (e) { /* already closed */ }
    if (addr) { cb(null, addr, 4); } else { dns.lookup(host, { family: 4 }, cb); }
  }
  sock.on('message', function (msg, from) {
    if (servers.indexOf(from.address) < 0 || msg.length < 12 || msg.readUInt16BE(0) !== id) { return; }  // answers only from our servers
    var addr = (msg[3] & 0x0f) === 0 ? firstA(msg) : null;
    if (addr) { finish(addr); } else if (++failures >= servers.length) { finish(null); }
  });
  sock.on('error', function () { finish(null); });
  (function send() {
    if (done) { return; }
    if (rounds++ === DNS_ROUNDS) { return finish(null); }
    servers.forEach(function (s) { sock.send(packet, 0, packet.length, 53, s); });
    timer = setTimeout(send, DNS_RETRY_MS);
  })();
}

// IPv4 only (the TV has no IPv6), one lookup in flight per name, stale answers kept on error.
var dnsCache = {};
function cachedLookup(host, opts, callback) {
  if (typeof opts === 'function') { callback = opts; opts = {}; }
  // Newer Node asks for a list (`all`); the TV's Node 4.4 expects (err, address, family).
  function cb(err, addr) {
    if (err) { callback(err); } else if (opts && opts.all) { callback(null, [{ address: addr, family: 4 }]); } else { callback(null, addr, 4); }
  }
  var hit = dnsCache[host];
  if (hit && hit.addr && Date.now() - hit.at < DNS_TTL_MS) { return process.nextTick(function () { cb(null, hit.addr); }); }
  if (hit && hit.waiting) { return hit.waiting.push(cb); }
  var entry = dnsCache[host] = { addr: hit && hit.addr, at: hit && hit.at, waiting: [cb] };
  fastLookup(host, function (err, addr) {
    var waiting = entry.waiting;
    entry.waiting = null;
    if (!err) { entry.addr = addr; entry.at = Date.now(); }
    waiting.forEach(function (w) { if (entry.addr) { w(null, entry.addr, 4); } else { w(err); } });
  });
}

var LOCAL = 'http://127.0.0.1:' + PORT;
function proxied(target, from) { return LOCAL + '/p.m3u8?u=' + encodeURIComponent(target) + (from ? '&from=' + from : ''); }

// Segment URL with the byte range (clips cut segments out of one file) and the playlist and
// sequence number it came from (for the look-ahead). The extension tells AVPlay the format.
function segmentUrl(target, range, list, n) {
  var ext = (/\.(ts|aac|mp4|m4s|m4a|m4v|key)$/i.exec(url.parse(target).pathname || '') || [0, 'ts'])[1];
  return LOCAL + '/s.' + ext + '?u=' + encodeURIComponent(target) + (range ? '&r=' + range : '') + (list ? '&l=' + list + '&n=' + n : '');
}

// Kick TV never shows subtitles; without them AVPlay doesn't keep reloading three extra
// playlists through here. `from` (seconds) passes on to the media playlists, see media().
function rewrite(text, src, from) {
  if (text.indexOf('#EXT-X-STREAM-INF') < 0) { return media(text, src, from); }
  function fix(uri) { return proxied(url.resolve(src, uri), from); }
  var lines = text.split(/\r?\n/).filter(function (line) {
    return line.indexOf('#EXT-X-MEDIA:TYPE=SUBTITLES') !== 0;
  }).map(function (line) {
    if (line && line.charAt(0) !== '#') { return fix(line.trim()); }
    line = line.replace(/,SUBTITLES="[^"]*"/, '');
    return line.replace(/URI="([^"]+)"/g, function (all, uri) { return 'URI="' + fix(uri) + '"'; });
  });
  return (from > 0 ? lowFirst(lines) : lines).join('\n') + '\n';
}

// Rewinding with "Auto" resolution: AVPlay starts on the first variant it is offered. A 1080p
// recording segment is 10.7 MB against 4.4 MB at 720p, so offering 720p first makes the picture
// come back about twice as fast; AVPlay switches up on its own afterwards.
function lowFirst(lines) {
  var head = [], groups = [], cur = [];
  lines.forEach(function (l) {
    if (!groups.length && !cur.length && l.indexOf('#EXT-X-MEDIA:') !== 0 && l.indexOf('#EXT-X-STREAM-INF') !== 0) { head.push(l); return; }
    cur.push(l);
    if (l && l.charAt(0) !== '#') { groups.push(cur); cur = []; }
  });
  var i = groups.map(function (g) { return /RESOLUTION=\d+x720\b/.test(g.join('\n')); }).indexOf(true);
  if (i > 0) { groups.unshift(groups.splice(i, 1)[0]); }
  return head.concat.apply(head, groups).concat(cur);
}

// Media playlists: segments (and EXT-X-KEY/MAP URIs) point here, byte ranges move into the
// segment URLs. With `from`, segments that end before that time are left out: a rewound live
// stream then starts right there, instead of AVPlay loading the recording's first 10 MB
// segment before it can jump. The app passes a segment start time, so it knows the offset.
var SEGMENT_TAG = /^#EXT(INF|-X-(BYTERANGE|DISCONTINUITY|KEY|MAP|PROGRAM-DATE-TIME|DATERANGE|GAP|BITRATE))\b/;
function media(text, src, from) {
  var head = [], segs = [], tags = [], seq0 = 0, dseq = null, dur = 0, range = null, ends = {}, ended = false;
  text.split(/\r?\n/).forEach(function (line) {
    var m;
    if (!line) { return; }
    if (line.charAt(0) !== '#') {
      var abs = url.resolve(src, line.trim()), r = null;
      if (range) {
        var off = range.off === null ? ends[abs] || 0 : range.off;
        r = off + '-' + (off + range.len - 1);
        ends[abs] = off + range.len;
      }
      segs.push({ tags: tags, url: abs, range: r, key: segmentKey(abs, r), dur: dur });
      tags = []; dur = 0; range = null;
    } else if ((m = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/.exec(line))) {
      range = { len: Number(m[1]), off: m[2] === undefined ? null : Number(m[2]) };
    } else if (line.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
      seq0 = parseInt(line.slice(22), 10) || 0;
    } else if (line.indexOf('#EXT-X-DISCONTINUITY-SEQUENCE:') === 0) {
      dseq = parseInt(line.slice(30), 10) || 0;
    } else if (line.indexOf('#EXT-X-ENDLIST') === 0) {
      ended = true;
    } else if (!segs.length && !tags.length && !SEGMENT_TAG.test(line)) {
      head.push(line);
    } else {
      if (line.indexOf('#EXTINF:') === 0) { dur = parseFloat(line.slice(8)) || 0; }
      tags.push(line);
    }
  });

  // Same sums as the app's (player.js segmentTimes), so `from` matches a segment start exactly.
  var drop = 0, t = 0, carry = {}, gaps = 0;
  while (from > 0 && drop < segs.length - 1 && t + segs[drop].dur <= from + 0.05) {
    segs[drop].tags.forEach(function (l) {
      var k = /^#EXT-X-(KEY|MAP)/.exec(l);
      if (k) { carry[k[1]] = l; } else if (l === '#EXT-X-DISCONTINUITY') { gaps++; }
    });
    t += segs[drop].dur;
    drop++;
  }
  var id = register(src, segs, seq0, ended), out = head.slice();
  out.push('#EXT-X-MEDIA-SEQUENCE:' + (seq0 + drop));
  if (dseq !== null || gaps) { out.push('#EXT-X-DISCONTINUITY-SEQUENCE:' + ((dseq || 0) + gaps)); }
  segs.slice(drop).forEach(function (s, i) {
    var lines = s.tags;
    if (i === 0) {
      ['KEY', 'MAP'].forEach(function (k) {
        if (carry[k] && !lines.some(function (l) { return l.indexOf('#EXT-X-' + k) === 0; })) { lines = [carry[k]].concat(lines); }
      });
    }
    lines.forEach(function (l) { out.push(/^#EXT-X-(KEY|MAP):/.test(l) ? tagUri(l, src) : l); });
    out.push(segmentUrl(s.url, s.range, id, seq0 + drop + i));
  });
  out = out.concat(tags);
  if (ended) { out.push('#EXT-X-ENDLIST'); }
  // Rewinding: start fetching the first segment while AVPlay is still opening.
  if (from > 0 && ended) { lookAhead(id, seq0 + drop - 1); }
  return out.join('\n') + '\n';
}

function tagUri(line, src) {
  var m = /BYTERANGE="(\d+)@(\d+)"/.exec(line), r = m ? m[2] + '-' + (Number(m[2]) + Number(m[1]) - 1) : null;
  return line.replace(/,?BYTERANGE="[^"]*"/, '').replace(/URI="([^"]+)"/, function (all, uri) { return 'URI="' + segmentUrl(url.resolve(src, uri), r) + '"'; });
}

// Recently served media playlists, for the look-ahead: the segment requests name their playlist.
var lists = {}, listIds = {}, nextList = 1;
function register(src, segs, seq0, ended) {
  var id = listIds[src] || (listIds[src] = nextList++);
  lists[id] = { src: src, segs: segs, seq0: seq0, vod: ended, at: Date.now() };
  var ids = Object.keys(lists).sort(function (a, b) { return lists[a].at - lists[b].at; });
  ids.slice(0, Math.max(0, ids.length - 8)).forEach(function (k) { delete listIds[lists[k].src]; delete lists[k]; });
  return id;
}

// Node 4.4's tls.connect ignores the `lookup` option, so a plain https.get would use the TV's
// slow resolver. Resolve the name here and connect to the address instead, keeping the name
// for SNI, the certificate check and the Host header. cb(err, request); call request.end().
function open(target, method, headers, cb) {
  var u = url.parse(target);
  cachedLookup(u.hostname, {}, function (err, addr) {
    if (err) { return cb(err); }
    headers.Host = u.host;
    headers['User-Agent'] = headers['User-Agent'] || UA;
    cb(null, (u.protocol === 'http:' ? http : https).request({ host: addr, port: u.port, path: u.path, method: method, headers: headers,
      servername: u.hostname, agent: agentFor(u.protocol, u.hostname) }));
  });
}

function fetch(target, redirects, cb, retried) {
  var done = false, req = null;
  function finish(err, status, body) { if (!done) { done = true; clearTimeout(timer); cb(err, status, body); } }
  var timer = setTimeout(function () { if (req) { req.abort(); } finish(new Error('timeout')); }, 15000);
  open(target, 'GET', { 'Accept': '*/*' }, function (err, r) {  // no Accept-Encoding: plain text back
    if (err) { return finish(err); }
    req = r;
    req.on('response', function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        done = true;
        clearTimeout(timer);
        var next = url.resolve(target, res.headers.location);
        if (!allowed(next)) { return cb(new Error('redirected away from Kick')); }
        return fetch(next, redirects - 1, cb);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { finish(null, res.statusCode, Buffer.concat(chunks).toString('utf8')); });
      res.on('error', function (e) { finish(e); });
    });
    req.on('error', function (e) {
      // A kept-alive connection the server already closed: safe to repeat a GET once.
      if (!retried && !done && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) { done = true; clearTimeout(timer); return fetch(target, redirects, cb, true); }
      finish(e);
    });
    req.end();
  });
}

// Playlists that stay the same while they play (master playlists, videos, the running stream's
// recording) are kept briefly, so the app's look-ups and AVPlay's requests share one download.
var playlists = {};
function cachedFetch(target, cb) {
  var now = Date.now();
  Object.keys(playlists).forEach(function (k) { var p = playlists[k]; if (p.text && now - p.at > p.ttl) { delete playlists[k]; } });
  var hit = playlists[target];
  if (hit && hit.text) { return process.nextTick(function () { cb(null, 200, hit.text); }); }
  if (hit) { return hit.waiting.push(cb); }
  var entry = playlists[target] = { waiting: [cb] };
  fetch(target, 3, function (err, status, text) {
    var waiting = entry.waiting, ok = !err && status === 200 && text.indexOf('#EXTM3U') === 0;
    var ttl = !ok ? 0 : text.indexOf('#EXT-X-STREAM-INF') >= 0 ? 60000 : text.indexOf('#EXT-X-ENDLIST') >= 0 ? 20000 : 0;
    if (ttl) { entry.text = text; entry.at = Date.now(); entry.ttl = ttl; entry.waiting = null; } else { delete playlists[target]; }
    waiting.forEach(function (w) { w(err, status, text); });
  });
}

// ---- video segments: /s.ts?u=<segment URL>[&r=<first>-<last>][&l=<playlist>&n=<sequence>] ----
// One download per segment however many requests wait for it; waiting requests get the bytes as
// they arrive. Finished segments stay in memory (least recently used go first).
var segs = {}, segBytes = 0, queue = [], events = [];
function segmentKey(target, range) { return range ? target + '#' + range : target; }

// Last 60 segment events for /stats (what came from memory, download times).
function note(key, what) {
  var name = key.replace(/^.*\/([^\/?]+)(\?[^#]*)?/, '$1');
  if (name.length > 40) { name = name.slice(0, 12) + '…' + name.slice(-16); }
  events.push(new Date().toISOString().slice(11, 23) + ' ' + name + ' ' + what);
  if (events.length > 60) { events.shift(); }
}

function download(key, target, range, prefetch) {
  var s = segs[key] = { key: key, chunks: [], size: 0, total: 0, type: 'video/MP2T', ok: false, done: false, subs: [], prefetch: prefetch, used: Date.now() };
  var req = null, timer = null, retried = false, started = Date.now();
  function idle() { clearTimeout(timer); timer = setTimeout(function () { finish(new Error('timeout')); }, SEG_IDLE_MS); }
  function finish(err) {
    if (s.done) { return; }
    s.done = true;
    clearTimeout(timer);
    note(key, (s.prefetch ? 'ahead ' : 'fetched ') + (err ? 'FAILED ' + err.message : Math.round(s.size / 1024) + ' KB') + ' in ' + (Date.now() - started) + ' ms');
    if (err) { if (req) { req.abort(); } forget(s); } else { s.chunks = [Buffer.concat(s.chunks, s.size)]; }
    var subs = s.subs;
    s.subs = [];
    subs.forEach(function (w) {
      if (err) { if (w.started) { w.res.connection.destroy(); } else { w.res.writeHead(502, CORS); w.res.end(); } }
      else if (w.started) { w.res.end(); } else { sendAll(w, s); }
    });
    trim();
    pump();
  }
  s.abort = function () { finish(new Error('aborted')); };
  (function get() {
    var headers = { 'Accept': '*/*' };
    if (range) { headers.Range = 'bytes=' + range; }
    idle();
    open(target, 'GET', headers, function (err, r) {
      if (s.done) { return; }
      if (err) { return finish(err); }
      req = r;
      req.on('response', function (res) {
        if (s.done) { return res.resume(); }
        if (res.statusCode !== (range ? 206 : 200)) { res.resume(); return finish(new Error('upstream ' + res.statusCode)); }
        s.ok = true;
        s.total = Number(res.headers['content-length']) || 0;
        s.type = res.headers['content-type'] || s.type;
        s.subs.forEach(function (w) { begin(w, s); });
        res.on('data', function (c) {
          if (s.done) { return; }
          idle();
          s.chunks.push(c);
          s.size += c.length;
          segBytes += c.length;
          s.subs.forEach(function (w) { if (w.started) { w.res.write(c); } });
        });
        res.on('end', function () { finish(s.total && s.size !== s.total ? new Error('cut short') : null); });
        res.on('error', finish);
      });
      req.on('error', function (e) {
        // A kept-alive connection the server already closed: ask again once.
        if (!retried && !s.ok && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) { retried = true; return get(); }
        finish(e);
      });
      req.end();
    });
  })();
  return s;
}

function forget(s) {
  if (segs[s.key] === s) { delete segs[s.key]; }
  segBytes -= s.size;
  s.size = 0;
  s.chunks = [];
}

function trim() {
  while (segBytes > CACHE_MAX) {
    var oldest = null;
    Object.keys(segs).forEach(function (k) { var s = segs[k]; if (s.done && !s.subs.length && (!oldest || s.used < oldest.used)) { oldest = s; } });
    if (!oldest) { return; }
    forget(oldest);
  }
}

// A later part of a segment (Range from the middle) is answered once the segment is complete.
function begin(w, s) {
  if (w.range && w.range[0] > 0) { return; }
  w.started = true;
  w.res.writeHead(200, segmentHeaders(s, s.total));
  s.chunks.forEach(function (c) { w.res.write(c); });
}
function segmentHeaders(s, length) {
  var h = { 'Content-Type': s.type, 'Access-Control-Allow-Origin': '*' };
  if (length) { h['Content-Length'] = length; }
  return h;
}
function sendAll(w, s) {
  var body = s.chunks[0] || new Buffer(0), r = w.range;
  if (r && (r[0] > 0 || r[1] < body.length - 1)) {
    var last = Math.min(r[1], body.length - 1), h = segmentHeaders(s, last - r[0] + 1);
    if (r[0] > last) { w.res.writeHead(416, { 'Content-Range': 'bytes */' + body.length }); return w.res.end(); }
    h['Content-Range'] = 'bytes ' + r[0] + '-' + last + '/' + body.length;
    w.res.writeHead(206, h);
    return w.res.end(body.slice(r[0], last + 1));
  }
  w.res.writeHead(200, segmentHeaders(s, body.length));
  w.res.end(body);
}

function serveSegment(req, res, q) {
  var range = /^\d+-\d+$/.test(q.query.r || '') ? q.query.r : null, key = segmentKey(q.query.u, range);
  var m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || ''), w = { res: res, range: m ? [Number(m[1]), m[2] ? Number(m[2]) : Infinity] : null, started: false };
  var s = segs[key];
  note(key, 'asked' + (w.range ? ' ' + req.headers.range : '') + ': ' + (!s ? 'download' : s.done ? 'from memory' : (s.prefetch ? 'joins look-ahead ' : 'joins download ') + Math.round(s.size / 1024) + ' KB'));
  s = s || download(key, q.query.u, range, false);
  s.prefetch = false;
  s.used = Date.now();
  if (s.done) { sendAll(w, s); } else {
    s.subs.push(w);
    if (s.ok) { begin(w, s); }
    res.on('close', function () { var i = s.subs.indexOf(w); if (i >= 0) { s.subs.splice(i, 1); } });
  }
  if (q.query.l) { lookAhead(q.query.l, Number(q.query.n)); }
}

// Videos: after AVPlay asks for segment n, fetch the following AHEAD_S seconds, one segment at a
// time and only while nothing else is downloading. Downloads nobody waits for any more (an old
// look-ahead after a jump, AVPlay closed) are stopped so they don't slow the new position.
function lookAhead(id, n) {
  var list = lists[id];
  if (!list || !list.vod) { return; }
  var want = {}, t = 0, i = Math.max(0, n - list.seq0 + 1), cur = list.segs[n - list.seq0];
  if (cur) { want[cur.key] = true; }
  queue = [];
  for (; i < list.segs.length && (t === 0 || t + list.segs[i].dur <= AHEAD_S); i++) {
    t += list.segs[i].dur || 1;
    want[list.segs[i].key] = true;
    if (!segs[list.segs[i].key]) { queue.push(list.segs[i]); }
  }
  Object.keys(segs).forEach(function (k) { var s = segs[k]; if (!s.done && !s.subs.length && !want[k]) { s.abort(); } });
  pump();
}
function pump() {
  var busy = Object.keys(segs).some(function (k) { return !segs[k].done; });
  while (!busy && queue.length) {
    var next = queue.shift();
    if (!segs[next.key]) { download(next.key, next.url, next.range, true); busy = true; }
  }
}

// /f?u=<kick.com URL>: the app's API calls and images, so they skip the TV's 5 s name lookups.
function proxy(req, res, target) {
  var body = [], retried = false;
  req.on('data', function (c) { body.push(c); });
  req.on('end', function () { forward(Buffer.concat(body)); });
  // The app gives up on requests all the time (tab changes, new search letters, images scrolled
  // past). Each one must close its connection to Kick: a half-read response holds its socket,
  // and after 6 of them (maxSockets) every later request to that server waited forever.
  function forward(data) {
    var finished = false, gone = false, piping = false, up = null, headers = { 'Accept': req.headers.accept || '*/*' };
    var timer = setTimeout(function () { fail(504, 'timeout'); }, 15000);
    function stop() { clearTimeout(timer); if (up) { up.abort(); } }
    function fail(code, msg) { if (!finished) { finished = true; stop(); if (!gone) { res.writeHead(code, CORS); res.end(msg); } } }
    res.on('close', function () { gone = true; stop(); });
    if (req.headers.authorization) { headers.Authorization = req.headers.authorization; }
    if (req.headers['content-type']) { headers['Content-Type'] = req.headers['content-type']; }
    if (data.length) { headers['Content-Length'] = data.length; }
    open(target, req.method, headers, function (err, request) {
      if (err) { return fail(502, String(err.message || err)); }
      if (gone) { return; }
      up = request;
      up.on('response', function (r) {
        if (finished) { return r.resume(); }
        finished = true;
        var out = { 'Access-Control-Allow-Origin': '*' };
        ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified'].forEach(function (k) { if (r.headers[k]) { out[k] = r.headers[k]; } });
        res.writeHead(r.statusCode, out);
        // A body that stalls for 20 s is given up too.
        function idle() { clearTimeout(timer); timer = setTimeout(function () { up.abort(); res.connection.destroy(); }, 20000); }
        idle();
        piping = true;
        r.on('data', idle);
        r.on('end', function () { piping = false; clearTimeout(timer); });
        r.pipe(res);
      });
      up.on('error', function (e) {
        if (gone) { return; }
        // A kept-alive connection the server already closed: repeat a GET once.
        if (!finished && !retried && req.method === 'GET' && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) {
          retried = finished = true;
          clearTimeout(timer);
          return forward(data);
        }
        if (piping) { res.connection.destroy(); return; }  // cut off mid-body: end the app's request too
        fail(502, String(e.message || e));
      });
      up.end(data.length ? data : undefined);
    });
  }
}

module.exports.onStart = function () {
  var server = function (req, res) {
    var q = url.parse(req.url, true);
    if (q.pathname === '/ping') { res.writeHead(200, CORS); return res.end('ok ' + process.version); }
    if (q.pathname === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ cachedKB: Math.round(segBytes / 1024), segments: Object.keys(segs).length, events: events }));
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    if (q.pathname === '/f') {
      if (!PROXY_TARGET.test(q.query.u || '')) { res.writeHead(403, CORS); return res.end(); }
      return proxy(req, res, q.query.u);
    }
    if (!allowed(q.query.u)) { res.writeHead(403, CORS); return res.end(); }
    if (/^\/s\.[a-z0-9]+$/.test(q.pathname)) { return serveSegment(req, res, q); }
    if (q.pathname !== '/p.m3u8') { res.writeHead(404); return res.end(); }
    cachedFetch(q.query.u, function (err, status, text) {
      if (err || status !== 200 || text.indexOf('#EXTM3U') !== 0) {
        res.writeHead(err ? 502 : status || 502, { 'Access-Control-Allow-Origin': '*' });
        return res.end(err ? String(err.message || err) : 'upstream ' + status);  // shown by diagnostics
      }
      // One bad playlist must not take the service down for the rest of the session.
      try {
        var out = rewrite(text, q.query.u, Number(q.query.from) || 0);
        // Byte length, not Buffer.from: on the TV's Node 4.4 that is TypedArray.from and throws.
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(out, 'utf8'),
                             'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(out, 'utf8');
      } catch (e) {
        res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
        res.end(String(e && e.message));
      }
    });
  };
  [PORT, IMAGE_PORT].forEach(function (port) {
    http.createServer(server).on('error', function () { /* port taken: an earlier instance is still serving */ }).listen(port, '127.0.0.1');
  });
};

module.exports.onRequest = function () {};
module.exports.onExit = function () {};
