#!/usr/bin/env python3
"""Scaffold src/pages/guides-<slug>.{json,jsonld.html,style.css} from a
hand-written body and a small metadata JSON.

Headline, word count and FAQ pairs are extracted from the body so the schema
is verbatim-identical to the rendered page.

Usage: python3 scripts/gen_guide.py <slug> '<meta json>'
  meta: {"title", "description", "keywords": [...], "section", "crumb", "level", "date": "YYYY-MM-DD"}
"""
import io, json, re, html, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def strip_tags(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s))).strip()


def main(slug, m):
    body = io.open(f"{ROOT}/src/pages/guides-{slug}.body.html", encoding="utf-8").read()
    url = f"https://layerbit.co.in/guides/{slug}.html"
    headline = strip_tags(re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S).group(1))
    text = re.sub(r"<(script|style)\b.*?</\1>", "", body, flags=re.S)
    words = len(strip_tags(text).split())
    faqs = [(strip_tags(q), strip_tags(a)) for q, a in re.findall(
        r'<button class="faq-question">(.*?)<i (?:[^>]*?)data-lucide="chevron-down"></i></button>\s*<div class="faq-answer">(.*?)</div>', body, re.S)]
    assert len(faqs) >= 4, (slug, len(faqs))
    assert 25 <= len(m["title"]) <= 62 and 70 <= len(m["description"]) <= 160, (slug, len(m["title"]), len(m["description"]))
    page = {"file": f"guides/{slug}.html", "prefix": "../", "viewport": "width=device-width, initial-scale=1.0",
            "description": m["description"], "title": m["title"], "canonical": url, "robots": None, "og_url": url,
            "fonts_family": "Space+Grotesk:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap",
            "extra_head_libs": "", "extra_head_after_resources": '  <link rel="stylesheet" href="../css/article.css" />\n', "home_href": "../"}
    io.open(f"{ROOT}/src/pages/guides-{slug}.json", "w", encoding="utf-8").write(json.dumps(page, indent=2, ensure_ascii=False) + "\n")
    org = {"@type": "Organization", "name": "Layerbit Technologies", "url": "https://layerbit.co.in/",
           "logo": {"@type": "ImageObject", "url": "https://layerbit.co.in/icon-512.png", "width": 512, "height": 512}}
    date = m.get("date", "2026-10-17")
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "TechArticle", "@id": url + "#article", "headline": headline, "name": headline, "description": m["description"], "url": url,
         "mainEntityOfPage": {"@type": "WebPage", "@id": url}, "datePublished": date, "dateModified": date, "inLanguage": "en",
         "wordCount": words, "keywords": ", ".join(m["keywords"]), "articleSection": m["section"],
         "author": {"@type": "Organization", "name": "Layerbit Technologies", "url": "https://layerbit.co.in/about.html"}, "publisher": org,
         "image": {"@type": "ImageObject", "url": f"https://layerbit.co.in/images/og/guides-{slug}.jpg", "width": 1200, "height": 630},
         "isAccessibleForFree": True, "proficiencyLevel": m["level"]},
        {"@type": "BreadcrumbList", "@id": url + "#breadcrumb", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://layerbit.co.in/"},
            {"@type": "ListItem", "position": 2, "name": "Guides", "item": "https://layerbit.co.in/blog.html"},
            {"@type": "ListItem", "position": 3, "name": m["crumb"], "item": url}]},
        {"@type": "FAQPage", "@id": url + "#faq", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]},
    ]}
    payload = json.dumps(ld, indent=2, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    io.open(f"{ROOT}/src/pages/guides-{slug}.jsonld.html", "w", encoding="utf-8").write('<script type="application/ld+json">\n' + payload + "\n  </script>")
    io.open(f"{ROOT}/src/pages/guides-{slug}.style.css", "w", encoding="utf-8").write("\n    /* Long-form guide styling lives in css/article.css, linked from this page's head. */\n  ")
    print(f"{slug}: {words} words, {len(faqs)} FAQs")


if __name__ == "__main__":
    main(sys.argv[1], json.loads(sys.argv[2]))
