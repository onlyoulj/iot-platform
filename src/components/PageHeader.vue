<template>
  <div class="page-header">
    <div class="page-header__title">
      <h2>{{ title }}</h2>
      <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
    </div>
    <div class="page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
})
</script>

<style scoped>
.page-header__title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.page-header__subtitle {
  font-size: 13px;
  color: #909399;
}
.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
