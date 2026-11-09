import { mcpConfigShell } from './worker-env';

describe('mcpConfigShell', () => {
  it('写入 opencode V2 mcp.servers 配置并设置权限 600', () => {
    const shell = mcpConfigShell('/srv/work/worker/7', {
      'lita-work': {
        type: 'remote',
        url: 'http://work.cinta.team/api/mcp/work',
        oauth: false,
        headers: { 'X-Worker-Token': 'token-123' },
      },
      'custom-sse': {
        type: 'local',
        command: ['npx', '-y', 'mcp-remote', 'https://example.com/sse'],
        environment: { MCP_API_KEY: '{env:MCP_API_KEY}' },
      },
    });
    expect(shell).toContain("'/srv/work/worker/7/.opencode/opencode.json'");
    expect(shell).toContain('chmod 600');
    expect(shell).toContain('https://opencode.ai/config.json');
    expect(shell).toContain('"lita-work"');
    expect(shell).toContain('"type": "remote"');
    expect(shell).toContain('"url": "http://work.cinta.team/api/mcp/work"');
    expect(shell).toContain('"oauth": false');
    expect(shell).toContain('"X-Worker-Token": "token-123"');
    expect(shell).toContain('"custom-sse"');
    expect(shell).toContain('"type": "local"');
    expect(shell).toContain('"MCP_API_KEY": "{env:MCP_API_KEY}"');
  });

  it('令牌与路径中的单引号按 shell 规则转义', () => {
    const shell = mcpConfigShell("/srv/it's/worker/7", {
      'lita-work': {
        type: 'remote',
        url: 'http://host/api/mcp/work',
        oauth: false,
        headers: { 'X-Worker-Token': "tok'en" },
      },
    });
    expect(shell).toContain(`'\\''`);
    expect(shell).not.toContain("tok'en");
  });
});
