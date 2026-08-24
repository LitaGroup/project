import * as path from 'path';

/**
 * 图片上传后的本地根目录：环境变量 DIR_IMAGE_WEBROOT，默认 <项目根>/images。
 * 目录经 main.ts 静态挂载，通过 http://{host}/images/{image-path} 对外访问。
 * 注意：需在 ConfigModule 加载 .env 之后调用（bootstrap / Nest 服务内均可）。
 */
export function imageWebroot(): string {
  return path.resolve(
    process.env.DIR_IMAGE_WEBROOT ?? path.resolve(process.cwd(), '../images'),
  );
}
