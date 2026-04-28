# CropsIntel V3 — Autonomous Agent (Railway)

This folder contains the runtime for an autonomous Claude Code agent that builds CropsIntel V3 features 24/7 on a Railway-hosted container.

## Architecture

```
┌────────────────────────┐         ┌────────────────────────┐
│  Your Mac              │         │  GitHub                │
│  • VS Code             │ ──pull─▶│  • cropsintel-v3 main  │
│  • review + push tasks │ ◀─push──│  • runs CI on push     │
└────────────────────────┘         └────────┬───────────────┘
                                            │
                                            │ webhook + git
                                            ▼
                       ┌────────────────────────────────────┐
                       │  Railway service                   │
                       │  ─────────────────                 │
                       │  • Docker container, runs forever  │
                       │  • agent-loop.sh every 5 min:      │
                       │      - git pull                    │
                       │      - pick next task from queue   │
                       │      - run Claude Code             │
                       │      - npm run build               │
                       │      - commit + push if green      │
                       │      - WhatsApp ping on result     │
                       └────────────────────────────────────┘
```

## How tasks flow

You add a markdown file to `.agent/tasks/queued/` and push. Within 5 minutes, the agent:

1. Pulls your task file
2. Moves it to `.agent/tasks/in-progress/`
3. Invokes Claude Code with the task + this folder's `CLAUDE.md` system prompt
4. Claude writes code, runs build, commits when green
5. On success: pushes commit + moves task to `.agent/tasks/done/` + WhatsApp ✅
6. On question/failure: writes `.agent/questions/<task-id>-q.md` + WhatsApp ❓

## Folder layout (in the cropsintel-v3 repo)

```
agent/
├── Dockerfile           # Container image (Railway builds this)
├── agent-loop.sh        # Main loop, runs forever
├── notify-whatsapp.sh   # Twilio WhatsApp sender
├── CLAUDE.md            # System prompt for Claude Code (the rules)
└── README.md            # This file

.agent/
├── tasks/
│   ├── queued/          # YOU put tasks here. Agent picks alphabetical first.
│   ├── in-progress/     # Agent moves task here while working.
│   ├── done/            # Successfully completed tasks.
│   └── failed/          # Tasks that failed; logs alongside.
└── questions/           # Agent writes questions here when stuck.
```

## Railway setup (one-time, ~15 minutes)

### 1. Sign up
- Go to https://railway.app/login
- Sign in with GitHub (the `muzammil691` account that owns cropsintel-v3)
- Confirm email if prompted

### 2. Create a new project
- Click **New Project** → **Deploy from GitHub repo**
- Pick `cropsintel-v3`
- Railway will start building. **Cancel that build** — it's trying to deploy V3 itself, but we want the agent.

### 3. Configure the service to use the agent Dockerfile
- Open the service Railway just created
- Go to **Settings** tab
- **Source**:
  - Root Directory: `agent`
  - Watch Paths: `agent/**`
- **Build**:
  - Builder: `Dockerfile`
  - Dockerfile Path: `Dockerfile` (relative to root directory)
- **Deploy**:
  - Start Command: leave blank (Dockerfile CMD handles it)
  - Restart Policy: **Always**

### 4. Add environment variables (Variables tab)

| Name | Value | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | https://console.anthropic.com/settings/keys (create new key, name it `vps-claude-code`) |
| `AGENT_SSH_PRIVATE_KEY` | (full multi-line private key) | Generate fresh via `ssh-keygen -t ed25519 -f agent_key -N ""` on your Mac, paste the contents of `agent_key` (NOT `agent_key.pub`) |
| `SUPABASE_ACCESS_TOKEN` | `sbp_...` | https://supabase.com/dashboard/account/tokens — generate new |
| `SUPABASE_PROJECT_REF` | `hzrnohsxigrqlmzegwlb` | V3 Supabase project ref |
| `TWILIO_ACCOUNT_SID` | `AC...` | Your Twilio dashboard (V2 already has these) |
| `TWILIO_AUTH_TOKEN` | (token) | Twilio dashboard |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` | Your Twilio WhatsApp sender (sandbox or verified) |
| `TWILIO_WHATSAPP_TO` | `whatsapp:+971...` | Your personal WhatsApp |
| `REPO_URL` | `git@github.com:muzammil691/cropsintel-v3.git` | (default in script — only override if needed) |
| `SLEEP_SECONDS` | `300` | (default — 5 min between cycles) |

### 5. Add the agent's SSH public key to GitHub as a deploy key
- After generating `agent_key` + `agent_key.pub` on your Mac, copy the contents of `agent_key.pub`
- Go to https://github.com/muzammil691/cropsintel-v3/settings/keys
- Click **Add deploy key**
- Title: `Railway agent`
- Key: paste `agent_key.pub` contents
- ✅ Check **Allow write access** (the agent needs to push)
- Click **Add key**

### 6. Deploy
- Back in Railway, hit **Deploy**
- Watch the deploy logs. First deploy takes ~3-5 min (Docker build).
- Once running, the agent's first action is `notify-whatsapp.sh "🤖 CropsIntel V3 agent online"` — you should get a WhatsApp message within ~1 minute.

### 7. Verify
- The agent will see `phase-1.3-auth.md` in `.agent/tasks/queued/` (we pre-loaded it)
- Within ~5 min, it should move that file to `.agent/tasks/in-progress/` and start working
- Check Railway's **Deployments** → **Logs** to watch the loop in real-time
- Watch GitHub for new commits from `agent@cropsintel.com`

## How you interact with the agent (daily)

### Adding a new task

1. In VS Code on your Mac, create a new file:
   ```
   .agent/tasks/queued/phase-1.5-market-intel.md
   ```
2. Write the task. Use the template in `.agent/tasks/queued/_template.md` (copy it).
3. Save, stage in VS Code's Source Control panel, commit, click **Sync** (the up-arrow).
4. Agent picks it up within 5 min.

### Answering a question

1. Agent writes `.agent/questions/phase-1.5-q.md`
2. You see WhatsApp ping
3. Open the file in VS Code, append your answer at the bottom under `## Answer`
4. Save + commit + sync
5. Agent picks up the answered question on the next cycle, applies the answer, continues

### Killing or pausing the agent

- Railway dashboard → Deployments → Stop service
- Or push an empty file `.agent/PAUSE` — the loop checks for this and idles

## Cost estimate

- **Railway:** $5/month (Hobby plan) covers ~500 hours/month of small container time. The agent uses ~10 GB RAM-hours/day = ~300/month. Within free credits or first tier.
- **Anthropic API:** depends on agent usage. Each task ~$0.50-2.00 in Claude tokens. Phase 1 has ~15 sub-tasks → ~$15-30 total for Phase 1.
- **Twilio:** WhatsApp messages are ~$0.005 each. ~30 messages/day = $4.50/month. Negligible.
- **Total: ~$10-15/month while actively building. $0 when idle (no tasks queued).**

## Troubleshooting

### Agent doesn't start
- Check Railway logs. Look for `[agent-loop]` lines.
- Most common: `AGENT_SSH_PRIVATE_KEY not set` → re-paste the key into Railway Variables.
- Or: `git push` fails → SSH deploy key on GitHub doesn't have write access. Toggle the checkbox.

### Agent commits but build fails on GitHub Actions
- The agent runs `npm run build` locally before pushing. If GitHub builds differently, the env vars in GitHub Actions Secrets might differ from what the agent has.
- Check `https://github.com/muzammil691/cropsintel-v3/actions` for the build log.

### Agent gets into a loop on the same task
- Look in `.agent/tasks/failed/` — it'll have the build/log file showing what went wrong.
- Often: a missing dependency, a TypeScript error from auto-gen types out of sync.
- Resolution: SSH into Railway service (`railway shell`), inspect, fix manually, push, restart.

### You want to stop everything immediately
```bash
git checkout main
echo "STOP" > .agent/PAUSE
git add .agent/PAUSE
git commit -m "chore: pause agent"
git push
```

The agent checks for `.agent/PAUSE` on every cycle. If the file exists, it sleeps 5 min and rechecks. To resume: `rm .agent/PAUSE && git push`.

---

**End of agent README.**
