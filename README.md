# orca-usage

Watches the Claude and Codex accounts managed by [Orca](https://orca.computer): how much of each account's rate limit is left, how fast it is going, and which account to be on. A backend kept alive by launchd polls on a schedule, records history, refreshes tokens Orca has let expire, opens idle windows and switches accounts by policy. The terminal screen shows what the backend is doing and passes your key presses to it; closing the screen stops none of that.

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

## Install on a Mac

You need:

- macOS. Credentials live in the login keychain and are read through `/usr/bin/security`.
- [Orca](https://orca.computer), running, with at least one Claude or Codex account signed in.
- [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`). It runs the JSX directly, so there is no build step.

Then one line:

```sh
bunx github:kimjisub/orca-usage daemon install
```

That installs a copy with `bun add -g` (it is not published to npm, so it comes straight from this repository), registers the backend with launchd so it starts at every login, starts it, and prints its status. The copy lands in `~/.bun/install/global/node_modules/orca-usage` and `orca-usage` goes on your `PATH` through `~/.bun/bin`.

The bunx cache is not registered directly: its folder name carries the commit, so the next update would delete the path launchd points at. That is why the one-liner installs a copy first.

The same in two steps:

```sh
bun add -g github:kimjisub/orca-usage
orca-usage daemon install
```

Check it:

```sh
orca-usage status      # is the backend up, when did it last poll, what is it doing
orca-usage             # the screen
```

The first time the backend reads the keychain, macOS may ask whether `security` may use the Orca items. Choose "Always Allow"; the backend runs without a terminal and cannot answer later prompts.

macOS also announces the new login item as coming from "Jarred Sumner". That is the developer certificate bun is signed with (he created Bun), and bun is what the launchd agent runs; it is this backend, not a third party. It is listed under System Settings > General > Login Items & Extensions, where turning it off keeps the backend from starting at login.

### From a clone

To read or change the source:

```sh
git clone https://github.com/kimjisub/orca-usage.git
cd orca-usage
bun install
bun run src/cli.jsx daemon install
```

launchd then points at the clone, and `orca-usage update` becomes `git pull --ff-only` plus `bun install`. To call the clone as `orca-usage`, link its launcher onto your `PATH`; it follows the symlink back to the repository:

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/orca-usage" ~/.local/bin/orca-usage
```

`~/.local/bin` is not on the default macOS `PATH`; add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc if it is missing.

### Opening the screen first

Running `orca-usage` (or `bunx github:kimjisub/orca-usage`) before installing asks first:

```
백엔드가 launchd 에 등록돼 있지 않습니다.
조회와 재인증, 계정 전환은 백엔드가 하고, 화면은 그것을 보여 주기만 합니다.
지금 설치하고 등록할까요? [Y/n]
```

Enter or `y` installs and registers exactly as `daemon install` would, then opens the screen; from bunx the screen opens from the freshly installed copy, so it runs the same version as the backend. `n` leaves and changes nothing. With no terminal to ask (a pipe, a script), it prints how to install and exits with code 3.

The screen never starts a backend of its own. One started that way would look fine until the next reboot, when polling and switching would quietly stop.

## Update

```sh
orca-usage update
```

Or press `u` in the screen, then `u` again within three seconds.

The backend checks on start and every six hours, and the screen's header shows `업데이트 있음 (u)` when there is something to fetch. Updating is the backend's job either way: it fetches the new code, then comes back on it. Under launchd it exits with code 75 and launchd starts it again. The screen reconnects to the new backend and then restarts itself, so the two never run different versions for long. `orca-usage update` prints the move, for example `f59de91 -> 8047102`.

How it fetches depends on how it was installed:

| Installed with | Checks against | Fetches with |
| --- | --- | --- |
| `bun add -g` (the one-liner) | the latest commit on GitHub | `bun add -g github:kimjisub/orca-usage` |
| a clone | its upstream branch, after `git fetch` | `git pull --ff-only`, `bun install` |
| bunx, no install | nothing; bunx fetches on its own | nothing |

A clone only counts as behind when its HEAD is an ancestor of upstream. A working copy with commits not yet pushed is left alone, and `status` says how many there are.

## Uninstall

```sh
orca-usage daemon uninstall     # stop the backend and remove the launchd agent
bun remove -g orca-usage        # remove the installed copy
```

History, the control log and settings stay in `~/.cache/orca-usage`, and the backend log in `~/Library/Logs/orca-usage`. Delete those two folders to remove everything.

## Commands

```
orca-usage                     the screen. Offers to install the backend if it is not registered
orca-usage status [--json]     backend status. Exits 3 when the backend is down
orca-usage accounts [--json]   each account's usage, printed once (--once and --json do the same)
orca-usage update              fetch the latest and restart the backend on it
orca-usage daemon install      register with launchd and start
orca-usage daemon uninstall    stop and remove the registration
orca-usage daemon restart      start again, on whatever code is installed
orca-usage daemon stop         stop. The registration stays, so it starts at next login
orca-usage daemon logs [-f]    the backend's log
orca-usage daemon run          run the backend in this terminal (what launchd calls)
orca-usage -v, --version       this code's version, and the backend's if it is running
orca-usage --graph block       draw level lines with box characters instead of braille
```

`accounts` prints what the backend has rather than polling on its own, since a second poller would split the usage budget with it. Like the screen, it offers to install when the backend is not registered, and waits for the first poll of a backend that has just started.

## How it is put together

**The backend owns every piece of state.** Accounts, usage, history, the control log, policy (auto switch, cycle trigger, notifications, thresholds, hidden accounts) and the last switch time are written by the backend alone. It serves them on a Unix socket, `~/.cache/orca-usage/daemon.sock`, one JSON object per line, the same framing Orca's runtime uses.

**The screen does nothing on its own.** It does not call Orca, read the keychain, write files or switch accounts. It draws the backend's state and sends what the keys ask for; a refusal comes back with the backend's reason and is shown as is. The recommendation, the scores and the switch decision are the backend's, so the screen cannot give a different reason from the one acted on. The only state the screen keeps is how you are looking at things (tab, range, selection, scroll), in memory, so it opens on the defaults each time.

**One backend at a time.** Two pollers would share the five-calls-per-five-minutes budget and put the active account into 429 first. The backend takes `~/.cache/orca-usage/daemon.pid` exclusively before opening the socket; a second one logs `이미 떠 있습니다` and exits 0.

**launchd keeps it up.** The agent is `~/Library/LaunchAgents/com.kimjisub.orca-usage.plist`. It names bun and `src/cli.jsx` by absolute path, since launchd's `PATH` has neither. `KeepAlive` restarts only on a non-zero exit, so `daemon stop` and a backend stepping aside (both exit 0) stay down, a crash comes back within ten seconds, and an update exits 75 to come back on the new code. `daemon install` shuts down a backend started by hand first; while that one held the pid, the launchd one would keep stepping aside.

**Started by hand.** `orca-usage daemon run` in a terminal runs a backend in the foreground, for working on the code. The screen and the commands attach to it like any other (the header says `직접 띄운 백엔드`), but nothing restarts it: it goes when the terminal does, `daemon restart` leaves it alone, and after an update it exits and has to be run again.

**Notifications.** The backend posts a macOS notification when it switches accounts on its own (the new account applies to sessions opened afterwards) and when an account needs signing in again (waiting will not fix it), once per account until it recovers. The 알림 row in the settings panel turns them off.

## What it does

- **Reads every account at once.** Orca keeps each Claude login in its own credential slot; this walks all of them instead of only the one you are attached to. The account list is read again on every poll, so an account added or removed in Orca shows up without restarting; new ones are logged.
- **Covers both providers.** Claude and Codex accounts are listed in separate sections, because they do not share a window layout: Claude reports a 5-hour, a 7-day and per-model window, Codex reports a weekly one plus rate-limit reset credits. Both carry their plan next to the name: Claude's tier comes from its account metadata, Codex's from the `chatgpt_plan_type` claim in the OAuth token Orca stores per account, since Orca's own account list leaves that field empty for accounts signed in some time ago. A Codex login Orca does not manage (the system default in `~/.codex/auth.json`, used when no managed Codex account is chosen) gets a row of its own tagged `시스템 기본`, unless the same person is also a managed account; switching back to it is left to the Orca app.
- **Totals each provider on its own.** Every section opens with a bar for that provider as a whole: the same-named windows averaged over its accounts, with `1.3/2` reading as "1.3 accounts' worth of a 2-account pool spent". Claude and Codex are never added together, since a `7d` window means a different quota on each and one average over both would be wrong in its denominator. Selecting a totals line draws that provider's combined history in the graph.
- **Shows the details behind each bar.** The 상세 tab says, for the selected account, when its numbers were fetched and from where, when each window resets, whether it is backed off, how long its OAuth token has left (or how long ago it expired), whose turn it is to refresh it and when the backend last did, how many samples it has, and its recent log entries. With a totals line selected it lists every account's data age and token expiry side by side. Everything there comes from the backend; `orca-usage accounts --json` carries the same `token` field.
- **Plots history.** Usage level over time, or consumption rate in percentage points per hour. Ranges from 3 hours to a month. Level lines are drawn in braille, eight dots per cell, the way btop and bottom do it; the level axis is pinned to 0..100, since a utilisation percentage carries its own scale and shrinking the axis would make the same height mean different things from one window to the next; the rate axis has no such ceiling and follows the data. The 5h window gets half the height since it moves fastest. `--graph block` falls back to box characters for fonts whose braille glyphs leave a gap.
- **Leaves gaps where there is no data.** Sampling gaps are drawn as gaps, not as a flat line carried forward from the last reading.
- **Keeps a control log.** The 기록 tab lists what the backend did on its own, newest first: polls when the result changed, every token refresh, window opening and account switch, with failures in red. Screen notices disappear after eight seconds, so this is where "why did the account change" gets answered. The last 500 entries persist, and the cycle trigger reads its ten-minute cooldown from them.
- **Shows the week ahead.** The 일정 tab draws the next seven days one hour per cell, coloured by how much weekly headroom the accounts together will have then. Resets are exact; the stretch between them is projected from the observed burn rate. Today's row is split per account so you can see who is blocked and when it clears. A `!` marks hours where an account will reset with more than 15% left unspent.
- **Scores every account and shows the working.** Three metrics are normalised and weighted into one number: how far behind the weekly window's own clock the account is, how much of the 5h window is left right now, and how much of the week is left. The 판정 tab draws each account's score as a stacked bar with the per-metric contributions, then a table naming what each metric measures next to its weight and every account's raw value for it. Weights can be changed right there, so the ranking can be tuned while watching it reorder.
- **Suggests where to go next.** Three lines at the bottom left name the account to use now, the one to run a long job on, and the one to leave alone, each by its list number.
- **Hides accounts you do not use.** `x` drops one from the list, the totals, the recommendation and auto-switching alike. `X` brings them back into view greyed out, still excluded from every judgement. Polling and history carry on, so the graph is unbroken when you unhide it. The account Orca is attached to can be hidden too, which also takes it out of that provider's totals; press `X` if the account count looks short.
- **Switches accounts.** Manually with Enter, or automatically when the account you are on gets close to its limit.

## Keys

| Key | Action |
| --- | --- |
| `r` | Ask Orca to poll every account again now, cache or no cache |
| `t` | Reissue the selected Claude account's token, if it has been expired for over an hour |
| `a` | Toggle automatic account switching |
| `o` | Toggle opening closed windows ahead of time |
| `u` | Check for an update; press again within three seconds to apply it |
| `w` | Cycle the graph range (3h to 1M) |
| `x` / `X` | Hide the selected account / show hidden ones |
| `Enter` | Point Orca at the selected account |
| `1`-`9` | Jump to an account; `0` jumps to the totals line |
| Left / Right | Move between panels (tabs are clickable too) |
| `q` | Quit the screen; `Ctrl+C` and `Esc` need two presses within three seconds. The backend keeps running |

Up and down or `j` / `k` move the selection. Clicking a row works too. The ones that do more than move around:

- **`r`** asks the backend to poll now; it asks Orca to re-poll and copies the result. The usage endpoint allows five calls per account per five minutes and this spends one of them, so leaning on it backs that account off for a few minutes. It is for when a row says "3시간 전 값"; otherwise the poll interval already does this. Presses that arrive while a poll is running are folded into one poll after it.
- **`t`** rewrites the account's access token from its refresh token, now rather than at the next poll. Two writers rotating one refresh token leave the other revoked, so a live token is left to Orca; only a token expired for over an hour counts as one Orca has let go of. The backend already refreshes those on every poll, so `t` is rarely needed. Codex tokens are Orca's alone.
- **`a`** moves Orca to a freer account when the one you are on gets close: its tightest window past the switch threshold and somewhere else freer by the margin, both set in 설정. It also moves when the target's weekly quota is about to reset unspent, when the active account is worth sparing, or when the score gap is wide enough. Terminals already open stay on the old account.
- **`o`** sends a one-token request to the cheapest model for any Claude account whose 5h or 7d window is closed. Those windows only start counting on the first request, so an idle account makes you wait the full five hours or seven days from whenever you next touch it; opening them early keeps the resets coming. The cost lands below the integer percent the API reports.

On the 설정 and 판정 panels, `Enter` opens an edit mode and only then do left and right change the value; outside it they move between panels, so a value never shifts while you are only looking for another tab. `Esc` closes the edit mode, and `0` restores the selected row's default. The 기록 and 도움말 panels scroll with up and down, a page at a time with `PgUp` and `PgDn`.

### Markers

| Marker | Meaning |
| --- | --- |
| `*` | The account Orca is attached to right now, one per provider |
| `[Max 20x]`, `[Pro]` | The account's plan |
| `[..., 시스템 기본]` | A Codex login Orca does not manage: the system default in `~/.codex/auth.json` |
| Red name | Credentials are broken; sign in again in Orca. The reason is printed next to the name |
| 리셋 크레딧 | Codex only. Spending one empties the short window straight away |

Which account to be on is not marked on the rows themselves; the recommendation lines at the bottom left name it, and the 판정 tab shows the score behind that call.

## Policy

### Token refresh

Always on. Orca refreshes tokens only for the accounts it is using, so idle ones sit expired; once a Claude token has been expired for an hour, the backend treats it as abandoned and refreshes it. It reads every Claude token's expiry from the keychain on each poll, since Orca refreshes the active account before it expires and a remembered value goes stale within hours; the 상세 tab shows when it was read. After a failed refresh it backs off for 30 minutes. A live token is Orca's to rotate, since two writers rotating one refresh token leave the other revoked.

### Automatic switching

Off by default; `a` turns it on, and it only moves between Claude accounts. When the tightest window on the active account passes 80% and another account is more than 15 percentage points freer, the backend asks the Orca runtime to switch. Hidden accounts are never a target. After a switch, manual or automatic, it waits 10 minutes before switching again; that time survives restarts.

### Opening windows ahead of time

Off by default; `o` turns it on. One request starts both the 5h and 7d windows, but they reset on different cycles, so a 7d window can be closed while the 5h one is still running; both are checked. The same account is not touched twice within ten minutes.

### Thresholds

The 설정 panel holds the judgement thresholds: poll interval, the switch trigger and its margin and cooldown, what counts as blocked or worth sparing or worth spending, the cycle cooldown, how many log entries to keep, and notifications. Changed values are yellow and persist in the backend. A value outside its range is refused with the range.

Measured facts and courtesies to the server are not in there. That filling a 5h window costs 20 points of the weekly one, the gap between requests, the backoff, the OAuth endpoints: none of those are a matter of preference.

## How usage is read

Usage comes from Orca first. The runtime already polls every account it manages, Claude and Codex alike, and hands the numbers back in one call over its local Unix socket. The backend asks for a refresh on each poll and copies the result. It does not touch a credential on this path.

The reason is the rate limit on the usage endpoint itself: five calls per account per five minutes. Orca reaches it with the same keychain credential this tool would use, so two pollers share one budget and the active account, which Orca refreshes most often, is the one that runs out and gets backed off.

When Orca fails to poll an account it still hands back the windows it last received. Those are shown, marked with the reason (`Orca 에서 재로그인` for a revoked token), but not recorded in history, since nobody observed them at that time.

If Orca is not running, the backend falls back to reading the OAuth credentials under `~/Library/Application Support/orca/claude-accounts/` from the login keychain, refreshing an access token about to expire, and calling the usage endpoint directly. The header says so while that is the case. Codex has no fallback; its last known values stay on screen.

The account Orca is attached to comes from the Orca runtime, not from `~/.claude.json`. That file records where Claude Code last logged in, which drifts from Orca's choice as soon as you switch accounts in the app.

## Troubleshooting

- **`status` says the backend is down but launchd has it registered.** `orca-usage daemon logs` shows why it exited. A crash is restarted within ten seconds, so a backend that stays down usually fails at start: bun moved (run `daemon install` again to rewrite the paths) or the install folder was removed.
- **The header says `Orca 연결 안 됨, 직접 조회`.** Orca is not running or its runtime did not answer. Claude accounts are polled directly meanwhile; Codex values stay as last seen.
- **An account's name is red.** Its credentials are revoked or missing. Sign in to that account again in Orca; the backend notices on the next poll.
- **The header shows `백엔드 <version>` in yellow.** The screen (its version is at the top left) and the backend run different code, usually after updating by hand. `orca-usage daemon restart`, then reopen the screen. `orca-usage -v` prints both.
- **A keychain prompt keeps coming back.** Choose "Always Allow" for `security`. Under launchd there is no one to answer it.
- **Two backends seem to be polling.** They cannot: the second exits at start. An old screen from before the backend existed still polls on its own, though; close it. So does a screen from 1.1.0 (1b47161) left open: that version still started a backend itself when it lost one.

## Tests

```sh
bun test
```

The Engine is tested with fake Orca, keychain, store and notifier, so policy can be checked without real accounts. The socket server, the single-instance rule and the launchd plist have their own tests.

## Notes

- Credentials are read from and written back to the keychain only. Network traffic goes to Anthropic's endpoints, and the update check asks `api.github.com` for the latest commit of this repository.
- Source comments are in Korean.

## License

MIT
