const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+12345622692'

export async function sendWhatsAppReply(
  toNumber: string,
  body: string,
): Promise<{ sid: string } | { error: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { error: 'Twilio creds not configured; reply not sent' }
  }
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM_NUMBER}`,
    To: toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`,
    Body: body.length > 1500 ? body.slice(0, 1497) + '...' : body,
  })
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )
  if (!res.ok) return { error: `Twilio API error: ${res.status} ${await res.text()}` }
  const data = (await res.json()) as { sid: string }
  return { sid: data.sid }
}

export function phoneToThreadId(from: string): string {
  return from.replace('whatsapp:', '').replace('+', '')
}
