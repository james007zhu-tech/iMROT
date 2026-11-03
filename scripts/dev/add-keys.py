"""Merge new UI strings into messages/{th,zh,en}.json.  Usage: python3 scripts/dev/add-keys.py keys.json
keys.json: {"namespace": {"key": ["ไทย", "中文", "English"], ...}, ...}  — existing keys are overwritten."""
import json, sys
new = json.load(open(sys.argv[1]))
for i, lang in enumerate(["th", "zh", "en"]):
    p = f"messages/{lang}.json"
    d = json.load(open(p))
    for ns, keys in new.items():
        d.setdefault(ns, {})
        for k, v in keys.items():
            d[ns][k] = v[i]
    json.dump(d, open(p, "w"), ensure_ascii=False, indent=2)
    open(p, "a").write("\n")
print("merged", sum(len(v) for v in new.values()), "keys")
