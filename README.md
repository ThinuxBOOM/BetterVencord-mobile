# BetterVencord Mobile

The 9 exclusive BetterVencord plugins, rebuilt for **Android Discord** on the
Vendetta-compatible mod stack (Vendetta / Bunny / Revenge). Install a loader,
paste a plugin URL, done. No terminal, no build tools on your phone.

> Client mods violate Discord's Terms of Service. Use an alt account, or at
> least know the risk. Nothing here sends your data anywhere: analytics run
> on-device, reminders and drafts stay in local plugin storage.

## Install (phone, non-root)

1. Install a loader:
   - **Revenge Manager** (non-root, recommended, actively maintained), or
   - **RevengeXposed** (root via Xposed), or Bunny/Vendetta loaders.
2. Open Discord Settings, find the mod's **Plugins** page, tap **+**
   (Install plugin).
3. Paste one of the plugin URLs below and confirm.

## Plugin URLs

Base: `https://thinuxboom.github.io/BetterVencord-mobile/`

| Plugin | URL suffix | What it does on mobile |
|---|---|---|
| ChatArchive | `chat-archive` | Exports the open channel to Markdown/HTML, copied to clipboard |
| ChatStats | `chat-stats` | Local-only channel analytics (authors, words, busy days) |
| DraftsPlus | `drafts-plus` | Per-channel sent-message history with copy-back and delete |
| RemindMe | `remind-me` | Long-press a message for 1h/24h reminder toasts, survives restarts |
| ServerJanitor | `server-janitor` | Emoji/sticker inventory, in-place delete, JSON export to clipboard |
| SettingsVault | `settings-vault` | Backup/restore theme links + settings as one JSON file |
| DiscordStyler | `discord-styler` | Accent presets + true-black AMOLED (best-effort per version) |
| GuildStyler | `guild-styler` | Per-server accent colors, auto-swapped on server switch |
| SnippetStudio | `snippet-studio` | Hides gift/GIF/sticker/Apps buttons + custom CSS box |

## Stock Vencord ports

Selected stock Vencord plugins, ported where mobile allows. Original authors
are credited in each plugin file; all ports stay under Vencord's GPL-3.0.

| Plugin | URL suffix | Mobile adaptation |
|---|---|---|
| ClearURLs | `clear-urls` | Strips tracking params from links you send (edits not covered on mobile) |
| MessageLogger | `message-logger` | Local deleted/edited log with viewer and copy-back (no inline ghosts; React Native has no DOM) |
| RelationshipNotifier | `relationship-notifier` | Toasts on friend/server/group removal via snapshot diffing |
| CopyUserURLs | `copy-user-urls` | Copy-author-profile-URL row in the message long-press menu |
| CopyEmojiMarkdown | `copy-emoji-markdown` | Copies custom emojis in a message as `<:name:id>` markdown |
| CopyStickerLinks | `copy-sticker-links` | Copy/open sticker links from the sticker sheet and sticker messages |

Full URL example:

```
https://thinuxboom.github.io/BetterVencord-mobile/chat-archive
```

## Mobile notes (what changed vs desktop)

- **No DOM, no CSS, no file downloads on mobile.** Exports copy to the
  clipboard instead of downloading files, and confirms use native dialogs.
- **Appearance plugins are adapted, not 1:1.** React Native has no CSS
  cascade, so wallpapers/fonts stay in your loader's **Themes** page while
  DiscordStyler/GuildStyler patch the runtime accent layer and SnippetStudio
  filters chat-input buttons.
- **Stock Vencord plugins are desktop-only.** On mobile your loader already
  ships its own core set (themes, experiments, etc.). This repo ports the 9
  BetterVencord exclusives; it does not rebundle stock desktop plugins, most
  of which depend on Electron/DOM APIs that do not exist on Android.

## Build from source (PC)

```bash
npm install
npm run build      # outputs dist/<plugin>/index.js + manifest.json
npm run typecheck  # tsc --noEmit
```

Pushing to `main` publishes `dist/` to GitHub Pages via
`.github/workflows/deploy.yml`, which is what the install URLs above serve.

## Repo layout

```
plugins/<id>/manifest.json   # name, description, authors, entry
plugins/<id>/src/index.tsx   # plugin + settings UI (single file)
build.mjs                    # rollup bundler (Vendetta IIFE format)
dist/                        # built output, published to Pages (gitignored)
```

## Credits

Desktop originals: [BetterVencord](https://github.com/ThinuxBOOM/BetterVencord).
Mobile loader lineage: Vendetta, Bunny, Revenge. UI-hiding technique adapted
from the community hide-app-button tweak.
