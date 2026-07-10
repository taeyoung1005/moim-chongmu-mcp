# Moim Coordinate Web Vote Design System

## 1. Atmosphere & Identity

모임좌표 웹 투표 화면은 카카오톡 링크에서 바로 열리는 조용한 조율 도구다. 서명은 밝은 종이 같은 배경 위에 부드러운 초록 액센트와 갭으로 분리된 둥근 시간 셀을 올리고, 카드를 은은한 그림자로 살짝 띄워 따뜻하고 친근하게 만드는 것이다. 사용자는 설명을 읽는 대신 이름과 임시 비밀번호를 입력하고 가능한 시간을 체크한 뒤 저장한다. 결과는 모든 참여자가 응답한 뒤에만 열린다.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Surface/primary | `--bg` | `#f7f8f5` | n/a | Page background |
| Surface/elevated | `--panel` | `#ffffff` | n/a | Form and summary panels |
| Text/primary | `--ink` | `#17201c` | n/a | Headings and body |
| Text/secondary | `--muted` | `#66746c` | n/a | Hints and metadata |
| Border/default | `--line` | `#e6ece6` | n/a | Panel and slot borders (hairline) |
| Accent/primary | `--accent` | `#13795b` | n/a | Links, checkbox accent, primary button |
| Accent/hover | `--accent-strong` | `#0d5d46` | n/a | Primary button hover |
| Accent/soft | `--accent-soft` | `#eef5ef` | n/a | Slot hover |
| Accent/on | `--on-accent` | `#ffffff` | n/a | Text on primary button and high-density heat cells |
| Heat/empty | `--heat-0` | `#f2f6f2` | n/a | Zero-overlap matrix cells |
| Heat/low | `--heat-1` | `#dbeee4` | n/a | Low-overlap matrix cells |
| Heat/mid | `--heat-2` | `#add8bf` | n/a | Mid-overlap matrix cells |
| Heat/high | `--heat-3` | `#62b985` | n/a | High-overlap matrix cells |
| Heat/full | `--heat-4` | `#13795b` | n/a | Full-overlap matrix cells |
| Status/success | `--ok` | `#e8f6ef` | n/a | Saved confirmation |
| Status/error | `--bad` | `#fff0ee` | n/a | Submission errors |
| Status/error text | `--bad-text` | `#a33a2d` | n/a | Error text |
| Status/neutral | `--neutral` | `#eef2ee` | n/a | Missing responder alert |

### Rules

- Accent is reserved for interaction and saved states.
- Backgrounds stay warm-neutral so dense slot grids remain readable in mobile webviews.
- No decorative gradients or floating color blobs.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|---|---:|---:|---:|---:|---|
| H1 | 32px desktop / 26px mobile | 700 | 1.2 | 0 | Board title |
| H2 | 15px | 700 | 1.4 | 0 | Day headings and section titles |
| Body | 16px | 400 | 1.5 | 0 | Form controls and page copy |
| Label | 13px | 700 | 1.4 | 0 | Field labels |
| Eyebrow | 12px | 700 | 1.3 | 0 | Product label |

### Font Stack

- Primary: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: not used.

### Rules

- Body text never drops below 13px.
- Korean labels must fit without negative tracking.

## 4. Spacing & Layout

### Base Unit

All spacing uses a 4px base.

| Token | Value | Usage |
|---|---:|---|
| `--space-0` | 0 | Reset spacing |
| `--space-1` | 4px | Base unit |
| `--space-1-5` | 6px | Fine list rhythm |
| `--space-2` | 8px | Slot inner gaps |
| `--space-2-5` | 10px | Day heading gap |
| `--space-3` | 12px | Day panel padding |
| `--space-3-5` | 14px | Mobile panel and alert padding |
| `--space-4` | 16px | Default panel and form rhythm |
| `--space-4-5` | 18px | Submit top spacing |
| `--space-5` | 20px | Desktop panel padding |
| `--space-5-5` | 22px | Ordered-list indentation |
| `--space-8` | 32px | Desktop page top padding |
| `--space-9` | 36px | Mobile page bottom padding |
| `--space-12` | 48px | Desktop page bottom padding and submit height |

### Grid

- Max content width: 920px.
- Page gutter: 32px desktop, 20px mobile.
- Vote matrix columns: sticky 62px time column plus 84px date columns in a horizontal scroll container.
- Component dimensions: `--control-height` 46px, `--submit-height` 52px, `--vote-cell-height` 46px, `--vote-cell-width` 84px.
- Cell separation: `--gap-cell` 6px gap between grid cells (no inter-cell borders); grid containers carry `--gap-cell` inner padding.
- Result matrix dimensions: `--time-column-width` 62px, `--date-column-width` 86px, `--matrix-cell-height` 42px.

### Rules

- The first viewport must show title, status, participant field, and the top of the availability matrix.
- Vote cell dimensions are stable so dragging does not shift the grid.

## 5. Components

### Vote Panel

- **Structure**: `form.panel` containing participant name input, temporary password input, availability matrix, optional note, submit button.
- **Variants**: default, compact summary panel.
- **Spacing**: `--space-5` desktop padding, `--space-3-5` mobile padding.
- **States**: default, success alert, error alert.
- **Accessibility**: native form fields, labels wrap inputs, submit is a real button.
- **Motion**: hover state only; no layout animation.

### Temporary Password Field

- **Structure**: participant text input, password input, and a short helper line.
- **Variants**: first-save registration, later verification, error.
- **Spacing**: field rhythm uses `--space-4`, helper pulls up by `--space-2`.
- **States**: empty browser-required state, wrong-password error alert.
- **Accessibility**: native password input with label and autocomplete.
- **Motion**: none.

### Vote Matrix Cell

- **Structure**: label cell in a date-column/time-row matrix, wrapping a visually hidden native checkbox.
- **Variants**: unchecked, checked/selected, hover, dragging.
- **Spacing**: 46px minimum cell height, 84px date column width.
- **States**: default, hover, checked, focus through native checkbox, pointer-drag selecting, pointer-drag clearing.
- **Accessibility**: entire cell is clickable through label; native checkbox remains in the DOM for form submission and fallback.
- **Interaction**: pointer drag starts from the first touched cell; dragging across cells applies that same select or clear state continuously, matching when2meet-style fast entry.
- **Motion**: 120ms color transition only.

### Overlap Matrix

- **Structure**: a best-time chip row followed by a matrix with sticky time labels, date columns, and count cells.
- **Variants**: locked until all participants respond, empty `0/n`, partial, full.
- **Spacing**: best chips use `--space-2`; matrix cells are 42px high with 86px date columns.
- **States**: read-only summary.
- **Accessibility**: each cell keeps `count/participantCount` visible as text and exposes available participant names via `title`.
- **Motion**: none.
- **Responsive**: the matrix keeps date/time geometry and scrolls horizontally on narrow webviews.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|---|---:|---|---|
| Micro | 120ms | ease-out | Hover color changes, input focus ring |
| Press | 120ms | ease-out | Primary button active nudge (`translateY(1px)`) |

### Rules

- No JavaScript-driven motion.
- Native form behavior remains available in restrictive in-app browsers.
- Reduced-motion users receive the same static experience.

## 7. Depth & Surface

### Strategy

Soft cards: hairline borders plus a low, diffuse shadow to lift surfaces, with generously rounded corners. Grids read as gapped rounded cells rather than hard ruled tables. Accent stays reserved for interaction and saved states, so the warmth comes from radius, spacing, and shadow — not extra color.

| Type | Value | Usage |
|---|---|---|
| Default border | `1px solid var(--line)` (hairline `#e6ece6`) | Panels, headers, fields, cells |
| Radius | `--radius-panel` 16px / `--radius-control` 12px / `--radius-cell` 10px / `--radius-pill` 999px | Rounded and friendly; pill for the primary button and best-time chips |
| Shadow (soft) | `--shadow-soft` `0 1px 2px rgba(23,32,28,.05), 0 10px 28px rgba(23,32,28,.06)` | Header, panels, scroll containers, chips |
| Shadow (button) | `--shadow-btn` `0 8px 20px rgba(19,121,91,.22)` | Primary submit button lift |
| Cell separation | `--gap-cell` 6px gap, no inter-cell borders | Vote grid + overlap matrix |

Full-bleed exception: on narrow webviews the vote grid and overlap matrix drop their radius and shadow and bleed to the screen edges for maximum horizontal room.
