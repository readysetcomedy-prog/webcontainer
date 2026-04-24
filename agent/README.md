# GetXsite Local Agent

Runs on your machine. Lets the GetXsite studio drive a real `claude` (or `codex`) process and run shell commands on your local box, while you use the studio's chat / file editor / preview / deploy UI in any browser.

The agent talks to the studio over a Supabase Realtime channel scoped to your user id — no inbound port required, works behind any firewall.

## Install

```bash
npm install -g @getxsite/agent
```

## Run

Find your user id at <https://getxsite.com/app> → **Local agent** panel. Then:

```bash
GETXSITE_USER_ID=<your-uuid> getxsite-agent
```

Or:

```bash
getxsite-agent --user-id <your-uuid>
```

You should see:

```
[agent] Connected as your-machine on channel agent-<uuid>.
```

The studio will show **Connected** once it sees the agent's heartbeat. From there, the chat panel sends prompts to your local `claude` / `codex` and streams responses back into the browser.

## What the agent can do

- Run shell commands the studio asks for (e.g. `claude -p "<prompt>"`).
- Stream stdout/stderr back to the studio.
- Be killed cleanly when the studio sends a kill signal.

## What it can't do (yet)

- Read/write files on your disk through the studio (next release).
- Watch the project directory for changes and sync to the studio (next release).
- Forward dev server ports (next release).

## Security

- The channel is `agent-<your-uuid>`. Your uuid is a random 128-bit value — it's the secret. Don't paste it into untrusted places.
- The agent only executes commands originating on the studio side via that channel. There's no listening port on your machine.
- All traffic flows through Supabase's TLS-encrypted Realtime infra.
