const DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSTAL = /^[A-Z0-9][A-Z0-9 -]{1,9}$/;

export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date for `now`. A saved IANA zone wins. Otherwise this is the gateway host's local date. */
export function today(now: number, timeZone?: string | null): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  const date = new Date(now);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizePostal(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (normalized.length < 3 || normalized.length > 10 || !POSTAL.test(normalized)) {
    throw new Error('Postal code should be 3 to 10 letters or digits, such as A1A 1A1.');
  }
  return normalized;
}

/** Shows only the first three characters so setup can be confirmed without echoing the code. */
export function maskPostal(value: string | null): string | null {
  if (!value) return null;
  return value.length > 3 ? `${value.slice(0, 3)}***` : '***';
}

export function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('en-CA');
}

export function cleanText(value: string, label: string, max: number): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return clean;
}

export function optionalText(value: string | undefined | null, max: number): string | null {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length > max) throw new Error(`Text must be ${max} characters or fewer.`);
  return clean;
}

export function uniqueStrings(values: readonly string[] | undefined, max: number, maxLength: number): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    if (clean.length > maxLength) throw new Error(`Each entry must be ${maxLength} characters or fewer.`);
    const key = normalizeName(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length > max) throw new Error(`At most ${max} entries are allowed.`);
  }
  return result;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asStringArray(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, max)
    : [];
}
