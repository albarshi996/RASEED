import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/App'
import './ui/styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('عنصر الجذر #root غير موجود في index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
