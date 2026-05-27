# follow-aleabito-skill

Codex skill for tracking Serenity / `@aleabitoreddit` on X, translating new posts into Chinese, adding first-principles and Buffett-style investment analysis, and optionally delivering the digest through macOS iMessage.

## What It Does

- Fetches posts from `@aleabitoreddit`.
- Uses X API v2 when `X_BEARER_TOKEN` is configured.
- Falls back to public X syndication.
- On macOS, can fall back to the user's logged-in Google Chrome/X page for newer or subscriber-visible posts.
- Produces Chinese digests with source links.
- Adds AI analysis that separates research leads from investable conclusions.
- Sends the final digest via iMessage using macOS Messages automation.

## Install

```bash
git clone https://github.com/lanfuli/follow-aleabito-skill.git
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R follow-aleabito-skill/skills/follow-aleabito "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
```

Optional but recommended for the Buffett analysis layer:

```bash
git clone https://github.com/agi-now/buffett-skills.git /tmp/buffett-skills
cp -R /tmp/buffett-skills/skills/buffett "${CODEX_HOME:-$HOME/.codex}/skills/buffett"
```

## Configure

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito/scripts/setup-config.js" --recipient "<phone-or-apple-id>"
```

For more reliable X data, add an X API bearer token:

```bash
cp "$HOME/.follow-aleabito/.env.example" "$HOME/.follow-aleabito/.env"
```

Then set:

```bash
X_BEARER_TOKEN=...
```

## Run

Daily digest:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/fetch-updates.js --include-replies --lookback-hours 36 --max-tweets 50 --output /tmp/follow-aleabito-updates.json
node scripts/build-digest-brief.js --input /tmp/follow-aleabito-updates.json --output /tmp/follow-aleabito-brief.md
```

Then ask Codex to use `$follow-aleabito` to read `/tmp/follow-aleabito-brief.md`, write a beginner-friendly Chinese digest with first-principles and Buffett-style direct answers, and send it by iMessage.

Only mark tweets as seen after iMessage succeeds:

```bash
node scripts/send-imessage.js --file /tmp/follow-aleabito-digest.txt
node scripts/mark-seen.js --file /tmp/follow-aleabito-updates.json
```

## Cumulative Mention Analytics

Build the initial cumulative dataset from the last 60 days:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/analyze-mentions.js --backfill-days 60 --include-replies --resume
```

Then keep appending new posts/replies/quotes:

```bash
node scripts/analyze-mentions.js --incremental --include-replies --resume
```

By default, on Vincent's local machine this writes website-readable files to:

```text
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-mentions-events.csv
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-cumulative.csv
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-daily.csv
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-mentions.meta.json
```

For another machine or website, set `FOLLOW_ALEABITO_REPORTS_DIR` or pass `--output-dir`.

## Xiaohongshu + Research Map

Generate a Xiaohongshu writing brief from the cumulative CSV:

```bash
node scripts/build-xhs-brief.js \
  --input "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-cumulative.csv" \
  --daily "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-daily.csv" \
  --output /tmp/follow-aleabito-xhs-brief.md \
  --variants both
```

Update the private research map:

```bash
node scripts/update-research-map.js \
  --events "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-mentions-events.csv" \
  --summary "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-cumulative.csv" \
  --output ~/.follow-aleabito/research-map.json
```

## Notes

- The Chrome fallback requires macOS, Google Chrome, and a logged-in X session.
- iMessage delivery requires macOS Messages automation permission.
- API tokens, iMessage recipients, analytics cache, and private research maps should stay outside the public repo.
- This is for information tracking and research. It is not investment advice.
- This project is not affiliated with X, Serenity, or Warren Buffett.
