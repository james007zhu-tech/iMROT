"""Static check: every t("key") used in src/ exists in all three message files.  python3 scripts/dev/check-keys.py"""
import json, re, pathlib, sys
msgs = {l: json.load(open(f"messages/{l}.json")) for l in ["th", "zh", "en"]}
missing = []
for f in pathlib.Path("src").rglob("*.tsx"):
    s = f.read_text()
    var_ns = {}
    for m in re.finditer(r"const\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*\"(\w+)\"", s):
        var_ns[m.group(1)] = m.group(2)
    for m in re.finditer(r"const\s*\[([\w\s,]+)\]\s*=\s*await\s+Promise\.all\(\[([^\]]+)\]", s):
        names = [x.strip() for x in m.group(1).split(",")]
        calls = re.findall(r"getTranslations\(\"(\w+)\"\)|[\w.]+\(", m.group(2))
        nss = re.findall(r"getTranslations\(\"(\w+)\"\)|(?<![\w\"])[a-zA-Z_][\w.]*\((?!\")", m.group(2))
        parts = [p.strip() for p in re.split(r",(?![^()]*\))", m.group(2))]
        for n, p in zip(names, parts):
            mm = re.match(r"getTranslations\(\"(\w+)\"\)", p)
            if mm: var_ns[n] = mm.group(1)
    for var, ns in var_ns.items():
        for m in re.finditer(rf"(?<![\w.]){var}\(\s*\"([\w.]+)\"", s):
            key = m.group(1)
            for l, d in msgs.items():
                node = d.get(ns, {})
                ok = True
                for part in key.split("."):
                    if isinstance(node, dict) and part in node: node = node[part]
                    else: ok = False; break
                if not ok: missing.append(f"{f}: {ns}.{key} [{l}]")
for x in sorted(set(missing)): print(x)
print(f"{len(set(missing))} missing", file=sys.stderr)
sys.exit(1 if missing else 0)
