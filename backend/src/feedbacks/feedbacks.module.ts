import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbackReply } from './feedback-reply.entity';
import { Feedback } from './feedback.entity';
import {
  FeedbacksController,
  FeedbacksMarkdownController,
} from './feedbacks.controller';
import { FeedbacksService } from './feedbacks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Feedback, FeedbackReply])],
  controllers: [FeedbacksController, FeedbacksMarkdownController],
  providers: [FeedbacksService],
  exports: [FeedbacksService],
})
export class FeedbacksModule {}
