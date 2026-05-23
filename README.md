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

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/follow-aleabito"
node scripts/fetch-updates.js --output /tmp/follow-aleabito-updates.json
```

Then ask Codex to use `$follow-aleabito` to summarize the fetched JSON and send the digest by iMessage.

## Notes

- The Chrome fallback requires macOS, Google Chrome, and a logged-in X session.
- iMessage delivery requires macOS Messages automation permission.
- This is for information tracking and research. It is not investment advice.
- This project is not affiliated with X, Serenity, or Warren Buffett.
