import 'server-only';

import { PspError, type PspAdapter } from './types';

/**
 * `PSP_DRIVER=off`, the default (spec 0011-08 AC-2): every call refuses with `psp_not_configured`, so a
 * deployment without a PSP opens no card page and moves no money. The relay fails the attempt and alerts.
 */
export function createOffAdapter(): PspAdapter {
  const refuse = async (): Promise<never> => {
    throw new PspError('psp_not_configured');
  };
  return {
    name: 'off',
    homeRegion: 'TR',
    checkoutHosts: [],
    initializeCheckout: refuse,
    retrieveCheckout: refuse,
    retrievePayment: refuse,
    refundPayment: refuse,
    verifyWebhook: refuse,
  };
}
