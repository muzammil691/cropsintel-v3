import { useEffect } from "react"
import NotImplemented from "@/components/NotImplemented"
import { drAtlas } from "@/lib/drAtlas"

export default function Dashboard() {
  useEffect(() => {
    drAtlas.log("feature_mount", "ui", "dashboard")
  }, [])
  return <NotImplemented phase="1.50+ — after Adela lands data" />
}
