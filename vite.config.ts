import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // 針對大型共用的第三方套件拆包，提升瀏覽器長效快取命中率並避免單一 chunk 過大
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
            {
              name: 'recharts-vendor',
              test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/,
            },
            {
              name: 'lucide-vendor',
              test: /node_modules[\\/]lucide-react[\\/]/,
            },
          ],
        },
      },
    },
  },
})
