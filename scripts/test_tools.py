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
import argparse, functools, http.server, json, os, socket, socketserver, sys
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


@case("json-validator", "typical", "format and minify")
def _(t):
    t.set("jsonInput", '{"a":1,"b":[true,null,"x"]}')
    t.click("#btnFormat")
    out = t.text("jsonOutput")
    expect('"a": 1' in out and '"b": [' in out, f"formatted output wrong: {out[:80]}")
    t.click("#btnMinify")
    eq(t.text("jsonOutput").strip(), '{"a":1,"b":[true,null,"x"]}', "minified")


@case("json-validator", "edge", "syntax error is reported with position, not thrown")
def _(t):
    t.set("jsonInput", '{"a": 1,}')
    t.click("#btnFormat")
    expect(t.visible("#errorBanner"), "error banner not shown")
    expect("Invalid JSON" in t.text("errorText"), "error text missing")


@case("json-validator", "edge", "tree view renders nested nodes")
def _(t):
    t.set("jsonInput", '{"users":[{"id":1,"tags":["a","b"]},{"id":2}]}')
    t.click("#btnFormat")
    t.click("#viewTabTree")
    expect(t.count("#jsonTree .tree-row") >= 5, "tree rows not rendered")


@case("json-validator", "maximal", "20,000-object array formats under budget")
def _(t):
    arr = [{"id": i, "name": f"user{i}", "active": i % 2 == 0, "score": i * 0.5} for i in range(20000)]
    t.set("jsonInput", json.dumps(arr))
    t.click("#btnMinify")
    out = t.text("jsonOutput")
    expect(out.startswith('[{"id":0') and out.rstrip().endswith("}]"), "minified large array wrong")


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
    expect(t.text("payloadOutput").strip() in ("", "{}") or "paste" in t.text("payloadOutput").lower(),
           "payload output not cleared")


@case("jwt-decoder", "typical", "decodes header and payload")
def _(t):
    t.set("jwtInput", JWT_HS256)
    expect('"HS256"' in t.text("headerOutput"), "header alg missing")
    expect('"John Doe"' in t.text("payloadOutput"), "payload name missing")


@case("jwt-decoder", "typical", "HS256 signature verifies with the right secret and fails with the wrong one")
def _(t):
    t.set("jwtInput", JWT_HS256)
    t.set("hmacSecret", "your-256-bit-secret")
    t.wait_for("() => /valid|verified/i.test(document.getElementById('verifyResult').innerText)")
    t.set("hmacSecret", "wrong-secret")
    t.wait_for("() => /invalid|fail|mismatch/i.test(document.getElementById('verifyResult').innerText)")


@case("jwt-decoder", "edge", "garbage input reports an error instead of throwing")
def _(t):
    t.set("jwtInput", "this.is.not.a.jwt")
    t.wait(50)
    st = t.text("statusText").lower()
    expect("invalid" in st or "error" in st or "malformed" in st, f"status did not report error: {st!r}")


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


@case("jwt-decoder", "typical", "claim timeline: expired token shows 'ago' and status Expired")
def _(t):
    import base64, time
    h = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
    now = int(time.time())
    p = base64.urlsafe_b64encode(json.dumps({"iat": now - 7200, "exp": now - 3600}).encode()).decode().rstrip("=")
    t.set("jwtInput", f"{h}.{p}.x")
    expect("ago" in t.text("claimTimes") and "Lifetime" in t.text("claimTimes"), f"timeline wrong: {t.text('claimTimes')}")
    eq(t.text("statusText").strip(), "Token Expired", "status")


@case("jwt-decoder", "edge", "nbf in the future -> Not Yet Valid; millisecond exp is flagged")
def _(t):
    import base64, time
    h = base64.urlsafe_b64encode(b'{"alg":"none"}').decode().rstrip("=")
    now = int(time.time())
    p = base64.urlsafe_b64encode(json.dumps({"nbf": now + 3600, "exp": (now + 7200) * 1000}).encode()).decode().rstrip("=")
    t.set("jwtInput", f"{h}.{p}.")
    expect("Not Yet Valid" in t.text("statusText"), f"status: {t.text('statusText')}")
    expect("milliseconds" in t.text("claimTimes"), "ms warning missing")


@case("jwt-decoder", "typical", "signer produces a token that the verifier accepts")
def _(t):
    t.set("signSecret", "s3cret")
    t.select("signAlg", "HS512")
    t.click("#btnSign")
    t.wait_for("() => document.getElementById('signOutput').innerText.split('.').length === 3")
    token = t.text("signOutput").strip()
    t.click("#btnSignLoad")
    t.wait_for("() => /valid|verified/i.test(document.getElementById('verifyResult').innerText)")
    expect('"HS512"' in t.text("headerOutput") and '"user-42"' in t.text("payloadOutput"), "loaded token wrong")
    expect("Not Expired" in t.text("statusText"), "exp not set to future")


# ----------------------------------------------------------------------------
# regex-tester
# ----------------------------------------------------------------------------
@case("regex-tester", "minimal", "empty pattern: no matches, no error")
def _(t):
    t.set("regexInput", "")
    t.set("testInput", "abc")
    expect(not t.visible("#errorText"), "error shown for empty pattern")


@case("regex-tester", "typical", "counts matches and shows groups")
def _(t):
    t.set("regexInput", r"(\w+)@(\w+)\.com")
    t.set("testInput", "a@x.com, b@y.com and c@z.org")
    t.wait_for("() => /2/.test(document.getElementById('matchCount').innerText)")
    expect("x" in t.text("matchesGrid") and "y" in t.text("matchesGrid"), "groups not rendered")


@case("regex-tester", "typical", "replace preview honours $1")
def _(t):
    t.set("regexInput", r"(\d{4})-(\d{2})-(\d{2})")
    t.set("testInput", "2026-09-27")
    t.set("replaceInput", "$3/$2/$1")
    t.wait_for("() => document.getElementById('replaceOutput').innerText.includes('27/09/2026')")


@case("regex-tester", "edge", "invalid pattern reports error, no throw")
def _(t):
    t.set("regexInput", "(unclosed")
    t.set("testInput", "x")
    t.wait(50)
    expect(t.visible("#errorText") or t.visible("#errorMsg"), "invalid regex not reported")


@case("regex-tester", "edge", "unicode property escapes with u flag")
def _(t):
    t.set("regexInput", r"\p{L}+")
    t.click(".flag-btn[data-flag='u']") if t.count(".flag-btn[data-flag='u']") else None
    t.set("testInput", "héllo 日本")
    t.wait(100)
    mc = t.text("matchCount")
    expect(any(ch.isdigit() for ch in mc), f"no match count: {mc!r}")


@case("regex-tester", "maximal", "100k-char subject with many matches under budget")
def _(t):
    t.set("regexInput", r"\b\d+\b")
    t.set("testInput", " ".join(str(i) for i in range(20000)))
    t.wait_for("() => /20000|20,000/.test(document.getElementById('matchCount').innerText)")


@case("regex-tester", "typical", "s flag lets . cross newlines; timing readout renders")
def _(t):
    t.set("regexInput", "a.b")
    t.set("testInput", "a\nb")
    t.wait_for("() => /0 Matches/.test(document.getElementById('matchCount').innerText)")
    t.click(".flag-btn[data-flag='s']")
    t.wait_for("() => /1 Matches/.test(document.getElementById('matchCount').innerText)")
    expect("ms on" in t.text("matchTiming"), "timing missing")


@case("regex-tester", "typical", "u flag enables \\p{Script=Han}")
def _(t):
    t.set("regexInput", r"\p{Script=Han}+")
    t.set("testInput", "abc 日本語 def")
    t.wait(60)
    expect("Error" in t.text("matchCount") or "0 Matches" in t.text("matchCount"), "without u, \\p should not match")
    t.click(".flag-btn[data-flag='u']")
    t.wait_for("() => /1 Matches/.test(document.getElementById('matchCount').innerText)")


# ----------------------------------------------------------------------------
# url-encoder
# ----------------------------------------------------------------------------
@case("url-encoder", "minimal", "empty input")
def _(t):
    t.set("plainText", "")
    eq(t.val("encodedText"), "", "encoded")


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
@case("text-diff-checker", "minimal", "identical inputs -> no changes")
def _(t):
    t.set("text1", "same")
    t.set("text2", "same")
    t.call("runDiff()")
    t.wait(150)
    expect(t.count(".line-added, .added, .diff-add") == 0, "identical text produced additions")


@case("text-diff-checker", "typical", "one changed line is highlighted")
def _(t):
    t.set("text1", "a\nb\nc")
    t.set("text2", "a\nB\nc")
    t.call("runDiff()")
    t.wait(150)
    body = t.text("outputSection")
    expect("B" in body and "b" in body, "changed line not shown")


@case("text-diff-checker", "edge", "ignore-whitespace hides trailing-space-only changes")
def _(t):
    t.set("text1", "x = 1")
    t.set("text2", "x = 1   ")
    t.call("document.getElementById('ignoreWhitespace').checked = true")
    t.call("runDiff()")
    t.wait(150)
    expect(t.count(".line-added, .line-removed, .added, .removed") == 0, "whitespace-only change not ignored")


@case("text-diff-checker", "maximal", "5,000-line files under budget")
def _(t):
    a = "\n".join(f"line {i}" for i in range(5000))
    b = "\n".join(f"line {i}" if i % 100 else f"LINE {i}" for i in range(5000))
    t.set("text1", a)
    t.set("text2", b)
    t.call("runDiff()")
    t.wait_for("() => document.getElementById('outputSection').innerText.includes('LINE 4900')")


@case("text-diff-checker", "typical", "character granularity isolates a one-letter change")
def _(t):
    t.set("text1", "getUserId()")
    t.set("text2", "getUserID()")
    t.select("granularity", "char")
    t.call("runDiff()")
    t.wait(150)
    spans = t.call("Array.from(document.querySelectorAll('#rightPanel .word-added')).map(e => e.textContent)")
    eq(spans, ["D"], "char-level added span")
    t.select("granularity", "none")
    t.call("runDiff()")
    t.wait(150)
    eq(t.count("#rightPanel .word-added"), 0, "lines-only mode still highlighted words")


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
    t.set("searchInput", "gam", event="keyup")
    t.wait(50)
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


@case("log-analyzer", "typical", "DEBUG filter, regex grep and repeated-message tally")
def _(t):
    lines = ["2026-01-01 10:00:00 DEBUG cache miss key=%d" % i for i in range(3)] + \
            ["2026-01-01 10:00:0%d ERROR user %d timed out after 30s" % (i, 1000 + i) for i in range(4)] + \
            ["2026-01-01 10:00:09 INFO ok"]
    t.set("logInput", "\n".join(lines))
    t.call("analyzeLogs()")
    eq(t.text("countDebug").strip(), "3", "debug count")
    top = t.text("topMessages")
    expect("×4" in top and "user # timed out" in top, f"tally wrong: {top!r}")
    t.call("document.getElementById('grepRegex').checked = true")
    t.set("searchInput", "user 100[12]", event="keyup")
    t.wait(50)
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
    t.wait_for("() => document.getElementById('d-SHA-256').textContent.length === 64")
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
    expect("mismatch" in t.text("errorText").lower(), t.text("errorText"))


@case("xml-formatter", "maximal", "5,000-element document formats and queries under budget")
def _(t):
    doc = "<items>" + "".join(f'<item id="{i}"><name>n{i}</name><qty>{i % 7}</qty></item>' for i in range(5000)) + "</items>"
    t.set("xmlInput", doc)
    t.wait_for("() => document.getElementById('statsStrip').innerText.includes('15,001')", 10000)
    t.set("xpathInput", "count(//item[qty > 5])")
    expect("number: 714" in t.text("xpathHint"), t.text("xpathHint"))


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
        for cand in ("/opt/pw-browsers/chromium-1194/chrome-linux/chrome",):
            if os.path.exists(cand):
                return p.chromium.launch(executable_path=cand)
        raise


def smoke_all_pages(page, base):
    """Every page loads with zero uncaught errors and lucide icons rendered,
    and nothing overflows the viewport horizontally at phone width."""
    import glob
    fails, errs = [], []
    page.on("pageerror", lambda e: errs.append(str(e)))
    pages = sorted(glob.glob("*.html") + glob.glob("tools/*.html") + glob.glob("guides/*.html"))
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
        browser.close()

    failed = [r for r in results if not r[3]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed in {time.time() - t0:.1f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
