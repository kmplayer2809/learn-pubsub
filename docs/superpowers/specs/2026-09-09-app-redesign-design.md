# App redesign: theme tokens, chrome, canvas, transport

Date: 2026-09-09
Status: approved for planning

## Goal

Redesign lại giao diện Broker Visualizer ở tầng thị giác và bố cục: thay hệ màu
numeric hiện tại bằng một tầng token ngữ nghĩa chạy được cả **light lẫn dark**,
sửa những chỗ bố cục đang làm hỏng việc học (canvas trống 85%, node không đọc
được ở mobile, thanh tua không có mốc, panel phẳng không phân tầng), và thống
nhất chrome giữa ba breakpoint.

Không thêm tính năng mới. Không đụng kernel, engine, lesson copy, hay
`BrokerModule` contract.

## Hiện trạng và vấn đề đã đo

Quan sát trên app đang chạy (Playwright, 1440×900 và 390×844) cộng với đọc code:

| # | Vấn đề | Bằng chứng |
|---|---|---|
| 1 | Canvas ~860×790px chứa 4 node nhỏ, ~85% diện tích trống | ảnh desktop |
| 2 | Mobile 390px: `fitView` co zoom xuống ~0.4, chữ 12px hiển thị ~5px, không đọc nổi | ảnh mobile |
| 3 | 17 lesson là danh sách phẳng, không đánh số, group header trôi khi cuộn | `LessonSidebar.tsx` |
| 4 | Panel và canvas cùng `bg-ink-950`, chỉ khác nhau ở `border-ink-800/80` — không có phân tầng độ nổi | `DesktopLayout.tsx` |
| 5 | Type scale ép hết xuống `text-xs` / `text-[10px]` / `text-[11px]`; narrative tiếng Việt đọc ở 12px | `Inspector.tsx`, `LessonSidebar.tsx` |
| 6 | Thanh tua không có mốc sự kiện, không tô phần đã chạy, không hiện tổng thời lượng | `Transport.tsx` |
| 7 | Không có light mode; không có font riêng (dùng font hệ thống) | `index.css` |
| 8 | Desktop không có `TopBar`, mobile/tablet có — chrome lệch nhau giữa ba layout | `layouts/*.tsx` |
| 9 | Edge trên canvas không có mũi tên chỉ hướng | ảnh desktop, `toEdges` |

Vấn đề #2 có nguyên nhân trực tiếp trong `CanvasView.tsx`: `FIT_VIEW_OPTIONS`
chỉ có `padding: 0.15`, không có sàn zoom, nên `fitView` co bao nhiêu cũng được
miễn là vừa khung; `minZoom={0.25}` cho phép co tới mức đó.

## Quyết định đã chốt với người dùng

- Phạm vi: **visual + layout**, không thêm feature.
- **Có light mode**, mặc định theo `prefers-color-scheme`, người dùng bấm toggle
  thì ghi đè và lưu `localStorage`.
- Node color của từng broker (`src/brokers/*/ui/`) **nằm trong scope** — khác với
  spec `2026-09-05-shell-restyle` chỉ giới hạn ở `src/shell/`.
- Desktop và mobile **ưu tiên ngang nhau**.

## Kiến trúc token: ba tầng

Tailwind không thể đổi theme bằng cách đảo thang số (`ink-900` ở dark là mặt nổi,
ở light phải thành một giá trị rất sáng — không map 1:1). Nên phải có tầng ngữ
nghĩa ở giữa.

### Tầng 1 — primitive: CSS variable trong `src/index.css`

Viết dạng ba kênh RGB, không phải `#hex`, để Tailwind opacity modifier
(`bg-surface/80`) còn dùng được qua cú pháp `<alpha-value>`.

```css
:root {                      /* light */
  --canvas: 226 232 240;
  --surface: 255 255 255;
  --surface-raised: 248 250 252;
  --surface-hover: 241 245 249;
  --border-subtle: 226 232 240;
  --border-strong: 203 213 225;
  --text-strong: 15 23 42;
  --text-body: 51 65 85;
  --text-muted: 100 116 139;
  --text-faint: 100 116 139;
  --accent: 2 132 199;
  --accent-hover: 3 105 161;
  --accent-fg: 255 255 255;
  --accent-soft: 224 242 254;
  --highlight: 192 38 211;
}

[data-theme='dark'] {
  --canvas: 2 6 23;
  --surface: 11 18 32;
  --surface-raised: 19 28 46;
  --surface-hover: 30 41 59;
  --border-subtle: 30 41 59;
  --border-strong: 51 65 85;
  --text-strong: 241 245 249;
  --text-body: 203 213 225;
  --text-muted: 148 163 184;
  --text-faint: 148 163 184;
  --accent: 56 189 248;
  --accent-hover: 125 211 252;
  --accent-fg: 2 6 23;
  --accent-soft: 12 74 110;
  --highlight: 232 121 249;
}
```

`--canvas` ở dark giữ đúng `#020617` hiện tại. `--surface` là giá trị **mới**:
panel được nhấc khỏi nền canvas, đó là thứ sửa vấn đề #4.

`--text-faint` cố ý đặt **bằng** `--text-muted` ở cả hai theme. Thang thiết kế có
bốn mức chữ, nhưng mức nhạt hơn không qua nổi ngưỡng tương phản. Đã tính tay:

| Cặp | Ratio | Kết luận |
|---|---|---|
| `#64748b` trên `#0b1220` (faint cũ, dark) | **3.95** | ✗ dưới 4.5 |
| `#94a3b8` trên `#0b1220` (muted, dark) | 7.39 | ✓ |
| `#64748b` trên `#f8fafc` (muted, light) | 4.55 | ✓ sát ngưỡng |

Mọi chỗ dùng `faint` đều là chữ 10–11px, không được hưởng ngoại lệ "large text"
của WCAG. Giữ tên token riêng để chỗ dùng vẫn diễn đạt đúng ý đồ thị giác, nhưng
giá trị bị kẹp lại ở ngưỡng đọc được. Bước 8 chạy script xác nhận lại toàn bộ
ma trận cặp màu, gồm cả cặp 4.55 sát ngưỡng ở trên.

### Tầng 2 — semantic: `tailwind.config.js`

```js
colors: {
  canvas: 'rgb(var(--canvas) / <alpha-value>)',
  surface: {
    DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
    raised: 'rgb(var(--surface-raised) / <alpha-value>)',
    hover: 'rgb(var(--surface-hover) / <alpha-value>)',
  },
  edge: {
    DEFAULT: 'rgb(var(--border-subtle) / <alpha-value>)',
    strong: 'rgb(var(--border-strong) / <alpha-value>)',
  },
  content: {
    strong: 'rgb(var(--text-strong) / <alpha-value>)',
    DEFAULT: 'rgb(var(--text-body) / <alpha-value>)',
    muted: 'rgb(var(--text-muted) / <alpha-value>)',
    faint: 'rgb(var(--text-faint) / <alpha-value>)',
  },
  accent: {
    DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
    hover: 'rgb(var(--accent-hover) / <alpha-value>)',
    fg: 'rgb(var(--accent-fg) / <alpha-value>)',
    soft: 'rgb(var(--accent-soft) / <alpha-value>)',
  },
  highlight: 'rgb(var(--highlight) / <alpha-value>)',
  role: { /* xem dưới */ },
}
```

`ink-*` và `accent-*` dạng numeric (thêm vào bởi spec 2026-09-05) **bị xoá hẳn**
sau khi migration xong. Để hai hệ song song là để lại một đường cho class chỉ
đúng ở một theme lọt vào codebase mà không ai thấy.

### Tầng 3 — role color cho node broker

Toàn bộ 11 loại node của cả ba broker đang theo đúng một công thức:

```
border-<hue>-500   bg-<hue>-950   text-<hue>-200   ring-<hue>-300   text-<hue>-400 (subtitle)
```

| hue | Node |
|---|---|
| `sky` | RabbitMQ publisher |
| `violet` | RabbitMQ exchange, Redis sentinel |
| `emerald` | RabbitMQ queue |
| `amber` | RabbitMQ consumer, Redis replica |
| `cyan` | Redis client |
| `rose` | Redis server |
| `blue` | Kafka broker |
| `teal` | Kafka partition |
| `orange` | Kafka consumer group |
| `pink` | Kafka consumer |
| `lime` | Kafka producer |

Chỉ **bg** và **fg** đổi theo theme, nên chỉ hai thứ đó thành var — 22 var:

```css
:root               { --role-sky-bg: 240 249 255; --role-sky-fg: 7 89 133;   /* 50 / 800 */ }
[data-theme='dark'] { --role-sky-bg: 8 47 73;     --role-sky-fg: 186 230 253; /* 950 / 200 */ }
```

`line` và `ring` **không** thành var: chúng giữ đúng một giá trị ở cả hai theme,
nên viết thẳng hex trong `tailwind.config.js`. Var chỉ tồn tại cho thứ thực sự
đổi; một var không bao giờ đổi giá trị chỉ thêm một tầng gián tiếp phải đi tra.

```js
role: {
  sky: {
    DEFAULT: 'rgb(var(--role-sky-bg) / <alpha-value>)',
    fg: 'rgb(var(--role-sky-fg) / <alpha-value>)',
    line: '#0ea5e9',  // hue-500
    ring: '#38bdf8',  // hue-400
  },
  /* … 10 hue còn lại, cùng shape … */
}
```

Ring đổi từ `hue-300` (hiện tại) sang **`hue-400`**: `-300` là sắc pastel, trên
nền `hue-50` của light theme nó gần như biến mất, mà ring là dấu hiệu duy nhất
cho biết node nào đang được chọn. `-400` đủ tương phản trên cả `hue-50` lẫn
`hue-950`. Đây là lý do 9 dòng assertion trong hai file test node phải sửa.

Class trong `nodes.tsx` thành `bg-role-sky border-role-sky-line text-role-sky-fg
ring-role-sky-ring`. Tên hue được giữ (không đổi thành `role-publisher`) vì một
hue phục vụ nhiều vai trò ở nhiều broker — `violet` vừa là exchange của RabbitMQ
vừa là sentinel của Redis.

### Token trạng thái và token tone

Hai nhóm nữa, phát hiện khi audit `CheckpointCard.tsx`, `Inspector.tsx` và
`canvas/geometry.ts`.

**Status** — `CheckpointCard` (đúng/sai), `IssuesList` (lỗi), `HaltedBanner`
(cảnh báo). Ba trạng thái, mỗi trạng thái ba var:

```css
:root {
  --ok-bg: 236 253 245;  --ok-line: 5 150 105;  --ok-fg: 6 95 70;      /* emerald 50/600/800 */
  --danger-bg: 255 241 242; --danger-line: 225 29 72; --danger-fg: 159 18 57; /* rose */
  --warn-bg: 255 251 235; --warn-line: 217 119 6;  --warn-fg: 146 64 14;      /* amber */
}
[data-theme='dark'] {
  --ok-bg: 2 44 34;      --ok-line: 5 150 105;  --ok-fg: 167 243 208;  /* emerald 950/600/200 */
  --danger-bg: 76 5 25;  --danger-line: 225 29 72; --danger-fg: 254 205 211;
  --warn-bg: 69 26 3;    --warn-line: 217 119 6;  --warn-fg: 253 230 138;
}
```

`line` giữ nguyên ở cả hai theme (giống `role-*-line`), nên viết hex thẳng trong
config, không thành var.

**Tone** — `TONE_FILL` trong `src/shell/ui/canvas/geometry.ts` là màu chấm message
bay trên canvas, dùng làm giá trị `fill`/`stroke` của SVG chứ không phải class.
Bốn hue hiện dùng `hue-400`. Trên nền canvas sáng `#e2e8f0`, `sky-400` chỉ đạt
tương phản **1.71** — dưới ngưỡng 3:1 cho thành phần đồ hoạ phi văn bản. Nên phải
đổi theo theme:

```css
:root               { --tone-sky: 2 132 199; --tone-emerald: 5 150 105; --tone-rose: 225 29 72; --tone-amber: 217 119 6; }  /* hue-600 */
[data-theme='dark'] { --tone-sky: 56 189 248; --tone-emerald: 52 211 153; --tone-rose: 251 113 133; --tone-amber: 251 191 36; } /* hue-400 */
```

`TONE_FILL` đổi giá trị từ hex sang chuỗi `'rgb(var(--tone-sky))'`. SVG
`fill`/`stroke` nhận được cú pháp này. `geometry.ts` nằm ở `src/shell/ui/`, ngoài
vùng `purity.test.ts` soi, nên không vướng ràng buộc determinism.

`stroke="#020617"` cứng trong `MessageLayer.tsx` (viền chữ nhãn message, cùng màu
canvas dark) đổi sang `rgb(var(--canvas))`.

### Theme plumbing

`data-theme` đặt trên `<html>`. Một script đồng bộ trong `<head>` của
`index.html` phải chạy **trước khi React mount**:

```html
<script>
  (function () {
    var saved = null
    try { saved = localStorage.getItem('theme') } catch (e) { /* Safari private mode */ }
    var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  })()
</script>
```

Không có script này thì trang vẽ một frame ở theme mặc định rồi mới nhảy — chớp
sáng vào mắt người dùng dark mode. `try/catch` là bắt buộc: `localStorage` ném
`SecurityError` ở Safari private mode và trang sẽ trắng nếu không bắt.

Store thêm `theme: 'light' | 'dark'` và `setTheme(t)`. `setTheme` ghi cả
`document.documentElement.dataset.theme` lẫn `localStorage`. Đây là field
nguyên thuỷ, không import component nào, nên không đụng vào chuỗi import mà
`store.importOrder.test.ts` canh.

## Typography

Font: **IBM Plex Sans** (sans) + **JetBrains Mono** (mono). Cả hai có subset
`vietnamese` đầy đủ dấu.

Self-host qua `@fontsource-variable/ibm-plex-sans` và
`@fontsource-variable/jetbrains-mono`, **không** link Google Fonts: app này là
teaching app chạy được offline, và một lần fetch font hỏng sẽ đẩy narrative tiếng
Việt về system font có metric khác hẳn. Chỉ import subset `vietnamese` +
`latin`, khoảng 120KB woff2.

Type scale, thay cho mớ `text-xs` / `text-[10px]` / `text-[11px]` rải rác:

| Token | Size / line-height | Dùng cho |
|---|---|---|
| `text-narrative` | 15px / 1.65 | thân narrative, giải thích checkpoint |
| `text-ui` | 13px / 1.5 | label, nút, tiêu đề lesson, node label |
| `text-meta` | 11px / 1.45 | metric key, timestamp, node subtitle |
| `text-code` | 12px / 1.5, mono | nhật ký sự kiện, routing key |
| `text-section` | 10px / 1, uppercase, tracking-wider | tiêu đề section (giữ nguyên như hiện tại) |

Khai báo trong `theme.extend.fontSize` để `text-narrative` mang sẵn line-height,
không phải nhớ ghép thêm class.

## Chrome

### TopBar chung cho cả ba breakpoint

Hiện desktop không render `TopBar` (vấn đề #8). Sau redesign cả ba layout đều
render, cao 48px, nền `bg-surface/95 backdrop-blur`, đáy `border-b border-edge`:

```
┌─ h-12 ─────────────────────────────────────────────────────────────┐
│ [☰]  ◆ Broker Visualizer  [RabbitMQ|Redis|Kafka]          [☀/☾]   │
└────────────────────────────────────────────────────────────────────┘
   ↑ chỉ tablet        ↑ brand chỉ desktop
```

- Desktop: brand + `BrokerSwitcher` bên trái, theme toggle bên phải.
- Tablet: hamburger + `BrokerSwitcher` trái, toggle phải.
- Mobile: `BrokerSwitcher` trái, tiêu đề lesson truncate ở giữa, toggle phải.
  Bỏ brand — 390px không đủ chỗ.

`hideBrokerSwitcher` của `LessonSidebar` giữ nguyên ý nghĩa và bây giờ **luôn**
được truyền `true`, vì cả ba layout đều có `TopBar` mang switcher. Prop không bị
xoá: nó vẫn là thứ ngăn hai broker picker sống cùng lúc, và giữ nó cho phép
render sidebar độc lập trong test.

### BrokerSwitcher → segmented control

Track `bg-surface-raised rounded-lg p-0.5`, tab đang chọn là pill
`bg-accent text-accent-fg rounded-md`. Bản hiện tại là ba nút rời chỉ khác nhau
màu chữ, đọc như ba link chứ không như một bộ chọn loại trừ.

### LessonSidebar

| Bây giờ | Sau |
|---|---|
| Group header cuộn trôi | `sticky top-0 bg-surface/95` — 17 lesson cuộn dài, mất ngữ cảnh nhóm |
| Active = `border-l-2` + nền mờ | Active = pill `bg-accent-soft text-accent rounded-md mx-2` |
| Không đánh số | Cột số mono `text-meta text-content-faint`, rộng 24px, `01`–`NN` theo số lesson của broker (RabbitMQ 17, Redis 17, Kafka 25) |
| Nút Sandbox là text trơn | Footer riêng có icon, `border-t border-edge` |
| `hover:bg-ink-900` gần như vô hình | `hover:bg-surface-hover` |

Bề rộng desktop 256 → **272px** (cột số cần chỗ). Nền `bg-surface`.

Số thứ tự đánh **liên tục toàn broker**, không reset theo group: người học nói
"bài 12" chứ không nói "bài 3 của nhóm reliability". Số suy ra từ vị trí trong
`broker.lessons`, không phải field mới trong `Lesson` — không đụng contract.

### Inspector: hai vùng thay vì một cột cuộn

Hiện tại năm section xếp dọc trong một vùng cuộn: narrative, checkpoint, issues,
chỉ số, nhật ký. Nhật ký luôn nằm dưới đáy, phải cuộn mới thấy — trong khi nó là
thứ thay đổi mỗi tick khi mô phỏng chạy.

```
┌─ aside w-96 ──────────────────────┐
│ NARRATIVE  (flex-1, cuộn riêng)   │
│   tiêu đề + thân + checkpoint     │
│   + IssuesList + HaltedBanner     │
├───────────────────────────────────┤
│ [Chỉ số] [Nhật ký] [Cấu hình]     │  h-8, role=tablist
│ ─────────────────────────────     │
│ nội dung tab (40% chiều cao,      │
│ cuộn riêng)                       │
└───────────────────────────────────┘
```

- Thân narrative giới hạn `max-w-[68ch]`.
- Tab **Cấu hình** `aria-disabled` khi chưa chọn node. Click node trên canvas thì
  tự chuyển sang tab đó; bỏ chọn node thì quay về **Chỉ số**.
- Hai vùng cuộn độc lập: đọc narrative không làm mất dấu nhật ký.

Việc "chọn node làm biến mất bảng chỉ số" ở bản hiện tại là một lần chuyển chế độ
ngầm. Tab hoá làm nó hiện rõ và cho phép xem lại chỉ số mà không phải bỏ chọn
node.

`SandboxPanel` của từng broker **không** bị ép vào cấu trúc tab này —
`SidePanel.tsx` vẫn chọn giữa `SandboxPanel` và `Inspector` y như cũ. Tab strip
là chuyện nội bộ của `Inspector`.

### Ba mức độ nổi

| Lớp | Token | Thành phần |
|---|---|---|
| Nền sâu nhất | `bg-canvas` | vùng React Flow |
| Panel | `bg-surface` | sidebar, aside, TopBar, Transport, StatePanel, drawer |
| Card trong panel | `bg-surface-raised border border-edge` | MetricsGrid, EventLog, CheckpointCard, IssuesList |

Đây là thứ tạo chiều sâu mà bản hiện tại không có.

### Bề rộng cột

| Breakpoint | Sidebar | Canvas | Aside |
|---|---|---|---|
| Desktop ≥1024 | 272 | còn lại | **384** (từ 320) |
| Tablet 768–1023 | drawer 272 | còn lại | **320** (từ 288) |

Narrative 15px trong 320−32=288px cho ~45 ký tự/dòng, dưới ngưỡng dễ đọc; 384px
cho ~58 ký tự. Canvas mất 64px nhưng đang thừa 85% diện tích.

Không giới hạn bề rộng tối đa ở màn siêu rộng: topology Kafka nhiều partition
dùng hết chỗ được cho.

## Canvas

### Sàn zoom

```ts
export const MIN_ZOOM = 0.25          // giữ nguyên: người dùng vẫn tự zoom xa được
export const READABLE_ZOOM = 0.75     // MỚI: sàn zoom cho fitView
export const FIT_VIEW_OPTIONS = {
  padding: 0.15,
  minZoom: READABLE_ZOOM,
  maxZoom: 1.2,
}
```

`minZoom` trong `FIT_VIEW_OPTIONS` chặn `fitView` co xuống dưới ngưỡng đọc được;
`maxZoom` chặn lesson hai node bị phóng to lố. `minZoom` prop của `<ReactFlow>`
giữ 0.25 để thao tác zoom tay không bị siết theo.

Hằng số này được dùng ở **cả ba chỗ** đang gọi fit: `fitViewOptions` lúc mount,
effect `ResizeObserver`, và effect theo `brokerId`/`lessonId` — đó là lý do
`FIT_VIEW_OPTIONS` tồn tại sẵn dưới dạng hằng, và lý do đó không đổi.

### Hệ quả: nội dung tràn khung, phải có chỉ dấu

Ở mobile, topology bốn node không còn vừa 390px. Đó là đánh đổi có chủ đích —
kéo ngang để đọc được tốt hơn nhìn bốn ô chữ 5px. Nhưng người dùng phải biết còn
nội dung ngoài khung:

- **MiniMap** (`<MiniMap/>` sẵn có của React Flow) góc dưới-phải, **chỉ desktop
  và tablet**. `aria-hidden` vì nó nhân bản canvas; screen reader đọc hai lần là
  nhiễu. Màu node lấy từ `--role-*-line`.
- **Mobile**: gradient fade 24px ở mép trái/phải khi viewport chưa phủ hết bounds.
  MiniMap không đặt ở mobile — 390px không có chỗ cho nó.

MiniMap là thành phần mới trên canvas, không thuần restyle. Nó có mặt vì chính
thay đổi sàn zoom ở trên tạo ra vùng tràn, và đã được người dùng duyệt cùng thay
đổi đó.

### Edge

Thêm `markerEnd` mũi tên cho `toEdges` của cả ba broker. Trong một app dạy luồng
message, hướng đi là thông tin cốt lõi và bản hiện tại không vẽ nó. Stroke đổi
sang `rgb(var(--border-strong))`, rộng 1.5px.

Nhãn routing key (`.react-flow__edge-text` / `-textbg` trong `index.css`) giữ
nguyên style mono, chỉ đổi hex cứng sang `rgb(var(--…))`.

### Background và Controls

`<Background>` dots gap 20 → 24, màu qua var. Ở light theme chấm phải nhạt hơn
nhiều so với dark, nếu không nó chọc vào mắt.

Sáu giá trị hex cứng của `.react-flow__controls-*` trong `index.css` đổi sang
`rgb(var(--…))`. **Giữ nguyên `!important`** — comment tại chỗ đã giải thích nó
chống lại `@xyflow/react/dist/style.css` được Vite phát ra sau file này, cùng
specificity nhưng source order muộn hơn. Đó không phải trang trí.

Tương tự, `.react-flow__handle::after` (vùng chạm 16px quanh handle 6px) giữ
nguyên hoàn toàn.

### Node

`SHELL` là hằng dùng chung — sửa một chỗ, cả 11 loại node đổi theo:

```ts
const SHELL = 'min-w-[124px] rounded-xl border px-3.5 py-2.5 shadow-node'
```

| | Bây giờ | Sau |
|---|---|---|
| Label | 12px semibold | `text-ui` (13px) semibold, `text-role-*-fg` |
| Subtitle | 10px | `text-meta` (11px) mono |
| Bo góc | `rounded-lg` (8px) | `rounded-xl` (12px) |
| Bóng | `shadow-lg` — trên nền đen gần như vô hình | `shadow-node`: dark = ring 1px, light = bóng thật |
| Rộng tối thiểu | không có | 124px, cụm node đều nhau |

`shadow-node` khai báo trong `theme.extend.boxShadow`, giá trị lấy từ một var
`--shadow-node` đổi theo theme.

`ExchangeNode` giữ `style={{ borderRadius: 999 }}` — hình viên thuốc là dấu hiệu
phân biệt exchange với queue, không phải chuyện bo góc chung.

Highlight fuchsia gạch đứt **giữ nguyên cơ chế**: `outline-dashed outline-2
outline-offset-4`, dùng `outline` chứ không `ring` vì Tailwind ring và box-shadow
dùng chung một slot nên ring-based highlight sẽ đè mất `selected`. Chỉ đổi màu
sang `outline-highlight` — `fuchsia-400` trên nền sáng chói không đọc nổi.

## Transport

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ↺ Chạy lại  [▶ Chạy]  ⏭ Bước   ●━━━━━━━┿━┿━━┿━━━━━━━  3.2s / 12.0s  [1x] │
└────────────────────────────────────────────────┬─────────────────────────┘
                                          mốc sự kiện từ journal
```

- **Mốc sự kiện**: một `<div>` overlay nằm sau `<input type="range">`, mỗi entry
  journal một vạch rộng 1px `bg-content-faint` đặt tại `at / max * 100%`.
  `Transport` nhận thêm prop `marks: number[]` (timestamp đã dedupe và sort).
  Đây là thứ biến thanh tua từ mù thành có định hướng.
- **Tô phần đã chạy**: `background: linear-gradient(to right, accent 0 X%,
  surface-raised X% 100%)` tính từ `value`. `<input type="range">` không có track
  fill sẵn ở bất kỳ engine nào.
- **Thời gian**: `3.2s / 12.0s` thay vì chỉ `3.2s`. Bề rộng ô tăng từ `w-16` lên
  `w-24` (desktop) và `w-11` lên `w-16` (compact).
- Nút giữ nguyên bố cục và nhãn; đổi token, nút play thành `rounded-full`. Tap
  target 44px ở chế độ `compact` giữ nguyên.
- `prop compact` giữ nguyên ý nghĩa và lý do (comment tại chỗ: prop chứ không
  `useIsMobile()` bên trong, để test được cả hai chế độ mà không giả lập viewport).

`marks` được `App.tsx` tính từ `state.journal` và truyền xuống qua `LayoutProps`
— cùng đường với `durationMs`, `highlight`. `Transport` không đọc store để lấy
journal: nó vẫn là component thuần theo prop.

Style `input[type='range']` trong `index.css` (track/thumb cho cả WebKit lẫn
Firefox) đổi hex sang var, giữ nguyên cấu trúc hai bộ pseudo-element.

## Responsive

Ba breakpoint giữ nguyên (`<768` / `768–1023` / `≥1024`); `useMediaQuery` không
đổi.

### Mobile 390×844 — ngân sách chiều dọc

| Vùng | px |
|---|---|
| TopBar + safe-top | 48 + `env()` |
| Canvas pane | ~610 |
| StatePanel dense | ~48 |
| Transport compact | 52 |
| MobileTabBar + safe-bottom | 56 + `env()` |

Ở `READABLE_ZOOM` 0.75, node cao ~56px và label 13px hiển thị ~10px — đọc được.
Pan ngang bằng một ngón; `overscroll-behavior: none` trên `body` đã chặn
pull-to-refresh của Safari iOS, giữ nguyên.

`.pt-safe` / `.pb-safe` giữ nguyên: iPhone có Dynamic Island trên đỉnh và home
indicator ~34px dưới đáy.

### Đổi nhãn tab thứ ba: "Trạng thái" → "Diễn giải"

Tab đó chứa narrative — nội dung chính của bài học — chứ không phải trạng thái.
Chỉ số và nhật ký nằm trong tab strip con của `Inspector`. Nhãn hiện tại chỉ mô
tả đúng một phần ba nội dung của pane.

`MobilePane` union trong store giữ nguyên định danh `'state'`; chỉ nhãn hiển thị
đổi. Đổi cả định danh sẽ làm hỏng mọi `setMobilePane('state')` rải trong store mà
không đem lại gì.

### Tablet 768–1023

Aside 288 → 320px, canvas còn ~448px và pan được. Drawer sidebar giữ nguyên cơ
chế (backdrop `aria-hidden` nhận chạm để đóng), chỉ đổi token và `bg-surface`.

## Accessibility

- **Tương phản kiểm bằng script, không bằng mắt.** Mọi cặp `content-*` ×
  `surface-*` ở **cả hai theme** phải ≥ 4.5:1. Không cặp nào được hưởng ngoại lệ
  "large text": chữ trong app này nằm trong khoảng 10–15px. Fail thì đẩy sáng
  token, không đẩy cỡ chữ.
- **Focus ring** đổi từ hex cứng `#38bdf8` sang `rgb(var(--accent))`. Bản hiện
  tại sẽ vô hình trên light theme.
- **Inspector tab strip**: `role="tablist"` / `tab` / `tabpanel`, điều hướng
  `←/→`, `aria-selected`. Tab "Cấu hình" dùng `aria-disabled` chứ **không**
  `disabled` — nút `disabled` biến mất khỏi thứ tự tab và người dùng bàn phím
  không biết nó tồn tại.
- **Theme toggle**: `aria-label="Đổi giao diện sáng/tối"` + `aria-pressed`.
- **MiniMap**: `aria-hidden`.
- **Touch 44px** giữ nguyên toàn bộ ở mobile. Cột số thứ tự lesson không được ăn
  vào chiều cao hàng.
- **`prefers-reduced-motion`**: guard sẵn có trong `index.css` mở rộng cho pill
  trượt của segmented control.

## Ảnh hưởng tới test

Đã đo trên codebase hiện tại, không phải ước lượng:

| | Kết quả |
|---|---|
| Test khoá vào tên màu | **Chỉ 2 file**: `rabbitmq/ui/nodes.test.tsx` (4 dòng), `kafka/ui/nodes.test.tsx` (5 dòng), dạng bảng `it.each` `['queue', QueueNode, 'ring-emerald-300', …]`. Sửa là đổi chuỗi trong bảng. |
| Snapshot RabbitMQ lessons | **0 tham chiếu className** — `toNodes` trả data, không trả class. Không vỡ. |
| `purity.test.ts` | Không đụng: mọi thay đổi ở `ui/`, ngoài `engine/`. |
| `language.test.ts` | Không đụng: không sửa một chữ lesson copy nào. |
| `store.importOrder.test.ts` | Không đụng: `theme` là field nguyên thuỷ, không import component. |
| `App.test.tsx`, `TopBar.test.tsx`, `LessonSidebar.test.tsx` | Sửa assertion; `data-testid` giữ nguyên toàn bộ nên test cấu trúc layout không vỡ. |

### Test mới

1. Toggle theme set `data-theme` trên `<html>` và ghi `localStorage`; đọc lại
   đúng giá trị đã ghi.
2. Không có giá trị lưu thì theo `prefers-color-scheme` (mock `matchMedia`).
3. `localStorage` ném lỗi (Safari private mode) thì app vẫn mount, rơi về
   `prefers-color-scheme`.
4. `Transport` render đúng số vạch mốc theo `marks`, dedupe timestamp trùng.
5. `Inspector` tab: chọn node ⇒ chuyển sang "Cấu hình"; bỏ chọn ⇒ về "Chỉ số";
   tab "Cấu hình" mang `aria-disabled` khi chưa chọn node.
6. `FIT_VIEW_OPTIONS.minZoom === READABLE_ZOOM` — jsdom không có layout thật nên
   chỉ khẳng định được cấu hình, đúng như README đã ghi cho lần responsive trước.

### Kiểm thị giác

Playwright chụp ở 375 / 390 / 768 / 1024 / 1440, mỗi kích thước hai theme = 10
ảnh. Đây là cách README đã quy định cho phần "trông có đúng không", vì jsdom
không có layout.

## Thứ tự thực thi

Mỗi bước là một commit với suite xanh.

| # | Bước | Thấy gì |
|---|---|---|
| 1 | Token infra: CSS var, `tailwind.config.js`, script inline `index.html`, `theme` + `setTheme` vào store | Gần như không đổi, trừ panel nhấc khỏi canvas |
| 2 | Font `@fontsource-variable` + type scale | Đổi chữ toàn app |
| 3 | Shell chrome: numeric → semantic token, toàn bộ `src/shell/ui/**` (gồm `CheckpointCard`, `MessageLayer`, `geometry.ts`) | Light mode chạy ở shell |
| 4 | Broker UI: `slate`/`sky`/hue → `role-*`, 13 file dưới `src/brokers/*/ui/` và `sandbox/` | Light mode chạy toàn bộ |
| 5 | Layout: TopBar chung, Inspector hai vùng + tab, bề rộng cột, nhãn tab mobile | Đổi bố cục |
| 6 | Canvas: `READABLE_ZOOM`, MiniMap, mũi tên edge, node shell | Node đọc được ở mobile |
| 7 | Transport: mốc sự kiện, track tô màu, `x.xs / y.ys` | Tua có định hướng |
| 8 | Audit tương phản, a11y, 10 ảnh Playwright | — |

Bước 3 và 4 **phải xong trước** 5–7. Đổi bố cục trên class màu cũ rồi đổi màu lại
lần nữa là làm hai lần cùng một việc.

## Ngoài scope

Nói rõ để không trôi:

- Không thêm tiến độ học / đánh dấu lesson đã hoàn thành.
- Không command palette, không onboarding, không trang chủ lesson.
- Không phím tắt cho Transport (đã cân nhắc, người dùng không chọn).
- Không đụng `src/shell/kernel/**` hay `src/brokers/*/engine/**`.
- Không sửa lesson copy — `summary`, narrative, checkpoint giữ nguyên từng chữ.
- Không đổi `BrokerModule` contract, không đổi `Lesson` shape.
- Không đụng Sandbox logic; `SandboxPanel` và `ExportDialog` chỉ nhận migration
  token ở bước 4, không đổi cấu trúc.
