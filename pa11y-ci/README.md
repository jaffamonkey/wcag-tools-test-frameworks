### Install pa11y-ci

**Required: NodeJS 17+**

```
npm install -g pa11y-ci
npm install -g pa11y-ci-reporter-html
```

> Install local versiona if permissions issues when trying this on build environment(s)

### Run a test

#### Against a sitemap

`pa11y-ci --config basic-pa11yconfig.json --sitemap https://test.url/sitemap.xml`

#### Against a url

`pa11y-ci --config basic-pa11yconfig.json https://test.url/page_1

#### Against a list of urls with authentication

`pa11y-ci --config pa11yconfig-multiple-urls.json`

