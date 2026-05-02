// AtlasTabPanel — re-export of AtlasTabBar (1.10an-remediation-2)
//
// The cockpit's tab strip. Implementation lives in AtlasTabBar.tsx and is
// already wired into AtlasCockpit; this barrel exposes the same component
// under the name AtlasTabPanel for the spec'd component tree.

export { AtlasTabBar as AtlasTabPanel, ATLAS_TABS } from './AtlasTabBar'
export type { AtlasTabKey } from './AtlasTabBar'
