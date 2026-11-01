'use client';
// The only module that imports the Privy React SDK. <Providers> loads it with a dynamic import in
// privy mode only (dev builds never fetch this chunk) and renders it beside the app, not around it:
// Privy's own modal lives under <PrivyProvider>, and the app talks to Privy through the controller
// (./privy.ts), so the app tree renders and hydrates the same in both modes.
import { PrivyProvider, useLogin, useLogout, usePrivy } from '@privy-io/react-auth';
import { useEffect } from 'react';
import type { PrivyController } from './privy';

function Bridge({ controller }: { controller: PrivyController }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { login } = useLogin({
    onComplete: () => controller.loginComplete(),
    onError: (code) => controller.loginFailed(String(code)),
  });
  const { logout } = useLogout();

  useEffect(
    () =>
      controller.attach({
        openLogin: (method) => login({ loginMethods: [method] }),
        getAccessToken,
        logout,
      }),
    [controller, login, getAccessToken, logout],
  );
  useEffect(() => controller.update({ ready, authenticated }), [controller, ready, authenticated]);
  return null;
}

export default function PrivyRoot({ controller }: { controller: PrivyController }) {
  return (
    <PrivyProvider
      appId={controller.appId}
      {...(controller.clientId ? { clientId: controller.clientId } : {})}
      config={{
        loginMethods: ['google', 'email'],
        appearance: { theme: 'dark', landingHeader: 'Sign in to skirm' },
        // skirm's money is on NEAR (NEAR Connect, src/lib/wallet); no EVM or Solana wallets.
        embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
      }}
    >
      <Bridge controller={controller} />
    </PrivyProvider>
  );
}
