/** One saved meal. `day` is a calendar date in YYYY-MM-DD form, not a weekday. */
export type Meal = {
  day: string;
  meal: string;
  dish: string;
  notes: string;
  ingredients: string[];
  updatedAt: string;
};

export type GroceryItem = {
  name: string;
  quantity: string | null;
  notes: string | null;
  updatedAt: string;
};

export type MealsSetup = {
  postalCode: string | null;
  stores: string[];
  timezone: string | null;
  updatedAt: string | null;
};

export type WeekSuggestionEntry = {
  day: string;
  meal: string;
  dish: string;
  notes: string;
  ingredients: string[];
};

export type WeekSuggestion = {
  days: WeekSuggestionEntry[];
  summary: string | null;
  createdAt: string;
};

export type MealsState = {
  version: 1;
  setup: MealsSetup;
  meals: Meal[];
  grocery: GroceryItem[];
  suggestion: WeekSuggestion | null;
};

/** The subset of the host keyed store this plugin uses. */
export type KeyedStore<T> = {
  lookup(key: string): Promise<T | undefined>;
  register(key: string, value: T, opts?: { assertCurrent?: () => void }): Promise<void>;
};

export type CallScope = {
  agentId: string;
  signal?: AbortSignal;
  assertCurrent: () => void;
};

export type FlyerDeal = {
  name: string;
  merchant: string;
  price: number | null;
  originalPrice: number | null;
  validFrom: string | null;
  validTo: string | null;
};

export type FlyerResult = {
  source: string;
  checkedAt: string;
  deals: FlyerDeal[];
  filteredByStores: string[];
};

export type FetchJson = (
  url: string,
  options: { signal?: AbortSignal; maxBytes: number },
) => Promise<unknown>;
