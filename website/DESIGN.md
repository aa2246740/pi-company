<!-- SEED: re-run $impeccable document once there's code to capture the actual tokens and components. -->

---
name: pi-company
description: Official documentation and product experience for pi-company, a Pi-native local multi-agent company runtime
---

# Design System: pi-company

## 1. Overview

**Creative North Star: "The Command Center"**

This design system embodies the aesthetic of a futuristic terminal control room: dense, precise, and authoritative. Every pixel serves a purpose; every color communicates state. The system rejects the generic SaaS landing page aesthetic, the single-note green terminal cliché, and the decorative noise of modern marketing sites. It embraces information density, terminal-native interaction patterns, and the nostalgic authority of CRT-era computing.

The visual language draws from three eras: the phosphor glow of 1980s CRT monitors, the density of early terminal interfaces, and the precision of modern command-line tools. The result is a retro-future aesthetic that feels both familiar and forward-looking: a control room for a small agent company, not a marketing brochure.

**Key Characteristics:**
- Information density over whitespace; every surface carries signal
- Terminal-native interaction: command palettes, status bars, tabs, split panes
- Multi-color phosphor palette; not a single-note green terminal
- CRT textures used subtly (scanlines, glow) without sacrificing readability
- State-driven color: the palette communicates status, not just decoration
- Monospace-forward typography with pixel/retro display accents

## 2. Colors: The Phosphor Palette

The palette draws from CRT phosphor chemistry: the green of P1 phosphor, the amber of P3, the cyan and magenta of RGB subpixels, and the warm off-white of illuminated text. Colors carry semantic meaning: green for success, amber for warning, cyan for information, magenta for special states.

### Primary
- **Phosphor Green** (#00ff41): The signature accent. Used for active states, success indicators, terminal prompts, and the primary glow effect. Reserve for elements that demand attention or indicate completion.

### Secondary
- **Warm Amber** (#ff9500): Warning states, secondary emphasis, warm accent. Used sparingly to highlight items needing attention without indicating error.

### Tertiary
- **Terminal Cyan** (#00d4ff): Informational elements, links, interactive affordances. The "clickable" signal.
- **Electric Magenta** (#e040fb): Special states, advanced features, differentiation from standard terminal palette.

### Neutral
- **Deep Void** (#0a0a0a): Primary background. The darkness of a powered-on CRT.
- **Panel Gray** (#1e1e1e): Secondary surfaces: cards, panels, code blocks. Depth layering without shadows.
- **Border Gray** (#3d3d3d): Dividers, borders, subtle structural elements.
- **Off-White** (#e0e0e0): Primary body text. Not pure white (which glares against dark backgrounds); a warm, readable illumination.
- **Dim Gray** (#6b7280): Muted text, secondary labels, disabled states.

### State Colors
- **Success** (#00ff41): Passed gates, completed tasks, merged PRs.
- **Warning** (#ff9500): Attention needed, pending review, rate limit approaching.
- **Error** (#ff3333): Failed tests, blocked gates, critical errors.
- **Info** (#00d4ff): Informational messages, help text, links.

### Named Rules

**The State-Driven Rule.** Colors communicate state, not decoration. Green means "done" or "active", amber means "attention", red means "blocked". Never use state colors decoratively.

**The Density Rule.** Dark backgrounds enable information density. The palette is designed for dense interfaces where every element is close to its neighbor. Contrast comes from luminance, not spacing.

**The Multi-Phosphor Rule.** Do not default to a single green palette. The system uses green, amber, cyan, and magenta deliberately. A screen dominated by one color is a failure of information design.

## 3. Typography

**Display Font:** VT323 (with monospace fallback)
**Body Font:** JetBrains Mono (with Fira Code, monospace fallback)
**Code Font:** JetBrains Mono (same as body; the distinction is contextual, not font-based)

**Character:** Monospace-forward, terminal-native. Every character occupies equal width, reinforcing the terminal aesthetic. VT323 provides a retro pixel display feel for headings; JetBrains Mono delivers modern readability for body and code.

### Hierarchy
- **Display** (400, clamp(2rem, 5vw, 3.5rem), 1.2): Hero headings and major section titles. Uses VT323 for that pixel-terminal feel. Limited to one per screen section.
- **Headline** (700, 1.5rem, 1.3): Section headers, panel titles. JetBrains Mono bold for authority.
- **Title** (600, 1.125rem, 1.4): Subsection headers, card titles. Medium weight for hierarchy without shouting.
- **Body** (400, 0.875rem, 1.6): Primary content. JetBrains Mono at 14px for comfortable reading density. Max line length: 65-75ch.
- **Label** (500, 0.75rem, 1.5, uppercase tracking 0.05em): Status labels, badges, tags. Small, uppercase, tightly tracked for terminal aesthetics.

### Named Rules

**The Mono-Only Rule.** All text is monospace. Sans-serif and serif fonts are prohibited. The terminal aesthetic requires uniform character width across all text.

**The Density Hierarchy Rule.** Hierarchy comes from weight and color, not size jumps. Large size differences break the dense terminal feel. A 1.125rem bold title next to 0.875rem body text is sufficient contrast.

**The Pixel Display Rule.** VT323 is reserved for hero/display headings only. Using it for body text destroys readability. One pixel-font element per screen section maximum.

## 4. Elevation

This system is flat by default. Depth is conveyed through background color differentiation, border definition, and glow effects, not shadows. The CRT aesthetic rejects drop shadows in favor of the phosphor's own luminance.

### Depth Strategy
- **Layer 0 (Deep Void #0a0a0a):** The base canvas. Full-screen background.
- **Layer 1 (Panel Gray #1e1e1e):** Cards, panels, code blocks, terminal panes. Raised surfaces.
- **Layer 2 (Border Gray #3d3d3d):** Structural borders, dividers. Defined edges.
- **Glow Effects:** The CRT equivalent of shadows. Used for focus states, active elements, and emphasis. Phosphor glow (text-shadow with the accent color at low opacity) replaces box-shadow.

### Named Rules

**The No-Drop-Shadow Rule.** `box-shadow` with blur radius > 0 is prohibited. Depth is communicated through color layering and border definition, not shadows.

**The Glow-as-Elevation Rule.** Focus states and active elements use phosphor glow (text-shadow or subtle box-shadow with 0 blur, colored). The glow indicates interactivity, not depth.

## 5. Components

### Terminal Pane
The primary container. A bordered, dark-background panel with a header bar containing window controls (three colored dots) and a title.
- **Shape:** 4px border-radius (subtle rounding, not pill-shaped)
- **Background:** Panel Gray (#1e1e1e)
- **Border:** 1px Border Gray (#3d3d3d)
- **Header:** Slightly lighter gray (#2d2d2d) with red/yellow/green dots (decorative, not interactive)
- **Internal Padding:** 16px

### Command Prompt
Inline command display with a colored prompt symbol.
- **Prompt Symbol:** Phosphor Green (#00ff41), bold
- **Command Text:** Off-White (#e0e0e0)
- **Cursor:** Blinking Phosphor Green block cursor

### Status Bar
Fixed-width bar displaying system state with pipe-separated segments.
- **Background:** Panel Gray (#1e1e1e)
- **Border Top:** 1px Border Gray (#3d3d3d)
- **Text:** Label style (uppercase, small, tracked)
- **Active State Indicator:** Small colored dot (green = online, amber = idle, gray = offline)

### Gate Badge
Status indicator for PR gates. Small pill showing passed/failed state.
- **Passed:** Phosphor Green background, checkmark icon
- **Failed:** Error Red background, X icon
- **Pending:** Amber background, clock icon
- **Shape:** 4px border-radius, inline display

### Stepper Timeline
Horizontal or vertical progress indicator showing workflow stages.
- **Completed Step:** Phosphor Green dot with connecting line
- **Current Step:** Amber dot (pulsing animation)
- **Future Step:** Dim Gray dot, dashed connecting line
- **Labels:** Label typography, positioned below dots

### Command Palette
Modal overlay for searching and executing commands.
- **Background:** Panel Gray (#1e1e1e) with slight opacity
- **Border:** 1px Border Gray (#3d3d3d)
- **Search Input:** Full-width, Off-White text on Deep Void background
- **Results List:** Hover state uses subtle Phosphor Green left border
- **Keyboard Hints:** Dim Gray labels for shortcuts

### Diff Viewer
Code difference display with line-level highlighting.
- **Added Lines:** Phosphor Green background at 10% opacity
- **Removed Lines:** Error Red background at 10% opacity
- **Context Lines:** Default background
- **Line Numbers:** Dim Gray

### Mailbox Card
Message display card with metadata header and content body.
- **Header:** Sender, type, priority, timestamp in Label typography
- **Priority Indicator:** Left border color (green = normal, amber = high, red = urgent)
- **Body:** Body typography, full line length
- **Shape:** 4px border-radius, Panel Gray background

## 6. Do's and Don'ts

### Do:
- **Do** use Phosphor Green (#00ff41) sparingly for active states and success indicators. Its impact comes from rarity.
- **Do** maintain information density. Terminal interfaces are dense; generous whitespace breaks the aesthetic.
- **Do** use state-driven colors consistently. Green = done, amber = attention, red = blocked, cyan = info.
- **Do** include CRT scanline effects as optional overlays, with a toggle to disable them.
- **Do** use monospace fonts exclusively. The terminal aesthetic requires uniform character width.
- **Do** design for keyboard navigation. Terminal users expect keyboard-first interaction.
- **Do** provide copyable command blocks for all terminal commands.
- **Do** use glow effects (text-shadow with accent colors) for focus and active states.
- **Do** label all interactive simulations as "simulated" when they don't execute real commands.

### Don't:
- **Don't** use a single green palette. The brief explicitly requires "CRT phosphor greens, warm amber, cyan, magenta, off-white, and deep black". A one-note green terminal is a failure.
- **Don't** use generic SaaS landing page patterns. No hero sections with gradient text, no feature card grids, no pricing tables.
- **Don't** use decorative blobs, orbs, or generic gradients. These are anti-references from PRODUCT.md.
- **Don't** use drop shadows with blur radius. The CRT aesthetic uses glow, not shadows.
- **Don't** use sans-serif or serif fonts. All text must be monospace.
- **Don't** use all-caps for body text. Reserve uppercase for short labels (≤4 words) and badges.
- **Don't** use glassmorphism (blurred backgrounds, frosted glass effects). This is explicitly prohibited.
- **Don't** use gradient text (`background-clip: text`). Use solid colors with glow effects instead.
- **Don't** use side-stripe borders (border-left > 1px as accent). Use background tints or leading icons instead.
- **Don't** use rounded corners > 16px. 4px is the standard; 8-12px maximum for large containers.
- **Don't** animate CSS layout properties. Use transform and opacity only.
- **Don't** gate content visibility on animation triggers. Content must be visible by default; animations enhance, not reveal.
- **Don't** use marketing buzzwords: "empower", "supercharge", "seamless", "world-class", "cutting-edge", "game-changer". Use specific technical language.
- **Don't** use em dashes. Use commas, colons, semicolons, periods, or parentheses.
