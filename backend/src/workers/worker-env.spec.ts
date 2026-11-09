import { workMcpConfigShell } from './worker-env';

describe('workMcpConfigShell', () => {
  it('写入 opencode V2 mcp.servers 配置并设置权限 600', () => {
    const shell = workMcpConfigShell(
      '/srv/work/worker/7',
      'http://work.cinta.team/',
      'token-123',
    );
    expect(shell).toContain("'/srv/work/worker/7/.opencode/opencode.json'");
    expect(shell).toContain('chmod 600');
    expect(shell).toContain('https://opencode.ai/config.json');
    expect(shell).toContain('"lita-work"');
    expect(shell).toContain('"type": "remote"');
    expect(shell).toContain('"url": "http://work.cinta.team/api/mcp/work"');
    expect(shell).toContain('"oauth": false');
    expect(shell).toContain('"X-Worker-Token": "token-123"');
  });

  it('令牌与路径中的单引号按 shell 规则转义', () => {
    const shell = workMcpConfigShell(
      "/srv/it's/worker/7",
      'http://host',
      "tok'en",
    );
    expect(shell).toContain(`'\\''`);
    expect(shell).not.toContain("tok'en");
  });
});
