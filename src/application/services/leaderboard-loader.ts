import type { LeaderboardDTO } from '@application/dtos/leaderboard.dto';
import type { Clock } from '@application/interfaces/clock';
import type { MetricsCollector } from '@application/interfaces/metrics-collector';
import type { LeaderboardRepository } from '@domain/repositories/leaderboard.repository';
import type { PageRequest } from '@domain/value-objects/page-request.value-object';
import { toLeaderboardDto } from './leaderboard.mapper';

/** The only path to MySQL: every heavy query is counted and timed here, whatever the strategy. */
export class LeaderboardLoader {
  constructor(
    private readonly repository: LeaderboardRepository,
    private readonly clock: Pick<Clock, 'nowMs'>,
    private readonly metrics: MetricsCollector,
  ) {}

  async load(pageRequest: PageRequest): Promise<LeaderboardDTO> {
    this.metrics.incrementDbQuery();
    const startedAt = this.clock.nowMs();
    try {
      const leaderboard = await this.repository.getLeaderboard(
        pageRequest.page,
        pageRequest.pageSize,
      );
      this.metrics.recordLatency('db_query', this.clock.nowMs() - startedAt);
      return toLeaderboardDto(leaderboard);
    } catch (error: unknown) {
      this.metrics.incrementDbQueryError();
      throw error;
    }
  }
}
