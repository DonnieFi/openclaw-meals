# Meals hookup contract

Plugin id: `meals-planner`. Package: `openclaw-meals-plugin`, version `0.1.0`. There is no
published ClawHub coordinate yet. Do not invent one.

## Native tools

- `get_meals({})`: saved plan and pending week suggestion.
- `set_meal({ day, meal, dish, notes?, ingredients? })`: save or replace one meal.
- `delete_meal({ day, meal })`: remove one meal.
- `get_grocery_list({})`: saved list.
- `add_grocery_item({ name, quantity?, notes? })`: add or update one item.
- `remove_grocery_item({ name })`: remove one item.
- `search_flyer_deals({ item, limit? })`: one-item flyer search.
- `check_flyer_watch({ limit? })`: on-demand check of the list and upcoming meal
  ingredients, at most 12 unique items.
- `get_meals_setup({})`: postal presence (masked), stores, and availability.
- `save_meals_setup({ postalCode?, stores? })`: save or clear flyer setup.
- `save_week_suggestion({ days, summary? })`: store, but do not apply, a week.

Grant these actual names through ordinary tool policy. A minimal profile needs
explicit allowances. Do not grant unrestricted tools or shell execution to
compensate for missing ones.

## Source integration

Keep one plugin source owner. Build first, then place the eligible distributable
files (`package.json`, `openclaw.plugin.json`, `dist/`, README, LICENSE) in the
template's self-contained `plugins/meals` folder, or use a verified pinned registry
dependency once published. Do not copy `node_modules`, test state, provider
credentials, data caches, or the entire source repository into the Template.

For bundled delivery, `CLAW.md` declares:

    plugins:
      - path: plugins/meals

The template grants the eleven tools plus workspace `read` under a minimal profile.
It does not include `family_members` or `family_schedule` in `alsoAllow`, and it
does not list Family Pack under `requiresPlugins`.

## State and privacy

State is keyed by the host-supplied agent ID in the `meals-state` keyed store. It
contains the plan, list, optional flyer setup, and one pending suggestion. A
different agent does not see them.

The full postal code is never returned by setup tools and is not written to a
workspace file. The public flyer provider receives it as part of a search request.
Errors do not echo the request URL.

## First-run flow

1. Check visible tools. If missing, distinguish disabled/filtered tools from an
   absent plugin; use normal install/consent controls and only real links.
2. Read the saved plan and setup before asking for facts already supplied.
3. Ask once whether flyer search is wanted, then for a postal code and stores.
   Both are optional. There are no defaults.
4. Save only after an answer. Continue without flyers when skipped.
5. Confirm meal changes. A direct grocery add/remove is confirmation for that
   item. A week suggestion is saved only after the person agrees to keep it.
6. Do not post, purchase, run a standing sale watch, or call a recipe API.

## Proof status

The plugin tests and bundled Template preview pass. A live flyer request, Template
Add, model conversation, receiving-host grants, and provider coverage remain
untested. The plugin is development software, not a price-accuracy or availability
promise.
