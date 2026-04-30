mkdir -p reports && \
python3 -c 'import csv, sys; writer = csv.writer(sys.stdout, quoting=csv.QUOTE_ALL); [writer.writerow(row) for row in csv.reader(sys.stdin)]' < axe-results.csv > tmp_clean.csv && \
mlr --icsv --ojson --jlistwrap put -q '
  clean_url = gsub($URL, "/$", "");
  slug = gsub(clean_url, "^https?://", "");
  slug = gsub(slug, "[^a-zA-Z0-9._-]", "-");
  slug = gsub(slug, "-+", "-");
  slug = gsub(slug, "^-|-$", "");
  filename = "reports/" . slug . ".json";
  tee > filename, $*
' tmp_clean.csv && \
rm tmp_clean.csv