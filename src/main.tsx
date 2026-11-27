import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { triggerSafeChunkReload } from './utils/lazy-with-retry'

// 攔截 Vite 動態分包預載失敗（例如部署新版本後舊分頁載入已失效的 chunk），自動重整避免整頁白屏
window.addEventListener('vite:preloadError', (event) => {
  if (triggerSafeChunkReload()) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
