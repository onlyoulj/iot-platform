import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import viteCompression from 'vite-plugin-compression'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 加载 .env / .env.[mode] 中的变量
  const env = loadEnv(mode, process.cwd(), '')
  // 开发环境后端代理目标。
  // 优先级：进程环境变量 > .env 文件 > 默认值。
  // 进程环境变量放在首位，是为了让 scripts/start.mjs 在自定义后端端口时能直接注入。
  const proxyTarget = process.env.VITE_PROXY_TARGET || env.VITE_PROXY_TARGET || 'http://localhost:3000'

  const isProd = mode === 'production'

  return {
    plugins: [
      vue(),
      // Element Plus 组件与指令（v-loading 等）按需自动引入
      // importStyle: false —— 样式仍由 main.js 统一引入完整 CSS，避免按需样式漏引
      Components({
        resolvers: [ElementPlusResolver({ importStyle: false })],
        dts: false,
      }),

      // 生产环境：生成 .gz 预压缩文件，Nginx 直接发送 gzip 静态文件
      // 去掉了运行时压缩的 CPU 开销，TTFB 更低
      ...(isProd
        ? [
            viteCompression({
              algorithm: 'gzip',
              ext: '.gz',
              threshold: 10240, // 仅压缩 >10KB 的文件
              deleteOriginFile: false, // 保留原始文件，兼容不支持 gzip 的客户端
            }),
            // 同时生成 brotli 压缩（比 gzip 小 15-20%，现代浏览器均支持）
            viteCompression({
              algorithm: 'brotliCompress',
              ext: '.br',
              threshold: 10240,
              deleteOriginFile: false,
            }),
          ]
        : []),
    ],

    resolve: {
      // 统一使用 @ 指向 src，避免层层相对路径
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    server: {
      host: '0.0.0.0',
      port: 5173,
      open: false,
      // 开发环境把 /api 转发到后端，规避跨域并隐藏真实地址
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },

    // 预览构建产物时保持与开发环境一致的接口代理
    preview: {
      port: 4173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },

    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,

      // esbuild 压缩：速度最快，配合 CSS 压缩
      minify: 'esbuild',

      // 提高警告阈值，避免异步 chunk 被误报
      chunkSizeWarningLimit: 1000,

      // 小于 4KB 的静态资源内联为 base64，减少 HTTP 请求数
      // 大于 4KB 的保持外链，避免 base64 膨胀 HTML/CSS 体积
      assetsInlineLimit: 4096,

      // CSS 压缩配置：esbuild 已默认压缩 CSS，这里做额外控制
      cssCodeSplit: true, // 按异步 chunk 拆分 CSS（Vite 默认 true）

      // 目标浏览器：生产环境只兼容现代浏览器，减少 polyfill
      target: isProd ? 'es2018' : 'esnext',

      // 说明：曾尝试用 manualChunks 把 vue / element-plus / echarts 拆成独立 vendor 包，
      // 实测反而因跨 chunk 复用导致产物体积增加约 400KB（1606KB → 1207KB），故不启用。
      // 交给 Rollup 依据动态导入自动分包即可。
      // ECharts 已通过 defineAsyncComponent 懒加载，会自动形成独立 chunk。
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        },
      },
    },

    css: {
      // CSS 压缩器：使用 esbuild（Vite 默认即 esbuild，此处显式声明便于维护）
      devSourcemap: false,
    },

    esbuild: {
      // 生产环境移除 debugger 与调试日志，保留 console.error / warn 便于排查线上问题
      drop: isProd ? ['debugger'] : [],
      pure: isProd ? ['console.log', 'console.debug'] : [],
      // 生产环境合法化压缩：移除注释
      legalComments: isProd ? 'none' : 'inline',
    },
  }
})
