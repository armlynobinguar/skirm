'use client';

// S10: the seller takes their own listing down (DELETE /market/:id/listing). Outside dev mode the
// listing also lives on the market contract: the api names the wallet call (`market.delist`) and
// the seller's wallet signs it right after, so nobody can buy it onchain at the old price.
import { Button } from '@skirm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/toast/ToastProvider';
import { qk } from '@/lib/api/queries';
import type { Listing } from '@/lib/api/types';
import { useApi } from '@/lib/services';
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

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await api.cancelListing(skillId, listing.version);
      for (const c of res.onchain?.calls.filter((x) => x.required) ?? []) {
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
