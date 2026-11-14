import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MealsService, WATCH_ITEMS } from '../dist/service.js';
import { parseFlyerDeals } from '../dist/flyer.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const fixture = JSON.parse(await readFile(new URL('./fixtures/flipp-search.json', import.meta.url), 'utf8'));

async function searchFixture(url) {
  const query = new URL(url).searchParams.get('q')?.toLocaleLowerCase('en-CA') ?? '';
  return {
    items: fixture.items.filter((item) =>
      typeof item.name === 'string' && item.name.toLocaleLowerCase('en-CA').includes(query),
    ),
  };
}

function store(initial = new Map()) {
  const values = initial;
  return {
    values,
    async lookup(key) {
      return values.get(key);
    },
    async register(key, value, opts) {
      opts?.assertCurrent?.();
      values.set(key, structuredClone(value));
    },
  };
}

function service(fetch = searchFixture, storeValue = store(), now = () => NOW) {
  return { service: new MealsService(fetch, storeValue, now), store: storeValue, fetch };
}

function scope(agentId = 'alice') {
  return { agentId, assertCurrent() {} };
}

test('meal writes are agent-scoped, replace by date and meal name, and delete cleanly', async () => {
  const { service: meals } = service();
  await meals.setMeal({ day: '2026-11-16', meal: 'dinner', dish: 'Pasta', notes: 'Use the open sauce' }, scope('alice'));
  await meals.setMeal({ day: '2026-11-15', meal: 'Dinner', dish: 'Soup', ingredients: [' carrots ', 'Carrots', 'stock'] }, scope('alice'));
  await meals.setMeal({ day: '2026-11-15', meal: 'dinner', dish: 'Chili' }, scope('alice'));
  const alice = await meals.getMeals(scope('alice'));
  assert.equal(alice.meals.length, 2);
  assert.deepEqual(alice.meals.map((meal) => [meal.day, meal.meal, meal.dish]), [
    ['2026-11-15', 'dinner', 'Chili'],
    ['2026-11-16', 'dinner', 'Pasta'],
  ]);
  assert.deepEqual(alice.meals[0].ingredients, []);
  const bob = await meals.getMeals(scope('bob'));
  assert.deepEqual(bob.meals, []);
  const removed = await meals.deleteMeal({ day: '2026-11-15', meal: 'DINNER' }, scope('alice'));
  assert.equal(removed.removed, true);
  assert.equal((await meals.deleteMeal({ day: '2026-11-15', meal: 'dinner' }, scope('alice'))).removed, false);
});

test('meal input keeps ingredients when supplied and rejects impossible dates', async () => {
  const { service: meals } = service();
  const saved = await meals.setMeal({
    day: '2026-11-16',
    meal: 'dinner',
    dish: 'Stir fry',
    ingredients: ['chicken', 'peppers', 'rice'],
  }, scope());
  assert.deepEqual(saved.meal.ingredients, ['chicken', 'peppers', 'rice']);
  await assert.rejects(meals.setMeal({ day: '2026-02-30', meal: 'dinner', dish: 'Pasta' }, scope()), /day must be a real date/);
  await assert.rejects(meals.setMeal({ day: '2026-11-16', meal: ' ', dish: 'Pasta' }, scope()), /meal is required/);
});

test('grocery list upserts by name, preserves omitted fields, and removes case-insensitively', async () => {
  const { service: meals } = service();
  await meals.addGrocery({ name: 'Milk', quantity: '2 L' }, scope());
  await meals.addGrocery({ name: 'milk', notes: 'Oat is fine too' }, scope());
  await meals.addGrocery({ name: 'Bread' }, scope());
  const list = await meals.getGrocery(scope());
  assert.equal(list.count, 2);
  assert.deepEqual(list.items.map((item) => item.name), ['Bread', 'milk']);
  const milk = list.items.find((item) => item.name === 'milk');
  assert.equal(milk.quantity, '2 L');
  assert.equal(milk.notes, 'Oat is fine too');
  const removed = await meals.removeGrocery({ name: 'MILK' }, scope());
  assert.equal(removed.removed, true);
  assert.equal((await meals.getGrocery(scope())).count, 1);
  await assert.rejects(meals.addGrocery({ name: '   ' }, scope()), /name is required/);
});

test('setup reports presence, masks the postal code, dedupes stores, and can clear fields', async () => {
  const { service: meals } = service();
  const saved = await meals.saveSetup({
    postalCode: 'x0x 0x0',
    stores: ['Example Grocer', ' example grocer ', 'Other Mart'],
  }, scope());
  assert.equal(saved.postalCodeSet, true);
  assert.equal(saved.postalCodeHint, 'X0X***');
  assert.deepEqual(saved.stores, ['Example Grocer', 'Other Mart']);
  assert.equal(saved.flyerSearchAvailable, true);
  const serialized = JSON.stringify(saved);
  assert.equal(serialized.includes('X0X 0X0'), false);
  assert.equal(serialized.includes('X0X0X0'), false);
  const kept = await meals.saveSetup({ stores: [] }, scope());
  assert.equal(kept.postalCodeSet, true);
  assert.deepEqual(kept.stores, []);
  const cleared = await meals.saveSetup({ postalCode: null }, scope());
  assert.equal(cleared.postalCodeSet, false);
  assert.equal(cleared.postalCodeHint, null);
  assert.equal(cleared.flyerSearchAvailable, false);
  await assert.rejects(meals.saveSetup({ postalCode: '!' }, scope()), /Postal code should be/);
});

test('flyer search maps deals, removes expired and future items, and filters by store', async () => {
  const payload = fixture;
  const deals = parseFlyerDeals(payload, { now: NOW, stores: [], limit: 10 });
  assert.deepEqual(deals.map((deal) => [deal.name, deal.merchant, deal.price]), [
    ['Milk', 'Example Grocer', 3.49],
    ['Milk', 'Other Mart', 4.99],
    ['Bread', 'Example Grocer', 2.5],
  ]);
  assert.deepEqual(parseFlyerDeals(payload, { now: NOW, stores: ['other mart'], limit: 10 }).map((deal) => deal.merchant), ['Other Mart']);
  assert.equal(parseFlyerDeals(payload, { now: NOW, stores: [], limit: 2 }).length, 2);

  const { service: meals } = service();
  assert.equal((await meals.searchFlyerDeals({ item: 'milk' }, scope())).configured, false);
  await meals.saveSetup({ postalCode: 'X0X 0X0' }, scope());
  const result = await meals.searchFlyerDeals({ item: 'milk', limit: 2 }, scope());
  assert.equal(result.configured, true);
  assert.equal(result.deals.length, 2);
  assert.equal(result.filteredByStores.length, 0);
});

test('a flyer failure stays useful and never echoes the postal code or request URL', async () => {
  const calls = [];
  const { service: meals } = service(async (url) => {
    calls.push(url);
    throw new Error(`network failed for ${url}`);
  });
  await meals.saveSetup({ postalCode: 'X0X 0X0' }, scope());
  const result = await meals.searchFlyerDeals({ item: 'milk' }, scope());
  assert.equal(result.configured, true);
  assert.equal(result.deals.length, 0);
  assert.match(result.error, /unavailable/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('X0X'), false);
  assert.equal(serialized.includes('backflipp'), false);
  assert.equal(calls.length, 1);
});

test('watch uses the grocery list and upcoming meal ingredients, dedupes, and skips past meals', async () => {
  const { service: meals } = service(searchFixture);
  await meals.saveSetup({ postalCode: 'X0X 0X0' }, scope());
  await meals.addGrocery({ name: 'Milk' }, scope());
  await meals.setMeal({ day: '2026-11-15', meal: 'dinner', dish: 'Bread pudding', ingredients: ['Bread', 'MILK'] }, scope());
  await meals.setMeal({ day: '2026-11-13', meal: 'dinner', dish: 'Old soup', ingredients: ['Ghost item'] }, scope());
  const watch = await meals.checkFlyerWatch({ limit: 3 }, scope());
  assert.equal(watch.configured, true);
  assert.equal(watch.checked, 2);
  assert.equal(watch.uniqueItemCount, 2);
  assert.deepEqual(watch.results.map((result) => result.item), ['Milk', 'Bread']);
  assert.equal(watch.results[0].deals.length, 2);
});

test('watch reports the 12-item bound and missing setup without fetching', async () => {
  let calls = 0;
  const { service: meals } = service(async () => { calls += 1; return fixture; });
  const noSetup = await meals.checkFlyerWatch({}, scope());
  assert.equal(noSetup.configured, false);
  assert.equal(calls, 0);
  await meals.saveSetup({ postalCode: 'X0X 0X0' }, scope());
  for (let index = 0; index < WATCH_ITEMS + 3; index += 1) {
    await meals.addGrocery({ name: `Item ${index}` }, scope());
  }
  const watch = await meals.checkFlyerWatch({ limit: 1 }, scope());
  assert.equal(watch.checked, WATCH_ITEMS);
  assert.equal(watch.uniqueItemCount, WATCH_ITEMS + 3);
  assert.equal(watch.truncated, true);
  assert.match(watch.note, /Checked 12 of 15/);
});

test('a saved week suggestion is returned by get_meals but does not change the plan', async () => {
  const { service: meals } = service();
  const first = await meals.saveWeekSuggestion({
    days: [
      { day: '2026-11-17', meal: 'dinner', dish: 'Tacos', ingredients: ['shells'] },
      { day: '2026-11-16', meal: 'dinner', dish: 'Soup' },
      { day: '2026-11-16', meal: 'dinner', dish: 'Chili' },
    ],
    summary: 'Uses what is already on the list.',
  }, scope());
  assert.equal(first.replacedPrevious, false);
  assert.deepEqual(first.suggestion.days.map((day) => day.dish), ['Chili', 'Tacos']);
  const read = await meals.getMeals(scope());
  assert.equal(read.meals.length, 0);
  assert.equal(read.pendingWeekSuggestion.summary, 'Uses what is already on the list.');
  const second = await meals.saveWeekSuggestion({ days: [{ day: '2026-11-18', meal: 'dinner', dish: 'Pizza' }] }, scope());
  assert.equal(second.replacedPrevious, true);
  assert.equal((await meals.getMeals(scope())).pendingWeekSuggestion.days[0].dish, 'Pizza');
  await assert.rejects(meals.saveWeekSuggestion({ days: [] }, scope()), /at least one day/);
});

test('a revoked invocation stops before a write is registered', async () => {
  const { service: meals, store: backing } = service();
  await assert.rejects(
    meals.setMeal({ day: '2026-11-16', meal: 'dinner', dish: 'Pasta' }, {
      agentId: 'alice',
      assertCurrent() { throw new Error('revoked'); },
    }),
    /revoked/,
  );
  assert.equal(backing.values.size, 0);
});

test('corrupt stored state is ignored instead of breaking the next read', async () => {
  const backing = store(new Map([['agent:alice', { version: 99, meals: 'nope' }]]));
  const { service: meals } = service(async () => fixture, backing);
  assert.deepEqual((await meals.getMeals(scope())).meals, []);
  assert.equal((await meals.getSetup(scope())).postalCodeSet, false);
});
