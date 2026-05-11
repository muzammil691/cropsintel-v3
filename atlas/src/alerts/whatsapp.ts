// Alert helpers built on top of the Twilio WhatsApp transport. Centralised
// here so the conductor can call a single named function per alert and the
// exact operator-facing copy lives in one place.
//
// sendClusterLoopCapAlert is invoked when the CLUSTER investigation
// re-queue cap fires (phase-1.10bc). Errors from the underlying transport
// are caught and logged at ERROR level — the cap decision must be
// recorded in the conductor log even when WhatsApp delivery fails, so we
// never let an alert failure mask the fact that the cap was hit.

import { sendWhatsAppReplyAutoSplit } from '../lib/twilio'

const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'

export const CLUSTER_LOOP_CAP_ALERT_MESSAGE =
  'CLUSTER investigation loop capped at 2 — manual intervention required'

export async function sendClusterLoopCapAlert(clusterId: string): Promise<void> {
  const body = `${CLUSTER_LOOP_CAP_ALERT_MESSAGE} (cluster ${clusterId})`
  try {
    await sendWhatsAppReplyAutoSplit(MUZAMMIL_WHATSAPP, body)
  } catch (err) {
    console.error(
      '[alerts/whatsapp] sendClusterLoopCapAlert failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
