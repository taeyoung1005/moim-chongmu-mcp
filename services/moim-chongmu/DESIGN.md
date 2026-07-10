# Moim Coordinate Web Vote Design System

## 1. Atmosphere & Identity

모임좌표 웹 투표 화면은 카카오톡 링크에서 바로 열리는 조용한 조율 도구다. 서명은 밝은 종이 같은 배경 위에 얇은 초록 액센트와 조밀한 시간 슬롯을 올리는 것이다. 사용자는 설명을 읽는 대신 이름과 임시 비밀번호를 입력하고 가능한 시간을 체크한 뒤 저장한다. 결과는 모든 참여자가 응답한 뒤에만 열린다.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Surface/primary | `--bg` | `#f7f8f5` | n/a | Page background |
| Surface/elevated | `--panel` | `#ffffff` | n/a | Form and summary panels |
| Text/primary | `--ink` | `#17201c` | n/a | Headings and body |
| Text/secondary | `--muted` | `#66746c` | n/a | Hints and metadata |
| Border/default | `--line` | `#dfe6df` | n/a | Panel and slot borders |
| Accent/primary | `--accent` | `#13795b` | n/a | Links, checkbox accent, primary button |
| Accent/hover | `--accent-strong` | `#0d5d46` | n/a | Primary button hover |
| Accent/soft | `--accent-soft` | `#eef5ef` | n/a | Slot hover |
| Accent/on | `--on-accent` | `#ffffff` | n/a | Text on primary button |
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
- Slot columns: `repeat(auto-fit, minmax(160px, 1fr))`, collapsing to one column under 520px.
- Component dimensions: `--control-height` 44px, `--slot-height` 38px, `--checkbox-size` 18px, `--slot-column-min` 160px.
- Heatmap dimensions: `--heat-label-width` 48px, `--heat-count-width` 40px.

### Rules

- The first viewport must show title, status, participant field, and at least the first day of slots.
- Slot height is stable at 38px minimum.

## 5. Components

### Vote Panel

- **Structure**: `form.panel` containing participant name input, temporary password input, day grid, optional note, submit button.
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

### Slot Cell

- **Structure**: label wrapping checkbox and time text.
- **Variants**: unchecked, checked, hover.
- **Spacing**: `--space-1-5` vertical / `--space-2` horizontal.
- **States**: default, hover, checked, focus through native checkbox.
- **Accessibility**: entire row is clickable through label.
- **Motion**: none.

### Overlap Heatmap

- **Structure**: date section containing time label, horizontal fill bar, and count.
- **Variants**: locked until all participants respond, empty `0/n`, partial, full.
- **Spacing**: rows use `--space-2`; bar height uses `--space-3`.
- **States**: read-only summary.
- **Accessibility**: count remains visible as text beside the bar.
- **Motion**: none.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|---|---:|---|---|
| Micro | 120ms | ease-out | Hover color changes |

### Rules

- No JavaScript-driven motion.
- Native form behavior remains available in restrictive in-app browsers.
- Reduced-motion users receive the same static experience.

## 7. Depth & Surface

### Strategy

Mixed, leaning borders-only.

| Type | Value | Usage |
|---|---|---|
| Default border | `1px solid var(--line)` | Panels, day groups, fields |
| Radius | 8px panel / 6px control | Friendly but not pill-like |
| Shadow | none | Avoid card-heavy marketing feel |
