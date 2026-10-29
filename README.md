<p align="center">
  <img src="assets/banner.png" alt="ribbon" width="100%">
</p>

# ribbon

A free mod for Claude Code. It adds a slim band above your prompt that shows:

- **How much usage you have left** in your 7-day and 5-hour windows, and when each one resets.
- **Whether your prompt cache is warm or cold**, and what your next message will cost.

It installs once and is there in every session after that. No commands to learn.

<p align="center">
  <img src="assets/slim-warm.png" alt="ribbon, one slim row: 7D 41% left, 5H 96% left, cache warm with 53 minutes left" width="100%">
</p>

<p align="center">
  <img src="assets/slim-cold.png" alt="ribbon, one slim row: 7D 45% left, 5H 89% left, cache cold for 12h 45m, next message $4.78" width="100%">
</p>

One row. That's the whole footprint.

## Install

The easy way: send this link to your agent and say "install this".

```
https://github.com/robonuggets/ribbon
```

Your agent runs one command. The band shows up in your next session.

### For agents

If you are an agent and your user asked you to install this, run this in a shell:

```
claude plugin install ribbon --marketplace robonuggets/ribbon
```

It installs for the user (all their projects) and adds the marketplace on its own. Then tell your user: "Ribbon is installed. Start a new session to see the band above your prompt." Do not edit their settings file by hand.

### By hand

In a Claude Code terminal session, type:

```
/plugin install ribbon --marketplace robonuggets/ribbon
```

1. Type `y` when it asks `Add marketplace?`.
2. Pick the **user** scope with Enter.
3. Start a new session.

## What you see

### Usage left

- **7D** (orange) is your 7-day window. **5H** (yellow) is your 5-hour window.
- Each dot bar shows what is **left**, not what is used.
- Under each one is when it resets, for example `resets 3d 9h`.
- If a window drops under 15%, a bold **LOW** shows next to it.

### The prompt cache

After your first reply, the band also tracks the prompt cache. The cache keeps your chat cheap to continue for one hour after your last message.

- **WARM** (red, the robot bobs): the cache is live. It shows the minutes left and what your next message costs.
- **COLD** (blue, the robot is frozen): the hour has passed. Your next message re-sends the whole chat, so it costs more. It shows the price first.

Click **Show** to open the cache card, and **Hide** to fold it. Warm starts folded. Cold starts open, so you see the price before you send.

The card shows how long you've been idle, how many tokens are in the cache, and what the next message costs on each model. Your model is marked **YOU**. See [Up close](#up-close) below.

### Fits any width

- **Wide:** everything on one row.
- **Half width:** each window stacks into a small block.
- **Narrow:** the cache moves to its own row.
- **Terminal:** the same facts as plain text.

## Settings

Open `/config` and find **ribbon**, or run `claude plugin configure ribbon@robonuggets`.

- **Usage figure** (`usage`): `left` (default) shows how much of each window is left. `used` shows how much is spent, the way Claude Code's own rate-limit figures count it; the dot bar then fills with what is used. **LOW** still shows when less than 15% is left.
- **First window** (`first`): `7d` (default) or `5h`. Which window the band shows first.
- **USAGE label** (`label`): `shown` (default) or `hidden`. Hidden drops the word USAGE and leaves just the windows.
- **Window colours** (`colors`): `fixed` (default) draws 7D orange and 5H yellow. `level` colours each window by the share used, like a traffic-light status line: green under 50%, yellow from 50%, red from 80%.
- **Dots** (`dots`): `mixed` (default) draws the used cells as large dots and the rest as small ones. `even` draws all ten as the same small bullet, `solid` as the same large dot; the unused ones are grey.
- **Context** (`context`): `hidden` (default) or `shown`. Shown adds a CTX bar first: the share of the context window in use, drawn like the usage windows.
- **Words** (`words`): `shown` (default) or `hidden`. Hidden writes just `42%` and `4h 0m`, without `left`/`used` and `resets`, which leaves more room on one row.
- **Dots per bar** (`cells`): `10` (default), one per 10%, or `5`, one per 20%, for a shorter row.
- **Layout** (`align`): `packed` (default) keeps the blocks together at the left, with Show at the right. `spread` spaces the blocks evenly so the band fills its width.
- **Vertical alignment** (`valign`): `top` (default), `center` or `bottom`: where blocks of different heights (the stacked windows, the cache, Show) sit on the row.
- **Theme** (`theme`): `fixed` (default) draws the band on its own warm dark card. `app` drops the card and takes your Claude Code theme's colours (text, subtle, claude, warning, and success / warning / error for level colours), so the band reads on a light theme too. The cache card's drawing has no background then and follows the light or dark colour scheme.
- **Text size** (`textSize`): `caption` (default), `footnote` or `body`. Desktop, VS Code and mobile only; the terminal has one size. Larger sizes stack the band at a wider width so nothing clips.

## Good to know

- **It costs nothing to run.** It reads the app's own numbers and draws them. It never calls a model.
- **Prices are estimates.** They come from a price table in `hooks/cache-art.ts` (`MODELS`), not from your bill. If prices change, edit that table.
- **Subagents don't count.** Only your main chat resets the cache clock.

## What is inside

```
ribbon/
├── .claude-plugin/
│   ├── plugin.json         the mod's name and version
│   └── marketplace.json    makes this repo installable
├── hooks/
│   ├── hooks.json          points to the module
│   ├── register.tsx        the band: usage, cache tracking, layout
│   ├── cache-art.ts        the cache card and robot drawings, the price table
│   └── font.ts             Outfit, embedded so the drawings render anywhere
├── types/index.d.ts        the shape of what the band remembers
├── tests/                  7 tests: layouts, warm and cold, terminal, cleared sessions
└── assets/                 banner, screenshots, hex icon
```

## Remove it

```
claude plugin uninstall ribbon
```

## Develop it

Load the folder without installing it:

```
claude --plugin-dir ./ribbon
```

Run the tests:

```
claude plugin test ./ribbon
```

## Up close

Click **Show** and the band opens into the cache card.

**Warm.** The cache is live. Your next message is cheap.

<p align="center">
  <img src="assets/detail-warm.png" alt="Warm cache card: 6m idle, 245k tokens in cache, next message $0.05 on Opus" width="100%">
</p>

**Cold.** The hour has passed. Your next message re-sends the whole chat, so it costs more.

<p align="center">
  <img src="assets/detail-cold.png" alt="Cold cache card: 16h 8m idle, 243k tokens to re-cache, next message $1.94 on Opus" width="100%">
</p>

## License

[MIT](LICENSE).

The embedded font is [Outfit](https://github.com/Outfitio/Outfit-Fonts), under the SIL Open Font License 1.1.

Made by Jay E from RoboLabs. Learn more at [RoboNuggets](https://robonuggets.com).

<p align="center">
  <img src="assets/hex.svg" alt="RoboNuggets hex mark" width="48">
</p>
