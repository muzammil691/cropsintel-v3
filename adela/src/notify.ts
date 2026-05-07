import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"

const execFileAsync = promisify(execFile)

const WHATSAPP_SCRIPT = path.resolve(__dirname, "../../agent/notify-whatsapp.sh")

export async function notifyWhatsApp(message: string): Promise<void> {
  // Path A: use the shared notify-whatsapp.sh (Twilio direct + V2 fallback)
  // The script reads TWILIO_* from env, so no extra setup needed here.
  try {
    const { stdout, stderr } = await execFileAsync("bash", [WHATSAPP_SCRIPT, message])
    if (stdout) console.log("[notify]", stdout.trim())
    if (stderr) console.warn("[notify]", stderr.trim())
    return
  } catch (err) {
    console.warn("[notify] notify-whatsapp.sh failed, trying inline Twilio...", err)
  }

  // Path B: inline Twilio (if agent script not available in deployment)
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM
  const to = process.env.TWILIO_WHATSAPP_TO

  if (!sid || !token || !from || !to) {
    console.warn("[notify] No WhatsApp config available. Message:", message)
    return
  }

  const body = new URLSearchParams({ From: from, To: to, Body: message })
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    console.error("[notify] Twilio inline failed:", res.status, text)
  } else {
    console.log("[notify] WhatsApp sent via inline Twilio:", message)
  }
}
