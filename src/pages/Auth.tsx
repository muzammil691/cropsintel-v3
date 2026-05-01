import { useEffect } from "react"
import NotImplemented from "@/components/NotImplemented"
import { drAtlas } from "@/lib/drAtlas"

export default function Auth() {
  useEffect(() => {
    drAtlas.log("feature_mount", "ui", "auth")
  }, [])
  return (
    <NotImplemented
      phase="1.30-auth-real"
      what="4 login methods (email+password, email OTP, WhatsApp+password, WhatsApp OTP) plus V1/V2 user migration bridge"
    />
  )
}
