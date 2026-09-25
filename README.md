# orca-usage

A terminal dashboard for the Claude and Codex accounts managed by [Orca](https://orca.computer). It shows how much of each account's rate limit is left, plots the history, and can move Orca to a less busy account before the one you are on runs out.

```
  Claude   4 계정                               alice@example.com  사용량 %  6h
  5h     ━━━━━━━━━━│━━━━━━━━━━━━━━  27%  1.1/4    ● 5h
  7d     ━━━━━━━━━━━━━│━━━━━━━━━━━  37%  1.5/4     100 ┼
                                                       ┤                    ──
  1  * alice@example.com  [Max 20x]                    ┤              ╭────
     5h     ━━━│━━━━━━━━━━━━━━━━━━  16%   4h 16m    75 ┤              ╯
     7d     ━━━━━━━━━│━━━━━━━━━━━━   9%   4d 10h       ┤           ╭─
                                                       ┤          ╭╯
> 2    bob@example.com  [Max 20x]                   50 ┤         ╭╯
     5h     ━━━━━━━━━━━━━━━━│━━━━━  86%   1h 46m       ┤        ╭╯
     7d     ━━━━━━━│━━━━━━━━━━━━━━  36%   4d 21h       ┤   ╭─  ╭╯
                                                    25 ┤╭──╯   ╯
  Codex   2 계정
  7d     ━━━━━━━━━━━━━━│━━━━━━━━━━━  65%  1.3/2

  3  * carol@example.com  [Pro]
```

## What it does

- **Reads every account at once.** Orca keeps each Claude login in its own credential slot; this walks all of them instead of only the one you are attached to.
- **Covers both providers.** Claude and Codex accounts are listed in separate sections, because they do not share a window layout: Claude reports a 5-hour, a 7-day and per-model window, Codex reports a weekly one plus rate-limit reset credits. Both carry their plan next to the name: Claude's tier comes from its account metadata, Codex's from the `chatgpt_plan_type` claim in the OAuth token Orca stores per account, since Orca's own account list leaves that field empty for accounts signed in some time ago.
- **Totals each provider on its own.** Every section opens with a bar for that provider as a whole: the same-named windows averaged over its accounts, with `1.3/2` reading as "1.3 accounts' worth of a 2-account pool spent". Claude and Codex are never added together, since a `7d` window means a different quota on each and one average over both would be wrong in its denominator. Selecting a totals line draws that provider's combined history in the graph.
- **Tracks the windows that matter.** The 5-hour and 7-day limits, and the per-model windows alongside them.
- **Plots history.** Usage level over time, or consumption rate in percentage points per hour. Ranges from 3 hours to a month. Level lines are drawn in braille, eight dots per cell, the way btop and bottom do it; the level axis is pinned to 0..100, since a utilisation percentage carries its own scale and shrinking the axis would make the same height mean different things from one window to the next; the rate axis has no such ceiling and follows the data. The 5h window gets half the height since it moves fastest. `--graph block` falls back to box characters for fonts whose braille glyphs leave a gap.
- **Keeps a control log.** A fourth panel lists what the tool did on its own, newest first: polls when the result changed, every token refresh, cycle trigger and account switch, with failures in red. Notices disappear after eight seconds, so this is where "why did the account change" gets answered. The last 500 entries persist across restarts, and the cycle trigger reads its own ten-minute cooldown from them.
- **Shows the week ahead.** A third graph mode draws the next seven days one hour per cell, coloured by how much weekly headroom the accounts together will have then. Resets are exact; the stretch between them is projected from the observed burn rate. Today's row is split per account so you can see who is blocked and when it clears. A `!` marks hours where an account will reset with more than 15% left unspent.
- **Leaves gaps where there is no data.** Sampling gaps are drawn as gaps, not as a flat line carried forward from the last reading.
- **Scores every account and shows the working.** Three metrics are normalised and weighted into one number: how far behind the weekly window's own clock the account is, how much of the 5h window is left right now, and how much of the week is left. (An earlier version counted waste and urgency separately; they turned out to be the same quantity, since waste equals the ceiling times the hours left times urgency minus one.) The 판정 tab draws each account's score as a stacked bar with the per-metric contributions, then a table naming what each metric measures next to its weight and every account's raw value for it. Weights move with the arrow keys right there, so the ranking can be tuned while watching it reorder rather than guessed at.
- **Suggests where to go next.** Three lines at the bottom left name the account to use now, the one to run a long job on, and the one to leave alone, each by its list number.
- **Hides accounts you do not use.** `x` drops one from the list, the totals, the recommendation and auto-switching alike. `X` brings them back into view greyed out, still excluded from every judgement. Polling and history carry on, so the graph is unbroken when you unhide it. The account Orca is attached to can be hidden too, which also takes it out of that provider's totals; press `X` if the account count looks short.
- **Switches accounts.** Manually with Enter, or automatically when the account you are on gets close to its limit.

## Requirements

- macOS. Credentials live in the login keychain and are read through `/usr/bin/security`.
- [Orca](https://orca.computer), running, with at least one Claude or Codex account signed in.
- [Bun](https://bun.sh). It runs the JSX directly, so there is no build step.

## Install

It is not published to npm. Bun runs it straight from this repository:

```sh
bunx github:kimjisub/orca-usage
```

Flags go after the package name, the same as anywhere else:
`bunx github:kimjisub/orca-usage --once`.

The first run resolves the dependencies and unpacks the checkout under
`~/.bun/install/cache/`. Later runs start from that cache, in a couple of
seconds. Add `#` and a commit or a tag to hold a version still:

```sh
bunx github:kimjisub/orca-usage#fb9e1d0
```

### From a clone

Clone it instead if you want to read or change the source:

```sh
git clone https://github.com/kimjisub/orca-usage.git
cd orca-usage
bun install
./orca-usage
```

To run that copy from anywhere, link it onto your `PATH`. The launcher resolves
the symlink, so it finds the repository wherever you cloned it:

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

| Key | Action |
| --- | --- |
| `r` | Ask Orca to poll every account again now, cache or no cache |
| `t` | Reissue the selected Claude account's token, if it has been expired for over an hour |
| `a` | Toggle automatic account switching |
| `o` | Toggle opening closed windows ahead of time |
| `w` | Cycle the graph range (3h to 1M) |
| `x` / `X` | Hide the selected account / show hidden ones |
| `Enter` | Point Orca at the selected account |
| `1`-`9` | Jump to an account; `0` jumps to the totals line |
| Left / Right | Move between panels (tabs are clickable too) |
| `q` | Quit; `Ctrl+C` and `Esc` need two presses within three seconds |

Up and down or `j` / `k` move the selection. Clicking a row works too. The four
that do more than move around:

- **`r`** asks Orca to re-poll and copies the result. The usage endpoint allows
  five calls per account per five minutes and this spends one of them, so
  leaning on it backs that account off for a few minutes. It is for when a row
  says "3시간 전 값"; otherwise the poll interval already does this. Every poll
  re-reads the account list as well, so an account added or removed in Orca
  shows up without restarting; new ones are announced and logged.
- **`t`** rewrites the account's access token from its refresh token. Two
  writers rotating one refresh token leave the other revoked, so a live token is
  left to Orca; only a token expired for over an hour counts as one Orca has let
  go of. With `o` on, that happens by itself.
- **`a`** moves Orca to a freer account when the one you are on gets close: its
  tightest window past the switch threshold and somewhere else freer by the
  margin, both set in 설정. It also moves when the target's weekly quota is
  about to reset unspent, when the active account is worth sparing, or when the
  score gap is wide enough. Terminals already open stay on the old account.
- **`o`** sends a one-token request to the cheapest model for any Claude account
  whose 5h or 7d window is closed. Those windows only start counting on the
  first request, so an idle account makes you wait the full five hours or seven
  days from whenever you next touch it; opening them early keeps the resets
  coming. The cost lands below the integer percent the API reports.

On the 설정 and 판정 panels, `Enter` opens an edit mode and only then do left and
right change the value; outside it they move between panels, so a value never
shifts while you are only looking for another tab. `Esc` closes the edit mode,
and `0` restores the selected row's default. The 기록 panel scrolls with up and
down, a page at a time with `PgUp` and `PgDn`.

### Markers

| Marker | Meaning |
| --- | --- |
| `*` | The account Orca is attached to right now, one per provider |
| Red name | Credentials are broken; sign in again. The reason is printed next to the name |
| 리셋 크레딧 | Codex only. Spending one empties the short window straight away |

Which account to be on is not marked on the rows themselves; the recommendation
lines at the bottom left name it, and the 판정 tab shows the score behind that
call.

## Automatic switching

Off by default; `a` turns it on, and it only moves between Claude accounts. When the tightest window on the active account passes 80% and another account is more than 15 percentage points freer, orca-usage asks the Orca runtime to switch. After a switch it waits 10 minutes before switching again.

Terminals that are already open keep running on the old account. The new one applies to sessions you open afterwards.

## Settings

`s` opens a panel for the judgement thresholds: poll interval, the switch trigger and its margin and cooldown, what counts as blocked or worth sparing or worth spending, the cycle cooldown, and how many log entries to keep. Up and down pick a row, left and right move the value, `0` restores that row's default. Changed values are yellow and persist.

Measured facts and courtesies to the server are not in there. That filling a 5h window costs 20 points of the weekly one, the gap between requests, the backoff, the OAuth endpoints: none of those are a matter of preference.

## Cycle auto-trigger

Off by default; `o` turns it on. The 5-hour and 7-day windows only start counting on the first request, so an account you are not using has no reset clock running. When you do switch to it you wait the full five hours or seven days from that moment. With keep-alive on, each poll looks for Claude accounts whose 5h or 7d window is missing or has closed and sends a one-token request to the cheapest model to open it. One request starts both, but they reset on different cycles, so a 7d window can be closed while the 5h one is still running; both are checked. The cost is below the integer percent the usage endpoint reports, so it shows as zero. The same account is not touched twice within ten minutes. A token that has been expired for over an hour is refreshed here, since Orca only refreshes tokens for accounts it is using and leaves idle ones expired.

`t` applies the same rule by hand. A live token is left to Orca, because two writers rotating one refresh token leave the other revoked; only a token expired for over an hour is ours to take, which is what `t` is for when this trigger is off. Codex tokens are Orca's alone.

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
