/* Layerbit SQL analysis: lint rules with one-click fixes, DDL reading,
 * statement splitting and autocomplete. Pure functions, no DOM. Browser
 * (window.LBSqlX), Worker, Node.
 *
 * Text inside strings, comments and dollar quotes is masked first, so a
 * rule never fires on 'SELECT * FROM x' inside a string.
 *
 * lint(sql, schema?) -> [{rule, severity, message, line, col, index, fix: {start, end, text} | null}]
 *   select-star       SELECT *; the fix lists the columns when the DDL is known
 *   no-where          UPDATE / DELETE without WHERE; the fix adds WHERE 1 = 0
 *   not-in-null       NOT IN (SELECT col ...): one NULL makes it match nothing;
 *                     the fix adds col IS NOT NULL to the subquery
 *   implicit-join     FROM a, b WHERE a.x = b.y; the fix writes JOIN ... ON
 *   unused-variable   DECLARE @v never used; the fix removes it
 *   leading-wildcard  LIKE '%...' cannot use an index; no automatic fix
 * applyFix(sql, finding) -> sql
 * parseDDL(text) -> {tables: {name: [column, ...]}} from CREATE TABLE
 * splitStatements(sql) -> [{text, start}]
 * complete(sql, cursor, schema) -> {prefix, items: [{label, kind}]}
 * syntax(Parser, sql, dialect) -> {ok, line, column, message} from node-sql-parser's
 *   grammar for that dialect, or null when it has none (Oracle PL/SQL, Spark, ...)
 * PARSER_DIALECTS -> [[id, label]] the dialects syntax() can check
 * protectLabels(sql) -> {text, restore(formatted)}: MySQL block labels
 *   ("proc: BEGIN", "lp: LOOP") hidden in comments so sql-formatter can parse them
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBSqlX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function blank(s) { return s.replace(/[^\n]/g, ' '); }
  function mask(sql, keepStrings) {
    var out = '', i = 0, n = sql.length;
    while (i < n) {
      var c = sql[i], d = sql[i + 1];
      if (c === '-' && d === '-') { var e = sql.indexOf('\n', i); if (e < 0) e = n; out += blank(sql.slice(i, e)); i = e; continue; }
      if (c === '/' && d === '*') { var e2 = sql.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; out += blank(sql.slice(i, e2)); i = e2; continue; }
      if (c === "'" && !keepStrings) { var j = i + 1; for (; j < n; j++) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j++; continue; } break; } } out += "'" + blank(sql.slice(i + 1, j)) + (j < n ? "'" : ''); i = j + 1; continue; }
      if (c === '$') { var m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64)); if (m) { var close = sql.indexOf(m[0], i + m[0].length); close = close < 0 ? n : close + m[0].length; out += m[0] + blank(sql.slice(i + m[0].length, close - m[0].length)) + (close <= n ? sql.slice(close - m[0].length, close) : ''); i = close; continue; } }
      out += c; i++;
    }
    return out;
  }
  function lineCol(sql, idx) { var before = sql.slice(0, idx), line = before.split('\n').length; return { line: line, col: idx - before.lastIndexOf('\n') }; }
  function splitStatements(sql) {
    var m = mask(sql), out = [], start = 0;
    for (var i = 0; i < m.length; i++) if (m[i] === ';') { out.push({ text: sql.slice(start, i + 1), start: start }); start = i + 1; }
    if (sql.slice(start).trim()) out.push({ text: sql.slice(start), start: start });
    return out.filter(function (s) { return s.text.trim(); }).map(function (s) { var lead = /^\s*/.exec(s.text)[0].length; return { text: s.text.slice(lead), start: s.start + lead }; });
  }
  function bare(name) { var parts = String(name).split('.'); return parts[parts.length - 1].replace(/^[\["`]|[\]"`]$/g, ''); }
  function matchParen(m, open) { var depth = 0; for (var i = open; i < m.length; i++) { if (m[i] === '(') depth++; else if (m[i] === ')') { depth--; if (depth === 0) return i; } } return -1; }
  function parseDDL(text) {
    var src = String(text), m = mask(src, true), tables = {}, re = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/gi, x;
    while ((x = re.exec(m))) {
      var open = x.index + x[0].length - 1, close = matchParen(m, open); if (close < 0) continue;
      var body = m.slice(open + 1, close), parts = [], depth = 0, st = 0;
      for (var i = 0; i < body.length; i++) { var ch = body[i]; if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) { parts.push(body.slice(st, i)); st = i + 1; } }
      parts.push(body.slice(st));
      var cols = [];
      parts.forEach(function (p) {
        var t = p.trim(); if (!t) return;
        var first = /^("[^"]+"|\[[^\]]+\]|`[^`]+`|[\w$]+)/.exec(t); if (!first) return;
        if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|KEY|INDEX|EXCLUDE|PERIOD|LIKE|FULLTEXT|SPATIAL)$/i.test(first[1])) return;
        cols.push(bare(first[1]));
      });
      tables[bare(x[1])] = cols;
    }
    return { tables: tables };
  }
  function tableCols(schema, name) {
    if (!schema || !schema.tables) return null;
    var b = bare(name).toLowerCase(), keys = Object.keys(schema.tables);
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === b) return schema.tables[keys[i]];
    return null;
  }
  var KW = /^(WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|ON|GROUP|ORDER|HAVING|LIMIT|UNION|SET|VALUES|USING|WINDOW|OFFSET|FETCH|FOR|AND|OR)$/i;
  var CLAUSE_END = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|WINDOW|OFFSET|FETCH|FOR\s+UPDATE)\b/i;
  function lint(sql, schema) {
    sql = String(sql);
    var m = mask(sql), out = [], x;
    function add(rule, severity, idx, message, fix) { var lc = lineCol(sql, idx); out.push({ rule: rule, severity: severity, message: message, line: lc.line, col: lc.col, index: idx, fix: fix || null }); }
    var stmts = splitStatements(sql);
    stmts.forEach(function (st) {
      var ms = m.slice(st.start, st.start + st.text.length);
      // UPDATE / DELETE without WHERE
      if (/^(UPDATE|DELETE)\b/i.test(ms) && !/\bWHERE\b/i.test(ms) && !/^UPDATE\s+STATISTICS\b/i.test(ms)) {
        var body = ms.replace(/;\s*$/, ''), endIdx = st.start + body.replace(/\s+$/, '').length;
        add('no-where', 'error', st.start, (/^UPDATE/i.test(ms) ? 'UPDATE' : 'DELETE') + ' without WHERE changes every row of the table.', { start: endIdx, end: endIdx, text: ' WHERE 1 = 0 /* add the real condition */' });
      }
      // implicit join: FROM a [x], b [y] WHERE x.k = y.k
      var re = /\bFROM\s+([\w.\[\]"`]+)(?:\s+(?:AS\s+)?(\w+))?\s*,\s*([\w.\[\]"`]+)(?:\s+(?:AS\s+)?(\w+))?/gi, j;
      while ((j = re.exec(ms))) {
        var a1 = j[2] && !KW.test(j[2]) ? j[2] : null, a2 = j[4] && !KW.test(j[4]) ? j[4] : null;
        var n1 = a1 || bare(j[1]), n2 = a2 || bare(j[3]);
        var fromEnd = j.index + (a2 ? j[0].length : j[0].length - (j[4] && KW.test(j[4]) ? j[4].length : 0));
        var rest = ms.slice(fromEnd), w = /\bWHERE\b/i.exec(rest), fix = null;
        if (w) {
          var wStart = fromEnd + w.index, bodyStart = wStart + 5, tail = ms.slice(bodyStart), ce = CLAUSE_END.exec(tail);
          var semi = tail.indexOf(';'), bodyEnd = bodyStart + Math.min(ce ? ce.index : tail.length, semi >= 0 ? semi : tail.length);
          var whereText = sql.slice(st.start + bodyStart, st.start + bodyEnd), wm = whereText.replace(/\s+$/, '');
          var eqRe = new RegExp('\\b(' + n1 + '\\.\\w+\\s*=\\s*' + n2 + '\\.\\w+|' + n2 + '\\.\\w+\\s*=\\s*' + n1 + '\\.\\w+)', 'i'), eq = eqRe.exec(wm);
          if (eq) {
            var cond = eq[1], left = wm.slice(0, eq.index), right = wm.slice(eq.index + cond.length);
            var remaining = (left.replace(/\s*\bAND\s*$/i, '') + ' ' + right.replace(/^\s*AND\b\s*/i, '')).trim();
            if (left.trim() && !/\bAND\s*$/i.test(left)) remaining = null;   // OR or something else: leave it alone
            if (remaining !== null) {
              var text = 'FROM ' + sql.slice(st.start + j.index + j[0].indexOf(j[1]), st.start + j.index + j[0].indexOf(j[1]) + j[1].length) + (a1 ? ' ' + a1 : '') + ' JOIN ' + j[3] + (a2 ? ' ' + a2 : '') + ' ON ' + cond + (remaining ? ' WHERE ' + remaining : '');
              var trailing = whereText.slice(wm.length);
              fix = { start: st.start + j.index, end: st.start + bodyEnd - trailing.length, text: text };
            }
          }
        }
        add('implicit-join', 'warning', st.start + j.index, 'Tables joined with a comma: an explicit JOIN ... ON keeps the join condition next to the table and cannot become a cross join by accident.', fix);
      }
    });
    // SELECT *
    var rs = /\bSELECT\s+(?:DISTINCT\s+|ALL\s+|TOP\s+\(?\d+\)?\s+)?(\*)/gi;
    while ((x = rs.exec(m))) {
      var star = x.index + x[0].length - 1, after = m.slice(star + 1), fm = /^\s*FROM\s+([\w.\[\]"`]+)(?:\s+(?:AS\s+)?(\w+))?\s*([^\s]*)/i.exec(after), fx = null;
      if (fm && !/^(,|JOIN|INNER|LEFT|RIGHT|FULL|CROSS)/i.test(fm[3] || '') && !(fm[2] && /^(JOIN|INNER|LEFT|RIGHT|FULL|CROSS)$/i.test(fm[2]))) {
        var cols = tableCols(schema, fm[1]); if (cols && cols.length) fx = { start: star, end: star + 1, text: cols.join(', ') };
      }
      add('select-star', 'warning', x.index, 'SELECT * returns every column: the result changes when the table does, and it reads columns nobody uses.' + (fx ? '' : ' Paste the table\'s CREATE TABLE under Schema to fix it in one click.'), fx);
    }
    // NOT IN (SELECT ...)
    var rn = /\bNOT\s+IN\s*\(\s*SELECT\b/gi;
    while ((x = rn.exec(m))) {
      var open = m.indexOf('(', x.index), close = matchParen(m, open); if (close < 0) continue;
      var sub = sql.slice(open + 1, close), msub = m.slice(open + 1, close), sel = /^\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\b/i.exec(msub), fix2 = null;
      if (sel && !/,/.test(sel[1])) {
        var col = sub.slice(sel.index + sel[0].indexOf(sel[1]), sel.index + sel[0].indexOf(sel[1]) + sel[1].length).trim();
        // already excluded: "col IS NOT NULL" anywhere in the subquery's WHERE
        if (new RegExp('\\bWHERE\\b[\\s\\S]*' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+IS\\s+NOT\\s+NULL\\b', 'i').test(msub)) continue;
        var whereM = /\bWHERE\b/i.exec(msub), endM = CLAUSE_END.exec(msub), cut = endM ? endM.index : msub.replace(/\s+$/, '').length, newSub;
        if (whereM && (!endM || whereM.index < endM.index)) newSub = sub.slice(0, whereM.index) + 'WHERE (' + sub.slice(whereM.index + 5, cut).trim() + ') AND ' + col + ' IS NOT NULL' + (endM ? ' ' + sub.slice(cut) : sub.slice(msub.replace(/\s+$/, '').length));
        else newSub = sub.slice(0, cut).replace(/\s+$/, '') + ' WHERE ' + col + ' IS NOT NULL' + (endM ? ' ' + sub.slice(cut) : sub.slice(msub.replace(/\s+$/, '').length));
        fix2 = { start: open + 1, end: close, text: newSub };
      }
      add('not-in-null', 'warning', x.index, 'NOT IN with a subquery matches no rows at all if the subquery returns a single NULL.', fix2);
    }
    // DECLARE @v that is never used
    var rd = /\bDECLARE\s+(@\w+)/gi;
    while ((x = rd.exec(m))) {
      var name = x[1], uses = m.match(new RegExp('(?:^|[^\\w@])' + name.replace('@', '@') + '(?!\\w)', 'gi')) || [];
      if (uses.length > 1) continue;
      var semi2 = m.indexOf(';', x.index), nl = m.indexOf('\n', x.index), endD = semi2 >= 0 && (nl < 0 || semi2 < nl) ? semi2 + 1 : nl >= 0 ? nl : m.length;
      if (sql[endD] === '\n') endD++;
      add('unused-variable', 'info', x.index, 'The variable ' + name + ' is declared but never used.', { start: x.index, end: endD, text: '' });
    }
    // LIKE '%...'
    var rl = /\bLIKE\s+N?'/gi;
    while ((x = rl.exec(m))) { var q = x.index + x[0].length; if (sql[q] === '%') add('leading-wildcard', 'info', x.index, 'LIKE with a leading % cannot use an index, so it scans the whole table. Consider a full-text index or a reversed-value column.', null); }
    return out.sort(function (a, b) { return a.index - b.index; });
  }
  function applyFix(sql, f) { return !f || !f.fix ? sql : sql.slice(0, f.fix.start) + f.fix.text + sql.slice(f.fix.end); }

  function aliasesOf(text) {
    var m = mask(text), re = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\w.\[\]"`]+)(?:\s+(?:AS\s+)?(\w+))?/gi, x, map = {}, tables = [];
    while ((x = re.exec(m))) { var t = bare(x[1]); tables.push(t); map[t.toLowerCase()] = t; if (x[2] && !KW.test(x[2])) map[x[2].toLowerCase()] = t; }
    return { map: map, tables: tables };
  }
  function complete(sql, cursor, schema) {
    var before = sql.slice(0, cursor), stmt = splitStatements(sql).filter(function (s) { return s.start <= cursor; }).pop(), stText = stmt ? stmt.text : sql;
    var al = aliasesOf(stText), items = [], seen = {};
    var push = function (label, kind) { if (!seen[kind + label]) { seen[kind + label] = 1; items.push({ label: label, kind: kind }); } };
    var dot = /(\w+)\.([\w$]*)$/.exec(before);
    if (dot) {
      var t = al.map[dot[1].toLowerCase()] || dot[1], cols = tableCols(schema, t) || [];
      cols.forEach(function (c) { if (c.toLowerCase().indexOf(dot[2].toLowerCase()) === 0) push(c, 'column'); });
      return { prefix: dot[2], items: items };
    }
    var w = /([\w$]*)$/.exec(before), prefix = w[1], pl = prefix.toLowerCase();
    var tablesCtx = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+[\w$]*$/i.test(before);
    var all = schema && schema.tables ? Object.keys(schema.tables) : [];
    if (tablesCtx) { all.forEach(function (tn) { if (tn.toLowerCase().indexOf(pl) === 0) push(tn, 'table'); }); return { prefix: prefix, items: items }; }
    var used = al.tables.length ? al.tables : all;
    used.forEach(function (tn) { (tableCols(schema, tn) || []).forEach(function (c) { if (c.toLowerCase().indexOf(pl) === 0) push(c, 'column'); }); });
    return { prefix: prefix, items: items };
  }
  var PARSER_DB = { mysql: 'MySQL', mariadb: 'MariaDB', postgresql: 'PostgresQL', tsql: 'TransactSQL', sqlite: 'Sqlite', bigquery: 'BigQuery', snowflake: 'Snowflake', redshift: 'Redshift', db2: 'DB2', hive: 'Hive', trino: 'Trino', athena: 'Athena', flinksql: 'FlinkSQL', n1ql: 'Noql' };
  var PARSER_DIALECTS = [['mysql', 'MySQL'], ['mariadb', 'MariaDB'], ['postgresql', 'PostgreSQL'], ['tsql', 'T-SQL (SQL Server)'], ['sqlite', 'SQLite'], ['bigquery', 'BigQuery'], ['snowflake', 'Snowflake'], ['redshift', 'Redshift'], ['db2', 'DB2'], ['hive', 'Hive'], ['trino', 'Trino'], ['athena', 'Athena'], ['flinksql', 'Flink SQL'], ['n1ql', 'N1QL']];
  var parsers = {};
  function syntax(Parser, sql, dialect) {
    var db = PARSER_DB[dialect]; if (!db || !Parser) return null;
    var p = parsers.p || (parsers.p = new Parser());
    try { p.astify(sql, { database: db }); return { ok: true, line: 0, column: 0, message: 'OK' }; }
    catch (e) {
      var loc = e && e.location && e.location.start;
      if (!loc) return { ok: false, line: 0, column: 0, message: String(e && e.message || e).split('\n')[0] };
      var what = e.found == null ? 'the statement ends too early' : 'unexpected "' + String(e.found).replace(/\s/g, ' ') + '"';
      return { ok: false, line: loc.line, column: loc.column, message: 'line ' + loc.line + ', column ' + loc.column + ': ' + what };
    }
  }
  function protectLabels(sql) {
    // DELIMITER // ... // (mysql client syntax): each custom delimiter becomes ";" plus a numbered marker
    var lines = sql.split('\n'), m0 = mask(sql).split('\n'), delim = ';', ds = [], out = [], changed = false;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li], ml = m0[li];
      if (/^\s*DELIMITER\s+\S+\s*$/i.test(ml)) { delim = line.trim().split(/\s+/)[1]; ds.push(delim); out.push('/*lb-delim' + (ds.length - 1) + '*/'); changed = true; continue; }
      if (delim !== ';' && ml.indexOf(delim) >= 0) {
        var acc = '', from = 0, at;
        while ((at = ml.indexOf(delim, from)) >= 0) { ds.push(delim); acc += line.slice(from, at) + ';/*lb-d' + (ds.length - 1) + '*/'; from = at + delim.length; }
        line = acc + line.slice(from); changed = true;
      }
      out.push(line);
    }
    var text = changed ? out.join('\n') : sql;
    var m = mask(text), re = /(^|[\s;])([A-Za-z_]\w*):([ \t]*(?:\r?\n[ \t]*)?)(BEGIN|LOOP|WHILE|REPEAT)\b/gi, x, edits = [];
    while ((x = re.exec(m))) { var p = x.index + x[1].length; edits.push([p, p + x[2].length + 1, '/*lb-label:' + text.slice(p, p + x[2].length) + '*/' + (x[3] ? '' : ' ')]); /* whitespace kept, so error lines still match */ }
    for (var i = edits.length - 1; i >= 0; i--) text = text.slice(0, edits[i][0]) + edits[i][2] + text.slice(edits[i][1]);
    if (!changed && !edits.length) return { text: sql, restore: function (o) { return o; } };
    return { text: text, restore: function (o) {
      return o.replace(/\/\*lb-label:(\w+)\*\/[ \t]*(?:\r?\n[ \t]*)?/g, '$1: ')
        .replace(/[ \t]*;\s*\/\*lb-d(\d+)\*\//g, function (all, n) { return ' ' + ds[+n]; })
        .replace(/\/\*lb-delim(\d+)\*\//g, function (all, n) { return 'DELIMITER ' + ds[+n]; });
    } };
  }
  return { protectLabels: protectLabels, syntax: syntax, PARSER_DIALECTS: PARSER_DIALECTS, lint: lint, applyFix: applyFix, parseDDL: parseDDL, splitStatements: splitStatements, complete: complete, mask: mask };
});
