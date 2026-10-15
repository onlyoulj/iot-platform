import { defineConfig } from 'vite'
// @dcloudio/vite-plugin-uni 是 CJS 包，Node ESM 互操作下 default 拿到的是整个
// module.exports 而非 uniPlugin 函数，必须显式取 .default（兼容两种形态）
import * as uniModule from '@dcloudio/vite-plugin-uni'

const uni = typeof uniModule === 'function' ? uniModule : uniModule.default || uniModule

export default defineConfig({
  plugins: [uni()],
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
})
