# follow-aleabito-skill

Codex skill for tracking Serenity / `@aleabitoreddit` on X, turning new posts into Chinese digests, adding first-principles and Buffett-style investment analysis, and optionally sending the digest through macOS iMessage.

This project is for personal research tracking. It does not provide investment advice.

## Features

- Fetches posts, quotes, and optional replies from `@aleabitoreddit`.
- Uses X API v2 when `X_BEARER_TOKEN` is configured.
- Falls back to public X syndication when no API token is available.
- On macOS, can fall back to the user's logged-in Chrome/X page for newer or subscriber-visible posts.
- Builds beginner-friendly Chinese digest briefs with source links.
- Adds a required analysis shape: her view, beginner explanation, first principles, and direct Buffett-style answers.
- Sends finished digests through macOS Messages/iMessage.
- Maintains cumulative mention analytics CSVs for websites or dashboards.
- Generates Xiaohongshu writing briefs and a private research map.

## Requirements

- Codex with local skills enabled.
- Node.js 18 or newer.
- Optional: an X API bearer token for reliable fetches.
- Optional on macOS: Google Chrome logged into X for Chrome fallback.
- Optional on macOS: Messages automation permission for iMessage delivery.

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

Create or update the local config:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito/scripts/setup-config.js" \
  --recipient "<phone-or-apple-id>"
```

For reliable X API fetches, create `~/.follow-aleabito/.env`:

```bash
cp "$HOME/.follow-aleabito/.env.example" "$HOME/.follow-aleabito/.env"
```

Then edit it:

```bash
X_BEARER_TOKEN=...
```

Do not commit `~/.follow-aleabito/.env`, iMessage recipients, analytics state, or generated private reports.

## Daily Digest

Fetch recent posts, quotes, and high-signal replies:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/fetch-updates.js \
  --include-replies \
  --lookback-hours 36 \
  --max-tweets 50 \
  --output /tmp/follow-aleabito-updates.json
node scripts/build-digest-brief.js \
  --input /tmp/follow-aleabito-updates.json \
  --output /tmp/follow-aleabito-brief.md
```

Then ask Codex to use `$follow-aleabito` to read `/tmp/follow-aleabito-brief.md`, write the Chinese digest, and send it by iMessage.

Only mark tweets as seen after iMessage succeeds:

```bash
node scripts/send-imessage.js --file /tmp/follow-aleabito-digest.txt
node scripts/mark-seen.js --file /tmp/follow-aleabito-updates.json
```

## Cumulative Mention Analytics

The analytics workflow is cumulative, not rolling. The first 60-day run seeds the dataset. Later runs append only new posts/replies/quotes and dedupe by `tweet_id`.

Set a website/report output directory:

```bash
export FOLLOW_ALEABITO_REPORTS_DIR="$HOME/Documents/us stock marketplace/reports"
mkdir -p "$FOLLOW_ALEABITO_REPORTS_DIR"
```

Initial backfill:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/analyze-mentions.js --backfill-days 60 --include-replies --resume
```

Daily incremental update:

```bash
node scripts/analyze-mentions.js --incremental --include-replies --resume
```

Cost-controlled test run:

```bash
node scripts/analyze-mentions.js \
  --backfill-days 2 \
  --include-replies \
  --resume \
  --max-pages 1 \
  --output-dir /tmp/aleabito-test \
  --state /tmp/aleabito-test/state.json
```

Rebuild summary files from existing events without calling the X API:

```bash
node scripts/analyze-mentions.js --rebuild-only --include-replies --resume
```

Generated files:

```text
aleabito-mentions-events.csv
aleabito-stock-mentions-cumulative.csv
aleabito-stock-mentions-daily.csv
aleabito-mentions.meta.json
```

Suggested website usage:

- Home/search leaderboard: `aleabito-stock-mentions-cumulative.csv`
- Trend charts: `aleabito-stock-mentions-daily.csv`
- Detail pages and source links: `aleabito-mentions-events.csv`
- Last update/API status: `aleabito-mentions.meta.json`

## CSV Schemas

`aleabito-mentions-events.csv`

```csv
tweet_id,created_at,kind,text,tickers,source_url,conversation_id,referenced_tweet_id
```

`aleabito-stock-mentions-cumulative.csv`

```csv
rank,ticker,mentioned_posts,raw_occurrences,post_mentions,quote_mentions,reply_mentions,first_seen,last_seen,names,primary_theme,research_priority,example_url
```

`aleabito-stock-mentions-daily.csv`

```csv
date,ticker,mentioned_posts,raw_occurrences,post_mentions,quote_mentions,reply_mentions
```

Counting rules:

- `mentioned_posts` counts unique events that mention a ticker.
- `raw_occurrences` counts cashtag occurrences inside event text.
- Replies are included when `--include-replies` is used.
- Retweets are excluded.
- `primary_theme` and `research_priority` are deterministic research labels, not investment ratings.

## Xiaohongshu Brief

Generate a Xiaohongshu writing brief from the cumulative CSV:

```bash
node scripts/build-xhs-brief.js \
  --input "$FOLLOW_ALEABITO_REPORTS_DIR/aleabito-stock-mentions-cumulative.csv" \
  --daily "$FOLLOW_ALEABITO_REPORTS_DIR/aleabito-stock-mentions-daily.csv" \
  --output /tmp/follow-aleabito-xhs-brief.md \
  --variants both
```

The brief is not meant to be pasted blindly. It gives Codex the data table, recent activity, theme groups, and required writing constraints so Codex can produce a polished Xiaohongshu post.

## Research Map

Update the private research map:

```bash
node scripts/update-research-map.js \
  --events "$FOLLOW_ALEABITO_REPORTS_DIR/aleabito-mentions-events.csv" \
  --summary "$FOLLOW_ALEABITO_REPORTS_DIR/aleabito-stock-mentions-cumulative.csv" \
  --output "$HOME/.follow-aleabito/research-map.json"
```

This also writes:

```text
~/.follow-aleabito/research-map.md
```

The deterministic script does not invent financial facts. Missing moat, profitability, customer-risk, or Buffett-style conclusions stay marked as `unverified` or `research map` until separate research is done.

## Automation

For a daily website data refresh, run:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/analyze-mentions.js --incremental --include-replies --resume
node scripts/update-research-map.js \
  --events "$FOLLOW_ALEABITO_REPORTS_DIR/aleabito-mentions-events.csv" \
  --summary "$FOLLOW_ALEABITO_REPORTS_DIR/aleabito-stock-mentions-cumulative.csv" \
  --output "$HOME/.follow-aleabito/research-map.json"
```

For a digest automation, send iMessage only after the digest file is generated, and run `mark-seen.js` only after `send-imessage.js` returns success.

## Notes

- The Chrome fallback requires macOS, Google Chrome, and a logged-in X session.
- iMessage delivery requires macOS Messages automation permission.
- X API results and public syndication results may differ, especially for long posts and subscriber-visible content.
- This is for information tracking and research, not investment advice.
- This project is not affiliated with X, Serenity, Warren Buffett, or the Buffett skills project.
