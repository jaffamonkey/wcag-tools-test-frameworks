# axe-scan local runner

This folder wraps `axe-scan` as a local project dependency for the main tool runner repo.

The top-level `run_all_tools.sh` script installs dependencies here when run with:

```bash
INSTALL_DEPS=1 ./run_all_tools.sh urls.txt
```

and executes the local binary with:

```bash
npm exec -- axe-scan run
```

No global `axe-scan` install is required.

## Login/auth limitation

`axe-scan` can only handle simple/basic authentication. It cannot reuse the Playwright `auth/storage_state.json` browser session used by the other runners.

For that reason, the top-level script automatically omits `axe-scan` when login/auth mode is enabled or when `auth/storage_state.json` exists. The run summary records this as:

```json
"status": "omitted"
```

## Local output flow

The top-level script:

1. copies the shared URL list to `axe-scan/urls.txt`
2. runs `npm exec -- axe-scan run > axe-results.csv`
3. runs `./convert-csv-to-json-files.sh`
4. copies generated JSON reports to `../reports/axe-scan/`
