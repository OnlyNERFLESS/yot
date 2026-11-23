---
name: YOT (Your Own Tasks)
description: An offline-first Tehran field app in the DigiDev world. Rail, full-bleed map with Google-Maps-style floating controls and a pull-up sheet; emerald on evergreen-black.
colors:
  evergreen-black: "#050f09"
  ink-soft: "#07170e"
  raised: "#0a1f12"
  raised-high: "#0d2818"
  text-white: "#ffffff"
  text-dim: "#cdcdcd"
  muted-grey: "#9a9a9a"
  hairline: "rgba(255, 255, 255, 0.1)"
  hairline-strong: "rgba(255, 255, 255, 0.18)"
  emerald: "#16db65"
  near-black-ink: "#020202"
  emerald-wash: "rgb(22 219 101 / 0.12)"
  danger-coral: "#ff6b6b"
  amber: "#f5b544"
  paper-white: "#ffffff"
  panel-mint: "#f4f8f6"
  raised-mint: "#eef4f0"
  raised-mint-high: "#e4eee8"
  text-evergreen: "#050f09"
  text-dim-light: "#1d2a22"
  muted-light: "#46524b"
  hairline-light: "rgba(2, 2, 2, 0.12)"
  hairline-strong-light: "rgba(2, 2, 2, 0.22)"
  sea-green: "#058c42"
  black-forest: "#04471c"
  sea-green-wash: "rgb(5 140 66 / 0.1)"
  danger-light: "#b3261e"
  warn-light: "#8a5a00"
  traffic-jam: "#ff5a4f"
  traffic-standstill: "#b0201a"
  alt-route-grey: "#7d8c83"
typography:
  display:
    fontFamily: "'Bricolage Grotesque Variable', 'Vazirmatn Variable', system-ui, sans-serif"
    fontSize: "clamp(32px, 5vw, 44px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "'Bricolage Grotesque Variable', 'Vazirmatn Variable', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Inter Variable', 'Vazirmatn Variable', system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
  body:
    fontFamily: "'Inter Variable', 'Vazirmatn Variable', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'Inter Variable', 'Vazirmatn Variable', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  numeric-hero:
    fontFamily: "'JetBrains Mono Variable', 'Vazirmatn Variable', ui-monospace, monospace"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  numeric:
    fontFamily: "'JetBrains Mono Variable', 'Vazirmatn Variable', ui-monospace, monospace"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  readout-label:
    fontFamily: "'Inter Variable', 'Vazirmatn Variable', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.06em"
rounded:
  control: "12px"
  surface: "16px"
  pill: "999px"
spacing:
  hair: "4px"
  tight: "6px"
  sm: "8px"
  control-gap: "10px"
  md: "12px"
  stack: "14px"
  lg: "16px"
  card: "20px"
  xl: "24px"
  page-top: "32px"
components:
  button-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.near-black-ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "44px"
  button-primary-light:
    backgroundColor: "{colors.sea-green}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "44px"
  button-go:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.near-black-ink}"
    rounded: "{rounded.control}"
    padding: "0 28px"
    height: "54px"
  input-field:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "46px"
  search-field:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.control}"
    padding: "10px 14px 10px 48px"
    height: "54px"
  chip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
    height: "34px"
  chip-selected:
    backgroundColor: "{colors.emerald-wash}"
    textColor: "{colors.emerald}"
    rounded: "{rounded.pill}"
  route-option:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
  route-option-selected:
    backgroundColor: "{colors.emerald-wash}"
    textColor: "{colors.emerald}"
    rounded: "{rounded.control}"
  rail:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.muted-grey}"
    width: "84px"
  rail-item-active:
    backgroundColor: "{colors.emerald-wash}"
    textColor: "{colors.emerald}"
    rounded: "{rounded.control}"
    width: "64px"
  deck:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.text-white}"
    padding: "16px 20px"
  card:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.surface}"
    padding: "20px"
---

# Design System: YOT (Your Own Tasks)

## Overview

**Creative North Star: "The Instrument Deck"**

YOT is the DigiDev world (digidev.pro) extended into a field tool: an evergreen-black ground, one emerald accent, Bricolage Grotesque over Inter, and JetBrains Mono for every measured number. The frame (revised 2026-11-22 at the user's request, "like Google Maps"): a navigation rail on the left and a full-bleed map, with the familiar maps-app arrangement on top of it. A floating search pill with a row of category chips, round floating buttons (compass, layers, my location), and a pull-up sheet with three heights that becomes a floating side panel on wide screens. The arrangement is Google's; the materials stay DigiDev's.

The system is built to be read in half a second from a car seat. Density is low and targets are large (44px minimum, 54px for the deciding controls). Hierarchy comes from size and the mono face rather than from colour: the time and distance a reader needs are the biggest, heaviest marks on the deck, and the single emerald fill on screen is the next action (Start, Navigate). Depth is tonal, four evergreen steps from ground to raised control, separated by hairlines.

The light theme is the same object in daylight: a white ground, mint-tinted panels, and the accent deepened to sea-green with black-forest for accent text, so contrast holds in direct sun. Persian is a first-class script: Vazirmatn leads every stack under `lang="fa"`, layout mirrors with logical properties, and Persian names sit beside English rather than replacing it.

**Key Characteristics:**
- Rail (84px) + full-bleed map + floating search/chips/buttons + pull-up sheet (side panel from 900px); upright phones turn the rail into a bottom bar.
- One emerald accent per theme; amber and red belong to traffic and warnings.
- Every number in JetBrains Mono with tabular figures.
- Tonal depth: four evergreen surface steps and hairline borders.
- Large, glanceable targets; nothing over the map but the map.

## Colors

A near-monochrome evergreen field carrying a single emerald voice, with amber and red reserved for state.

### Primary
- **Emerald** (`emerald`): the dark-theme accent. The one filled action per view (Start, Navigate), the active rail item's text, the selected route option's ETA, focus outlines, checkbox fill, caret and text selection, the select chevron, the YOT wordmark dot, and the route line on the map in both themes.
- **Sea-Green** (`sea-green`): the light-theme accent fill. Primary buttons, focus rings and selection in daylight.
- **Black-Forest** (`black-forest`): light-theme accent *text* (active rail label, selected ETA, chips), and in both themes the casing under the emerald route line.
- **Emerald Wash** (`emerald-wash`, light: `sea-green-wash`): the selected state's ground. Active rail item, selected route option, selected chip, the inline toast, the focus halo on fields, the live-lamp ring.

### Neutral
- **Evergreen-Black** (`evergreen-black`): page and map ground in dark. Also the ring around place pins and the fill of the inverse start pin.
- **Ink-Soft** (`ink-soft`): the rail, the deck and cards. The "instrument" surface.
- **Raised** (`raised`) and **Raised High** (`raised-high`): controls, fields, option tiles; raised-high for the selected segment and count badges.
- **Text White / Text Dim / Muted Grey** (`text-white`, `text-dim`, `muted-grey`): primary copy, secondary copy (instructions, Persian names), and labels, placeholders, idle rail items.
- **Hairline / Hairline Strong** (`hairline`, `hairline-strong`): section rules and panel edges / control borders and the deck's top edge.
- **Light theme neutrals** (`paper-white`, `panel-mint`, `raised-mint`, `raised-mint-high`, `text-evergreen`, `text-dim-light`, `muted-light`, `hairline-light`, `hairline-strong-light`): the same roles, one for one.

### State
- **Danger Coral** (`danger-coral`, light `danger-light`): overdue tasks, the recording badge and Record tool while recording, Stop, invalid date input.
- **Amber** (`amber`, light `warn-light`): status warnings and notes in the deck; on the map, slow traffic and the dashed recorded-trip track.
- **Traffic Jam / Standstill** (`traffic-jam`, `traffic-standstill`): map-only, heavier traffic grades.
- **Alt-Route Grey** (`alt-route-grey`): unselected alternative routes on the map, at 0.75 opacity.

### Named Rules
**The One Emerald Rule.** Each view carries one emerald fill: the next action. Everything else that is "on" says so with the wash plus an emerald border or emerald text, never a second solid emerald slab.

**The Amber Belongs to Traffic Rule.** Pins are never amber. Places are white pins on a ground-coloured ring, the start is the inverse (ground fill, white ring), the destination is the one emerald mark. Traffic draws only its slow and jammed grades (amber, red, dark red); free-flowing roads draw nothing.

**The Theme Pairs Rule.** Every colour role is defined twice and flips with `data-theme`. Never hardcode a dark value into a component; the light theme must remain AA in direct sunlight.

## Typography

**Display Font:** Bricolage Grotesque Variable (Vazirmatn Variable, system-ui)
**Body Font:** Inter Variable (Vazirmatn Variable, system-ui)
**Label/Mono Font:** JetBrains Mono Variable (Vazirmatn Variable, ui-monospace)
**Persian:** under `lang="fa"`, Vazirmatn Variable leads the body and display stacks; Latin faces have no Arabic-script glyphs.

**Character:** A characterful grotesque for the few headings, a quiet Inter for reading, and a monospace that turns every time, distance and date into an instrument readout.

### Hierarchy
- **Display** (700, clamp(32px, 5vw, 44px), 1.05, -0.03em): page titles on Home, Tasks, Settings ("Today").
- **Headline** (650, 18px, -0.01em): section heads within a page, with an inline count badge where relevant.
- **Title** (600, 19px; 17px under 860px): the turn instruction in navigation, in text-dim.
- **Body** (400, 16px, 1.45): all reading copy. Fields stay at 16px minimum so mobile browsers never zoom on focus; the search field and add-task field run at 17px.
- **Label** (500, 13px): field labels, option sources, pills, chips. Rail labels at 11.5px.
- **Numeric Hero** (mono 700, 36px, line-height 1; 30px under 860px): the distance to the next manoeuvre. Route-option ETAs at 26px (22px on phones).
- **Numeric** (mono 700, 20px): navigation readouts (left, route, arrive). Smaller mono at 12-13px for status lines, task dates and trip stats.
- **Readout Label** (12px, uppercase, 0.06em): the term above a navigation readout value. Data labels only.

### Named Rules
**The Measured Number Rule.** Every measured quantity (ETA, distance, clock, date, size, coordinate, count) is set in JetBrains Mono with tabular figures. Words stay in Inter; numbers never do.

**The Two Scripts Rule.** Persian dates and lists use the UI language's formatter and the Persian comma as separator; Persian place names render in Vazirmatn beside the English name, never instead of it.

## Layout

The shell is a two-column grid: an 84px rail (64px targets plus padding; 76px clipped the labels) and the main area. The Map screen fills main with the map. Over it: the search pill (52px, round) and a horizontally scrolling chip row at the top (on wide screens the pill is 400px with the chips running beside it), round 48px floating buttons on the right, and the sheet. On phones the sheet snaps to 118px / 46vh / 86vh by dragging or tapping its handle; from 900px it is a 400px floating panel on the left (top 80px, bottom 16px). Navigation replaces both: a black-forest turn banner on top and an arrival bar at the bottom. Pages (Home, Tasks, Settings) scroll inside main with 32px/24px padding and a 760px reading column.

The deck's planning state keeps its Start row sticky at the deck's bottom edge, so the decision never scrolls out of reach. Route options lay out as auto-fit columns (min 190px); deck tools as auto-fit columns (min 150px). Turn-by-turn is a three-column grid: manoeuvre, readouts, Stop.

Responsive: under 860px the navigation grid collapses to two columns with readouts on their own row. Under 720px the deck pads 14px, tools become three equal columns with stacked icon and label, route options two columns, and Home's quick actions stack. Under 720px in portrait the rail becomes a bottom bar under everything (safe-area aware) so the map keeps its full width.

Spacing runs on small steps: 6px within tight rows, 8-10px between controls, 14px between deck blocks and cards, 16-20px for surface padding, 24-32px for page edges. RTL is handled entirely with logical properties (`inset-inline-start`, `border-inline-end`, `margin-inline`).

**The Maps-App Rule.** Controls float over the full-bleed map in the arrangement every maps user already knows: search and chips on top, round buttons on the right, details in the sheet. Nothing else covers the map. While navigating, 3D buildings drop to 45% opacity so a tower never hides the route or the car.

## Elevation & Depth

Depth is tonal first: ground, ink-soft, raised, raised-high, separated by hairlines. Shadows are few and ambient, used only where a surface sits against the moving map.

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 10px 30px rgb(0 0 0 / 0.45)`; light `0 10px 30px rgb(4 71 28 / 0.12)`): the recording badge floating on the map.
- **Deck lift** (`box-shadow: 0 -12px 30px rgb(0 0 0 / 0.25)`): the deck's upward cast onto the map's lower edge.
- **Focus halo** (`box-shadow: 0 0 0 3px` emerald wash): focused fields and the live lamp.
- **Inset seat** (`box-shadow: inset 0 0 0 1px` hairline-strong): the selected segment of a segmented control.

### Named Rules
**The Flat Instrument Rule.** Cards, options and buttons are flat at rest. Selection is shown with the wash and an accent border, never with a lifted shadow.

## Shapes

Two radii carry the system: gently rounded controls (12px) for buttons, fields, option tiles, rail items and list rows, and softer surfaces (16px) for cards. Fully round pills (999px) for chips, status pills, count badges and the recording badge. Circles mark state: the 7px wordmark dot, 8px lamps, 10px endpoint dots ringed in the accent-ink colour. Borders are 1px hairlines throughout. On Home, sections drop their card box entirely and read as one sheet divided by top hairlines.

## Components

### Buttons
Solid, quiet, large.
- **Shape:** gently rounded (12px), 44px minimum height; 34px for the small variant; 54px for the deck's deciding controls (Start, Stop).
- **Primary:** emerald fill with near-black ink (light: sea-green with white), weight 700. One per view.
- **Secondary:** raised fill, hairline-strong border, white text, weight 550.
- **Hover / Focus:** border turns to the accent; primary brightens 8%; press nudges down 1px. Focus is a 2px accent outline at 2px offset. Transitions 120-160ms.
- **Danger:** coral text, coral border on hover (Stop, delete).
- **Disabled:** 45% opacity, no press motion.

### Chips
- **Style:** pill, 34px high, raised fill, text-dim, 13px; used for one-tap dates under the date field.
- **State:** selected takes the wash, an accent border and accent text.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** ink-soft with a hairline border, 20px padding.
- **Shadow Strategy:** none (see Flat Instrument Rule).
- **Home variant:** no box, no fill; a top hairline and vertical padding only.

### Inputs / Fields
- **Style:** raised fill, hairline-strong border, 12px radius, 46px high, 16px text. Selects carry an emerald chevron and mirror it in RTL. Checkboxes are custom: 22px, 7px radius, emerald fill with an ink tick when checked.
- **Focus:** border turns accent with a 3px wash halo; no outline.
- **Error:** border turns danger (`aria-invalid`).
- **Date field:** the app's own fixed day/month/year input sized to 10ch, with one-tap date chips beneath.

### Navigation
- **Rail:** ink-soft, 84px, YOT wordmark (Bricolage 800, 22px, emerald dot) above stacked icon-over-label items (24px icons, 11.5px labels). Idle items muted; hover raises; active takes the wash and accent text.
- **Mobile:** under 720px portrait, the same items in a bottom bar with a top hairline; the wordmark hides.

### Segmented Control
A raised track (14px radius, 4px padding) of transparent buttons; the selected segment sits on raised-high with an inset hairline and an accent icon. Used for travel mode (Car, Motorcycle, Walk) and settings choices.

### Route Option (signature)
A raised tile: ETA in mono at 26px, distance in mono beneath, source line with a lamp ("Neshan · live traffic"). Selected: wash ground, accent border, accent ETA. Laid out as equal columns under the endpoints and mode switch, with the sticky Start row beneath.

### Turn-by-Turn Deck (signature)
A 64px emerald turn arrow (52px under 860px), the distance to the manoeuvre in mono at 36px, the instruction in text-dim at 19px; then three readouts (Left, Route, Arrive) with uppercase labels and mono values, Left in the accent; then Stop at 54px. A full-width offer strip (wash, accent border) can join beneath.

### Map Overlays
Emerald route (7px) on a black-forest casing (11px), round caps and joins; unselected alternatives in alt-route grey at 6px. Place pins white on a ground ring, start pin inverse, destination emerald and largest (9px). Own position: emerald dot with a white 3px ring over a 14% emerald accuracy circle. The basemap is DigiDev-tinted per theme: evergreen earth, deep-green parks, blue-black water in dark; mint grounds in light.

## Do's and Don'ts

### Do:
- **Do** keep the frame: rail left (84px), full-bleed map, floating search pill + chips, round buttons, pull-up sheet (side panel when wide); bottom bar on upright phones.
- **Do** set every measured number in JetBrains Mono with tabular figures.
- **Do** keep one emerald fill per view; show other "on" states with the wash and an accent border.
- **Do** define every colour for both themes and use the light accent pair (sea-green fill, black-forest text) in daylight.
- **Do** keep touch targets at 44px minimum and the deck's deciding controls at 54px.
- **Do** use logical properties so Persian mirrors cleanly, and lead with Vazirmatn under `lang="fa"`.
- **Do** keep Persian names visible beside English in search results and labels.

### Don't:
- **Don't** add floating controls beyond the search pill, chips, the round buttons and the sheet; the map stays readable.
- **Don't** use amber or red for anything but traffic, warnings, danger and the recorded track; never for pins.
- **Don't** draw free-flowing traffic; only slow and jammed grades appear.
- **Don't** lift selected cards or options with shadows; selection is tonal.
- **Don't** drop field text below 16px; mobile browsers zoom on focus.
- **Don't** use Bricolage or Inter for Persian text; they have no Arabic-script glyphs.

## Revisions from the 2026-11-22 critique (25/40)

These are system rules now, not one-off fixes.

- **The Driver View Rule.** Every destination (place card, dropped pin, planned route) offers *Show driver*: a full-screen white card with the Persian name at clamp(40px, 11vw, 88px) in Vazirmatn, the Persian address or "نزدیک <street>" under it, the distance in Persian digits, screen kept awake, closed by a 56px Done or Escape. A driver reads it from the front seat; nothing else competes on that screen.
- **Offline is a strength, not a warning.** Offline routes say "works without internet"; the offline lamp is a muted emerald (`.lamp.device`), never grey or amber. Amber is reserved for genuine problems.
- **Notes have three kinds.** `.note.info` (neutral), `.note.ok` (emerald wash: saved, copied), `.note.warn` (amber border). Errors are written for people via `humanError()`; the raw text lives behind a *Details* disclosure. Arrival is a success state (green tick, "You have arrived", Done / Save place), never a note.
- **Every list has three states.** Loading (shimmer rows / route skeletons), empty (bold "No matches." plus what to try), and results. Silence is never a state.
- **Choices are capped.** Four category chips in the field agent's order (Fuel, ATM, Pharmacy, Hotel) plus *More*, which opens the full grid in the sheet; on phones under 440px Hotel moves into More so More is always visible. Place cards show Directions, Show driver and Save; Call, Copy location and Start here sit under the "…" button.
- **Targets.** 44px floor for every control; 52px for the round map buttons and anything used while driving; the sheet handle is a 44px strip.
- **Pick mode is one line.** Choosing a route end on the map collapses the sheet to "Choose your start on the map · Cancel"; Start only appears once there is an origin.
- **Navigation stays legible.** 3D buildings turn off while navigating; the banner adds the next street name in English and Persian; the phone tab bar hides; only manoeuvre changes are announced to screen readers.
- **Motion.** The sheet slides with `transform` (no layout animation); `prefers-reduced-motion` removes sliding, shimmer and pulses, and map camera moves use zero duration.

## Button system (2026-11-22)

- **Shape carries meaning.** 14px rounded rectangles *do* things (Start, Save, Done); pills *filter* (category chips, small secondary actions in a card's More row); circles *float over the map* (layers, compass, my location) or head an icon action.
- **Three sizes.** `sm` 36px (chips), default 44px, `lg` 52px for decisions (Start, Show driver, Done). Map buttons 50px, card action icons 52px.
- **Three variants.** Primary: emerald fill, black label, inner top highlight and a soft emerald drop. Tonal (default): `--btn-tonal` fill with a hairline edge, readable in sunlight without heavy borders. Ghost: no fill, for Cancel.
- **Place cards use an action row**: four equal icon-over-label actions (Directions as the filled emerald circle, then Show driver, Save, More). Never a wrapping row of pills.
- **Press feedback.** `scale(0.97)` over 160ms `cubic-bezier(0.23, 1, 0.32, 1)` on every button; 0.95 for action icons, 0.94 for map circles. Hover styles only under `(hover: hover) and (pointer: fine)`. Reduced motion removes the scale.
- **Rim buttons (supersedes the tonal/primary fills above, user direction 2026-11-22).** Buttons are thin and black (`--rim-fill`, white in light theme) with a 1.5px gradient green border drawn as a `border-box` gradient behind a `padding-box` fill (`--rim`: emerald → dark evergreen → emerald). Sizes: 40px default, 44px `lg`, 34px `sm`; 12-13px corners; 14-16px side padding. Primary differs only by an emerald label and a faint glow. Hover (mouse only) swaps to `--rim-hot`, a fully lit rim with a soft emerald glow, and turns the label emerald. Recording swaps the rim to red. This is the DigiDev "black with a green rim".

## Obsidian & Emerald (2026-11-22, user direction; supersedes the evergreen grounds above)

- **Palette.** Grounds are near-neutral obsidian blacks: `--bg #060708`, `--panel #0c0e10`, `--raised #121417`, `--raised-2 #181b1e`; text `#f2f5f3`, muted `#8f9a95`. Emerald `#16db65` (text tone `#2ee27a`) is the only colour. Light theme: white panels on `#f6f7f7`, emerald deepened to `#058c42`.
- **The map is obsidian too**: neutral black land and roads, a whisper of green in parks, blue-black water, so the emerald route and pins are the only saturated marks.
- **One rim language for everything interactive.** Search pill, chips, map buttons, card action icons, endpoints, route options, travel modes, inputs, layer tiles, the nav rail and the navigation banner all wear a 1.5px gradient rim (`--rim`, or the quieter `--rim-soft` for large/dense surfaces) over an obsidian fill. **Lit** = `--rim-hot` plus `--glow` and an emerald label: selected, focused, current screen, hovered (mouse only). No solid emerald slabs anywhere except the checked checkbox; the lit rim carries "on".
- **Panels** (cards, sheet, rail, nav bar) are obsidian with a faint `--rim-soft` edge instead of hard borders.
- **Light emerald glow** marks the live-status lamp and the wordmark dot: the only light on black.

## Metro and Calendar (2026-11-22)

- **Metro** reuses the map sheet. Line colours are the operator's own, and they are the only saturated colours allowed besides emerald, because riders match them to station signs. Each leg of a journey is a row with a 4px rule in that line's colour, its badge, the from → to stations, and the direction. Station names in the From/To pickers truncate with an ellipsis, and the line dots stay at the end of the row.
- **Calendar** grid starts on Saturday. Fridays and fixed holidays are `#ff8f8f`, today has an inset emerald ring, and the selected day takes the lit rim. Emerald dots mark time reminders and amber dots mark place reminders.
- **Reminder editor** stacks in a single `minmax(0,1fr)` column so it fits a 320px phone. The time field is 168px because the native 12-hour field clipped its first digit at 130px. Segment labels never wrap.
- **The alert banner** is the only floating surface that is not anchored to the map. It drops in from the top over any screen, with a lit rim, Snooze 5/15/60, and Go there when the reminder has a place.

## Logo, gradients, quick add (2026-11-22)

- **Logo**: the NM monogram in a mint ring, transparent PNG. It appears in the rail above the wordmark, beside the Home title, on the splash and, on an obsidian rounded square, as the app icon. Do not recolour it.
- **Gradients are emerald only** (the user's choice, over the logo's cyan). Pages get a soft radial emerald light from the top-right corner, titles fade from white to emerald, panels carry a faint emerald sheen in the top corner, and primary buttons and the current tab are filled with an emerald gradient that deepens towards the bottom, inside the lit rim.
- **Quick add** is the primary action on Home, Calendar and Tasks: one textarea, one item per line, with a live numbered preview showing what each line was read as. Bottom sheet on phones, centred card elsewhere.
- **Metro mode** shows the network on the plain background, with no search bar and no layers button. The first view frames the 5th to 95th percentile of stations, so Line 1's airport branch cannot shrink the core.

## Home: today at a glance (2026-11-22)

- **Hero card**: the day number large, in the display face with a white-to-emerald gradient. Beside it are the weekday, the month and the date in the other calendar. Three stat tiles (Reminders, Tasks, Overdue) each carry an icon tile; Overdue turns amber only when it is above zero. A "Next" strip shows the time, the title and how long until it. A day bar fills with the hours that have passed, with a tick for each timed reminder (white ahead, dim green done).
- **Timeline**: times in JetBrains Mono, an icon tile per item on a vertical emerald thread (a bell, an amber pin for place reminders, a sun for all-day), titles in the display face, and tags for repeat and place. Past items fade and are struck through, and a red "Now" line sits between past and upcoming.
- **Anytime today** lists the tasks that are due or overdue. Each has a round tick button that completes it on the spot, an amber flag for high priority, and a "Late" tag.
- **Later this week** uses day tiles (weekday over date number). Trips and offline maps sit side by side as small icon cards.
- **Fonts**: Bricolage Grotesque for the day, numbers and titles; JetBrains Mono for clock times so they line up; Inter for body text. Persian uses Vazirmatn throughout, with years written without digit grouping.

## Route search animation (2026-11-22, Map screen only)

When the user asks for directions, the router's own search is played back. Thin threads branch from the start along real streets and highways (the order in which `route_explore` reached each segment) and spread like mycelium until the bright growing edge touches the destination. Then the web fades, the camera frames the route, and the chosen route draws itself in. There are no dots anywhere, only lines.

- **Colour**: settled threads are deep emerald with a soft halo. Fresh growth gets three strokes: a wide green bloom, a tighter bright one, and a mint core. The drawn route runs from deep `#05803c` at the start to `#16db65` and a mint `#8dffbd` at its leading end, under a 26 px blurred halo.
- **Smoothness**: the web is drawn on two canvases over the map, and each frame strokes only the newly revealed segments. The fresh-glow canvas fades a little every frame, which leaves bright tips and a dim web behind them. Nothing in MapLibre re-tiles during the show. The route itself is a map layer animated with `line-gradient`.
- **Timing**: growth takes 1.4 to 2.8 s depending on how many streets were searched. The reveal starts once the growth arrives, and the real route layers fade in under the drawn one, so there is no seam. Reduced motion skips the whole show.
- **Never in Metro**, and never while navigating.
- **Screen changes**: each screen fades and rises in over 280 ms. Switching between Map and Metro cross-fades the shared map.
