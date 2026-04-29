export async function notifyWhatsApp(message: string): Promise<void> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM
  const toNumber = process.env.NOTIFY_WHATSAPP_TO

  if (!twilioSid || !twilioToken || !fromNumber || !toNumber) {
    console.warn('[verifier] WhatsApp not configured — skipping notification:', message)
    return
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`
  const body = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To: `whatsapp:${toNumber}`,
    Body: message,
  })

  const credentials = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[verifier] WhatsApp notification failed:', response.status, text)
    }
  } catch (err) {
    console.error('[verifier] WhatsApp notification error:', err instanceof Error ? err.message : String(err))
  }
}
