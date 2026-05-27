---
name: follow-aleabito
description: Track Serenity / @aleabitoreddit on X, turn new posts into concise Chinese market-aware digests, and optionally deliver them through macOS iMessage. Use when the user asks to follow aleabitoreddit, AleaBito, Serenity, or wants daily Chinese updates/reminders from that X account.
---

# Follow AleaBito

## Purpose

Track `@aleabitoreddit` on X and produce a Chinese digest for the user. The digest must be grounded only in fetched posts and must include source URLs.

This account discusses equities, AI infrastructure, semiconductors, neoclouds, and trading ideas. Treat the content as market commentary, not investment advice.

## Data Sources

Use `scripts/fetch-updates.js` to fetch posts. It tries:

1. X API v2 when `X_BEARER_TOKEN` exists in `~/.follow-aleabito/.env`.
2. X public syndication fallback when no token is configured.
3. Logged-in Chrome/X page fallback on macOS when anonymous sources return no current posts.

The syndication fallback can miss the newest posts or truncate long posts. The Chrome fallback depends on the user being logged into X in Google Chrome and may open `https://x.com/aleabitoreddit` in the active Chrome tab. When Chrome shows `Show more` inside a post, expand it before extracting text so long posts and subscriber-visible posts are not summarized from previews. If the JSON output contains `warnings`, mention them briefly in the digest or setup guidance.

Never invent posts, prices, positions, or links. If no fetched post has a URL, do not include it.

## Daily Digest Workflow

Run:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/fetch-updates.js --include-replies --lookback-hours 36 --max-tweets 50 --output /tmp/follow-aleabito-updates.json
node scripts/build-digest-brief.js --input /tmp/follow-aleabito-updates.json --output /tmp/follow-aleabito-brief.md
```

Read `/tmp/follow-aleabito-brief.md` before writing the digest. The brief contains ticker counts, theme groups, selected high-signal replies, and original source links. Use the raw JSON only when the brief is insufficient.

If `tweets` is empty:
- If `config.notifyWhenEmpty` is true, send a short Chinese note: `今天 @aleabitoreddit 没有抓到新的可发送动态。`
- If false, stop without sending.

If there are tweets, write a Chinese digest with:
- Title line: `Serenity / @aleabitoreddit 今日动态`
- `今天她重点看什么`
- 2-4 key takeaways grouped by theme.
- For each included post or theme: `她的观点` -> `小白解释` -> `第一性原理` -> `Buffett 直接判断`.
- Include mentioned tickers/themes, original URL, and created time.
- A short caution line for market/trading content: `仅作信息跟踪，不构成投资建议。`

Keep it concise enough for iMessage. Prefer signal over completeness.

Only after `send-imessage.js` returns `status: ok`, mark tweets as seen. If delivery fails, do not run `mark-seen.js`.

## Cumulative Mention Analytics

Use `scripts/analyze-mentions.js` when the user asks for 60-day mention analytics, a website-readable CSV, ongoing tracking, or ticker mention counts.

This workflow is cumulative, not rolling:

- The first run uses 60 days only as the initial backfill seed.
- Later runs fetch only new content with an overlap window and append by tweet id.
- Existing rows are deduped by `tweet_id`, so overlap fetches do not double-count.
- If the X API fails, keep the previous CSVs and write the failure to `.meta.json`.

Default local website files:

```text
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-mentions-events.csv
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-cumulative.csv
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-daily.csv
/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-mentions.meta.json
```

Initial backfill:

```bash
node scripts/analyze-mentions.js --backfill-days 60 --include-replies --resume
```

Daily incremental update:

```bash
node scripts/analyze-mentions.js --incremental --include-replies --resume
```

Use `--max-pages <n>` for cost-controlled tests. Use `--rebuild-only` to recompute summary/daily CSVs from existing events without calling the X API. Use `--output-dir <dir>` to write reports somewhere else. The script reads `X_BEARER_TOKEN` from `~/.follow-aleabito/.env` and never writes secrets into CSV output.

CSV roles:

- `aleabito-mentions-events.csv`: raw event-level rows for details pages and future re-aggregation.
- `aleabito-stock-mentions-cumulative.csv`: cumulative ticker leaderboard for website home/search.
- `aleabito-stock-mentions-daily.csv`: daily ticker trend rows for charts.
- `aleabito-mentions.meta.json`: last update, API status, output paths, page count, and rate-limit metadata.

## Xiaohongshu Workflow

Use `scripts/build-xhs-brief.js` when the user asks for a Xiaohongshu post based on the mention analytics.

Run:

```bash
node scripts/build-xhs-brief.js \
  --input "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-cumulative.csv" \
  --daily "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-daily.csv" \
  --output /tmp/follow-aleabito-xhs-brief.md \
  --variants both
```

Read the generated brief and write the final post in Chinese. Default to both a full version and an under-1000-Chinese-character version unless the user asks for only one.

For Xiaohongshu copy:

- Make it beginner-friendly and concrete.
- Explain the table before interpreting it.
- Treat high mention count as a research-map signal, not a buy signal.
- Apply first principles and Buffett direct answers in plain language.
- Do not leave Buffett questions unanswered.

## Research Map Workflow

Use `scripts/update-research-map.js` after cumulative analytics when the user wants a durable research map.

Run:

```bash
node scripts/update-research-map.js \
  --events "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-mentions-events.csv" \
  --summary "/Users/vincentlan/Documents/us stock marketplace/reports/aleabito-stock-mentions-cumulative.csv" \
  --output ~/.follow-aleabito/research-map.json
```

The script also writes `~/.follow-aleabito/research-map.md`. Preserve existing manual notes and Buffett fields when refreshing the map. Do not invent financial facts in the deterministic script; if evidence is missing, keep fields as `unverified` or `research map`.

## AI Analysis Framework

When adding `AI 分析`, use both first-principles reasoning and the local `$buffett` skill if available at `${CODEX_HOME:-$HOME/.codex}/skills/buffett/SKILL.md`.

For daily digests, do not use the full Buffett output template unless the user asks for a deep dive on one company. Instead, read only the relevant Buffett references and compress the analysis into 1-3 paragraphs:

- Always apply first principles: value comes from future owner cash flows, durability of demand, supply bottlenecks, pricing power, capital intensity, and rule-of-law/property-rights stability.
- Always use beginner-friendly wording first. Explain terms such as CPO, photonics, 800VDC, P/B, TAM, ASP, margin, and cash flow when they first appear.
- For business quality or moat claims, read `$buffett/references/03-business-moat.md`.
- For management, acquisitions, buybacks, dilution, or capital allocation, read `$buffett/references/04-management-governance.md` and `$buffett/references/06-valuation-capital.md`.
- For China/regulatory/policy risk, leverage, value traps, or when to avoid/exit, read `$buffett/references/07-risk-behavior.md`.
- For technology/semiconductor/AI infrastructure themes, read the technology chapter in `$buffett/references/08-industry-playbooks.md` when needed.

Do not merely ask Buffett-style questions. Answer them directly from available evidence:

- `护城河`: strong / medium / weak / unproven, with one plain-language reason.
- `赚钱能力`: proven / improving / unproven, based on revenue, margin, cash flow, or lack of proof.
- `客户替换风险`: low / medium / high, based on certification, switching cost, second-source risk, and customer concentration.
- `Buffett 式好公司`: yes / not yet / no.
- `当前结论`: research map / investable conclusion / insufficient evidence.

The analysis must distinguish:
- `研究地图`: useful leads to investigate.
- `可投资结论`: only valid after moat, financials, valuation, and margin-of-safety work.

Never turn Serenity's posts into direct buy/sell instructions. Say when the evidence is insufficient for a Buffett-style decision.

## iMessage Delivery

The iMessage recipient lives in `~/.follow-aleabito/config.json`:

```json
{
  "delivery": {
    "method": "imessage",
    "recipient": "+15551234567"
  }
}
```

Send the finished digest with:

```bash
node scripts/send-imessage.js --file /tmp/follow-aleabito-digest.txt
```

After `send-imessage.js` succeeds, mark the tweets as seen:

```bash
node scripts/mark-seen.js --file /tmp/follow-aleabito-updates.json
```

If iMessage delivery fails because the recipient is missing, tell the user to run:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito/scripts/setup-config.js" --recipient "<phone-or-apple-id>"
```

## Setup

Initialize or update config:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito/scripts/setup-config.js" --recipient "<phone-or-apple-id>"
```

For the most reliable and latest X data, add an X API bearer token:

```bash
cp ~/.follow-aleabito/.env.example ~/.follow-aleabito/.env
```

Then edit `~/.follow-aleabito/.env` and set `X_BEARER_TOKEN`.

## Automation

For Codex Desktop recurring jobs, create a daily cron automation that:

1. Uses this skill.
2. Runs `fetch-updates.js`.
3. Writes the Chinese digest to `/tmp/follow-aleabito-digest.txt`.
4. Runs `send-imessage.js`.
5. Runs `mark-seen.js` only after successful send.

Recommended default time: 8:00 AM in the user's timezone unless they specify otherwise.
