import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { FilesController } from './files.controller';

describe('FilesController', () => {
  let root: string;
  let previousRoot: string | undefined;
  let controller: FilesController;

  beforeEach(async () => {
    previousRoot = process.env.DIR_FILE_WEBROOT;
    root = await fs.mkdtemp(path.join(tmpdir(), 'project-files-'));
    process.env.DIR_FILE_WEBROOT = root;
    controller = new FilesController(
      new ConfigService({ APP_URL: 'https://project.example.com/' }),
    );
  });

  afterEach(async () => {
    if (previousRoot === undefined) {
      delete process.env.DIR_FILE_WEBROOT;
    } else {
      process.env.DIR_FILE_WEBROOT = previousRoot;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('保存文件并返回公开访问地址与元信息', async () => {
    const markdown = await controller.upload({
      originalname: '季度报告.pdf',
      mimetype: 'application/pdf',
      size: 5,
      buffer: Buffer.from('hello'),
    } as Express.Multer.File);

    expect(markdown).toContain('filename: "季度报告.pdf"');
    expect(markdown).toContain('文件上传成功');
    expect(markdown).toContain('application/pdf');
    expect(markdown).toContain('5 B');

    const match =
      /https:\/\/project\.example\.com\/files\/(\d{8}\/[\w-]+\.pdf)/.exec(
        markdown,
      );
    expect(match).not.toBeNull();
    const relativePath = match![1];
    expect(await fs.readFile(path.join(root, relativePath), 'utf8')).toBe(
      'hello',
    );
  });

  it('缺少文件时返回 400', async () => {
    await expect(controller.upload()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('忽略不安全或异常扩展名', async () => {
    const markdown = await controller.upload({
      originalname: 'payload.<script>',
      mimetype: 'text/plain',
      size: 3,
      buffer: Buffer.from('abc'),
    } as Express.Multer.File);

    expect(markdown).toMatch(/\/files\/\d{8}\/[\w-]+/);
    expect(markdown).not.toMatch(/\/files\/\d{8}\/[\w-]+\.script/);
    expect(markdown).toContain('payload\\.\\<script\\>');
  });
});
