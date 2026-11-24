// Layerbit: the Rust `regex` crate compiled to WebAssembly, with a tiny C ABI.
// Results are JSON written into a buffer the caller reads with out_ptr/out_len.
use regex::RegexBuilder;
use std::cell::RefCell;

thread_local! { static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::new()); }

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 { let mut v = Vec::<u8>::with_capacity(len.max(1)); let p = v.as_mut_ptr(); std::mem::forget(v); p }
#[no_mangle]
pub unsafe extern "C" fn dealloc(p: *mut u8, len: usize) { drop(Vec::from_raw_parts(p, 0, len.max(1))); }
#[no_mangle]
pub extern "C" fn out_ptr() -> *const u8 { OUT.with(|o| o.borrow().as_ptr()) }
#[no_mangle]
pub extern "C" fn out_len() -> usize { OUT.with(|o| o.borrow().len()) }

fn set_out(s: String) { OUT.with(|o| *o.borrow_mut() = s.into_bytes()); }
fn esc(s: &str) -> String {
    let mut r = String::with_capacity(s.len() + 2);
    r.push('"');
    for c in s.chars() { match c { '"' => r.push_str("\\\""), '\\' => r.push_str("\\\\"), '\n' => r.push_str("\\n"), '\r' => r.push_str("\\r"), '\t' => r.push_str("\\t"), c if (c as u32) < 0x20 => r.push_str(&format!("\\u{:04x}", c as u32)), c => r.push(c) } }
    r.push('"'); r
}
unsafe fn s<'a>(p: *const u8, n: usize) -> &'a str { std::str::from_utf8_unchecked(std::slice::from_raw_parts(p, n)) }

fn build(pat: &str, flags: u32) -> Result<regex::Regex, String> {
    RegexBuilder::new(pat)
        .case_insensitive(flags & 1 != 0).multi_line(flags & 2 != 0).dot_matches_new_line(flags & 4 != 0)
        .ignore_whitespace(flags & 8 != 0).swap_greed(flags & 16 != 0).unicode(flags & 32 == 0)
        .size_limit(50 << 20).build().map_err(|e| e.to_string())
}

/// flags: 1 i, 2 m, 4 s, 8 x, 16 U (swap greed), 32 no Unicode. Byte offsets.
#[no_mangle]
pub unsafe extern "C" fn find_all(pp: *const u8, pn: usize, flags: u32, tp: *const u8, tn: usize, limit: u32) {
    let (pat, text) = (s(pp, pn), s(tp, tn));
    let re = match build(pat, flags) { Ok(r) => r, Err(e) => { set_out(format!("{{\"ok\":false,\"error\":{}}}", esc(&e))); return; } };
    let names: Vec<String> = re.capture_names().map(|n| n.map(esc).unwrap_or_else(|| "null".into())).collect();
    let mut out = format!("{{\"ok\":true,\"names\":[{}],\"matches\":[", names.join(","));
    let mut count = 0u32;
    for caps in re.captures_iter(text) {
        if count >= limit { break; }
        if count > 0 { out.push(','); }
        out.push('[');
        for i in 0..caps.len() { if i > 0 { out.push(','); } match caps.get(i) { Some(m) => out.push_str(&format!("[{},{}]", m.start(), m.end())), None => out.push_str("null") } }
        out.push(']');
        count += 1;
    }
    out.push_str("]}");
    set_out(out);
}

/// Replace every match; the replacement uses Rust's $1 / ${name} syntax.
#[no_mangle]
pub unsafe extern "C" fn replace_all(pp: *const u8, pn: usize, flags: u32, tp: *const u8, tn: usize, rp: *const u8, rn: usize) {
    let (pat, text, rep) = (s(pp, pn), s(tp, tn), s(rp, rn));
    match build(pat, flags) { Ok(re) => set_out(format!("{{\"ok\":true,\"text\":{}}}", esc(&re.replace_all(text, rep)))), Err(e) => set_out(format!("{{\"ok\":false,\"error\":{}}}", esc(&e))) }
}
