import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkFileTools } from './work-file.tools';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

function buildTools(): {
  tools: Map<string, Handler>;
  files: { store: jest.Mock; renderMarkdown: jest.Mock };
} {
  const files = {
    store: jest.fn().mockResolvedValue({
      filename: 'report.pdf',
      size: 5,
      mime: 'application/pdf',
      url: 'http://work.cinta.team/files/20261109/x.pdf',
    }),
    renderMarkdown: jest.fn().mockReturnValue('# 文件上传成功'),
  };
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  new WorkFileTools(files as never).register(server, {
    user: { id: 1, name: '张三' } as never,
  });
  return { tools, files };
}

describe('WorkFileTools.upload_file', () => {
  it('解码 base64 后交给 FilesService 并返回 Markdown', async () => {
    const { tools, files } = buildTools();
    const result = (await tools.get('upload_file')!({
      filename: 'report.pdf',
      content_base64: `data:application/pdf;base64,${Buffer.from('hello').toString('base64')}`,
      mime_type: 'application/pdf',
    })) as { content: { text: string }[]; isError?: boolean };
    expect(files.store).toHaveBeenCalledWith({
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
      size: 5,
      buffer: Buffer.from('hello'),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 文件上传成功');
  });

  it('解码为空时返回 isError', async () => {
    const { tools, files } = buildTools();
    const result = (await tools.get('upload_file')!({
      filename: 'empty.txt',
      content_base64: '',
    })) as { content: { text: string }[]; isError?: boolean };
    expect(files.store).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
