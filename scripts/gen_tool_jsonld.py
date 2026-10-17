#!/usr/bin/env python3
"""Regenerate src/pages/<slug>.jsonld.html for a tool page from its sources.

SoftwareApplication (name from the H1, description from the page JSON,
featureList from --features), BreadcrumbList, and a FAQPage whose
questions and answers are extracted verbatim from the body's .faq-item
blocks, so the schema can never drift from what the page shows.

Usage: python3 scripts/gen_tool_jsonld.py <slug> [--features "a|b|c"] [--crumb "Name"]
"""
import io, json, re, html, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def strip_tags(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s))).strip()


def main():
    slug = sys.argv[1]
    features = None
    crumb = None
    if "--features" in sys.argv:
        features = [f.strip() for f in sys.argv[sys.argv.index("--features") + 1].split("|") if f.strip()]
    if "--crumb" in sys.argv:
        crumb = sys.argv[sys.argv.index("--crumb") + 1]
    page = json.load(io.open(f"{ROOT}/src/pages/{slug}.json", encoding="utf-8"))
    body = io.open(f"{ROOT}/src/pages/{slug}.body.html", encoding="utf-8").read()
    url = "https://layerbit.co.in/" + page["file"]
    name = strip_tags(re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S).group(1))
    faqs = [(strip_tags(q), strip_tags(a)) for q, a in re.findall(
        r'<button class="faq-question">(.*?)<i data-lucide="chevron-down"></i></button>\s*<div class="faq-answer">(.*?)</div>', body, re.S)]
    app = {"@type": "SoftwareApplication", "@id": url + "#app", "name": name, "url": url, "description": page["description"],
           "applicationCategory": "DeveloperApplication", "operatingSystem": "Any (runs in the browser)", "browserRequirements": "Requires JavaScript",
           "isAccessibleForFree": True, "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
           "publisher": {"@id": "https://layerbit.co.in/#organization"}}
    if features:
        app["featureList"] = features
    graph = [app,
             {"@type": "BreadcrumbList", "@id": url + "#breadcrumb", "itemListElement": [
                 {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://layerbit.co.in/"},
                 {"@type": "ListItem", "position": 2, "name": "Tools", "item": "https://layerbit.co.in/blog.html"},
                 {"@type": "ListItem", "position": 3, "name": crumb or name, "item": url}]}]
    if faqs:
        graph.append({"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]})
    ld = {"@context": "https://schema.org", "@graph": graph}
    payload = json.dumps(ld, indent=2, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    io.open(f"{ROOT}/src/pages/{slug}.jsonld.html", "w", encoding="utf-8").write('<script type="application/ld+json">\n' + payload + "\n  </script>")
    print(f"{slug}: {len(faqs)} FAQs, name={name!r}")


if __name__ == "__main__":
    main()
