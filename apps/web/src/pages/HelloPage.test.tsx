import { type HelloPayload } from '@household-budget/core';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HelloPage } from './HelloPage';

const payload: HelloPayload = {
  message: 'hello from api',
  db: 'ok',
  timestamp: '2026-01-02T03:04:05.000Z',
};

function mockFetch(implementation: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(implementation));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HelloPage', () => {
  it('renders the API payload once it resolves', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })));

    render(<HelloPage />);

    expect(await screen.findByText('hello from api — database reachable')).toBeInTheDocument();
    expect(screen.getByText('db: ok')).toBeInTheDocument();
    expect(screen.getByText(payload.timestamp)).toBeInTheDocument();
  });

  it('surfaces a failure instead of rendering a payload', async () => {
    mockFetch(() => Promise.resolve(new Response('nope', { status: 500, statusText: 'Boom' })));

    render(<HelloPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');
  });
});
