import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bản @fontsource-variable đã cài (5.3.0) không có file subset `vietnamese.css`/
// `latin.css` ở gốc package — `ls node_modules/@fontsource-variable/ibm-plex-sans/`
// chỉ thấy file theo trục biến thiên (`wght.css`, `wdth.css`, `standard.css`), không
// có file chia theo subset. Import gốc (không path con) tương đương `wght.css` và
// gộp cả 6 subset kể cả cyrillic/greek, nhưng mỗi subset vẫn có `unicode-range`
// riêng nên trình duyệt chỉ tải woff2 của subset thực sự render — không tốn thêm
// băng thông so với chỉ import vietnamese+latin. `vietnamese` là bắt buộc — toàn
// bộ narrative có dấu.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './shell/ui/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
