export interface ParallelWaveMetrics {
  waveIndex: number;
  stageIds: string[];
  startedAt: string;
  completedAt?: string;
  parallelCount: number;
}

/** 追踪 DAG 并行波次健康状态；增强 `dag_parallel_wave` debug 日志。 */
export class WorkflowParallelMonitor {
  private waveIndex = 0;
  private readonly metrics: ParallelWaveMetrics[] = [];
  private openWave: ParallelWaveMetrics | undefined;

  recordWaveStart(stageIds: string[]): number {
    this.waveIndex += 1;
    this.openWave = {
      waveIndex: this.waveIndex,
      stageIds: [...stageIds],
      startedAt: new Date().toISOString(),
      parallelCount: stageIds.length,
    };
    return this.waveIndex;
  }

  recordWaveComplete(waveIndex: number): void {
    const wave = this.metrics.find((m) => m.waveIndex === waveIndex) ?? this.openWave;
    if (wave && wave.waveIndex === waveIndex) {
      wave.completedAt = new Date().toISOString();
      if (!this.metrics.includes(wave)) {
        this.metrics.push(wave);
      }
    }
    if (this.openWave?.waveIndex === waveIndex) {
      this.openWave = undefined;
    }
  }

  finalizeOpenWave(): void {
    if (this.openWave) {
      this.metrics.push(this.openWave);
      this.openWave = undefined;
    }
  }

  detectPotentialDeadlock(maxOpenMs = 120_000): string | null {
    if (!this.openWave) {
      return null;
    }
    const elapsed = Date.parse(new Date().toISOString()) - Date.parse(this.openWave.startedAt);
    if (elapsed > maxOpenMs) {
      return `parallel-wave-${this.openWave.waveIndex}-stuck:${this.openWave.stageIds.join(',')}`;
    }
    return null;
  }

  getWaveMetrics(): ParallelWaveMetrics[] {
    return [...this.metrics, ...(this.openWave ? [this.openWave] : [])];
  }

  buildWaveDebugPayload(waveIndex: number): Record<string, unknown> {
    const wave = this.getWaveMetrics().find((m) => m.waveIndex === waveIndex);
    return {
      waveIndex,
      stageIds: wave?.stageIds ?? [],
      parallelCount: wave?.parallelCount ?? 0,
      startedAt: wave?.startedAt,
      completedAt: wave?.completedAt,
      deadlockHint: this.detectPotentialDeadlock(),
    };
  }
}
