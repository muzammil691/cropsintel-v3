import { Workflow } from 'lucide-react'
import { TabFrame, ComingSoon } from './AtlasPlanTab'

/**
 * Skeleton wrapper for 1.10ak's `WorkflowGraph`. Day-1 the tab renders a
 * placeholder so the cockpit is never broken. When 1.10ak ships, replace the
 * body with `<WorkflowGraph />` from `@/components/atlas/workflow/WorkflowGraph`.
 */
export default function AtlasWorkflowTab() {
  return (
    <TabFrame
      title="Workflows"
      hint="Visual graph of the 7-agent flow. Click a node to inspect its last run."
    >
      <ComingSoon
        icon={Workflow}
        feature="Workflow graph"
        owner="1.10ak knowledge authoring"
      />
    </TabFrame>
  )
}
