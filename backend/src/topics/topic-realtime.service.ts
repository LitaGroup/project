import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { TopicSubjectType } from '../common/enums';
import type { TopicReplyView, TopicView } from './topics.types';

export type TopicRealtimeEvent =
  | {
      type: 'topic.upsert';
      subjectType: TopicSubjectType;
      subjectId: string;
      topic: TopicView;
    }
  | {
      type: 'topic.delete';
      subjectType: TopicSubjectType;
      subjectId: string;
      topicId: number;
    }
  | {
      type: 'reply.upsert';
      subjectType: TopicSubjectType;
      subjectId: string;
      topicId: number;
      reply: TopicReplyView;
    };

/** 进程内话题实时事件总线（SSE 订阅按主体过滤） */
@Injectable()
export class TopicRealtimeService {
  private readonly subject = new Subject<TopicRealtimeEvent>();
  readonly events$ = this.subject.asObservable();

  publish(event: TopicRealtimeEvent): void {
    this.subject.next(event);
  }
}
