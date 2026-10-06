import { leaderboardCodec } from '@infrastructure/cache/cache-codec';
import { leaderboardDto } from '../../support/fakes';

describe('leaderboardCodec', () => {
  it('encodes and decodes a valid LeaderboardDTO', () => {
    const dto = leaderboardDto();
    const encoded = leaderboardCodec.encode(dto);
    expect(typeof encoded).toBe('string');

    const decoded = leaderboardCodec.decode(encoded);
    expect(decoded).toEqual(dto);
  });

  it('returns null on invalid JSON or non-object', () => {
    expect(leaderboardCodec.decode('invalid json{')).toBeNull();
    expect(leaderboardCodec.decode('null')).toBeNull();
    expect(leaderboardCodec.decode('123')).toBeNull();
    expect(leaderboardCodec.decode('"string"')).toBeNull();
  });

  it('returns null when top-level fields are missing or wrong type', () => {
    expect(leaderboardCodec.decode('{}')).toBeNull();
    expect(leaderboardCodec.decode(JSON.stringify({ page: '1' }))).toBeNull();
    expect(
      leaderboardCodec.decode(
        JSON.stringify({
          page: 1,
          pageSize: 10,
          totalStudents: 100,
          totalPages: 10,
          generatedAt: '2026-01-01',
          entries: 'not-an-array',
        }),
      ),
    ).toBeNull();
  });
});
