# TripleS design system

## Product contract

- **Audience:** one technically confident listener operating personal playlist automation.
- **Primary job:** understand sync health quickly, then act on the one item needing attention.
- **Direction:** a quiet studio console — dense, exact and musical without imitating a streaming app.

## Visual tokens

| Role | Value | Intent |
|---|---|---|
| Booth black | `#090d0f` | Page background |
| Console graphite | `#12181b` | Primary surface |
| Raised channel | `#182126` | Controls and nested surfaces |
| Chalk | `#eef4f2` | Primary text |
| Signal cyan | `#69d8cf` | Actions, focus and live system state |
| VU amber | `#f4bd59` | Waiting and warning state only |

Spotify, YouTube and SoundCloud colors identify their service only. They are not generic UI accents.

## Type

- **IBM Plex Sans:** interface, headings and prose. It supports the Latin and Cyrillic content in real playlists.
- **IBM Plex Mono:** timestamps, IDs and technical values only.
- Headings stay sentence case and semibold. Body copy stays below 80 characters where practical.

## Layout

```text
desktop                         mobile
┌──────────┬────────────────┐   ┌────────────────┐
│ brand    │ page context   │   │ brand + health │
│          ├────────┬───────┤   ├────────────────┤
│ 4 jobs   │ action │ state │   │ page context   │
│ manage   │ work   │ rail  │   │ next action    │
│ tools    │ detail on ask  │   │ primary work   │
└──────────┴────────────────┘   ├────────────────┤
                               │ bottom nav     │
                               └────────────────┘
```

- Order every screen as **action → working object → diagnostics**. Technical detail starts collapsed.
- Left-align operational content. Use thumbnail-led tiles for the music library and divided rows for activity.
- A `.workbench` may frame one complete task or status story; do not turn individual metrics into cards.
- One dominant action per screen. Motion reports state changes; no ambient section reveals.

## Reject

- Generic purple/blue SaaS gradients, glass panels and identical card grids.
- Decorative waveforms, equalizers or album art that do not carry real information.
- Raw colors, radii or shadows outside `app/globals.css`.
- Hover effects on non-interactive surfaces.

## Delivery checks

- Keyboard focus remains visible and unobscured.
- Informational text reaches WCAG AA contrast.
- Verify 390px and 1440px layouts, reduced motion, console errors and horizontal overflow.
