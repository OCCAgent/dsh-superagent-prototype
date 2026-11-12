# 009 WeCom intelligent robot

Use this guide to run dsh-superagent as an Enterprise WeChat (WeCom) intelligent robot, and to run it beside a Feishu bot for channel comparison. It builds on [006 Deployment](006-deployment.md).

## Why a long connection

A WeCom intelligent robot (智能机器人) can receive messages in two ways: an HTTPS callback server, or a long connection opened by the robot. The long connection needs no public address, no certificate and no callback URL configuration, so a testing machine behind NAT can host it. dsh-superagent implements the long connection.

The protocol is JSON frames over one WebSocket at `wss://openws.work.weixin.qq.com`, each `{cmd, headers: {req_id}, body}`:

| Direction | Command | Purpose |
| --- | --- | --- |
| client → gateway | `aibot_subscribe` | Authenticates with `{bot_id, secret}`; the ack carries `errcode` |
| client → gateway | `ping` | Heartbeat; three unanswered pings mark the connection dead |
| gateway → client | `aibot_msg_callback` | A message in a single or group chat |
| gateway → client | `aibot_event_callback` | Events; `disconnected_event` means another connection took the bot |
| client → gateway | `aibot_respond_msg` | Replies inside the inbound frame's `req_id` window, as `text` |
| client → gateway | `aibot_send_msg` | Sends outside that window, as `markdown`, keyed by `chatid` and `chat_type` |

Two gateway rules shape the implementation:

- **Header case matters.** The gateway answers `404` when the upgrade request spells `upgrade` and `connection` in lowercase, which the Node built-in WebSocket client and browsers do. The Source uses `ws`, which writes the canonical spelling.
- **One live connection per bot.** A second subscriber kicks the first. The Source reports `Another connection took over the bot` and stops instead of reconnecting, so two processes cannot take turns kicking each other.

## Credentials

Create the robot in the WeCom administration console, choose the long-connection mode, and copy its Bot ID and Secret. Store them in a file only the operator can read:

```sh
mkdir -p ~/.dsh/state/superagent/wecom && chmod 700 ~/.dsh/state/superagent/wecom
cat > ~/.dsh/state/superagent/wecom/bot.json <<'EOF'
{"botId": "<bot id>", "secret": "<secret>"}
EOF
chmod 600 ~/.dsh/state/superagent/wecom/bot.json
```

The Source reads `stateDir/wecom/bot.json` by default, and the **Bot credential file** setting can point somewhere else. Secrets stay out of the database, the settings API and the panel.

## Settings

1. **Source.** Enable the `dsh-superagent-wecom` entry in the profile's `cordis.patch.yml`, as the Feishu entry is enabled. Then set **Receive direct messages**, and list group chats whose `@` mentions should arrive. A group message becomes a Trigger only when the bot is mentioned; a direct message always does.
2. **Policy.** Add the `userid` of every person who may ask for work. A message from someone not on the list is recorded as dropped with reason `senderNotMember`, and its sender id is visible in the Source's dropped list, which is how an operator finds the id the first time.

Replies reuse the inbound `req_id` while the gateway still accepts it, and fall back to `aibot_send_msg` afterwards, so a long assessment still reaches the chat. Replies are split at 18,000 bytes because the platform rejects a larger body whole.

## Isolated comparison profile

To compare WeCom with Feishu without mixing state, run a second profile. It needs its own panel port, its own `stateDir`, and only the WeCom Source enabled:

```yaml
- id: webserver
  config: { host: 127.0.0.1, port: 3086 }
- id: dsh-superagent
  config: { stateDir: /Users/me/.dsh/state/superagent-wecom }
- id: dsh-superagent-feishu
  disabled: true
- id: dsh-superagent-wechat
  disabled: true
- id: dsh-superagent-wecom
  disabled: false
```

Start and inspect it as any other profile:

```sh
scripts/dsh-superagent --profile superagent-wecom --url http://127.0.0.1:3086 start
scripts/dsh-superagent --profile superagent-wecom --url http://127.0.0.1:3086 status
```

Its Tickets live under the test `stateDir`, so the two environments never share Executor directories, policy revisions or Ticket history. The GitHub Source and agent CLI still point at the same repository; keep test Executors to branches they can throw away.

## Health and troubleshooting

| Health | Meaning | What to do |
| --- | --- | --- |
| `Waiting for the WeCom bot credentials` | `botFile` is missing or unreadable | Write `bot.json` as above; the Source retries every 10 seconds |
| `Another connection took over the bot` | Another process subscribed with the same Bot ID | Stop the other process; this Source stays stopped until the service restarts |
| `N consecutive failed polls; last: …` | The handshake, the subscription or the socket failed | Read the detail: `HTTP 404` means the upgrade headers were wrong; `aibot_subscribe rejected` means the credentials are wrong |

The Source reports one `wecom` health entry. Events other than `disconnected_event` are ignored.
