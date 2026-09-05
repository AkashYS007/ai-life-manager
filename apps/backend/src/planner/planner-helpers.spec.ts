import { buildSpokenPlanSummary } from './planner-helpers';

// Morning plan auto-apply increment (2026-09-05). Same "the one piece of
// this increment that's pure logic and can actually be tested
// deterministically in this sandbox" reasoning as common/ai-pricing.spec.ts
// and common/retry.spec.ts — no Prisma, no live DB, no network, just the
// spoken-summary text-building logic itself. This is genuinely worth its
// own test: it's the one piece of this increment a person actually hears,
// via VoiceNotifications.tsx/native TTS, so a formatting mistake here would
// be heard, not just seen.
describe('buildSpokenPlanSummary', () => {
  const taskTitleById = new Map([
    ['t1', 'Gym'],
    ['t2', 'Team meeting'],
    ['t3', 'Write report'],
    ['t4', 'Call dentist'],
    ['t5', 'Review PR'],
    ['t6', 'Grocery run'],
  ]);

  it('returns null for an empty plan (nothing to narrate)', () => {
    expect(buildSpokenPlanSummary('DAY', [], taskTitleById, 'America/New_York')).toBeNull();
  });

  it('formats a DAY-scope change with just a time, no day-of-week', () => {
    const result = buildSpokenPlanSummary(
      'DAY',
      [{ taskId: 't1', proposedStart: '2026-09-05T11:00:00.000Z' }],
      taskTitleById,
      'UTC',
    );
    expect(result).toBe('Gym at 11:00 AM.');
  });

  it('formats a WEEK-scope change with a day-of-week prefix, since items span multiple days', () => {
    // 2026-09-07 is a Monday.
    const result = buildSpokenPlanSummary(
      'WEEK',
      [{ taskId: 't2', proposedStart: '2026-09-07T14:00:00.000Z' }],
      taskTitleById,
      'UTC',
    );
    expect(result).toBe('Team meeting at Mon 2:00 PM.');
  });

  it('joins multiple changes with commas, in the order given', () => {
    const result = buildSpokenPlanSummary(
      'DAY',
      [
        { taskId: 't1', proposedStart: '2026-09-05T11:00:00.000Z' },
        { taskId: 't2', proposedStart: '2026-09-05T18:00:00.000Z' },
      ],
      taskTitleById,
      'UTC',
    );
    expect(result).toBe('Gym at 11:00 AM, Team meeting at 6:00 PM.');
  });

  it('caps at 5 items and summarizes the rest, rather than reading every item back for a big weekly plan', () => {
    const changes = ['t1', 't2', 't3', 't4', 't5', 't6'].map((taskId, i) => ({
      taskId,
      proposedStart: `2026-09-0${i + 1}T10:00:00.000Z`,
    }));
    const result = buildSpokenPlanSummary('WEEK', changes, taskTitleById, 'UTC');
    expect(result).toContain('and 1 more.');
    // Exactly 5 comma-separated items before the "and N more" tail.
    expect(result?.split(', ').length).toBe(6); // 5 items + "and 1 more."
  });

  it('falls back to a generic task label for a taskId with no known title, rather than showing "undefined"', () => {
    const result = buildSpokenPlanSummary(
      'DAY',
      [{ taskId: 'unknown-id', proposedStart: '2026-09-05T11:00:00.000Z' }],
      taskTitleById,
      'UTC',
    );
    expect(result).toBe('a task at 11:00 AM.');
  });

  it('respects the given timezone, not just UTC', () => {
    // 11:00 UTC is 07:00 in America/New_York (UTC-4 in September, DST).
    const result = buildSpokenPlanSummary(
      'DAY',
      [{ taskId: 't1', proposedStart: '2026-09-05T11:00:00.000Z' }],
      taskTitleById,
      'America/New_York',
    );
    expect(result).toBe('Gym at 7:00 AM.');
  });
});
