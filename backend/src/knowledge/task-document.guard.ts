import { ForbiddenException } from '@nestjs/common';

/**
 * `/task/**` 是任务交付文档与复盘文档的保留路径，版本、通知与验收锁定
 * 必须经过任务中心；禁止从通用知识库入口（`.md` 端点与 lita-work MCP 工具）
 * 直接改写或删除。
 */
export function assertTaskDocumentWritable(
  ...paths: Array<string | undefined>
): void {
  for (const raw of paths) {
    if (!raw?.trim()) continue;
    const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (path === 'task' || path.startsWith('task/')) {
      throw new ForbiddenException(
        '任务交付/复盘文档由任务中心维护，请通过工作台或任务接口修改',
      );
    }
  }
}
