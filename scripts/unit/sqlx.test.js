// Node unit tests for js/engines/sqlx.js: lint rules with one-click fixes,
// DDL parsing, statement splitting and autocomplete.
// Run: node scripts/unit/sqlx.test.js
const assert = require('assert');
let Q;
let n = 0, failed = 0;
function t(name, fn) { try { if (!Q) Q = require('../../js/engines/sqlx.js'); fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
const rules = sql => Q.lint(sql).map(f => f.rule);
const DDL = `CREATE TABLE public.users (id BIGINT PRIMARY KEY, "email" TEXT NOT NULL, created_at TIMESTAMP, CONSTRAINT u UNIQUE (email));
CREATE TABLE IF NOT EXISTS [dbo].[orders] ([id] INT, [user_id] INT, total DECIMAL(10, 2));`;

t('DDL: tables and columns, quoted and schema-qualified names, constraints skipped', () => {
  const s = Q.parseDDL(DDL);
  assert.deepStrictEqual(s.tables.users, ['id', 'email', 'created_at']);
  assert.deepStrictEqual(s.tables.orders, ['id', 'user_id', 'total']);
});
t('lint: nothing to report in a clean query; strings and comments are ignored', () => {
  assert.deepStrictEqual(rules("SELECT id FROM users WHERE note = 'SELECT * FROM x' -- DELETE FROM y\n"), []);
});
t('lint + fix: SELECT * becomes the column list when the table is known', () => {
  const sql = 'SELECT * FROM users WHERE id = 1;';
  const f = Q.lint(sql, Q.parseDDL(DDL)).find(x => x.rule === 'select-star');
  assert.ok(f && f.fix, 'no fix');
  assert.strictEqual(Q.applyFix(sql, f), 'SELECT id, email, created_at FROM users WHERE id = 1;');
  assert.strictEqual(Q.lint(sql).find(x => x.rule === 'select-star').fix, null, 'no fix without the DDL');
});
t('lint + fix: UPDATE and DELETE without WHERE get a WHERE that matches nothing', () => {
  const sql = 'UPDATE users SET email = NULL;\nDELETE FROM orders';
  const fs = Q.lint(sql).filter(x => x.rule === 'no-where');
  assert.deepStrictEqual(fs.map(f => f.line), [1, 2]);
  assert.strictEqual(Q.applyFix(sql, fs[0]), 'UPDATE users SET email = NULL WHERE 1 = 0 /* add the real condition */;\nDELETE FROM orders');
  assert.deepStrictEqual(rules('DELETE FROM orders WHERE id = 3'), []);
});
t('lint + fix: NOT IN with a subquery excludes NULLs', () => {
  const a = 'SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders)';
  const f = Q.lint(a).find(x => x.rule === 'not-in-null');
  assert.strictEqual(Q.applyFix(a, f), 'SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders WHERE user_id IS NOT NULL)');
  const b = 'SELECT 1 FROM u WHERE id NOT IN (SELECT o.user_id FROM orders o WHERE o.total > 5)';
  assert.strictEqual(Q.applyFix(b, Q.lint(b).find(x => x.rule === 'not-in-null')), 'SELECT 1 FROM u WHERE id NOT IN (SELECT o.user_id FROM orders o WHERE (o.total > 5) AND o.user_id IS NOT NULL)');
});
t('lint + fix: an implicit join becomes an explicit JOIN ... ON', () => {
  const sql = 'SELECT u.id, o.total FROM users u, orders o WHERE u.id = o.user_id AND o.total > 10';
  const f = Q.lint(sql).find(x => x.rule === 'implicit-join');
  assert.strictEqual(Q.applyFix(sql, f), 'SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.total > 10');
  const only = 'SELECT * FROM a x, b y WHERE x.k = y.k';
  assert.strictEqual(Q.applyFix(only, Q.lint(only).find(x => x.rule === 'implicit-join')), 'SELECT * FROM a x JOIN b y ON x.k = y.k');
});
t('lint + fix: a declared variable that is never used is removed', () => {
  const sql = 'DECLARE @unused INT = 5;\nDECLARE @n INT = 1;\nSELECT @n;';
  const fs = Q.lint(sql).filter(x => x.rule === 'unused-variable');
  assert.deepStrictEqual(fs.map(f => f.message.match(/@\w+/)[0]), ['@unused']);
  assert.strictEqual(Q.applyFix(sql, fs[0]), 'DECLARE @n INT = 1;\nSELECT @n;');
});
t('lint: a leading wildcard in LIKE is reported, with no automatic fix', () => {
  const f = Q.lint("SELECT id FROM users WHERE email LIKE '%@example.com'").find(x => x.rule === 'leading-wildcard');
  assert.ok(f && f.fix === null);
  assert.deepStrictEqual(rules("SELECT id FROM users WHERE email LIKE 'ada%'"), []);
});
t('splitStatements: semicolons inside strings, comments and dollar quotes do not split', () => {
  const s = Q.splitStatements("SELECT ';'; -- a;b\nSELECT 2; CREATE FUNCTION f() AS $$ BEGIN x; END $$;\n");
  assert.deepStrictEqual(s.map(x => x.text.trim()), ["SELECT ';';", '-- a;b\nSELECT 2;', 'CREATE FUNCTION f() AS $$ BEGIN x; END $$;']);
});
t('complete: tables after FROM/JOIN, columns after alias., columns of the tables in the query', () => {
  const schema = Q.parseDDL(DDL);
  const at = (sql, word) => Q.complete(sql, sql.length, schema).items.map(i => i.label).filter(l => !word || l.toLowerCase().startsWith(word));
  assert.deepStrictEqual(at('SELECT * FROM us'), ['users']);
  assert.deepStrictEqual(at('SELECT o. FROM orders o', null).length, 0, 'cursor at the end: no alias context');
  const sql = 'SELECT o.', after = ' FROM orders o';
  assert.deepStrictEqual(Q.complete(sql + after, sql.length, schema).items.map(i => i.label), ['id', 'user_id', 'total']);
  const s2 = 'SELECT em', a2 = ' FROM users';
  assert.deepStrictEqual(Q.complete(s2 + a2, s2.length, schema).items.map(i => i.label), ['email']);
  assert.strictEqual(Q.complete(s2 + a2, s2.length, schema).prefix, 'em');
});

t('lint: a NOT IN subquery that already excludes NULLs is not reported again', () => {
  const a = 'SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders)';
  const fixed = Q.applyFix(a, Q.lint(a).find(x => x.rule === 'not-in-null'));
  assert.deepStrictEqual(rules(fixed), []);
  assert.deepStrictEqual(rules('SELECT 1 FROM u WHERE id NOT IN (SELECT o.user_id FROM orders o WHERE o.user_id IS NOT NULL AND o.total > 5)'), []);
});
t('syntax: a real parser per dialect reports line, column and what it found', () => {
  const { Parser } = require('../../js/vendor/node-sql-parser.min.js');
  const ok = Q.syntax(Parser, 'SELECT TOP 5 [id] FROM [users]', 'tsql');
  assert.strictEqual(ok.ok, true);
  const bad = Q.syntax(Parser, 'SELECT TOP 5 [id] FROM [users]', 'postgresql');
  assert.deepStrictEqual([bad.ok, bad.line, bad.column], [false, 1, 12]);
  assert.match(bad.message, /^line 1, column 12: unexpected "5"/);
  const end = Q.syntax(Parser, 'select *\nfrom users where', 'mysql');
  assert.match(end.message, /^line 2, column 17: the statement ends too early/);
  assert.strictEqual(Q.syntax(Parser, 'SELECT 1', 'plsql'), null, 'no parser for Oracle');
  assert.ok(Q.PARSER_DIALECTS.length >= 12);
});
t('labels: MySQL block labels (proc: BEGIN) survive the formatter, strings untouched', () => {
  const f = require('../../js/vendor/sql-formatter.min.js');
  const src = "CREATE PROCEDURE p()\nproc: BEGIN\n  DECLARE x INT;\n  lp: LOOP\n    SELECT 'a: BEGIN';\n    LEAVE lp;\n  END LOOP lp;\nEND proc";
  assert.throws(() => f.format(src, { language: 'mysql' }), 'the formatter alone should still fail on labels');
  const pr = Q.protectLabels(src);
  const out = pr.restore(f.format(pr.text, { language: 'mysql' }));
  assert.match(out, /^proc: BEGIN\b/m);
  assert.match(out, /^\s*lp: LOOP$/m);
  assert.ok(out.includes("'a: BEGIN'"), out);
  assert.ok(!/lb-label/.test(out), out);
  assert.strictEqual(Q.protectLabels('SELECT 1').restore('SELECT\n  1'), 'SELECT\n  1');
});
t('labels: DELIMITER // blocks keep their delimiter and format', () => {
  const f = require('../../js/vendor/sql-formatter.min.js');
  const src = "DELIMITER //\nCREATE PROCEDURE r()\nproc: BEGIN\n  SELECT 1;\n  SELECT '//';\nEND //\nDELIMITER ;\nSELECT 2;";
  const pr = Q.protectLabels(src), out = pr.restore(f.format(pr.text, { language: 'mysql' }));
  assert.match(out, /^DELIMITER \/\/$/m);
  assert.match(out, /^END \/\/$/m);
  assert.match(out, /^DELIMITER ;$/m);
  assert.ok(out.includes("'//'") && out.includes('proc: BEGIN') && !/lb-/.test(out), out);
});
console.log(`${n} passed, ${failed} failed`);
