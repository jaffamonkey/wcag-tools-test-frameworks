# Install
```
npm install -g axe-scan
```

Run
```bash
axe-scan run > axe-results.csv
```

# Convert CSV to Json
```bash
./convert-csv-to-json-files.sh
```


# Useful check on CSV that all pages counted

```bash
python3 - <<'PY'
import csv
from collections import Counter

with open("axe-results.csv", newline="", encoding="utf-8") as f:
    rows = csv.DictReader(f)
    counts = Counter((r.get("URL") or "").strip() for r in rows)

print("Distinct URL values in CSV:", len(counts))
for url, count in counts.items():
    print(count, url)
PY
```