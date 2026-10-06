import { Leaderboard } from '@domain/entities/leaderboard.entity';
import type { LeaderboardProps } from '@domain/entities/leaderboard.entity';
import { InvalidLeaderboardError } from '@domain/errors/invalid-leaderboard.error';
import { InvalidPageRequestError } from '@domain/errors/invalid-page-request.error';
import { buildEntry, GENERATED_AT } from '../../support/fakes';

const props = (overrides: Partial<LeaderboardProps> = {}): LeaderboardProps => ({
  entries: [buildEntry(1), buildEntry(2), buildEntry(3)],
  generatedAt: GENERATED_AT,
  totalStudents: 10,
  pageSize: 3,
  currentPage: 1,
  ...overrides,
});

const violationOf = (overrides: Partial<LeaderboardProps>): string => {
  const result = Leaderboard.create(props(overrides));
  if (result.success) {
    throw new Error('expected a failure');
  }
  expect(result.error).toBeInstanceOf(InvalidLeaderboardError);
  return result.error.message;
};

describe('Leaderboard', () => {
  it('builds a page and derives the pagination', () => {
    const result = Leaderboard.create(props());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entries).toHaveLength(3);
      expect(result.data.currentPage).toBe(1);
      expect(result.data.pageSize).toBe(3);
      expect(result.data.totalStudents).toBe(10);
      expect(result.data.totalPages).toBe(4);
      expect(result.data.isEmpty).toBe(false);
      expect(Object.isFrozen(result.data.entries)).toBe(true);
    }
  });

  it('copies its inputs (the caller cannot mutate the aggregate)', () => {
    const entries = [buildEntry(1)];
    const generatedAt = new Date(GENERATED_AT.getTime());
    const result = Leaderboard.create(props({ entries, generatedAt }));
    entries.push(buildEntry(2));
    generatedAt.setFullYear(2000);

    expect(result.success && result.data.entries).toHaveLength(1);
    expect(result.success && result.data.generatedAt.toISOString()).toBe(
      GENERATED_AT.toISOString(),
    );
  });

  it('accepts an empty page past the end of the ranking', () => {
    const result = Leaderboard.create(props({ entries: [], currentPage: 9, totalStudents: 10 }));

    expect(result.success && result.data.isEmpty).toBe(true);
  });

  it('accepts ties (same rank, same score)', () => {
    const result = Leaderboard.create(
      props({
        entries: [
          buildEntry(1, { rank: 1, totalScore: 900 }),
          buildEntry(2, { rank: 1, totalScore: 900 }),
          buildEntry(3, { rank: 3, totalScore: 850 }),
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it('validates the page request', () => {
    const result = Leaderboard.create(props({ currentPage: 0 }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidPageRequestError);
    }
  });

  it.each<[string, Partial<LeaderboardProps>, string]>([
    ['an invalid date', { generatedAt: new Date('nope') }, 'Generation date is invalid'],
    ['a negative total', { totalStudents: -1 }, 'non-negative integer'],
    ['a fractional total', { totalStudents: 2.5 }, 'non-negative integer'],
    [
      'more entries than the page size',
      { entries: [buildEntry(1), buildEntry(2), buildEntry(3), buildEntry(4)] },
      'at most 3 entries',
    ],
    [
      'more entries than students left',
      { currentPage: 4, totalStudents: 10 },
      'only 1 ranked students remain',
    ],
    [
      'a duplicated student',
      { entries: [buildEntry(1), buildEntry(1, { rank: 2 })] },
      'appears more than once',
    ],
    [
      'a rank above the number of students',
      { entries: [buildEntry(11)], totalStudents: 10 },
      'exceeds the number of ranked students',
    ],
    ['entries out of rank order', { entries: [buildEntry(2), buildEntry(1)] }, 'ordered by rank'],
    [
      'a better rank with a lower score',
      {
        entries: [buildEntry(1, { totalScore: 100 }), buildEntry(2, { totalScore: 200 })],
      },
      'lower score',
    ],
  ])('rejects %s', (_case, overrides, message) => {
    expect(violationOf(overrides)).toContain(message);
  });

  describe('isStale', () => {
    const leaderboard = (): Leaderboard => {
      const result = Leaderboard.create(props());
      if (!result.success) throw result.error;
      return result.data;
    };
    const at = (ms: number): Date => new Date(GENERATED_AT.getTime() + ms);

    it('is fresh until the max age is exceeded', () => {
      expect(leaderboard().isStale(300_000, at(300_000))).toBe(false);
      expect(leaderboard().isStale(300_000, at(300_001))).toBe(true);
    });

    it('never reports a negative age (clock skew)', () => {
      expect(leaderboard().ageMs(at(-5_000))).toBe(0);
      expect(leaderboard().isStale(0, at(-5_000))).toBe(false);
    });

    it('defaults to the current time', () => {
      const result = Leaderboard.create(props({ generatedAt: new Date(Date.now() - 10_000) }));
      if (!result.success) throw result.error;

      expect(result.data.isStale(1_000)).toBe(true);
      expect(result.data.isStale(60_000)).toBe(false);
      expect(result.data.ageMs()).toBeGreaterThanOrEqual(10_000);
    });
  });
});
