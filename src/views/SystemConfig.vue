<template>
  <div class="page-container" v-loading="loading">
    <!-- 系统信息 -->
    <div class="info-card">
      <div class="info-header">
        <h3>系统运行信息</h3>
        <el-button size="small" @click="loadInfo">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="Node 版本">{{ info.nodeVersion || '--' }}</el-descriptions-item>
        <el-descriptions-item label="运行平台">{{ info.platform || '--' }}</el-descriptions-item>
        <el-descriptions-item label="进程 PID">{{ info.pid || '--' }}</el-descriptions-item>
        <el-descriptions-item label="运行时长">{{ info.uptime || '--' }}</el-descriptions-item>
        <el-descriptions-item label="服务端口">{{ info.port || '--' }}</el-descriptions-item>
        <el-descriptions-item label="配置文件">
          <span class="mono">{{ info.configFile || '--' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="RSS 内存">{{ info.memory?.rss || 0 }} MB</el-descriptions-item>
        <el-descriptions-item label="堆使用">{{ info.memory?.heapUsed || 0 }} MB</el-descriptions-item>
        <el-descriptions-item label="堆总量">{{ info.memory?.heapTotal || 0 }} MB</el-descriptions-item>
        <el-descriptions-item label="Redis 状态">
          <el-tag :type="info.redis?.enabled ? 'success' : 'info'" size="small">
            {{ info.redis?.enabled ? '已接入' : '未接入（降级）' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="Redis 在线设备">{{ info.redis?.onlineDevices ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="MQTT 状态">
          <el-tag :type="info.mqtt?.available ? 'success' : 'info'" size="small">
            {{ info.mqtt?.available ? '已接入' : '未接入（降级）' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="MQTT 通道">
          {{ info.mqtt?.restApi ? 'REST API' : info.mqtt?.ready ? 'MQTT 客户端' : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="MQTT 地址">
          <span class="mono">{{ info.mqtt?.url || '--' }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- 配置编辑 -->
    <div class="config-card">
      <div class="config-header">
        <h3>系统配置</h3>
        <div>
          <el-button size="small" @click="loadConfig">
            <el-icon><Refresh /></el-icon> 重新加载
          </el-button>
          <el-button type="primary" size="small" :loading="saving" @click="handleSave">
            <el-icon><Check /></el-icon> 保存配置
          </el-button>
        </div>
      </div>
      <p class="config-tip">
        修改后点击「保存配置」。标注「需重启」的项需重启后端服务才生效；其余即时生效。
        敏感项（密钥）显示为掩码，留空表示不修改；填入新值则覆盖。
      </p>

      <!-- 按分组渲染 -->
      <div v-for="group in groupedMeta" :key="group.name" class="config-group">
        <h4 class="group-title">{{ group.name }}</h4>
        <el-row :gutter="16">
          <el-col v-for="item in group.items" :key="item.key" :xs="24" :md="12">
            <el-form-item :label="item.label" :title="item.desc" class="config-item">
              <!-- 敏感项 -->
              <el-input
                v-if="item.type === 'secret'"
                v-model="form[item.key]"
                type="password"
                show-password
                :placeholder="values[item.key] ? '已设置，留空不修改' : '未设置'"
              />
              <!-- 开关 -->
              <el-switch
                v-else-if="item.type === 'switch'"
                v-model="form[item.key]"
                :active-value="'true'"
                :inactive-value="'false'"
              />
              <!-- 下拉选择 -->
              <el-select v-else-if="item.type === 'select'" v-model="form[item.key]" style="width: 100%">
                <el-option
                  v-for="opt in item.options || []"
                  :key="opt.value"
                  :value="opt.value"
                  :label="opt.label"
                />
              </el-select>
              <!-- 数字 -->
              <el-input-number
                v-else-if="item.type === 'number'"
                v-model="form[item.key]"
                :controls="false"
                style="width: 100%"
              />
              <!-- 文本 -->
              <el-input v-else v-model="form[item.key]" :placeholder="item.desc" />
              <div class="item-meta">
                <span class="item-desc">{{ item.desc }}</span>
                <el-tag v-if="item.restart" type="warning" size="small" effect="plain">需重启</el-tag>
                <el-tag v-else type="success" size="small" effect="plain">即时生效</el-tag>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </div>
    </div>

    <!-- 保存结果提示 -->
    <el-dialog v-model="showResult" title="保存结果" width="480px">
      <el-alert v-if="result?.restartRequired?.length" type="warning" :closable="false" show-icon class="result-alert">
        <template #title>
          以下 {{ result.restartRequired.length }} 项配置已保存，需<strong>重启后端服务</strong>后生效：
        </template>
      </el-alert>
      <div v-if="result?.restartRequired?.length" class="result-list">
        <el-tag v-for="k in result.restartRequired" :key="k" type="warning" size="small" class="result-tag">
          {{ k }}
        </el-tag>
      </div>
      <el-alert v-if="result?.changed?.length" type="success" :closable="false" show-icon class="result-alert">
        <template #title>共保存 {{ result.changed.length }} 项配置</template>
      </el-alert>
      <el-alert v-else type="info" :closable="false" show-icon class="result-alert">
        <template #title>没有需要保存的配置变更</template>
      </el-alert>
      <template #footer>
        <el-button type="primary" @click="showResult = false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'
import { confirm } from '@/utils/dialog'
import { systemApi } from '@/utils/api'

const loading = ref(false)
const saving = ref(false)
const info = ref({})
const values = ref({}) // 后端返回的当前值（脱敏）
const meta = ref([])
const form = ref({}) // 编辑表单
const showResult = ref(false)
const result = ref(null)

/* ------------------------- 分组渲染 ------------------------- */
const groupedMeta = computed(() => {
  const map = new Map()
  for (const m of meta.value) {
    if (!map.has(m.group)) map.set(m.group, [])
    map.get(m.group).push(m)
  }
  return Array.from(map, ([name, items]) => ({ name, items }))
})

/* ------------------------- 加载 ------------------------- */
async function loadConfig() {
  loading.value = true
  try {
    const data = await systemApi.getConfig()
    values.value = data.values || {}
    meta.value = data.meta || []
    // 用当前值填充表单；敏感项留空（保存时空值=不修改）
    const next = {}
    for (const m of data.meta || []) {
      if (m.type === 'secret') {
        next[m.key] = ''
      } else {
        next[m.key] = values.value[m.key] ?? ''
      }
    }
    form.value = next
  } catch (err) {
    ElMessage.error(err.message || '配置加载失败')
  } finally {
    loading.value = false
  }
}

async function loadInfo() {
  try {
    info.value = await systemApi.getInfo()
  } catch (err) {
    ElMessage.error(err.message || '系统信息加载失败')
  }
}

/* ------------------------- 保存 ------------------------- */
async function handleSave() {
  // 端口修改需二次确认
  const portChanged = form.value.PORT && String(form.value.PORT) !== String(values.value.PORT)
  if (portChanged) {
    const ok = await confirm(
      '修改服务端口后，需重启后端生效，且前端代理（Vite proxy）也要同步调整。确认修改？',
      '端口变更确认'
    )
    if (!ok) return
  }

  saving.value = true
  try {
    const res = await systemApi.updateConfig(form.value)
    result.value = res
    // 用返回的新值刷新脱敏展示
    if (res.values) values.value = res.values
    // 敏感项清空表单（已保存，不再显示明文）
    for (const m of meta.value) {
      if (m.type === 'secret') form.value[m.key] = ''
    }
    showResult.value = true
    ElMessage.success(res.message || '配置已保存')
    // 端口变了的话同步刷新系统信息
    if (portChanged) await loadInfo()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadConfig()
  loadInfo()
})
</script>

<style scoped>
.info-card,
.config-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  margin-bottom: 16px;
}
.info-header,
.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.info-header h3,
.config-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}
.config-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin: 0 0 20px;
  padding: 10px 14px;
  background: #f5f7fa;
  border-radius: 6px;
}
.config-group {
  margin-bottom: 20px;
}
.group-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 12px;
  padding-left: 10px;
  border-left: 3px solid #409eff;
}
.config-item {
  margin-bottom: 14px;
}
.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  line-height: 1.5;
}
.item-desc {
  font-size: 12px;
  color: #909399;
  flex: 1;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  word-break: break-all;
}
.result-alert {
  margin-bottom: 12px;
}
.result-list {
  margin: 8px 0 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.result-tag {
  font-family: Consolas, Monaco, monospace;
}
</style>
