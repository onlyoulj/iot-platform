<template>
  <div class="stat-cards">
    <div
      v-for="item in items"
      :key="item.label"
      class="stat-card"
      :style="{ background: item.bg || '#fff' }"
    >
      <div class="stat-icon" :style="{ background: item.iconBg }">
        <el-icon><component :is="resolveIcon(item.icon)" /></el-icon>
      </div>
      <div class="stat-info">
        <h3>{{ item.value }}</h3>
        <p>{{ item.label }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { resolveIcon } from '@/utils/icons'

defineProps({
  /** 卡片数据：[{ label, value, icon, iconBg, bg }] */
  items: {
    type: Array,
    default: () => [],
  },
})
</script>
