# Task: Phase 1.10l — Atlas mobile PWA polish

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §12 (mobile PWA)
**Context:** The Atlas dashboard from 1.10k is responsive, but to live on Muzammil's phone home screen — installable, offline shell, push notifications later — it needs PWA configuration. Master plan §1.13 also calls for PWA across CropsIntel; this is the first installable surface.
**Estimated effort:** ~1 hour
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Configure CropsIntel V3 as a Progressive Web App with the Atlas dashboard as the primary entry. User can "Add to Home Screen" on iOS or Android and get a near-native app experience.

## Important version constraint (master plan note)

`vite-plugin-pwa@1.2.0` does NOT support Vite 8 (current scaffold default). Two options per master plan §11.2 row 1.13:
- **Wait** for vite-plugin-pwa to ship Vite 8 support (check first)
- **Pin Vite to ^7** in vite.config.ts

For this task, prefer option 2 if vite-plugin-pwa hasn't updated. Verify by checking npm registry: `npm info vite-plugin-pwa versions`. If a version supporting Vite 8 exists, install that. If not, downgrade Vite to `^7` (pin in package.json).

## Files to create / modify

### vite.config.ts — add VitePWA plugin

```ts
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'CropsIntel',
        short_name: 'CropsIntel',
        description: 'Almond market intelligence + CRM. Atlas conductor for build.',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/atlas',  // PWA opens to Atlas page on launch
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache shell files; do NOT cache /atlas/* API responses (always fresh)
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/courteous-simplicity-production\.up\.railway\.app\/atlas\//,
            handler: 'NetworkOnly',  // never cache Atlas API
          },
          {
            urlPattern: /^https:\/\/.+\.supabase\.co\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
```

### public/icons/ — placeholder icons

For v0.1, create simple placeholder icons:
- `public/icons/icon-192.png` (192×192, plain colored square with "CI" letters)
- `public/icons/icon-512.png` (512×512, same)
- `public/icons/maskable-icon-512.png` (512×512, maskable safe zone)

Generate via a quick canvas approach in a build script, or use a placeholder service. Don't block on perfect branding — these are replaceable.

### index.html — add PWA meta tags

```html
<meta name="theme-color" content="#0f172a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="CropsIntel">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

### src/components/PwaInstallPrompt.tsx (optional)

```tsx
// Listens for beforeinstallprompt event; shows a small banner offering "Install CropsIntel"
// Only fires on browsers that support PWA install prompt (Chrome desktop/Android)
// iOS doesn't fire this — users have to use Safari "Add to Home Screen" manually
```

Render this component in `src/pages/Atlas.tsx` as a dismissible banner.

## Acceptance criteria

After this task ships:

1. `npm run build` succeeds without errors.
2. Built assets include `manifest.webmanifest`, `sw.js` (service worker), and icons in `dist/`.
3. After deploy, opening `https://muzammil691.github.io/cropsintel-v3/atlas` on Chrome desktop shows install button in address bar.
4. On iOS Safari: tapping Share → Add to Home Screen creates an icon that opens Atlas in standalone mode.
5. On Android Chrome: install prompt appears; tapping installs the app.
6. After install, opening from home screen launches Atlas page (start_url) in standalone (no browser chrome).
7. Offline: app shell loads (manifest + cached static assets); Atlas API calls fail gracefully with "offline" indicator (just `navigator.onLine === false` check, no full offline mode).

## Out of scope

- Push notifications (separate task; needs FCM/APNs setup)
- Background sync
- Real offline functionality (caching API responses) — too complex for v0.1
- iOS-specific install instructions modal (could add later)
- Custom splash screens per platform
- App Store / Play Store distribution (PWA only)

## Notes

- The `start_url: '/atlas'` means the PWA always opens to Atlas. If Muzammil installs from any page, launching the home-screen icon goes to Atlas. This matches our use case — Atlas IS the app for him.
- iOS PWAs have limitations vs Android: no native push, no install banner. Document in `.agent/questions/phase-1.10l-q.md` so user knows.
- The `NetworkOnly` cache strategy for Atlas API is critical — we never want stale snapshot data. Always fresh.
- Icons can be quickly placeholder; the priority is the install flow working. Replace with proper branded icons in a polish pass.
- Ensure base path for GitHub Pages deploy is correct. Vite config might need `base: '/cropsintel-v3/'` already; verify the manifest paths resolve correctly under that base.
