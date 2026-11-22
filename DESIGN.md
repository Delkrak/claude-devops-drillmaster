---
name: Drillmaster
description: The viewer Owner opens to see how Drillmaster runs the work, and where it needed Owner.
colors:
  ground: "#0F1311"
  bone: "#D9DED6"
  safety-orange: "#FF7A1A"
  sand: "#E3C97E"
  olive-green: "#A3C27A"
  dim: "#8E998F"
  not-yet: "#3A443C"
  rule: "#232A25"
  panel-rule: "#2C342E"
  key-ground: "rgb(20 26 22 / 0.92)"
  tip-ground: "#E9EDE6"
  tip-text: "#111111"
typography:
  brand:
    fontFamily: "Big Shoulders Stencil Display, Barlow, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "0.1em"
  headline:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
  title:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
  stage:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    letterSpacing: "0.08em"
  count:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
rounded:
  sm: "6px"
  lg: "12px"
  pill: "15px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  item-box:
    textColor: "{colors.bone}"
    typography: "{typography.count}"
    height: "22px"
  friction-ring:
    textColor: "{colors.safety-orange}"
    typography: "{typography.count}"
    size: "28px"
  tip:
    backgroundColor: "{colors.tip-ground}"
    textColor: "{colors.tip-text}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  key:
    backgroundColor: "{colors.key-ground}"
    textColor: "{colors.dim}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  find-box:
    textColor: "{colors.bone}"
    rounded: "{rounded.pill}"
    height: "30px"
    width: "96px"
  deeper-button:
    textColor: "{colors.bone}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  list-row:
    textColor: "{colors.bone}"
    padding: "12px 16px"
    height: "52px"
---

# Design System: Drillmaster

## Overview

**Creative North Star: "The route card"**

Drillmaster's viewer reads like a route card for a disciplined operation: one line that every work
item travels, stops where something happens, and marks where it needed Owner. It is smooth and
technical, with hints of military in the palette, the ground and the brand's stencil, never in
costume. Owner is easily overloaded, so each screen answers one question and says it with symbols
before words.

Density is low and calm. A page opens on its answer and lets Owner drill in: by scrolling on the
Workflow page, by clicking a step, a row or a mark everywhere else, one level at a time. It never
zooms, snaps or animates for show. Every claim on screen traces back to the events it came from.

Five pages share the header and the language: the Workflow (the pipeline, where the work items are,
where the friction is), a work item's route, the work items, the changes to the workflow, and the
complaints about Drillmaster itself.

**Key Characteristics:**
- One line through the work: stages and steps on it, splits only where steps are alternatives.
- Work items always left of the line, problems always right of it.
- Symbols first, a small key and short explanations behind them; text only where a symbol cannot do.
- Detail opens one level at a time, under what was clicked; the line runs on beside it.
- Orange means friction, and nothing else.

## Colors

A dark, olive-tinted ground with bone line work; colour is reserved for meaning.

### Primary
- **Bone**: the line, the stops, work-item dots, counts and names; everything Owner should read.

### Secondary
- **Safety orange**: friction only, where Owner had to step in.

### Tertiary
- **Sand**: Owner's approvals (the approval stop), work Drillmaster sent back, what waits on Owner
  (a step waiting for a review or for Owner), and a change whose effect is not significant or below
  its target.
- **Olive green**: a change whose effect is significant. Used for that verdict only.

### Neutral
- **Ground**: the page, and the inside of hollow stops and rings.
- **Dim**: stage names and numbers, labels, the delivery bar, the after-delivery line, a skipped
  step's name and reason, a change with insufficient data.
- **Not yet**: the line where a work item has not been yet, and a branch it did not take.
- **Rule** and **Panel rule**: dividers between stages and list rows; between the levels opened
  under a step.
- **Key ground**, **Tip ground**, **Tip text**: the floating key, and the light explanation that
  shows on hover or focus.

### Named Rules
**The One Alarm Rule.** Safety orange marks friction and nothing else: not links, not selection, not
the active page. If orange appears, Owner had to step in there.

**The Meaning-Only Colour Rule.** Sand and olive green carry one meaning each, listed above. Anything
else is bone or dim.

## Typography

**Display Font:** Big Shoulders Stencil Display (the brand only)
**Body Font:** Barlow (with ui-sans-serif, system-ui)

**Character:** A plain DIN-like sans carries everything; the stencil appears once, in the brand, as
the military hint. Both are bundled with the viewer, never loaded from the network.

### Hierarchy
- **Brand** (800, 20px, 0.1em): DRILLMASTER in the header, in dim.
- **Headline** (700, 30px): a work item's number above its route.
- **Title** (700, 17px): step names on the line; numbers in the lists.
- **Stage** (500, 15px): stage names, in dim, with the stage number spaced before them.
- **Body** (500, 14px, 1.45): what opens under a step or a row; kept to about 60 characters a line.
- **Label** (700, 11.5px, 0.08em, uppercase): the level labels under a step ("AGENT REPORTED",
  "WHY IT COUNTS AS FRICTION") and the list headers.
- **Count** (700, 13px): the numbers in work-item boxes and friction rings.

### Named Rules
**The Stencil Once Rule.** The stencil face is the brand's and appears nowhere else.

## Layout

Every page is one centred column, at most 900px wide, under a sticky 52px header. The drawing
scales to the column; its line runs down the middle (450 of 900 drawing units).

- **The Workflow page** opens on the overview alone, centred on the first screen: one row per stage,
  then delivery, then after delivery. Scrolling brings in each stage's steps until the end of the
  line reaches the middle of the screen; the page stops there. A stage row jumps to its stage.
- **A work item's route** fits its whole route on the first screen, a 46-unit row per step. What a
  step opens sits right of the line under the step's name (from 53% of the column, 43% wide); the
  line keeps running beside it.
- **The lists** (work items, changes, complaints) are rows on dividers, with a quiet uppercase
  header; a row opens its detail under itself.
- Work items sit left of the line in one column of dots; problems sit right of it. The key floats
  small in the bottom-right corner. Plain native scrolling: no zoom, no snapping, no scroll-driven
  animation.

## Elevation & Depth

Flat. No shadows. Depth comes only from emphasis: the line and its marks in bone, everything
secondary in dim, what a work item has not reached in the not-yet colour, what it skipped faded to
under a third. The key and the short lists that open from a mark float on the translucent key
ground, still without shadow.

## Shapes

- **Stops on the line:** always = filled rounded square (18 units, 4 radius); if = hollow rounded
  square; Owner's approval = sand diamond; Drillmaster's review = a filled square inside a ring.
- **Work items:** a rounded box (22 high, fully rounded) holding a count, or one work item's number,
  left of a dot; always an aggregate on the Workflow page.
- **Friction:** an orange ring (28 across) with its count, right of the line.
- **Splits:** the line forks into smooth curves and joins again; only steps that are alternatives on
  the same input split.
- **Delivery:** a short bar across the line; after delivery the line continues dotted.
- **Controls:** the find box and the "deeper" buttons are pills with a hairline border.

## Components

### Stops, boxes and rings (the drawing)
- **Reached:** bone at full strength. **Skipped:** faded to 28%, the name dim, the reason under it
  ("skipped: only when kind is feature"). **Not reached:** at half strength on the not-yet line.
- **Doors:** a work-item box or a friction ring opens its work item, or a short list of them when
  it holds several; a stage row jumps to its stage; a step on a route opens what happened there.
- Every mark is reachable with Tab and a tap, and shows its explanation on focus as on hover, with
  a 2px bone focus ring.

### Tip
- **Style:** tip ground, tip text, 6px radius, 4px 12px padding, 13px 600; at most 40 characters
  wide; never under the pointer; hidden while scrolling.

### Key
- **Style:** key ground, a hairline rule border, 12px radius, 12px 16px padding; one swatch and word
  per symbol, sand and orange entries in their colour.
- **Rule:** a page lists only the symbols it draws.

### Header and navigation
- **Style:** the brand left; at the far end, a past moment ("20 Nov, 19:10 UTC · workflow 2.1.0"
  and "now") when the page shows one, the links to the other pages in bone and underlined, and the
  find box.
- **Find box:** a 96 by 30 pill; typing a work item's number and Enter opens it; "no #N" in sand
  when there is none.

### What opens under a step
- **Levels:** what happened (Owner's step-in first, then who passed it and what Agent reported),
  then the evidence (the rules Agent checked, the output the tool kept, in monospace), then every
  tool call in one line each. Each level is set off by a panel rule, and the next opens with a
  pill button: "the evidence ›", "every tool call · 3 ›".

### Lists
- **Rows:** 52px or more, 12px 16px padding, hover lift to 4% bone; a header row of labels.
- **Changes:** the measure before → after in tabular figures, the after number and the outcome word
  in the outcome's colour (significant olive green; below target and not significant sand;
  insufficient data dim); the outcome's basis in the explanation ("n = 3 · baseline 0.67 ± 0.47
  (SD)").
- **Complaints:** the tool in monospace, how often it was heard, its biggest problem in one plain
  line with its count; the step-ins no workflow step covers last, their count in orange.

## Do's and Don'ts

### Do:
- **Do** open each page on its answer, and let the detail come in as Owner scrolls or clicks.
- **Do** keep work items left of the line and problems right of it, on every screen.
- **Do** show work items as aggregate boxes with the count left of the dot, all dots in one column.
- **Do** give every symbol an explanation on hover and focus, and an entry in the key.
- **Do** open detail one level at a time: what happened, then the evidence, then everything.
- **Do** say conditions and verdicts in plain words, with the exact value in the explanation.
- **Do** draw from real recorded data, never hand-placed numbers.

### Don't:
- **Don't** zoom, snap, or drive animation from the scroll; Owner found it janky.
- **Don't** repeat the overview at the end of the page.
- **Don't** add a status sentence or other text where a symbol already says it (Owner: "present
  less").
- **Don't** use orange for anything but friction.
- **Don't** dress the screen in military costume: no camouflage, badges or stencil beyond the brand.
