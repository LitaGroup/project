import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 同步状态记录：按 key 存上次同步时间，支撑增量窗口（首次 15 天 / 后续 7 天） */
@Entity('sync_states')
export class SyncState {
  /** 如 'projects:feishu' */
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'datetime' })
  lastSyncAt: Date;
}
