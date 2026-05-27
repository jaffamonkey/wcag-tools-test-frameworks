# set -euo pipefail

# mkdir -p reports && \
# python3 -c 'import csv, sys; writer = csv.writer(sys.stdout, quoting=csv.QUOTE_ALL); [writer.writerow(row) for row in csv.reader(sys.stdin)]' < axe-results.csv > tmp_clean.csv && \
# mlr --icsv --ojson --jlistwrap put -q '
#   raw_url = $URL;
#   if (is_absent(raw_url) || raw_url == "") {
#     raw_url = "__missing_url__";
#   }

#   $URL = raw_url;

#   clean_url = raw_url;

#   slug = gsub(clean_url, "^https?://", "");
#   slug = gsub(slug, "/$", "");
#   slug = gsub(slug, "#", "-");
#   slug = gsub(slug, "[^a-zA-Z0-9._-]", "-");
#   slug = gsub(slug, "-+", "-");
#   slug = gsub(slug, "^-|-$", "");

#   if (is_absent(slug) || slug == "") {
#     slug = "__empty_slug__";
#   }

#   filename = "reports/" . slug . ".json";
#   tee > filename, $*
# ' tmp_clean.csv


set -euo pipefail

mkdir -p reports

python3 - <<'PY'
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

INPUT_FILE = "axe-results.csv"
REPORT_DIR = Path("reports")
REPORT_DIR.mkdir(exist_ok=True)

def make_slug(raw_url):
    if not raw_url:
        raw_url = "__missing_url__"

    slug = raw_url.strip()

    # Remove protocol
    slug = re.sub(r"^https?://", "", slug, flags=re.I)

    # Remove query string and fragment for filename base
    slug = re.sub(r"[?#].*$", "", slug)

    # Remove trailing slash
    slug = re.sub(r"/$", "", slug)

    # Treat /index.html, /index.htm, /index.php etc as the folder URL
    slug = re.sub(r"/index\.(html?|php|asp|aspx)$", "", slug, flags=re.I)

    # Replace path slashes with hyphens
    slug = slug.replace("/", "-")

    # Replace anything awkward with hyphen
    slug = re.sub(r"[^a-zA-Z0-9._-]", "-", slug)

    # Collapse repeated hyphens
    slug = re.sub(r"-+", "-", slug)

    # Trim leading/trailing hyphens
    slug = slug.strip("-")

    return slug or "__empty_slug__"


grouped = defaultdict(list)

with open(INPUT_FILE, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)

    for row in reader:
        raw_url = row.get("URL") or "__missing_url__"
        row["URL"] = raw_url

        slug = make_slug(raw_url)
        grouped[slug].append(row)


for slug, rows in grouped.items():
    output_file = REPORT_DIR / f"{slug}.json"

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)

    print(f"Wrote {output_file} ({len(rows)} rows)")
PY