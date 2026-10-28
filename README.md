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
- Each bar shows what is **left**, not what is used: ten steps, one per 10%, with the percent beside it.
- Next to it is when the window resets, for example `3d9h`.
- If a window drops under 15%, its percent turns into a red badge.

### The prompt cache

After your first reply, the band also tracks the prompt cache. The cache keeps your chat cheap to continue for one hour after your last message.

- **WARM** (red, the robot bobs): the cache is live. It shows the minutes left and what your next message costs.
- **COLD** (blue, the robot is frozen): the hour has passed. Your next message re-sends the whole chat, so it costs more. It shows the price first.

Click **▾** at the right end to open the cache card, and **▴** to fold it. Warm starts folded. Cold starts open, so you see the price before you send.

The card shows how long you've been idle, how many tokens are in the cache, and what the next message costs on each model. Your model is marked **YOU**. See [Up close](#up-close) below.

### Fits any width

The band always stays on one row, with its groups spread evenly across it and a small dot between them. Room left over goes to the bars, up to 180 px each. When there is room it reads `74% left` and the button says **Show**. When the window gets narrower it switches to a compact form (`74%`, a one-character **▾**) and then drops pieces, in this order: the robot, the idle time (the price stays), the reset times, the drawn chip, the bars, then the cache minutes. The percent of each window, the WARM / COLD word and the fold button always stay.

- **Terminal:** the same facts as plain text.

### Agents view (optional)

Off by default. Turn it on with the `agentsView` option in `/config` (Plugins → ribbon), or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "ribbon@robonuggets": { "options": { "agentsView": "on" } } } }
```

A **⇄ Agents** button then sits just before the fold button. It swaps the whole row for a progress bar of the subagents you've launched: how many of the current wave are done, with a crab that walks while any of them is still working. **⇄ Usage** brings the usage row back, and the band remembers your choice for the next session.

In that view, **×N** opens a live panel beside the chat (so does `/agents-info`). Each subagent gets a row: its model, how full its context is, tokens, an estimated cost and how long it has run. Finished ones fold into their own section, and **Collapse** shrinks the panel to a strip of crabs. The panel only opens when you ask for it.

The bar and panel are adapted from [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz (MIT). Only the drawing and the subagent tracking come over. Its plan-reporting tools need the savvy-flow skill, so they're left out.

## Good to know

- **It costs nothing to run.** It reads the app's own numbers and draws them. It never calls a model.
- **Prices are estimates.** They come from a price table in `hooks/cache-art.ts` (`MODELS`), not from your bill. If prices change, edit that table.
- **Subagents don't count.** Only your main chat resets the cache clock.
- **Agent costs are estimates too.** The agents panel prices tokens with its own table (`PRICES` in `hooks/savvy-pane-art.ts`).

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
│   ├── savvy-art.ts        the agents view's progress bar (optional)
│   ├── savvy-pane-art.ts   the agents panel's rows and its price table (optional)
│   └── font.ts             Outfit, embedded so the drawings render anywhere
├── types/index.d.ts        the shape of what the band remembers
├── tests/                  11 tests: layouts, warm and cold, terminal, cleared sessions, agents view
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

Click **▾** and the band opens into the cache card.

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

The optional agents view adapts drawing code from [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress), Copyright (c) 2026 johnnyvizz, also MIT. Its notice is kept at the top of `hooks/savvy-art.ts` and `hooks/savvy-pane-art.ts`.

The embedded font is [Outfit](https://github.com/Outfitio/Outfit-Fonts), under the SIL Open Font License 1.1.

Made by Jay E from RoboLabs. Learn more at [RoboNuggets](https://robonuggets.com).

<p align="center">
  <img src="assets/hex.svg" alt="RoboNuggets hex mark" width="48">
</p>
