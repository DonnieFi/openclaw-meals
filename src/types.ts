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

export type KeyedStoreObservation<T> = {
  value: T | undefined;
  comparison: string;
};

export type KeyedStoreCompareIntent<T> =
  | { operation: 'update'; action: 'set'; value: T; ttlMs?: number }
  | { operation: 'update' | 'delete'; action: 'keep' }
  | { operation: 'delete'; action: 'delete' };

export type KeyedStoreCompareResult<T> =
  | { status: 'applied' | 'unchanged' }
  | { status: 'conflict'; current: KeyedStoreObservation<T> };

/** The subset of the host v2 keyed store this plugin uses. */
export type KeyedStore<T> = {
  observe(key: string): Promise<KeyedStoreObservation<T>>;
  compareAndApply(
    key: string,
    comparison: string,
    intent: KeyedStoreCompareIntent<T>,
  ): Promise<KeyedStoreCompareResult<T>>;
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
