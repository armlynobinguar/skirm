'use client';

// S10: the seller takes their own listing down. Outside dev mode the listing lives on the market
// contract, so the seller's wallet signs `market.delist` FIRST and only then is it taken off the
// game (DELETE /market/:id/listing): a refused or failed delist leaves the listing showing, with
// Cancel still there to retry, instead of hiding a listing anyone could still buy onchain.
import { Button } from '@skirm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/toast/ToastProvider';
import { qk } from '@/lib/api/queries';
import type { Listing } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';
import { delistTx, tokenIdOf } from '@/lib/wallet/contracts';
import { useNearSigner } from '@/lib/wallet/hooks';
import { WalletError } from '@/lib/wallet/types';

export function CancelListingButton({
  skillId,
  listing,
  nearAccountId,
}: {
  skillId: string;
  listing: Listing;
  nearAccountId: string | null;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const signer = useNearSigner();
  const { mode } = useSession();

  const cancel = useMutation({
    mutationFn: async () => {
      if (mode !== 'dev') {
        if (!nearAccountId) throw new WalletError('wallet_no_account', 'Connect a NEAR wallet first.');
        await signer.send(delistTx(signer.contracts, listing.tokenId ?? tokenIdOf(skillId, listing.version)), nearAccountId);
      }
      const res = await api.cancelListing(skillId, listing.version);
      // Any other call the api still requires (the delist is signed already).
      for (const c of res.onchain?.calls.filter((x) => x.required && x.methodName !== 'delist') ?? []) {
        if (!nearAccountId) throw new WalletError('wallet_no_account', 'Connect a NEAR wallet first.');
        await signer.send(
          {
            receiverId: c.receiverId,
            actions: [{ type: 'FunctionCall', params: { methodName: c.methodName, args: c.args, gas: c.gas, deposit: c.deposit } }],
          },
          nearAccountId,
        );
      }
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.market.all });
      void qc.invalidateQueries({ queryKey: qk.skills.all });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
    onSuccess: () => toast.show({ tone: 'good', title: 'Listing cancelled', message: 'It is off the market. You still own it.' }),
    onError: (err) => toast.error(err),
  });

  return (
    <Button variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="s10-cancel-listing">
      {cancel.isPending ? 'Cancelling…' : 'Cancel listing'}
    </Button>
  );
}
