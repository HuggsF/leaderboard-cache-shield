/** Renders every collected metric in a scrape format (Prometheus text exposition). */
export interface MetricsExporter {
  readonly contentType: string;
  render(): string;
}
