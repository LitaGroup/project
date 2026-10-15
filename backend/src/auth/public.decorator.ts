import { SetMetadata } from '@nestjs/common';

/** 跳过全局登录 Guard 的路由标记（登录端点、自带鉴权的 agent 端点用） */
export const IS_PUBLIC_KEY = 'pmp:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
