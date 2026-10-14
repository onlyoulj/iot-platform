/**
 * Element Plus 反馈类组件统一出口
 * ------------------------------------------------------------------
 * 为什么不直接从 'element-plus' 根入口引入？
 * 根入口会 `export default` 一个由 makeInstaller 创建的完整安装器，
 * 其内部引用了全部组件实例，导致 Rollup **无法 tree-shaking**，
 * 最终把整个组件库打进产物（实测约 910 kB）。
 *
 * 改为从组件级路径引入后，只有真正用到的组件进入打包图。
 * 组件模板中的 `<el-xxx>` 已由 unplugin-vue-components 自动按需引入，
 * 这里只需补充「函数式调用」的组件（Message / MessageBox 等）。
 */
export { ElMessage } from 'element-plus/es/components/message/index.mjs'
export { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
