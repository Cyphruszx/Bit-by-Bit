/**
 * Signed-in actor for Open Banking user routes.
 *
 * Entitlement is the OPEN_BANKING flag on that user's stored ledger
 * (`public.ledgers` document `featureToggles`). Billing is not wired yet, so
 * this is the same Spec 12 gate the app already stores: missing means on
 * (`FEATURE_DEFAULTS.OPEN_BANKING`), and an explicit false stays off. The
 * request body cannot flip it.
 */

import { sessionUserFromRequest } from "@/lib/auth/request-session";
import { openBankingRuntimeStores } from "@/lib/fiskil/runtime-stores";
import { hasOpenBankingBundle, type FeatureToggles } from "@/lib/money-flow/features";

export const OPEN_BANKING_BUNDLE_ERROR = "Open Banking requires the Open Banking Bundle.";

export type OpenBankingActor = {
  userId: string;
  email: string;
  featureToggles: FeatureToggles;
};

export async function requireOpenBankingActor(
  request: Request,
  options?: { requireBundle?: boolean },
): Promise<{ ok: true; actor: OpenBankingActor } | { ok: false; response: Response }> {
  const session = await sessionUserFromRequest(request);
  if (!session?.userId) {
    return { ok: false, response: Response.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  const ledger = await openBankingRuntimeStores().ledgers.get(session.userId);
  const featureToggles = ledger.featureToggles ?? {};
  if (options?.requireBundle !== false && !hasOpenBankingBundle(ledger.featureToggles)) {
    return {
      ok: false,
      response: Response.json({ error: OPEN_BANKING_BUNDLE_ERROR }, { status: 403 }),
    };
  }

  return {
    ok: true,
    actor: { userId: session.userId, email: session.email, featureToggles },
  };
}
