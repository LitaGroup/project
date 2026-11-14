import type { AuthedRequest } from '../auth/auth.guard';
import { UserRole } from '../common/enums';
import type { TopicActor } from './topics.types';

/** 网页 / .md 请求统一转话题操作人 */
export function topicActorOf(req: AuthedRequest): TopicActor {
  const user = req.user;
  const worker = req.worker;
  return {
    user,
    worker,
    name: worker?.name || user?.name || '系统',
    isAdmin: user?.role === UserRole.ADMIN,
    userId: user?.id ?? worker?.humanUserId ?? null,
    workerId: worker?.id ?? null,
  };
}

/** MCP principal 转话题操作人 */
export function topicActorOfPrincipal(principal: {
  user?: import('../auth/user.entity').User;
  worker?: import('../workers/worker.entity').Worker;
}): TopicActor {
  const user = principal.user;
  const worker = principal.worker;
  return {
    user,
    worker,
    name: worker?.name || user?.name || '公共 Agent',
    isAdmin: user?.role === UserRole.ADMIN,
    userId: user?.id ?? worker?.humanUserId ?? null,
    workerId: worker?.id ?? null,
  };
}
