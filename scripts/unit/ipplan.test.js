// Unit tests for js/engines/ipplan.js. Run: node scripts/unit/ipplan.test.js
const I = require('../../js/engines/ipplan.js');
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); } }
const rows = r => r.allocations.map(a => [a.name, I.cidr(a.block), Number(a.spare)]);

t('VLSM: largest first, aligned, no gaps; spare hosts and free space', () => {
  const r = I.vlsm('192.168.10.0/24', [{ name: 'Sales', hosts: 50 }, { name: 'Office', hosts: 100 }, { name: 'Lab', hosts: 20 }, { name: 'WAN', hosts: 2 }]);
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(rows(r), [['Office', '192.168.10.0/25', 26], ['Sales', '192.168.10.128/26', 12], ['Lab', '192.168.10.192/27', 10], ['WAN', '192.168.10.224/30', 0]]);
  assert.deepStrictEqual(r.free.map(I.cidr), ['192.168.10.228/30', '192.168.10.232/29', '192.168.10.240/28']);
  assert.strictEqual(r.used, 228n); assert.strictEqual(r.total, 256n);
});
t('VLSM: /31 for point-to-point links on request, /32 for a single host, ties keep input order', () => {
  const r = I.vlsm('10.0.0.0/29', [{ name: 'a', hosts: 2 }, { name: 'b', hosts: 2 }, { name: 'c', hosts: 1 }], { p2p31: true });
  assert.deepStrictEqual(rows(r), [['a', '10.0.0.0/31', 0], ['b', '10.0.0.2/31', 0], ['c', '10.0.0.4/32', 0]]);
  const n = I.vlsm('10.0.0.0/29', [{ name: 'a', hosts: 2 }, { name: 'b', hosts: 2 }]);
  assert.deepStrictEqual(rows(n), [['a', '10.0.0.0/30', 0], ['b', '10.0.0.4/30', 0]]);
});
t('VLSM: refuses what does not fit, with the numbers', () => {
  const r = I.vlsm('192.168.1.0/24', [{ name: 'Big', hosts: 200 }, { name: 'Also big', hosts: 100 }]);
  assert.ok(!r.ok); assert.match(r.error, /Out of space at Also big: the parent \/24 has 0 addresses left and the remaining subnets need 128/);
  assert.match(I.vlsm('10.0.0.0/24', [{ name: 'x', hosts: 300 }]).error, /needs a \/23, which is bigger than the parent \/24/);
  assert.match(I.vlsm('10.0.0.0/24', [{ name: 'x', hosts: 'ten' }]).error, /not a whole number of hosts/);
  assert.match(I.vlsm('10.0.0.300/24', []).error, /Parent block/);
});
t('IPv6 planning: /64s per segment, nibble-aligned on request', () => {
  const r = I.vlsm('2001:db8:abcd::/48', [{ name: 'HQ', hosts: 200 }, { name: 'Branch', hosts: 16 }, { name: 'DMZ', hosts: 1 }]);
  assert.deepStrictEqual(rows(r), [['HQ', '2001:db8:abcd::/56', 56], ['Branch', '2001:db8:abcd:100::/60', 0], ['DMZ', '2001:db8:abcd:110::/64', 0]]);
  const nb = I.vlsm('2001:db8:abcd::/48', [{ name: 'HQ', hosts: 200 }, { name: 'Branch', hosts: 20 }, { name: 'DMZ', hosts: 3 }], { nibble: true });
  assert.deepStrictEqual(rows(nb).map(x => x[1]), ['2001:db8:abcd::/56', '2001:db8:abcd:100::/56', '2001:db8:abcd:200::/60']);
  assert.match(I.vlsm('2001:db8::/72', [{ name: 'x', hosts: 1 }]).error, /bigger than the parent/);
});
t('range to the minimal CIDR list', () => {
  assert.deepStrictEqual(I.rangeToCidrs('10.0.0.5 - 10.0.0.200'), ['10.0.0.5/32', '10.0.0.6/31', '10.0.0.8/29', '10.0.0.16/28', '10.0.0.32/27', '10.0.0.64/26', '10.0.0.128/26', '10.0.0.192/29', '10.0.0.200/32']);
  assert.deepStrictEqual(I.rangeToCidrs('192.168.0.0', '192.168.255.255'), ['192.168.0.0/16']);
  assert.deepStrictEqual(I.rangeToCidrs('0.0.0.0-255.255.255.255'), ['0.0.0.0/0']);
  assert.deepStrictEqual(I.rangeToCidrs('2001:db8::1 - 2001:db8::4'), ['2001:db8::1/128', '2001:db8::2/127', '2001:db8::4/128']);
  assert.throws(() => I.rangeToCidrs('10.0.0.9 - 10.0.0.1'), /after the last/);
  assert.throws(() => I.rangeToCidrs('10.0.0.1 - ::1'), /same family/);
});
t('conflicts: duplicates, containment and partial overlaps, with labels and bad lines', () => {
  const r = I.conflicts(['prod 10.0.0.0/16', 'web, 10.0.1.0/24', '10.0.1.0/24', 'db 10.0.2.0 255.255.255.0', '# comment', '', 'oops 10.0.0.999/24', '10.1.0.0/16', '172.16.0.0/12', '2001:db8::/32', '2001:db8:1::/48']);
  assert.strictEqual(r.blocks.length, 8);
  assert.deepStrictEqual(r.invalid.map(x => x.line), [7]);
  const f = r.findings.map(x => [x.a.text, x.b.text, x.kind]);
  assert.deepStrictEqual(f, [['10.0.0.0/16', '10.0.1.0/24', 'contains'], ['10.0.0.0/16', '10.0.1.0/24', 'contains'], ['10.0.1.0/24', '10.0.1.0/24', 'duplicate'], ['10.0.0.0/16', '10.0.2.0 255.255.255.0', 'contains'], ['2001:db8::/32', '2001:db8:1::/48', 'contains']]);
  assert.strictEqual(r.blocks[1].label, 'web');
  assert.deepStrictEqual(r.aggregate, ['10.0.0.0/15', '172.16.0.0/12', '2001:db8::/32']);
  const p = I.conflicts(['10.0.0.0/25', '10.0.0.64/26', '10.0.0.96/27']);
  assert.deepStrictEqual(p.findings.map(x => x.kind), ['contains', 'contains', 'contains']);
});
t('aggregate merges adjacent blocks; free lists what is left', () => {
  const B = s => I.block(I.parse(s));
  assert.deepStrictEqual(I.aggregate(['10.0.0.0/25', '10.0.0.128/25', '10.0.1.0/24', '10.0.3.0/24'].map(B)).map(I.cidr), ['10.0.0.0/23', '10.0.3.0/24']);
  assert.deepStrictEqual(I.free(B('10.0.0.0/22'), ['10.0.0.0/24', '10.0.2.0/25', '192.168.0.0/24'].map(B)).map(I.cidr), ['10.0.1.0/24', '10.0.2.128/25', '10.0.3.0/24']);
  assert.deepStrictEqual(I.free(B('10.0.0.0/24'), []).map(I.cidr), ['10.0.0.0/24']);
});
t('parse: masks, host form, bad input', () => {
  assert.strictEqual(I.cidr(I.block(I.parse('192.168.1.37 255.255.255.0'))), '192.168.1.0/24');
  assert.throws(() => I.parse('10.0.0.0 255.0.255.0'), /contiguous/);
  assert.throws(() => I.parse('10.0.0.0/33'), /longer than/);
  assert.throws(() => I.parse('010.0.0.1/8'), /not a valid/);
});

console.log(`ipplan: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
