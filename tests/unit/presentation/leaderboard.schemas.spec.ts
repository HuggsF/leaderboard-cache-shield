import {
  leaderboardQuerySchema,
  leaderboardResponseSchema,
} from '@presentation/http/schemas/leaderboard.schemas';

describe('Leaderboard Schemas', () => {
  it('parses valid query parameters with default page 1', () => {
    const parsedDefault = leaderboardQuerySchema.parse({});
    expect(parsedDefault.page).toBe(1);

    const parsedWithPage = leaderboardQuerySchema.parse({ page: '5' });
    expect(parsedWithPage.page).toBe(5);
  });

  it('rejects invalid query parameters', () => {
    expect(() => leaderboardQuerySchema.parse({ page: '0' })).toThrow();
    expect(() => leaderboardQuerySchema.parse({ page: '-1' })).toThrow();
    expect(() => leaderboardQuerySchema.parse({ page: 'abc' })).toThrow();
  });

  it('contains expected JSON schema definition for responses', () => {
    expect(leaderboardResponseSchema.type).toBe('object');
    expect(leaderboardResponseSchema.required).toContain('entries');
    expect(leaderboardResponseSchema.required).toContain('totalStudents');
  });
});
