// Small shared helper for the Editing a proposed AI plan increment —
// converts between a real ISO datetime (what the API sends/expects) and the
// plain "YYYY-MM-DDTHH:mm" wall-clock string an `<input type="datetime-local">`
// element uses, in the browser's own local timezone. Shared between
// AiPlanCard (DAY scope) and WeeklyPlanCard (WEEK/MONTH scope) since both
// need the exact same conversion for their own per-change edit inputs.

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A datetime-local input's value has no timezone offset in it — per the
// standard ECMAScript Date Time String Format, a date-time string with no
// offset is parsed as local time (unlike a date-only string, which is
// parsed as UTC), so `new Date(value)` already does the right thing here
// with no extra timezone math needed.
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}
