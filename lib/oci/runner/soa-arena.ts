export const ARENA_LAYOUT = {
  statusOffset: 0,
  retryCountOffset: 4,
  valueCentsOffset: 8,
  updatedAtMsOffset: 16,
  rowSize: 24,
} as const;

export type ArenaStatus = 0 | 1 | 2 | 3;

export class ConversionBatchArena {
  readonly size: number;
  readonly buffer: SharedArrayBuffer;
  readonly view: DataView;

  constructor(size: number) {
    this.size = size;
    this.buffer = new SharedArrayBuffer(size * ARENA_LAYOUT.rowSize);
    this.view = new DataView(this.buffer);
  }

  private base(index: number): number {
    return index * ARENA_LAYOUT.rowSize;
  }

  setStatus(index: number, value: ArenaStatus): void {
    this.view.setInt32(this.base(index) + ARENA_LAYOUT.statusOffset, value, true);
  }

  getStatus(index: number): ArenaStatus {
    return this.view.getInt32(this.base(index) + ARENA_LAYOUT.statusOffset, true) as ArenaStatus;
  }

  setRetryCount(index: number, value: number): void {
    this.view.setInt32(this.base(index) + ARENA_LAYOUT.retryCountOffset, value, true);
  }

  getRetryCount(index: number): number {
    return this.view.getInt32(this.base(index) + ARENA_LAYOUT.retryCountOffset, true);
  }

  setValueCents(index: number, value: number): void {
    this.view.setFloat64(this.base(index) + ARENA_LAYOUT.valueCentsOffset, value, true);
  }

  getValueCents(index: number): number {
    return this.view.getFloat64(this.base(index) + ARENA_LAYOUT.valueCentsOffset, true);
  }

  setUpdatedAtMs(index: number, epochMs: number): void {
    this.view.setFloat64(this.base(index) + ARENA_LAYOUT.updatedAtMsOffset, epochMs, true);
  }

  getUpdatedAtMs(index: number): number {
    return this.view.getFloat64(this.base(index) + ARENA_LAYOUT.updatedAtMsOffset, true);
  }
}
