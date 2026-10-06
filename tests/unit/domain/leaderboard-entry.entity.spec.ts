import { LeaderboardEntry } from '@domain/entities/leaderboard-entry.entity';
import { InvalidLeaderboardEntryError } from '@domain/errors/invalid-leaderboard-entry.error';
import { entryProps } from '../../support/fakes';

describe('LeaderboardEntry', () => {
  it('builds an entry from valid props', () => {
    const result = LeaderboardEntry.create(
      entryProps(1, { studentId: ' 0199-abc ', studentName: ' Ana  Souza ' }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentId).toBe('0199-abc');
      expect(result.data.studentName.value).toBe('Ana Souza');
      expect(result.data.courseName.value).toBe('Advanced Algebra');
      expect(result.data.totalScore.value).toBe(8_990);
      expect(result.data.rank.value).toBe(1);
      expect(result.data.completedCourses).toBe(5);
      expect(Object.isFrozen(result.data)).toBe(true);
    }
  });

  it('reports every violation at once', () => {
    const result = LeaderboardEntry.create({
      studentId: '',
      studentName: 'A',
      courseName: '',
      totalScore: 10_001,
      rank: 0,
      completedCourses: -1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidLeaderboardEntryError);
      expect(result.error.code).toBe('INVALID_LEADERBOARD_ENTRY');
      expect(result.error.violations.map((violation) => violation.field)).toEqual([
        'studentId',
        'studentName',
        'courseName',
        'totalScore',
        'rank',
        'completedCourses',
      ]);
      expect(result.error.message).toContain('totalScore: Score must be between 0 and 10000');
    }
  });

  it('rejects ids longer than a UUID column', () => {
    const result = LeaderboardEntry.create(entryProps(1, { studentId: 'x'.repeat(37) }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.violations[0]?.message).toContain('at most 36 characters');
    }
  });

  it('rejects a fractional number of completed courses', () => {
    expect(LeaderboardEntry.create(entryProps(1, { completedCourses: 2.5 })).success).toBe(false);
  });

  it('has identity: the student id', () => {
    const a = LeaderboardEntry.create(entryProps(1));
    const b = LeaderboardEntry.create(entryProps(1, { rank: 2, totalScore: 10 }));
    const c = LeaderboardEntry.create(entryProps(2));
    if (!a.success || !b.success || !c.success) throw new Error('fixture');

    expect(a.data.equals(b.data)).toBe(true);
    expect(a.data.equals(c.data)).toBe(false);
  });
});
