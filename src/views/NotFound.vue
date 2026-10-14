<template>
  <div class="not-found">
    <el-icon :size="72" color="#c0c4cc"><Warning /></el-icon>
    <h2>404</h2>
    <p>抱歉，你访问的页面不存在</p>
    <el-button type="primary" @click="router.push('/dashboard')">返回仪表盘</el-button>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 60vh;
  color: #909399;
}
.not-found h2 {
  font-size: 32px;
  color: #303133;
}
.not-found p {
  font-size: 14px;
  margin-bottom: 8px;
}
</style>
