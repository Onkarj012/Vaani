# Design System Reference

Reference: [meelo-template.framer.website](https://meelo-template.framer.website/)  
Style: Sleek, modern, minimal creative portfolio

---

## Theme

- **Mode:** Light only
- **Personality:** Clean, editorial, professional-creative. Lots of whitespace, bold typography, soft pastel accent chips, subtle shadows.
- **Layout:** Single-page scroll with clearly separated sections. Max-width centered content, generous padding.

---

## Colors

### Core Palette
| Role | Value |
|---|---|
| Background | `#ffffff` |
| Surface / Off-white | `#f7f7f7` |
| Primary Text | `#1d1d1d` |
| Secondary Text | `#888888` |
| Muted / Placeholder | `#999999` |

### Accent Chips (pastel tag/badge colors)
| Name | Value |
|---|---|
| Lavender | `#e3e3ff` |
| Soft Blue | `#e3f2ff` |
| Mint Green | `#f3ffe3` |
| Blush Pink | `#fde4f9` |
| Peach | `#ffeeeb` |
| Butter Yellow | `#fff5c9` |

### Interactive
| Role | Value |
|---|---|
| Primary Accent / Link Hover | `#7575c8` (medium purple) |
| Link Default | `#0099ff` |
| Focus / Input Active Border | `#7575c8` |
| Inset Border | `rgb(0,0,0)` |

---

## Typography

### Font Families
| Font | Role |
|---|---|
| **Cabinet Grotesk** | Primary display / headings (main brand font) |
| **DM Sans** | Body text, UI labels, italic variants |
| **Fragment Mono** | Monospace / code / decorative labels |
| **General Sans** | Secondary body / supporting text |
| Inter | Fallback / system UI |

All fonts fall back to `sans-serif`.

### Type Scale
| Size | Usage |
|---|---|
| `62px` / `68px` lh | Hero headline (H1) |
| `50px` / `50px` lh | Large section title |
| `44px` / `50px` lh | Section heading (H2) |
| `40px` | Large subheading |
| `38px` / `44px` lh | H2 variant |
| `36px` / `42px` lh | H3 |
| `30px` / `38px` lh | H4 |
| `26px` / `34px` lh | H5 |
| `24px` / `30px` lh | Large body / card title |
| `22px` / `28px` lh | Body large |
| `20px` / `26px` lh | Body |
| `19px` / `23px` lh | Body small |
| `18px` / `1.2em` lh | Input / form text |
| `14px` / `18px` lh | Caption / meta |
| `13px` / `19px` lh | Label small |
| `12px` / `14px` lh | Micro label |
| `10px` / `11px` lh | Tiny / badge |

### Font Weights
| Weight | Usage |
|---|---|
| `400` | Body, regular |
| `500` | Medium emphasis |
| `600` | Semibold |
| `700` | Bold headings |
| `900` | Black / display headings |

### Letter Spacing
- Headings: `-0.01em` to `-0.04em` (tight)
- Body: `0em`
- Uppercase labels: `+0.05em` (wide)
- Tracking variants: `3.8px`, `4px` for all-caps marquee text

---

## Spacing & Layout

- **Border radius:**
  - Cards / containers: `20px`
  - Buttons / pills: `200px` (fully rounded)
  - Tags / chips: `50px`
  - Image tops: `300px 300px 10px 10px` (rounded top, flat bottom)
  - Avatars / circles: `50%`
  - Small elements: `10px`, `15px`, `48px`
- **Section padding:** `60px` vertical (desktop)
- **Input padding:** `12px 0px` (borderless underline style)

---

## Component Styles

### Buttons
- Fully rounded pill shape (`border-radius: 200px`)
- Filled primary: dark `#1d1d1d` background, white text
- Outlined: `1px inset border rgb(0,0,0)`, transparent background
- Hover: color transitions at `0.2s cubic-bezier(0.44, 0, 0.56, 1)`

### Cards
- Background: `#ffffff` or pastel accent
- Border radius: `20px`
- Shadow (subtle): `rgba(29,29,29,0.1) 0px 2px 4px 0px`
- Shadow (layered/elevated): `rgba(0,0,0,0.17) 0px 0.6px 1.6px -1.5px, rgba(0,0,0,0.14) 0px 2.3px 6px -3px, rgba(0,0,0,0.02) 0px 10px 26px -4.5px`

### Inputs / Forms
- Borderless style: only bottom border `2px solid #1d1d1d`
- Focus state: bottom border color changes to `#7575c8`
- Font: DM Sans, `18px`, `400` weight
- Placeholder color: `#1d1d1d` (same as text — minimal style)

### Tags / Badges
- Pill shape (`border-radius: 50px`)
- Pastel background from accent chip palette
- Small text, uppercase with wide letter-spacing (`0.05em`)

### Navigation
- Minimal top nav, transparent background
- Links: `#1d1d1d`, hover → `#7575c8`
- Active/current: `#1d1d1d`, no underline

---

## Animations & Motion

### Principles
- Subtle and purposeful — nothing flashy
- Easing: `cubic-bezier(0.44, 0, 0.56, 1)` (ease-in-out, slightly snappy)
- Duration: `0.2s` for micro-interactions (hover, focus)

### Patterns
- **Link/button hover:** color transition `0.2s`
- **Scroll-snapped carousel:** `scroll-snap-align: center` on list items
- **Marquee / ticker:** horizontal scrolling text strip (tool logos, availability badge) — continuous loop
- **Loading spinner:** `@keyframes __framer-loading-spin` (rotate)
- **Entrance animations:** Framer-driven — elements slide/fade in on scroll (translate + opacity)
- **`will-change: transform`** applied to animated elements for GPU compositing

---

## Decorative Elements

- **✦ star/asterisk dividers** used inline in section labels (e.g. `✦ I AM AVAILABLE ✦ FOR FREELANCE`)
- **Marquee strips:** horizontal scrolling bands with repeated text or tool icons
- **Numbered process steps:** `01.` `02.` prefix in monospace/Fragment Mono
- **Stat counters:** large bold numbers with small descriptive labels below
- **Testimonial cards:** quote text + avatar + name + role, card layout with soft shadow
- **Timeline:** vertical list with date ranges in muted text, role/company in bold

---

## Section Structure

1. **Nav** — logo left, links center/right, CTA button
2. **Hero** — large headline, subtext, CTA button, availability badge
3. **Services** — 2×2 grid of service cards with pastel icon backgrounds
4. **About** — two-column: text left, experience timeline right
5. **Testimonials** — horizontal scroll / carousel of quote cards
6. **Portfolio / Works** — grid of project cards (image + title + tag + CTA)
7. **Stats** — horizontal row of large number + label pairs
8. **Process** — numbered vertical steps
9. **Tools marquee** — auto-scrolling logo strip
10. **Pricing** — two-column plan cards (Starter / Custom)
11. **FAQ** — accordion list
12. **Contact / Footer** — form + social links

---

## Design Tokens (CSS Variables)

```css
:root {
  /* Colors */
  --color-bg:        #ffffff;
  --color-surface:   #f7f7f7;
  --color-text:      #1d1d1d;
  --color-muted:     #888888;
  --color-accent:    #7575c8;

  /* Pastel chips */
  --chip-lavender:   #e3e3ff;
  --chip-blue:       #e3f2ff;
  --chip-green:      #f3ffe3;
  --chip-pink:       #fde4f9;
  --chip-peach:      #ffeeeb;
  --chip-yellow:     #fff5c9;

  /* Typography */
  --font-display:    "Cabinet Grotesk", sans-serif;
  --font-body:       "DM Sans", sans-serif;
  --font-mono:       "Fragment Mono", monospace;

  /* Radius */
  --radius-pill:     200px;
  --radius-card:     20px;
  --radius-tag:      50px;
  --radius-sm:       10px;

  /* Motion */
  --ease-default:    cubic-bezier(0.44, 0, 0.56, 1);
  --duration-fast:   0.2s;
}
```
