# Lesson quiz — thiết kế

Ngày: 2026-09-13

## Vấn đề

Mỗi lesson hiện có hai `Checkpoint`: một nhịp hiểu bài giữa run và một câu wrap-up
đặt đúng `durationMs`. Checkpoint trả lời một lần, không điểm, không làm lại — nó là
nhịp đọc hiểu, không phải bài kiểm tra. Người học không có cách nào tự đánh giá đã
nắm bài hay chưa, cũng không có gì nhìn lại sau khi học xong cả 17/17/25 bài.

Bốn thứ cần thêm, áp dụng cho cả ba broker RabbitMQ, Redis, Kafka:

1. Bài test có chấm điểm ở cuối mỗi lesson.
2. Đề thi tổng kết cho mỗi broker.
3. Nhiều câu hỏi hơn trong mỗi lesson.
4. Checkpoint cho làm lại và hiện điểm.

Kết quả lưu qua `localStorage` để sống qua lần mở app sau. App không có backend nên
đây là lựa chọn lưu trữ duy nhất.

## Kho câu hỏi: field `quiz` trên `Lesson`

`src/shell/lesson/types.ts`:

```ts
export interface QuizQuestion {
  question: string
  options: string[]
  answerIndex: number
  explanation: string
}

export interface Lesson<TTopology, TAction> {
  // ...
  checkpoints?: Checkpoint[]
  quiz?: QuizQuestion[]
}
```

`QuizQuestion` cố tình **không** có `at`. Checkpoint bám timeline và được phép hỏi
theo ngữ cảnh đang chạy ("lúc này queue còn bao nhiêu message"); câu quiz phải đọc
rời khỏi mô phỏng vẫn đủ nghĩa, vì nó xuất hiện cả trong đề thi tổng kết nơi không
có run nào đang chạy. Đó là lý do kho quiz là field riêng chứ không tái dùng
`checkpoints`.

Kho nằm trong chính file lesson, không tách sang `src/brokers/<id>/quiz/`: sửa lesson
và sửa câu hỏi của nó là cùng một lượt sửa, và `lessons.test.ts` của mỗi broker đã
`it.each` trên `LESSONS` nên câu mới tự động bị kiểm tra.

`quiz?` để optional trong type nhưng test ép mọi lesson phải có — giống hệt cách
`checkpoints?` optional mà `checkpoints.test.ts` vẫn ép tối thiểu hai câu. Type
optional giữ cho một lesson đang viết dở vẫn compile; test là nơi chặn nó lọt vào
nhánh chính.

Sau khi làm xong, mỗi lesson có:

- **3 checkpoint** — hai nhịp giữa run, một wrap-up tại `durationMs` (hiện là 2).
- **4 câu quiz** — không thời điểm, dùng cho test cuối bài và đề thi.

Tổng nội dung mới: ~236 câu quiz (59 lesson × 4) và ~59 checkpoint bổ sung.

## Module chấm điểm và lưu trữ: `src/shell/quiz/`

Ba file thuần, không import React, không nằm trong `src/shell/kernel/**` nên
`purity.test.ts` không áp dụng.

### `grade.ts`

```ts
export interface QuizResult {
  correct: number
  total: number
  /** Vị trí trong mảng câu hỏi đã truyền vào, không phải trong lesson. */
  wrongIndexes: number[]
}

export function gradeQuiz(
  questions: QuizQuestion[],
  answers: (number | undefined)[],
): QuizResult
```

Câu chưa trả lời tính là sai. Hàm không biết gì về React, về broker, về lesson.

### `shuffle.ts`

```ts
export function shuffle<T>(items: readonly T[], seed: number): T[]
export function sample<T>(items: readonly T[], count: number, seed: number): T[]
```

Fisher-Yates chạy trên `nextInt` của `src/shell/kernel/rng.ts` — dùng lại mulberry32
sẵn có thay vì `Math.random`, nên cùng seed cho cùng thứ tự và test khẳng định được
kết quả thay vì chỉ kiểm tra "không mất phần tử". Seed do UI truyền vào
(`Date.now()` lúc mở dialog); `Date.now` gọi ở tầng UI, không phải trong engine.

`sample` trả về `count` phần tử đầu của một lần `shuffle`, và trả về toàn bộ khi
`count` lớn hơn số phần tử.

### `progress.ts`

```ts
export interface ScoreRecord {
  best: number
  total: number
  attempts: number
}

export interface Progress {
  version: 1
  /** Key `${brokerId}/${lessonId}`. */
  lessons: Record<string, ScoreRecord>
  /** Key `brokerId`. */
  exams: Record<string, ScoreRecord>
}

export function readProgress(): Progress
export function writeProgress(progress: Progress): void
export function recordScore(
  progress: Progress,
  scope: { kind: 'lesson'; brokerId: string; lessonId: string } | { kind: 'exam'; brokerId: string },
  result: { correct: number; total: number },
): Progress
```

Key `localStorage`: `broker-visualizer:progress:v1`.

`localStorage` ném `SecurityError` ở Safari private mode — mọi lần chạm phải bọc
try/catch, đúng như `src/shell/ui/theme.ts` đã làm và vì cùng lý do: một exception
chưa bắt lúc khởi tạo store làm trắng cả trang. Đọc thất bại, JSON hỏng, hoặc
`version` khác `1` đều trả về progress rỗng: mất điểm cũ chấp nhận được, crash thì
không.

`recordScore` thuần: nhận progress cũ, trả progress mới. `best` chỉ tăng, `attempts`
luôn +1. Lưu `total` kèm theo vì số câu mỗi lesson có thể đổi khi thêm nội dung —
"3/4" đọc được, "3" thì không.

### State ở store

`src/shell/store.ts` thêm:

```ts
progress: Progress
recordLessonQuiz(lessonId: string, result: { correct: number; total: number }): void
recordExam(result: { correct: number; total: number }): void
```

Điểm phải sống trong store chứ không phải `useState` của dialog, vì badge trên
`LessonSidebar` nằm ở nhánh cây khác và phải re-render khi người học vừa nộp bài.
Store gọi `progress.ts` để đọc lúc khởi tạo và ghi sau mỗi lần record — cùng mẫu
với `theme`: module thuần giữ I/O, store chỉ giữ giá trị cho component.

Cả hai action lấy `brokerId` từ state hiện tại, nên caller không truyền nhầm được.

## UI

### a. Checkpoint có điểm và làm lại

`src/shell/ui/Inspector/CheckpointCard.tsx`.

`CheckpointCard` nhận thêm `onAnswered(correct: boolean)` và hiện nút "Thử lại" khi
trả lời sai — bấm là xoá lựa chọn cục bộ, các option bật lại. Trả lời đúng thì không
có nút: đúng rồi làm lại không còn gì để học.

`CheckpointSection` giữ điểm của lượt chạy và hiện "Đúng 2/3" cạnh tiêu đề
"Câu hỏi kiểm tra". Điểm sống ở section chứ không ở card vì nó cộng dồn nhiều card.

Cơ chế reset hiện tại phải giữ nguyên: `key={lessonId}:{index}` trên mỗi card làm
việc đổi bài và tua lùi qua `at` tự vứt đáp án cũ mà không cần effect nào ghi state
lúc render. Vì thế card báo kết quả lên section khi trả lời, và thu hồi lại trong
cleanup của `useEffect` lúc unmount — tua lùi làm card biến mất thì điểm của nó cũng
rời khỏi tổng, và khi tua tới lại card mount mới, chưa trả lời.

Checkpoint vẫn **không** ghi vào `progress`: nó là nhịp đọc hiểu trong một lượt chạy,
điểm của nó chỉ có nghĩa trong lượt chạy đó.

### b. Test cuối bài — `LessonQuizDialog`

`src/shell/ui/Quiz/LessonQuizDialog.tsx`, overlay dựng theo mẫu `ExportDialog` (state
`open` cục bộ trong `Inspector`, dialog tự render lớp phủ).

Khi `state.now >= lesson.durationMs`, dưới `CheckpointSection` hiện một thẻ:

> Làm bài test cuối bài · 4 câu — [Bắt đầu]

Điều kiện `now >= durationMs` chọn cùng lý do checkpoint wrap-up đặt đúng
`durationMs`: transport dừng ở đó, nên đó là thời điểm duy nhất chắc chắn lesson đã
chạy hết.

Trong dialog: cả 4 câu hiện một lượt, chọn được, đổi ý được, chưa chấm. Nút "Nộp bài"
bật khi đã trả lời hết. Nộp xong: điểm "3/4" ở đầu, mỗi câu đánh dấu đúng/sai, đáp án
đúng và `explanation` hiện ra ở câu sai. Hai nút "Làm lại" (trộn lại thứ tự câu bằng
seed mới) và "Đóng".

Nộp bài gọi `recordLessonQuiz`. Làm lại rồi nộp tiếp cũng ghi, `best` giữ điểm cao
nhất, `attempts` đếm hết.

### c. Đề thi tổng kết — `ExamDialog`

`src/shell/ui/Quiz/ExamDialog.tsx`. Nút "Thi tổng kết" ở footer `LessonSidebar`, cạnh
nút Sandbox, hiện cho mọi broker (không như Sandbox — Redis và Kafka không có
sandbox nhưng đều có kho quiz).

Đề gom `quiz` của toàn bộ lesson trong broker, mỗi câu mang theo `lessonId` và
`lesson.title` của nguồn, rồi `sample(..., 20, seed)`. Hai mươi câu cho cả ba broker:
đủ để không đoán bừa, ngắn để làm hết trong một lần ngồi — RabbitMQ có 68 câu trong
kho, Kafka 100, nên mỗi lần thi là một đề khác.

Kết quả hiện điểm "16/20" và danh sách câu sai, mỗi dòng kèm nguồn "Bài 07 · Ack
modes" bấm được: gọi `setLesson(lessonId)` rồi đóng dialog, đưa người học thẳng tới
bài cần xem lại. Nộp gọi `recordExam`.

Dialog không sống trong `Inspector` mà ở tầng layout, vì nó không thuộc về lesson nào
đang mở.

### d. Badge trên sidebar

`LessonSidebar` tra `progress.lessons` theo key `${brokerId}/${lessonId}` và hiện
"3/4" mờ ở mép phải mỗi lesson đã làm; đúng hết thì hiện dấu ✓ thay cho số. Lesson chưa làm
không hiện gì — sidebar đang là danh sách đọc được, thêm "0/4" vào mọi dòng làm nó
thành bảng điểm.

## Test

Mới:

- `src/shell/lesson/quiz.test.ts` — chạy `describe.each` trên `BROKERS` như
  `checkpoints.test.ts`: mỗi lesson ≥4 câu quiz, mỗi câu ≥3 option, option không
  trùng nhau, `answerIndex` nằm trong tầm. Đặt ở `src/shell/lesson/` chứ không trong
  từng broker vì đây là luật sản phẩm, và broker đăng ký sau được phủ ngay khi nó
  lọt vào `BROKERS`.
- `src/shell/quiz/grade.test.ts` — câu chưa trả lời tính sai; `wrongIndexes` đúng vị trí.
- `src/shell/quiz/shuffle.test.ts` — cùng seed cho cùng thứ tự; không mất, không nhân
  đôi phần tử; `sample` với `count` lớn hơn kho trả về cả kho.
- `src/shell/quiz/progress.test.ts` — `localStorage` ném thì `readProgress` trả rỗng
  và `writeProgress` không ném; JSON hỏng và `version` lạ đều trả rỗng; `best` không
  tụt khi lần sau làm tệ hơn; `attempts` cộng dồn.
- `src/shell/ui/Quiz/LessonQuizDialog.test.tsx` — nút nộp khoá tới khi trả lời hết;
  nộp hiện điểm và explanation của câu sai; làm lại xoá đáp án cũ.
- `src/shell/ui/Quiz/ExamDialog.test.tsx` — đề đúng 20 câu; câu sai hiện đúng lesson
  nguồn; bấm nguồn gọi `setLesson` và đóng dialog.

Sửa:

- `src/shell/lesson/language.test.ts` — quiz chịu đúng luật của checkpoint:
  `question` và `explanation` phải có dấu tiếng Việt; `question`, `explanation` và
  mọi option đều không được chứa english function word ngoài backtick. Option không
  bị ép có dấu vì nó có thể là một thuật ngữ trần ("Fanout exchange").
- `src/shell/lesson/checkpoints.test.ts` — nâng tối thiểu từ 2 lên 3 checkpoint.
- `src/shell/ui/Inspector/CheckpointCard.test.tsx` — nút "Thử lại" chỉ hiện khi sai;
  bấm là bật lại option; điểm của section cộng đúng.
- `src/brokers/rabbitmq/lessons/__snapshots__/lessons.test.ts.snap` — cập nhật theo
  nội dung mới.

## Thứ tự làm

1. **Nền** — `QuizQuestion` trong types, `src/shell/quiz/` ba module với test của
   chúng, slice `progress` trong store.
2. **UI** — checkpoint làm lại + điểm, `LessonQuizDialog`, `ExamDialog`, badge sidebar.
   Test component chạy trên lesson fixture, không đợi nội dung thật.
3. **Nội dung RabbitMQ** — 17 lesson: 4 câu quiz + 1 checkpoint mỗi bài.
4. **Nội dung Redis** — 17 lesson.
5. **Nội dung Kafka** — 25 lesson.
6. **Chốt luật** — thêm `src/shell/lesson/quiz.test.ts`, nâng `checkpoints.test.ts`
   từ 2 lên 3, mở rộng `language.test.ts` sang quiz.

Ba phase nội dung tách riêng để review từng phần: 236 câu trong một lượt không ai
đọc hết được.

Hai test ép-luật (`quiz.test.ts`, mức tối thiểu mới của `checkpoints.test.ts`) nằm ở
phase cuối chứ không phải phase 1, vì chúng chạy `describe.each` trên `BROKERS`: viết
sớm thì mọi commit của phase 1-4 đỏ vì broker chưa tới lượt. Trong lúc đó mỗi phase
nội dung thêm một assertion quiz cục bộ vào `lessons.test.ts` của chính broker mình
(cùng `it.each` sẵn có), rồi phase 6 gỡ ba bản cục bộ đó và thay bằng một luật duy
nhất chạy trên `BROKERS` — phủ luôn broker đăng ký sau này. `language.test.ts` mở
rộng ở phase 6 cùng lý do: nó cũng duyệt `BROKERS`.

## Nằm ngoài phạm vi

- Không có bộ đếm giờ cho đề thi.
- Không có câu hỏi liên bài viết riêng cho đề thi; đề gom từ kho của lesson.
- Không có dạng câu hỏi nào khác ngoài trắc nghiệm một đáp án.
- Không xuất/nhập tiến độ, không đồng bộ giữa máy — `localStorage` là hết.
