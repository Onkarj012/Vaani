# Design Reference — Creative Portfolio Template

> Source: [meelo-template.framer.website](https://meelo-template.framer.website/)
> Reference file: `references/main.html`

---

## Overview

Dark-themed, modern single-page portfolio. Minimal, clean aesthetic with generous whitespace and strong typographic hierarchy.

---

## Typography

| Element | Font | Weight | Style |
|---------|------|--------|-------|
| Body / UI | DM Sans | 400 | Normal |
| Emphasis | DM Sans | 400 | Italic |
| Headings | DM Sans | 700 | Italic |

Font is embedded as base64 woff2.

---

## Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Background | Dark (near-black) | Page background |
| Surface | Slightly lighter dark | Cards, sections |
| Text Primary | White | Headings, body |
| Text Secondary | Muted gray | Descriptions, labels |
| Accent | Highlight color | CTAs, badges, links |

---

## Layout

- **Max width**: Contained center layout
- **Grid**: Card-based sections, 2–4 column grids for services/portfolio/process
- **Spacing**: Large vertical section gaps, generous padding within cards
- **Responsive**: Single-column on mobile, multi-column on desktop

---

## Sections

### 1. Navigation
- Horizontal nav: Home, Services, About, Portfolio, Process, Pricing, Contact
- CTA button: "FREE Remix"

### 2. Hero
- Large heading: "Hello! I'm Jonathan Meelo, a product designer."
- Subtext: Freelance product designer based in London
- CTA button: "See My Works"
- Badge: "I AM AVAILABLE FOR FREELANCE"

### 3. Services (4 cards)
- Strategy & Planning
- User Research
- Web Design
- Brand Design
- Each card: icon + title + short description

### 4. About
- Bio paragraph
- Experience timeline (3 entries):
  - NOV 2017–PRESENT: Creative Director at Malory House
  - SEP 2015–APR 2017: Senior Developer at Longwave Studio
  - MAY 2015–SEP 2015: Junior Developer at Webpaint Media

### 5. Testimonials (3 cards)
- Nikolas Brooten — Financial Analyst
- Cory Zamora — Sales Manager
- Coriss Ambady — Marketing Specialist

### 6. Portfolio / Works (4 projects)
- Snowlake Social Media
- Meeko Networking
- Sandbox Banking
- Creatink Portfolio
- Each: image + title + "View Case Study" link

### 7. Stats
- 77% satisfied customers
- 8 years experience
- 77+ projects
- 19 design awards

### 8. Process (4 steps)
1. Research & Ideation
2. Concept Development
3. Prototyping & Testing
4. Finalize Product

### 9. Tools Marquee
Scrolling horizontal strip (repeated 3× for seamless loop):
Figma, Photoshop, Framer, Spotify, Zapier, Readkit, Slack, Chat GPT, Notion

### 10. Pricing (2 plans)
| Plan | Price | Details |
|------|-------|---------|
| Starter | $500 | Up to 5 pages |
| Let's Talk | Custom | Unlimited pages |

### 11. FAQ (4 items, expandable)
- Charging model
- Experience duration
- Trial designs policy
- Process timeline (1–3 weeks)

### 12. Contact
- Form: Name, Email, Message fields + Submit button

### 13. Footer
- "© Meelo by elemis. Made in Framer."

---

## UI Patterns

- **Cards**: Rounded corners, subtle border or elevation on dark surface
- **Buttons**: Rounded pill shape, accent fill for primary, outline for secondary
- **Badges**: Small uppercase label with accent background
- **Marquee**: CSS/JS infinite horizontal scroll for tools section
- **Timeline**: Vertical or inline date-range entries
- **Hover states**: Subtle scale or opacity transitions

---

## Animation & Interaction

- Scroll-triggered section reveals
- Marquee auto-scroll (tools strip)
- Hover scale on cards and buttons
- Smooth scroll navigation

---

## Key Design Principles

1. **Dark-first** — All surfaces are dark; text is light
2. **Typographic hierarchy** — Size and weight differentiate content levels
3. **Generous spacing** — Sections breathe; no visual clutter
4. **Card-based content** — Discrete, scannable blocks
5. **Minimal decoration** — Content speaks; no gratuitous ornament
