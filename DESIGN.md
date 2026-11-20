<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Drillmaster
description: The viewer Owner opens to see how Drillmaster runs the work, and where it needed Owner.
---

# Design System: Drillmaster

## Overview

**Creative North Star: "The route card"**

Drillmaster's viewer reads like a route card for a disciplined operation: one line that every work
item travels, stops where something happens, and marks where it needed Owner. It is smooth and
technical, with hints of military in the palette, the ground and the brand's stencil, never in
costume. Owner is easily overloaded, so each screen answers one question and says it with symbols
before words.

Density is low and calm. The page opens on an overview and lets Owner drill in by scrolling; it
never zooms, snaps or animates for show. Every claim on screen traces back to the events it came
from.

**Key Characteristics:**
- One line through the work: stages and steps on it, splits only where steps are alternatives.
- Work items always left of the line, problems always right of it.
- Symbols first, a small key and hover explanations behind them; text only where a symbol cannot do.
- Orange means friction, and nothing else.

## Colors

A dark, olive-tinted ground with bone line work; colour is reserved for meaning.

### Primary
- **Bone** (#D9DED6): the line, the stops, work-item dots and counts.

### Secondary
- **Safety orange** (#FF7A1A): friction only, where Owner had to step in.

### Tertiary
- **Sand** (#E3C97E): Owner's planned approvals (the approval stop) and work Drillmaster sent back.

### Neutral
- **Ground** (#0F1311): the page.
- **Rule** (#232A25): dividers between stages.
- **Dim** (#8E998F): secondary marks, stage numbers, the delivery bar and the after-delivery line.
- **Placeholder** (#3A443C / #5C685E): bars standing in for text not written yet.

### Named Rules
**The One Alarm Rule.** Safety orange marks friction and nothing else: not links, not selection, not
the active tab. If orange appears, Owner had to step in there.

## Typography

**Display Font:** Big Shoulders Stencil Display (the brand only)
**Body Font:** Barlow (with system sans-serif)
**Label/Mono Font:** Barlow Condensed for spaced uppercase labels, where used

**Character:** A plain DIN-like sans carries everything; the stencil appears once, in the brand, as
the military hint.

### Hierarchy
- **Title** ([to be resolved during implementation]): stage and step names, kept short.
- **Body** ([to be resolved during implementation]): explanations in tooltips and the key.
- **Label** ([to be resolved during implementation]): counts, stage numbers.

### Named Rules
**The Stencil Once Rule.** The stencil face is the brand's and appears nowhere else.

## Layout

One centred vertical line runs the length of the page. The first screen is the overview alone: one
row per stage, then delivery, then after delivery. Scrolling brings in the detail, stage by stage,
until the end of the line reaches the middle of the screen; the page stops there. Work items sit
left of the line in one column of dots; problems sit right of it. The key floats small in a
corner. Plain native scrolling: no zoom, no snapping, no scroll-driven animation.

## Elevation & Depth

Flat. No shadows. Depth comes only from emphasis: the line and its marks in bone, everything
secondary in dim.

## Shapes

- **Stops on the line:** always = filled rounded square; if = hollow rounded square; Owner's
  approval = sand diamond; Drillmaster's review = a square inside a ring.
- **Work items:** a rounded box holding a count left of a dot, always an aggregate; hovering lists
  the items.
- **Friction:** an orange ring with a count, right of the line.
- **Splits:** the line forks into smooth curves and joins again; only steps that are alternatives on
  the same input split.
- **Delivery:** a short bar across the line; after delivery the line continues dotted.

## Do's and Don'ts

### Do:
- **Do** open on the overview alone, and let the detail come into frame as Owner scrolls.
- **Do** keep work items left of the line and problems right of it, on every screen.
- **Do** show work items as aggregate boxes with the count left of the dot, all dots in one column.
- **Do** give every symbol a hover explanation and an entry in the key.
- **Do** draw from real recorded data, never hand-placed numbers.

### Don't:
- **Don't** zoom, snap, or drive animation from the scroll; Owner found it janky.
- **Don't** repeat the overview at the end of the page.
- **Don't** add a status sentence or other text where a symbol already says it (Owner: "present
  less").
- **Don't** use orange for anything but friction.
- **Don't** dress the screen in military costume: no camouflage, badges or stencil beyond the brand.
