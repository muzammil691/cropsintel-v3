import { useEffect } from 'react'
import { drAtlas } from '@/lib/drAtlas'
import { AtlasCockpit } from '@/components/atlas/AtlasCockpit'

export default function Atlas() {
  useEffect(() => {
    drAtlas.log('feature_mount', 'ui', 'atlas')
  }, [])

  return <AtlasCockpit />
}
