// Phase 1.10an — AtlasShell is now a thin re-export of AtlasCockpit so any
// caller that still imports `{ AtlasShell }` keeps working. New code should
// import `AtlasCockpit` directly from `./AtlasCockpit`.

export { AtlasCockpit as AtlasShell } from './AtlasCockpit'
