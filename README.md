# orca-usage

A terminal dashboard for the Claude and Codex accounts managed by [Orca](https://orca.computer). It shows how much of each account's rate limit is left, plots the history, and can move Orca to a less busy account before the one you are on runs out.

```
  전체 리소스   4 계정                          alice@example.com  사용량 %  6h
  5h     ━━━━━━━━━━│━━━━━━━━━━━━━━  27%  1.1/4    ● 5h
  7d     ━━━━━━━━━━━━━│━━━━━━━━━━━  37%  1.5/4     100 ┼
                                                       ┤                    ──
  1  * alice@example.com  [Max 20x]  우선 사용          ┤              ╭────
     5h     ━━━│━━━━━━━━━━━━━━━━━━  16%   4h 16m    75 ┤              ╯
     7d     ━━━━━━━━━│━━━━━━━━━━━━   9%   4d 10h       ┤           ╭─
                                                       ┤          ╭╯
> 2    bob@example.com  [Max 20x]                   50 ┤         ╭╯
     5h     ━━━━━━━━━━━━━━━━│━━━━━  86%   1h 46m       ┤        ╭╯
     7d     ━━━━━━━│━━━━━━━━━━━━━━  36%   4d 21h       ┤   ╭─  ╭╯
                                                    25 ┤╭──╯   ╯
```

## What it does

- **Reads every account at once.** Orca keeps each Claude login in its own credential slot; this walks all of them instead of only the one you are attached to.
- **Covers both providers.** Claude and Codex accounts are listed in separate sections, because they do not share a window layout: Claude reports a 5-hour, a 7-day and per-model window, Codex reports a weekly one plus rate-limit reset credits.
- **Tracks the windows that matter.** The 5-hour and 7-day limits, plus per-model windows when you want them.
- **Plots history.** Usage level over time, or consumption rate in percentage points per hour. Ranges from 3 hours to a month. Level lines are drawn in braille, eight dots per cell, the way btop and bottom do it; the axis picks 20, 50 or 100 to fit the data and the 5h window gets half the height since it moves fastest. `--graph block` falls back to box characters for fonts whose braille glyphs leave a gap.
- **Keeps a control log.** A fourth panel lists what the tool did on its own, newest first: polls when the result changed, every token refresh, cycle trigger and account switch, with failures in red. Notices disappear after eight seconds, so this is where "why did the account change" gets answered. The last 500 entries persist across restarts, and the cycle trigger reads its own ten-minute cooldown from them.
- **Shows the week ahead.** A third graph mode draws the next seven days one hour per cell, coloured by how much weekly headroom the accounts together will have then. Resets are exact; the stretch between them is projected from the observed burn rate. Today's row is split per account so you can see who is blocked and when it clears. A `!` marks hours where an account will reset with more than 15% left unspent.
- **Leaves gaps where there is no data.** Sampling gaps are drawn as gaps, not as a flat line carried forward from the last reading.
- **Suggests where to go next.** Badges mark the account that is best to use now, the one whose weekly quota will expire unused, and the one to save.
- **Switches accounts.** Manually with Enter, or automatically when the account you are on gets close to its limit.

## Requirements

- macOS. Credentials live in the login keychain and are read through `/usr/bin/security`.
- [Orca](https://orca.computer), running, with at least one Claude or Codex account signed in.
- [Bun](https://bun.sh). It runs the JSX directly, so there is no build step.

## Install

```sh
git clone https://github.com/kimjisub/orca-usage.git
cd orca-usage
bun install
./orca-usage
```

To run it from anywhere, link it onto your `PATH`. The launcher resolves the
symlink, so it finds the repository wherever you cloned it:

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/orca-usage" ~/.local/bin/orca-usage
```

`~/.local/bin` is not on the default macOS `PATH`. Add it in your shell rc if
it is missing: `export PATH="$HOME/.local/bin:$PATH"`.

## Usage

```
orca-usage                     interactive dashboard (polls every 120s)
orca-usage --interval 600      polling interval in seconds (minimum 60)
orca-usage --once              print once and exit
orca-usage --json              machine-readable output (pair with --once)
orca-usage --no-refresh-tokens never refresh an expired token
orca-usage --graph block       draw level lines with box characters instead of braille
```

### Keys

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `r` | Refresh all | `t` | Reissue the selected account's token |
| `d` | Cycle the right panel (tabs are clickable too) | `f` | Show or hide per-model windows |
| `w` | Cycle the range (3h to 1M) | `a` | Toggle automatic switching |
| `g` | Collapse or expand the graph | `o` | Toggle cycle auto-trigger |
| `q` | Quit | | |
| `Enter` | Point Orca at the selected account | `1`-`9` | Jump to an account |

Arrow keys or `j` / `k` move the selection. Clicking a row works too.

### Badges

| Marker | Meaning |
| --- | --- |
| `*` | The account Orca is attached to right now |
| 한도 임박 | 5h or 7d is at 90% or more, so it is unusable for now |
| Red name | Credentials are broken; sign in again. The reason is printed next to the name |
| 우선 사용 | Best account to be on |
| 소진 권장 | Weekly quota large enough that it will expire unused; spend it |
| 사용 자제 | More than half the week is gone; save this one |
| 리셋 크레딧 | Codex only. Spending one empties the short window straight away |

## Automatic switching

Off by default; `a` turns it on, and it only moves between Claude accounts. When the tightest window on the active account passes 80% and another account is more than 15 percentage points freer, orca-usage asks the Orca runtime to switch. After a switch it waits 10 minutes before switching again.

Terminals that are already open keep running on the old account. The new one applies to sessions you open afterwards.

## Cycle auto-trigger

Off by default; `o` turns it on. The 5-hour and 7-day windows only start counting on the first request, so an account you are not using has no reset clock running. When you do switch to it you wait the full five hours or seven days from that moment. With keep-alive on, each poll looks for Claude accounts whose 5h window is missing or has closed and sends a one-token request to the cheapest model to open it. Opening the 5h window starts the 7d one too. The cost is below the integer percent the usage endpoint reports, so it shows as zero. The same account is not touched twice within ten minutes. A token that has been expired for over an hour is refreshed here, since Orca only refreshes tokens for accounts it is using and leaves idle ones expired.

The bottom of the account panel lists what runs on its own: the usage poll, token refreshes, the cycle trigger and account switching, each with what it last did. On short terminals it folds to one line.

## How it works

Usage comes from Orca first. The runtime already polls every account it manages, Claude and Codex alike, and hands the numbers back in one call over its local Unix socket. orca-usage asks for a refresh on each poll and copies the result. It does not touch a credential on this path.

The reason is the rate limit on the usage endpoint itself: five calls per account per five minutes. Orca reaches it with the same keychain credential orca-usage would use, so two pollers share one budget and the active account, which Orca refreshes most often, is the one that runs out and gets backed off.

If Orca is not running, orca-usage falls back to reading the OAuth credentials under `~/Library/Application Support/orca/claude-accounts/` from the login keychain, refreshing the access token when it has expired, and calling the usage endpoint directly. The header says so while that is the case. Codex has no fallback; its last known values stay on screen.

The account Orca is currently attached to comes from the Orca runtime over its local Unix socket, not from `~/.claude.json`. That file records where Claude Code last logged in, which drifts from Orca's choice as soon as you switch accounts in the app.

Samples are cached under `~/.cache/orca-usage/` so restarting the dashboard does not lose the history or spend API calls redrawing what it already knows.

## Notes

- Credentials are read from and written back to the keychain only. Nothing is sent anywhere except Anthropic's own endpoints.
- Source comments are in Korean.

## License

MIT
