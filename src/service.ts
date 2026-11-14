import { FLYER_ENDPOINT, flyerResult, flyerSearchUrl } from './flyer.js';
import {
  asString,
  asStringArray,
  cleanText,
  isDate,
  isTimeZone,
  maskPostal,
  normalizeName,
  normalizePostal,
  optionalText,
  today,
  uniqueStrings,
} from './validate.js';
import type {
  CallScope,
  FetchJson,
  FlyerDeal,
  GroceryItem,
  KeyedStore,
  Meal,
  MealsSetup,
  MealsState,
  WeekSuggestion,
  WeekSuggestionEntry,
} from './types.js';

export const MAX_MEALS = 100;
export const MAX_GROCERY = 100;
export const MAX_SUGGESTION_DAYS = 14;
export const WATCH_ITEMS = 12;
export const WATCH_CONCURRENCY = 4;
export const WATCH_DEALS_PER_ITEM = 5;
export const MAX_COMMIT_ATTEMPTS = 8;
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const SOURCE = 'Flipp public flyer search';

export function emptyState(): MealsState {
  return {
    version: 1,
    setup: { postalCode: null, stores: [], timezone: null, updatedAt: null },
    meals: [],
    grocery: [],
    suggestion: null,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeState(value: unknown): MealsState {
  if (!record(value) || value.version !== 1) return emptyState();
  const setup = record(value.setup) ? value.setup : {};
  const meals = Array.isArray(value.meals)
    ? value.meals.filter(record).flatMap((meal): Meal[] => {
        const day = asString(meal.day);
        const name = asString(meal.meal);
        const dish = asString(meal.dish);
        if (!isDate(day) || !name.trim() || !dish.trim()) return [];
        return [{
          day,
          meal: name,
          dish,
          notes: asString(meal.notes),
          ingredients: asStringArray(meal.ingredients, 30),
          updatedAt: asString(meal.updatedAt),
        }];
      }).slice(0, MAX_MEALS)
    : [];
  const grocery = Array.isArray(value.grocery)
    ? value.grocery.filter(record).flatMap((item): GroceryItem[] => {
        const name = asString(item.name);
        if (!name.trim()) return [];
        return [{
          name,
          quantity: typeof item.quantity === 'string' ? item.quantity : null,
          notes: typeof item.notes === 'string' ? item.notes : null,
          updatedAt: asString(item.updatedAt),
        }];
      }).slice(0, MAX_GROCERY)
    : [];
  const suggestion = record(value.suggestion) && Array.isArray(value.suggestion.days)
    ? {
        days: value.suggestion.days.filter(record).flatMap((entry): WeekSuggestionEntry[] => {
          const day = asString(entry.day);
          const dish = asString(entry.dish);
          if (!isDate(day) || !dish.trim()) return [];
          return [{
            day,
            meal: asString(entry.meal, 'dinner'),
            dish,
            notes: asString(entry.notes),
            ingredients: asStringArray(entry.ingredients, 30),
          }];
        }).slice(0, MAX_SUGGESTION_DAYS),
        summary: typeof value.suggestion.summary === 'string' ? value.suggestion.summary : null,
        createdAt: asString(value.suggestion.createdAt),
      }
    : null;
  return {
    version: 1,
    setup: {
      postalCode: typeof setup.postalCode === 'string' ? setup.postalCode : null,
      stores: asStringArray(setup.stores, 12),
      timezone: typeof setup.timezone === 'string' ? setup.timezone : null,
      updatedAt: typeof setup.updatedAt === 'string' ? setup.updatedAt : null,
    },
    meals,
    grocery,
    suggestion: suggestion && suggestion.days.length ? suggestion : null,
  };
}

function mealRank(meal: string): number {
  const rank = ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(meal.toLocaleLowerCase('en-CA'));
  return rank === -1 ? 4 : rank;
}

function sortMeals(meals: Meal[]): Meal[] {
  return [...meals].sort((a, b) =>
    a.day.localeCompare(b.day) || mealRank(a.meal) - mealRank(b.meal) || a.meal.localeCompare(b.meal),
  );
}

function sortGrocery(items: GroceryItem[]): GroceryItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'en-CA', { sensitivity: 'base' }));
}

function setupSummary(setup: MealsSetup) {
  return {
    postalCodeSet: Boolean(setup.postalCode),
    postalCodeHint: maskPostal(setup.postalCode),
    stores: [...setup.stores],
    storesSet: setup.stores.length > 0,
    timezone: setup.timezone,
    timezoneSet: Boolean(setup.timezone),
    flyerSearchAvailable: Boolean(setup.postalCode),
    note: setup.postalCode
      ? 'Flyer search uses this postal code and the selected stores. It never posts or messages anyone.'
      : 'No postal code is saved. Meals, the grocery list, and week suggestions still work; flyer search needs a postal code.',
  };
}

function entry(input: {
  day: string;
  meal: string;
  dish: string;
  notes?: string;
  ingredients?: string[];
}): WeekSuggestionEntry {
  if (!isDate(input.day)) throw new Error('day must be a real date in YYYY-MM-DD form.');
  return {
    day: input.day,
    meal: cleanText(input.meal, 'meal', 40),
    dish: cleanText(input.dish, 'dish', 160),
    notes: optionalText(input.notes, 1000) ?? '',
    ingredients: uniqueStrings(input.ingredients, 30, 80),
  };
}

function errorMessage(): string {
  return 'Flyer search is unavailable right now. The saved plan and list were not changed.';
}

async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export class MealsService {
  constructor(
    private readonly fetch: FetchJson,
    private readonly store: KeyedStore<MealsState>,
    private readonly now: () => number = Date.now,
    private readonly endpoint: string = FLYER_ENDPOINT,
  ) {}

  private key(scope: CallScope): string {
    return `agent:${scope.agentId}`;
  }

  private async load(scope: CallScope): Promise<MealsState> {
    scope.assertCurrent();
    const observed = await this.store.observe(this.key(scope));
    scope.assertCurrent();
    return normalizeState(observed.value);
  }

  private async mutateState<R>(
    scope: CallScope,
    apply: (state: MealsState) => { changed: boolean; result: R },
  ): Promise<R> {
    scope.assertCurrent();
    const key = this.key(scope);
    let current = await this.store.observe(key);
    scope.assertCurrent();
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const state = normalizeState(current.value);
      const outcome = apply(state);
      scope.assertCurrent();
      if (!outcome.changed) return outcome.result;
      const applied = await this.store.compareAndApply(key, current.comparison, {
        operation: 'update',
        action: 'set',
        value: state,
      });
      scope.assertCurrent();
      if (applied.status !== 'conflict') return outcome.result;
      current = applied.current;
    }
    throw new Error('Could not save meals changes after concurrent updates. Please try again.');
  }

  private async findDeals(item: string, state: MealsState, limit: number, scope: CallScope) {
    const postalCode = state.setup.postalCode;
    if (!postalCode) throw new Error('No postal code is saved.');
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const payload = await this.fetch(flyerSearchUrl(this.endpoint, postalCode, item), {
        signal: scope.signal,
        maxBytes: MAX_FETCH_BYTES,
      });
      scope.assertCurrent();
      return flyerResult(payload, { now: this.now(), stores: state.setup.stores, limit });
    } catch {
      scope.assertCurrent();
      return {
        source: SOURCE,
        checkedAt,
        deals: [] as FlyerDeal[],
        filteredByStores: [...state.setup.stores],
        error: errorMessage(),
      };
    }
  }

  async getMeals(scope: CallScope) {
    const state = await this.load(scope);
    return {
      meals: sortMeals(state.meals),
      pendingWeekSuggestion: state.suggestion,
      note: 'Meals are stored for this agent. A saved week suggestion does not change the plan.',
    };
  }

  async setMeal(input: { day: string; meal: string; dish: string; notes?: string; ingredients?: string[] }, scope: CallScope) {
    const clean = entry({
      day: input.day,
      meal: input.meal,
      dish: input.dish,
      notes: input.notes,
      ingredients: input.ingredients,
    });
    const key = normalizeName(`${clean.day}|${clean.meal}`);
    return this.mutateState(scope, (state) => {
      const index = state.meals.findIndex((meal) => normalizeName(`${meal.day}|${meal.meal}`) === key);
      const saved: Meal = { ...clean, updatedAt: new Date(this.now()).toISOString() };
      if (index === -1) {
        if (state.meals.length >= MAX_MEALS) throw new Error(`The meal plan already has ${MAX_MEALS} meals. Delete one first.`);
        state.meals.push(saved);
      } else {
        state.meals[index] = saved;
      }
      return { changed: true, result: { saved: true, meal: saved, mealCount: state.meals.length } };
    });
  }

  async deleteMeal(input: { day: string; meal: string }, scope: CallScope) {
    if (!isDate(input.day)) throw new Error('day must be a real date in YYYY-MM-DD form.');
    const meal = cleanText(input.meal, 'meal', 40);
    const key = normalizeName(`${input.day}|${meal}`);
    return this.mutateState<{ removed: boolean; note?: string; meal?: Meal; mealCount?: number }>(scope, (state) => {
      const index = state.meals.findIndex((item) => normalizeName(`${item.day}|${item.meal}`) === key);
      if (index === -1) return { changed: false, result: { removed: false, note: 'No saved meal matched that date and meal.' } };
      const [removed] = state.meals.splice(index, 1);
      return { changed: true, result: { removed: true, meal: removed, mealCount: state.meals.length } };
    });
  }

  async getGrocery(scope: CallScope) {
    const state = await this.load(scope);
    return { items: sortGrocery(state.grocery), count: state.grocery.length };
  }

  async addGrocery(input: { name: string; quantity?: string; notes?: string }, scope: CallScope) {
    const name = cleanText(input.name, 'name', 80);
    const quantity = input.quantity === undefined ? undefined : optionalText(input.quantity, 80);
    const notes = input.notes === undefined ? undefined : optionalText(input.notes, 500);
    const key = normalizeName(name);
    return this.mutateState<{ saved: boolean; item: GroceryItem; count: number; replaced?: boolean }>(scope, (state) => {
      const index = state.grocery.findIndex((item) => normalizeName(item.name) === key);
      const updatedAt = new Date(this.now()).toISOString();
      if (index === -1) {
        if (state.grocery.length >= MAX_GROCERY) throw new Error(`The grocery list already has ${MAX_GROCERY} items. Remove one first.`);
        const item: GroceryItem = {
          name,
          quantity: quantity ?? null,
          notes: notes ?? null,
          updatedAt,
        };
        state.grocery.push(item);
        return { changed: true, result: { saved: true, item, count: state.grocery.length } };
      }
      const existing = state.grocery[index]!;
      const item: GroceryItem = {
        name,
        quantity: quantity === undefined ? existing.quantity : quantity,
        notes: notes === undefined ? existing.notes : notes,
        updatedAt,
      };
      state.grocery[index] = item;
      return { changed: true, result: { saved: true, item, count: state.grocery.length, replaced: true } };
    });
  }

  async removeGrocery(input: { name: string }, scope: CallScope) {
    const name = cleanText(input.name, 'name', 80);
    const key = normalizeName(name);
    return this.mutateState<{ removed: boolean; note?: string; item?: GroceryItem; count?: number }>(scope, (state) => {
      const index = state.grocery.findIndex((item) => normalizeName(item.name) === key);
      if (index === -1) return { changed: false, result: { removed: false, note: 'No grocery item matched that name.' } };
      const [removed] = state.grocery.splice(index, 1);
      return { changed: true, result: { removed: true, item: removed, count: state.grocery.length } };
    });
  }

  async saveWeekSuggestion(input: { days: WeekSuggestionEntry[]; summary?: string }, scope: CallScope) {
    if (!Array.isArray(input.days) || input.days.length === 0) throw new Error('A week suggestion needs at least one day.');
    if (input.days.length > MAX_SUGGESTION_DAYS) throw new Error(`A week suggestion is at most ${MAX_SUGGESTION_DAYS} days.`);
    const byKey = new Map<string, WeekSuggestionEntry>();
    for (const raw of input.days) byKey.set(normalizeName(`${raw.day}|${raw.meal}`), entry(raw));
    const days = [...byKey.values()].sort((a, b) =>
      a.day.localeCompare(b.day) || mealRank(a.meal) - mealRank(b.meal),
    );
    const summary = optionalText(input.summary, 1000);
    return this.mutateState(scope, (state) => {
      const suggestion: WeekSuggestion = {
        days,
        summary,
        createdAt: new Date(this.now()).toISOString(),
      };
      const replaced = Boolean(state.suggestion);
      state.suggestion = suggestion;
      return { changed: true, result: { saved: true, suggestion, replacedPrevious: replaced } };
    });
  }

  async getSetup(scope: CallScope) {
    const state = await this.load(scope);
    return setupSummary(state.setup);
  }

  async saveSetup(input: { postalCode?: string | null; stores?: string[]; timezone?: string | null }, scope: CallScope) {
    const postalCode = input.postalCode === undefined
      ? undefined
      : (input.postalCode === null ? null : normalizePostal(input.postalCode));
    const stores = input.stores === undefined ? undefined : uniqueStrings(input.stores, 12, 60);
    let timezone: string | null | undefined;
    if (input.timezone !== undefined) {
      if (input.timezone === null || input.timezone.trim() === '') timezone = null;
      else {
        const zone = input.timezone.trim();
        if (!isTimeZone(zone)) throw new Error('timezone must be an IANA name such as America/Halifax, or null to use the gateway host clock.');
        timezone = zone;
      }
    }
    return this.mutateState(scope, (state) => {
      if (postalCode !== undefined) state.setup.postalCode = postalCode;
      if (stores !== undefined) state.setup.stores = stores;
      if (timezone !== undefined) state.setup.timezone = timezone;
      state.setup.updatedAt = new Date(this.now()).toISOString();
      return { changed: true, result: setupSummary(state.setup) };
    });
  }

  async searchFlyerDeals(input: { item: string; limit?: number }, scope: CallScope) {
    const item = cleanText(input.item, 'item', 80);
    const limit = input.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be between 1 and 20.');
    const state = await this.load(scope);
    if (!state.setup.postalCode) {
      return {
        configured: false,
        item,
        deals: [] as FlyerDeal[],
        note: 'No postal code is saved, so flyer search is off. The meal plan and grocery list still work.',
      };
    }
    const result = await this.findDeals(item, state, limit, scope);
    return { configured: true, item, ...result };
  }

  async checkFlyerWatch(input: { limit?: number }, scope: CallScope) {
    const limit = input.limit ?? WATCH_DEALS_PER_ITEM;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('limit must be between 1 and 10.');
    const state = await this.load(scope);
    const current = today(this.now(), state.setup.timezone);
    const names = [
      ...state.grocery.map((item) => item.name),
      ...state.meals.filter((meal) => meal.day >= current).flatMap((meal) => meal.ingredients),
    ];
    const unique = new Map<string, string>();
    for (const name of names) {
      const key = normalizeName(name);
      if (key && !unique.has(key)) unique.set(key, name);
    }
    const all = [...unique.values()];
    const items = all.slice(0, WATCH_ITEMS);
    if (!state.setup.postalCode) {
      return {
        configured: false,
        checkedAt: new Date(this.now()).toISOString(),
        checked: 0,
        uniqueItemCount: all.length,
        truncated: all.length > WATCH_ITEMS,
        results: [],
        note: 'No postal code is saved, so the flyer watch is off. The meal plan and grocery list still work.',
      };
    }
    if (!items.length) {
      return {
        configured: true,
        checkedAt: new Date(this.now()).toISOString(),
        checked: 0,
        uniqueItemCount: 0,
        truncated: false,
        results: [],
        note: 'There are no grocery items or upcoming meal ingredients to check.',
      };
    }
    const results = await mapLimit(items, WATCH_CONCURRENCY, async (item) => ({
      item,
      ...(await this.findDeals(item, state, limit, scope)),
    }));
    return {
      configured: true,
      checkedAt: new Date(this.now()).toISOString(),
      checked: items.length,
      uniqueItemCount: all.length,
      truncated: all.length > items.length,
      results,
      note: all.length > items.length
        ? `Checked ${items.length} of ${all.length} unique items. The rest are still on the grocery list or on later meals.`
        : 'Flyer matches are current listings, not price guarantees. Confirm the price and dates in the store flyer.',
    };
  }
}
