// Layerbit: Go's regexp package (RE2 syntax) compiled to WebAssembly.
// Exposes globalThis.lbGoRegex = { findAll(pattern, flags, text, limit), replaceAll(pattern, flags, text, repl) }.
// Offsets are byte offsets into the UTF-8 text; flags is a Go flag string such as "ims".
package main

import (
	"encoding/json"
	"regexp"
	"syscall/js"
)

func compile(pattern, flags string) (*regexp.Regexp, error) {
	if flags != "" {
		pattern = "(?" + flags + ")" + pattern
	}
	return regexp.Compile(pattern)
}

func result(v any) js.Value { b, _ := json.Marshal(v); return js.ValueOf(string(b)) }

func findAll(this js.Value, a []js.Value) any {
	re, err := compile(a[0].String(), a[1].String())
	if err != nil {
		return result(map[string]any{"ok": false, "error": err.Error()})
	}
	text, limit := a[2].String(), a[3].Int()
	all := re.FindAllStringSubmatchIndex(text, limit)
	matches := make([][]any, 0, len(all))
	for _, m := range all {
		g := make([]any, 0, len(m)/2)
		for i := 0; i < len(m); i += 2 {
			if m[i] < 0 {
				g = append(g, nil)
			} else {
				g = append(g, []int{m[i], m[i+1]})
			}
		}
		matches = append(matches, g)
	}
	names := re.SubexpNames()
	nn := make([]any, len(names))
	for i, n := range names {
		if n != "" {
			nn[i] = n
		}
	}
	return result(map[string]any{"ok": true, "names": nn, "matches": matches})
}

func replaceAll(this js.Value, a []js.Value) any {
	re, err := compile(a[0].String(), a[1].String())
	if err != nil {
		return result(map[string]any{"ok": false, "error": err.Error()})
	}
	return result(map[string]any{"ok": true, "text": re.ReplaceAllString(a[2].String(), a[3].String())})
}

func main() {
	js.Global().Set("lbGoRegex", js.ValueOf(map[string]any{"findAll": js.FuncOf(findAll), "replaceAll": js.FuncOf(replaceAll)}))
	select {}
}
