// Node unit tests for js/engines/logs.js: timestamps, format detection,
// parsers, histogram and merging. Run: node scripts/unit/logs.test.js
const assert = require('assert');
let G;
let n = 0, failed = 0;
function t(name, fn) { try { if (!G) G = require('../../js/engines/logs.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
const iso = ms => new Date(ms).toISOString();

t('parseTime: ISO, Apache, syslog, Windows, epoch seconds and milliseconds', () => {
  assert.strictEqual(iso(G.parseTime('2026-11-23T09:15:02.250Z')), '2026-11-23T09:15:02.250Z');
  assert.strictEqual(iso(G.parseTime('2026-11-23 09:15:02,250+04:00')), '2026-11-23T05:15:02.250Z');
  assert.strictEqual(iso(G.parseTime('23/Nov/2026:09:15:02 +0530')), '2026-11-23T03:45:02.000Z');
  assert.strictEqual(iso(G.parseTime('Nov  3 09:15:02', 2026)), '2026-11-03T09:15:02.000Z');
  assert.strictEqual(iso(G.parseTime('11/23/2026 9:15:02 PM')), '2026-11-23T21:15:02.000Z');
  assert.strictEqual(iso(G.parseTime('1795425302')), '2026-11-23T09:15:02.000Z');
  assert.strictEqual(iso(G.parseTime('1795425302250')), '2026-11-23T09:15:02.250Z');
  assert.strictEqual(G.parseTime('not a time'), null);
});
t('detectFormat: JSON, logfmt, access, syslog 3164 and 5424, Windows, plain', () => {
  assert.strictEqual(G.detectFormat(['{"ts":"2026-11-23T09:00:00Z","level":"info","msg":"up"}', '{"ts":"2026-11-23T09:00:01Z","level":"error","msg":"x"}']), 'json');
  assert.strictEqual(G.detectFormat(['time=2026-11-23T09:00:00Z level=info msg="started server" port=8080', 'time=2026-11-23T09:00:02Z level=warn msg=slow']), 'logfmt');
  assert.strictEqual(G.detectFormat(['203.0.113.9 - - [23/Nov/2026:09:15:02 +0000] "GET /a HTTP/1.1" 200 512 "-" "curl/8"']), 'access');
  assert.strictEqual(G.detectFormat(['Nov 23 09:15:02 web01 sshd[812]: Accepted publickey for ada']), 'syslog');
  assert.strictEqual(G.detectFormat(['<34>1 2026-11-23T09:15:02.003Z web01 su - ID47 - su root failed']), 'syslog5424');
  assert.strictEqual(G.detectFormat(['Error\t11/23/2026 9:15:02 AM\tService Control Manager\t7031\tNone\tThe Print Spooler service terminated unexpectedly.']), 'windows');
  assert.strictEqual(G.detectFormat(['hello world', 'nothing here']), 'plain');
});
t('parseEvent: fields, level and time for each format', () => {
  let e = G.parseEvent('{"@timestamp":"2026-11-23T09:00:01Z","level":"ERROR","message":"db down","user":{"id":7}}', 'json');
  assert.strictEqual(e.level, 'ERROR'); assert.strictEqual(iso(e.ts), '2026-11-23T09:00:01.000Z'); assert.strictEqual(e.fields['user.id'], '7'); assert.strictEqual(e.msg, 'db down');
  e = G.parseEvent('time=2026-11-23T09:00:02Z level=warn msg="slow query" ms=812', 'logfmt');
  assert.deepStrictEqual([e.level, e.fields.msg, e.fields.ms], ['WARN', 'slow query', '812']);
  e = G.parseEvent('203.0.113.9 - bob [23/Nov/2026:09:15:02 +0000] "POST /api/login HTTP/2.0" 503 0 "https://x/" "Mozilla/5.0"', 'access');
  assert.deepStrictEqual([e.level, e.fields.status, e.fields.method, e.fields.path, e.fields.ip, e.fields.user], ['ERROR', '503', 'POST', '/api/login', '203.0.113.9', 'bob']);
  assert.strictEqual(G.parseEvent('1.2.3.4 - - [23/Nov/2026:09:15:02 +0000] "GET / HTTP/1.1" 404 9 "-" "-"', 'access').level, 'WARN');
  e = G.parseEvent('<11>1 2026-11-23T09:15:02Z web01 app 123 ID1 [x@1 a="b"] disk full', 'syslog5424');
  assert.deepStrictEqual([e.level, e.fields.host, e.fields.app, e.msg], ['ERROR', 'web01', 'app', 'disk full']);
  e = G.parseEvent('Nov 23 09:15:02 web01 kernel: Out of memory: Killed process 4242', 'syslog', 2026);
  assert.deepStrictEqual([e.fields.host, e.fields.app, iso(e.ts)], ['web01', 'kernel', '2026-11-23T09:15:02.000Z']);
  e = G.parseEvent('Warning\t11/23/2026 9:15:02 AM\tDisk\t51\tNone\tAn error was detected on device.', 'windows');
  assert.deepStrictEqual([e.level, e.fields.source, e.fields.eventId], ['WARN', 'Disk', '51']);
  e = G.parseEvent('2026-11-23 09:15:02 [INFO] started', 'plain');
  assert.deepStrictEqual([e.level, iso(e.ts)], ['INFO', '2026-11-23T09:15:02.000Z']);
});
t('histogram: nice bucket sizes, counts per level, empty span handled', () => {
  const base = Date.UTC(2026, 10, 23, 9, 0, 0);
  const ev = [[base, 'INFO'], [base + 30e3, 'ERROR'], [base + 61e3, 'INFO'], [base + 3599e3, 'WARN'], [null, 'INFO']];
  const h = G.histogram(ev.map(e => e[0]), ev.map(e => e[1]), 60);
  assert.strictEqual(h.step, 60e3, 'one-minute buckets for an hour');
  assert.strictEqual(h.counts.length, 60);
  assert.deepStrictEqual(h.counts[0], { ERROR: 1, WARN: 0, INFO: 1, DEBUG: 0, OTHER: 0 });
  assert.strictEqual(h.counts[59].WARN, 1);
  assert.strictEqual(h.untimed, 1);
  assert.strictEqual(G.histogram([base, base], ['INFO', 'INFO'], 60).counts.length, 1);
  assert.strictEqual(G.histogram([], [], 60).counts.length, 0);
});
t('mergeByTime: k-way merge, ties keep file order, untimed events stay after their predecessor', () => {
  const a = [{ ts: 1, id: 'a1' }, { ts: null, id: 'a2' }, { ts: 5, id: 'a3' }];
  const b = [{ ts: 2, id: 'b1' }, { ts: 5, id: 'b2' }, { ts: 9, id: 'b3' }];
  assert.deepStrictEqual(G.mergeByTime([a, b]).map(e => e.id), ['a1', 'a2', 'b1', 'a3', 'b2', 'b3']);
});
t('splitEvents: continuation lines join the event before; counts events, not lines', () => {
  const ev = G.splitEvents('2026-11-23 09:00:00 ERROR boom\njava.lang.NullPointerException\n\tat x.y(Z.java:1)\n2026-11-23 09:00:01 INFO ok\n');
  assert.strictEqual(ev.length, 2);
  assert.ok(ev[0].text.includes('NullPointerException') && ev[0].text.includes('at x.y'));
  assert.strictEqual(ev[1].line, 4);
});

console.log(`${n} passed, ${failed} failed`);
