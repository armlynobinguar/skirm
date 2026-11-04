import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExternalAgent } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';
import { ExternalAgentsCard } from './ExternalAgentsCard';

const agents = [
  { id: 'agt_1', name: 'Rook' },
  { id: 'agt_2', name: 'Wren' },
];

const ext = (over: Partial<ExternalAgent> = {}): ExternalAgent => ({
  id: 'ext_1',
  name: 'My bot',
  agentId: 'agt_1',
  mode: 'webhook',
  webhookUrl: 'https://agent.example.com/hook',
  calls: 150,
  misses: 3,
  lastError: 'timeout',
  lastSeenAt: '2026-11-04T10:00:00Z',
  rotatedAt: null,
  createdAt: '2026-11-04T09:00:00Z',
  ...over,
});

describe('S16 external agents', () => {
  it('lists external agents with what they play and how often they answered', async () => {
    renderWithProviders(<ExternalAgentsCard agents={agents} />, { handle: 'ada', api: { externalAgents: async () => [ext()] } });
    const row = await screen.findByTestId('ext-ext_1');
    expect(row).toHaveTextContent('My bot');
    expect(row).toHaveTextContent('Webhook');
    expect(row).toHaveTextContent('Plays Rook');
    expect(row).toHaveTextContent('147/150 ticks answered');
    expect(row).toHaveTextContent('last miss: timeout');
  });

  it('registers one and shows the secret and token once', async () => {
    const created = { externalAgent: ext({ id: 'ext_2', name: 'Puller', mode: 'pull', webhookUrl: null, agentId: 'agt_2', calls: 0, misses: 0, lastError: null }), secret: 'sks_secret', token: 'ext_2.sks_secret' };
    const { api, user } = renderWithProviders(<ExternalAgentsCard agents={agents} />, {
      handle: 'ada',
      api: { externalAgents: async () => [], createExternalAgent: async () => created },
    });
    expect(screen.getByTestId('ext-register')).toBeDisabled();
    await user.type(screen.getByTestId('ext-name'), 'Puller');
    await user.selectOptions(screen.getByTestId('ext-agent'), 'agt_2');
    await user.click(screen.getByTestId('ext-register'));
    expect(api.createExternalAgent).toHaveBeenCalledWith({ name: 'Puller', agentId: 'agt_2', webhookUrl: null });
    expect(await screen.findByTestId('ext-token-value')).toHaveTextContent('ext_2.sks_secret');
    expect(screen.getByTestId('ext-secret-value')).toHaveTextContent('sks_secret');
    await user.click(screen.getByText('I saved them'));
    expect(screen.queryByTestId('ext-secret')).toBeNull();
  });

  it('test-pings, rotates the secret and removes', async () => {
    const { api, user } = renderWithProviders(<ExternalAgentsCard agents={agents} />, {
      handle: 'ada',
      api: {
        externalAgents: async () => [ext()],
        pingExternalAgent: async () => ({ ok: true as const, mode: 'webhook' as const, status: 200, latencyMs: 42 }),
        rotateExternalAgent: async () => ({ externalAgent: ext(), secret: 'sks_new', token: 'ext_1.sks_new' }),
        deleteExternalAgent: async () => ({ deleted: true as const }),
      },
    });
    await user.click(await screen.findByTestId('ext-ping-ext_1'));
    expect(api.pingExternalAgent).toHaveBeenCalledWith('ext_1');
    expect(await screen.findByText('HTTP 200 in 42 ms')).toBeInTheDocument();
    await user.click(screen.getByTestId('ext-rotate-ext_1'));
    expect(await screen.findByTestId('ext-token-value')).toHaveTextContent('ext_1.sks_new');
    await user.click(screen.getByTestId('ext-delete-ext_1'));
    await waitFor(() => expect(api.deleteExternalAgent).toHaveBeenCalledWith('ext_1'));
  });

  it('rebinds an external agent to another agent', async () => {
    const { api, user } = renderWithProviders(<ExternalAgentsCard agents={agents} />, {
      handle: 'ada',
      api: { externalAgents: async () => [ext()], updateExternalAgent: async () => ext({ agentId: 'agt_2' }) },
    });
    await user.selectOptions(await screen.findByLabelText('Agent My bot plays'), 'agt_2');
    expect(api.updateExternalAgent).toHaveBeenCalledWith('ext_1', { agentId: 'agt_2' });
  });
});
