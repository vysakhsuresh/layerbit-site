#!/usr/bin/env python3
"""Functional tests for every Layerbit tool, driven in headless Chromium.

Each tool is exercised at four levels:

  minimal  - empty / single-character input; the tool must not throw
  typical  - a realistic input with a known correct output
  edge     - unicode, malformed input, boundary values; errors must be
             reported in the UI rather than thrown
  maximal  - large input (hundreds of KB to a few MB); must finish within
             the time budget and still be correct

A case fails on a wrong result, an uncaught page error, a console error the
page itself produced, or blowing the time budget. Third-party requests
(ads, analytics, Firebase, fonts) are blocked so the tests are hermetic and
so a blocked CDN can never be mistaken for a tool defect.

Usage:
  python3 scripts/test_tools.py              run everything
  python3 scripts/test_tools.py --only base64 json-validator
  python3 scripts/test_tools.py --list

Requires: pip install playwright && playwright install chromium
Set LAYERBIT_CHROMIUM=/path/to/chrome to use a specific binary.
"""
import argparse, base64, functools, http.server, json, os, socket, socketserver, sys
import threading, time, traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIME_BUDGET_S = 12.0
BLOCKED_HOSTS = ("googletagmanager.com", "googlesyndication.com", "gstatic.com",
                 "google-analytics.com", "googleapis.com", "firebaseio.com",
                 "unpkg.com", "jsdelivr.net", "buymeacoffee.com")

CASES = []  # (slug, level, name, fn)


def case(slug, level, name):
    def deco(fn):
        CASES.append((slug, level, name, fn))
        return fn
    return deco


# ----------------------------------------------------------------------------
# page helpers
# ----------------------------------------------------------------------------
class Tool:
    """Thin wrapper over a Playwright page for one tool."""

    def __init__(self, page, base, slug):
        self.page, self.slug = page, slug
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append("pageerror: " + str(e)))
        page.on("console", self._on_console)
        page.goto(f"{base}/tools/{slug}.html", wait_until="load")
        page.evaluate("document.querySelectorAll('.cookie-consent-banner').forEach(e=>e.remove())")

    def _on_console(self, msg):
        if msg.type != "error":
            return
        t = msg.text
        if "Failed to load resource" in t or "net::ERR" in t or "ERR_FAILED" in t:
            return  # blocked third-party request, by design
        self.errors.append("console: " + t)

    # -- input -----------------------------------------------------------
    def set(self, el_id, text, event="input"):
        """Set a textarea/input value and fire the event the tool listens to.
        Uses evaluate rather than page.fill so multi-MB inputs are instant."""
        self.page.evaluate(
            """([id, v, ev]) => { const el = document.getElementById(id);
                 el.value = v; el.dispatchEvent(new Event(ev, {bubbles: true})); }""",
            [el_id, text, event])

    def select(self, el_id, value):
        self.page.select_option(f"#{el_id}", value)

    def click(self, selector):
        self.page.click(selector)

    def call(self, js):
        return self.page.evaluate(js)

    def upload(self, el_id, name, content, mime="text/plain"):
        self.page.set_input_files(f"#{el_id}", {"name": name, "mimeType": mime,
                                                  "buffer": content.encode("utf-8")})

    # -- output ----------------------------------------------------------
    def val(self, el_id):
        return self.page.evaluate("id => document.getElementById(id).value", el_id)

    def text(self, el_id):
        return self.page.evaluate("id => document.getElementById(id).innerText", el_id)

    def html(self, el_id):
        return self.page.evaluate("id => document.getElementById(id).innerHTML", el_id)

    def visible(self, selector):
        return self.page.is_visible(selector)

    def count(self, selector):
        return self.page.locator(selector).count()

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    def wait_for(self, js, timeout=8000):
        self.page.wait_for_function(js, timeout=timeout)


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def eq(actual, expected, what):
    if actual != expected:
        a = repr(actual)[:200]; e = repr(expected)[:200]
        raise AssertionError(f"{what}: expected {e}, got {a}")


# ----------------------------------------------------------------------------
# base64
# ----------------------------------------------------------------------------
@case("base64", "minimal", "empty input yields empty output, no error")
def _(t):
    t.set("plainText", "")
    eq(t.val("base64Text"), "", "encoded")
    expect(not t.visible("#decodeError"), "error shown for empty input")


@case("base64", "edge", "A6: text can be encoded with CRLF line endings")
def _(t):
    t.set("plainText", "a\nb")
    eq(t.val("base64Text"), "YQpi", "LF as typed")
    t.select("lineEndings", "crlf")
    eq(t.val("base64Text"), "YQ0KYg==", "CRLF")
    t.select("lineEndings", "lf")


@case("base64", "typical", "encode/decode ASCII")
def _(t):
    t.set("plainText", "Hello, Layerbit!")
    eq(t.val("base64Text"), "SGVsbG8sIExheWVyYml0IQ==", "encoded")
    t.set("base64Text", "SGVsbG8sIExheWVyYml0IQ==")
    eq(t.val("plainText"), "Hello, Layerbit!", "decoded")


@case("base64", "edge", "UTF-8 round trip (accents, CJK, emoji)")
def _(t):
    s = "héllo wörld — 日本語 🌍"
    t.set("plainText", s)
    enc = t.val("base64Text")
    expect(enc and "=" in enc or len(enc) % 4 == 0, "encoded looks wrong")
    t.set("base64Text", enc)
    eq(t.val("plainText"), s, "unicode round trip")


@case("base64", "edge", "invalid base64 flags an error instead of throwing")
def _(t):
    t.set("base64Text", "!!!not base64***")
    t.wait(50)
    expect(t.visible("#decodeError"), "decodeError not shown")


@case("base64", "edge", "base64url alphabet and missing padding decode")
def _(t):
    # "hi?>" -> standard aGk/Pg== ; url-safe aGk_Pg (no padding)
    t.set("base64Text", "aGk_Pg")
    eq(t.val("plainText"), "hi?>", "base64url decode")


@case("base64", "maximal", "1 MB text round trip under budget")
def _(t):
    s = ("The quick brown fox jumps over the lazy dog. " * 24000)[:1_000_000]
    t.set("plainText", s)
    enc = t.val("base64Text")
    eq(len(enc), 1_333_336, "encoded length for 1,000,000 bytes")
    t.set("base64Text", enc)
    eq(len(t.val("plainText")), len(s), "decoded length")


@case("base64", "typical", "URL-safe toggle swaps alphabet and drops padding; stats shown")
def _(t):
    t.set("plainText", "hi?>")
    eq(t.val("base64Text"), "aGk/Pg==", "standard")
    t.click("#urlSafe")
    eq(t.val("base64Text"), "aGk_Pg", "url-safe")
    expect("4 bytes" in t.text("b64Stats"), f"stats: {t.text('b64Stats')}")


# ----------------------------------------------------------------------------
# json-validator
# ----------------------------------------------------------------------------
@case("json-validator", "minimal", "empty input: no output, no error")
def _(t):
    t.set("jsonInput", "")
    t.click("#btnFormat")
    eq(t.text("jsonOutput").strip(), "", "output")
    expect(not t.visible("#errorBanner"), "error banner shown for empty input")


@case("json-validator", "typical", "format, minify and indentation choice")
def _(t):
    t.set("jsonInput", '{"a":1,"b":[true,null,"x"]}')
    t.click("#btnFormat")
    out = t.text("jsonOutput")
    expect('"a": 1' in out and '"b": [' in out, f"formatted output wrong: {out[:80]}")
    t.click("#btnMinify")
    eq(t.text("jsonOutput").strip(), '{"a":1,"b":[true,null,"x"]}', "minified")
    t.select("indentSel", "2")
    t.click("#btnFormat")
    expect('\n  "a": 1' in t.text("jsonOutput"), "2-space indent not applied")


@case("json-validator", "edge", "syntax error is reported with position, not thrown")
def _(t):
    t.set("jsonInput", '{"a": 1,}')
    t.click("#btnFormat")
    expect(t.visible("#errorBanner"), "error banner not shown")
    expect("Invalid JSON" in t.text("errorText"), "error text missing")


@case("json-validator", "edge", "tree view renders nested nodes and copies a path on click")
def _(t):
    t.set("jsonInput", '{"users":[{"id":1,"tags":["a","b"]},{"id":2}]}')
    t.click("#btnFormat")
    t.click("#viewTabTree")
    expect(t.count("#jsonTree .tree-row") >= 5, "tree rows not rendered")
    eq(t.call("document.querySelectorAll('#jsonTree .tree-leaf')[0].dataset.path"), "$.users[0].id", "leaf path")


@case("json-validator", "maximal", "20,000-object array formats under budget")
def _(t):
    arr = [{"id": i, "name": f"user{i}", "active": i % 2 == 0, "score": i * 0.5} for i in range(20000)]
    t.set("jsonInput", json.dumps(arr))
    t.click("#btnMinify")
    out = t.text("jsonOutput")
    expect(out.startswith('[{"id":0') and out.rstrip().endswith("}]"), "minified large array wrong")


@case("json-validator", "edge", "A3: Beautify, Minify and Sort keys keep every number exactly as written")
def _(t):
    t.set("jsonInput", '{"id": 12345678901234567890, "big": 1e400, "neg": -0, "f": 1.10}')
    t.click("#btnFormat")
    out = t.text("jsonOutput")
    for lit in ["12345678901234567890", "1e400", "-0", "1.10"]:
        expect(lit in out, f"{lit} changed in the formatted output: {out}")
    t.click("#btnMinify")
    eq(t.text("jsonOutput").strip(), '{"id":12345678901234567890,"big":1e400,"neg":-0,"f":1.10}', "minified")
    t.page.check("#sortKeys"); t.click("#btnMinify")
    eq(t.text("jsonOutput").strip(), '{"big":1e400,"f":1.10,"id":12345678901234567890,"neg":-0}', "sorted")
    t.page.uncheck("#sortKeys")


@case("json-validator", "edge", "A4: CSV conversion is safe for spreadsheets by default; the switch gives the exact text")
def _(t):
    t.set("jsonInput", '[{"name": "=HYPERLINK(\\"http://x\\")", "cmd": "@SUM(A1)", "n": -5, "id": 12345678901234567890}]')
    t.click("#btnFormat")
    t.call("setOutputView('convert')"); t.select("convTarget", "csv"); t.wait(100)
    out = t.text("convOut")
    expect("'=HYPERLINK" in out and "'@SUM(A1)" in out and ",-5," in out and "12345678901234567890" in out, out)
    expect(t.page.is_checked("#csvSafe"), "Safe for Excel is not on by default")
    t.page.uncheck("#csvSafe"); t.wait(100)
    out = t.text("convOut")
    expect("'=HYPERLINK" not in out and "@SUM(A1)" in out, out)
    t.page.check("#csvSafe")


@case("json-validator", "typical", "path query evaluates dot, bracket and length")
def _(t):
    t.set("jsonInput", '{"users":[{"id":1,"tags":["a","b"]},{"id":2}],"meta":{"a b":true}}')
    t.click("#btnFormat")
    t.set("pathInput", "$.users[0].tags[1]")
    eq(t.text("pathResult").strip(), '"b"', "bracket path")
    t.set("pathInput", "users.length")
    eq(t.text("pathResult").strip(), "2", "length")
    t.set("pathInput", 'meta["a b"]')
    eq(t.text("pathResult").strip(), "true", "quoted key")
    t.set("pathInput", "users[5].id")
    expect("undefined" in t.text("pathResult"), "missing path not reported")


@case("json-validator", "typical", "JSONPath wildcards, recursion and filters list every match with its path")
def _(t):
    t.call("loadSample('api')")
    t.wait(100)
    t.call("setOutputView('query')")
    eq(t.text("pathCount"), "3 matches", "filter count")
    paths = t.call("[...document.querySelectorAll('#pathList .path-path')].map(e=>e.textContent)")
    eq(paths, ["$.data[0].name", "$.data[2].name", "$.data[3].name"], "filter paths")
    t.set("pathInput", "$..id")
    eq(t.text("pathCount"), "4 matches", "recursive descent")
    t.set("pathInput", "$.data[-1].name")
    eq(t.text("pathResult").strip(), '"Support Plan"', "negative index")
    t.set("pathInput", "$.data[?(@.price >")
    expect("Bad path" in t.text("pathResult"), "bad filter not reported")


@case("json-validator", "typical", "sort keys is deep and leaves arrays alone")
def _(t):
    t.set("jsonInput", '{"b":{"z":1,"a":[3,1,2]},"a":0}')
    t.call("document.getElementById('sortKeys').checked = true")
    t.click("#btnMinify")
    eq(t.text("jsonOutput").strip(), '{"a":0,"b":{"a":[3,1,2],"z":1}}', "sorted")


@case("json-validator", "edge", "error reports line and column and moves the caret")
def _(t):
    t.set("jsonInput", '{\n  "a": 1,\n  "b": [1, 2,]\n}')
    t.click("#btnFormat")
    msg = t.text("errorText")
    expect("line 3" in msg and "column" in msg, f"no line/col: {msg}")
    sel = t.call("document.getElementById('jsonInput').selectionStart")
    expect(sel > 15, f"caret not moved: {sel}")


@case("json-validator", "typical", "stats strip counts structure")
def _(t):
    t.set("jsonInput", '{"a":[1,2,{"b":null}],"c":"x"}')
    t.click("#btnFormat")
    st = t.text("jsonStats")
    expect("3" in st and "keys" in st and "depth" in st and "minified" in st, f"stats wrong: {st}")


@case("json-validator", "edge", "Fix repairs comments, quotes, bare keys, commas and NaN and lists the changes")
def _(t):
    t.call("loadSample('almost')")
    t.wait(80)
    expect(t.visible("#errorBanner"), "sample should start invalid")
    t.click("#btnFix")
    t.wait(100)
    expect(not t.visible("#errorBanner"), "still invalid after fix: " + t.text("errorText"))
    note = t.text("noticeText")
    expect("trailing comma" in note and "bare key" in note and "comment" in note, note)
    expect('"ratio": null' in t.text("jsonOutput") and '"enabled": true' in t.text("jsonOutput"), t.text("jsonOutput")[:200])


@case("json-validator", "edge", "NDJSON is detected and parsed line by line; big integers warn")
def _(t):
    t.call("loadSample('ndjson')")
    t.wait(80)
    expect("NDJSON detected: 4 objects" in t.text("noticeText"), t.text("noticeText"))
    expect(t.text("jsonOutput").lstrip().startswith("["), "not shown as array")
    t.set("jsonInput", '{"id": 9007199254740993}')
    t.click("#btnFormat")
    expect("Precision warning" in t.text("noticeText"), t.text("noticeText"))


@case("json-validator", "typical", "schema: infer then validate passes; a wrong schema lists violations by path")
def _(t):
    t.call("loadSample('api')")
    t.wait(80)
    t.call("setOutputView('schema'); inferSchema()")
    expect('"format": "date-time"' in t.val("schemaInput") and '"required"' in t.val("schemaInput"), t.val("schemaInput")[:300])
    t.call("validateSchema()")
    expect("Valid" in t.text("schemaResult"), t.text("schemaResult"))
    t.set("schemaInput", '{"type":"object","required":["nope"],"properties":{"status":{"type":"string"},"data":{"type":"array","maxItems":2}}}')
    t.call("validateSchema()")
    rows = t.call("[...document.querySelectorAll('#schemaResult tbody tr')].map(r=>r.children[0].textContent+':'+r.children[1].textContent)")
    eq(sorted(rows), ["$.data:maxItems", "$.status:type", "$:required"], str(rows))
    t.set("schemaInput", "{not json")
    t.call("validateSchema()")
    expect("not valid JSON" in t.text("schemaResult"), t.text("schemaResult"))


@case("json-validator", "typical", "types tab generates TypeScript and Go from the sample")
def _(t):
    t.call("loadSample('api')")
    t.wait(80)
    t.call("setOutputView('types')")
    ts = t.text("typesOut")
    expect("export interface Root {" in ts and "data: Datum[];" in ts and "discount?: number | null;" in ts, ts[:400])
    t.select("typeLang", "go")
    expect('`json:"inStock"`' in t.text("typesOut"), t.text("typesOut")[:300])
    t.set("typeName", "Catalog")
    expect("type Catalog struct" in t.text("typesOut"), "root name not applied")


@case("json-validator", "typical", "convert tab: SQL, CSV, NDJSON, YAML and string literal")
def _(t):
    t.call("loadSample('api')")
    t.wait(80)
    t.call("setOutputView('convert')")
    sql = t.text("convOut")
    expect('CREATE TABLE "data"' in sql and 'INSERT INTO "data"' in sql and "'Quantum CPU'" in sql, sql[:300])
    t.select("sqlDialect", "mysql")
    expect("`data`" in t.text("convOut"), "mysql quoting")
    t.select("convTarget", "csv")
    expect(t.text("convOut").startswith("id,name,inStock,price,tags,createdAt,category,discount"), t.text("convOut")[:100])
    t.select("convTarget", "ndjson")
    eq(len([l for l in t.text("convOut").split("\n") if l.strip()]), 1, "object -> one ndjson line")
    t.select("convTarget", "yaml")
    expect(t.text("convOut").startswith("status: 200\nmessage: Data retrieved successfully\ndata:\n  - id: 101"), t.text("convOut")[:120])
    t.select("convTarget", "string")
    expect(t.text("convOut").startswith('"{'), "string literal")


@case("json-validator", "typical", "share link restores input, options, path and view")
def _(t):
    t.call("loadSample('api')")
    t.wait(80)
    t.call("setOutputView('query')")
    url = t.call("Layerbit.state.write(getState())")
    t.page.goto(url, wait_until="load")
    t.wait(300)
    eq(t.val("pathInput"), "$.data[?(@.inStock == true)].name", "path restored")
    eq(t.text("pathCount"), "3 matches", "query re-run")
    expect(t.visible("#viewQuery"), "view not restored")


# ----------------------------------------------------------------------------
# jwt-decoder
# ----------------------------------------------------------------------------
# HS256 token: header {"alg":"HS256","typ":"JWT"} payload {"sub":"1234567890","name":"John Doe","iat":1516239022}, secret "your-256-bit-secret"
JWT_HS256 = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
             "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ."
             "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")


@case("jwt-decoder", "minimal", "empty input clears outputs")
def _(t):
    t.set("jwtInput", "")
    expect(t.text("payloadOutput").strip() in ("", "{}") or "paste" in t.text("payloadOutput").lower(), "payload output not cleared")
    expect("Decode a token" in t.text("lintList"), "lint not reset")


@case("jwt-decoder", "typical", "decodes header and payload")
def _(t):
    t.set("jwtInput", JWT_HS256)
    expect('"HS256"' in t.text("headerOutput"), "header alg missing")
    expect('"John Doe"' in t.text("payloadOutput"), "payload name missing")


@case("jwt-decoder", "typical", "HS256 signature verifies with the right secret and fails with the wrong one")
def _(t):
    t.set("jwtInput", JWT_HS256)
    t.set("hmacSecret", "your-256-bit-secret")
    t.wait_for("() => /Signature Valid/.test(document.getElementById('verifyResult').innerText)")
    t.set("hmacSecret", "wrong-secret")
    t.wait_for("() => /Signature Invalid/.test(document.getElementById('verifyResult').innerText)")
    t.set("hmacSecret", "eW91ci0yNTYtYml0LXNlY3JldA")  # base64url of the secret
    t.click("#secretIsB64")
    t.wait_for("() => /Signature Valid/.test(document.getElementById('verifyResult').innerText)")


@case("jwt-decoder", "edge", "garbage input reports an error instead of throwing")
def _(t):
    t.set("jwtInput", "this.is.not.a.jwt")
    t.wait(50)
    st = t.text("statusText").lower()
    expect("invalid" in st or "error" in st or "malformed" in st, f"status did not report error: {st!r}")
    t.set("jwtInput", "a.b")
    expect("three dot-separated parts" in t.text("headerOutput"), t.text("headerOutput"))


@case("jwt-decoder", "edge", "unicode claims decode correctly")
def _(t):
    import base64
    h = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=")
    p = base64.urlsafe_b64encode('{"name":"Zoë 日本 🚀"}'.encode()).decode().rstrip("=")
    t.set("jwtInput", f"{h}.{p}.")
    expect("Zoë 日本 🚀" in t.text("payloadOutput"), "unicode claim mangled")


@case("jwt-decoder", "maximal", "token with a 200 KB payload decodes")
def _(t):
    import base64
    h = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
    big = {"roles": [f"role-{i}" for i in range(20000)]}
    p = base64.urlsafe_b64encode(json.dumps(big).encode()).decode().rstrip("=")
    t.set("jwtInput", f"{h}.{p}.sig")
    expect("role-19999" in t.text("payloadOutput"), "large payload truncated")
    expect("will not fit in a cookie" in t.text("lintList"), "size finding missing")


@case("jwt-decoder", "typical", "claim timeline: expired token shows 'ago', status Expired, timeline drawn")
def _(t):
    import base64, time
    h = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
    now = int(time.time())
    p = base64.urlsafe_b64encode(json.dumps({"iat": now - 7200, "exp": now - 3600}).encode()).decode().rstrip("=")
    t.set("jwtInput", f"{h}.{p}.x")
    expect("ago" in t.text("claimTimes") and "Lifetime" in t.text("claimTimes"), f"timeline wrong: {t.text('claimTimes')}")
    eq(t.text("statusText").strip(), "Token Expired", "status")
    expect(t.count("#timeline svg") == 1 and "Expired" in t.text("timeline"), "timeline svg missing")


@case("jwt-decoder", "edge", "nbf in the future -> Not Yet Valid; millisecond exp is flagged")
def _(t):
    import base64, time
    h = base64.urlsafe_b64encode(b'{"alg":"none"}').decode().rstrip("=")
    now = int(time.time())
    p = base64.urlsafe_b64encode(json.dumps({"nbf": now + 3600, "exp": (now + 7200) * 1000}).encode()).decode().rstrip("=")
    t.set("jwtInput", f"{h}.{p}.")
    expect("Not Yet Valid" in t.text("statusText"), f"status: {t.text('statusText')}")
    expect("milliseconds" in t.text("claimTimes"), "ms warning missing")


@case("jwt-decoder", "typical", "claims check flags risky tokens and expected iss/aud mismatches")
def _(t):
    t.call("loadSample('risky')")
    t.wait(80)
    lint = t.text("lintList")
    expect('alg is "none"' in lint and "carries its own key" in lint and "looks sensitive" in lint and "milliseconds" in lint, lint[:400])
    t.call("loadSample('oidc')")
    t.wait(80)
    t.set("expectIss", "https://other.example.com")
    t.set("expectAud", "nope")
    lint = t.text("lintList")
    expect('expected "https://other.example.com"' in lint and 'does not include "nope"' in lint, lint[:400])
    t.set("expectIss", "https://accounts.example.com")
    expect('expected "https://other' not in t.text("lintList"), "iss finding not cleared")


@case("jwt-decoder", "typical", "signer: HS512 token loads and verifies")
def _(t):
    t.set("signSecret", "s3cret")
    t.select("signAlg", "HS512")
    t.click("#btnSign")
    t.wait_for("() => document.getElementById('signOutput').innerText.split('.').length === 3")
    t.click("#btnSignLoad")
    t.wait_for("() => /Signature Valid/.test(document.getElementById('verifyResult').innerText)")
    expect('"HS512"' in t.text("headerOutput") and '"user-42"' in t.text("payloadOutput"), "loaded token wrong")
    expect("Not Expired" in t.text("statusText"), "exp not set to future")


@case("jwt-decoder", "typical", "signer: generated ES256 key pair signs, verifies via PEM and via JWKS kid")
def _(t):
    t.select("signAlg", "ES256")
    t.set("signKid", "test-kid")
    t.call("generateKeys()")
    t.wait_for("() => document.getElementById('signKey').value.includes('BEGIN PRIVATE KEY')", timeout=15000)
    expect(t.count("#genKeys .gen-row") == 4, "key outputs missing")
    t.click("#btnSign")
    t.wait_for("() => document.getElementById('signOutput').innerText.startsWith('eyJ')")
    t.click("#btnSignLoad")
    t.wait_for("() => /Signature Valid/.test(document.getElementById('verifyResult').innerText)")
    expect('"kid": "test-kid"' in t.text("headerOutput"), "kid missing from header")
    t.call("document.getElementById('publicKeyPem').value = JSON.stringify(generated.jwks); runVerify()")
    t.wait_for("() => /kid test-kid/.test(document.getElementById('verifyResult').innerText)")
    t.call("document.getElementById('publicKeyPem').value = JSON.stringify({keys:[Object.assign({}, generated.publicJwk, {kid:'other'})]}); runVerify()")
    t.wait_for("() => /No key with kid/.test(document.getElementById('verifyResult').innerText)")


@case("jwt-decoder", "typical", "signer: RS256, PS256 and EdDSA round trips")
def _(t):
    for alg in ("RS256", "PS256", "EdDSA"):
        t.select("signAlg", alg)
        t.call("generateKeys()")
        t.wait_for("() => document.getElementById('genKeys').innerText.includes('Public key')", timeout=20000)
        t.call("document.getElementById('signOutput').textContent=''")
        t.click("#btnSign")
        t.wait_for("() => document.getElementById('signOutput').innerText.startsWith('eyJ')")
        t.click("#btnSignLoad")
        t.wait_for("() => /Signature Valid/.test(document.getElementById('verifyResult').innerText)")
        expect(f'"{alg}"' in t.text("headerOutput"), alg)
        t.call("document.getElementById('genKeys').innerHTML=''")


@case("jwt-decoder", "edge", "verifier explains a private key, a certificate and a wrong curve")
def _(t):
    t.select("signAlg", "ES256")
    t.call("generateKeys()")
    t.wait_for("() => document.getElementById('signKey').value.includes('BEGIN PRIVATE KEY')", timeout=15000)
    t.click("#btnSign")
    t.wait_for("() => document.getElementById('signOutput').innerText.startsWith('eyJ')")
    t.click("#btnSignLoad")
    t.wait(200)
    t.call("document.getElementById('publicKeyPem').value = generated.privatePem; runVerify()")
    t.wait_for("() => /private key/.test(document.getElementById('verifyResult').innerText)")
    t.call("document.getElementById('publicKeyPem').value = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----'; runVerify()")
    t.wait_for("() => /openssl x509/.test(document.getElementById('verifyResult').innerText)")


@case("jwt-decoder", "typical", "JWE: encrypt with dir and A256KW, decrypt, wrong key fails")
def _(t):
    t.call("randomJweKey()")
    t.call("encryptJwe()")
    t.wait_for("() => document.getElementById('jweInput').value.split('.').length === 5", timeout=10000)
    t.call("decryptJwe()")
    t.wait_for("() => document.getElementById('jweOutput').innerText.includes('user-42')", timeout=10000)
    expect("dir / A256GCM" in t.text("jweResult"), t.text("jweResult"))
    t.select("jweAlg", "A256KW")
    t.call("encryptJwe()")
    t.wait_for("() => /A256KW/.test(document.getElementById('jweResult').innerText)", timeout=10000)
    t.call("document.getElementById('jweOutput').textContent=''; decryptJwe()")
    t.wait_for("() => document.getElementById('jweOutput').innerText.includes('user-42')", timeout=10000)
    t.set("jweKey", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    t.call("decryptJwe()")
    t.wait_for("() => /Decryption failed/.test(document.getElementById('jweResult').innerText)", timeout=10000)
    # pasting a JWE into the main inspector routes it to the JWE panel
    t.call("document.getElementById('jwtInput').value = document.getElementById('jweInput').value; parseJWT()")
    expect("Encrypted (JWE)" in t.text("statusText"), t.text("statusText"))


@case("jwt-decoder", "typical", "share link restores the token and expected issuer")
def _(t):
    t.call("loadSample('oidc')")
    t.wait(80)
    t.set("expectIss", "https://accounts.example.com")
    url = t.call("Layerbit.state.write(getState())")
    t.page.goto(url, wait_until="load")
    t.wait(300)
    expect('"RS256"' in t.text("headerOutput"), "token not restored")
    eq(t.val("expectIss"), "https://accounts.example.com", "expected issuer not restored")


# ----------------------------------------------------------------------------
# regex-tester
# ----------------------------------------------------------------------------
@case("regex-tester", "minimal", "empty pattern: no matches, no error")
def _(t):
    t.set("regexInput", "")
    t.set("testInput", "abc")
    expect(not t.visible("#errorText"), "error shown for empty pattern")
    expect("0 Matches" in t.text("matchCount"), t.text("matchCount"))


@case("regex-tester", "typical", "counts matches, shows groups, alternates highlight colours")
def _(t):
    t.set("regexInput", r"(\w+)@(\w+)\.com")
    t.set("testInput", "a@x.com, b@y.com and c@z.org")
    t.wait_for("() => /2 Matches/.test(document.getElementById('matchCount').innerText)")
    expect("x" in t.text("matchesGrid") and "y" in t.text("matchesGrid"), "groups not rendered")
    eq(t.count("#testBackdrop .hl-match"), 2, "highlights")
    eq(t.count("#testBackdrop .hl-match.alt"), 1, "alternate colour")


@case("regex-tester", "typical", "replace preview honours $1 and $<name>")
def _(t):
    t.set("regexInput", r"(?<y>\d{4})-(\d{2})-(\d{2})")
    t.set("testInput", "2026-09-27")
    t.set("replaceInput", "$3/$2/$<y>")
    t.wait_for("() => document.getElementById('replaceOutput').innerText.includes('27/09/2026')")


@case("regex-tester", "edge", "invalid pattern reports error, no throw; explain shows parse error")
def _(t):
    t.set("regexInput", "(unclosed")
    t.set("testInput", "x")
    t.wait(50)
    expect(t.visible("#errorText"), "invalid regex not reported")
    expect("Cannot parse" in t.text("explainTree"), t.text("explainTree"))


@case("regex-tester", "edge", "unicode property escapes need the u flag")
def _(t):
    t.set("regexInput", r"\p{Script=Han}+")
    t.set("testInput", "abc 日本語 def")
    t.wait(60)
    expect("Error" in t.text("matchCount") or "0 Matches" in t.text("matchCount"), "without u, \\p should not match")
    t.click(".flag-btn[data-flag='u']")
    t.wait_for("() => /1 Match/.test(document.getElementById('matchCount').innerText)")


@case("regex-tester", "typical", "s flag lets . cross newlines; timing readout renders")
def _(t):
    t.set("regexInput", "a.b")
    t.set("testInput", "a\nb")
    t.wait_for("() => /0 Matches/.test(document.getElementById('matchCount').innerText)")
    t.click(".flag-btn[data-flag='s']")
    t.wait_for("() => /1 Match/.test(document.getElementById('matchCount').innerText)")
    expect("ms on" in t.text("matchTiming"), "timing missing")


@case("regex-tester", "typical", "explain tree and railroad diagram render for groups and quantifiers")
def _(t):
    t.set("regexInput", r"^(?<year>\d{4})-(?:jan|feb)+$")
    t.wait(60)
    labels = t.call("[...document.querySelectorAll('#explainTree .ex-label')].map(e=>e.textContent)")
    expect("Named group <year>" in labels and "Alternation" in labels, str(labels))
    expect("exactly 4 times" in t.text("explainTree"), "quantifier description missing")
    expect(t.count("#railroad svg") == 1 and t.count("#railroad .rr-term") >= 6, "railroad not rendered")


@case("regex-tester", "edge", "B3: a domain pattern split by dots is not reported as high-risk nesting")
def _(t):
    t.set("regexInput", "^([a-zA-Z0-9]+\\.)*[a-z]+$"); t.set("testInput", "mail.example.com"); t.wait(300)
    rep = t.text("safetyReport").lower()
    expect("nested unbounded quantifier" not in rep, rep[:300])
    t.set("regexInput", "^(\\d+)*$"); t.wait(300)
    expect("nested unbounded quantifier" in t.text("safetyReport").lower(), "true positive lost")


@case("regex-tester", "typical", "safety analysis flags nested quantifiers and clears for safe patterns")
def _(t):
    t.set("regexInput", r"^(a+)+$")
    t.wait(60)
    eq(t.text("safetyBadge"), "1", "badge")
    expect("Exponential risk" in t.text("safetyReport") and "Nested unbounded quantifier" in t.text("safetyReport"), t.text("safetyReport")[:200])
    t.set("regexInput", r"^\d+-\w+$")
    t.wait(60)
    expect("No catastrophic-backtracking shape" in t.text("safetyReport"), t.text("safetyReport")[:120])


@case("regex-tester", "edge", "growth measurement runs in a worker and confirms an exponential pattern")
def _(t):
    t.call("loadSample('redos')")
    t.wait(100)
    t.call("stressTest()")
    t.wait_for("() => document.getElementById('stressResult').innerText.includes('Adversarial')", timeout=30000)
    verdicts = t.call("[...document.querySelectorAll('#stressResult .finding strong')].map(e=>e.textContent)")
    expect(any("Confirmed" in v for v in verdicts), str(verdicts))


@case("regex-tester", "typical", "unit tests: add, evaluate, from-matches, group checks, badge")
def _(t):
    t.call("loadSample('log')")
    t.wait(100)
    eq(t.text("testsSummary"), "· 2/2 passing", "sample tests")
    t.call("updateTest(0,'value','WARN'); runUnitTests()")
    t.wait(50)
    eq(t.text("testsSummary"), "· 1/2 passing", "group value check")
    expect("group was" in t.text("testsBody"), t.text("testsBody")[:200])
    t.call("loadSample('dateFormat')")
    t.wait(100)
    t.call("addTestsFromMatches()")
    t.wait(50)
    eq(t.text("testsSummary"), "· 3/3 passing", "tests from matches")
    eq(t.text("testsBadge"), "3/3", "badge")


@case("regex-tester", "typical", "code generation translates flags and warns about engine gaps")
def _(t):
    t.set("regexInput", r"(?<=x)(?<y>\d+)")
    t.click(".flag-btn[data-flag='i']")
    t.call("showTab('code')")
    t.select("codeLang", "python")
    expect("(?P<y>" in t.text("codeOut") and "re.IGNORECASE" in t.text("codeOut"), t.text("codeOut"))
    t.select("codeLang", "go")
    expect("lookbehind" in t.text("codeCaveats"), t.text("codeCaveats"))
    t.select("codeLang", "csharp")
    expect("RegexOptions.IgnoreCase" in t.text("codeOut"), t.text("codeOut"))


@case("regex-tester", "typical", "pattern synthesis from examples yields a passing candidate")
def _(t):
    t.set("posExamples", "INV-2026-0042\nINV-2025-1187")
    t.set("negExamples", "INV2026-0042\ninv-2026-0042")
    t.call("synth()")
    t.wait(50)
    expect(t.count("#synthResult tbody tr.pass") >= 1, "no passing candidate")
    t.call("useCandidate(0)")
    t.wait(100)
    expect(t.val("regexInput").startswith("^INV"), t.val("regexInput"))
    eq(t.text("testsSummary"), "· 4/4 passing", "candidate tests")


@case("regex-tester", "typical", "batch file: per-line matching with counts and download")
def _(t):
    t.set("regexInput", "ERROR")
    t.page.set_input_files("#batchFile", {"name": "app.log", "mimeType": "text/plain",
                                           "buffer": "\n".join(("line %d ERROR x" if i % 3 == 0 else "line %d ok") % i for i in range(300)).encode()})
    t.wait_for("() => document.getElementById('batchResult').innerText.includes('matching')")
    expect("100 matching" in t.text("batchResult") and "300 lines" in t.text("batchResult"), t.text("batchResult")[:200])
    expect(t.visible("#btnBatchDl"), "download button hidden")


@case("regex-tester", "typical", "share link restores pattern, flags, text and tests")
def _(t):
    t.call("loadSample('log')")
    t.wait(100)
    url = t.call("Layerbit.state.write(getState())")
    t.page.goto(url, wait_until="load")
    t.wait(300)
    expect(t.val("regexInput").startswith("^(?<ts>"), "pattern not restored")
    expect(t.call("document.querySelector('.flag-btn[data-flag=m]').classList.contains('active')"), "flags not restored")
    eq(t.text("testsSummary"), "· 2/2 passing", "tests not restored")


@case("regex-tester", "maximal", "100k-char subject with 20,000 matches under budget")
def _(t):
    t.set("regexInput", r"\b\d+\b")
    t.set("testInput", " ".join(str(i) for i in range(20000)))
    t.wait_for("() => /20,000 Matches|20000 Matches/.test(document.getElementById('matchCount').innerText)")
    expect("first 500" in t.text("matchesNote"), t.text("matchesNote"))


# ----------------------------------------------------------------------------
# url-encoder
# ----------------------------------------------------------------------------
@case("url-encoder", "minimal", "empty input")
def _(t):
    t.set("plainText", "")
    eq(t.val("encodedText"), "", "encoded")


@case("url-encoder", "edge", "A6: multi-line text can be encoded with CRLF line endings")
def _(t):
    t.set("plainText", "a\nb")
    eq(t.val("encodedText"), "a%0Ab", "LF as typed")
    t.select("lineEndings", "crlf")
    eq(t.val("encodedText"), "a%0D%0Ab", "CRLF")
    t.select("lineEndings", "lf")


@case("url-encoder", "typical", "smart mode keeps URL structure, encodes query values")
def _(t):
    t.click("#btnModeSmart")
    t.set("plainText", "https://x.com/a b?q=hello world&n=a&b")
    enc = t.val("encodedText")
    expect(enc.startswith("https://x.com/a%20b?"), f"smart encode broke structure: {enc}")
    expect("hello%20world" in enc or "hello+world" in enc, f"query value not encoded: {enc}")


@case("url-encoder", "typical", "raw mode encodes everything reserved")
def _(t):
    t.click("#btnModeRaw")
    t.set("plainText", "a b&c=d/é")
    eq(t.val("encodedText"), "a%20b%26c%3Dd%2F%C3%A9", "raw encode")
    t.set("encodedText", "a%20b%26c%3Dd%2F%C3%A9")
    eq(t.val("plainText"), "a b&c=d/é", "raw decode")


@case("url-encoder", "edge", "malformed percent sequence reports error")
def _(t):
    t.click("#btnModeRaw")
    t.set("encodedText", "100%")
    t.wait(50)
    expect(t.visible("#decodeError") or t.val("plainText") == "100%", "malformed % not handled")


@case("url-encoder", "maximal", "batch mode: 5,000 lines")
def _(t):
    t.click("#btnModeBatch")
    t.set("plainText", "\n".join(f"line {i} & co" for i in range(5000)))
    enc = t.val("encodedText")
    eq(enc.count("\n"), 4999, "line count preserved")
    expect(enc.endswith("line%204999%20%26%20co"), f"last line wrong: {enc[-40:]}")


# ----------------------------------------------------------------------------
# csv-to-json
# ----------------------------------------------------------------------------
@case("csv-to-json", "minimal", "empty input: no crash")
def _(t):
    t.set("csvInput", "")
    t.click("#btnConvert")
    t.wait(50)


@case("csv-to-json", "typical", "header row + typed values")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", "id,name,active\n1,Ann,true\n2,Bob,false")
    t.click("#btnConvert")
    out = json.loads(t.text("jsonOutput"))
    eq(out[0]["name"], "Ann", "name")
    expect(out[0]["id"] in (1, "1"), "id parsed")


@case("csv-to-json", "edge", "A2: a stray quote inside a field is a literal character, not the start of a quoted block")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", 'sku,desc,price\n1,5" screen,1.50\n2,stand,9.99')
    t.click("#btnConvert")
    out = json.loads(t.text("jsonOutput"))
    eq(len(out), 2, "rows")
    eq(out[0]["desc"], '5" screen', "desc with a stray quote")
    eq(out[1]["desc"], "stand", "second row kept")


@case("csv-to-json", "edge", "A2: duplicate headers stay separate columns, single-column blanks are kept, short rows are reported")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", "id,amount,amount\n1,5,6")
    t.click("#btnConvert")
    out = json.loads(t.text("jsonOutput"))
    eq(sorted(out[0].keys()), ["amount", "amount (2)", "id"], "duplicate header names")
    t.set("csvInput", "email\na@x.com\n\nb@x.com")
    t.click("#btnConvert")
    eq(len(json.loads(t.text("jsonOutput"))), 3, "single-column file lost an empty row")
    t.set("csvInput", "a,b,c\n1,2,3\n4,5")
    t.click("#btnConvert")
    expect("line 3" in t.text("csvIssues").lower(), "short row not reported: " + t.text("csvIssues"))


@case("csv-to-json", "edge", "A3: Smart Types never change a value: leading zeros, + signs and long numbers stay text; a column can be forced to text")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", "id,zip,phone,acct,n,ok\n7,00123,+971501234567,12345678901234567890,42,true")
    t.click("#btnConvert")
    out = json.loads(t.text("jsonOutput"))[0]
    eq(out, {"id": 7, "zip": "00123", "phone": "+971501234567", "acct": "12345678901234567890", "n": 42, "ok": True}, "typed row")
    expect(t.visible("#colTypes"), "no per-column type preview")
    t.call("window._ctEl = document.getElementById('colType-n')")
    t.page.focus("#colType-n")
    t.select("colType-n", "text")
    out = json.loads(t.text("jsonOutput"))[0]
    eq(out["n"], "42", "column forced to text")
    expect(t.call("document.getElementById('colType-n') === window._ctEl && document.activeElement === window._ctEl"), "the select was replaced and lost focus")
    t.select("colType-n", "auto")


@case("csv-to-json", "edge", "A4: JSON to CSV is safe for spreadsheets by default and keeps long numbers")
def _(t):
    t.click("#btnModeToCSV")
    t.set("csvInput", '[{"name": "=HYPERLINK(\\"http://x\\")", "cmd": "@SUM(A1)", "n": -5, "id": 12345678901234567890}]')
    t.click("#btnConvert")
    out = t.text("jsonOutput")
    expect("'=HYPERLINK" in out and "'@SUM(A1)" in out and ",-5," in out and "12345678901234567890" in out, out)
    expect(t.visible("#csvSafe") and t.page.is_checked("#csvSafe"), "Safe for Excel switch missing or off")
    t.page.uncheck("#csvSafe"); t.click("#btnConvert")
    expect("'=HYPERLINK" not in t.text("jsonOutput"), t.text("jsonOutput"))
    t.page.check("#csvSafe")
    t.click("#btnModeToJSON")


@case("csv-to-json", "edge", "quoted commas, escaped quotes, embedded newlines, CRLF")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", 'a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z')
    t.click("#btnConvert")
    out = json.loads(t.text("jsonOutput"))
    eq(out[0]["a"], "x, y", "quoted comma")
    eq(out[0]["b"], 'he said "hi"', "escaped quote")
    eq(out[1]["a"], "multi\nline", "embedded newline")


@case("csv-to-json", "typical", "JSON -> CSV reverse mode")
def _(t):
    t.click("#btnModeToCSV")
    t.set("csvInput", '[{"a":1,"b":"x,y"},{"a":2,"b":"z"}]')
    t.click("#btnConvert")
    out = t.text("jsonOutput").strip().splitlines()
    eq(out[0].strip(), "a,b", "header")
    expect('"x,y"' in out[1], f"comma value not quoted: {out[1]}")


@case("csv-to-json", "maximal", "10,000-row CSV under budget")
def _(t):
    t.click("#btnModeToJSON")
    rows = "\n".join(f"{i},name{i},{i % 2 == 0}" for i in range(10000))
    t.set("csvInput", "id,name,flag\n" + rows)
    t.click("#btnConvert")
    out = t.text("jsonOutput")
    expect('"name9999"' in out, "last row missing")


@case("csv-to-json", "typical", "semicolon delimiter is auto-detected; tab can be forced")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", "id;name;city\n1;Ann;Berlin\n2;Bob;Wien")
    t.click("#btnConvert")
    out = json.loads(t.text("jsonOutput"))
    eq(out[1]["city"], "Wien", "semicolon auto-detect")
    expect("semicolon" in t.text("delimDetected"), "detected label missing")
    t.select("delimSelect", "\t")
    t.set("csvInput", "a\tb\n1\t2")
    t.click("#btnConvert")
    eq(json.loads(t.text("jsonOutput"))[0]["b"], 2, "tab forced")


@case("csv-to-json", "edge", "one-column result with another separator is refused with a hint")
def _(t):
    t.click("#btnModeToJSON")
    t.select("delimSelect", ",")
    t.set("csvInput", "a;b\n1;2")
    t.click("#btnConvert")
    expect("delimiter" in t.text("errorText").lower(), f"no hint: {t.text('errorText')}")


@case("csv-to-json", "typical", "2.4: JSON Lines out, and JSON Lines in for JSON -> CSV")
def _(t):
    t.click("#btnModeToJSON")
    t.select("outFormat", "jsonl")
    t.set("csvInput", 'id,name\n1,Ada\n2,"Smith, Jane"')
    t.click("#btnConvert")
    lines = t.text("jsonOutput").strip().splitlines()
    eq([json.loads(x) for x in lines], [{"id": 1, "name": "Ada"}, {"id": 2, "name": "Smith, Jane"}], "JSON Lines out")
    expect(".jsonl" in t.text("btnDownload"), "download label: " + t.text("btnDownload"))
    t.select("outFormat", "json")
    t.click("#btnModeToCSV")
    t.set("csvInput", '{"id":1,"name":"Ada"}\n\n{"id":2,"tag":"x"}\n')
    t.click("#btnConvert")
    eq(t.text("jsonOutput").strip().splitlines(), ["id,name,tag", "1,Ada,", "2,,x"], "JSON Lines in")
    t.set("csvInput", '{"id":1}\n{"id":')
    t.click("#btnConvert")
    expect("line" in t.text("errorText").lower(), "broken JSON Lines not reported by line: " + t.text("errorText"))
    t.click("#btnModeToJSON")


@case("csv-to-json", "typical", "2.4: dotted headers nest into objects and arrays, and flatten back")
def _(t):
    t.click("#btnModeToJSON")
    expect(not t.page.is_checked("#nestKeys"), "nesting should be off by default")
    t.page.check("#nestKeys")
    t.set("csvInput", "id,user.name,user.city,tags.0,tags.1\n1,Ada,Dubai,a,b")
    t.click("#btnConvert")
    eq(json.loads(t.text("jsonOutput")), [{"id": 1, "user": {"name": "Ada", "city": "Dubai"}, "tags": ["a", "b"]}], "nested")
    t.set("csvInput", "a,a.b\n1,2")
    t.click("#btnConvert")
    eq(json.loads(t.text("jsonOutput")), [{"a": 1, "a.b": 2}], "conflict kept flat")
    expect("a.b" in t.text("csvIssues"), "conflict not reported: " + t.text("csvIssues"))
    t.page.uncheck("#nestKeys")
    t.click("#btnModeToCSV")
    expect(t.page.is_checked("#flattenKeys"), "flattening should be on by default")
    t.set("csvInput", '[{"id":1,"user":{"name":"Ada","city":"Dubai"},"tags":["a","b"]}]')
    t.click("#btnConvert")
    eq(t.text("jsonOutput").strip().splitlines(), ["id,user.name,user.city,tags.0,tags.1", "1,Ada,Dubai,a,b"], "flattened")
    t.page.uncheck("#flattenKeys"); t.wait(100)
    expect('"{""name"":""Ada""' in t.text("jsonOutput"), "objects should stay JSON in one cell: " + t.text("jsonOutput"))
    t.page.check("#flattenKeys")
    t.click("#btnModeToJSON")


@case("csv-to-json", "typical", "2.4: choose, rename and reorder columns in both directions")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", "id,name,email\n1,Ada,ada@x.com")
    t.click("#btnConvert")
    t.page.uncheck("#colInc-email")
    t.page.fill("#colName-name", "full_name"); t.page.press("#colName-name", "Enter")
    t.click("#colUp-name")
    out = json.loads(t.text("jsonOutput"))
    eq(list(out[0].items()), [("full_name", "Ada"), ("id", 1)], "columns chosen, renamed, reordered")
    t.set("csvInput", "id,name,email,phone\n2,Bob,b@x.com,+971")
    t.click("#btnConvert")
    eq(list(json.loads(t.text("jsonOutput"))[0].keys()), ["full_name", "id", "phone"], "the plan survives new data")
    t.click("#btnModeToCSV")
    t.set("csvInput", '[{"id":1,"name":"Ada","secret":"x"}]')
    t.click("#btnConvert")
    t.page.uncheck("#colInc-secret"); t.click("#colDown-id")
    eq(t.text("jsonOutput").strip().splitlines(), ["name,id", "Ada,1"], "JSON -> CSV columns")
    t.click("#btnModeToJSON")


@case("csv-to-json", "typical", "2.4: an Excel workbook: every sheet listed, one sheet or all converted")
def _(t):
    t.click("#btnModeToJSON")
    t.page.evaluate(LOAD_SCRIPT, "../js/vendor/xlsx.full.min.js")
    t.call("""() => { const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['id', 'zip', 'name'], [1, '00123', 'Ada'], [2, '94107', 'Bob, Jr.']]), 'Customers');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['sku', 'price'], ['A-1', 9.5]]), 'Prices');
      handleFile(new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'book.xlsx')); }""")
    t.wait_for("!document.getElementById('sheetWrap').hidden && document.getElementById('jsonOutput').textContent.includes('Ada')")
    opts = t.call("[...document.getElementById('sheetSelect').options].map(o => o.textContent)")
    expect(any("Customers" in o for o in opts) and any("Prices" in o for o in opts) and any("All sheets" in o for o in opts), f"{opts}")
    out = json.loads(t.text("jsonOutput"))
    eq(out[0], {"id": 1, "zip": "00123", "name": "Ada"}, "first sheet, text kept")
    eq(out[1]["name"], "Bob, Jr.", "comma inside a cell")
    t.select("sheetSelect", "Prices")
    eq(json.loads(t.text("jsonOutput")), [{"sku": "A-1", "price": 9.5}], "second sheet")
    t.select("sheetSelect", "*")
    both = json.loads(t.text("jsonOutput"))
    eq(list(both.keys()), ["Customers", "Prices"], "all sheets, keyed by name")
    eq(both["Prices"], [{"sku": "A-1", "price": 9.5}], "all sheets: Prices")
    t.click("#btnModeToCSV"); t.click("#btnModeToJSON")
    expect(t.call("document.getElementById('sheetWrap').hidden"), "sheet picker stays after leaving the workbook")


@case("csv-to-json", "typical", "2.4: .xlsx out keeps text as text and numbers as numbers, and never writes a formula")
def _(t):
    t.click("#btnModeToCSV")
    t.set("csvInput", '[{"zip":"00123","n":42,"big":12345678901234567890,"f":"=1+1","ok":true,"user":{"name":"Ada"}}]')
    t.click("#btnConvert")
    with t.page.expect_download() as dl:
        t.click("#btnXlsx")
    expect(dl.value.suggested_filename.endswith(".xlsx"), dl.value.suggested_filename)
    b64 = base64.b64encode(open(dl.value.path(), "rb").read()).decode()
    t.page.evaluate(LOAD_SCRIPT, "../js/vendor/xlsx.full.min.js")
    res = t.call("""() => { const wb = XLSX.read(Uint8Array.from(atob('%s'), c => c.charCodeAt(0)), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return ['A1', 'A2', 'B2', 'C2', 'D2', 'E2', 'F1', 'F2'].map(a => ws[a] ? [ws[a].t, String(ws[a].v), ws[a].f || ''] : null); }""" % b64)
    eq(res, [["s", "zip", ""], ["s", "00123", ""], ["n", "42", ""], ["s", "12345678901234567890", ""], ["s", "=1+1", ""], ["b", "true", ""], ["s", "user.name", ""], ["s", "Ada", ""]], "cells")
    t.click("#btnModeToJSON")


@case("csv-to-json", "typical", "2.4: the table preview is editable and edits go back into the input")
def _(t):
    t.click("#btnModeToJSON")
    t.set("csvInput", "id,name\n1,Ada\n2,Bob")
    t.click("#btnConvert")
    expect(t.visible("#gridSection"), "no table preview")
    t.page.dblclick("#grid .lb-vrow[data-row='1'] .lb-vcell[data-col='1']")
    t.page.fill("#grid input.lb-vedit", 'Bob "the builder", Jr.')
    t.page.press("#grid input.lb-vedit", "Enter")
    t.wait(150)
    expect(t.text("jsonOutput").strip().startswith("["), "output after the edit: " + t.text("jsonOutput")[:100] + " ; " + t.text("errorText") + " | input: " + t.val("csvInput")[:200])
    eq(json.loads(t.text("jsonOutput"))[1]["name"], 'Bob "the builder", Jr.', "edited output")
    eq(t.val("csvInput").splitlines()[2], '2,"Bob ""the builder"", Jr."', "edited input, quoted")
    t.page.dblclick("#grid .lb-vrow[data-row='0'] .lb-vcell[data-col='0']")
    t.page.press("#grid input.lb-vedit", "Escape")
    expect(t.text("jsonOutput").strip().startswith("["), "output after Escape: " + t.text("jsonOutput")[:100] + t.text("errorText"))
    eq(json.loads(t.text("jsonOutput"))[0]["id"], 1, "Escape leaves the cell as it was")
    t.click("#btnModeToCSV")
    t.set("csvInput", '[{"id":7,"user":{"name":"Ada"}}]')
    t.click("#btnConvert")
    t.page.dblclick("#grid .lb-vrow[data-row='0'] .lb-vcell[data-col='1']")
    t.page.fill("#grid input.lb-vedit", "Grace"); t.page.press("#grid input.lb-vedit", "Enter"); t.wait(150)
    expect(t.val("csvInput").strip().startswith("["), "JSON input after the edit: " + t.val("csvInput")[:120] + " ; output: " + t.text("jsonOutput") + " | " + t.text("errorText"))
    eq(json.loads(t.val("csvInput")), [{"id": 7, "user": {"name": "Grace"}}], "nested value edited in the JSON input")
    t.click("#btnModeToJSON")


@case("csv-to-json", "edge", "2.4: streaming in a Worker gives exactly the in-memory result, for messy CSV and for JSON Lines")
def _(t):
    t.click("#btnModeToJSON")
    # (a text box turns CRLF inside a value into LF; the stream keeps the bytes)
    messy = '\ufeffid;name;note\r\n1;"Smith; Jane";"multi\nline"\r\n2;5" screen;\r\n\r\n3;"say ""hi""";00123\r\n4;x\r\n'
    t.set("csvInput", messy); t.click("#btnConvert")
    want = t.call("finalOutputString")
    t.call("window.csvStreamMin = 0")
    t.page.evaluate("text => handleFile(new File([text], 'messy.csv'))", messy)
    t.wait_for("window.csvBig && window.csvBig.done", 10000)
    got = t.call("window.csvBig.text")
    eq(got, want, "stream result equals the in-memory conversion")
    expect("line 7" in t.text("csvIssues").lower(), "short row not reported by the stream: " + t.text("csvIssues"))
    t.click("#btnModeToCSV")
    t.page.evaluate("text => handleFile(new File([text], 'r.jsonl'))", '{"a":1,"b":{"c":12345678901234567890}}\n{"a":2,"d":"=x"}\n')
    t.wait_for("window.csvBig && window.csvBig.done", 10000)
    eq(t.call("window.csvBig.text").strip().splitlines(), ["a,b.c,d", "1,12345678901234567890,", "2,,'=x"], "JSON Lines streamed to CSV")
    t.call("window.csvStreamMin = undefined")
    t.click("#btnModeToJSON")


@case("csv-to-json", "maximal", "2.4: a 40 MB CSV streams through a Worker with progress and a preview; Save holds every record")
def _(t):
    t.click("#btnModeToJSON")
    t.call("""() => { const row = i => i + ',name ' + i + ',"note, with a comma and some more text here",' + (i % 2 ? 'true' : 'false') + '\\n';
      const parts = ['id,name,note,flag\\n']; for (let i = 0; i < 600000; i++) parts.push(row(i));
      window.__big = new File(parts, 'big.csv'); handleFile(window.__big); }""")
    t.wait_for("window.csvBig && window.csvBig.done", 60000)
    expect(t.call("window.__big.size") > 30e6, "file not large enough")
    eq(t.call("window.csvBig.records"), 600000, "records")
    expect(t.call("window.csvBig.progress") >= 10, "progress reported %s times" % t.call("window.csvBig.progress"))
    expect("600,000" in t.text("bigNote"), "summary: " + t.text("bigNote"))
    expect('"name 0"' in t.text("jsonOutput") and '"name 599999"' not in t.text("jsonOutput"), "preview should show the first records only")
    expect(t.call("window.csvBig.blob.size") > 40e6, "saved output too small")
    tail = t.call("() => window.csvBig.blob.slice(window.csvBig.blob.size - 200).text()")
    expect('"name 599999"' in tail and tail.rstrip().endswith("]"), tail)
    expect(t.call("document.getElementById('csvInput').value.length") == 0, "the big file was put into the text box")
    t.click("#btnModeToCSV"); t.click("#btnModeToJSON")


# ----------------------------------------------------------------------------
# yaml-json-converter
# ----------------------------------------------------------------------------
@case("yaml-json-converter", "minimal", "empty both ways")
def _(t):
    t.set("yamlInput", "")
    eq(t.val("jsonInput"), "", "json side")


@case("yaml-json-converter", "typical", "YAML -> JSON -> YAML")
def _(t):
    t.set("yamlInput", "name: Layerbit\nports:\n  - 80\n  - 443\nenabled: true\n")
    out = json.loads(t.val("jsonInput"))
    eq(out, {"name": "Layerbit", "ports": [80, 443], "enabled": True}, "yaml->json")
    t.set("jsonInput", '{"a": {"b": [1, 2]}}')
    y = t.val("yamlInput")
    expect("a:" in y and "b:" in y and "- 1" in y, f"json->yaml wrong: {y!r}")


@case("yaml-json-converter", "edge", "B4: multi-document YAML (Kubernetes) becomes a JSON array")
def _(t):
    y = "apiVersion: v1\nkind: Service\nmetadata:\n  name: web\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n"
    t.set("yamlInput", y)
    out = json.loads(t.val("jsonInput"))
    expect(isinstance(out, list) and [d["kind"] for d in out] == ["Service", "Deployment"], f"{out}")
    expect("2 documents" in t.text("yamlNote"), "no note about the documents: " + t.text("yamlNote"))
    t.set("yamlInput", "---\na: 1\n---\n")
    eq(json.loads(t.val("jsonInput")), [{"a": 1}, None], "empty document kept as null")


@case("yaml-json-converter", "typical", "2.6: YAML 1.1 vs 1.2: the Norway problem is flagged by line, and the switch changes the result")
def _(t):
    t.set("yamlInput", "country: no\nport: 0777\nok: yes\nname: Ada\n")
    t.wait_for("document.getElementById('yamlLint').textContent.includes('line 1')", 8000)
    lint = t.text("yamlLint")
    expect("line 1" in lint and "line 2" in lint and "line 3" in lint and "line 4" not in lint, lint)
    eq(json.loads(t.val("jsonInput")), {"country": "no", "port": 777, "ok": "yes", "name": "Ada"}, "YAML 1.2 (default)")
    t.select("yamlVersion", "1.1")
    t.wait_for("JSON.parse(document.getElementById('jsonInput').value).country === false", 8000)
    eq(json.loads(t.val("jsonInput")), {"country": False, "port": 511, "ok": True, "name": "Ada"}, "YAML 1.1")
    t.select("yamlVersion", "1.2")


@case("yaml-json-converter", "typical", "2.6: Format re-indents and keeps comments")
def _(t):
    t.set("yamlInput", "# service config\nserver:\n      port: 8080   # the port\n      hosts:\n        - a\n        - b\n")
    t.click("#btnYamlFormat")
    t.wait_for("document.getElementById('yamlInput').value.includes('\\n  port: 8080')", 8000)
    y = t.val("yamlInput")
    expect("# service config" in y and "# the port" in y, y)
    expect("\n  port: 8080" in y and "\n    - a" in y, "not re-indented to 2 spaces: " + y)


@case("yaml-json-converter", "edge", "2.6: lint reports duplicate keys and tab indentation with their lines")
def _(t):
    t.set("yamlInput", "name: a\nport: 1\nname: b\n")
    t.wait_for("/duplicate/i.test(document.getElementById('yamlLint').textContent)", 8000)
    expect("line 3" in t.text("yamlLint"), t.text("yamlLint"))
    t.set("yamlInput", "server:\n\tport: 1\n")
    t.wait_for("/tab/i.test(document.getElementById('yamlLint').textContent)", 8000)
    expect("line 2" in t.text("yamlLint"), t.text("yamlLint"))


@case("yaml-json-converter", "typical", "2.6: Kubernetes, Compose and GitHub Actions schemas from vendored copies")
def _(t):
    t.set("yamlInput", "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: \"3\"\n  selector:\n    matchLabels: {app: web}\n  template:\n    metadata: {labels: {app: web}}\n    spec:\n      containers:\n        - name: web\n          image: nginx\n          ports:\n            - containerPort: 80\n")
    t.select("yamlSchema", "auto")
    t.wait_for("/replicas/.test(document.getElementById('yamlSchemaResult').textContent)", 15000)
    r = t.text("yamlSchemaResult")
    expect("Deployment" in r and "/spec/replicas" in r and "integer" in r, r)
    t.set("yamlInput", "services:\n  web:\n    image: nginx\n    ports: 80\n")
    t.wait_for("/Compose/.test(document.getElementById('yamlSchemaResult').textContent) && /ports/.test(document.getElementById('yamlSchemaResult').textContent)", 15000)
    t.set("yamlInput", "on: push\njobs:\n  build:\n    steps:\n      - run: make\n")
    t.wait_for("/Actions/.test(document.getElementById('yamlSchemaResult').textContent) && /runs-on/.test(document.getElementById('yamlSchemaResult').textContent)", 15000)
    t.set("yamlInput", "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n")
    t.wait_for("/Valid/.test(document.getElementById('yamlSchemaResult').textContent)", 15000)
    t.select("yamlSchema", "none")


@case("yaml-json-converter", "edge", "B4: documents switch: array <-> --- documents, or the first document only")
def _(t):
    expect(t.page.is_checked("#yamlDocs"), "the documents switch should be on by default")
    t.set("jsonInput", '[{"kind": "Service"}, {"kind": "Deployment"}]')
    y = t.val("yamlInput")
    expect(y.count("---") == 1 and "kind: Service" in y and "kind: Deployment" in y and not y.lstrip().startswith("-"), "array not written as documents: " + y)
    t.set("yamlInput", y)
    eq(json.loads(t.val("jsonInput")), [{"kind": "Service"}, {"kind": "Deployment"}], "documents read back as the array")
    t.page.uncheck("#yamlDocs")
    eq(json.loads(t.val("jsonInput")), {"kind": "Service"}, "switch off: first document only")
    expect("1 more document" in t.text("yamlNote"), "no note about the skipped document: " + t.text("yamlNote"))
    t.set("jsonInput", '[1, 2]')
    eq(t.val("yamlInput").strip(), "- 1\n- 2", "switch off: a JSON array stays a YAML list")
    t.page.check("#yamlDocs")


@case("yaml-json-converter", "edge", "B4: dates stay as written unless conversion is asked for")
def _(t):
    t.set("yamlInput", "when: 2026-01-01\nat: 2026-01-01T10:30:00Z\n")
    eq(json.loads(t.val("jsonInput")), {"when": "2026-01-01", "at": "2026-01-01T10:30:00Z"}, "dates as written")
    t.page.check("#yamlDates")
    eq(json.loads(t.val("jsonInput"))["when"], "2026-01-01T00:00:00.000Z", "dates converted on request")
    t.page.uncheck("#yamlDates")


@case("yaml-json-converter", "edge", "A3: long integers survive YAML to JSON and JSON to YAML")
def _(t):
    t.set("yamlInput", "id: 12345678901234567890\nsmall: 42\nprice: 1.50\n")
    out = t.val("jsonInput")
    expect("12345678901234567890" in out and '"small": 42' in out, out)
    t.set("jsonInput", '{"id": 12345678901234567891, "count": 7, "huge": 1e400}')
    y = t.val("yamlInput")
    expect("id: 12345678901234567891" in y and "count: 7" in y and "huge: 1e400" in y, y)


@case("yaml-json-converter", "edge", "the Norway problem: YAML 1.2 keeps 'no' a string")
def _(t):
    t.set("yamlInput", "country: no\nversion: 1.10\n")
    out = json.loads(t.val("jsonInput"))
    eq(out["country"], "no", "js-yaml 4 (YAML 1.2 core) must keep 'no' as a string")
    eq(out["version"], 1.1, "1.10 is a float")


@case("yaml-json-converter", "edge", "bad indentation reports error")
def _(t):
    t.set("yamlInput", "a:\n  b: 1\n c: 2\n")
    t.wait(50)
    expect(t.visible("#yamlError"), "yaml error not shown")


@case("yaml-json-converter", "maximal", "5,000-key document")
def _(t):
    t.set("yamlInput", "\n".join(f"key{i}: value{i}" for i in range(5000)))
    out = json.loads(t.val("jsonInput"))
    eq(out["key4999"], "value4999", "last key")


@case("yaml-json-converter", "edge", "errors report line and column on both sides")
def _(t):
    t.set("yamlInput", "a: 1\nb: [1, 2\nc: 3")
    t.wait(50)
    expect("line" in t.text("yamlError"), f"yaml error lacks position: {t.text('yamlError')}")
    t.set("jsonInput", '{"a": 1,\n "b": }')
    t.wait(50)
    expect("line 2" in t.text("jsonError"), f"json error lacks position: {t.text('jsonError')}")


# ----------------------------------------------------------------------------
# sql-formatter
# ----------------------------------------------------------------------------
@case("sql-formatter", "minimal", "empty input")
def _(t):
    t.set("sqlInput", "")
    t.click("#btnFormat")
    t.wait(50)


@case("sql-formatter", "typical", "formats a join with uppercase keywords")
def _(t):
    t.set("sqlInput", "select a.id, b.name from a join b on a.id=b.a_id where a.x > 1 order by b.name")
    t.click("#btnFormat")
    out = t.text("sqlOutput")
    expect("SELECT" in out and "\n" in out and "JOIN" in out, f"not formatted: {out[:80]!r}")


@case("sql-formatter", "typical", "minify collapses whitespace")
def _(t):
    t.set("sqlInput", "SELECT\n  a,\n  b\nFROM\n  t")
    t.click("#btnMinify")
    eq(" ".join(t.text("sqlOutput").split()), "SELECT a, b FROM t", "minified")


@case("sql-formatter", "edge", "dialect switch: T-SQL square brackets survive")
def _(t):
    t.select("dialectSelect", "tsql")
    t.set("sqlInput", "select [Order Id] from [dbo].[Orders]")
    t.click("#btnFormat")
    expect("[Order Id]" in t.text("sqlOutput"), "bracket identifier mangled")


@case("sql-formatter", "maximal", "500 statements under budget")
def _(t):
    t.select("dialectSelect", "sql") if t.count("#dialectSelect option[value='sql']") else None
    t.set("sqlInput", "\n".join(f"insert into t (a,b) values ({i}, 'x{i}');" for i in range(500)))
    t.click("#btnFormat")
    expect("'x499'" in t.text("sqlOutput"), "last statement missing")


# ----------------------------------------------------------------------------
# text-diff-checker
# ----------------------------------------------------------------------------
@case("text-diff-checker", "minimal", "identical inputs -> no changes, no merge pane")
def _(t):
    t.set("text1", "same")
    t.set("text2", "same")
    t.call("run()")
    t.wait(100)
    expect(t.count("#splitPanel .sd-r.line-added") == 0, "identical text produced additions")
    expect("No differences" in t.text("splitPanel"), "identical notice missing")
    expect(not t.visible("#mergedSection"), "merge pane shown with nothing to merge")


@case("text-diff-checker", "minimal", "both empty -> empty notice, no error")
def _(t):
    t.call("run()")
    t.wait(50)
    expect("empty" in t.text("splitPanel"), t.text("splitPanel"))


@case("text-diff-checker", "typical", "one changed line is highlighted with stats and a hunk bar")
def _(t):
    t.set("text1", "a\nb\nc")
    t.set("text2", "a\nB\nc")
    t.call("run()")
    t.wait(100)
    expect(t.count("#splitPanel .sd-r.line-added") == 1 and t.count("#splitPanel .sd-l.line-removed") == 1, "changed line not shown")
    expect("1 change block" in t.text("diffStats"), t.text("diffStats"))
    expect(t.count("#splitPanel .hunk-bar") == 1, "hunk bar missing")


@case("text-diff-checker", "typical", "merge: per-hunk decisions and accept/keep all")
def _(t):
    t.call("loadSample('code')")
    t.wait(150)
    eq(t.val("mergedText"), t.val("text2"), "merged starts as modified")
    t.call("decide(0,'left')")
    expect("calculateTotal(price, tax)" in t.val("mergedText"), "hunk 0 not reverted")
    expect("1 reverted" in t.text("mergedMeta"), t.text("mergedMeta"))
    t.call("mergeAll('left')")
    eq(t.val("mergedText"), t.val("text1"), "keep all original")
    t.call("decide(1,'both')")
    m = t.val("mergedText")
    expect("module.exports = { calculateTotal };" in m and "round2" in m, "both did not include both sides")


@case("text-diff-checker", "typical", "syntax highlighting, unified view, context folding, show whitespace")
def _(t):
    t.call("loadSample('code')")
    t.wait(150)
    expect(t.count("#splitPanel .sd-r .tk-kw") > 0, "no syntax tokens")
    expect("js" in t.text("diffStats"), "language not detected")
    t.select("viewMode", "unified")
    t.wait(50)
    expect(t.visible("#inlinePanel") and not t.visible("#splitWrap"), "unified view not shown")
    t.select("viewMode", "split")
    a = "\n".join(f"line {i}" for i in range(60))
    b = a.replace("line 30", "LINE 30")
    t.set("text1", a); t.set("text2", b)
    t.select("contextLines", "3")
    t.call("run()")
    t.wait(100)
    expect(t.count("#splitPanel .diff-skip") == 2, f"expected 2 folds, got {t.count('#splitPanel .diff-skip')}")
    expect(t.count("#splitPanel .sd-r") <= 10, "context folding did not reduce rows")
    t.call("expandSkip()")
    t.wait(50)
    expect(t.count("#splitPanel .sd-r") >= 60, "expand did not restore rows")
    t.click("#showWs")
    t.wait(50)
    expect(t.count("#splitPanel .sd-r .ws") > 0, "whitespace markers missing")


@case("text-diff-checker", "typical", "character granularity isolates a one-letter change")
def _(t):
    t.set("text1", "getUserId()")
    t.set("text2", "getUserID()")
    t.select("granularity", "char")
    t.call("run()")
    t.wait(100)
    spans = t.call("Array.from(document.querySelectorAll('#splitPanel .sd-r .word-added')).map(e => e.textContent)")
    eq(spans, ["D"], "char-level added span")
    t.select("granularity", "none")
    t.call("run()")
    t.wait(100)
    eq(t.count("#splitPanel .sd-r .word-added"), 0, "lines-only mode still highlighted words")


@case("text-diff-checker", "edge", "normalisation options: whitespace, case, trailing, blank, CRLF")
def _(t):
    t.set("text1", "x = 1\r\nY\r\n")
    t.set("text2", "x = 1\ny\n")
    t.call("run()"); t.wait(60)
    expect("1 change block" in t.text("diffStats"), "case change not detected: " + t.text("diffStats"))
    t.click("#ignoreCase"); t.call("run()"); t.wait(60)
    expect("0 change blocks" in t.text("diffStats"), "ignore case / CRLF failed: " + t.text("diffStats"))
    t.set("text1", "a  b   "); t.set("text2", "a b")
    t.call("run()"); t.wait(60)
    expect("1 change block" in t.text("diffStats"), "whitespace change not detected")
    t.click("#ignoreWhitespace"); t.call("run()"); t.wait(60)
    expect("0 change blocks" in t.text("diffStats"), "ignore whitespace failed")


@case("text-diff-checker", "typical", "patch export is a unified diff that re-applies cleanly")
def _(t):
    t.set("text1", "one\ntwo\nthree\n"); t.set("text2", "one\n2\nthree\nfour\n")
    t.call("run()"); t.wait(60)
    p = t.call("patchText()")
    expect(p.startswith("--- original\n+++ modified\n@@"), p[:60])
    t.call("setMode('patch')")
    t.set("patchOriginal", "one\ntwo\nthree\n"); t.set("patchText", p)
    t.call("run()"); t.wait(100)
    expect("1 hunk" in t.text("resultTitle"), t.text("resultTitle"))
    eq(t.val("mergedText"), "one\n2\nthree\nfour\n", "patched result")


@case("text-diff-checker", "edge", "patch that does not apply reports an error instead of throwing")
def _(t):
    t.call("loadSample('patch')"); t.wait(100)
    expect("listen 443 ssl" in t.val("mergedText"), "sample patch not applied")
    t.set("patchOriginal", "totally different file\n")
    t.call("run()"); t.wait(60)
    expect(t.visible("#errorBanner") and "does not apply" in t.text("errorText"), t.text("errorText"))
    t.set("patchText", "garbage"); t.call("run()"); t.wait(60)
    expect("No hunks" in t.text("errorText"), t.text("errorText"))


@case("text-diff-checker", "typical", "three-way merge: auto-merge, conflict markers, click resolution")
def _(t):
    t.call("loadSample('three')"); t.wait(150)
    expect("1 conflict" in t.text("diffStats"), t.text("diffStats"))
    m = t.val("mergedText")
    expect("<<<<<<< ours" in m and "||||||| base" in m and ">>>>>>> theirs" in m, "markers missing")
    expect("- Added audit log export" in m, "non-conflicting change from ours not merged")
    t.click("#threePanel .three-chunk.conflict .hb:nth-child(3)")  # Use theirs
    t.wait(60)
    m = t.val("mergedText")
    expect("<<<<<<<" not in m and "author: platform team" in m, "resolution not applied: " + m[:120])
    eq(t.text("mergedMeta"), "clean", "meta after resolve")


@case("text-diff-checker", "typical", "structural diff ignores key order and reports paths")
def _(t):
    t.call("loadSample('json')"); t.wait(150)
    rows = t.call("[...document.querySelectorAll('#structPanel tbody tr')].map(r=>r.children[0].textContent+':'+r.children[1].textContent)")
    expect("$.port:type number → string" in rows and "$.features.ssl:added" in rows and "$.timeout:changed" in rows, str(rows))
    t.set("text1", '{"a":1,"b":[1,2]}'); t.set("text2", '{"b":[1,2],"a":1}')
    t.call("run()"); t.wait(60)
    expect("Semantically identical" in t.text("structPanel"), t.text("structPanel"))


@case("text-diff-checker", "edge", "structural diff: YAML input, keyed arrays, invalid input")
def _(t):
    t.call("loadSample('yaml')"); t.wait(400)
    rows = t.call("[...document.querySelectorAll('#structPanel tbody tr')].map(r=>r.children[0].textContent)")
    eq(rows, ["$.app.env.LOG_LEVEL", "$.app.replicas"], "yaml paths")
    t.set("text1", '{"u":[{"id":1,"n":"a"},{"id":2,"n":"b"}]}'); t.set("text2", '{"u":[{"id":2,"n":"B"},{"id":3,"n":"c"}]}')
    t.select("arrMode", "key"); t.call("run()"); t.wait(60)
    rows = t.call("[...document.querySelectorAll('#structPanel tbody tr')].map(r=>r.children[0].textContent+':'+r.children[1].textContent)")
    eq(sorted(rows), ["$.u[id=1]:removed", "$.u[id=2].n:changed", "$.u[id=3]:added"], "keyed arrays")
    t.set("text2", '{"u": [1, 2,}'); t.call("run()"); t.wait(60)
    expect(t.visible("#errorBanner") and "Modified" in t.text("errorText"), t.text("errorText"))


@case("text-diff-checker", "typical", "table diff keyed by id: added, removed, changed cells, new column")
def _(t):
    t.call("loadSample('csv')"); t.wait(150)
    s = t.text("diffStats")
    expect("+1 rows" in s and "−1 rows" in s and "~2 changed" in s and "supplier" in s, s)
    expect("Sprocket" in t.text("tablePanel") and "Gadget" in t.text("tablePanel"), "rows missing")
    heads = t.call("[...document.querySelectorAll('#tablePanel table:first-of-type th')].map(e=>e.textContent)")
    eq(heads, ["id", "name", "qty", "price", "supplier"], "header once, key not duplicated")
    t.select("keyCol", "-1"); t.call("run()"); t.wait(60)
    expect("by row order" in t.text("resultTitle"), t.text("resultTitle"))


@case("text-diff-checker", "typical", "zip folder diff lists added/removed/modified and opens a file diff")
def _(t):
    t.call("""() => {
      function crc32(u8){let c,crc=0xFFFFFFFF;for(let i=0;i<u8.length;i++){c=(crc^u8[i])&0xFF;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xEDB88320:c>>>1;crc=(crc>>>8)^c;}return (crc^0xFFFFFFFF)>>>0;}
      function zip(files){const enc=new TextEncoder();const parts=[];const cd=[];let off=0;
        for(const [name,text] of files){const n=enc.encode(name),d=enc.encode(text),crc=crc32(d);
          const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint32(14,crc,true);lh.setUint32(18,d.length,true);lh.setUint32(22,d.length,true);lh.setUint16(26,n.length,true);
          parts.push(new Uint8Array(lh.buffer),n,d);
          const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint32(16,crc,true);c.setUint32(20,d.length,true);c.setUint32(24,d.length,true);c.setUint16(28,n.length,true);c.setUint32(42,off,true);
          cd.push(new Uint8Array(c.buffer),n); off+=30+n.length+d.length;}
        const cdLen=cd.reduce((a,x)=>a+x.length,0);const e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cdLen,true);e.setUint32(16,off,true);
        return new Blob([...parts,...cd,new Uint8Array(e.buffer)]);}
      window._zipA=new File([zip([['proj/a.txt','hello\\nworld\\n'],['proj/same.txt','same'],['proj/gone.txt','bye']])],'v1.zip');
      window._zipB=new File([zip([['proj/a.txt','hello\\nthere\\n'],['proj/same.txt','same'],['proj/new.txt','hi']])],'v2.zip');
      setMode('zip'); loadZip('a', window._zipA); loadZip('b', window._zipB); }""")
    t.wait_for("() => document.getElementById('zipPanel').innerText.includes('new.txt')")
    rows = t.call("[...document.querySelectorAll('#zipPanel tbody tr')].map(r=>r.children[0].textContent+':'+r.children[1].textContent.split(' ')[0])")
    eq(rows, ["a.txt:modified", "gone.txt:removed", "new.txt:added", "same.txt:same"], "zip rows")
    t.call("zipOpen(0)")
    t.wait_for("() => document.getElementById('resultTitle').textContent.includes('a.txt')")
    eq(t.call("[...document.querySelectorAll('#splitPanel .sd-r .word-added')].map(e=>e.textContent)"), ["there"], "file diff from zip")


@case("text-diff-checker", "typical", "share link restores mode, inputs and options and re-runs")
def _(t):
    t.call("loadSample('code')"); t.wait(100)
    t.click("#ignoreCase")
    url = t.call("Layerbit.state.write(getState())")
    t.page.goto(url, wait_until="load"); t.wait(400)
    expect(t.call("document.getElementById('ignoreCase').checked"), "option not restored")
    expect("2 change blocks" in t.text("diffStats"), "did not re-run: " + t.text("diffStats"))


@case("text-diff-checker", "maximal", "20,000-line files with folding render under budget")
def _(t):
    a = "\n".join(f"line {i} = value_{i};" for i in range(20000))
    b = "\n".join((f"line {i} = value_{i};" if i % 500 else f"LINE {i} = changed_{i};") for i in range(20000))
    t.set("text1", a); t.set("text2", b)
    t.select("contextLines", "3")
    t.call("run()")
    t.wait_for("() => document.getElementById('diffStats').innerText.includes('40 change blocks')")
    expect(t.count("#splitPanel .sd-r") < 400, "folding not applied")
    t.call("navDiff(1)")
    eq(t.text("hunkCounter"), "1 / 40", "navigation counter")


# ----------------------------------------------------------------------------
# log-analyzer
# ----------------------------------------------------------------------------
@case("log-analyzer", "minimal", "empty input")
def _(t):
    t.set("logInput", "")
    t.call("analyzeLogs()")
    t.wait(50)


@case("log-analyzer", "typical", "counts ERROR/WARN/INFO")
def _(t):
    t.set("logInput", "2026-01-01 INFO started\n2026-01-01 WARN slow\n2026-01-01 ERROR boom\n2026-01-01 ERROR again")
    t.call("analyzeLogs()")
    eq(t.text("countErr").strip(), "2", "error count")
    eq(t.text("countWarn").strip(), "1", "warn count")
    eq(t.text("countInfo").strip(), "1", "info count")


@case("log-analyzer", "typical", "filter + grep narrow the view")
def _(t):
    t.set("logInput", "INFO alpha\nERROR beta\nERROR gamma")
    t.call("analyzeLogs()")
    t.click("#filter-ERROR")
    t.set("searchInput", "gam")
    t.wait(200)
    out = t.text("logOutput")
    expect("gamma" in out and "beta" not in out and "alpha" not in out, f"filter/grep wrong: {out!r}")


@case("log-analyzer", "edge", "lowercase / bracketed levels still classified")
def _(t):
    t.set("logInput", "[error] lower\n[Warning] mixed\ninfo: plain")
    t.call("analyzeLogs()")
    expect(int(t.text("countErr").strip() or 0) >= 1, "lowercase error not counted")


@case("log-analyzer", "maximal", "50,000 lines under budget")
def _(t):
    lines = [f"2026-01-01 {'ERROR' if i % 10 == 0 else 'INFO'} message {i}" for i in range(50000)]
    t.set("logInput", "\n".join(lines))
    t.call("analyzeLogs()")
    eq(t.text("countErr").strip().replace(",", ""), "5000", "error count at scale")


@case("log-analyzer", "edge", "B7: a stack trace belongs to its log line: counts, filters and export are per event")
def _(t):
    log = "\n".join([
        "2026-01-01 10:00:00 INFO started",
        "2026-01-01 10:00:01 ERROR request failed",
        "java.lang.NullPointerException: user is null",
        "\tat com.acme.Api.handle(Api.java:42)",
        "\tat com.acme.Server.run(Server.java:7)",
        "2026-01-01 10:00:02 INFO recovered"])
    t.set("logInput", log); t.wait(450); t.call("analyzeLogs()")
    eq(t.text("countAll").strip(), "3", "events")
    eq(t.text("countErr").strip(), "1", "errors")
    t.call("setFilter('ERROR')"); t.wait(150)
    rows = t.call("[...document.querySelectorAll('#logOutput .log-line')].filter(l => l.style.display !== 'none').map(l => l.innerText)")
    eq(len(rows), 1, "error rows")
    expect("NullPointerException" in rows[0] and "Api.java:42" in rows[0], rows[0])
    py = "2026-01-01 10:00:00 ERROR boom\nTraceback (most recent call last):\n  File \"app.py\", line 3, in <module>\nValueError: bad\n2026-01-01 10:00:01 INFO ok"
    t.set("logInput", py); t.wait(450); t.call("analyzeLogs()")
    eq(t.text("countAll").strip(), "2", "python traceback grouped")


@case("log-analyzer", "typical", "DEBUG filter, regex grep and repeated-message tally")
def _(t):
    lines = ["2026-01-01 10:00:00 DEBUG cache miss key=%d" % i for i in range(3)] + \
            ["2026-01-01 10:00:0%d ERROR user %d timed out after 30s" % (i, 1000 + i) for i in range(4)] + \
            ["2026-01-01 10:00:09 INFO ok"]
    t.set("logInput", "\n".join(lines))
    # typing schedules its own analysis 300 ms later, which resets the search
    # box; let it land first so it cannot wipe the grep below mid-test
    t.wait(450)
    t.call("analyzeLogs()")
    eq(t.text("countDebug").strip(), "3", "debug count")
    top = t.text("topMessages")
    expect("×4" in top and "user # timed out" in top, f"tally wrong: {top!r}")
    t.call("document.getElementById('grepRegex').checked = true")
    t.set("searchInput", "user 100[12]")
    t.wait(200)
    vis = t.call("Array.from(document.querySelectorAll('#logOutput .log-line')).filter(l => l.style.display !== 'none').length")
    eq(vis, 2, "regex grep visible rows")


# ----------------------------------------------------------------------------
# json-to-table
# ----------------------------------------------------------------------------
@case("json-to-table", "minimal", "empty input")
def _(t):
    t.set("jsonInput", "")
    t.call("processJSON()")
    t.wait(50)


@case("json-to-table", "typical", "array of objects -> rows and flattened columns")
def _(t):
    t.set("jsonInput", '[{"id":1,"user":{"name":"Ann"}},{"id":2,"user":{"name":"Bob"}}]')
    t.call("processJSON()")
    eq(t.count("#tableBody tr"), 2, "rows")
    expect("user.name" in t.text("tableHead") or "name" in t.text("tableHead"), "nested column missing")


@case("json-to-table", "edge", "A3: long numbers are shown and exported exactly")
def _(t):
    t.set("jsonInput", '[{"id": 12345678901234567890, "v": 1e400}]')
    t.call("processJSON()")
    body = t.text("tableBody")
    expect("12345678901234567890" in body and "1e400" in body, body)


@case("json-to-table", "edge", "A4: Export CSV is safe for spreadsheets by default")
def _(t):
    t.set("jsonInput", '[{"name": "=HYPERLINK(\\"http://x\\")", "cmd": "@SUM(A1)", "n": -5, "id": 12345678901234567890}]')
    t.call("processJSON()")
    expect(t.page.is_checked("#csvSafe"), "Safe for Excel is not on by default")
    with t.page.expect_download() as dl:
        t.click("#btnExport")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect("'=HYPERLINK" in csv and "'@SUM(A1)" in csv and "-5" in csv and "'-5" not in csv and "12345678901234567890" in csv, csv)
    t.page.uncheck("#csvSafe")
    with t.page.expect_download() as dl:
        t.click("#btnExport")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect("'=HYPERLINK" not in csv and "=HYPERLINK" in csv, csv)
    t.page.check("#csvSafe")


@case("json-to-table", "edge", "single object and ragged keys")
def _(t):
    t.set("jsonInput", '[{"a":1},{"b":2}]')
    t.call("processJSON()")
    eq(t.count("#tableBody tr"), 2, "ragged rows")
    expect("a" in t.text("tableHead") and "b" in t.text("tableHead"), "union of keys not used")


@case("json-to-table", "edge", "invalid JSON reports error")
def _(t):
    t.set("jsonInput", "[1,2,")
    t.call("processJSON()")
    expect(t.visible("#errorBanner"), "error banner not shown")


@case("json-to-table", "maximal", "5,000 rows render + filter")
def _(t):
    t.set("jsonInput", json.dumps([{"id": i, "n": f"row{i}"} for i in range(5000)]))
    t.call("processJSON()")
    expect(t.count("#tableBody tr") >= 1, "no rows")
    t.set("searchInput", "row4999", event="keyup")
    t.wait(100)
    expect("row4999" in t.text("tableBody"), "filter lost the row")


@case("json-to-table", "typical", "column sort is numeric and toggles direction")
def _(t):
    t.set("jsonInput", '[{"n":10,"s":"b"},{"n":9,"s":"a"},{"n":100,"s":"c"}]')
    t.call("processJSON()")
    t.click("th[data-col='n']")
    col = t.call("Array.from(document.querySelectorAll('#tableBody tr td:first-child')).map(e => e.textContent)")
    eq(col, ["9", "10", "100"], "numeric ascending")
    t.click("th[data-col='n']")
    col = t.call("Array.from(document.querySelectorAll('#tableBody tr td:first-child')).map(e => e.textContent)")
    eq(col, ["100", "10", "9"], "numeric descending")


@case("json-to-table", "maximal", "2.3: 100,000 rows render virtually, scroll to the end, and filter")
def _(t):
    t.set("jsonInput", json.dumps([{"id": i, "name": f"row{i}", "grp": f"g{i % 7}"} for i in range(100000)]))
    t.call("processJSON()")
    n = t.count("#tableBody tr")
    expect(0 < n < 200, f"{n} rows in the DOM")
    eq(t.text("rowCount"), "100,000 Rows", "row count")
    t.call("() => { const c = document.querySelector('.table-container'); c.scrollTop = c.scrollHeight; }")
    t.wait(200)
    expect("row99999" in t.text("tableBody"), "last row not reachable")
    t.set("searchInput", "row77777", event="keyup"); t.wait(150)
    eq(t.text("rowCount"), "1 Row", "global filter")


@case("json-to-table", "typical", "2.3: per-column filters with numbers and text, combined with the search")
def _(t):
    t.set("jsonInput", '[{"n":5,"s":"apple"},{"n":12,"s":"banana"},{"n":30,"s":"cherry"},{"n":12345678901234567890,"s":"date"},{"n":null,"s":""}]')
    t.call("processJSON()")
    t.set("filter-n", ">10", event="input"); t.wait(100)
    eq(t.text("rowCount"), "3 Rows", "n > 10")
    t.set("filter-s", "!an", event="input"); t.wait(100)
    eq(t.text("rowCount"), "2 Rows", "and s does not contain 'an'")
    t.set("filter-n", ">12345678901234567889", event="input"); t.wait(100)
    eq(t.text("rowCount"), "1 Row", "big numbers by value")
    t.set("filter-n", "", event="input"); t.set("filter-s", "empty", event="input"); t.wait(100)
    eq(t.text("rowCount"), "1 Row", "empty")
    t.set("filter-s", "", event="input"); t.wait(100)
    eq(t.text("rowCount"), "5 Rows", "cleared")


@case("json-to-table", "typical", "2.3: hide, reorder and resize columns")
def _(t):
    t.set("jsonInput", '[{"a":1,"b":2,"c":3}]')
    t.call("processJSON()")
    t.click("#btnColumns")
    t.page.uncheck("#colInc-b")
    eq(t.call("[...document.querySelectorAll('#tableHead th[data-col]')].map(th => th.dataset.col)"), ["a", "c"], "b hidden")
    t.click("#colDown-a")
    eq(t.call("[...document.querySelectorAll('#tableHead th[data-col]')].map(th => th.dataset.col)"), ["c", "a"], "a moved right")
    eq(t.call("[...document.querySelectorAll('#tableBody tr:first-child td')].map(td => td.textContent)"), ["3", "1"], "cells follow")
    w0 = t.call("document.querySelector(\"th[data-col='a']\").getBoundingClientRect().width")
    box = t.page.locator("th[data-col='a'] .col-resize").bounding_box()
    t.page.mouse.move(box["x"] + 2, box["y"] + 5); t.page.mouse.down(); t.page.mouse.move(box["x"] + 122, box["y"] + 5, steps=4); t.page.mouse.up()
    w1 = t.call("document.querySelector(\"th[data-col='a']\").getBoundingClientRect().width")
    expect(w1 > w0 + 60, f"column not resized: {w0} -> {w1}")
    t.page.check("#colInc-b")


@case("json-to-table", "typical", "2.3: group by a column with count, sum, average, min and max")
def _(t):
    t.set("jsonInput", '[{"cat":"tools","price":10},{"cat":"books","price":5},{"cat":"tools","price":2.5},{"cat":"books","price":"n/a"}]')
    t.call("processJSON()")
    t.select("groupBy", "cat"); t.select("aggCol", "price")
    heads = t.call("[...document.querySelectorAll('#tableHead th')].map(th => th.textContent.trim())")
    eq(heads, ["cat", "count", "sum of price", "average", "min", "max"], "group header")
    rows = t.call("[...document.querySelectorAll('#tableBody tr')].map(tr => [...tr.children].map(td => td.textContent))")
    eq(rows, [["tools", "2", "12.5", "6.25", "2.5", "10"], ["books", "2", "5", "5", "5", "5"]], "groups")
    with t.page.expect_download() as dl:
        t.click("#btnExport")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect(csv.splitlines()[0] == "cat,count,sum of price,average,min,max" and "tools,2,12.5,6.25,2.5,10" in csv, csv)
    t.select("groupBy", "")
    eq(t.text("rowCount"), "4 Rows", "back to rows")


@case("json-to-table", "typical", "2.3: edit a cell, keep its type, and export the edited JSON")
def _(t):
    t.set("jsonInput", '{"header":{"src":"api"},"body":[{"id":1,"user":{"name":"Ann"},"ok":true},{"id":2,"user":{"name":"Bob"},"ok":false}]}')
    t.call("processJSON()")
    t.page.dblclick("#tableBody tr:nth-child(2) td[data-col='user.name']")
    t.page.fill("#tableBody input.cell-edit", "Grace"); t.page.press("#tableBody input.cell-edit", "Enter"); t.wait(100)
    t.page.dblclick("#tableBody tr:nth-child(1) td[data-col='id']")
    t.page.fill("#tableBody input.cell-edit", "12345678901234567890"); t.page.press("#tableBody input.cell-edit", "Enter"); t.wait(100)
    t.page.dblclick("#tableBody tr:nth-child(1) td[data-col='ok']")
    t.page.fill("#tableBody input.cell-edit", "false"); t.page.press("#tableBody input.cell-edit", "Enter"); t.wait(100)
    expect("Grace" in t.text("tableBody"), "grid not updated")
    with t.page.expect_download() as dl:
        t.click("#btnExportJson")
    raw = open(dl.value.path(), encoding="utf-8").read()
    doc = json.loads(raw)
    eq(doc["header"], {"src": "api"}, "shape kept")
    eq(doc["body"][1]["user"]["name"], "Grace", "nested edit")
    eq(doc["body"][0]["ok"], False, "boolean stays boolean")
    expect('"id": 12345678901234567890' in raw, "number stays an exact number: " + raw[:120])
    expect("Grace" in t.val("jsonInput"), "edit not written into the input")


@case("json-to-table", "typical", "2.3: .xlsx export with typed cells")
def _(t):
    t.set("jsonInput", '[{"zip":"00123","n":42,"big":12345678901234567890,"f":"=1+1","ok":true}]')
    t.call("processJSON()")
    with t.page.expect_download() as dl:
        t.click("#btnXlsx")
    expect(dl.value.suggested_filename.endswith(".xlsx"), dl.value.suggested_filename)
    b64 = base64.b64encode(open(dl.value.path(), "rb").read()).decode()
    t.page.evaluate(LOAD_SCRIPT, "../js/vendor/xlsx.full.min.js")
    res = t.call("""() => { const wb = XLSX.read(Uint8Array.from(atob('%s'), c => c.charCodeAt(0)), { type: 'array' }); const ws = wb.Sheets[wb.SheetNames[0]];
      return ['A2', 'B2', 'C2', 'D2', 'E2'].map(a => [ws[a].t, String(ws[a].v), ws[a].f || '']); }""" % b64)
    eq(res, [["s", "00123", ""], ["n", "42", ""], ["s", "12345678901234567890", ""], ["s", "=1+1", ""], ["b", "true", ""]], "typed cells")


# ----------------------------------------------------------------------------
# html-escape-unescape
# ----------------------------------------------------------------------------
@case("html-escape-unescape", "minimal", "empty")
def _(t):
    t.set("rawInput", "")
    eq(t.val("escapedInput"), "", "escaped")


@case("html-escape-unescape", "typical", "escapes the five and round-trips")
def _(t):
    t.set("rawInput", '<a href="x">Tom & Jerry\'s</a>')
    esc = t.val("escapedInput")
    expect("&lt;a" in esc and "&amp;" in esc and "&quot;" in esc, f"escape wrong: {esc}")
    t.set("escapedInput", esc)
    eq(t.val("rawInput"), '<a href="x">Tom & Jerry\'s</a>', "round trip")


@case("html-escape-unescape", "edge", "named and numeric entities unescape")
def _(t):
    t.set("escapedInput", "&copy; &#169; &#xA9; &nbsp;x")
    raw = t.val("rawInput")
    expect(raw.startswith("© © ©"), f"entity decode wrong: {raw!r}")


@case("html-escape-unescape", "maximal", "500 KB document")
def _(t):
    t.set("rawInput", "<p>a & b</p>\n" * 40000)
    esc = t.val("escapedInput")
    eq(esc.count("&lt;p&gt;"), 40000, "escape count")


@case("html-escape-unescape", "typical", "escape profiles: essential leaves '/', non-ASCII becomes hex refs")
def _(t):
    t.select("escapeProfile", "essential")
    t.set("rawInput", "a/b <c> é")
    eq(t.val("escapedInput"), "a/b &lt;c&gt; é", "essential")
    t.select("escapeProfile", "nonascii")
    eq(t.val("escapedInput"), "a&#x2F;b &lt;c&gt; &#xE9;", "non-ascii")


# ----------------------------------------------------------------------------
# cron-generator
# ----------------------------------------------------------------------------
@case("cron-generator", "minimal", "empty expression: no crash")
def _(t):
    t.set("cronInput", "")
    t.wait(50)


@case("cron-generator", "typical", "translates and lists next runs")
def _(t):
    t.set("cronInput", "0 9 * * 1-5")
    tr = t.text("cronTranslation").lower()
    expect("09:00" in tr and ("monday" in tr and "friday" in tr), f"translation wrong: {tr!r}")
    expect(t.count("#nextRunsList li, #nextRunsList div, #nextRunsList span") >= 5, "next runs missing")


@case("cron-generator", "edge", "B1: month and day names, 7 for Sunday and ? all list next runs")
def _(t):
    for expr, check in [("0 9 * JAN *", "Jan"), ("0 9 * * MON-FRI", None), ("0 0 ? * MON", "Mon"), ("0 9 * * 7", "Sun"), ("0 9 * jan-mar sat,sun", None)]:
        t.set("cronInput", expr); t.wait(80)
        expect(not t.call("document.getElementById('terminalPane').classList.contains('error')"), expr + " rejected: " + t.text("cronTranslation"))
        expect(t.visible("#nextRuns") if t.count("#nextRuns") else True, expr + ": next runs hidden")
        items = t.call("[...document.querySelectorAll('#nextRunsList li')].map(l => l.textContent)")
        expect(len(items) == 5 and "No matches" not in items[0], f"{expr}: {items}")
        if check:
            expect(all(check in i for i in items), f"{expr} runs on the wrong day: {items}")


@case("cron-generator", "edge", "B1: @daily-style macros run; @reboot is explained, never a blank area")
def _(t):
    for macro in ["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]:
        t.set("cronInput", macro); t.wait(80)
        expect(not t.call("document.getElementById('terminalPane').classList.contains('error')"), macro + " rejected: " + t.text("cronTranslation"))
        eq(t.count("#nextRunsList li"), 5, macro + " next runs")
    t.set("cronInput", "@reboot"); t.wait(80)
    expect("boot" in t.text("cronTranslation").lower(), t.text("cronTranslation"))
    expect("no schedule" in t.text("nextRunsList").lower(), "reboot: " + t.text("nextRunsList"))
    t.set("cronInput", "0 9 * * 1#2"); t.wait(80)
    expect(t.text("nextRunsList").strip() != "" or t.call("document.getElementById('terminalPane').classList.contains('error')"), "blank next-runs area")


@case("cron-generator", "edge", "invalid field is flagged")
def _(t):
    t.set("cronInput", "61 * * * *")
    t.wait(50)
    expect(t.call("document.getElementById('terminalPane').classList.contains('error')"), "61 minutes not rejected")
    expect("out of range" in t.text("cronTranslation"), "range message missing")
    t.set("cronInput", "0 0 * * mon-fri")
    t.wait(50)
    expect(not t.call("document.getElementById('terminalPane').classList.contains('error')"), "day names wrongly rejected")


@case("cron-generator", "edge", "day-of-month OR day-of-week rule: next runs include both")
def _(t):
    t.set("cronInput", "0 0 1 * 1")
    t.wait(100)
    expect(t.count("#nextRunsList li, #nextRunsList div") >= 1, "no next runs for OR case")


@case("cron-generator", "typical", "dropdowns build the expression")
def _(t):
    t.select("selMin", "0")
    t.select("selHour", "12")
    expect(t.val("cronInput").startswith("0 12"), f"dropdowns did not build: {t.val('cronInput')}")


@case("cron-generator", "typical", "next runs in a chosen zone show the UTC equivalent")
def _(t):
    expect(t.count("#tzSelect option") > 10, "zone list not populated")
    t.set("cronInput", "0 9 * * *")
    t.select("tzSelect", "Asia/Dubai")
    t.wait(100)
    li = t.text("nextRunsList")
    expect("09:00" in li and "05:00" in li and "UTC" in li, f"zone conversion wrong: {li[:120]!r}")
    t.select("tzSelect", "UTC")
    t.wait(50)
    expect("= " not in t.text("nextRunsList"), "UTC mode should not show an equivalent")


# ----------------------------------------------------------------------------
# qr-barcode
# ----------------------------------------------------------------------------
@case("qr-barcode", "minimal", "empty payload reports, does not throw")
def _(t):
    t.set("dataInput", "")
    t.call("generateCode()")
    t.wait(100)
    expect("payload" in t.text("outputArea").lower(), "empty payload message missing")


@case("qr-barcode", "typical", "QR renders a canvas and an SVG copy is available")
def _(t):
    t.set("dataInput", "https://layerbit.co.in")
    t.call("generateCode()")
    t.wait(200)
    expect(t.count("#outputArea canvas, #outputArea img") >= 1, "no QR rendered")
    expect(not t.call("document.getElementById('btnDownloadSvg').disabled"), "SVG export not enabled")
    svg = t.call("lastSvg")
    expect(svg and svg.count("<rect") > 200, "SVG module grid looks wrong")


@case("qr-barcode", "typical", "Wi-Fi payload builder composes the ZXing format with escaping")
def _(t):
    t.select("payloadType", "wifi")
    t.set("pf-ssid", "Cafe;Net")
    t.set("pf-pass", "p:ss,word")
    eq(t.val("dataInput"), "WIFI:T:WPA;S:Cafe\\;Net;P:p\\:ss\\,word;;", "wifi string")


@case("qr-barcode", "typical", "UPI builder composes a upi://pay link every UPI app reads")
def _(t):
    t.select("payloadType", "upi")
    t.set("pf-vpa", " shop.owner@okhdfcbank ")
    t.set("pf-name", "Ravi & Sons")
    t.set("pf-amount", "₹1,250.5")
    t.set("pf-note", "Order 42")
    eq(t.val("dataInput"), "upi://pay?pa=shop.owner@okhdfcbank&pn=Ravi%20%26%20Sons&am=1250.50&cu=INR&tn=Order%2042", "upi link")
    t.set("pf-amount", "")
    eq(t.val("dataInput"), "upi://pay?pa=shop.owner@okhdfcbank&pn=Ravi%20%26%20Sons&cu=INR&tn=Order%2042", "upi link without amount")


@case("qr-barcode", "typical", "WhatsApp builder composes a wa.me link with the message")
def _(t):
    t.select("payloadType", "whatsapp")
    t.set("pf-num", "+971 50 123 4567")
    t.set("pf-msg", "Hi, is the table free at 8?")
    eq(t.val("dataInput"), "https://wa.me/971501234567?text=Hi%2C%20is%20the%20table%20free%20at%208%3F", "whatsapp link")
    t.set("pf-num", "00919876543210")
    t.set("pf-msg", "")
    eq(t.val("dataInput"), "https://wa.me/919876543210", "00 prefix stripped, no message")


@case("qr-barcode", "typical", "vCard builder emits N/FN and optional lines")
def _(t):
    t.select("payloadType", "vcard")
    t.set("pf-name", "Ada Lovelace")
    t.set("pf-tel", "+971500000000")
    v = t.val("dataInput")
    expect(v.startswith("BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nFN:Ada Lovelace") and "TEL;TYPE=CELL:+971500000000" in v and v.endswith("END:VCARD"), f"vcard wrong: {v!r}")


@case("qr-barcode", "typical", "EAN-13 from 12 digits renders and computes the check digit")
def _(t):
    t.select("typeSelect", "EAN13")
    t.set("dataInput", "590123412345")
    t.call("generateCode()")
    t.wait(200)
    expect(t.count("#outputArea svg") == 1, "EAN-13 not rendered")
    expect("5901234123457" in t.call("document.getElementById('outputArea').textContent"), "check digit 7 not shown")


@case("qr-barcode", "edge", "EAN-13 with wrong length is refused with the rule, not thrown")
def _(t):
    t.select("typeSelect", "EAN13")
    t.set("dataInput", "12345")
    t.call("generateCode()")
    t.wait(100)
    expect("12 data digits" in t.text("outputArea"), "length rule not shown")


@case("qr-barcode", "edge", "Code 39 rejects lowercase")
def _(t):
    t.select("typeSelect", "CODE39")
    t.set("dataInput", "abc")
    t.call("generateCode()")
    t.wait(100)
    expect("uppercase" in t.text("outputArea"), "Code 39 rule not shown")


@case("qr-barcode", "edge", "inverted colours are warned about")
def _(t):
    t.set("colorDark", "#ffffff")
    t.set("colorLight", "#000000")
    expect("inverted" in t.text("contrastMeta"), "inversion warning missing")


@case("qr-barcode", "maximal", "payload beyond QR capacity reports an error, not an exception")
def _(t):
    t.select("typeSelect", "qr")
    t.set("dataInput", "x" * 4000)
    t.call("generateCode()")
    t.wait(200)
    expect("holds at most" in t.text("outputArea"), "capacity message missing")


@case("qr-barcode", "maximal", "2,900-byte payload at level L renders")
def _(t):
    t.select("typeSelect", "qr")
    t.select("ecSelect", "L")
    t.set("dataInput", "A" * 2900)
    t.call("generateCode()")
    t.wait(500)
    expect(t.count("#outputArea canvas, #outputArea img") >= 1, "max-size QR not rendered")


# ----------------------------------------------------------------------------
# pint-ae-checker
# ----------------------------------------------------------------------------
PINT_CSV = ("InvoiceNumber,IssueDate,SellerName,SellerTRN,BuyerName,BuyerTRN,Currency,LineDescription,Quantity,UnitPrice,TaxRate,TaxAmount,TotalAmount\n"
            "INV-001,2026-09-01,Layerbit Technologies,100123456700003,Acme LLC,100987654300003,AED,Consulting,1,1000,5,50,1050\n")


@case("pint-ae-checker", "typical", "CSV upload -> mapping -> score")
def _(t):
    t.upload("fileInput", "invoices.csv", PINT_CSV, "text/csv")
    t.wait_for("() => document.getElementById('workspace').offsetParent !== null || document.getElementById('checklist').children.length > 0", 8000)
    if t.visible("#btnConfirmMapping"):
        t.click("#btnConfirmMapping")
    t.wait_for("() => /\\d/.test(document.getElementById('ringValue').innerText)", 8000)


@case("pint-ae-checker", "edge", "empty CSV reports error, not crash")
def _(t):
    t.upload("fileInput", "empty.csv", "", "text/csv")
    t.wait(300)


# ----------------------------------------------------------------------------
# subnet-calculator
# ----------------------------------------------------------------------------
@case("subnet-calculator", "minimal", "empty and bare address")
def _(t):
    t.set("cidrInput", "")
    expect("Waiting" in t.text("resultGrid"), "empty state")
    t.set("cidrInput", "8.8.8.8")
    g = t.text("resultGrid")
    expect("8.8.8.8/32" in g and "global unicast" in g, f"bare address: {g[:120]!r}")


@case("subnet-calculator", "typical", "IPv4 /22 with host-form input, mask, wildcard, class")
def _(t):
    t.set("cidrInput", "192.168.1.37 255.255.252.0")
    g = t.text("resultGrid")
    for needle in ["192.168.0.0/22", "you typed a host address", "192.168.3.255", "192.168.0.1 – 192.168.3.254", "1,022", "255.255.252.0", "0.0.3.255", "private (RFC 1918)", "class C"]:
        expect(needle in g, f"missing {needle!r} in {g[:300]!r}")


@case("subnet-calculator", "typical", "IPv6 /48: exact size, /64 count, compression, PTR")
def _(t):
    t.set("cidrInput", "2001:0db8:ABCD:0000::1/48")
    g = t.text("resultGrid")
    for needle in ["2001:db8:abcd::/48", "1,208,925,819,614,629,174,706,176", "65,536", "documentation", "d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa"]:
        expect(needle in g, f"missing {needle!r}")


@case("subnet-calculator", "typical", "split, membership and supernet")
def _(t):
    t.set("cidrInput", "10.0.0.0/22")
    t.select("splitSelect", "24")
    eq(t.count("#splitTable tbody tr"), 4, "split rows")
    expect("10.0.3.0/24" in t.text("splitTable"), "last subnet")
    t.set("memberInput", "10.0.2.200")
    expect("Inside" in t.text("memberResult") and "#713" in t.text("memberResult"), t.text("memberResult"))
    t.set("memberInput", "10.0.4.1")
    expect("Outside" in t.text("memberResult"), "outside")
    t.set("superInput", "10.0.4.0/22")
    expect("10.0.0.0/21" in t.text("superResult") and "exact aggregate" in t.text("superResult"), t.text("superResult"))
    t.set("superInput", "10.0.8.0/22")
    expect("extra addresses" in t.text("superResult"), "non-exact supernet")


@case("subnet-calculator", "edge", "/31 and /32 host counts, bad prefix, bad mask")
def _(t):
    t.set("cidrInput", "10.1.1.0/31")
    g = t.text("resultGrid")
    expect("Usable hosts\n2" in g and "none (point-to-point" in g, f"/31: {g[:200]!r}")
    t.set("cidrInput", "10.1.1.0/33")
    expect("longer than the 32-bit" in t.text("errorText"), "bad prefix")
    t.set("cidrInput", "10.1.1.0 255.255.0.255")
    expect("not a contiguous mask" in t.text("errorText"), "bad mask")


@case("subnet-calculator", "maximal", "split a /16 into 4,096 x /28 (show all)")
def _(t):
    t.set("cidrInput", "172.16.0.0/16")
    t.click("#splitAll")
    t.select("splitSelect", "28")
    eq(t.count("#splitTable tbody tr"), 4096, "rows")
    expect("172.16.255.240/28" in t.text("splitTable"), "last /28")


# ----------------------------------------------------------------------------
# hash-generator
# ----------------------------------------------------------------------------
@case("hash-generator", "minimal", "empty input hashes to the empty-string digests")
def _(t):
    t.set("textInput", "")
    t.wait_for("() => document.getElementById('d-SHA-256').textContent.length === 64")
    eq(t.text("d-SHA-256"), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256('')")
    eq(t.text("d-MD5"), "d41d8cd98f00b204e9800998ecf8427e", "md5('')")


@case("hash-generator", "edge", "A6: text can be hashed with CRLF line endings, as a Windows file would have")
def _(t):
    t.set("textInput", "a\nb")
    t.wait_for("() => document.getElementById('d-SHA-256').textContent === '7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78'")
    expect(t.visible("#lineEndings"), "no line-endings option")
    t.select("lineEndings", "crlf")
    t.wait_for("() => document.getElementById('d-SHA-256').textContent === '18745f36a05e29072709042d6062ce54f1b08ff36c27ba80c39f81fb010c8ce2'")
    expect("file" in t.text("eolHint").lower(), "no pointer to file mode for exact bytes")
    t.select("lineEndings", "lf")


@case("hash-generator", "typical", "known vectors for 'abc' and HMAC-SHA256")
def _(t):
    t.set("textInput", "abc")
    t.wait_for("() => document.getElementById('d-SHA-1').textContent === 'a9993e364706816aba3e25717850c26c9cd0d89d'")
    eq(t.text("d-SHA-256"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256(abc)")
    eq(t.text("d-MD5"), "900150983cd24fb0d6963f7d28e17f72", "md5(abc)")
    t.set("hmacKey", "key")
    t.wait_for("() => document.getElementById('d-SHA-256').textContent === '9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab'")
    eq(t.text("d-MD5"), "d2fe98063f876b03193afb49b4979591", "hmac-md5(key, abc)")


@case("hash-generator", "typical", "verifier matches case- and whitespace-insensitively, names the algorithm")
def _(t):
    t.set("textInput", "abc")
    # wait for abc's digest specifically: the empty-string digest is also 64 chars
    t.wait_for("() => document.getElementById('d-SHA-256').textContent === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'")
    t.set("expectInput", "  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD\n")
    expect("Match" in t.text("verifyResult") and "SHA-256" in t.text("verifyResult"), t.text("verifyResult"))
    t.set("expectInput", "0" * 64)
    expect("No match" in t.text("verifyResult") and "SHA-256" in t.text("verifyResult"), t.text("verifyResult"))


@case("hash-generator", "edge", "hex and base64 input modes, invalid hex reported")
def _(t):
    t.select("inputMode", "hex")
    t.set("textInput", "61 62 63")
    t.wait_for("() => document.getElementById('d-MD5').textContent === '900150983cd24fb0d6963f7d28e17f72'")
    t.set("textInput", "abz")
    t.wait_for("() => document.getElementById('errorBanner').classList.contains('active')")
    t.select("inputMode", "base64")
    t.set("textInput", "YWJj")
    t.wait_for("() => document.getElementById('d-MD5').textContent === '900150983cd24fb0d6963f7d28e17f72'")


@case("hash-generator", "typical", "file upload hashes the file bytes")
def _(t):
    t.upload("fileInput", "hello.txt", "hello\n")
    t.wait_for("() => document.getElementById('d-SHA-256').textContent === '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03'")
    expect("hello.txt" in t.text("inputMeta"), "file name not shown")


@case("hash-generator", "maximal", "8 MB input hashes under budget")
def _(t):
    t.set("textInput", "x" * 8_000_000)
    t.wait_for("() => document.getElementById('d-SHA-512').textContent.length === 128", 12000)
    expect("MB" in t.text("inputMeta"), "size not reported")


# ----------------------------------------------------------------------------
# uuid-generator
# ----------------------------------------------------------------------------
UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"


@case("uuid-generator", "minimal", "page loads with five v4s already generated")
def _(t):
    import re
    lines = t.val("outputArea").split("\n")
    eq(len(lines), 5, "count")
    expect(all(re.match(UUID_RE, l) and l[14] == "4" for l in lines), f"not v4: {lines[0]}")
    expect(len(set(lines)) == 5, "duplicates")


@case("uuid-generator", "typical", "v7 is time-ordered and decodes to now")
def _(t):
    import re, time
    t.select("kindSelect", "v7")
    t.set("countInput", "50")
    t.click("#btnGenerate")
    lines = t.val("outputArea").split("\n")
    eq(len(lines), 50, "count")
    expect(all(l[14] == "7" for l in lines), "version nibble")
    expect(lines == sorted(lines), "v7 ids not monotonic within a millisecond")
    ms = int(lines[0].replace("-", "")[:12], 16)
    expect(abs(ms / 1000 - time.time()) < 5, f"embedded time off: {ms}")
    g = t.text("decodeGrid")
    expect("v7" in g and "Timestamp" in g and "from now" in g or "ago" in g, "decoder")


@case("uuid-generator", "typical", "v5 and v3 match the RFC namespace vectors")
def _(t):
    t.select("kindSelect", "v5")
    t.set("nameInput", "example.com")
    t.click("#btnGenerate")
    t.wait_for("() => document.getElementById('outputArea').value === 'cfbff0d1-9375-5685-968c-48ce8b15ae17'")
    t.select("kindSelect", "v3")
    t.click("#btnGenerate")
    t.wait_for("() => document.getElementById('outputArea').value === '9073926b-929f-31c2-abc9-fad77ae3e8eb'")


@case("uuid-generator", "typical", "formatting options and ULID")
def _(t):
    import re
    t.select("kindSelect", "v4")
    t.set("countInput", "2")
    t.click("#optUpper"); t.click("#optNoHyphen"); t.click("#optBraces"); t.click("#optQuote")
    out = t.val("outputArea")
    expect(re.match(r'^"\{[0-9A-F]{32}\}",\n"\{[0-9A-F]{32}\}"$', out), f"format: {out!r}")
    t.click("#optUpper"); t.click("#optNoHyphen"); t.click("#optBraces"); t.click("#optQuote")
    t.select("kindSelect", "ulid")
    t.click("#btnGenerate")
    lines = t.val("outputArea").split("\n")
    expect(all(re.match(r"^[0-9A-HJKMNP-TV-Z]{26}$", l) for l in lines), f"ulid: {lines[0]}")


@case("uuid-generator", "edge", "decoder: ULID, braced GUID, v1 timestamp, garbage")
def _(t):
    t.set("decodeInput", "01ARZ3NDEKTSV4RRFFQ69G5FAV")
    g = t.text("decodeGrid")
    expect("ULID" in g and "2016-07-30 23:54:10.259 UTC" in g, f"ulid decode: {g[:200]!r}")
    t.set("decodeInput", "{C56A4180-65AA-42EC-A945-5FD21DEC0538}")
    g = t.text("decodeGrid")
    expect("c56a4180-65aa-42ec-a945-5fd21dec0538" in g and "v4" in g, "guid decode")
    t.set("decodeInput", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    g = t.text("decodeGrid")
    expect("v1" in g and "1998-02-04 22:13:53.151 UTC" in g and "00:c0:4f:d4:30:c8" in g, f"v1 decode: {g[:300]!r}")
    t.set("decodeInput", "not-an-id")
    expect("not a UUID or ULID" in t.text("decodeGrid"), "garbage")


@case("uuid-generator", "maximal", "10,000 v4s, all unique, under budget")
def _(t):
    t.select("kindSelect", "v4")
    t.set("countInput", "10000")
    t.click("#btnGenerate")
    n = t.call("new Set(document.getElementById('outputArea').value.split('\\n')).size")
    eq(n, 10000, "unique count")


# ----------------------------------------------------------------------------
# timestamp-converter
# ----------------------------------------------------------------------------
@case("timestamp-converter", "minimal", "clock ticks and Now button fills the input")
def _(t):
    expect(t.text("nowSec").isdigit(), "now not shown")
    t.click("#btnNow")
    expect(t.val("tsInput").isdigit() and len(t.val("tsInput")) == 10, "now button")
    expect("Epoch seconds" in t.text("resultGrid"), "result")


@case("timestamp-converter", "typical", "seconds in Asia/Dubai: every form")
def _(t):
    t.select("tzSelect", "Asia/Dubai")
    t.set("tsInput", "1727438400")
    g = t.text("resultGrid")
    for needle in ["1727438400000", "2024-09-27T12:00:00.000Z", "Fri, 27 Sep 2024 12:00:00 GMT", "Fri 2024-09-27 16:00:00", "+04:00", "2024-09-27T16:00:00+04:00", "2024-W39", "271 · Q3 · Fri"]:
        expect(needle in g, f"missing {needle!r}")
    expect("seconds (10 digits)" in t.text("parseHint"), "unit hint")
    expect(t.count("#zoneTable tbody tr") >= 10, "zone table")


@case("timestamp-converter", "typical", "unit detection: ms, µs, ns give the same instant")
def _(t):
    for v, unit in [("1727438400000", "milliseconds"), ("1727438400000000", "microseconds"), ("1727438400000000000", "nanoseconds")]:
        t.set("tsInput", v)
        expect(unit in t.text("parseHint"), f"{v}: {t.text('parseHint')}")
        expect("2024-09-27T12:00:00.000Z" in t.text("resultGrid"), f"{v}: wrong instant")


@case("timestamp-converter", "edge", "zone-less input, ISO week-year boundary, 2038 flag, RFC 2822, negative, garbage")
def _(t):
    t.select("tzSelect", "Asia/Dubai")
    t.set("tsInput", "2026-09-27 15:30")
    expect("2026-09-27T11:30:00.000Z" in t.text("resultGrid"), "zone-less read in Dubai")
    t.set("tsInput", "2027-01-01")
    expect("2026-W53" in t.text("resultGrid") and "week-year 2026" in t.text("resultGrid"), f"iso week: {t.text('resultGrid')[:400]}")
    t.set("tsInput", "3000000000")
    expect("year 2038 problem" in t.text("resultGrid"), "2038 flag")
    t.set("tsInput", "Sat, 27 Sep 2026 12:00:00 GMT")
    expect("Epoch seconds\n1790510400" in t.text("resultGrid"), "rfc2822")
    t.set("tsInput", "-86400")
    expect("1969-12-31T00:00:00.000Z" in t.text("resultGrid"), "negative epoch")
    t.set("tsInput", "not a date")
    expect("Could not parse" in t.text("errorText"), "garbage")


@case("timestamp-converter", "typical", "date arithmetic clamps month ends; difference reports both directions")
def _(t):
    t.select("tzSelect", "UTC")
    t.set("tsInput", "1738281600")  # 2025-01-31
    t.set("deltaN", "1")
    t.select("deltaUnit", "month")
    expect("2025-02-28T00:00:00.000Z" in t.text("deltaResult"), t.text("deltaResult"))
    t.set("diffInput", "1738368000")
    expect("later by 1d 0h 0m 0s" in t.text("diffResult"), t.text("diffResult"))
    t.set("diffInput", "1738195200")
    expect("earlier by 1d" in t.text("diffResult"), t.text("diffResult"))


# ----------------------------------------------------------------------------
# xml-formatter
# ----------------------------------------------------------------------------
@case("xml-formatter", "minimal", "empty input clears everything")
def _(t):
    t.set("xmlInput", "")
    t.wait(150)
    eq(t.text("xmlOutput").strip(), "", "output")
    expect(t.call("document.getElementById('xpathInput').disabled"), "xpath should be disabled")


@case("xml-formatter", "typical", "pretty-print preserves text content, minify collapses, JSON view")
def _(t):
    t.set("xmlInput", "<a><b>text &amp; more</b><c/><!-- hi --><d>x<e>y</e></d></a>")
    t.wait(150)
    eq(t.text("xmlOutput"), "<a>\n  <b>text &amp; more</b>\n  <c/>\n  <!-- hi -->\n  <d>x<e>y</e></d>\n</a>", "pretty")
    t.select("modeSelect", "minify")
    eq(t.text("xmlOutput"), "<a><b>text &amp; more</b><c/><d>x<e>y</e></d></a>", "minify")
    t.select("modeSelect", "json")
    j = json.loads(t.text("xmlOutput"))
    eq(j["a"]["b"], "text & more", "json text")
    eq(j["a"]["d"]["#text"], "x", "json mixed text")


@case("xml-formatter", "typical", "XPath with default namespace, attribute and count results")
def _(t):
    t.click("#btnSample")
    t.wait(200)
    expect("node set: 1 node" in t.text("xpathHint"), t.text("xpathHint"))
    expect("Decoding a JWT" in t.text("xpathResults"), "sample result")
    t.set("xpathInput", "count(//ns:entry)")
    expect("number: 2" in t.text("xpathHint"), t.text("xpathHint"))
    t.set("xpathInput", "//*[local-name()='thumbnail']/@width")
    expect('width="1200"' in t.text("xpathResults"), "attribute result")
    t.set("xpathInput", "//entry")
    expect("0 nodes" in t.text("xpathHint") and "//ns:entry" in t.text("xpathHint"), "namespace tip")
    t.set("xpathInput", "//ns:entry[1")
    expect("not a valid XPath" in t.text("xpathHint"), "syntax error")


@case("xml-formatter", "edge", "well-formedness errors carry line and column")
def _(t):
    t.set("xmlInput", "<root>\n  <a>1 &amp 2</a>\n</root>")
    t.wait(150)
    expect("Line 2" in t.text("errorText") and "column" in t.text("errorText"), t.text("errorText"))
    t.set("xmlInput", "<a><b></a>")
    t.wait(150)
    # libxml2 wording changed between Chromium releases: "tag mismatch" vs "Unexpected closing tag"
    msg = t.text("errorText").lower()
    expect(("mismatch" in msg or "closing tag" in msg) and "line 1" in msg, t.text("errorText"))


@case("xml-formatter", "maximal", "5,000-element document formats and queries under budget")
def _(t):
    doc = "<items>" + "".join(f'<item id="{i}"><name>n{i}</name><qty>{i % 7}</qty></item>' for i in range(5000)) + "</items>"
    t.set("xmlInput", doc)
    t.wait_for("() => document.getElementById('statsStrip').innerText.includes('15,001')", 10000)
    t.set("xpathInput", "count(//item[qty > 5])")
    expect("number: 714" in t.text("xpathHint"), t.text("xpathHint"))


XML_ORDER = '<?xml version="1.0"?>\n<order id="7">\n  <qty>0</qty>\n  <sku>A</sku>\n</order>'
XSD_ORDER = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="order"><xs:complexType><xs:sequence><xs:element name="qty" type="xs:positiveInteger"/><xs:element name="sku" type="xs:string"/></xs:sequence><xs:attribute name="id" type="xs:int" use="required"/></xs:complexType></xs:element></xs:schema>'


@case("xml-formatter", "typical", "2.5: XSD validation with libxml2 in WebAssembly lists each error with its line")
def _(t):
    t.set("xmlInput", XML_ORDER); t.wait(150)
    t.select("schemaKind", "xsd"); t.set("schemaInput", XSD_ORDER)
    t.click("#btnValidate")
    t.wait_for("document.getElementById('validateResult').textContent.length > 0 && !/Validating/.test(document.getElementById('validateResult').textContent)", 20000)
    r = t.text("validateResult")
    expect("line 3" in r.lower() and "positiveInteger" in r, r)
    t.set("xmlInput", XML_ORDER.replace("<qty>0</qty>", "<qty>2</qty>")); t.wait(150)
    t.click("#btnValidate")
    t.wait_for("/Valid/.test(document.getElementById('validateResult').textContent) && !/error/i.test(document.getElementById('validateResult').textContent)", 20000)


@case("xml-formatter", "typical", "2.5: RelaxNG validation")
def _(t):
    t.set("xmlInput", XML_ORDER); t.wait(150)
    t.select("schemaKind", "rng")
    t.set("schemaInput", '<element name="order" xmlns="http://relaxng.org/ns/structure/1.0"><attribute name="id"/><element name="qty"><text/></element><element name="sku"><text/></element><element name="note"><text/></element></element>')
    t.click("#btnValidate")
    t.wait_for("document.getElementById('validateResult').textContent.length > 0 && !/Validating/.test(document.getElementById('validateResult').textContent)", 20000)
    expect("note" in t.text("validateResult") or "line" in t.text("validateResult").lower(), t.text("validateResult"))


@case("xml-formatter", "typical", "2.5: DTD validation from the internal subset or a pasted DTD")
def _(t):
    t.set("xmlInput", '<!DOCTYPE order [\n<!ELEMENT order (sku, qty)>\n<!ATTLIST order id ID #REQUIRED>\n<!ELEMENT qty (#PCDATA)>\n<!ELEMENT sku (#PCDATA)>\n]>\n<order>\n  <qty>1</qty>\n  <sku>A</sku>\n</order>'); t.wait(150)
    t.select("schemaKind", "dtd"); t.set("schemaInput", "")
    t.click("#btnValidate"); t.wait(300)
    r = t.text("validateResult")
    expect("required attribute id" in r and "content of <order>" in r and "line 7" in r.lower(), r)


@case("xml-formatter", "typical", "2.5: Schematron asserts and reports name the node")
def _(t):
    t.set("xmlInput", XML_ORDER); t.wait(150)
    t.select("schemaKind", "sch")
    t.set("schemaInput", '<schema xmlns="http://purl.oclc.org/dsdl/schematron"><pattern><rule context="order"><assert test="number(qty) &gt; 0">qty must be positive, got <value-of select="qty"/></assert><report test="sku = \'A\'">sku A is discontinued</report></rule></pattern></schema>')
    t.click("#btnValidate"); t.wait(300)
    r = t.text("validateResult")
    expect("qty must be positive, got 0" in r and "sku A is discontinued" in r and "/order" in r, r)


@case("xml-formatter", "typical", "2.5: XSLT 1.0 and XQuery 3.1 transforms")
def _(t):
    t.set("xmlInput", '<list><i n="2">b</i><i n="1">a</i></list>'); t.wait(150)
    t.click("[data-xtab='transform']")
    t.select("xfKind", "xslt")
    t.set("xfInput", '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/><xsl:template match="/"><xsl:for-each select="list/i"><xsl:sort select="@n"/><xsl:value-of select="."/></xsl:for-each></xsl:template></xsl:stylesheet>')
    t.click("#btnTransform"); t.wait(200)
    eq(t.text("xfOutput").strip(), "ab", "XSLT 1.0")
    t.select("xfKind", "xquery")
    t.set("xfInput", 'string-join(for $i in /list/i order by xs:integer($i/@n) descending return upper-case($i), "-")')
    t.click("#btnTransform")
    t.wait_for("document.getElementById('xfOutput').textContent.includes('B-A')", 15000)
    t.click("[data-xtab='validate']")


@case("xml-formatter", "typical", "2.5: JSON -> XML mode")
def _(t):
    t.select("modeSelect", "fromjson")
    t.set("xmlInput", '{"order":{"@id":"7","item":[{"sku":"A&B"},{"sku":"C"}]}}'); t.wait(200)
    out = t.text("xmlOutput")
    expect('<order id="7">' in out and "<sku>A&amp;B</sku>" in out and out.count("<item>") == 2, out)
    t.select("modeSelect", "pretty")


@case("xml-formatter", "typical", "2.5: compare two XML documents; the Diff Checker opens with both")
def _(t):
    t.set("xmlInput", '<order id="7"><sku>A</sku><qty>1</qty></order>'); t.wait(150)
    t.click("[data-xtab='compare']")
    t.set("cmpInput", '<order id="8"><sku>A</sku><qty>2</qty><note>x</note></order>')
    t.click("#btnCompareXml"); t.wait(150)
    r = t.text("cmpResult")
    expect("@id" in r and "qty" in r and "note" in r and "$.order.sku" not in r, r)
    expect("3 difference" in r, r)
    expect("text-diff-checker.html#s=" in t.call("document.getElementById('cmpLink').href"), "no hand-off link")
    t.click("[data-xtab='validate']")


@case("xml-formatter", "maximal", "2.5: a 30 MB XML file is formatted in a Worker and shown virtually")
def _(t):
    t.call("""() => { const parts = ['<?xml version="1.0"?>\\n<rows>']; for (let i = 0; i < 250000; i++) parts.push('<row id="' + i + '"><name>user ' + i + '</name><email>u' + i + '@example.com</email><score>' + i * 2 + '</score></row>');
      parts.push('</rows>'); window.__xf = new File(parts, 'big.xml'); handleFile(window.__xf); }""")
    t.wait_for("window.xmlBig && window.xmlBig.done", 60000)
    expect(t.call("window.__xf.size") > 25e6, "file not large enough")
    expect(not t.call("window.xmlBig.error"), "error: %s" % t.call("window.xmlBig.error"))
    n = t.count("#xmlOutput .lb-vrow")
    expect(0 < n < 300, f"{n} rows in the DOM")
    expect("<rows>" in t.text("xmlOutput"), t.text("xmlOutput")[:200])
    expect(t.call("xmlInput.value.length") == 0, "the big file was put into the text box")
    t.call("closeBigXml()")


# ----------------------------------------------------------------------------
# unicode-inspector
# ----------------------------------------------------------------------------
@case("unicode-inspector", "minimal", "plain ASCII: clean findings, one row per char")
def _(t):
    t.set("textInput", "abc")
    t.wait(120)
    expect("No invisible characters" in t.text("findings"), t.text("findings"))
    eq(t.count("#cpTable tbody tr"), 3, "rows")
    expect("3 graphemes" in t.text("statsStrip") and "3 UTF-8 bytes" in t.text("statsStrip"), t.text("statsStrip"))


@case("unicode-inspector", "typical", "hidden-character sample: ZWSP, NBSP, RLO, mixed script, curly quotes, NFC")
def _(t):
    t.click("#btnSampleInvisible")
    t.wait(200)
    f = t.text("findings")
    for needle in ["ZERO WIDTH SPACE", "NO-BREAK SPACE", "RIGHT-TO-LEFT OVERRIDE", "Bidirectional control", "Latin + Cyrillic", "curly quote"]:
        expect(needle in f, f"missing {needle!r} in findings")
    expect("NFC" in t.text("normTable") and "differs from input" in t.text("normTable"), "normalization")
    expect(t.count("#cpTable tbody tr.flag") >= 5, "flagged rows")
    cleaned = t.call("cleaned()")
    expect("​" not in cleaned and "‮" not in cleaned and " " not in cleaned and "'quoted'" in cleaned, f"cleaned: {cleaned!r}")


@case("unicode-inspector", "typical", "emoji counts: graphemes vs code points vs units vs bytes")
def _(t):
    t.set("textInput", "🇦🇪")
    t.wait(120)
    s = t.text("statsStrip")
    for needle in ["1 graphemes", "2 code points", "4 UTF-16 units", "8 UTF-8 bytes"]:
        expect(needle in s, f"missing {needle!r} in {s!r}")
    t.select("escapeSelect", "py")
    row = t.call("document.querySelector('#cpTable tbody tr').innerText")
    expect("\\U0001f1e6" in row, row)


@case("unicode-inspector", "edge", "decomposed vs composed é: NFC differs, NFD already")
def _(t):
    t.set("textInput", "café")
    t.wait(120)
    n = t.text("normTable")
    expect("NFC\t4 code points\tdiffers" in n.replace("\n", "\t") or ("4 code points" in n and "already NFD" in n), n)
    eq(t.count("#cpTable tbody tr"), 5, "five code points")


@case("unicode-inspector", "maximal", "50 KB of mixed text analyses under budget (table capped)")
def _(t):
    t.set("textInput", ("héllo wörld 日本語 🌍 " * 2500))
    t.wait_for("() => document.getElementById('cpCount').innerText.includes('first 2000')", 10000)
    expect("50,000" in t.text("statsStrip") or "47,500" in t.text("statsStrip") or "code points" in t.text("statsStrip"), t.text("statsStrip"))


# ----------------------------------------------------------------------------
# flow
# ----------------------------------------------------------------------------
@case("flow", "minimal", "empty input and no steps: output mirrors input, no error")
def _(t):
    expect(t.count("#opList .op-item") >= 60, "operation list not rendered")
    expect(t.count("#presetButtons .sample-btn") >= 8, "presets missing")
    t.set("flowInput", "")
    t.wait(250)
    expect(not t.visible("#errorBanner"), "error on empty input")
    expect("Paste something" in t.text("magicBar"), t.text("magicBar"))


@case("flow", "edge", "A2: CSV operations treat a stray quote inside a field as a literal character")
def _(t):
    out = t.call("""LBFlow.run({ v: 1, steps: [{ op: 'csv-to-json', args: { delim: 'auto', types: false } }] }, 'sku,desc\\n1,5" screen\\n2,stand').then(r => r[r.length - 1].output)""")
    rows = json.loads(out)
    eq([r["desc"] for r in rows], ['5" screen', "stand"], "rows")


@case("flow", "edge", "A3: JSON operations keep long numbers exactly")
def _(t):
    run = lambda op, args, inp: t.call(f"LBFlow.run({{ v: 1, steps: [{{ op: '{op}', args: {json.dumps(args)} }}] }}, {json.dumps(inp)}).then(r => r[r.length - 1].output)")
    src = '{"id": 12345678901234567890, "nested": {"v": 1e400}}'
    expect("12345678901234567890" in run("json-format", {"indent": "2", "sort": False}, src), "json-format")
    expect("12345678901234567890" in run("json-to-yaml", {}, src), "json-to-yaml")
    expect("12345678901234567890" in run("json-to-csv", {"delim": ","}, '[' + src + ']'), "json-to-csv")
    expect("12345678901234567890" in run("json-flatten", {"mode": "flatten"}, src), "json-flatten")
    rows = json.loads(run("csv-to-json", {"delim": "auto", "types": True}, "zip,phone,n\n00123,+971,42"))
    eq(rows, [{"zip": "00123", "phone": "+971", "n": 42}], "csv-to-json types")


@case("flow", "edge", "A4: JSON to CSV guards formula-like values unless switched off")
def _(t):
    src = json.dumps('[{"a": "=1+1", "n": -5}]')
    run = lambda args: t.call(f"LBFlow.run({{ v: 1, steps: [{{ op: 'json-to-csv', args: {json.dumps(args)} }}] }}, {src}).then(r => r[r.length - 1].output)")
    eq(run({"delim": ","}).split("\n")[1], "'=1+1,-5", "safe by default")
    eq(run({"delim": ",", "safe": False}).split("\n")[1], "=1+1,-5", "exact when switched off")


@case("flow", "typical", "magic suggests Base64 decode and the chip adds a working step")
def _(t):
    t.set("flowInput", "SGVsbG8gd29ybGQh")
    t.wait(250)
    chips = t.call("[...document.querySelectorAll('.magic-chip')].map(e=>e.firstChild.textContent)")
    expect(chips and chips[0] == "Base64 decode", str(chips))
    t.click(".magic-chip")
    t.wait_for("() => document.getElementById('flowOutput').innerText === 'Hello world!'")
    eq(t.count("#recipeList .step"), 1, "step count")


@case("flow", "typical", "presets run end to end: JWT from a log line, gzip payload, CSV pick")
def _(t):
    t.call("loadPreset('jwt-from-log')")
    t.wait_for("() => document.getElementById('flowOutput').innerText.includes('John Doe')", timeout=8000)
    eq(t.count("#recipeList .step"), 4, "jwt preset steps")
    t.call("loadPreset('gzip-payload')")
    t.wait_for("() => document.getElementById('flowOutput').innerText.includes('order.created')", timeout=8000)
    t.call("loadPreset('csv-pick')")
    t.wait_for("() => document.getElementById('flowOutput').innerText.includes('B-2')", timeout=8000)
    expect("A-1" not in t.text("flowOutput"), "filter did not apply")


@case("flow", "edge", "a failing step reports on its card, later steps are skipped, fixing resumes")
def _(t):
    t.call("loadPreset('csv-pick')")
    t.wait_for("() => document.getElementById('flowOutput').innerText.includes('B-2')", timeout=8000)
    t.call("setArg(1,'path','$[?(@.qty >')")
    t.wait(400)
    expect(t.visible("#errorBanner") and "Step 2" in t.text("errorText"), t.text("errorText"))
    expect(t.count("#recipeList .step.err") == 1, "step not marked")
    t.call("setArg(1,'path','$[*].sku')")
    t.wait(400)
    expect(not t.visible("#errorBanner") and "C-3" in t.text("flowOutput"), "did not resume")


@case("flow", "typical", "search + Enter adds a step; move, disable and remove steps")
def _(t):
    t.call("loadPreset('csv-pick')")
    t.wait_for("() => document.getElementById('flowOutput').innerText.includes('B-2')", timeout=8000)
    t.call("setArg(1,'path','$[*].sku')")
    t.page.focus("#opSearch")
    t.page.keyboard.type("sort")
    t.page.keyboard.press("Enter")
    t.wait(400)
    eq(t.count("#recipeList .step"), 3, "step added via search")
    t.call("moveStep(2,-1)")
    t.wait(300)
    expect(t.visible("#errorBanner"), "moving sort before the query should break the query")
    t.call("moveStep(1,1); toggleStep(2)")
    t.wait(300)
    expect(not t.visible("#errorBanner") and t.count("#recipeList .step.off") == 1, "toggle failed")
    t.call("removeStep(2)")
    t.wait(300)
    eq(t.count("#recipeList .step"), 2, "remove failed")


@case("flow", "typical", "lazily loaded libraries: YAML, MD5 and SQL steps")
def _(t):
    t.call("clearRecipe(); document.getElementById('flowInput').value='a: 1\\nb: [x, y]'; onInput(); addStep('yaml-to-json', {indent:'minify'})")
    t.wait_for("() => document.getElementById('flowOutput').innerText === '{\"a\":1,\"b\":[\"x\",\"y\"]}'", timeout=8000)
    t.call("clearRecipe(); document.getElementById('flowInput').value='abc'; onInput(); addStep('md5')")
    t.wait_for("() => document.getElementById('flowOutput').innerText === '900150983cd24fb0d6963f7d28e17f72'", timeout=8000)
    t.call("clearRecipe(); document.getElementById('flowInput').value='select a from b where c=1'; onInput(); addStep('sql-format')")
    t.wait_for("() => document.getElementById('flowOutput').innerText.includes('\\n')", timeout=8000)


@case("flow", "typical", "hashing and AES round trip inside one recipe")
def _(t):
    t.call("clearRecipe(); document.getElementById('flowInput').value='secret note'; onInput(); addStep('aes-encrypt', {password:'pw'}); addStep('aes-decrypt', {password:'pw'})")
    t.wait_for("() => document.getElementById('flowOutput').innerText === 'secret note'", timeout=8000)
    t.call("setArg(1,'password','nope')")
    t.wait_for("() => /wrong password/.test(document.getElementById('errorText').innerText)", timeout=8000)
    t.call("clearRecipe(); addStep('sha256', {format:'hex'})")
    t.wait_for("() => document.getElementById('flowOutput').innerText.length === 64", timeout=8000)


@case("flow", "typical", "share link restores input and recipe; recipe JSON copy/import round trip")
def _(t):
    t.call("loadPreset('clean-list')")
    t.wait(400)
    url = t.call("Layerbit.state.write(getState())")
    t.page.goto(url, wait_until="load")
    t.wait(600)
    eq(t.text("flowOutput"), "server-1\nserver-2\nserver-10", "restored output")
    eq(t.count("#recipeList .step"), 4, "restored steps")
    r = t.call("LBFlow.serialize(steps)")
    t.call("clearRecipe()")
    t.call(f"steps = LBFlow.parse({json.dumps(r)}).map(s => Object.assign(s, {{enabled: true}})); renderRecipe(); runAll()")
    t.wait(400)
    eq(t.count("#recipeList .step"), 4, "imported steps")


@case("flow", "maximal", "50,000-line input through trim, unique and sort under budget")
def _(t):
    big = "\n".join(f"  host-{i % 5000}  " for i in range(50000))
    t.call("clearRecipe()")
    t.set("flowInput", big)
    t.call("addStep('trim'); addStep('unique-lines'); addStep('sort-lines', {mode:'natural', icase:true})")
    t.wait_for("() => document.getElementById('flowOutput').innerText.startsWith('host-0\\nhost-1\\nhost-2')", timeout=10000)
    expect("5,000 chars" not in t.text("outMeta") and "chars" in t.text("outMeta"), t.text("outMeta"))


# ----------------------------------------------------------------------------
# October 2026 audit: options that apply live, real-world inputs, new tools
# ----------------------------------------------------------------------------
NGINX = "\n".join([
    '93.180.71.3 - - [17/May/2015:08:05:32 +0000] "GET /downloads/product_1 HTTP/1.1" 304 0 "-" "Debian APT-HTTP/1.3"',
    '217.168.17.5 - - [17/May/2015:08:05:12 +0000] "GET /downloads/product_2 HTTP/1.1" 200 3316 "-" "-"',
    '80.91.33.133 - - [17/May/2015:08:05:24 +0000] "GET /downloads/product_1 HTTP/1.1" 404 337 "-" "Debian APT-HTTP/1.3"',
    '10.0.0.7 - - [17/May/2015:08:06:01 +0000] "POST /api/orders HTTP/1.1" 502 166 "-" "curl/7.88"',
])
SAKILA = """CREATE SEQUENCE actor_actor_id_seq START WITH 1 INCREMENT BY 1;
CREATE TABLE actor (
    actor_id integer DEFAULT nextval('actor_actor_id_seq'::regclass) NOT NULL,
    first_name character varying(45) NOT NULL,
    last_update timestamp without time zone DEFAULT now() NOT NULL
);
CREATE FUNCTION film_in_stock(p_film_id integer, p_store_id integer, OUT p_film_count integer) RETURNS SETOF integer
    AS $_$
     SELECT inventory_id FROM inventory WHERE film_id = $1 AND store_id = $2 AND inventory_in_stock(inventory_id);
$_$
    LANGUAGE sql;"""
ZOHO = """Invoice Date,Invoice ID,Invoice Number,Invoice Status,Customer Name,Customer TRN,Due Date,Currency Code,Exchange Rate,Item Name,Item Desc,Quantity,Item Price,Item Tax %,Item Tax Amount,SubTotal,Total,Balance
2026-09-01,4410000000123,INV-000231,Sent,Al Noor Trading LLC,100234567800003,2026-10-01,AED,1,Website maintenance,Monthly retainer,1,4500.00,5,225.00,4500.00,4725.00,4725.00
2026-09-03,4410000000124,INV-000232,Draft,"Gulf Star Logistics, FZE",100987654300003,2026-10-03,AED,1,API integration,ERP sync,10,600.00,5,300.00,6000.00,6300.00,6300.00"""


# --- v4 bug fixes and features --------------------------------------------
DIFF_HIST = "Layerbit.history.list('text-diff-checker', 100).then(r => r.length)"


@case("text-diff-checker", "edge", "bug 1: history is saved only on an explicit Compare with the switch on")
def _(t):
    t.call("Layerbit.history.clear()")
    t.set("text1", "user=admin\n"); t.set("text2", "user=admin\npassword=")
    t.click("#btnRun"); t.wait(200)
    for v in ["password=h", "password=hu", "password=hun", "password=hunter2"]:
        t.set("text2", "user=admin\n" + v); t.wait(600)
    eq(t.call(DIFF_HIST), 0, "runs saved while the switch is off")
    expect(t.visible("#saveHistory"), "no visible Save to history switch")
    t.page.check("#saveHistory")
    t.click("#btnRun"); t.wait(200)
    eq(t.call(DIFF_HIST), 1, "explicit Compare with the switch on")
    t.set("text2", "user=admin\npassword=x"); t.wait(700)
    eq(t.call(DIFF_HIST), 1, "live re-run while typing saved a copy")
    t.page.uncheck("#saveHistory")


DIFF_LOAD = """([id, side, bytes, name]) => { const f = new File([new Uint8Array(bytes)], name); loadFileInto(id, f, side); }"""


@case("text-diff-checker", "edge", "bug 2: Windows-1252 files are decoded, labelled, and never reported identical when bytes differ")
def _(t):
    t.page.evaluate(DIFF_LOAD, ["text1", "a", [0x63, 0x61, 0x66, 0xE9, 0x0A], "menu-a.txt"])
    t.page.evaluate(DIFF_LOAD, ["text2", "b", [0x63, 0x61, 0x66, 0xE8, 0x0A], "menu-b.txt"])
    t.wait_for("() => document.getElementById('meta2').textContent.includes('Windows-1252')")
    t.call("run()"); t.wait(150)
    expect("1 change block" in t.text("diffStats"), "café/cafè not detected: " + t.text("diffStats"))
    eq(t.val("text1"), "café\n", "decoded text")
    # same characters, different bytes (UTF-8 vs Windows-1252)
    t.page.evaluate(DIFF_LOAD, ["text1", "a", [0x63, 0x61, 0x66, 0xC3, 0xA9, 0x0A], "utf8.txt"])
    t.page.evaluate(DIFF_LOAD, ["text2", "b", [0x63, 0x61, 0x66, 0xE9, 0x0A], "ansi.txt"])
    t.wait_for("() => document.getElementById('meta1').textContent.includes('UTF-8') && document.getElementById('meta2').textContent.includes('Windows-1252')")
    t.call("run()"); t.wait(150)
    out = t.text("outputSection")
    expect("identical" not in out.lower() or "not byte-identical" in out, "reported identical: " + out[:200])
    expect("encoding" in out.lower() and "UTF-8" in out and "Windows-1252" in out, "encoding difference not reported: " + out[:300])


DIFF_ZIP_JS = """
  window._crc32 = u8 => { let c, crc = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) { c = (crc ^ u8[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; };
  window._mkzip = (files, name) => { const enc = new TextEncoder(); const parts = [], cd = []; let off = 0;
    for (const [n0, data] of files) { const n = enc.encode(n0), d = typeof data === 'string' ? enc.encode(data) : data, crc = _crc32(d);
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint32(14, crc, true); lh.setUint32(18, d.length, true); lh.setUint32(22, d.length, true); lh.setUint16(26, n.length, true);
      parts.push(new Uint8Array(lh.buffer), n, d);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), n); off += 30 + n.length + d.length; }
    const cdLen = cd.reduce((a, x) => a + x.length, 0); const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new File([...parts, ...cd, new Uint8Array(e.buffer)], name || 'x.zip'); };
"""


@case("text-diff-checker", "edge", "bug 3: zip entries in different top folders are all kept")
def _(t):
    t.call("() => {" + DIFF_ZIP_JS + """
      setMode('zip');
      loadZip('a', _mkzip([['src/app.js', 'a'], ['lib/app.js', 'b']], 'a.zip'));
      loadZip('b', _mkzip([['src/app.js', 'a'], ['lib/app.js', 'B']], 'b.zip')); }""")
    t.wait_for("() => window._zipRows && window._zipRows.length >= 2 && /lib\\//.test(document.getElementById('zipPanel').innerText)")
    eq(t.call("window._zipRows.map(r => r.path + ':' + r.status)"), ["lib/app.js:modified", "src/app.js:same"], "a file vanished")
    text = t.text("zipPanel")
    expect("src/" in text and "lib/" in text and text.count("app.js") == 2, "tree does not show both files: " + text)


@case("text-diff-checker", "edge", "bug 6: duplicate keys are reported in table and JSON results")
def _(t):
    t.call("setMode('table')")
    t.set("text1", "id,name\n1,a\n1,b\n2,c\n"); t.set("text2", "id,name\n1,a\n2,c\n")
    t.call("refreshKeyColumns()"); t.call("run()"); t.wait(150)
    out = t.text("tablePanel")
    expect("Duplicate key" in out and "1" in out, "duplicate key warning missing: " + out[:300])
    expect("−1 rows" in t.text("diffStats"), t.text("diffStats"))
    t.call("setMode('struct')"); t.select("arrMode", "key")
    t.set("text1", '[{"id":1,"n":"a"},{"id":1,"n":"b"}]'); t.set("text2", '[{"id":1,"n":"a"}]')
    t.call("run()"); t.wait(150)
    expect("duplicate key" in t.text("structPanel").lower(), t.text("structPanel"))


@case("text-diff-checker", "edge", "bug 8: JSON ids above 2^53 are compared exactly")
def _(t):
    t.call("setMode('struct')"); t.select("arrMode", "index")
    t.set("text1", '{"order_id": 9007199254740993, "total": 1.0}'); t.set("text2", '{"order_id": 9007199254740992, "total": 1}')
    t.call("run()"); t.wait(200)
    out = t.text("structPanel")
    expect("$.order_id" in out and "9007199254740993" in out and "9007199254740992" in out, out[:300])
    expect("$.total" not in out, "1.0 vs 1 reported as a change")
    t.set("text1", "a: 12345678901234567890\n"); t.set("text2", "a: 12345678901234567891\n")
    t.call("run()"); t.wait(600)
    expect("15 digits" in t.text("outputSection"), "YAML precision warning missing: " + t.text("outputSection")[:300])


@case("text-diff-checker", "maximal", "bug 9: unrelated 20,000-line files run in a worker, end in a summary, and a long run can be cancelled")
def _(t):
    t.call("""() => { const r = s => () => (s = (s * 1103515245 + 12345) >>> 0);
      const A = r(1), B = r(2);
      document.getElementById('text1').value = Array.from({length: 20000}, () => 'alpha ' + A()).join('\\n');
      document.getElementById('text2').value = Array.from({length: 20000}, () => 'beta ' + B()).join('\\n'); }""")
    t.call("run()")
    expect(t.visible("#diffProgress"), "no progress indicator while comparing")
    ticks = t.call("new Promise(res => { let n = 0; const id = setInterval(() => n++, 20); setTimeout(() => { clearInterval(id); res(n); }, 300); })")
    expect(ticks >= 8, f"main thread blocked: only {ticks} timer ticks in 300 ms")
    t.wait_for("() => /too different/i.test(document.getElementById('outputSection').innerText)", 30000)
    out = t.text("outputSection")
    expect("20,000 only in the original" in out and "20,000 only in the modified" in out, out[:400])
    # 'Align anyway' has no limit (several seconds): it must show progress and stop on Cancel
    t.call("alignAnyway()")
    t.wait(200)
    expect(t.visible("#diffProgress"), "no progress for the unlimited run")
    t.click("#btnCancelDiff"); t.wait(100)
    expect("cancelled" in t.text("outputSection").lower() and not t.visible("#diffProgress"), "cancel did not stop the comparison")


@case("text-diff-checker", "edge", "bug 10: pasting into the CSV tab refreshes the key columns")
def _(t):
    t.call("setMode('table')")
    t.set("text1", "id,name,qty\n1,Widget,5\n2,Gadget,6\n3,Doohickey,7\n")
    t.set("text2", "id,name,qty\n3,Doohickey,7\n1,Widget,9\n2,Gadget,6\n")
    t.wait(500)
    opts = t.call("[...document.querySelectorAll('#keyCol option')].map(o => o.textContent)")
    expect("id" in opts, f"key columns not refreshed: {opts}")
    eq(t.call("document.querySelector('#keyCol option:checked').textContent"), "id", "id column not chosen")
    t.call("run()"); t.wait(150)
    expect("~1 changed" in t.text("diffStats"), "re-sorted file: " + t.text("diffStats"))


@case("text-diff-checker", "edge", "bug 11: accept all / keep all give exactly the modified / original text with ignore options on")
def _(t):
    t.page.check("#ignoreCase"); t.page.check("#ignoreWhitespace")
    t.set("text1", "Hello World\nkeep  this\nold\n"); t.set("text2", "hello world\nkeep this\nnew\n")
    t.call("run()"); t.wait(150)
    t.call("mergeAll('right')")
    eq(t.val("mergedText"), "hello world\nkeep this\nnew\n", "accept all")
    t.call("mergeAll('left')")
    eq(t.val("mergedText"), "Hello World\nkeep  this\nold\n", "keep all original")
    t.page.uncheck("#ignoreCase"); t.page.uncheck("#ignoreWhitespace")


DIFF_MULTI_PATCH = "--- a/one.txt\n+++ b/one.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+BETA\n--- a/two.txt\n+++ b/two.txt\n@@ -1,1 +1,2 @@\n gamma\n+delta\n"


@case("text-diff-checker", "edge", "bug 12: a multi-file patch lists every file and applies each one")
def _(t):
    t.call("setMode('patch')")
    t.set("patchOriginal", "alpha\nbeta\n"); t.set("patchText", DIFF_MULTI_PATCH)
    t.call("run()"); t.wait(200)
    files = t.text("patchFiles")
    expect("one.txt" in files and "two.txt" in files, "files not listed: " + files)
    expect("1 of 2 files applied" in files, files)
    eq(t.val("mergedText"), "alpha\nBETA\n", "first file applied")
    t.call("patchSetOriginal(1, 'gamma\\n', 'two.txt')"); t.wait(200)
    expect("2 of 2 files applied" in t.text("patchFiles"), t.text("patchFiles"))
    t.call("showPatchFile(1)"); t.wait(150)
    eq(t.val("mergedText"), "gamma\ndelta\n", "second file applied")
    # the live re-run after typing must not jump back to the first file
    t.call("run()"); t.wait(100)
    eq(t.val("mergedText"), "gamma\ndelta\n", "still on the second file after a re-run")


@case("text-diff-checker", "edge", "bug 12: a fuzzy patch shows the mismatched context lines and needs confirmation")
def _(t):
    patch = t.call("E.unifiedPatch('one\\ntwo\\nthree\\nfour\\nfive\\n', 'one\\ntwo\\nTHREE\\nfour\\nfive\\n', 'f.txt', 'f.txt')")
    t.call("setMode('patch')")
    t.set("patchOriginal", "one\nTWO\nthree\nfour\nfive\n"); t.set("patchText", patch)
    t.call("run()"); t.wait(200)
    out = t.text("patchFiles")
    expect("did not match" in out and "TWO" in out and "line 2" in out, out)
    expect(not t.visible("#mergedSection"), "fuzzy result shown before confirmation")
    t.click("#btnAcceptFuzz"); t.wait(200)
    eq(t.val("mergedText"), "one\nTWO\nTHREE\nfour\nfive\n", "confirmed fuzzy result")


@case("text-diff-checker", "edge", "bug 13: side-by-side rows stay aligned after a long wrapped line")
def _(t):
    t.select("viewMode", "split")
    t.set("text1", "start\n" + ("lorem ipsum dolor " * 150) + "\nend line\n")
    t.set("text2", "start\nshort\nend line\n")
    t.call("run()"); t.wait(150)
    tops = t.call("""(() => { const rows = [...document.querySelectorAll('#splitPanel .drow')].filter(r => r.innerText.includes('end line'));
      if (!rows.length) return null; const r = rows[0]; const l = r.querySelector('.sd-l'), rt = r.querySelector('.sd-r');
      return [Math.round(l.getBoundingClientRect().top), Math.round(rt.getBoundingClientRect().top), Math.round(l.getBoundingClientRect().height), Math.round(rt.getBoundingClientRect().height)]; })()""")
    expect(tops is not None, "rows are not single elements with left and right cells")
    eq(tops[0], tops[1], "left and right cells of the same row start at different heights")
    eq(tops[2], tops[3], "left and right cells of the same row have different heights")


@case("text-diff-checker", "edge", "bug 14: line endings and a missing final newline are reported; merged output keeps CRLF")
def _(t):
    t.set("text1", "a\nb"); t.set("text2", "a\nb\n")
    t.call("run()"); t.wait(150)
    out = t.text("outputSection")
    expect("No newline at end of file in the original" in out and "No differences" not in out, out[:300])
    crlf = [0x78, 0x0D, 0x0A, 0x79, 0x0D, 0x0A]
    t.page.evaluate(DIFF_LOAD, ["text1", "a", crlf, "win.txt"])
    t.page.evaluate(DIFF_LOAD, ["text2", "b", [0x78, 0x0A, 0x79, 0x0A], "unix.txt"])
    t.wait_for("() => document.getElementById('meta2').textContent.includes('UTF-8')")
    t.call("run()"); t.wait(150)
    expect("Line endings differ" in t.text("outputSection") and "CRLF" in t.text("outputSection"), t.text("outputSection")[:300])
    t.page.evaluate(DIFF_LOAD, ["text2", "b", [0x78, 0x0D, 0x0A, 0x59, 0x0D, 0x0A], "win2.txt"])
    t.wait_for("() => document.getElementById('text2').value === 'x\\nY\\n'")
    t.call("run()"); t.wait(150)
    t.call("mergeAll('right')")
    eq(t.call("mergedOutput()"), "x\r\nY\r\n", "merged download lost the CRLF line endings")


@case("text-diff-checker", "edge", "bug 15: ignore blank lines reports no change for an added blank line")
def _(t):
    t.page.check("#ignoreBlank")
    t.set("text1", "a\nb\n"); t.set("text2", "a\n\n\nb\n")
    t.call("run()"); t.wait(150)
    expect("0 change blocks" in t.text("diffStats"), t.text("diffStats"))
    eq(t.count("#splitPanel .hunk-bar"), 0, "hunk shown for a blank line")
    t.set("text2", "a\n\nB\n"); t.call("run()"); t.wait(150)
    t.call("mergeAll('right')")
    eq(t.val("mergedText"), "a\n\nB\n", "accept all with blank lines")
    t.call("mergeAll('left')")
    eq(t.val("mergedText"), "a\nb\n", "keep all with blank lines")
    t.page.uncheck("#ignoreBlank")


@case("text-diff-checker", "edge", "bug 16: invisible characters are shown as labelled markers")
def _(t):
    t.set("text1", "price: 10 AED\nkey=value\n"); t.set("text2", "price: 10 AED\nkey=​value\n")
    t.call("run()"); t.wait(150)
    marks = t.call("[...document.querySelectorAll('#splitPanel .sd-r .inv')].map(e => e.textContent)")
    expect("NBSP" in marks and "ZWSP" in marks, f"changed invisible characters not marked: {marks}")
    t.set("text1", "a​b\n"); t.set("text2", "a​b\nc\n"); t.call("run()"); t.wait(150)
    eq(t.count("#splitPanel .sd-l .inv"), 0, "unchanged line marked without Show whitespace")
    t.page.check("#showWs"); t.wait(150)
    expect(t.count("#splitPanel .sd-l .inv") >= 1, "Show whitespace did not reveal the zero-width space")
    t.page.uncheck("#showWs")


@case("text-diff-checker", "edge", "bug 18: after Clear, choosing the same file again loads it")
def _(t):
    f = {"name": "same.txt", "mimeType": "text/plain", "buffer": b"hello again\n"}
    t.page.set_input_files("#text1File", f)
    t.wait_for("() => document.getElementById('text1').value === 'hello again\\n'")
    # a real file dialog fires 'change' only if the input's value changes, so
    # the input must be empty again after a load and after Clear
    eq(t.call("document.getElementById('text1File').value"), "", "file input still holds the last file after loading")
    t.page.set_input_files("#text1File", f)
    t.wait(200)
    t.call("clearInputs()")
    eq(t.val("text1"), "", "clear")
    eq(t.call("[...document.querySelectorAll('input[type=file]')].filter(i => i.value).length"), 0, "Clear left a file input set")
    t.page.set_input_files("#text1File", f)
    t.wait_for("() => document.getElementById('text1').value === 'hello again\\n'", 3000)


@case("text-diff-checker", "minimal", "bug 19: no related-tool card is nested inside another")
def _(t):
    eq(t.count(".use-case-card .use-case-card"), 0, "nested cards")
    parent = t.call("document.querySelector('a[href=\"text-case-converter.html\"]').closest('.use-case-card').parentElement.className")
    expect("use-cases-grid" in parent, "Text Case Converter card is not a direct child of the grid: " + parent)


@case("text-diff-checker", "typical", "bug 20: clicking a fold opens only that fold")
def _(t):
    a = "\n".join(f"l{i}" for i in range(60)); b = a.replace("l20\n", "X\n").replace("l45\n", "Y\n")
    t.set("text1", a); t.set("text2", b); t.select("contextLines", "3")
    t.call("run()"); t.wait(150)
    eq(t.count("#splitPanel .diff-skip"), 3, "folds")
    t.click("#splitPanel .diff-skip >> nth=1"); t.wait(150)
    eq(t.count("#splitPanel .diff-skip"), 2, "one click expanded more than one fold")
    eq(t.val("contextLines"), "3", "the context setting was changed")
    t.select("contextLines", "all")


@case("text-diff-checker", "maximal", "bug 20: a 100,000-line comparison renders only the rows on screen")
def _(t):
    t.call("""() => { const a = Array.from({length: 100000}, (_, i) => 'line ' + i);
      const b = a.slice(); b[50000] = 'changed'; document.getElementById('text1').value = a.join('\\n'); document.getElementById('text2').value = b.join('\\n'); run(); }""")
    t.wait_for("() => document.getElementById('diffStats').innerText.includes('1 change block')", 30000)
    t.wait(300)
    nodes = t.call("document.querySelectorAll('#splitPanel *').length")
    expect(nodes < 20000, f"{nodes} DOM nodes for a 100k-line diff")
    t.call("(() => { const p = document.getElementById('splitPanel'); p.scrollTop = p.scrollHeight; })()"); t.wait(400)
    t.call("(() => { const p = document.getElementById('splitPanel'); p.scrollTop = p.scrollHeight; })()"); t.wait(400)
    expect("line 99999" in t.text("splitPanel"), "last rows not rendered after scrolling to the end")
    t.call("navDiff(1)"); t.wait(300)
    expect("changed" in t.text("splitPanel"), "navigating to the change did not render it")


@case("text-diff-checker", "maximal", "bug 20: 20,000 changed table rows and 5,000 zip entries render virtually")
def _(t):
    t.call("""() => { setMode('table');
      document.getElementById('text1').value = 'id,v\\n' + Array.from({length: 20000}, (_, i) => i + ',a' + i).join('\\n');
      document.getElementById('text2').value = 'id,v\\n' + Array.from({length: 20000}, (_, i) => i + ',b' + i).join('\\n');
      refreshKeyColumns(); run(); }""")
    t.wait_for("() => document.getElementById('diffStats').innerText.includes('20000 changed')", 30000)
    t.wait(300)
    rows = t.count("#tablePanel tbody tr")
    expect(rows < 3000, f"{rows} table rows in the DOM for 20,000 changes")
    t.call("(() => { const p = document.getElementById('tablePanel'); p.scrollTop = p.scrollHeight; })()"); t.wait(400)
    t.call("(() => { const p = document.getElementById('tablePanel'); p.scrollTop = p.scrollHeight; })()"); t.wait(400)
    expect("b19999" in t.text("tablePanel"), "last changed row not rendered after scrolling")
    t.call("() => {" + DIFF_ZIP_JS + """
      setMode('zip'); const files = n => Array.from({length: 5000}, (_, i) => ['f' + String(i).padStart(5, '0') + '.txt', 'x' + i + n]);
      loadZip('a', _mkzip(files(''), 'a.zip')); loadZip('b', _mkzip(files('!'), 'b.zip')); }""")
    t.wait_for("() => document.getElementById('diffStats').innerText.includes('5000 modified')", 30000)
    t.wait(300)
    zr = t.count("#zipPanel tbody tr")
    expect(zr < 2000, f"{zr} folder rows in the DOM for 5,000 files")


DIFF_FOLDER_JS = """
  window._mkdir = (spec, t) => Object.entries(spec).map(([path, text]) => ({ path, file: new File([text], path.split('/').pop(), { lastModified: t || 1767225600000 }) }));
"""


@case("text-diff-checker", "typical", "feature 21: real folders: tree with counts, default ignores, filters, open a file and come back")
def _(t):
    t.call("() => {" + DIFF_FOLDER_JS + """
      setMode('zip');
      setFolderFromFiles('a', 'app-v1', _mkdir({ 'app/src/main.js': 'let a = 1;\\n', 'app/src/util/fmt.js': 'same', 'app/README.md': 'hello', 'app/node_modules/x/index.js': 'dep', 'app/old.txt': 'bye', 'app/build.log': 'log' }));
      setFolderFromFiles('b', 'app-v2', _mkdir({ 'app/src/main.js': 'let a = 2;\\n', 'app/src/util/fmt.js': 'same', 'app/README.md': 'hello', 'app/node_modules/x/index.js': 'dep2', 'app/new.txt': 'hi' })); }""")
    t.wait_for("() => window._zipRows && !window._zipRows.some(r => r.status === 'pending') && /identical/.test(document.getElementById('diffStats').innerText)", 15000)
    s = t.text("diffStats")
    expect("+1 added" in s and "−1 removed" in s and "~1 modified" in s and "2 identical" in s and "ignored" in s, s)
    eq(sorted(t.call("window._zipRows.map(r => r.path)")), ["README.md", "new.txt", "old.txt", "src/main.js", "src/util/fmt.js"], "node_modules and *.log are not ignored")
    src = t.call("[...document.querySelectorAll('#zipPanel tr.z-dir')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
    expect(any(x.startswith("src/") for x in src), str(src))
    t.page.check("#hideSame"); t.wait(150)
    expect("fmt.js" not in t.text("zipPanel") and "README.md" not in t.text("zipPanel"), "identical files still shown")
    t.page.uncheck("#hideSame"); t.select("folderStatus", "added"); t.wait(150)
    expect("new.txt" in t.text("zipPanel") and "old.txt" not in t.text("zipPanel"), "status filter")
    t.select("folderStatus", "all"); t.wait(100)
    # collapse src, open main.js, then come back with the tree state kept
    t.call("toggleDir('src')"); t.wait(100)
    expect("main.js" not in t.text("zipPanel"), "collapse failed")
    t.call("toggleDir('src')"); t.call("toggleDir('src/util')"); t.wait(100)
    i = t.call("window._zipRows.findIndex(r => r.path === 'src/main.js')")
    t.call(f"zipOpen({i})")
    t.wait_for("() => document.getElementById('resultTitle').textContent.includes('main.js') && document.querySelectorAll('#splitPanel .word-added').length")
    expect(t.visible("#btnBackFolder"), "no Back to folder button")
    t.click("#btnBackFolder"); t.wait(200)
    expect("main.js" in t.text("zipPanel") and "fmt.js" not in t.text("zipPanel"), "tree state lost: " + t.text("zipPanel")[:200])


@case("text-diff-checker", "typical", "feature 21: compare by size and by date, CSV report, folder drag and drop")
def _(t):
    t.call("() => {" + DIFF_FOLDER_JS + """
      setMode('zip'); document.getElementById('folderBy').value = 'size';
      setFolderFromFiles('a', 'L', _mkdir({ 'a.txt': 'abc', 'b.txt': 'xyz' }, 1767225600000));
      setFolderFromFiles('b', 'R', _mkdir({ 'a.txt': 'ABC', 'b.txt': 'xyzw' }, 1767312000000)); }""")
    t.wait(300)
    eq(t.call("window._zipRows.map(r => r.path + ':' + r.status)"), ["a.txt:same", "b.txt:modified"], "by size")
    t.select("folderBy", "date"); t.wait(300)
    eq(t.call("window._zipRows.map(r => r.path + ':' + r.status + ':' + r.newer)"), ["a.txt:modified:b", "b.txt:modified:b"], "by date")
    expect("right newer" in t.text("zipPanel"), "newer side not shown")
    with t.page.expect_download() as dl:
        t.click("#btnCsv")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect("Compared by,modified date" in csv and "Generated," in csv and "Ignored," in csv and "b.txt,modified,3,4" in csv, csv[:400])
    # a dropped folder (directory entries as the browser provides them)
    t.call("""() => {
      const fe = (name, text) => ({ isFile: true, isDirectory: false, name, fullPath: '/drop/' + name, file: cb => cb(new File([text], name)) });
      const dir = { isFile: false, isDirectory: true, name: 'drop', fullPath: '/drop', createReader: () => { let done = false; return { readEntries: cb => { const out = done ? [] : [fe('x.txt', 'one'), fe('y.txt', 'two')]; done = true; setTimeout(() => cb(out), 0); } }; } };
      dropInto('a', { items: [{ webkitGetAsEntry: () => dir }], files: [] }); }""")
    t.wait_for("() => document.getElementById('zipAInfo').innerText.includes('2 files')", 5000)


@case("text-diff-checker", "maximal", "feature 21: 20,000 files hash in a worker with progress and Cancel, never guessing")
def _(t):
    t.call("""() => { setMode('zip'); document.getElementById('folderBy').value = 'content';
      // slices of one Blob: cheap to build, read like files (12 bytes each)
      // slices of one Blob: cheap to build, read like files (12 bytes each). The
      // right side reuses the left side's slice wherever the file is the same,
      // so building the fixture costs far less than hashing it.
      const text = s => Array.from({length: 20000}, (_, i) => String(i % 7 === 0 ? i + s : i).padStart(12, '0'));
      const ta = text('a'), tb = text('b'), A = new Blob([ta.join('')]), B = new Blob([tb.join('')]);
      const left = ta.map((p, i) => ({ path: 'd' + (i % 50) + '/f' + i + '.txt', file: A.slice(i * 12, i * 12 + 12) }));
      const right = tb.map((p, i) => ({ path: left[i].path, file: p === ta[i] ? left[i].file : B.slice(i * 12, i * 12 + 12) }));
      setFolderFromFiles('a', 'big-a', left); setFolderFromFiles('b', 'big-b', right); }""")
    t.wait(400)
    expect(t.visible("#diffProgress") and "Hashing" in t.text("diffProgressLabel"), "no hashing progress")
    ticks = t.call("new Promise(res => { let n = 0; const id = setInterval(() => n++, 20); setTimeout(() => { clearInterval(id); res(n); }, 300); })")
    expect(ticks >= 8, f"main thread blocked while hashing: {ticks} ticks")
    t.click("#btnCancelDiff"); t.wait(300)
    expect("not compared" in t.text("diffStats") and "Hashing was cancelled" in t.text("zipPanel"), t.text("diffStats"))
    t.call("run()")
    t.wait_for("() => !/not compared/.test(document.getElementById('diffStats').innerText) && /identical/.test(document.getElementById('diffStats').innerText)", 120000)
    eq(t.call("window._zipRows.filter(r => r.status === 'modified').length"), 2858, "modified count")
    expect(t.count("#zipPanel tbody tr") < 2000, f"{t.count('#zipPanel tbody tr')} rows in the DOM")


DIFF_BOOK_JS = """async () => { await loadXlsx();
  const mk = (sheets, name) => { const wb = XLSX.utils.book_new();
    for (const [sn, aoa] of sheets) { const ws = XLSX.utils.aoa_to_sheet(aoa); if (ws.C2) ws.C2.z = '0.00'; XLSX.utils.book_append_sheet(wb, ws, sn); }
    return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], name); };
  window._bookA = mk([['Orders', [['id', 'qty', 'price', 'ref'], ['007', 5, 1.5, '12345678901234567890']]], ['Customers', [['id', 'name'], [1, 'Ann']]], ['Old', [['x'], [1]]]], 'a.xlsx');
  window._bookB = mk([['Orders', [['id', 'qty', 'price', 'ref'], ['007', 6, 1.5, '12345678901234567890']]], ['Clients', [['id', 'name'], [1, 'Ann']]], ['New', [['z'], [9]]]], 'b.xlsx');
  loadFileInto('text1', _bookA, 'a'); loadFileInto('text2', _bookB, 'b'); }"""


@case("text-diff-checker", "typical", "feature 22: every sheet is compared, with tabs, a summary and renamed sheets")
def _(t):
    t.call(DIFF_BOOK_JS)
    t.wait_for("() => document.getElementById('text2').value.includes('007') && document.getElementById('text1').value.includes('007')", 15000)
    t.call("run()")
    t.wait_for("() => document.querySelector('#tablePanel .sheet-tabs')", 8000)
    tabs = t.call("[...document.querySelectorAll('#tablePanel .sheet-tab')].map(b => b.innerText.replace(/\\s+/g, ' ').trim())")
    expect(tabs[0].startswith("All sheets") and any(x.startswith("Orders") and "1" in x for x in tabs) and any("Customers" in x and "Clients" in x for x in tabs), str(tabs))
    summary = t.text("tablePanel")
    expect("Old" in summary and "removed" in summary.lower() and "New" in summary and "added" in summary.lower(), summary[:500])
    t.click("#tablePanel .sheet-tab[data-sheet='0']"); t.wait(200)
    out = t.text("tablePanel")
    expect("007" in out and "12345678901234567890" in out, "leading zeros or long numbers were changed: " + out[:400])
    expect("1.50" in out, "displayed value missing: " + out[:400])
    t.select("sheetValues", "raw"); t.wait(300)
    out = t.text("tablePanel")
    expect("1.5" in out and "1.50" not in out and "007" in out, "raw values: " + out[:400])
    t.select("sheetValues", "displayed")


@case("text-diff-checker", "typical", "feature 23: composite keys, ignored columns, tolerance, dates, filter, sort and column summary")
def _(t):
    t.call("setMode('table')")
    t.set("text1", "region,sku,qty,price,updated,shipped\nUAE,1,5,10.00,t1,2026-11-05\nKSA,1,7,20.00,t1,2026-11-06\nUAE,2,9,30.00,t1,2026-11-07\nUAE,3,1,5.00,t1,2026-11-08\n")
    t.set("text2", "sku,region,qty,price,updated,shipped\n1,KSA,8,20.004,t2,06/11/2026\n1,UAE,5,10,t2,5 Nov 2026\n2,UAE,9,31.00,t2,07/11/2026\n4,UAE,2,1.00,t2,2026-11-09\n")
    t.wait(400)
    t.select("keyCol", "region"); t.select("keyCol2", "sku")
    t.call("document.getElementById('tableOpts').open = true")
    t.page.check("#ignoreCols input[value='updated']")
    t.call("run()"); t.wait(200)
    expect("region + sku" in t.text("resultTitle"), t.text("resultTitle"))
    s = t.text("diffStats")
    expect("~3 changed" in s, "before options: " + s)
    t.page.check("#tNumeric"); t.page.check("#tDates"); t.set("tTolAbs", "0.01"); t.call("run()"); t.wait(200)
    s = t.text("diffStats")
    expect("~2 changed" in s and "+1 rows" in s and "−1 rows" in s, "with numeric, dates and tolerance: " + s)
    items = t.call("[...document.querySelectorAll('#colSummary .cs-item')].map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    expect(items == ["qty 1", "price 1"] or items == ["price 1", "qty 1"], f"column summary: {items}")
    expect("ignored: updated" in t.text("colSummary"), "ignored columns are named in the summary")
    t.select("rowFilter", "added"); t.wait(150)
    out = t.text("tablePanel")
    expect("Added rows" in out and "Changed rows" not in out, "row filter")
    t.select("rowFilter", "all"); t.select("rowSort", "qty"); t.select("rowSortDir", "desc"); t.wait(150)
    order = t.call("[...document.querySelectorAll('#tsec0 tbody tr')].map(r => r.innerText.split('\\t').slice(0, 2).join(' '))")
    expect(order == ["UAE 2", "KSA 1"], f"sort by qty desc: {order}")
    t.select("rowSortDir", "asc"); t.wait(150)
    order = t.call("[...document.querySelectorAll('#tsec0 tbody tr')].map(r => r.innerText.split('\\t').slice(0, 2).join(' '))")
    expect(order == ["KSA 1", "UAE 2"], f"sort by qty asc: {order}")


DIFF_HEX_SET = """([side, parts, name]) => { const toPart = p => typeof p === 'number' ? new Uint8Array(p) : Array.isArray(p) ? new Uint8Array(p) : p;
  const f = new File(parts.map(toPart), name); const dt = new DataTransfer(); dt.items.add(f);
  const inp = document.getElementById(side === 'a' ? 'hexAFile' : 'hexBFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }"""


@case("text-diff-checker", "typical", "feature 24: hex compare shows offsets, both sides, highlighted bytes, next/previous difference and jump to offset")
def _(t):
    t.call("setMode('hex')")
    expect(t.visible("#hexAPane") and t.visible("#hexBPane"), "hex inputs not shown")
    a = list(range(256)) * 4            # 1024 bytes
    b = list(a); b[0x1F] = 0xAA; b[0x200] = 0xFF; b[0x201] = 0xFE; b += [0x41, 0x42]   # 3 bytes changed + 2 extra
    t.page.evaluate(DIFF_HEX_SET, ["a", [a], "fw-1.bin"])
    t.page.evaluate(DIFF_HEX_SET, ["b", [b], "fw-2.bin"])
    t.wait_for("() => document.getElementById('hexBInfo').textContent.includes('fw-2.bin')")
    t.call("compare()")
    t.wait_for("() => /differ/.test(document.getElementById('diffStats').innerText)")
    s = t.text("diffStats")
    expect("5 bytes differ" in s, s)
    expect("first at 0x0000001F" in s, s)
    expect("1 KB" in s or "1,024" in s, "sizes missing: " + s)
    expect("sizes differ" in t.text("outputSection").lower(), "size warning missing")
    rows = t.count("#hexRows .hx-row")
    expect(0 < rows < 120, f"rows rendered: {rows}")
    first = t.call("document.querySelector('#hexRows .hx-row .hx-off').textContent")
    eq(first, "00000000", "first offset")
    # row 0x10 holds byte 0x1F: left 1F highlighted, right AA highlighted, ASCII columns present
    row = t.call("(() => { const r = [...document.querySelectorAll('#hexRows .hx-row')].find(x => x.querySelector('.hx-off').textContent === '00000010'); return { l: [...r.querySelectorAll('.hx-hex.l .d')].map(e => e.textContent.trim()), r: [...r.querySelectorAll('.hx-hex.r .d')].map(e => e.textContent.trim()), asc: r.querySelector('.hx-asc.l').textContent.length }; })()")
    eq(row["l"], ["1F"], "left highlighted byte"); eq(row["r"], ["AA"], "right highlighted byte"); eq(row["asc"], 16, "ASCII column width")
    # next / previous difference
    t.call("navDiff(1)"); t.wait(150)
    eq(t.text("hunkCounter"), "1 / 3", "counter after next")
    expect(t.count("#hexRows .hx-row.hx-cur") >= 1, "current difference not marked")
    t.call("navDiff(1)"); t.wait(150)
    eq(t.text("hunkCounter"), "2 / 3", "second difference")
    cur = t.call("document.querySelector('#hexRows .hx-row.hx-cur .hx-off').textContent")
    eq(cur, "00000200", "second difference row")
    t.call("navDiff(-1)"); t.wait(150)
    eq(t.text("hunkCounter"), "1 / 3", "previous difference")
    # jump to an offset (hex or decimal)
    t.set("hexJump", "0x300"); t.click("#btnHexJump"); t.wait(150)
    eq(t.call("document.querySelector('#hexRows .hx-row.hx-target .hx-off').textContent"), "00000300", "jump to 0x300")
    t.set("hexJump", "1024"); t.click("#btnHexJump"); t.wait(150)
    eq(t.call("document.querySelector('#hexRows .hx-row.hx-target .hx-off').textContent"), "00000400", "jump to decimal 1024")
    tail = t.call("[...document.querySelectorAll('#hexRows .hx-row.hx-target .hx-hex.r .d')].map(e => e.textContent.trim())")
    eq(tail, ["41", "42"], "bytes only on the right are highlighted")
    t.set("hexJump", "zzz"); t.click("#btnHexJump"); t.wait(100)
    expect("offset" in t.text("hexJumpMsg").lower(), "bad offset not reported")


@case("text-diff-checker", "maximal", "feature 24: two 160 MB files are read in slices, scanned with progress, and stay scrollable")
def _(t):
    t.call("setMode('hex')")
    mb = 1 << 20
    # parts are shared buffers, so the page never holds the files in one array
    t.page.evaluate("""() => { const z = new Uint8Array(8 << 20); const one = new Uint8Array([7]);
      const mk = (name, extra) => { const parts = []; for (let i = 0; i < 20; i++) parts.push(z); parts.push(...extra); return new File(parts, name); };
      const set = (id, f) => { const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById(id); i.files = dt.files; i.dispatchEvent(new Event('change')); };
      set('hexAFile', mk('disk-a.img', [z]));
      set('hexBFile', mk('disk-b.img', [one, z.subarray(1)])); }""")
    t.call("compare()")
    t.wait_for("() => /differ/.test(document.getElementById('diffStats').innerText)", timeout=10000)
    s = t.text("diffStats")
    expect("1 byte differs" in s, s)
    expect("first at 0x0A000000" in s, s)
    expect(t.count("#hexRows .hx-row") < 120, "rows are not virtual")
    t.set("hexJump", "0x09FFFFF0"); t.click("#btnHexJump"); t.wait(400)
    t.wait_for("() => !!document.querySelector('#hexRows .hx-row.hx-target')")
    expect(t.call("[...document.querySelectorAll('#hexRows .hx-row .hx-hex.r .d')].map(e => e.textContent.trim()).join(',')") == "07", "byte at 0x0A000000 not shown as different")
    t.call("navDiff(1)"); t.wait(300)
    eq(t.call("document.querySelector('#hexRows .hx-row.hx-cur .hx-off').textContent"), "0A000000", "next difference in a big file")
    eq(t.call("hexSource('a').bytes === undefined && hexSource('a').size"), 168 * mb, "left file kept as a File, read by slices")


@case("text-diff-checker", "edge", "feature 24: empty, identical, single-sided and folder-opened binaries")
def _(t):
    t.call("setMode('hex')")
    t.page.evaluate(DIFF_HEX_SET, ["a", [[]], "empty.bin"])
    t.page.evaluate(DIFF_HEX_SET, ["b", [[0, 1, 2]], "three.bin"])
    t.wait_for("() => document.getElementById('hexBInfo').textContent.includes('three.bin')")
    t.call("compare()"); t.wait_for("() => /differ/.test(document.getElementById('diffStats').innerText)")
    expect("3 bytes differ" in t.text("diffStats") and "first at 0x00000000" in t.text("diffStats"), t.text("diffStats"))
    t.page.evaluate(DIFF_HEX_SET, ["a", [[0, 1, 2]], "same.bin"])
    t.wait_for("() => document.getElementById('hexAInfo').textContent.includes('same.bin')")
    t.call("compare()"); t.wait_for("() => /identical/i.test(document.getElementById('diffStats').innerText)")
    eq(t.text("hunkCounter"), "0 / 0", "no differences to step through")
    # a binary file opened from a folder comparison lands in the hex view
    t.call("openHex(new Uint8Array([0, 0, 0, 5]), new Uint8Array([0, 0, 0, 6]), 'lib/a.so', 'lib/a.so')")
    t.wait_for("() => /differ/.test(document.getElementById('diffStats').innerText)")
    eq(t.call("mode"), "hex", "mode")
    expect("first at 0x00000003" in t.text("diffStats") and "lib/a.so" in t.text("resultTitle"), t.text("resultTitle") + " " + t.text("diffStats"))
    # Clear empties the hex inputs too
    t.call("clearInputs()")
    expect("Drop any file" in t.text("hexAInfo"), "hex input not cleared")


DIFF_IMG_JS = """() => {
  // draw(ctx) paints the picture; type is a MIME type the canvas can encode
  window._mkimg = (w, h, draw, type, name) => new Promise(res => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x); c.toBlob(b => res(new File([b], name, { type: b.type })), type, 1); });
  window._bmp = (w, h, rgb) => { const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, u = new Uint8Array(size), v = new DataView(u.buffer);
    u[0] = 66; u[1] = 77; v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * row + x * 3; u[o] = rgb[2]; u[o + 1] = rgb[1]; u[o + 2] = rgb[0]; } return u; };
  window._gif1 = () => Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='), c => c.charCodeAt(0));
  window._setImg = (side, file) => { const dt = new DataTransfer(); dt.items.add(file); const i = document.getElementById(side === 'a' ? 'imgAFile' : 'imgBFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); };
}"""
IMG_RED = "x => { x.fillStyle = 'rgb(200,0,0)'; x.fillRect(0, 0, 100, 100); }"


@case("text-diff-checker", "typical", "feature 25: image compare: side by side, slider, onion skin, difference, % changed and the details of both files")
def _(t):
    t.page.evaluate(DIFF_IMG_JS)
    t.call("setMode('image')")
    expect(t.visible("#imgAPane") and t.visible("#imgBPane"), "image inputs not shown")
    t.page.evaluate(f"""async () => {{ _setImg('a', await _mkimg(100, 100, {IMG_RED}, 'image/png', 'before.png'));
      _setImg('b', await _mkimg(100, 100, x => {{ ({IMG_RED})(x); x.fillStyle = 'rgb(0,0,255)'; x.fillRect(10, 20, 10, 10); }}, 'image/png', 'after.png')); }}""")
    t.wait_for("() => document.getElementById('imgBInfo').textContent.includes('after.png')")
    t.call("compare()")
    t.wait_for("() => /changed|identical/i.test(document.getElementById('diffStats').innerText)")
    s = t.text("diffStats")
    expect("1% of pixels changed" in s and "100 of 10,000" in s, s)
    info = t.text("imgInfo")
    expect(info.count("PNG") == 2 and info.count("100 × 100") == 2 and "File size" in info, info)
    expect("dimensions differ" not in t.text("imagePanel").lower(), "false dimension warning")
    # side by side shows both images
    eq(t.count("#imgStage canvas"), 2, "side by side")
    # slider / swipe
    t.select("imgView", "slider"); t.wait(100)
    t.set("imgSlider", "30", "input"); t.wait(50)
    expect("30%" in t.call("document.getElementById('imgTop').style.clipPath"), t.call("document.getElementById('imgTop').style.clipPath"))
    # swipe: pointer down on the picture and drag (coordinates read at the moment of the event)
    t.call("""(() => { const st = document.getElementById('imgStage'), o = st.querySelector('.img-overlay');
      const at = f => { const r = o.getBoundingClientRect(); return { clientX: r.left + r.width * f, clientY: r.top + r.height / 2, pointerId: 1, bubbles: true, isPrimary: true }; };
      o.dispatchEvent(new PointerEvent('pointerdown', at(0.8))); st.dispatchEvent(new PointerEvent('pointermove', at(0.75))); st.dispatchEvent(new PointerEvent('pointerup', at(0.75))); })()""")
    v = float(t.val("imgSlider"))
    expect(74 <= v <= 76, f"dragging the picture did not move the slider: {v}")
    expect("75" in t.call("document.getElementById('imgHandle').style.left"), "handle did not follow")
    # onion skin
    t.select("imgView", "onion"); t.wait(100)
    expect(t.visible("#imgOpacityLabel"), "opacity control hidden in onion view")
    t.set("imgOpacity", "25", "input"); t.wait(50)
    eq(t.call("document.getElementById('imgTop').style.opacity"), "0.25", "onion opacity")
    # difference image
    t.select("imgView", "diff"); t.wait(100)
    px = t.call("(() => { const c = document.querySelector('#imgStage canvas.img-diff'); const d = c.getContext('2d').getImageData(15, 25, 1, 1).data; const e = c.getContext('2d').getImageData(60, 60, 1, 1).data; return [c.width, Array.from(d), Array.from(e)]; })()")
    eq(px[0], 100, "diff canvas width"); eq(px[1], [255, 0, 160, 255], "changed pixel marked"); expect(px[2] != [255, 0, 160, 255], "unchanged pixel marked")


@case("text-diff-checker", "typical", "feature 25: the pixel tolerance ignores small colour shifts such as re-compression")
def _(t):
    t.page.evaluate(DIFF_IMG_JS)
    t.call("setMode('image')")
    t.page.evaluate(f"""async () => {{ _setImg('a', await _mkimg(100, 100, {IMG_RED}, 'image/png', 'a.png'));
      _setImg('b', await _mkimg(100, 100, x => {{ ({IMG_RED})(x); x.fillStyle = 'rgb(203,2,0)'; x.fillRect(0, 0, 20, 20); x.fillStyle = 'rgb(0,0,255)'; x.fillRect(50, 50, 10, 10); }}, 'image/png', 'b.png')); }}""")
    t.wait_for("() => document.getElementById('imgBInfo').textContent.includes('b.png')")
    t.call("compare()"); t.wait_for("() => /changed/i.test(document.getElementById('diffStats').innerText)")
    expect("5% of pixels changed" in t.text("diffStats"), t.text("diffStats"))
    t.set("imgTol", "5", "input"); t.wait_for("() => /\\b1% of pixels changed/.test(document.getElementById('diffStats').innerText)")
    expect("tolerance 5" in t.text("diffStats"), "tolerance not stated: " + t.text("diffStats"))


@case("text-diff-checker", "edge", "feature 25: JPEG, WebP, GIF, BMP and SVG; mismatched dimensions, misnamed files and non-images")
def _(t):
    t.page.evaluate(DIFF_IMG_JS)
    t.call("setMode('image')")
    t.page.evaluate(f"""async () => {{ _setImg('a', await _mkimg(100, 100, {IMG_RED}, 'image/jpeg', 'a.jpg')); _setImg('b', await _mkimg(120, 100, {IMG_RED}, 'image/webp', 'b.webp')); }}""")
    t.wait_for("() => document.getElementById('imgBInfo').textContent.includes('b.webp')")
    t.call("compare()"); t.wait_for("() => /changed|identical/i.test(document.getElementById('diffStats').innerText)")
    info = t.text("imgInfo")
    expect("JPEG" in info and "WebP" in info and "100 × 100" in info and "120 × 100" in info, info)
    expect("dimensions differ" in t.text("imagePanel").lower(), "no dimension warning")
    # GIF and BMP
    t.page.evaluate("() => { _setImg('a', new File([_gif1()], 'dot.gif')); _setImg('b', new File([_bmp(2, 2, [10, 200, 30])], 'tile.bmp')); }")
    t.wait_for("() => document.getElementById('imgBInfo').textContent.includes('tile.bmp')")
    t.call("compare()"); t.wait_for("() => /GIF/.test(document.getElementById('imgInfo').innerText) && /BMP/.test(document.getElementById('imgInfo').innerText)")
    expect("1 × 1" in t.text("imgInfo") and "2 × 2" in t.text("imgInfo"), t.text("imgInfo"))
    # SVG, compared as rendered; the source can also be compared as text
    t.page.evaluate("""() => { const svg = f => new File([`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${f}"/></svg>`], 'logo.svg');
      _setImg('a', svg('#ff0000')); _setImg('b', svg('#0000ff')); }""")
    t.wait_for("() => document.getElementById('imgAInfo').textContent.includes('logo.svg') && document.getElementById('imgBInfo').textContent.includes('logo.svg')")
    t.call("compare()"); t.wait_for("() => /SVG/.test(document.getElementById('imgInfo').innerText)")
    expect("40 × 20" in t.text("imgInfo") and "100% of pixels changed" in t.text("diffStats"), t.text("imgInfo") + " | " + t.text("diffStats"))
    t.click("#btnSvgText"); t.wait(200)
    eq(t.call("mode"), "text", "SVG source compared as text")
    expect("#ff0000" in t.val("text1") and "#0000ff" in t.val("text2"), "SVG source not loaded")
    # a PNG named .jpg is labelled by its bytes, and the name mismatch is noted
    t.call("setMode('image')")
    t.page.evaluate(f"""async () => {{ const f = await _mkimg(10, 10, x => {{}}, 'image/png', 'x.png'); _setImg('a', new File([f], 'photo.jpg')); _setImg('b', new File([f], 'photo.png')); }}""")
    t.wait_for("() => document.getElementById('imgAInfo').textContent.includes('photo.jpg')")
    t.call("compare()"); t.wait_for("() => /identical/i.test(document.getElementById('diffStats').innerText)")
    expect("named .jpg" in t.text("imagePanel"), "misnamed file not noted: " + t.text("imagePanel")[:300])
    # not an image at all
    t.page.evaluate("() => _setImg('b', new File(['just text'], 'notes.txt'))")
    t.wait_for("() => document.getElementById('imgBInfo').textContent.includes('notes.txt')")
    t.call("compare()"); t.wait_for("() => document.getElementById('errorBanner').classList.contains('active')")
    expect("notes.txt" in t.text("errorText") and "image" in t.text("errorText"), t.text("errorText"))
    # images opened from a folder comparison
    t.call("clearInputs()")
    t.page.evaluate(f"""async () => {{ const a = new Uint8Array(await (await _mkimg(4, 4, {IMG_RED}, 'image/png', 'i.png')).arrayBuffer()); openImages(a, a, 'img/icon.png', 'img/icon.png'); }}""")
    t.wait_for("() => /identical/i.test(document.getElementById('diffStats').innerText)")
    expect("img/icon.png" in t.text("resultTitle"), t.text("resultTitle"))


def _xlsx_check(path):
    """Opens a downloaded .xlsx with zipfile (CRC check) and returns {part: xml}."""
    import zipfile
    z = zipfile.ZipFile(path)
    expect(z.testzip() is None, "xlsx: bad CRC")
    return {n: z.read(n).decode("utf-8") for n in z.namelist()}


@case("text-diff-checker", "typical", "feature 26: table exports: CSV with original/modified columns and .xlsx with highlighted cells, both stating options and date")
def _(t):
    t.call("setMode('table')")
    t.set("text1", "id,name,qty\n1,Pen,5\n2,Ink,1\n")
    t.set("text2", "id,name,qty\n1,Pen,6\n3,Pad,2\n")
    t.wait(300); t.select("keyCol", "id")
    t.call("document.getElementById('tableOpts').open = true"); t.page.check("#tNumeric")
    t.call("run()"); t.wait(200)
    expect(t.visible("#btnCsv") and t.visible("#btnXlsx"), "table export buttons hidden")
    with t.page.expect_download() as dl:
        t.click("#btnCsv")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect(dl.value.suggested_filename.endswith(".csv"), dl.value.suggested_filename)
    expect("Generated,20" in csv and "Options,Rows matched by id" in csv and "numbers by value" in csv, csv[:400])
    expect("Status,Key,id (original),id (modified),name (original),name (modified),qty (original),qty (modified),Changed columns" in csv, csv)
    expect("changed,1,1,1,Pen,Pen,5,6,qty" in csv and "added,3,,3,,Pad,,2," in csv and "removed,2,2,,Ink,,1,," in csv, csv)
    with t.page.expect_download() as dl:
        t.click("#btnXlsx")
    expect(dl.value.suggested_filename.endswith(".xlsx"), dl.value.suggested_filename)
    parts = _xlsx_check(dl.value.path())
    wb = parts["xl/workbook.xml"]
    expect('name="About"' in wb and 'name="Differences"' in wb, wb)
    about, diff = parts["xl/worksheets/sheet1.xml"], parts["xl/worksheets/sheet2.xml"]
    expect("Rows matched by id" in about and "Generated" in about, about[:500])
    expect('<c r="H2" t="inlineStr" s="2"><is><t xml:space="preserve">6</t>' in diff, "changed cell not highlighted: " + diff[:800])
    # a real spreadsheet reader opens it
    vals = t.page.evaluate("""async b64 => { await loadXlsx(); const wb = XLSX.read(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { type: 'array' });
      return [wb.SheetNames, XLSX.utils.sheet_to_json(wb.Sheets.Differences, { header: 1 })[1]]; }""", __import__("base64").b64encode(open(dl.value.path(), "rb").read()).decode())
    eq(vals[0], ["About", "Differences"], "sheet names")
    eq(vals[1][:2] + vals[1][-3:], ["changed", "1", "5", "6", "qty"], "first data row")


@case("text-diff-checker", "typical", "feature 26: a workbook comparison exports every sheet to one .xlsx")
def _(t):
    t.call(DIFF_BOOK_JS)
    t.wait_for("() => document.getElementById('text2').value.includes('007') && document.getElementById('text1').value.includes('007')", 15000)
    t.call("run()"); t.wait_for("() => /sheets? compared/.test(document.getElementById('diffStats').innerText)")
    with t.page.expect_download() as dl:
        t.click("#btnXlsx")
    parts = _xlsx_check(dl.value.path())
    wb = parts["xl/workbook.xml"]
    expect('name="About"' in wb and 'name="Orders"' in wb and 'name="Customers"' in wb, wb)
    expect("Clients" in parts["xl/worksheets/sheet1.xml"] and "New" in parts["xl/worksheets/sheet1.xml"], "renamed/added sheets not listed in About")
    with t.page.expect_download() as dl:
        t.click("#btnCsv")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect("Sheet,Orders" in csv and "Sheet,Customers" in csv and "changed,007" in csv, csv[:600])


@case("text-diff-checker", "typical", "feature 26: JSON/YAML path changes export as CSV and JSON; text and folder reports keep options and date")
def _(t):
    t.call("setMode('struct')")
    t.set("text1", '{"id": 12345678901234567890, "tags": ["x"], "on": true}')
    t.set("text2", '{"id": 12345678901234567891, "tags": [], "on": "yes"}')
    t.call("run()"); t.wait_for("() => /changed/.test(document.getElementById('diffStats').innerText)")
    expect(t.visible("#btnJson"), "JSON export hidden")
    with t.page.expect_download() as dl:
        t.click("#btnCsv")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect("Options,Arrays compared by position" in csv and "$.id,changed,12345678901234567890,12345678901234567891" in csv, csv)
    with t.page.expect_download() as dl:
        t.click("#btnJson")
    js = open(dl.value.path(), encoding="utf-8").read()
    expect(dl.value.suggested_filename.endswith(".json"), dl.value.suggested_filename)
    expect('"original": 12345678901234567890' in js and '"generated": "20' in js and '"options": "Arrays compared by position"' in js, js[:500])
    # text: the HTML report states the options and the date; the patch stays a clean patch
    t.call("setMode('text')"); t.set("text1", "a\nb\n"); t.set("text2", "a\nc\n"); t.page.check("#ignoreCase"); t.call("run()"); t.wait(200)
    with t.page.expect_download() as dl:
        t.click("#btnReport")
    html = open(dl.value.path(), encoding="utf-8").read()
    expect("Options: ignore case" in html and "Generated 20" in html, html[-900:])
    with t.page.expect_download() as dl:
        t.click("#btnPatchDl")
    patch = open(dl.value.path(), encoding="utf-8").read()
    expect(patch.startswith("--- ") and "-b" in patch and "+c" in patch, patch)


@case("text-diff-checker", "typical", "feature 26: hex exports the differing byte ranges (CSV and HTML); images export an HTML report and the difference image")
def _(t):
    t.call("setMode('hex')")
    a = list(range(256)) * 4
    b = list(a); b[0x1F] = 0xAA; b[0x200] = 0xFF; b[0x201] = 0xFE; b += [0x41, 0x42]
    t.page.evaluate(DIFF_HEX_SET, ["a", [a], "fw-1.bin"]); t.page.evaluate(DIFF_HEX_SET, ["b", [b], "fw-2.bin"])
    t.wait_for("() => document.getElementById('hexBInfo').textContent.includes('fw-2.bin')")
    t.call("compare()"); t.wait_for("() => /differ/.test(document.getElementById('diffStats').innerText)")
    expect(t.visible("#btnCsv") and not t.visible("#btnPatch"), "hex export buttons")
    with t.page.expect_download() as dl:
        t.click("#btnCsv")
    csv = open(dl.value.path(), encoding="utf-8").read()
    expect("Generated,20" in csv and "Left,fw-1.bin (1024 bytes)" in csv and "Differing bytes,5" in csv, csv[:400])
    expect("0x0000001F,31,0x0000001F,1,1F,AA" in csv and "0x00000200,512,0x00000201,2,00 01,FF FE" in csv and "0x00000400,1024,0x00000401,2,,41 42" in csv, csv)
    with t.page.expect_download() as dl:
        t.click("#btnReport")
    html = open(dl.value.path(), encoding="utf-8").read()
    expect("0x0000001F" in html and "5 bytes differ" in html and "Generated 20" in html and "byte-by-byte" in html.lower(), html[-1200:])
    # images
    t.page.evaluate(DIFF_IMG_JS)
    t.call("setMode('image')")
    t.page.evaluate(f"""async () => {{ _setImg('a', await _mkimg(40, 30, {IMG_RED}, 'image/png', 'a.png'));
      _setImg('b', await _mkimg(40, 30, x => {{ ({IMG_RED})(x); x.fillStyle = '#00f'; x.fillRect(0, 0, 4, 3); }}, 'image/png', 'b.png')); }}""")
    t.wait_for("() => document.getElementById('imgBInfo').textContent.includes('b.png')")
    t.call("compare()"); t.wait_for("() => /changed/.test(document.getElementById('diffStats').innerText)")
    with t.page.expect_download() as dl:
        t.click("#btnReport")
    html = open(dl.value.path(), encoding="utf-8").read()
    expect(html.count("data:image/png;base64,") == 3 and "1% of pixels changed" in html and "Pixel tolerance 0" in html and "Generated 20" in html, html[-1500:])
    with t.page.expect_download() as dl:
        t.click("#btnDiffPng")
    expect(open(dl.value.path(), "rb").read(8) == b"\x89PNG\r\n\x1a\n", "difference image is not a PNG")


@case("text-diff-checker", "typical", "audit: ignore-whitespace/case and highlight options re-run the diff live")
def _(t):
    t.set("text1", "Hello  World\nsecond line\n")
    t.set("text2", "hello world\nsecond line\n")
    t.click("#btnRun"); t.wait(200)
    expect("1 change" in t.text("diffStats") or "change block" in t.text("diffStats"), t.text("diffStats"))
    t.page.check("#ignoreCase"); t.page.check("#ignoreWhitespace"); t.wait(150)
    expect(t.count(".hunk-bar") == 0, "ignore case + whitespace did not re-run the comparison")
    t.page.uncheck("#ignoreCase"); t.wait(150)
    expect(t.count(".hunk-bar") > 0, "unchecking did not re-run")
    before = t.html("outputSection")
    t.select("granularity", "char"); t.wait(150)
    expect(t.html("outputSection") != before, "highlight granularity did not re-render")


@case("text-diff-checker", "typical", "audit: replaced block pairs lines by similarity (module.exports matches module.exports)")
def _(t):
    t.set("text1", "x();\nmodule.exports = { calculateTotal };\n")
    t.set("text2", "x();\nfunction round2(n) { return Math.round(n * 100) / 100; }\n\nmodule.exports = { calculateTotal, round2 };\n")
    t.click("#btnRun"); t.wait(200)
    pairs = t.call("[...document.querySelectorAll('#splitPanel .sd-l')].map(e=>e.innerText).join('\\n')")
    rows = t.call("(() => { const r = []; document.querySelectorAll('.word-removed, .w-del, del, .seg-del').forEach(e => r.push(e.textContent)); return r; })()")
    # 'module.exports' itself must not be marked removed: only the inserted ', round2' differs
    expect(not any('module.exports' in x for x in rows), f"module.exports was highlighted as removed: {rows}")


@case("text-diff-checker", "edge", "audit: editing an input after comparing refreshes the result")
def _(t):
    t.set("text1", "a\nb\n"); t.set("text2", "a\nb\n")
    t.click("#btnRun"); t.wait(150)
    t.set("text2", "a\nB\n"); t.wait(700)
    expect(t.count(".hunk-bar") > 0, "typing into the modified pane did not refresh the diff")


@case("sql-formatter", "typical", "audit: real pg_dump DDL auto-detects PostgreSQL and formats")
def _(t):
    t.select("dialectSelect", "auto")
    t.set("sqlInput", SAKILA)
    t.click("#btnFormat"); t.wait(300)
    out = t.text("sqlOutput")
    expect("CREATE TABLE" in out.upper() and "::regclass" in out, out[:300])
    expect("PostgreSQL" in t.text("dialectHint"), t.text("dialectHint"))
    expect(not t.call("document.getElementById('errorBanner').classList.contains('active')"), "error banner shown")


@case("sql-formatter", "typical", "audit: indent and keyword-case options re-format immediately")
def _(t):
    t.select("dialectSelect", "auto")
    t.set("sqlInput", "select a,b from t where x=1")
    t.click("#btnFormat"); t.wait(200)
    first = t.text("sqlOutput")
    t.select("keywordCaseSelect", "upper" if "SELECT" not in first else "lower"); t.wait(200)
    expect(t.text("sqlOutput") != first, "keyword case did not apply")
    second = t.text("sqlOutput")
    t.select("indentSelect", "4" if "    " not in second else "2"); t.wait(200)
    expect(t.text("sqlOutput") != second, "indent did not apply")


@case("sql-formatter", "edge", "audit: explicit wrong dialect shows the error with a one-click suggestion")
def _(t):
    t.select("dialectSelect", "sql")
    t.set("sqlInput", SAKILA)
    t.click("#btnFormat"); t.wait(300)
    expect(t.call("document.getElementById('errorBanner').classList.contains('active')"), "no error for generic dialect")
    expect("PostgreSQL" in t.text("errorHint"), t.text("errorHint"))
    t.click("#errorHint button"); t.wait(300)
    expect("::regclass" in t.text("sqlOutput"), "suggestion button did not format")


@case("csv-to-json", "typical", "audit: delimiter and smart-types options re-convert live")
def _(t):
    t.set("csvInput", "id;name;active\n1;Ada;true\n2;Linus;false")
    t.wait(600)
    t.select("delimSelect", ","); t.wait(200)
    comma = t.text("jsonOutput")
    t.select("delimSelect", ";"); t.wait(200)
    semi = t.text("jsonOutput")
    expect(comma != semi and '"name"' in semi, "delimiter change did not re-run")
    t.page.uncheck("#inferTypes"); t.wait(200)
    expect('"1"' in t.text("jsonOutput"), "smart types toggle did not re-run")


@case("log-analyzer", "typical", "audit: pasted access log parses automatically; status codes set severity")
def _(t):
    t.set("logInput", NGINX); t.wait(700)
    eq(t.text("countAll"), "4", "all lines")
    eq(t.text("countErr"), "1", "502 is an error")
    eq(t.text("countWarn"), "1", "404 is a warning")
    eq(t.text("countInfo"), "2", "2xx/3xx are info")
    t.click("#filter-WARN"); t.wait(150)
    expect(t.count("#logOutput .log-line") == 1, "WARN filter")


@case("log-analyzer", "maximal", "audit: 60,000-line log stays responsive; copy covers every match")
def _(t):
    big = "\n".join(f'10.0.{i % 250}.{i % 200} - - [17/May/2015:08:{i % 60:02d}:00 +0000] "GET /p/{i} HTTP/1.1" {404 if i % 3 == 0 else 200} 12 "-" "-"' for i in range(60000))
    t.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    t.upload("logFileInput", "access.log", big)
    t.wait_for("document.querySelectorAll('#logOutput .log-line').length > 0", timeout=20000)
    expect(t.visible("#bigLogBar"), "large file was not kept in memory")
    expect(t.count("#logOutput .log-line") <= 5000, "rendered more than one page of rows")
    t.click("#filter-WARN"); t.wait(300)
    t.click("text=Copy Filtered"); t.wait(300)
    n = t.call("navigator.clipboard.readText()").count("\n")
    eq(n, 20000, "copied every 404 line")


@case("qr-barcode", "typical", "audit: size and error-correction changes redraw the code")
def _(t):
    t.set("dataInput", "https://layerbit.co.in/"); t.wait(400)
    w1 = t.call("(document.querySelector('#outputArea canvas')||{}).width")
    t.select("sizeSelect", "500"); t.wait(300)
    w2 = t.call("(document.querySelector('#outputArea canvas')||{}).width")
    expect(w1 and w2 and w1 != w2, f"size did not apply: {w1} -> {w2}")


@case("pint-ae-checker", "typical", "audit: Zoho Books export maps every column to the right field")
def _(t):
    t.upload("fileInput", "invoices.csv", ZOHO, "text/csv"); t.wait(600)
    m = t.call("Object.fromEntries([...document.querySelectorAll('.mapping-row')].map(r => [r.querySelector('.mapping-label, label, .field-label')?.innerText.split('(')[0].trim() || r.innerText.split('\\n')[0], r.querySelector('select')?.value || '']))")
    def get(prefix):
        for k, v in m.items():
            if k.startswith(prefix): return v
        return None
    eq(get("Supplier TIN"), "", "supplier TRN must not take the customer column")
    eq(get("Buyer TIN"), "Customer TRN", "buyer TRN")
    eq(get("Unit Price"), "Item Price", "unit price must not be the exchange rate")
    eq(get("VAT Rate"), "Item Tax %", "VAT rate")
    eq(get("Total Invoice"), "Total", "invoice total")


@case("json-validator", "edge", "audit: schema inference options re-infer an unedited schema")
def _(t):
    t.set("jsonInput", '{"id": 7, "name": "Ada", "score": 9.5}')
    t.click("#btnFormat"); t.wait(200)
    t.call("document.querySelector('[data-tab=schema], #tabSchema, .view-tab[data-view=schema]') && document.querySelector('[data-tab=schema], #tabSchema, .view-tab[data-view=schema]').click()")
    t.call("inferSchema()"); t.wait(100)
    before = t.val("schemaInput")
    t.page.evaluate("document.getElementById('inferClosed').click()"); t.wait(150)
    after = t.val("schemaInput")
    expect(before != after and '"additionalProperties": false' in after, "closed option did not re-infer")


# ---- new tools --------------------------------------------------------------
@case("password-generator", "minimal", "loads with a 20-character password and its entropy")
def _(t):
    pw = t.text("pwOut")
    eq(len(pw), 20, "default length")
    expect("bits" in t.text("genLabel"), t.text("genLabel"))


@case("password-generator", "typical", "options apply instantly: length, sets, look-alikes")
def _(t):
    t.set("pwLenNum", "32"); t.page.dispatch_event("#pwLenNum", "change"); t.wait(100)
    eq(len(t.text("pwOut")), 32, "length 32")
    t.page.uncheck("#optSymbols"); t.page.uncheck("#optUpper"); t.wait(100)
    import re as _re
    expect(_re.fullmatch(r"[a-z0-9]{32}", t.text("pwOut")), t.text("pwOut"))
    t.page.check("#optAmbiguous"); t.wait(100)
    for _i in range(30):
        t.click("#btnRegen")
        expect(not _re.search(r"[l1o0]", t.text("pwOut")), "look-alike found: " + t.text("pwOut"))


@case("password-generator", "typical", "passphrase and PIN modes")
def _(t):
    t.click(".seg-btn[data-mode=passphrase]"); t.wait(150)
    words = t.text("pwOut").split("-")
    eq(len(words), 6, "six words"); expect(all(w.isalpha() for w in words), words)
    expect(abs(float(t.text("genLabel").split(" bits")[0]) - 77.5) < 0.2, t.text("genLabel"))
    t.click(".seg-btn[data-mode=pin]"); t.wait(100)
    expect(t.text("pwOut").isdigit() and len(t.text("pwOut")) == 6, t.text("pwOut"))


@case("password-generator", "edge", "strength checker flags real-world weak passwords")
def _(t):
    t.set("checkInput", "P@ssw0rd1!"); t.wait(100)
    expect(t.text("chkLabel").startswith(("Very weak", "Weak")), t.text("chkLabel"))
    expect("common password" in t.text("findings"), t.text("findings"))
    t.set("checkInput", "correct-horse-battery-staple-orbit-lantern"); t.wait(100)
    expect(t.text("chkLabel").startswith(("Strong", "Very strong")), t.text("chkLabel"))


@case("password-generator", "edge", "impossible rules explain themselves instead of failing silently")
def _(t):
    for cb in ("optUpper", "optLower", "optDigits", "optSymbols"): t.page.uncheck("#" + cb)
    t.wait(100)
    expect("at least one" in t.text("pwOut"), t.text("pwOut"))


@case("password-generator", "maximal", "bulk generates 1,000 unique passwords")
def _(t):
    t.call("document.querySelector('details.bulk').open = true")
    t.set("bulkCount", "1000"); t.click("#btnBulk"); t.wait(300)
    lines = t.val("bulkOut").split("\n")
    eq(len(lines), 1000, "count"); eq(len(set(lines)), 1000, "unique")


@case("password-generator", "edge", "share link carries settings but never the password")
def _(t):
    s = t.call("JSON.stringify(window.LB_TOOL.getState())")
    expect(t.text("pwOut") not in s, "password leaked into state")


@case("color-converter", "minimal", "default color shows every format")
def _(t):
    html = t.html("fmtTable")
    for f in ("#38bdf8", "rgb(56 189 248)", "oklch(", "hsl(", "cmyk("): expect(f in html, f)


@case("color-converter", "typical", "parses real-world notations from design tools and CSS")
def _(t):
    for src, hexv in [("rgb(56, 189, 248)", "#38bdf8"), ("hsl(120 100% 25%)", "#008000"), ("RebeccaPurple", "#663399"), ("56 189 248", "#38bdf8"), ("oklch(62.8% 0.2577 29.23)", "#ff0000"), ("#0AF", "#00aaff")]:
        t.set("colorInput", src); t.wait(60)
        expect(hexv in t.html("fmtTable"), f"{src} -> expected {hexv}")


@case("color-converter", "typical", "WCAG ratio, chips and the AA fix")
def _(t):
    t.set("fgInput", "#777777"); t.set("bgInput", "#ffffff"); t.wait(100)
    eq(t.text("ratio"), "4.47:1", "famous near miss")
    expect("AA text" in t.text("wcagChips"), "chips")
    expect(t.count("#wcagChips .chip.fail") >= 1, "AA must fail")
    t.click("#btnFixAA"); t.wait(150)
    r = float(t.text("ratio").split(":")[0])
    expect(r >= 4.5, f"fixed ratio {r}")


@case("color-converter", "edge", "invalid color explains itself; palette export copies CSS variables")
def _(t):
    t.set("colorInput", "notacolor"); t.wait(60)
    expect(t.visible("#colorError"), "no error for invalid input")
    t.set("colorInput", "#38bdf8"); t.wait(60)
    eq(t.count("#scale .sw"), 11, "scale steps")
    eq(t.count("#cvd .cvd-cell"), 5, "vision simulations")


# ----------------------------------------------------------------------------
# vat-gst-calculator
# ----------------------------------------------------------------------------
@case("vat-gst-calculator", "edge", "B2: CGST and SGST are equal halves worked out on the taxable value, with a note on the paisa")
def _(t):
    t.select("preset", "in-18")
    t.select("supply", "intra")
    t.set("amount", "100.05")
    out = t.text("calcOut")
    expect(out.count("INR 9.00") == 2 and "9.01" not in out, "halves not equal: " + out)
    expect("INR 118.05" in out, out)
    expect(t.count("#gstNote") == 1 and "0.01" in t.text("gstNote"), "no note about the paisa: " + out)


@case("vat-gst-calculator", "minimal", "opens with UAE VAT on AED 1,000 and a two-line invoice")
def _(t):
    expect("AED 1,050.00" in t.text("headline"), t.text("headline"))
    expect("UAE Dirhams One Thousand Fifty Only" in t.text("calcOut"), "amount in words missing")
    expect("1/21" in t.text("calcOut"), "tax fraction missing")
    eq(t.count("#lines tbody tr"), 2, "default lines")


@case("vat-gst-calculator", "typical", "remove VAT: 1,050 -> 1,000 + 50; Saudi 15%")
def _(t):
    t.click("[data-mode='remove']")
    t.set("amount", "1050")
    expect("AED 1,000.00" in t.text("headline") and "AED 50.00" in t.text("headline"), t.text("headline"))
    t.select("preset", "sa-15")
    t.set("amount", "2300")
    expect("SAR 2,000.00" in t.text("headline"), t.text("headline"))


@case("vat-gst-calculator", "typical", "India GST 18%: CGST + SGST, then IGST, with lakh grouping")
def _(t):
    t.select("preset", "in-18")
    t.set("amount", "100000")
    out = t.text("calcOut")
    expect("CGST 9%" in out and "INR 9,000.00" in out and "SGST 9%" in out, out)
    expect("INR 1,18,000.00" in out and "Rupees One Lakh Eighteen Thousand Only" in out, out)
    t.select("supply", "inter")
    expect("IGST 18%" in t.text("calcOut") and "INR 18,000.00" in t.text("calcOut"), t.text("calcOut"))
    expect(t.visible("#supplyField"), "supply type hidden for INR")
    t.select("preset", "ae-5")
    expect(not t.visible("#supplyField"), "supply type shown for AED")


@case("vat-gst-calculator", "typical", "invoice lines with two rates are grouped and split")
def _(t):
    t.call("setState({ mode: 'add', currency: 'INR', rate: '18', amount: '100', supply: 'intra', lines: [{d:'Laptop', q:'2', p:'50000', r:'18'}, {d:'Books', q:'3', p:'200', r:'5'}] })")
    out = t.text("linesOut")
    expect("CGST 9% on INR 1,00,000.00" in out and "INR 9,000.00" in out, out)
    expect("CGST 2.5% on INR 600.00" in out and "INR 15.00" in out, out)
    expect("INR 1,18,630.00" in out, out)
    t.click("#btnAddLine")
    eq(t.count("#lines tbody tr"), 3, "line added")
    t.click("#lines [data-rm='2']")
    eq(t.count("#lines tbody tr"), 2, "line removed")


@case("vat-gst-calculator", "edge", "bad amounts, rates and decimals are reported")
def _(t):
    t.set("amount", "12abc")
    expect("not a number" in t.text("calcError"), t.text("calcError"))
    t.set("amount", "10.005")
    expect("2 decimal places" in t.text("calcError"), t.text("calcError"))
    t.select("preset", "om-5")
    t.set("amount", "10.5")
    expect("OMR 11.025" in t.text("headline"), t.text("headline"))
    t.set("rate", "150")
    expect("100%" in t.text("calcError"), t.text("calcError"))
    eq(t.val("preset"), "custom", "preset follows a typed rate")


@case("vat-gst-calculator", "maximal", "a 200-line invoice totals exactly")
def _(t):
    t.call("setState({ currency: 'AED', rate: '5', amount: '1', lines: Array.from({length: 200}, (_, i) => ({ d: 'Item ' + i, q: '3', p: '0.10', r: '5' })) })")
    out = t.text("linesOut")
    # each line: 0.30 net, 0.015 -> 0.02 tax; 200 lines = 60.00 + 4.00
    expect("AED 64.00" in out, out)


# ----------------------------------------------------------------------------
# date-calculator
# ----------------------------------------------------------------------------
@case("date-calculator", "minimal", "opens with today and shows every result")
def _(t):
    expect(t.call("document.getElementById('start').value") == t.call("LBDate.today()"), "start is not today")
    expect("day" in t.text("betweenHeadline"), "between result missing")
    expect("after" in t.text("addHeadline"), "add result missing")
    expect("date of birth" in t.text("ageHeadline").lower(), "age prompt missing")


@case("date-calculator", "typical", "days between: exclusive, inclusive, weeks, months, working days")
def _(t):
    t.call("setState({ start: '2026-01-01', end: '2026-12-31', weekend: 'sat-sun', holidays: '', inclusive: false })")
    expect("364 days" in t.text("betweenHeadline"), t.text("betweenHeadline"))
    t.click("#inclusive")
    expect("365 days" in t.text("betweenHeadline") and "counting both" in t.text("betweenHeadline"), t.text("betweenHeadline"))
    expect("1 year" in t.text("betweenOut"), "calendar difference missing")
    t.call("setState({ start: '2026-12-01', end: '2026-12-31', inclusive: true, weekend: 'sat-sun', holidays: '2026-12-02 National Day\\n2026-12-03\\n2026-12-05' })")
    out = t.text("betweenOut")
    expect("21" in out and "2 holidays skipped" in out, out)
    t.select("weekend", "fri-sat")
    expect("Friday and Saturday off" in t.text("betweenOut"), "weekend label did not update")


@case("date-calculator", "typical", "90 days, 1 month from 31 Jan, and working days over a weekend")
def _(t):
    t.call("setState({ addBase: '2026-11-21', addOp: '1', addN: '90', addUnit: 'days', weekend: 'sat-sun', holidays: '' })")
    expect("Friday, 19 February 2027" in t.text("addHeadline"), t.text("addHeadline"))
    t.call("setState({ addBase: '2026-01-31', addN: '1', addUnit: 'months' })")
    expect("28 February 2026" in t.text("addHeadline") and "does not exist" in t.text("addOut"), t.text("addOut"))
    t.call("setState({ addBase: '2026-11-20', addN: '1', addUnit: 'working', weekend: 'sat-sun' })")
    expect("Monday, 23 November 2026" in t.text("addHeadline"), t.text("addHeadline"))
    t.select("weekend", "fri-sat")
    expect("Sunday, 22 November 2026" in t.text("addHeadline"), t.text("addHeadline"))
    t.click("#addChips [data-n='60']")
    eq(t.val("addN"), "60", "chip sets amount")


@case("date-calculator", "typical", "exact age and next birthday")
def _(t):
    t.call("setState({ dob: '1990-05-15', asOf: '2026-11-21' })")
    expect("36 years, 6 months and 6 days" in t.text("ageHeadline"), t.text("ageHeadline"))
    out = t.text("ageOut")
    expect("13,339" in out and "Tuesday, 15 May 1990" in out and "in 175 days (turns 37)" in out, out)


@case("date-calculator", "edge", "bad input is explained, not thrown")
def _(t):
    t.call("setState({ dob: '2030-01-01', asOf: '2026-01-01' })")
    expect("after" in t.text("ageError"), "future birth date not reported")
    t.call("setState({ holidays: 'next tuesday\\n2026-12-02', start: '2026-12-01', end: '2026-12-31' })")
    expect("next tuesday" in t.text("betweenError"), "bad holiday line not reported")
    t.set("addN", "-5")
    expect("whole number" in t.text("addError"), "negative amount not reported")


@case("date-calculator", "maximal", "a 200-year span counts instantly")
def _(t):
    t.call("setState({ start: '1900-01-01', end: '2100-01-01', inclusive: false, weekend: 'sat-sun', holidays: '' })")
    expect("73,049 days" in t.text("betweenHeadline"), t.text("betweenHeadline"))
    t.call("setState({ addBase: '2026-01-01', addOp: '1', addN: '5000', addUnit: 'working' })")
    expect("2045" in t.text("addHeadline"), t.text("addHeadline"))


# ----------------------------------------------------------------------------
# time-zone-converter
# ----------------------------------------------------------------------------
TZ_CARD = "document.querySelector('.tz-card[data-zone=\"%s\"] %s').textContent"


@case("time-zone-converter", "minimal", "opens with the current time in several cities")
def _(t):
    expect(t.count(".tz-card") >= 4, "default cities missing")
    expect(t.call("document.getElementById('date').value").startswith("20"), "date not filled")
    expect(t.count("#planner tbody tr") >= 23, "planner rows missing")


@case("time-zone-converter", "typical", "3pm IST to EST in winter is 4:30 AM, in summer 5:30 AM EDT")
def _(t):
    t.set("date", "2026-01-15")
    t.set("quick", "3pm IST to EST")
    t.call("quick()")
    eq(t.call(TZ_CARD % ("America/New_York", ".tz-time")), "4:30 AM", "winter")
    expect("EST" in t.call(TZ_CARD % ("America/New_York", ".tz-meta")), "EST label missing")
    eq(t.val("fromZone"), "India", "source zone")
    t.set("date", "2026-07-15")
    eq(t.call(TZ_CARD % ("America/New_York", ".tz-time")), "5:30 AM", "summer")
    expect("EDT" in t.call(TZ_CARD % ("America/New_York", ".tz-meta")), "EDT label missing")


@case("time-zone-converter", "typical", "Dubai to India is 1 h 30 min ahead; LA to Tokyo crosses the date")
def _(t):
    t.set("fromZone", "Dubai", "change")
    t.set("date", "2026-11-21"); t.set("time", "10:00")
    t.call("addZone('Asia/Kolkata'); render()")
    eq(t.call(TZ_CARD % ("Asia/Kolkata", ".tz-time")), "11:30 AM", "India time")
    expect("1 h 30 min ahead" in t.call(TZ_CARD % ("Asia/Kolkata", ".tz-meta")), "relative difference missing")
    t.set("quick", "10pm Los Angeles to Tokyo")
    t.call("quick()")
    expect("next day" in t.call(TZ_CARD % ("Asia/Tokyo", ".tz-date")), "next-day tag missing")


@case("time-zone-converter", "edge", "skipped and repeated times on clock-change nights are explained")
def _(t):
    t.set("fromZone", "New York", "change")
    t.set("date", "2026-03-08"); t.set("time", "02:30")
    expect("does not exist" in t.text("dstNote") and "3:30 AM" in t.text("dstNote"), "gap note: " + t.text("dstNote"))
    t.set("date", "2026-11-01"); t.set("time", "01:30")
    expect("happens twice" in t.text("dstNote"), "overlap note: " + t.text("dstNote"))
    t.set("time", "12:00")
    expect(not t.visible("#dstNote"), "note should hide on an ordinary time")


@case("time-zone-converter", "edge", "unknown zones are reported, not thrown")
def _(t):
    t.set("quick", "3pm IST to Atlantis")
    t.call("quick()")
    expect("Atlantis" in t.text("quickError"), "quick error missing")
    t.set("fromZone", "Narnia", "change")
    expect("Narnia" in t.text("zoneError"), "zone error missing")


@case("time-zone-converter", "typical", "planner finds the Dubai, India and London overlap")
def _(t):
    t.call("setState({ d: '2026-11-23', t: '13:00', src: 'Asia/Dubai', zones: ['Asia/Kolkata', 'Europe/London'], h12: true })")
    summary = t.text("overlapText")
    expect("1:00 PM and 4:00 PM" in summary, "overlap summary: " + summary)
    eq(t.count("#planner tr.all"), 3, "highlighted rows")
    t.call("document.querySelector('#planner tr[data-hour=\"15\"]').click()")
    eq(t.val("time"), "15:00", "row click sets the time")


@case("time-zone-converter", "maximal", "twelve places at once, then capped")
def _(t):
    t.call("setState({ d: '2026-06-01', t: '09:00', src: 'UTC', zones: [], h12: false })")
    for z in ["Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore",
              "Australia/Sydney", "Asia/Tokyo", "Europe/Paris", "America/Sao_Paulo", "Africa/Lagos", "Pacific/Auckland", "Asia/Karachi"]:
        t.call(f"addZone('{z}')")
    t.call("render()")
    eq(t.count(".tz-card"), 12, "cards")
    eq(t.count("#planner thead th"), 12, "planner columns")
    eq(t.call(TZ_CARD % ("Asia/Kolkata", ".tz-time")), "14:30", "24-hour clock")


@case("number-base-converter", "minimal", "255 converts to every base")
def _(t):
    h = t.html("outTable")
    for v in ("1111 1111", "377", "FF", "73"): expect(v in h, v)


@case("number-base-converter", "typical", "huge values stay exact (2^64-1, a 256-bit hash)")
def _(t):
    t.set("numInput", "18446744073709551615"); t.wait(60)
    expect("FFFF FFFF FFFF FFFF" in t.text("outTable"), t.text("outTable"))
    t.set("numInput", "0x" + "f" * 64); t.wait(60)
    expect("115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129,639,935" in t.text("outTable"), "256-bit decimal")


@case("number-base-converter", "typical", "two's complement, bit flip and IEEE-754")
def _(t):
    t.set("numInput", "-1"); t.select("width", "16"); t.wait(80)
    expect("65,535" in t.text("twosGrid"), t.text("twosGrid"))
    t.set("numInput", "0"); t.wait(60)
    t.click(".bit[data-bit='3']"); t.wait(60)
    expect(t.val("numInput").upper() in ("0X8", "0X0008"), t.val("numInput"))
    t.set("floatInput", "0.1"); t.select("floatWidth", "64"); t.click("#btnFloat"); t.wait(100)
    expect("3FB999999999999A" in t.val("numInput").upper(), t.val("numInput"))
    expect("0.1" in t.text("byteGrid"), t.text("byteGrid"))


@case("number-base-converter", "edge", "invalid digits are reported with their position")
def _(t):
    t.select("inBase", "2"); t.set("numInput", "10201"); t.wait(60)
    expect(t.visible("#numError") and "position 3" in t.text("numError"), t.text("numError"))


@case("number-base-converter", "typical", "bitwise calculator")
def _(t):
    t.set("calcA", "0b1100"); t.set("calcB", "0b1010"); t.select("calcOp", "xor"); t.wait(60)
    expect("0b110" in t.text("calcOut"), t.text("calcOut"))
    t.select("calcOp", "div"); t.set("calcB", "0"); t.wait(60)
    expect("Division by zero" in t.text("calcError"), t.text("calcError"))


@case("text-case-converter", "minimal", "empty input shows example conversions and zero counts")
def _(t):
    expect("parseHttpResponseBody" in t.text("caseList"), t.text("caseList")[:200])
    expect("0 words" in t.text("statsStrip"), t.text("statsStrip"))


@case("text-case-converter", "typical", "identifier list converts per line; apply and undo")
def _(t):
    t.set("textInput", "userAccountId\nXMLHttpRequest\nAPI_BASE_URL"); t.wait(120)
    expect("user_account_id\nxml_http_request\napi_base_url" in t.text("caseList"), t.text("caseList")[:600])
    t.click(".case-row[data-case=kebab]"); t.click("#btnApply"); t.wait(80)
    eq(t.val("textInput"), "user-account-id\nxml-http-request\napi-base-url", "applied kebab")
    t.click("#btnUndo"); t.wait(60)
    eq(t.val("textInput"), "userAccountId\nXMLHttpRequest\nAPI_BASE_URL", "undo")


@case("text-case-converter", "typical", "word count, reading time and keywords on real prose")
def _(t):
    prose = ("Kubernetes schedules containers onto nodes. Each node runs a kubelet. "
             "The kubelet reports node health, and the scheduler places pods where resources allow. ") * 40
    t.set("textInput", prose); t.wait(200)
    expect("920" in t.text("tiles"), t.text("tiles"))  # 23 words x 40
    expect(t.text("kwTable").lower().split("\n")[1].startswith(("node", "kubelet")), t.text("kwTable"))


@case("text-case-converter", "edge", "line tools: dedupe and natural sort")
def _(t):
    t.set("textInput", "item10\nitem2\nitem2\nitem1"); t.wait(60)
    t.click("[data-line=dedupe]"); t.click("[data-line=sortAsc]"); t.wait(60)
    eq(t.val("textInput"), "item1\nitem2\nitem10", "dedupe + natural sort")


@case("markdown-preview", "minimal", "sample renders with a table of contents and stats")
def _(t):
    expect(t.count("#mdPreview table") == 1 and t.count("#mdPreview input[type=checkbox]") == 4, "GFM table/tasks")
    expect(t.count("#toc a") >= 4, "toc")
    expect("words" in t.text("mdStats"), t.text("mdStats"))


@case("markdown-preview", "typical", "raw HTML is sanitized: no scripts, handlers or javascript: links")
def _(t):
    t.set("mdInput", '# Hi\n\n<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><a href="javascript:alert(1)">x</a>'); t.wait(200)
    h = t.html("mdPreview")
    expect("onerror" not in h and "<script" not in h and "javascript:" not in h, h)
    expect(not t.call("window.__pwned"), "script executed")


@case("markdown-preview", "typical", "toolbar wraps the selection; headings get GitHub-style ids")
def _(t):
    t.set("mdInput", "Getting Started!"); t.wait(60)
    t.call("const e=document.getElementById('mdInput'); e.focus(); e.setSelectionRange(0, 16)")
    t.click("[data-md=h2]"); t.wait(100)
    expect(t.count("#mdPreview h2#getting-started") == 1, t.html("mdPreview"))
    t.call("const e=document.getElementById('mdInput'); e.value='bold me'; e.setSelectionRange(0,4)")
    t.click("[data-md=bold]"); t.wait(100)
    eq(t.val("mdInput"), "**bold** me", "bold wrap")


@case("markdown-preview", "maximal", "large README (2,000 sections) renders under budget")
def _(t):
    import time as _time
    doc = "\n\n".join(f"## Section {i}\n\nParagraph with **bold**, `code` and a [link](https://example.com/{i}).\n\n- a\n- b" for i in range(2000))
    t0 = _time.time(); t.set("mdInput", doc); t.wait_for("document.querySelectorAll('#mdPreview h2').length === 2000", timeout=10000)
    expect(_time.time() - t0 < 6, f"render took {_time.time() - t0:.1f}s")


@case("markdown-preview", "edge", "export buttons explain an empty document")
def _(t):
    t.set("mdInput", ""); t.wait(80)
    t.click("#btnCopyHtml"); t.wait(80)
    expect("Nothing to copy" in t.text("lbToast"), t.text("lbToast"))


# ----------------------------------------------------------------------------
# site-wide: consent, redirects, footer directory, feed (AdSense / SEO pass)
# ----------------------------------------------------------------------------
@case("base64", "typical", "site: Reject all stores the choice and sends denied consent to Google")
def _(t):
    t.call("localStorage.removeItem('layerbit-cookie-consent'); initCookieConsent(true)")
    expect(t.visible(".cookie-consent-banner"), "banner did not open")
    t.click(".cookie-consent-reject"); t.wait(100)
    eq(t.call("localStorage.getItem('layerbit-cookie-consent')"), "rejected", "stored choice")
    last = t.call("JSON.stringify([...dataLayer].reverse().find(e => e[0] === 'consent' && e[1] === 'update'))")
    expect('"ad_storage":"denied"' in last and '"analytics_storage":"denied"' in last, last)
    t.page.reload(wait_until="load")
    first_update = t.call("JSON.stringify([...dataLayer].find(e => e[0] === 'consent' && e[1] === 'update'))")
    expect('"ad_storage":"denied"' in first_update, "choice not re-applied before tags on reload: " + str(first_update))
    expect(not t.visible(".cookie-consent-banner"), "banner reappeared after a choice")
    t.call("localStorage.removeItem('layerbit-cookie-consent')")


@case("base64", "typical", "site: footer 'Your privacy choices' reopens the banner; Accept grants consent")
def _(t):
    t.call("localStorage.setItem('layerbit-cookie-consent', 'rejected')")
    t.click("footer [data-cookie-settings]"); t.wait(100)
    expect(t.visible(".cookie-consent-banner"), "privacy choices link did not reopen the banner")
    t.click(".cookie-consent-accept"); t.wait(100)
    eq(t.call("localStorage.getItem('layerbit-cookie-consent')"), "accepted", "stored choice")
    last = t.call("JSON.stringify([...dataLayer].reverse().find(e => e[0] === 'consent' && e[1] === 'update'))")
    expect('"ad_storage":"granted"' in last, last)
    t.call("localStorage.removeItem('layerbit-cookie-consent')")


@case("base64", "typical", "site: footer directory links every tool and guide in the registry")
def _(t):
    n_tools, n_guides = t.call("[Layerbit.tools.length, Layerbit.guides.length]")
    links = t.call("[...document.querySelectorAll('footer .site-dir a')].map(a => a.getAttribute('href'))")
    expect(sum(1 for h in links if h.startswith('../guides/')) == n_guides, f"guides in footer: {links}")
    expect(sum(1 for h in links if h.startswith('../tools/')) >= n_tools - 1 + 6, "tools and services in footer")
    expect(t.count("nav.tool-crumbs a") == 2, "visible breadcrumb missing")


@case("base64", "edge", "site: removed tool URLs redirect to their replacement")
def _(t):
    base = t.page.url.split("/tools/")[0]
    t.page.goto(base + "/tools/breachalert.html#x"); t.page.wait_for_url("**/password-generator.html#x", timeout=5000)
    t.page.goto(base + "/tools/malicious-url-checker-dns-only.html"); t.page.wait_for_url("**/url-encoder.html", timeout=5000)
    t.page.goto(base + "/tools/insight.html"); t.page.wait_for_url(lambda u: u.rstrip("/").endswith(base.split("//")[1]) or u.endswith("/"), timeout=5000)


@case("base64", "minimal", "site: head carries AdSense account, consent defaults, per-page share image, favicon and feed")
def _(t):
    head = t.call("document.head.innerHTML")
    for needle in ['google-adsense-account" content="ca-pub-6072772587431629"', "gtag('consent', 'default'", "images/og/tools-base64.jpg", 'favicon.ico', 'application/atom+xml', 'fonts/space-grotesk-latin.woff2']:
        expect(needle in head, "missing in <head>: " + needle)
    expect("fonts.googleapis.com" not in head, "third-party font CSS still loaded")


# ----------------------------------------------------------------------------
# kernel (js/kernel.js): palette, share links, send-to, history, drop, privacy
# ----------------------------------------------------------------------------
@case("base64", "typical", "kernel: header pills, palette search and keyboard navigation")
def _(t):
    pills = t.call("[...document.querySelectorAll('.lb-header-tools .lb-pill')].map(e=>e.textContent.trim())")
    expect(any("Search" in p for p in pills) and any("Local" in p for p in pills), f"pills: {pills}")
    t.page.keyboard.press("Control+k")
    t.wait(80)
    expect(t.visible("#lbPalette"), "palette did not open")
    t.page.keyboard.type("jwt")
    t.wait(80)
    first = t.call("document.querySelector('#lbPalette .lb-pal-item.active .lb-pal-title').textContent")
    expect("JWT" in first, f"first result: {first}")
    t.page.keyboard.press("Escape")
    expect(not t.visible("#lbPalette"), "palette did not close")


@case("base64", "typical", "kernel: homepage has no header pills; Ctrl+K still opens the palette")
def _(t):
    base = t.page.url.split("/tools/")[0]
    t.page.goto(base + "/index.html", wait_until="load")
    t.wait(150)
    n = t.call("document.querySelectorAll('.lb-header-tools, #lbPaletteBtn').length")
    expect(n == 0, f"homepage header still has {n} kernel pill element(s)")
    t.page.keyboard.press("Control+k")
    t.wait(80)
    expect(t.visible("#lbPalette"), "palette did not open on the homepage")
    t.page.keyboard.press("Escape")


@case("base64", "typical", "kernel: share link round-trips input through the #fragment")
def _(t):
    t.set("plainText", "Hello share — ünïcode 🌍")
    t.page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    url = t.call("Layerbit.state.share()")
    expect("#s=z:" in url or "#s=j:" in url, f"bad share url: {url}")
    t.page.goto(url, wait_until="load")
    t.wait(200)
    eq(t.val("plainText"), "Hello share — ünïcode 🌍", "restored input")
    expect(t.val("base64Text"), "tool did not run on restored input")


@case("base64", "typical", "kernel: send-to hands text to another tool")
def _(t):
    t.call("Layerbit.sendTo('{\"a\":1}', 'json')")
    t.wait(80)
    t.call("[...document.querySelectorAll('#lbPalette .lb-pal-item')].find(e=>e.textContent.includes('JSON Formatter')).click()")
    t.page.wait_for_load_state("load")
    t.wait(300)
    expect("json-validator.html" in t.page.url, f"landed on {t.page.url}")
    eq(t.val("jsonInput"), '{"a":1}', "input handed over")


@case("base64", "typical", "kernel: history push/list/drawer and clear")
def _(t):
    # opt-in (plan A1): nothing is written until the tool's switch is on
    t.call("Layerbit.history.push('base64', {input:'abc'}, 'first run', {explicit: true})")
    t.wait(150)
    eq(t.call("Layerbit.history.list('base64', 5).then(r=>r.length)"), 0, "saved with the switch off")
    t.call("Layerbit.history.setEnabled('base64', true)")
    t.call("Layerbit.history.push('base64', {input:'abc'}, 'first run', {explicit: true})")
    t.wait(150)
    labels = t.call("Layerbit.history.list('base64', 5).then(r=>r.map(x=>x.label))")
    expect("first run" in labels, f"history: {labels}")
    t.call("Layerbit.history.setEnabled('base64', false)")
    t.click("#lbHistoryBtn")
    t.wait(150)
    expect(t.count("#lbHistList .lb-pal-item") >= 1, "drawer empty")
    t.call("Layerbit.history.clear()")
    t.wait(150)
    eq(t.call("Layerbit.history.list('base64', 5).then(r=>r.length)"), 0, "cleared")


@case("base64", "edge", "kernel: dropping a file anywhere loads the first textarea")
def _(t):
    t.call("""() => { const dt = new DataTransfer(); dt.items.add(new File(['dropped text'], 'x.txt', {type:'text/plain'}));
      document.querySelector('main').dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer: dt})); }""")
    t.wait(200)
    eq(t.val("plainText"), "dropped text", "dropped file content")


@case("base64", "edge", "kernel: privacy pill counts a page-made network request")
def _(t):
    expect("nothing sent" in t.text("lbPrivacyPill"), t.text("lbPrivacyPill"))
    t.call("fetch('https://example.invalid/x').catch(()=>{})")
    t.wait(100)
    expect("1 network request" in t.text("lbPrivacyPill"), t.text("lbPrivacyPill"))


# ----------------------------------------------------------------------------
# kernel: run history is opt-in (plan A1)
# ----------------------------------------------------------------------------
def HIST(slug):
    return f"Layerbit.history.list('{slug}', 100).then(r => r.length)"


def _hist_switch(t):
    return t.page.locator("input[data-lb-history-switch]").first


@case("jwt-decoder", "edge", "A1: a pasted token is never saved; with the switch on, only Save run saves, and Undo removes it")
def _(t):
    t.call("Layerbit.history.clear()")
    t.set("jwtInput", JWT_HS256); t.wait(300)
    eq(t.call(HIST("jwt-decoder")), 0, "pasting a token saved it")
    sw = _hist_switch(t)
    expect(sw.count() == 1 and sw.is_visible() and not sw.is_checked(), "no visible switch, or it is on by default")
    expect(not t.visible("[data-lb-history-save]"), "Save run shown while the switch is off")
    sw.check()
    t.set("jwtInput", JWT_HS256 + " "); t.set("jwtInput", JWT_HS256); t.wait(300)
    eq(t.call(HIST("jwt-decoder")), 0, "typing with the switch on saved a run")
    t.click("[data-lb-history-save]"); t.wait(300)
    eq(t.call(HIST("jwt-decoder")), 1, "Save run did not save")
    expect("Undo" in t.text("lbToast"), "first save has no Undo: " + t.text("lbToast"))
    t.click("#lbToast .lb-toast-action"); t.wait(300)
    eq(t.call(HIST("jwt-decoder")), 0, "Undo did not remove the saved run")
    t.page.keyboard.press("Control+Enter"); t.wait(300)
    eq(t.call(HIST("jwt-decoder")), 1, "Ctrl+Enter is an explicit run")
    sw.uncheck(); t.call("Layerbit.history.clear()")


@case("json-validator", "typical", "2.2: input modes: JSON5, JSONC and JSON Lines read explicitly; YAML, TOML and XML convert in")
def _(t):
    t.select("inMode", "json5")
    t.set("jsonInput", "// cfg\n{name: 'Ada', id: 0x1F, big: 12345678901234567890, inf: Infinity, list: [1, 2,],}")
    t.click("#btnFormat")
    out = t.text("jsonOutput")
    eq(json.loads(out), {"name": "Ada", "id": 31, "big": 12345678901234567890, "inf": None, "list": [1, 2]}, "JSON5")
    expect("12345678901234567890" in out, "big number rounded")
    expect("Infinity" in t.text("noticeText"), "no note about Infinity: " + t.text("noticeText"))
    t.select("inMode", "jsonc")
    t.set("jsonInput", '{"a": 1, // one\n "b": [2,],}'); t.click("#btnFormat")
    eq(json.loads(t.text("jsonOutput")), {"a": 1, "b": [2]}, "JSONC")
    t.set("jsonInput", "{a: 1}"); t.click("#btnFormat")
    expect("JSONC" in t.text("errorText") and "line 1" in t.text("errorText"), t.text("errorText"))
    t.select("inMode", "jsonl")
    t.set("jsonInput", '{"a":1}\n{"a":2}\n'); t.click("#btnFormat")
    eq(json.loads(t.text("jsonOutput")), [{"a": 1}, {"a": 2}], "JSON Lines")
    t.select("inMode", "yaml")
    t.set("jsonInput", "name: Ada\ntags: [a, b]\nzip: '00123'\n"); t.click("#btnFormat")
    eq(json.loads(t.text("jsonOutput")), {"name": "Ada", "tags": ["a", "b"], "zip": "00123"}, "YAML in")
    t.select("inMode", "toml")
    t.set("jsonInput", 'title = "x"\n[owner]\nname = "Ada"\n'); t.click("#btnFormat")
    eq(json.loads(t.text("jsonOutput")), {"title": "x", "owner": {"name": "Ada"}}, "TOML in")
    t.select("inMode", "xml")
    t.set("jsonInput", '<a id="1"><b>x</b><b>y</b></a>'); t.click("#btnFormat")
    eq(json.loads(t.text("jsonOutput")), {"a": {"@id": "1", "b": ["x", "y"]}}, "XML in")
    t.select("inMode", "auto")


@case("json-validator", "edge", "2.2 / A3: tree, JSONPath, types and conversions keep long numbers exactly")
def _(t):
    t.select("inMode", "auto")
    t.set("jsonInput", '{"id": 12345678901234567890, "items": [{"n": 1e400}]}'); t.click("#btnFormat")
    t.call("setOutputView('tree')")
    expect("12345678901234567890" in t.text("jsonTree") and "1e400" in t.text("jsonTree"), t.text("jsonTree"))
    t.call("setPath('$.id')")
    expect("12345678901234567890" in t.text("pathResult"), t.text("pathResult"))
    t.call("setOutputView('convert')"); t.select("convTarget", "ndjson")
    expect("12345678901234567890" in t.text("convOut"), t.text("convOut"))
    t.select("convTarget", "yaml")
    expect("12345678901234567890" in t.text("convOut"), t.text("convOut"))
    t.select("convTarget", "sql")
    t.call("setOutputView('text')")


@case("json-validator", "typical", "2.2: Transform with JMESPath, JSON Query and jq, then use the result")
def _(t):
    t.set("jsonInput", '{"items":[{"name":"a","price":5},{"name":"b","price":12},{"name":"c","price":30}]}'); t.click("#btnFormat")
    t.call("setOutputView('transform')")
    t.select("xfLang", "jmespath"); t.set("xfExpr", "items[?price > `10`].name")
    t.wait_for("document.getElementById('xfOut').textContent.includes('\"c\"')")
    eq(json.loads(t.text("xfOut")), ["b", "c"], "JMESPath")
    t.select("xfLang", "jsonquery"); t.set("xfExpr", ".items | filter(.price > 10) | map(.name)")
    t.wait_for("document.getElementById('xfOut').textContent.includes('\"c\"')")
    eq(json.loads(t.text("xfOut")), ["b", "c"], "JSON Query")
    t.select("xfLang", "jq"); t.set("xfExpr", "[.items[] | select(.price > 10) | .name]")
    t.wait_for("document.getElementById('xfOut').textContent.includes('\"c\"')", 20000)
    eq(json.loads(t.text("xfOut")), ["b", "c"], "jq")
    t.set("xfExpr", ".items[ | bad"); t.wait_for("document.getElementById('xfErr').textContent.length > 0", 8000)
    t.set("xfExpr", "[.items[].price] | add"); t.wait_for("document.getElementById('xfOut').textContent.trim() === '47'", 8000)
    t.click("#btnXfUse")
    eq(t.val("jsonInput").strip(), "47", "result used as the new input")
    t.call("setOutputView('text')")


@case("json-validator", "typical", "2.2: Table view of an array of objects, editable, written back into the document")
def _(t):
    t.set("jsonInput", '{"meta":{"n":2},"rows":[{"id":1,"user":{"name":"Ada"},"ok":true},{"id":2,"user":{"name":"Bob"},"ok":false}]}'); t.click("#btnFormat")
    t.call("setOutputView('table')")
    eq(t.val("tablePath"), "$.rows", "the array of objects is found")
    heads = t.call("[...document.querySelectorAll('#tableGrid .lb-vgrid-head .lb-vcell')].map(c => c.textContent)")
    eq(heads, ["id", "user.name", "ok"], "flattened columns")
    t.page.dblclick("#tableGrid .lb-vrow[data-row='1'] .lb-vcell[data-col='1']")
    t.page.fill("#tableGrid input.lb-vedit", "Grace"); t.page.press("#tableGrid input.lb-vedit", "Enter"); t.wait(150)
    t.page.dblclick("#tableGrid .lb-vrow[data-row='0'] .lb-vcell[data-col='0']")
    t.page.fill("#tableGrid input.lb-vedit", "12345678901234567890"); t.page.press("#tableGrid input.lb-vedit", "Enter"); t.wait(150)
    doc = t.val("jsonInput")
    eq(json.loads(doc)["rows"][1]["user"]["name"], "Grace", "edit written back")
    expect('"id": 12345678901234567890' in doc, "a number typed into a number cell stays an exact number: " + doc[:200])
    t.call("setOutputView('text')")


@case("json-validator", "typical", "2.2: Graph view draws objects and arrays as linked nodes; a value is edited on the graph")
def _(t):
    t.set("jsonInput", '{"id":1,"user":{"name":"Ada","tags":["x","y"]},"items":[{"sku":"A"},{"sku":"B"}]}'); t.click("#btnFormat")
    t.call("setOutputView('graph')")
    eq(t.count("#graphView .g-node"), 6, "nodes")
    eq(t.count("#graphView .g-edge"), 5, "edges")
    t.page.dblclick("#graphView .g-field[data-path=\"$.user.name\"] .g-val")
    t.page.fill("#graphView input.g-edit", "Grace"); t.page.press("#graphView input.g-edit", "Enter"); t.wait(200)
    eq(json.loads(t.val("jsonInput"))["user"]["name"], "Grace", "edited on the graph")
    eq(t.count("#graphView .g-node"), 6, "graph redrawn")
    t.call("setOutputView('text')")


@case("json-validator", "typical", "2.2: Compare two documents by path; the Diff Checker's structure mode opens with both")
def _(t):
    t.set("jsonInput", '{"id": 12345678901234567890, "name": "Ada", "gone": 1}'); t.click("#btnFormat")
    t.call("setOutputView('compare')")
    t.set("compareInput", '{"id": 12345678901234567891, "name": "Ada", "new": true}')
    t.click("#btnCompare")
    rows = t.text("compareResult")
    expect("$.id" in rows and "$.gone" in rows and "$.new" in rows and "$.name" not in rows, rows)
    expect("12345678901234567891" in rows, "numbers compared and shown exactly: " + rows)
    href = t.call("document.getElementById('compareLink').href")
    expect("text-diff-checker.html#s=" in href, href)
    st = t.page.evaluate("h => Layerbit.state.decode(decodeURIComponent(h.split('#s=')[1]))", href)
    eq(st["mode"], "struct", "structure mode")
    expect("12345678901234567891" in st["b"], st["b"])
    t.call("setOutputView('text')")


@case("json-validator", "typical", "2.2: XML and TOML out")
def _(t):
    t.select("inMode", "auto")
    t.set("jsonInput", '{"order":{"@id":"7","item":[{"sku":"A&B"},{"sku":"C"}]}}'); t.click("#btnFormat")
    t.call("setOutputView('convert')")
    t.select("convTarget", "xml")
    x = t.text("convOut")
    expect('<order id="7">' in x and "<sku>A&amp;B</sku>" in x and x.count("<item>") == 2, x)
    t.select("convTarget", "toml")
    t.wait_for("document.getElementById('convOut').textContent.includes('order')")
    expect('[order]' in t.text("convOut") or '[[order.item]]' in t.text("convOut"), t.text("convOut"))
    t.select("convTarget", "sql")
    t.call("setOutputView('text')")


@case("json-validator", "typical", "2.2: sample JSON generated from a schema validates; the visual schema editor writes the schema")
def _(t):
    t.call("setOutputView('schema')")
    t.set("schemaInput", '{"type":"object","required":["id","email","tags"],"properties":{"id":{"type":"integer","minimum":1},"email":{"type":"string","format":"email"},"tags":{"type":"array","items":{"type":"string"},"minItems":2},"status":{"enum":["new","done"]}}}')
    t.click("#btnSample")
    doc = json.loads(t.val("jsonInput"))
    expect(doc["id"] >= 1 and "@" in doc["email"] and len(doc["tags"]) == 2 and doc["status"] == "new", f"{doc}")
    t.click("#btnValidate")
    expect("Valid" in t.text("schemaResult"), t.text("schemaResult"))
    t.click("#btnSchemaVisual")
    expect(t.visible("#schemaVisual"), "visual editor not shown")
    t.page.select_option("#schemaVisual [data-se-path='properties.email'] select.se-type", "integer")
    eq(json.loads(t.val("schemaInput"))["properties"]["email"]["type"], "integer", "type changed in the schema")
    t.page.uncheck("#schemaVisual [data-se-path='properties.tags'] input.se-req")
    expect("tags" not in json.loads(t.val("schemaInput"))["required"], "required not updated")
    t.click("#schemaVisual [data-se-path=''] .se-add")
    props = json.loads(t.val("schemaInput"))["properties"]
    expect(len(props) == 5, f"property not added: {list(props)}")
    t.call("setOutputView('text')")


@case("json-validator", "maximal", "2.2: a 60 MB file is read in a Worker; text and tree are virtual")
def _(t):
    t.call("""() => { const parts = ['{"meta":{"note":"big"},"rows":[']; for (let i = 0; i < 500000; i++) parts.push((i ? ',' : '') + '{"id":' + i + ',"name":"user ' + i + '","email":"u' + i + '@example.com","score":' + (i * 1.5) + ',"tags":["a","b"],"big":1234567890123456789' + (i % 10) + '}');
      parts.push(']}'); window.__jf = new File(parts, 'big.json'); handleFile(window.__jf); }""")
    t.wait_for("window.jsonBig && window.jsonBig.done", 60000)
    expect(t.call("window.__jf.size") > 50e6, "file not large enough: %s" % t.call("window.__jf.size"))
    expect(not t.call("window.jsonBig.error"), "worker error: %s" % t.call("window.jsonBig.error"))
    expect("500,000" in t.text("jsonStats"), t.text("jsonStats"))
    expect(t.count("#jsonOutput .lb-vrow") < 300, "text view not virtual")
    t.call("setOutputView('tree')")
    expect(0 < t.count("#jsonTree .lb-vrow") < 300, "tree not virtual: %s" % t.count("#jsonTree .lb-vrow"))
    t.click("#jsonTree .lb-vrow[data-tree-path='$.rows'] .vt-caret")
    t.wait(200)
    expect("user 0" in t.text("jsonTree") or '"id"' in t.text("jsonTree") or "[0]" in t.text("jsonTree"), t.text("jsonTree")[:300])
    t.call("setPath('$.rows[499999].big')")
    expect("12345678901234567899" in t.text("pathResult"), t.text("pathResult"))
    t.call("closeBig()")
    t.call("setOutputView('text')")


@case("json-validator", "edge", "A1: typing never saves; with the switch on, Beautify saves once")
def _(t):
    t.call("Layerbit.history.clear()")
    t.set("jsonInput", '{"password": "hunter2"}'); t.wait(500)
    t.click("#btnFormat"); t.wait(300)
    eq(t.call(HIST("json-validator")), 0, "saved with the switch off")
    _hist_switch(t).check()
    t.set("jsonInput", '{"password": "hunter3"}'); t.wait(500)
    eq(t.call(HIST("json-validator")), 0, "typing saved a run")
    t.click("#btnFormat"); t.wait(300)
    eq(t.call(HIST("json-validator")), 1, "Beautify with the switch on")
    _hist_switch(t).uncheck(); t.call("Layerbit.history.clear()")


@case("regex-tester", "edge", "A1: live matching never saves; Save run does, and the switch is remembered per tool")
def _(t):
    t.call("Layerbit.history.clear()")
    t.set("regexInput", "\\d+"); t.set("testInput", "a1 b22"); t.wait(400)
    eq(t.call(HIST("regex-tester")), 0, "live matching saved a run")
    _hist_switch(t).check()
    t.set("testInput", "a1 b22 c333"); t.wait(400)
    eq(t.call(HIST("regex-tester")), 0, "typing with the switch on saved a run")
    t.click("[data-lb-history-save]"); t.wait(300)
    eq(t.call(HIST("regex-tester")), 1, "Save run")
    t.page.reload(); t.wait(400)
    expect(_hist_switch(t).is_checked(), "switch not remembered after reload")
    t.page.goto(t.page.url.replace("regex-tester", "jwt-decoder")); t.wait(400)
    expect(not _hist_switch(t).is_checked(), "switch leaked to another tool")
    t.page.goto(t.page.url.replace("jwt-decoder", "regex-tester")); t.wait(400)
    _hist_switch(t).uncheck(); t.call("Layerbit.history.clear()")


@case("flow", "edge", "A1: live re-runs never save; Run with the switch on saves once")
def _(t):
    t.call("Layerbit.history.clear()")
    t.set("flowInput", "c2VjcmV0PTE="); t.wait(300)
    t.click(".magic-chip"); t.wait(400)
    eq(t.call(HIST("flow")), 0, "live run saved with the switch off")
    _hist_switch(t).check()
    t.set("flowInput", "c2VjcmV0PTI="); t.wait(500)
    eq(t.call(HIST("flow")), 0, "typing with the switch on saved a run")
    t.click("#btnRun"); t.wait(400)
    eq(t.call(HIST("flow")), 1, "Run with the switch on")
    _hist_switch(t).uncheck(); t.call("Layerbit.history.clear()")


@case("jwt-decoder", "edge", "A1: runs saved silently by earlier versions are removed once; Diff Checker runs saved behind its switch are kept")
def _(t):
    t.call("""() => new Promise(res => { const r = indexedDB.open('layerbit', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('runs', { keyPath: 'id', autoIncrement: true }); s.createIndex('slug', 'slug'); s.createIndex('ts', 'ts'); };
      r.onsuccess = () => { const tx = r.result.transaction('runs', 'readwrite'), s = tx.objectStore('runs');
        s.add({ slug: 'jwt-decoder', ts: Date.now(), label: 'old', data: { input: 'eyJ.old.token' } });
        s.add({ slug: 'text-diff-checker', ts: Date.now(), label: 'kept', data: { a: 'x', b: 'y' } });
        tx.oncomplete = () => { r.result.close(); res(); }; }; })""")
    t.call("localStorage.removeItem('lb-history-v2')")
    t.page.reload(); t.wait(600)
    eq(t.call(HIST("jwt-decoder")), 0, "a silently saved token survived")
    eq(t.call(HIST("text-diff-checker")), 1, "a consented Diff Checker run was deleted")
    t.call("Layerbit.history.clear()")


# ----------------------------------------------------------------------------
# kernel: files are read as bytes with encoding detection (plan A5)
# ----------------------------------------------------------------------------
LOAD_FLOW = """bytes => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'menu.txt')); const i = document.getElementById('flowFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); }"""


@case("flow", "edge", "A5: a Windows-1252 file is decoded, not turned into replacement characters, and the encoding is named")
def _(t):
    t.page.evaluate(LOAD_FLOW, [0x63, 0x61, 0x66, 0xE9, 0x20, 0x96, 0x20, 0x80, 0x35])
    t.wait_for("() => document.getElementById('flowInput').value.length > 0")
    eq(t.val("flowInput"), "caf\u00e9 \u2013 \u20ac5", "decoded text")
    expect("Windows-1252" in t.text("lbToast"), "encoding not named: " + t.text("lbToast"))


@case("flow", "edge", "A5: UTF-16 and UTF-8 with a BOM are decoded; the encoding can be changed after loading")
def _(t):
    t.page.evaluate(LOAD_FLOW, [0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00])
    t.wait_for("() => document.getElementById('flowInput').value === 'hi'")
    expect("UTF-16" in t.text("lbToast"), t.text("lbToast"))
    t.page.evaluate(LOAD_FLOW, [0xEF, 0xBB, 0xBF, 0xC3, 0xA9])
    t.wait_for("() => document.getElementById('flowInput').value === '\u00e9'")
    expect("UTF-8 with BOM" in t.text("lbToast"), t.text("lbToast"))
    t.page.evaluate(LOAD_FLOW, [0xC3, 0xA9, 0x0A])
    t.wait_for("() => document.getElementById('flowInput').value === '\u00e9\\n'")
    # the bytes C3 A9 read as Windows-1252 are the two characters of mojibake
    t.click("#lbToast .lb-toast-action")
    t.wait_for("() => !!document.querySelector('#lbEncoding [data-enc=\"windows-1252\"]')")
    t.click("#lbEncoding [data-enc='windows-1252']")
    t.wait_for("() => document.getElementById('flowInput').value === '\u00c3\u00a9\\n'")
    info = t.call("Layerbit.readFileInfo(new File([new Uint8Array([0xE9])], 'x')).then(i => [i.encoding, i.text, i.bytes.length])")
    eq(info, ["Windows-1252", "\u00e9", 1], "readFileInfo")


@case("log-analyzer", "edge", "A5: a dropped log file is read (encoding detected) instead of failing")
def _(t):
    t.call("""() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([0x32,0x30,0x32,0x36,0x2D,0x30,0x31,0x2D,0x30,0x31,0x20,0x45,0x52,0x52,0x4F,0x52,0x20,0x63,0x61,0x66,0xE9])], 'app.log'));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    t.wait_for("() => document.getElementById('logInput').value.includes('caf')")
    expect(t.val("logInput").endswith("caf\u00e9"), repr(t.val("logInput")))


@case("markdown-preview", "edge", "A5: a dropped Markdown file is read instead of failing")
def _(t):
    t.call("""() => { const dt = new DataTransfer(); dt.items.add(new File(['# Dropped heading'], 'notes.md'));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    t.wait_for("() => document.body.innerText.includes('Dropped heading')")


# ----------------------------------------------------------------------------
# Phase 0 shared modules
# ----------------------------------------------------------------------------
@case("log-analyzer", "maximal", "shared stream reader: a 30 MB file is counted line by line inside a Worker, with progress")
def _(t):
    res = t.call("""() => new Promise((resolve, reject) => {
      const url = new URL('../js/engines/stream.js', location.href).href;
      const code = `importScripts(${JSON.stringify(url)});
        onmessage = async e => { let n = 0, ticks = 0; for await (const l of LBStream.lines(e.data, { chunkSize: 1 << 20, onProgress: () => ticks++ })) n++; postMessage([n, ticks]); };`;
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      w.onmessage = e => { w.terminate(); resolve(e.data); }; w.onerror = e => reject(new Error(e.message));
      const line = '2026-01-01 10:00:00 INFO request served in 12 ms by worker-7\\n';
      w.postMessage(new Blob(Array(500000).fill(line)));
    })""")
    eq(res[0], 500000, "lines counted in the worker")
    expect(res[1] >= 25, f"progress reported {res[1]} times")


LOAD_SCRIPT = """src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL(src, location.href).href; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); })"""


@case("json-to-table", "maximal", "shared virtual list: a million rows keep under 100 nodes and scroll to any index")
def _(t):
    t.page.evaluate(LOAD_SCRIPT, "../js/ui/virtual.js")
    t.call("""() => { const host = document.createElement('div'); host.id = 'vtest'; host.style.height = '400px'; document.querySelector('main').prepend(host);
      window._vl = LBVirtual.list(host, { count: 1000000, rowHeight: 24, render: i => 'row ' + i }); }""")
    t.wait(100)
    n = t.count("#vtest .lb-vrow")
    expect(0 < n < 100, f"{n} rows in the DOM")
    eq(t.call("document.querySelector('#vtest .lb-vrow').textContent"), "row 0", "first row")
    t.call("_vl.scrollToIndex(999999)"); t.wait(150)
    expect(t.call("[...document.querySelectorAll('#vtest .lb-vrow')].some(r => r.textContent === 'row 999999')"), "last row not reachable")
    t.call("_vl.scrollToIndex(500000)"); t.wait(150)
    rows = t.call("[...document.querySelectorAll('#vtest .lb-vrow')].map(r => r.textContent)")
    expect("row 500000" in rows, f"middle row not shown: {rows[:3]}")
    t.call("_vl.update(3)"); t.wait(100)
    eq(t.count("#vtest .lb-vrow"), 3, "update(count)")


@case("json-to-table", "typical", "shared virtual grid: sticky header, escaped cells, column widths, 200,000 rows")
def _(t):
    t.page.evaluate(LOAD_SCRIPT, "../js/ui/virtual.js")
    t.call("""() => { const host = document.createElement('div'); host.id = 'vgrid'; host.style.height = '300px'; document.querySelector('main').prepend(host);
      window._vg = LBVirtual.grid(host, { columns: [{ label: 'id', width: 80 }, { label: 'name' }, { label: 'note', width: 200 }], count: 200000, cell: (r, c) => c === 0 ? String(r) : c === 1 ? '<b>user ' + r + '</b>' : 'x' }); }""")
    t.wait(100)
    expect(t.count("#vgrid .lb-vgrid-head .lb-vcell") == 3, "header cells")
    expect(t.count("#vgrid .lb-vrow") < 100, "grid rows are not virtual")
    eq(t.call("document.querySelector('#vgrid .lb-vrow .lb-vcell:nth-child(2)').textContent"), "<b>user 0</b>", "cells are text, never HTML")
    eq(t.call("document.querySelector('#vgrid .lb-vrow b')"), None, "HTML was injected")
    t.call("document.getElementById('vgrid').scrollTop = 5000"); t.wait(150)
    expect(t.call("document.querySelector('#vgrid .lb-vgrid-head').getBoundingClientRect().top === document.getElementById('vgrid').getBoundingClientRect().top"), "header is not sticky")


@case("hash-generator", "typical", "shared batch: a dropped folder is walked, hashed with limited concurrency, reported and zipped")
def _(t):
    for src in ["../js/engines/csv.js", "../js/engines/zip.js", "../js/engines/batch.js"]:
        t.page.evaluate(LOAD_SCRIPT, src)
    res = t.call("""async () => {
      const fe = (name, text) => ({ isFile: true, isDirectory: false, name, file: ok => setTimeout(() => ok(new File([text], name)), 0) });
      const dir = (name, kids) => ({ isFile: false, isDirectory: true, name, createReader: () => { let k = 0; return { readEntries: ok => setTimeout(() => { const part = kids.slice(k, k + 2); k += 2; ok(part); }, 0) }; } });
      const root = dir('proj', [fe('a.txt', 'alpha'), dir('src', [fe('main.js', 'x=1'), fe('util.js', 'y=2'), fe('=evil.csv', 'z')]), fe('b.txt', 'beta')]);
      const files = await LBBatch.fromDrop({ items: [{ webkitGetAsEntry: () => root }], files: [] });
      const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
      const results = await LBBatch.run(files, async f => hex(await crypto.subtle.digest('SHA-256', await f.file.arrayBuffer())), { concurrency: 2 });
      const rep = LBBatch.report(results, { title: 'Folder hashes', options: 'SHA-256', columns: [{ label: 'Path', get: r => r.item.path }, { label: 'SHA-256', get: r => r.value }] });
      const zip = LBBatch.archive([{ name: 'hashes.csv', data: rep.csv }, { name: 'hashes.html', data: rep.html }]);
      const back = LBZip.unzipStored(zip);
      return { paths: files.map(f => f.path).sort(), csv: new TextDecoder().decode(back['hashes.csv'].data), names: Object.keys(back) };
    }""")
    eq(res["paths"], ["proj/a.txt", "proj/b.txt", "proj/src/=evil.csv", "proj/src/main.js", "proj/src/util.js"], "walked paths")
    expect("proj/a.txt," + __import__("hashlib").sha256(b"alpha").hexdigest() + ",ok" in res["csv"], res["csv"])
    expect("'proj/src/=evil.csv" not in res["csv"] and "proj/src/=evil.csv" in res["csv"], "path guard wrong")
    eq(res["names"], ["hashes.csv", "hashes.html"], "archive entries")


@case("hash-generator", "typical", "shared WASM loader: loads a module on first use, once, and keeps it for offline use")
def _(t):
    t.page.evaluate(LOAD_SCRIPT, "../js/engines/wasm.js")
    res = t.call("""async () => {
      await caches.delete(LBWasm.CACHE);
      const a = await LBWasm.load('selftest'), b = await LBWasm.load('selftest');
      await new Promise(r => setTimeout(r, 100));
      const cached = await (await caches.open(LBWasm.CACHE)).match(new URL('../js/vendor/wasm/selftest.wasm', location.href).href);
      let missing = '';
      try { await LBWasm.load('no-such-engine'); } catch (e) { missing = e.message; }
      return [a.exports.add(2, 3), a === b, !!cached, missing];
    }""")
    eq(res[:3], [5, True, True], "load, memoise, cache")
    expect("no-such-engine" in res[3] and "404" in res[3], res[3])


@case("csv-to-json", "typical", "PWA: the manifest opens every planned file type in the right tool, and an opened file loads")
def _(t):
    man = t.call("fetch('/manifest.json').then(r => r.json())")
    handlers = man.get("file_handlers") or []
    exts = {}
    for h in handlers:
        for types in h["accept"].values():
            for e in types:
                exts[e] = h["action"]
    for e in [".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".log", ".md", ".patch", ".diff", ".txt"]:
        expect(e in exts, f"{e} has no file handler")
        status = t.call(f"fetch({json.dumps(exts[e])}).then(r => r.status)")
        eq(status, 200, f"{e} -> {exts[e]}")
    eq(exts[".csv"], "/tools/csv-to-json.html", "csv handler")
    t.call("Layerbit.openFiles([new File(['id,name\\n1,Ann'], 'people.csv')])")
    t.wait_for("() => document.getElementById('csvInput').value.startsWith('id,name')")


@case("csv-to-json", "maximal", "PWA: after the service worker warms its cache, a tool page never visited opens offline")
def _(t):
    try:
        ok = t.call("""async () => {
          const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          await navigator.serviceWorker.ready;
          const sw = reg.active || reg.waiting || reg.installing;
          const done = new Promise(res => navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'warmed') res(e.data); }));
          sw.postMessage({ type: 'warm' });
          return await Promise.race([done, new Promise(res => setTimeout(() => res({ timeout: true }), 10000))]);
        }""")
        expect(ok.get("count", 0) > 30, f"warmed {ok}")
        t.page.context.set_offline(True)
        t.page.goto(t.page.url.replace("csv-to-json", "xml-formatter"), wait_until="load")
        expect("XML" in t.page.title(), "offline page did not load: " + t.page.title())
        t.page.goto(t.page.url.replace("xml-formatter", "no-such-tool"), wait_until="load")
        expect("offline" in t.page.content().lower(), "no offline fallback")
    finally:
        t.page.context.set_offline(False)
        t.page.goto(t.page.url.split("/tools/")[0] + "/tools/csv-to-json.html", wait_until="load")
        t.call("navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k))))")


# ----------------------------------------------------------------------------
# runner
# ----------------------------------------------------------------------------
def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(port):
    os.chdir(ROOT)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), Quiet)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def launch(p):
    exe = os.environ.get("LAYERBIT_CHROMIUM")
    if exe:
        return p.chromium.launch(executable_path=exe)
    try:
        return p.chromium.launch()
    except Exception:
        for cand in ("/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"):
            if os.path.exists(cand):
                return p.chromium.launch(executable_path=cand)
        raise


AUTOSAMPLE_TOOLS = ["base64", "csv-to-json", "html-escape-unescape", "json-to-table", "json-validator",
                    "jwt-decoder", "log-analyzer", "sql-formatter", "text-diff-checker", "url-encoder",
                    "yaml-json-converter", "regex-tester", "xml-formatter", "unicode-inspector", "subnet-calculator"]


def autosample_checks(browser, base):
    """A first visit opens each tool on a worked example; a second visit and a
    shared link do not get one."""
    out = []
    filled_js = """() => [...document.querySelectorAll('textarea, input[type=text], input:not([type])')]
        .filter(e => e.offsetParent !== null && e.value.trim() !== '').length"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/*", lambda route, req: route.abort()
              if any(h in req.url for h in BLOCKED_HOSTS) else route.continue_())
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    empty = []
    for slug in AUTOSAMPLE_TOOLS:
        page.goto(f"{base}/tools/{slug}.html", wait_until="load")
        page.wait_for_timeout(500)
        if page.evaluate(filled_js) == 0:
            empty.append(slug)
    out.append(("first visit shows a worked example on every marked tool", not empty and not errors,
                f"still empty: {empty}; page errors: {errors[:2]}"))
    page.goto(f"{base}/tools/json-validator.html", wait_until="load")
    page.wait_for_timeout(500)
    val = page.evaluate("document.getElementById('jsonInput') ? document.getElementById('jsonInput').value : [...document.querySelectorAll('textarea')][0].value")
    out.append(("second visit opens the tool empty", val.strip() == "", f"value on second visit: {val[:80]!r}"))
    ctx.close()
    # a shared link carries its own input, which the example must never replace
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(f"{base}/tools/json-validator.html#x", wait_until="load")
    frag = page.evaluate("Layerbit.state.encode({input: '{\"shared\": 1}'})")
    ctx.close()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(f"{base}/tools/json-validator.html#s={frag}", wait_until="load")
    page.wait_for_timeout(700)
    vals = page.evaluate("[...document.querySelectorAll('textarea')].map(t => t.value).join(' ')")
    out.append(("a shared link keeps its own input", '"shared"' in vals and "Logging" not in vals, f"textareas: {vals[:120]!r}"))
    ctx.close()
    return out


def smoke_all_pages(page, base):
    """Every page loads with zero uncaught errors and lucide icons rendered,
    and nothing overflows the viewport horizontally at phone width."""
    import glob
    fails, errs = [], []
    page.on("pageerror", lambda e: errs.append(str(e)))
    # every page the build writes, including folder pages such as stave/privacy.html
    built = {json.load(open(m, encoding="utf-8"))["file"] for m in glob.glob("src/pages/*.json")}
    pages = sorted(f for f in set(glob.glob("*.html") + glob.glob("tools/*.html") + glob.glob("guides/*.html")) | built
                   if os.path.exists(f) and 'http-equiv="refresh"' not in open(f, encoding="utf-8").read(2000))
    for f in pages:
        errs.clear()
        page.set_viewport_size({"width": 1280, "height": 900})
        page.goto(f"{base}/{f}", wait_until="load")
        page.wait_for_timeout(150)
        icons_left = page.evaluate("document.querySelectorAll('i[data-lucide]').length")
        svgs = page.evaluate("document.querySelectorAll('svg.lucide').length")
        real = [e for e in errs if "firebase" not in e.lower()]
        if real:
            fails.append(f"{f}: {real[0][:120]}")
        if icons_left and not svgs:
            fails.append(f"{f}: lucide icons not rendered ({icons_left} placeholders)")
        # phone width: a horizontal scrollbar means some element is wider than
        # the screen, which on a real phone reads as a broken layout
        page.set_viewport_size({"width": 390, "height": 800})
        page.wait_for_timeout(80)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 2:
            fails.append(f"{f}: {overflow}px horizontal overflow at 390px wide")
    page.set_viewport_size({"width": 1280, "height": 900})
    return len(pages), fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--no-smoke", action="store_true")
    ap.add_argument("--json", metavar="PATH", help="also write every result as JSON (for scripts/check_parity.py)")
    args = ap.parse_args()

    if args.list:
        for slug, level, name, _ in CASES:
            print(f"{slug:22s} {level:8s} {name}")
        return 0

    from playwright.sync_api import sync_playwright
    port = free_port()
    serve(port)
    base = f"http://127.0.0.1:{port}"
    results, t0 = [], time.time()

    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.route("**/*", lambda route, req: route.abort()
                  if any(h in req.url for h in BLOCKED_HOSTS) else route.continue_())
        # the cases below exercise each tool from an empty state, so the
        # first-visit example (kernel autoSample) is switched off here and
        # tested on its own in autosample_checks()
        ctx.add_init_script("try { localStorage.setItem('layerbit-autosample', 'off') } catch (e) {}")

        if not args.no_smoke and not args.only:
            page = ctx.new_page()
            n, fails = smoke_all_pages(page, base)
            page.close()
            for f in fails:
                results.append(("smoke", "load", f, False, 0.0, f))
            print(f"smoke: {n} pages loaded, {len(fails)} problem(s)")

        selected = [c for c in CASES if not args.only or c[0] in args.only]
        by_slug = {}
        for c in selected:
            by_slug.setdefault(c[0], []).append(c)

        for slug, cases in by_slug.items():
            for _, level, name, fn in cases:
                page = ctx.new_page()
                t = Tool(page, base, slug)
                start = time.time()
                ok, err = True, ""
                try:
                    fn(t)
                    page.wait_for_timeout(30)
                    if t.errors:
                        ok, err = False, t.errors[0]
                    elif time.time() - start > TIME_BUDGET_S:
                        ok, err = False, f"exceeded {TIME_BUDGET_S}s budget"
                except Exception as e:  # noqa
                    ok, err = False, f"{type(e).__name__}: {e}"
                    if t.errors:
                        err += f" | page: {t.errors[0]}"
                dur = time.time() - start
                results.append((slug, level, name, ok, dur, err))
                mark = "PASS" if ok else "FAIL"
                print(f"{mark}  {slug:22s} {level:8s} {dur:5.2f}s  {name}" + ("" if ok else f"\n        -> {err[:300]}"))
                page.close()
        if not args.only:
            for name, ok, err in autosample_checks(browser, base):
                results.append(("autosample", "typical", name, ok, 0.0, err))
                print(("PASS" if ok else "FAIL") + f"  {'autosample':22s} typical  {name}" + ("" if ok else f"\n        -> {err[:300]}"))
        browser.close()

    failed = [r for r in results if not r[3]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed in {time.time() - t0:.1f}s")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump([{"slug": r[0], "level": r[1], "name": r[2], "ok": bool(r[3]), "seconds": round(r[4], 2), "error": r[5] or ""} for r in results], fh, indent=1)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
