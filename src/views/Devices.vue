<template>
  <div class="page-container">
    <StatCards :items="statItems" />

    <div class="device-layout">
      <!-- 分组树侧栏 -->
      <div class="group-panel">
        <div class="group-panel__header">
          <h4>设备分组</h4>
          <el-button v-if="canEdit" link type="primary" size="small" @click="openGroupDialog(null)">
            <el-icon><Plus /></el-icon> 新建
          </el-button>
        </div>
        <el-tree
          ref="groupTreeRef"
          :data="groupTreeData"
          node-key="key"
          highlight-current
          default-expand-all
          :expand-on-click-node="false"
          @node-click="onGroupNodeClick"
        >
          <template #default="{ data }">
            <div class="group-node">
              <span class="group-node__label">
                <el-icon v-if="data.id"><Folder /></el-icon>
                {{ data.label }}
              </span>
              <span v-if="data.id && canEdit" class="group-node__actions" @click.stop>
                <el-icon class="group-node__act" @click="openGroupDialog(data)"><Edit /></el-icon>
                <el-icon class="group-node__act group-node__act--danger" @click="handleGroupDelete(data)"><Delete /></el-icon>
              </span>
            </div>
          </template>
        </el-tree>
      </div>

      <!-- 右侧：筛选 + 列表 -->
      <div class="device-main">
    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索设备名称 / DeviceName"
        clearable
        prefix-icon="Search"
        style="width: 260px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="filterProduct" placeholder="所属产品" clearable style="width: 180px">
        <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="设备状态" clearable style="width: 140px">
        <el-option
          v-for="opt in DEVICE_STATUS_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-button type="primary" @click="search">
        <el-icon><Search /></el-icon> 查询
      </el-button>
      <el-button @click="handleReset">
        <el-icon><Refresh /></el-icon> 重置
      </el-button>
      <el-tag v-if="activeGroup" closable @close="clearGroupFilter">
        分组：{{ activeGroup.name }}
      </el-tag>
    </div>

    <!-- 列表 -->
    <div class="table-card">
      <div class="table-toolbar">
        <h3>设备列表</h3>
        <div>
          <el-button
            type="primary"
            plain
            :disabled="!selectedRows.length"
            @click="openBatchGroupDialog"
          >
            <el-icon><Folder /></el-icon> 移动分组
          </el-button>
          <el-button
            type="danger"
            plain
            :disabled="!selectedRows.length"
            @click="handleBatchDelete"
          >
            <el-icon><Delete /></el-icon> 批量删除
          </el-button>
          <el-button type="primary" @click="openAddDialog">
            <el-icon><Plus /></el-icon> 添加设备
          </el-button>
        </div>
      </div>

      <el-table
        :data="devices"
        row-key="id"
        stripe
        style="width: 100%"
        v-loading="loading"
        empty-text="暂无设备数据"
        @selection-change="(rows) => (selectedRows = rows)"
      >
        <el-table-column type="selection" width="50" reserve-selection />
        <el-table-column prop="name" label="设备名称" min-width="180">
          <template #default="{ row }">
            <div class="device-cell">
              <span class="status-dot" :class="dictValue(DEVICE_STATUS, row.status, 'dot', 'inactive')" />
              <div class="device-cell__text">
                <el-link type="primary" underline="never" @click="showDetail(row)">
                  {{ row.name }}
                </el-link>
                <div class="device-cell__sub">{{ row.device_name }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="product_name" label="所属产品" min-width="150" show-overflow-tooltip />
        <el-table-column prop="group_name" label="分组" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.group_name || '未分组' }}</template>
        </el-table-column>
        <el-table-column prop="firmware_version" label="当前固件" width="120">
          <template #default="{ row }">
            <el-tag type="info" size="small" effect="plain">
              {{ row.firmware_version || '--' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="dictValue(DEVICE_STATUS, row.status, 'type', 'info')" size="small">
              {{ dictValue(DEVICE_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="电量" width="110">
          <template #default="{ row }">
            <div v-if="row.battery !== null && row.battery !== undefined" class="metric-cell">
              <el-progress
                :percentage="row.battery"
                :stroke-width="8"
                :show-text="false"
                :color="batteryColor(row.battery)"
                style="width: 46px"
              />
              <span class="metric-text">{{ row.battery }}%</span>
            </div>
            <span v-else class="metric-text muted">--</span>
          </template>
        </el-table-column>
        <el-table-column label="信号" width="100">
          <template #default="{ row }">
            <span v-if="row.signal !== null && row.signal !== undefined" class="metric-text" :style="{ color: signalColor(row.signal) }">
              <el-icon><Cellphone /></el-icon>
              {{ row.signal }} dBm
            </span>
            <span v-else class="metric-text muted">--</span>
          </template>
        </el-table-column>
        <el-table-column prop="last_online" label="最后上线" width="170">
          <template #default="{ row }">{{ formatDateTime(row.last_online) }}</template>
        </el-table-column>
        <el-table-column prop="location" label="位置" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ orDash(row.location) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">
              <el-icon><View /></el-icon> 详情
            </el-button>
            <el-button link type="warning" size="small" @click="openEditDialog(row)">
              <el-icon><Edit /></el-icon> 编辑
            </el-button>
            <el-button link type="success" size="small" @click="openSubscribe(row)">
              <el-icon><Link /></el-icon> 订阅
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="size"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </div>

    </div><!-- /device-main -->
    </div><!-- /device-layout -->

    <!-- 添加 / 编辑设备 -->
    <el-dialog
      v-model="showDialog"
      :title="dialogMode === 'edit' ? '编辑设备' : '添加设备'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="设备名称" prop="name">
          <el-input v-model="form.name" placeholder="如：网关-华东-A001" />
        </el-form-item>
        <el-form-item label="DeviceName" prop="device_name">
          <el-input
            v-model="form.device_name"
            placeholder="唯一标识，如 GW-10099"
            :disabled="dialogMode === 'edit'"
          />
          <div v-if="dialogMode === 'edit'" class="form-tip">DeviceName 是设备唯一标识，订阅地址依赖它，不可修改</div>
        </el-form-item>
        <el-form-item label="所属产品" prop="product_name">
          <el-select v-model="form.product_name" placeholder="选择产品" style="width: 100%">
            <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="固件版本">
          <el-input v-model="form.firmware_version" placeholder="如 v2.1.0" />
        </el-form-item>
        <el-form-item label="所属分组">
          <el-tree-select
            v-model="form.group_id"
            :data="groupTreeSelectData"
            node-key="id"
            check-strictly
            clearable
            default-expand-all
            placeholder="不选则归入未分组"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="位置">
          <el-input v-model="form.location" placeholder="如 上海·浦东" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ dialogMode === 'edit' ? '保存修改' : '确认添加' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 分组管理（新建 / 编辑） -->
    <el-dialog
      v-model="showGroupDialog"
      :title="groupForm.id ? '编辑分组' : '新建分组'"
      width="440px"
      destroy-on-close
    >
      <el-form :model="groupForm" label-width="90px">
        <el-form-item label="分组名称" required>
          <el-input v-model="groupForm.name" placeholder="如：华东大区 / 灰度验证组" />
        </el-form-item>
        <el-form-item label="父分组">
          <el-tree-select
            v-model="groupForm.parent_id"
            :data="groupParentOptions"
            node-key="id"
            check-strictly
            clearable
            default-expand-all
            placeholder="不选则为顶级分组"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="groupForm.description" type="textarea" :rows="2" placeholder="分组用途说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGroupDialog = false">取消</el-button>
        <el-button type="primary" :loading="groupSubmitting" @click="handleGroupSubmit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量移动分组 -->
    <el-dialog v-model="showBatchGroupDialog" title="批量移动分组" width="440px" destroy-on-close>
      <p class="batch-group-tip">将选中的 {{ selectedRows.length }} 台设备移动到：</p>
      <el-tree-select
        v-model="batchGroupId"
        :data="groupTreeSelectData"
        node-key="id"
        check-strictly
        clearable
        default-expand-all
        placeholder="不选则移出所有分组"
        style="width: 100%"
      />
      <template #footer>
        <el-button @click="showBatchGroupDialog = false">取消</el-button>
        <el-button type="primary" :loading="batchGroupSubmitting" @click="handleBatchGroup">确认移动</el-button>
      </template>
    </el-dialog>

    <!-- 设备详情 -->
    <el-drawer v-model="showDrawer" :title="drawerDevice?.name" size="620px">
      <template v-if="drawerDevice">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="设备名称">{{ drawerDevice.name }}</el-descriptions-item>
          <el-descriptions-item label="DeviceName">{{ drawerDevice.device_name }}</el-descriptions-item>
          <el-descriptions-item label="所属产品">{{ drawerDevice.product_name }}</el-descriptions-item>
          <el-descriptions-item label="固件版本">
            {{ orDash(drawerDevice.firmware_version) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="dictValue(DEVICE_STATUS, drawerDevice.status, 'type', 'info')" size="small">
              {{ dictValue(DEVICE_STATUS, drawerDevice.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="IP 地址">{{ orDash(drawerDevice.ip) }}</el-descriptions-item>
          <el-descriptions-item label="MAC 地址">
            <span class="mono">{{ orDash(drawerDevice.mac) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="硬件版本">{{ orDash(drawerDevice.hardware_version) }}</el-descriptions-item>
          <el-descriptions-item label="电量">
            <div v-if="drawerDevice.battery !== null && drawerDevice.battery !== undefined" class="metric-cell">
              <el-progress
                :percentage="drawerDevice.battery"
                :stroke-width="10"
                :color="batteryColor(drawerDevice.battery)"
                style="width: 120px"
              />
            </div>
            <span v-else class="muted">--</span>
          </el-descriptions-item>
          <el-descriptions-item label="信号强度">
            <span v-if="drawerDevice.signal !== null && drawerDevice.signal !== undefined" :style="{ color: signalColor(drawerDevice.signal) }">
              {{ drawerDevice.signal }} dBm（{{ signalLevel(drawerDevice.signal) }}）
            </span>
            <span v-else class="muted">--</span>
          </el-descriptions-item>
          <el-descriptions-item label="经纬度">
            <span v-if="drawerDevice.longitude !== null && drawerDevice.latitude !== null && drawerDevice.longitude !== undefined && drawerDevice.latitude !== undefined" class="mono">
              {{ Number(drawerDevice.longitude).toFixed(6) }}, {{ Number(drawerDevice.latitude).toFixed(6) }}
            </span>
            <span v-else class="muted">--</span>
          </el-descriptions-item>
          <el-descriptions-item label="信息更新">
            {{ formatDateTime(drawerDevice.info_updated_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="激活时间">
            {{ formatDateTime(drawerDevice.active_time) }}
          </el-descriptions-item>
          <el-descriptions-item label="最后上线">
            {{ formatDateTime(drawerDevice.last_online) }}
          </el-descriptions-item>
          <el-descriptions-item label="位置">{{ orDash(drawerDevice.location) }}</el-descriptions-item>
        </el-descriptions>

        <!-- 电量 / 信号 / 属性历史趋势 -->
        <div class="drawer-section">
          <div class="trend-header">
            <h4>历史趋势</h4>
            <div class="trend-controls">
              <el-select v-model="trendMetric" size="small" style="width: 130px" @change="loadTrend">
                <el-option v-for="opt in trendMetricOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-radio-group v-model="trendRange" size="small" @change="loadTrend">
                <el-radio-button
                  v-for="opt in TREND_RANGES"
                  :key="opt.value"
                  :value="opt.value"
                >{{ opt.label }}</el-radio-button>
              </el-radio-group>
            </div>
          </div>
          <div v-loading="trendLoading" class="trend-chart-wrap">
            <v-chart
              v-if="trendPoints.length"
              class="trend-chart"
              :option="trendOption"
              autoresize
            />
            <el-empty
              v-else-if="!trendLoading"
              description="暂无趋势数据，等待设备上报"
              :image-size="64"
            />
          </div>
          <div v-if="trendPoints.length" class="trend-footnote">
            共 {{ trendPoints.length }} 个采样点
            <template v-if="trendMeta.source === 'redis'">（Redis 热数据）</template>
            <template v-else-if="trendMeta.bucket">（已按 {{ trendMeta.bucket }}s 聚合降采样）</template>
            · 可在图内滚轮缩放 / 拖动底部滑块调整时间轴
          </div>
        </div>

        <!-- 设备影子 -->
        <div class="drawer-section">
          <div class="shadow-header">
            <h4>设备影子</h4>
            <span v-if="shadow.desired_version || shadow.reported_version" class="shadow-version">
              v{{ shadow.desired_version }} / v{{ shadow.reported_version }}
            </span>
          </div>
          <div v-loading="shadowLoading" class="shadow-body">
            <template v-if="shadowProps.length">
              <el-table :data="shadowProps" size="small" border style="width: 100%">
                <el-table-column prop="identifier" label="属性" min-width="90">
                  <template #default="{ row }"><span class="mono">{{ row.identifier }}</span></template>
                </el-table-column>
                <el-table-column label="期望(desired)" min-width="100">
                  <template #default="{ row }">
                    <span v-if="row.desired !== undefined" class="shadow-desired mono">
                      {{ formatShadowValue(row.desired) }}
                    </span>
                    <span v-else class="shadow-empty">--</span>
                  </template>
                </el-table-column>
                <el-table-column label="上报(reported)" min-width="100">
                  <template #default="{ row }">
                    <span v-if="row.reported !== undefined" class="mono">
                      {{ formatShadowValue(row.reported) }}{{ row.unit }}
                    </span>
                    <span v-else class="shadow-empty">--</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="90">
                  <template #default="{ row }">
                    <el-tag v-if="row.desired !== undefined" type="warning" size="small">待同步</el-tag>
                    <el-tag v-else-if="row.reported !== undefined" type="success" size="small">已同步</el-tag>
                    <el-tag v-else type="info" size="small">未上报</el-tag>
                  </template>
                </el-table-column>
              </el-table>

              <!-- 期望态编辑（有可写属性时） -->
              <div v-if="writableProps.length && canControl" class="shadow-edit">
                <div class="shadow-edit__title">修改期望值（按物模型校验，MQTT 下发 shadow_set）</div>
                <div v-for="p in writableProps" :key="p.identifier" class="shadow-edit__row">
                  <span class="shadow-edit__label">{{ p.name }}<span class="mono shadow-edit__id">({{ p.identifier }})</span></span>
                  <el-switch
                    v-if="p.data_type === 'bool'"
                    v-model="desiredForm[p.identifier]"
                  />
                  <el-select v-else-if="p.data_type === 'enum'" v-model="desiredForm[p.identifier]" size="small" style="width: 140px">
                    <el-option
                      v-for="opt in String(p.unit || '').split(',').filter(Boolean)"
                      :key="opt"
                      :label="opt"
                      :value="opt.trim()"
                    />
                  </el-select>
                  <el-input-number
                    v-else-if="p.data_type === 'int' || p.data_type === 'float'"
                    v-model="desiredForm[p.identifier]"
                    size="small"
                    style="width: 140px"
                    :min="p.constraint_min ?? -Infinity"
                    :max="p.constraint_max ?? Infinity"
                  />
                  <el-input v-else v-model="desiredForm[p.identifier]" size="small" style="width: 140px" />
                </div>
                <el-button
                  type="primary"
                  size="small"
                  :loading="shadowSaving"
                  :disabled="!hasDesiredChange"
                  @click="saveDesired"
                >
                  <el-icon><Promotion /></el-icon> 下发期望态
                </el-button>
                <span v-if="shadowSavingMsg" class="shadow-edit__msg">{{ shadowSavingMsg }}</span>
              </div>
            </template>
            <el-empty
              v-else-if="!shadowLoading"
              description="该产品未定义物模型属性，请在「产品管理 → 物模型」中配置"
              :image-size="48"
            />
          </div>
        </div>

        <!-- 远程控制（需 device:edit 权限） -->
        <div v-if="canControl" class="drawer-section">
          <div class="ctrl-header">
            <h4>远程控制</h4>
            <el-tag
              :type="drawerDevice.status === 'online' ? 'success' : 'info'"
              size="small"
            >{{ drawerDevice.status === 'online' ? '在线可下发' : '设备离线' }}</el-tag>
          </div>

          <el-form label-position="top" size="small" class="ctrl-form">
            <el-form-item label="指令模板">
              <el-select v-model="ctrl.command" style="width: 100%" @change="onCommandPreset">
                <el-option
                  v-for="opt in CTRL_COMMANDS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="参数（JSON）">
              <el-input
                v-model="ctrl.paramsText"
                type="textarea"
                :rows="3"
                placeholder='{"key":"value"}，无需参数留空'
              />
              <div v-if="ctrl.paramsError" class="ctrl-error">{{ ctrl.paramsError }}</div>
            </el-form-item>
            <el-button
              type="primary"
              :loading="ctrl.sending"
              :disabled="drawerDevice.status !== 'online'"
              @click="sendCommand"
            >
              <el-icon><Promotion /></el-icon> 下发指令
            </el-button>
            <span v-if="drawerDevice.status !== 'online'" class="ctrl-hint">设备离线，指令可能无法送达</span>
          </el-form>

          <div v-loading="ctrl.loadingHistory" class="ctrl-history">
            <div v-for="c in commandHistory" :key="c.cmd_id" class="ctrl-item">
              <div class="ctrl-item__head">
                <el-tag :type="ctrlStatus(c.status).type" size="small">
                  {{ ctrlStatus(c.status).text }}
                </el-tag>
                <span class="ctrl-item__cmd">{{ c.command }}</span>
                <span class="ctrl-item__time">{{ formatDateTime(c.created_at) }}</span>
              </div>
              <div v-if="c.params" class="ctrl-item__params">{{ c.params }}</div>
              <div v-if="c.result" class="ctrl-item__result">{{ c.result }}</div>
            </div>
            <el-empty
              v-if="!commandHistory.length && !ctrl.loadingHistory"
              description="暂无指令记录"
              :image-size="48"
            />
          </div>
        </div>

        <!-- 生命周期时间轴 -->
        <div class="drawer-section">
          <div class="shadow-header">
            <h4>生命周期</h4>
            <span v-if="timelineEvents.length" class="shadow-version">{{ timelineEvents.length }} 条事件</span>
          </div>
          <div v-loading="timelineLoading" class="timeline-body">
            <el-timeline v-if="timelineEvents.length" class="timeline-list">
              <el-timeline-item
                v-for="(ev, i) in timelineEvents"
                :key="i"
                :timestamp="formatDateTime(ev.time)"
                :type="timelineDotType(ev)"
                placement="top"
                :hollow="i > 0"
              >
                <div class="timeline-item">
                  <span class="timeline-type" :class="'timeline-type--' + ev.type">{{ timelineTypeLabel(ev) }}</span>
                  <span class="timeline-title">{{ ev.title }}</span>
                </div>
                <div v-if="ev.detail" class="timeline-detail">{{ ev.detail }}</div>
              </el-timeline-item>
            </el-timeline>
            <el-empty
              v-else-if="!timelineLoading"
              description="暂无事件记录"
              :image-size="48"
            />
          </div>
        </div>

        <div v-if="drawerDevice.props?.length" class="drawer-section">
          <h4>实时属性</h4>
          <el-row :gutter="12">
            <el-col :span="12" v-for="prop in drawerDevice.props" :key="prop.name">
              <el-card shadow="never" class="prop-card">
                <div class="prop-card__name">{{ prop.name }}</div>
                <div class="prop-card__value">{{ prop.value }}</div>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </template>
    </el-drawer>

    <!-- 固件订阅链接 -->
    <el-dialog v-model="showSubDialog" title="固件订阅链接" width="720px" destroy-on-close>
      <div v-loading="subLoading" class="sub-body">
        <template v-if="subData">
          <el-alert
            :type="!subData.latest ? 'info' : subData.update_available ? 'warning' : 'success'"
            :closable="false"
            show-icon
            class="sub-alert"
          >
            <template #title>
              <span v-if="!subData.latest">该产品暂无「已发布」固件，设备订阅后拿不到可下载版本</span>
              <span v-else-if="subData.update_available">
                有新版本可升级：{{ orDash(subData.device.current_version) }} →
                {{ subData.latest.version }}
              </span>
              <span v-else>
                设备当前版本 {{ orDash(subData.device.current_version) }} 已是最新
              </span>
            </template>
          </el-alert>

          <el-alert
            v-if="subData.device.status === 'inactive'"
            type="info"
            :closable="false"
            show-icon
            class="sub-alert"
          >
            <template #title>
              设备尚未激活。设备端首次成功访问下方订阅地址后，服务端会自动将其置为「在线」并记录激活时间
            </template>
          </el-alert>

          <el-descriptions :column="2" border size="small" class="sub-desc">
            <el-descriptions-item label="设备名称">{{ subData.device.name }}</el-descriptions-item>
            <el-descriptions-item label="DeviceName">{{ subData.device.device_name }}</el-descriptions-item>
            <el-descriptions-item label="所属产品">{{ subData.device.product_name }}</el-descriptions-item>
            <el-descriptions-item label="当前固件">{{ orDash(subData.device.current_version) }}</el-descriptions-item>
            <el-descriptions-item label="设备状态">
              <el-tag :type="dictValue(DEVICE_STATUS, subData.device.status, 'type', 'info')" size="small">
                {{ dictValue(DEVICE_STATUS, subData.device.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="激活时间">
              {{ formatDateTime(subData.device.active_time) }}
            </el-descriptions-item>
            <el-descriptions-item label="最后上线" :span="2">
              {{ formatDateTime(subData.device.last_online) }}
            </el-descriptions-item>
          </el-descriptions>

          <div class="sub-block">
            <div class="sub-block__title">订阅地址</div>
            <div class="sub-url">
              <el-input :model-value="subData.url" readonly />
              <el-button type="primary" @click="handleCopy(subData.url)">
                <el-icon><CopyDocument /></el-icon> 复制
              </el-button>
            </div>
            <p class="sub-hint">
              设备端周期性 GET 该地址即可获取最新固件信息（版本 / 状态 / 大小 / MD5 / 下载直链）。
              链接中的 <code>token</code> 为订阅凭证，请勿外泄；若设备需上报自身版本，改用模板：
              <code>{{ subData.url_template }}</code>
            </p>
            <p class="sub-hint sub-hint--accent">
              该地址同时是设备的<strong>激活与心跳接口</strong>：未激活的设备首次成功请求后会自动转为「在线」，
              并写入激活时间；此后每次请求都会刷新最后上线时间。
            </p>
          </div>

          <div v-if="subData.latest" class="sub-block">
            <div class="sub-block__title">最新固件 · {{ subData.latest.name }}</div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="版本号">{{ subData.latest.version }}</el-descriptions-item>
              <el-descriptions-item label="状态">{{ subData.latest.status_text }}</el-descriptions-item>
              <el-descriptions-item label="文件大小">{{ subData.latest.file_size }}</el-descriptions-item>
              <el-descriptions-item label="签名算法">{{ subData.latest.sign_algo }}</el-descriptions-item>
              <el-descriptions-item label="MD5" :span="2">
                <span class="mono">{{ orDash(subData.latest.md5) }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="固件直链" :span="2">
                <template v-if="subData.latest.direct_url">
                  <a
                    class="mono link"
                    :href="subData.latest.direct_url"
                    target="_blank"
                    rel="noreferrer"
                  >{{ subData.latest.direct_url }}</a>
                  <el-button
                    link
                    type="primary"
                    size="small"
                    @click="handleCopy(subData.latest.direct_url)"
                  >复制</el-button>
                </template>
                <span v-else class="muted">固件文件缺失，请重新上传</span>
              </el-descriptions-item>
              <el-descriptions-item label="更新说明" :span="2">
                {{ orDash(subData.latest.changelog) }}
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <details class="sub-details">
            <summary>设备接入示例</summary>
            <pre class="sub-json">{{ subData.sample.curl }}</pre>
          </details>

          <details v-if="subRawText" class="sub-details">
            <summary>设备端实际收到的响应（点击展开）</summary>
            <pre class="sub-json sub-json--tall">{{ subRawText }}</pre>
            <div class="sub-details__actions">
              <el-button link type="primary" size="small" @click="handleCopy(subRawText)">
                复制响应 JSON
              </el-button>
            </div>
          </details>
        </template>
      </div>
      <template #footer>
        <el-button @click="showSubDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage } from '@/utils/element'
import StatCards from '@/components/StatCards.vue'
import VChart from '@/plugins/echarts'
import { deviceApi, deviceGroupApi, subscribeApi, shadowApi, productApi, timelineApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { copyText } from '@/utils/clipboard'
import { usePagination } from '@/composables/usePagination'
import { useAsyncData } from '@/composables/useAsyncData'
import { DEVICE_STATUS, DEVICE_STATUS_OPTIONS, dictValue } from '@/constants'
import { formatDateTime, orDash, formatNumber } from '@/utils/format'
import { hasPermission } from '@/utils/auth'

/* ------------------------- 设备信息展示辅助 ------------------------- */

/** 电量颜色：低电量红、中等橙、充足绿 */
function batteryColor(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return '#909399'
  if (n <= 20) return '#f56c6c'
  if (n <= 50) return '#e6a23c'
  return '#67c23a'
}

/** 信号强度颜色：dBm 负值，越大越好 */
function signalColor(dbm) {
  const n = Number(dbm)
  if (!Number.isFinite(n)) return '#909399'
  if (n >= -70) return '#67c23a'
  if (n >= -90) return '#e6a23c'
  return '#f56c6c'
}

/** 信号强度等级文案 */
function signalLevel(dbm) {
  const n = Number(dbm)
  if (!Number.isFinite(n)) return '未知'
  if (n >= -70) return '强'
  if (n >= -90) return '中'
  if (n >= -110) return '弱'
  return '极弱'
}

/* ------------------------- 筛选与列表 ------------------------- */
const keyword = ref('')
const filterProduct = ref('')
const filterStatus = ref('')
const filterGroupId = ref('') // ''=全部 | '0'=未分组 | 分组id

const {
  list: devices,
  total,
  page,
  size,
  loading,
  search,
  reset,
  handlePageChange,
  handleSizeChange,
  reloadAfterRemove,
} = usePagination(
  ({ page, pageSize }) =>
    deviceApi.list({
      page,
      pageSize,
      search: keyword.value.trim() || undefined,
      product: filterProduct.value || undefined,
      status: filterStatus.value || undefined,
      group_id: filterGroupId.value || undefined,
    }),
  { pageSize: 10 }
)

/* ------------------------- 设备分组树 ------------------------- */
const groupTreeRef = ref(null)
const groupTree = ref([])
/** 分组管理/移动需要 device:edit 权限 */
const canEdit = computed(() => hasPermission('device:edit'))
/** 侧栏树数据：虚拟根「全部设备」+「未分组」+ 后端分组树 */
const groupTreeData = computed(() => [
  { key: 'all', id: null, label: '全部设备' },
  { key: 'none', id: 0, label: '未分组' },
  ...groupTree.value.map((g) => ({
    key: `g-${g.id}`,
    id: g.id,
    label: g.name,
    device_count: g.device_count,
    children: g.children?.length ? g.children.map(mapGroupNode) : undefined,
  })),
])
function mapGroupNode(g) {
  return {
    key: `g-${g.id}`,
    id: g.id,
    label: g.name,
    device_count: g.device_count,
    children: g.children?.length ? g.children.map(mapGroupNode) : undefined,
  }
}
/** 表单 / 批量移动用的树选择数据（仅真实分组，label 带设备数） */
const groupTreeSelectData = computed(() =>
  groupTree.value.map((g) => ({
    value: g.id,
    label: g.device_count ? `${g.name} (${g.device_count})` : g.name,
    children: g.children?.length ? g.children.map(mapSelectNode) : undefined,
  }))
)
function mapSelectNode(g) {
  return {
    value: g.id,
    label: g.device_count ? `${g.name} (${g.device_count})` : g.name,
    children: g.children?.length ? g.children.map(mapSelectNode) : undefined,
  }
}
/** 编辑分组时父分组候选（排除自身及其子树） */
const groupParentOptions = computed(() => {
  const excludeId = groupForm.value.id
  if (!excludeId) return groupTreeSelectData.value
  const filterNode = (nodes) =>
    (nodes || [])
      .filter((n) => n.value !== excludeId)
      .map((n) => ({ ...n, children: filterNode(n.children) }))
  return filterNode(groupTreeSelectData.value)
})

const activeGroup = ref(null) // { id, name }，null 表示未按分组筛选

async function loadGroups() {
  try {
    groupTree.value = await deviceGroupApi.tree()
  } catch (err) {
    ElMessage.error(err.message || '分组加载失败')
  }
}

function onGroupNodeClick(data) {
  if (data.key === 'all') {
    clearGroupFilter()
    return
  }
  activeGroup.value = { id: data.id, name: data.label }
  filterGroupId.value = data.key === 'none' ? '0' : String(data.id)
  page.value = 1
  search()
}

function clearGroupFilter() {
  activeGroup.value = null
  filterGroupId.value = ''
  groupTreeRef.value?.setCurrentKey(null)
  page.value = 1
  search()
}

/* ------------------------- 分组管理弹窗 ------------------------- */
const showGroupDialog = ref(false)
const groupSubmitting = ref(false)
const groupForm = ref({ id: null, name: '', parent_id: null, description: '' })

function openGroupDialog(node) {
  groupForm.value = node
    ? { id: node.id, name: node.label, parent_id: null, description: '' }
    : { id: null, name: '', parent_id: null, description: '' }
  // 编辑时回填真实 parent_id / description
  if (node?.id) {
    const find = (list) => {
      for (const g of list) {
        if (g.id === node.id) return g
        const hit = find(g.children || [])
        if (hit) return hit
      }
    }
    const src = find(groupTree.value)
    if (src) groupForm.value = { id: src.id, name: src.name, parent_id: src.parent_id, description: src.description || '' }
  }
  showGroupDialog.value = true
}

async function handleGroupSubmit() {
  if (!groupForm.value.name.trim()) {
    ElMessage.warning('请输入分组名称')
    return
  }
  groupSubmitting.value = true
  try {
    if (groupForm.value.id) {
      await deviceGroupApi.update(groupForm.value.id, {
        name: groupForm.value.name,
        parent_id: groupForm.value.parent_id ?? null,
        description: groupForm.value.description,
      })
      ElMessage.success('分组修改成功')
    } else {
      await deviceGroupApi.create({
        name: groupForm.value.name,
        parent_id: groupForm.value.parent_id ?? null,
        description: groupForm.value.description,
      })
      ElMessage.success('分组创建成功')
    }
    showGroupDialog.value = false
    await loadGroups()
  } catch (err) {
    ElMessage.error(err.message || '分组保存失败')
  } finally {
    groupSubmitting.value = false
  }
}

async function handleGroupDelete(node) {
  const count = countGroupDevices(node)
  const ok = await confirm(
    `确认删除分组「${node.label}」？${count ? `组内 ${count} 台设备` : '组内设备'}及其子分组将上移到父分组。`,
    '删除分组'
  )
  if (!ok) return
  try {
    await deviceGroupApi.remove(node.id)
    ElMessage.success('分组已删除')
    if (activeGroup.value?.id === node.id) clearGroupFilter()
    await Promise.all([loadGroups(), search()])
  } catch (err) {
    ElMessage.error(err.message || '分组删除失败')
  }
}

/** 分组节点（含子树）设备数 */
function countGroupDevices(node) {
  const find = (list) => {
    for (const g of list) {
      if (g.id === node.id) return g
      const hit = find(g.children || [])
      if (hit) return hit
    }
  }
  const sum = (g) => (g.device_count || 0) + (g.children || []).reduce((acc, c) => acc + sum(c), 0)
  const src = find(groupTree.value)
  return src ? sum(src) : 0
}

/* ------------------------- 批量移动分组 ------------------------- */
const showBatchGroupDialog = ref(false)
const batchGroupId = ref(null)
const batchGroupSubmitting = ref(false)

function openBatchGroupDialog() {
  batchGroupId.value = null
  showBatchGroupDialog.value = true
}

async function handleBatchGroup() {
  const ids = selectedRows.value.map((r) => r.id)
  if (!ids.length) return
  batchGroupSubmitting.value = true
  try {
    await deviceApi.batchGroup({ ids, group_id: batchGroupId.value ?? null })
    ElMessage.success(`已移动 ${ids.length} 台设备`)
    showBatchGroupDialog.value = false
    selectedRows.value = []
    await Promise.all([search(), loadGroups()])
  } catch (err) {
    ElMessage.error(err.message || '批量移动失败')
  } finally {
    batchGroupSubmitting.value = false
  }
}

/* ------------------------- 统计数据 ------------------------- */
const { data: statData, execute: loadStats } = useAsyncData(deviceApi.stats, {
  initial: { total: 0, online: 0, offline: 0, inactive: 0 },
  silent: true,
  onError: () => {},
})

const statItems = computed(() => {
  const s = statData.value || {}
  return [
    {
      label: '设备总数',
      value: formatNumber(s.total),
      icon: 'Monitor',
      iconBg: 'linear-gradient(135deg, #667eea, #764ba2)',
    },
    {
      label: '在线设备',
      value: formatNumber(s.online),
      icon: 'CircleCheck',
      iconBg: 'linear-gradient(135deg, #43e97b, #38f9d7)',
    },
    {
      label: '离线设备',
      value: formatNumber(s.offline),
      icon: 'Warning',
      iconBg: 'linear-gradient(135deg, #fa709a, #fee140)',
    },
    {
      label: '未激活',
      value: formatNumber(s.inactive),
      icon: 'CircleClose',
      iconBg: 'linear-gradient(135deg, #f093fb, #f5576c)',
    },
  ]
})

/* ------------------------- 产品下拉 ------------------------- */
const productList = ref([])
async function loadProducts() {
  try {
    productList.value = await deviceApi.getProducts()
  } catch (err) {
    ElMessage.error(err.message || '产品列表加载失败')
  }
}

/* ------------------------- 详情抽屉 ------------------------- */
const showDrawer = ref(false)
const drawerDevice = ref(null)
/* ------------------------- 设备影子 ------------------------- */
const shadow = ref({})
const shadowProps = ref([]) // 物模型属性 + desired/reported 值合并视图
const shadowLoading = ref(false)
const shadowSaving = ref(false)
const shadowSavingMsg = ref('')
const desiredForm = reactive({})
let shadowDeviceId = null

/** 产品可写属性（access_mode 含 w） */
const writableProps = computed(() => shadowProps.value.filter((p) => p.access_mode.includes('w')))
const hasDesiredChange = computed(() => {
  const current = shadow.value.desired || {}
  return Object.keys(desiredForm.value || {}).some(
    (k) => desiredForm.value[k] !== undefined && desiredForm.value[k] !== current[k]
  )
})

function formatShadowValue(v) {
  if (typeof v === 'boolean') return v ? '开' : '关'
  return String(v)
}

/** 拉取影子 + 物模型属性，合并为表格视图 */
async function loadShadow(device) {
  shadowDeviceId = device.id
  shadowLoading.value = true
  shadowSavingMsg.value = ''
  try {
    const [sh, props] = await Promise.all([
      shadowApi.get(device.id),
      device.product_id ? productApi.properties(device.product_id) : Promise.resolve([]),
    ])
    if (shadowDeviceId !== device.id) return
    shadow.value = sh || {}
    shadowProps.value = (props || []).map((p) => ({
      ...p,
      desired: sh?.desired?.[p.identifier],
      reported: sh?.reported?.[p.identifier],
    }))
    // 同步趋势图可选指标（物模型数值属性）
    syncTrendMetricOptions(props || [])
    // 初始化期望态编辑表单（默认当前 desired 或空）
    for (const p of writableProps.value) {
      desiredForm[p.identifier] =
        sh?.desired?.[p.identifier] ?? (p.data_type === 'bool' ? false : undefined)
    }
  } catch (err) {
    if (shadowDeviceId === device.id) {
      shadowProps.value = []
      ElMessage.error(err.message || '影子加载失败')
    }
  } finally {
    if (shadowDeviceId === device.id) shadowLoading.value = false
  }
}

async function saveDesired() {
  const device = drawerDevice.value
  if (!device) return
  const desired = {}
  for (const p of writableProps.value) {
    const v = desiredForm[p.identifier]
    if (v !== undefined && v !== '') desired[p.identifier] = v
  }
  if (!Object.keys(desired).length) return

  shadowSaving.value = true
  shadowSavingMsg.value = ''
  try {
    const res = await shadowApi.setDesired(device.id, desired)
    shadowSavingMsg.value = res.delivered
      ? `已下发（v${res.version}），等待设备上报`
      : `已写入（v${res.version}），MQTT 未送达`
    ElMessage.success(shadowSavingMsg.value)
    await loadShadow(device)
  } catch (err) {
    ElMessage.error(err.message || '期望态下发失败')
  } finally {
    shadowSaving.value = false
  }
}

/* ------------------------- 生命周期时间轴 ------------------------- */
const timelineEvents = ref([])
const timelineLoading = ref(false)
let timelineDeviceId = null

const TIMETYPE_LABELS = {
  alert: '告警',
  command: '控制指令',
  upgrade: '固件升级',
  mqtt: 'MQTT',
  shadow: '设备影子',
  lifecycle: '生命周期',
}
function timelineTypeLabel(ev) {
  const base = TIMETYPE_LABELS[ev.type] || ev.type
  if (ev.type === 'alert' && ev.status) {
    return `${base}·${dictValue(ALERT_LEVEL, ev.status, undefined, ev.status)}`
  }
  return base
}
function timelineDotType(ev) {
  const map = {
    alert: 'warning',
    command: 'primary',
    upgrade: 'success',
    mqtt: 'info',
    shadow: 'primary',
    lifecycle: 'success',
  }
  return map[ev.type] || 'info'
}

async function loadTimeline(device) {
  timelineDeviceId = device.id
  timelineLoading.value = true
  try {
    const events = await timelineApi.get(device.id, 100)
    if (timelineDeviceId === device.id) timelineEvents.value = events || []
  } catch (err) {
    if (timelineDeviceId === device.id) {
      timelineEvents.value = []
      ElMessage.error(err.message || '时间轴加载失败')
    }
  } finally {
    if (timelineDeviceId === device.id) timelineLoading.value = false
  }
}

function showDetail(row) {
  drawerDevice.value = row
  showDrawer.value = true
  trendRange.value = '24h'
  loadTrend(row.id)
  loadShadow(row)
  loadTimeline(row)
  if (canControl.value) loadCommands(row.id)
}

/* ------------------------- 远程控制 ------------------------- */

const canControl = computed(() => hasPermission('device:edit'))

/** 指令模板预设 */
const CTRL_COMMANDS = [
  { value: 'reboot', label: '重启设备', params: '' },
  { value: 'sync_time', label: '同步时间', params: '' },
  { value: 'get_status', label: '查询状态', params: '' },
  { value: 'set_config', label: '设置配置', params: '{\n  "interval": 60\n}' },
  { value: 'custom', label: '自定义指令', params: '' },
]

const CTRL_STATUS_MAP = {
  sent: { text: '已发送', type: 'info' },
  delivered: { text: '已送达', type: 'warning' },
  success: { text: '成功', type: 'success' },
  failed: { text: '失败', type: 'danger' },
  timeout: { text: '超时', type: 'info' },
}
function ctrlStatus(s) {
  return CTRL_STATUS_MAP[s] || { text: s || '未知', type: 'info' }
}

const ctrl = reactive({
  command: 'reboot',
  paramsText: '',
  paramsError: '',
  sending: false,
  loadingHistory: false,
})
const commandHistory = ref([])
/** 轮询定时器：发送后等待设备回执 */
let cmdPollTimer = null
/** 记录当前抽屉设备，避免切换后旧轮询覆盖 */
let ctrlDeviceId = null

function onCommandPreset(val) {
  const preset = CTRL_COMMANDS.find((c) => c.value === val)
  ctrl.paramsText = preset?.params || ''
  ctrl.paramsError = ''
}

async function loadCommands(id) {
  ctrlDeviceId = id
  ctrl.loadingHistory = true
  try {
    const list = await deviceApi.commands(id)
    if (ctrlDeviceId === id) commandHistory.value = list || []
  } catch (err) {
    if (ctrlDeviceId === id) ElMessage.error(err.message || '指令历史加载失败')
  } finally {
    if (ctrlDeviceId === id) ctrl.loadingHistory = false
  }
}

/** 解析参数 JSON，非法返回错误提示 */
function parseParams() {
  const text = ctrl.paramsText.trim()
  if (!text) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: `参数不是合法 JSON：${err.message}` }
  }
}

async function sendCommand() {
  const device = drawerDevice.value
  if (!device) return

  const parsed = parseParams()
  if (!parsed.ok) {
    ctrl.paramsError = parsed.error
    return
  }
  ctrl.paramsError = ''

  ctrl.sending = true
  let result
  try {
    result = await deviceApi.command(device.id, {
      command: ctrl.command,
      params: parsed.value,
    })
  } catch (err) {
    ElMessage.error(err.message || '指令下发失败')
    ctrl.sending = false
    return
  }
  ctrl.sending = false

  if (result.delivered) {
    ElMessage.success(`指令「${ctrl.command}」已下发，等待设备回执`)
  } else {
    ElMessage.warning('指令未送达：MQTT 通道不可用，设备可能离线')
  }

  await loadCommands(device.id)
  // 轮询等待回执：每 3s 刷新，直到无 delivered 态或最多 10 次
  startCmdPolling(device.id)
}

function startCmdPolling(id) {
  stopCmdPolling()
  let count = 0
  cmdPollTimer = setInterval(async () => {
    count += 1
    if (count > 10 || ctrlDeviceId !== id) {
      stopCmdPolling()
      return
    }
    await loadCommands(id)
    // 全部指令已到终态（success/failed/timeout）则停止
    const pending = commandHistory.value.some(
      (c) => c.status === 'sent' || c.status === 'delivered'
    )
    if (!pending) stopCmdPolling()
  }, 3000)
}

function stopCmdPolling() {
  if (cmdPollTimer) {
    clearInterval(cmdPollTimer)
    cmdPollTimer = null
  }
}

// 抽屉关闭时停止回执轮询，避免后台空跑
watch(showDrawer, (open) => {
  if (!open) stopCmdPolling()
})

/* ------------------------- 电量 / 信号趋势 ------------------------- */

/** 时间窗预设（与后端 RANGE_PRESETS 对齐） */
const TREND_RANGES = [
  { label: '1小时', value: '1h' },
  { label: '6小时', value: '6h' },
  { label: '24小时', value: '24h' },
  { label: '7天', value: '7d' },
  { label: '30天', value: '30d' },
]

const trendRange = ref('24h')
const trendMetric = ref('battery')
const trendLoading = ref(false)
const trendPoints = ref([]) // [{time, value}]
const trendMeta = ref({ source: '', bucket: 0 })
const trendLabel = ref('电量')
const trendUnit = ref('%')
/** 记录当前加载的设备，避免抽屉切换后旧响应覆盖新设备数据 */
let trendDeviceId = null

/** 可选趋势指标：电量/信号 + 物模型数值属性（loadShadow 后更新） */
const trendMetricOptions = ref([
  { value: 'battery', label: '电量 (%)' },
  { value: 'signal', label: '信号 (dBm)' },
])

function syncTrendMetricOptions(props) {
  const base = [
    { value: 'battery', label: '电量 (%)' },
    { value: 'signal', label: '信号 (dBm)' },
  ]
  const numProps = (props || [])
    .filter((p) => (p.data_type === 'int' || p.data_type === 'float') && p.access_mode.includes('r'))
    .map((p) => ({ value: p.identifier, label: `${p.name}${p.unit ? '(' + p.unit + ')' : ''}` }))
  trendMetricOptions.value = [...base, ...numProps]
  // 当前选中的物模型属性被删除时回退电量
  if (!trendMetricOptions.value.some((o) => o.value === trendMetric.value)) {
    trendMetric.value = 'battery'
  }
}

async function loadTrend(range = trendRange.value) {
  const device = drawerDevice.value
  if (!device) return
  trendDeviceId = device.id
  trendLoading.value = true
  try {
    if (trendMetric.value === 'battery' || trendMetric.value === 'signal') {
      const data = await deviceApi.metrics(device.id, range)
      if (trendDeviceId !== device.id) return
      const points = (data?.points || [])
        .map((p) => ({ time: p.time, value: p[trendMetric.value] }))
        .filter((p) => p.value !== null && p.value !== undefined)
      trendPoints.value = points
      trendMeta.value = { source: data?.source || '', bucket: data?.bucket || 0 }
      trendLabel.value = trendMetric.value === 'battery' ? '电量' : '信号'
      trendUnit.value = trendMetric.value === 'battery' ? '%' : ' dBm'
    } else {
      const data = await shadowApi.propsHistory(device.id, trendMetric.value, range)
      if (trendDeviceId !== device.id) return
      trendPoints.value = data?.points || []
      trendMeta.value = { source: '', bucket: data?.bucket || 0 }
      trendLabel.value = data?.name || trendMetric.value
      trendUnit.value = data?.unit || ''
    }
  } catch (err) {
    if (trendDeviceId === device.id) {
      trendPoints.value = []
      ElMessage.error(err.message || '趋势数据加载失败')
    }
  } finally {
    if (trendDeviceId === device.id) trendLoading.value = false
  }
}

/** 'YYYY-MM-DD HH:MM:SS'（本地时间）→ 时间戳 ms */
function parseLocalTime(str) {
  return new Date(String(str).replace(' ', 'T')).getTime()
}

const trendOption = computed(() => {
  const points = trendPoints.value
  if (!points.length) return {}

  const seriesData = []
  for (const p of points) {
    const ts = parseLocalTime(p.time)
    if (Number.isFinite(ts) && p.value !== null && p.value !== undefined) {
      seriesData.push([ts, Number(p.value)])
    }
  }
  if (!seriesData.length) return {}

  const span = seriesData[seriesData.length - 1][0] - seriesData[0][0]
  const dayMs = 24 * 3600 * 1000
  // 数据太密时缩小滑块默认窗口（约 200 个点），避免长范围下曲线糊成一团
  const windowMs = span > dayMs * 2 ? dayMs : span
  const endTime = seriesData[seriesData.length - 1][0]

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        if (!params?.length) return ''
        const d = new Date(params[0].value[0])
        const pad = (n) => String(n).padStart(2, '0')
        const time = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        return `${time}<br/>${trendLabel.value}：${params[0].value[1]}${trendUnit.value}`
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 44 },
    xAxis: { type: 'time', axisLabel: { fontSize: 10 } },
    yAxis: {
      type: 'value',
      name: trendUnit.value,
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.4 } },
    },
    dataZoom: [
      { type: 'inside', startValue: endTime - windowMs, endValue: endTime },
      {
        type: 'slider',
        height: 16,
        bottom: 6,
        startValue: endTime - windowMs,
        endValue: endTime,
        labelFormatter: (val) => {
          const d = new Date(val)
          const pad = (n) => String(n).padStart(2, '0')
          return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        },
      },
    ],
    series: [
      {
        name: trendLabel.value,
        type: 'line',
        showSymbol: false,
        smooth: true,
        itemStyle: { color: '#409eff' },
        lineStyle: { width: 2, color: '#409eff' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(64,158,255,0.25)' },
              { offset: 1, color: 'rgba(64,158,255,0.02)' },
            ],
          },
        },
        data: seriesData,
      },
    ],
  }
})

/* ------------------------- 固件订阅链接 ------------------------- */
const showSubDialog = ref(false)
const subLoading = ref(false)
const subData = ref(null)
const subRawText = ref('')

/**
 * 一键生成订阅链接
 * 拿到链接后再用该 token 真实请求一次订阅接口：
 *  1. 把设备端将会收到的响应原样展示出来，便于现场核对；
 *  2. 这次请求同时是设备在线心跳 —— 若设备此前未激活，服务端会自动将其置为「在线」，
 *     因此需要把设备档案的状态与时间回填到弹窗，并刷新列表与统计。
 */
async function openSubscribe(row) {
  showSubDialog.value = true
  subLoading.value = true
  subData.value = null
  subRawText.value = ''

  try {
    const link = await subscribeApi.link(row.id)
    subData.value = link

    try {
      const info = await subscribeApi.info(row.id, { token: link.token })
      subRawText.value = JSON.stringify(info, null, 2)

      // 订阅成功会更新设备状态与上线时间，同步回弹窗展示
      if (info?.device) {
        subData.value.device = {
          ...subData.value.device,
          status: info.device.status,
          active_time: info.device.active_time,
          last_online: info.device.last_online,
        }

        if (info.device.status_changed) {
          const label = dictValue(DEVICE_STATUS, info.device.status)
          ElMessage.success(
            info.device.activated ? `设备已自动激活，当前状态：${label}` : `设备已重新上线，当前状态：${label}`
          )
          // 列表与统计卡片同步刷新
          await Promise.all([search(), loadStats()])
        }
      }
    } catch (err) {
      subRawText.value = `订阅信息获取失败：${err.message}`
    }
  } catch (err) {
    ElMessage.error(err.message || '订阅链接生成失败')
    showSubDialog.value = false
  } finally {
    subLoading.value = false
  }
}

async function handleCopy(text) {
  const ok = await copyText(text)
  if (ok) ElMessage.success('已复制到剪贴板')
  else ElMessage.warning('当前浏览器不支持自动复制，请手动选择复制')
}

/* ------------------------- 新增 / 编辑设备 ------------------------- */
const showDialog = ref(false)
const dialogMode = ref('add') // 'add' | 'edit'
const submitting = ref(false)
const formRef = ref(null)
const editingId = ref(null)
const defaultForm = () => ({
  name: '',
  device_name: '',
  product_name: '',
  firmware_version: '',
  location: '',
  group_id: null,
})
const form = ref(defaultForm())
const rules = {
  name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }],
  device_name: [{ required: true, message: '请输入 DeviceName', trigger: 'blur' }],
  product_name: [{ required: true, message: '请选择所属产品', trigger: 'change' }],
}

function openAddDialog() {
  dialogMode.value = 'add'
  editingId.value = null
  form.value = defaultForm()
  showDialog.value = true
}

function openEditDialog(row) {
  dialogMode.value = 'edit'
  editingId.value = row.id
  form.value = {
    name: row.name || '',
    device_name: row.device_name || '',
    product_name: row.product_name || '',
    firmware_version: row.firmware_version || '',
    location: row.location || '',
    group_id: row.group_id ?? null,
  }
  showDialog.value = true
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const product = productList.value.find((p) => p.name === form.value.product_name)

    if (dialogMode.value === 'edit') {
      // 编辑：device_name 不可改，其余字段联动提交
      await deviceApi.update(editingId.value, {
        name: form.value.name,
        product_name: form.value.product_name,
        product_id: product?.id,
        firmware_version: form.value.firmware_version,
        location: form.value.location,
        group_id: form.value.group_id ?? null,
      })
      ElMessage.success('修改成功')
    } else {
      // 新增
      await deviceApi.create({ ...form.value, product_id: product?.id })
      ElMessage.success('添加成功')
      page.value = 1
    }
    showDialog.value = false
    await Promise.all([search(), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || (dialogMode.value === 'edit' ? '修改失败' : '添加失败'))
  } finally {
    submitting.value = false
  }
}

/* ------------------------- 删除 ------------------------- */
const selectedRows = ref([])

async function handleDelete(row) {
  const ok = await confirm(`确认删除设备「${row.name}」？该操作不可恢复。`, '删除确认')
  if (!ok) return
  try {
    await deviceApi.remove(row.id)
    ElMessage.success('已删除')
    await Promise.all([reloadAfterRemove(1), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

async function handleBatchDelete() {
  const ids = selectedRows.value.map((r) => r.id)
  const ok = await confirm(`确认删除选中的 ${ids.length} 个设备？该操作不可恢复。`, '批量删除')
  if (!ok) return
  try {
    await deviceApi.remove(ids)
    ElMessage.success('已批量删除')
    selectedRows.value = []
    await Promise.all([reloadAfterRemove(ids.length), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '批量删除失败')
  }
}

/* ------------------------- 重置 ------------------------- */
function handleReset() {
  keyword.value = ''
  filterProduct.value = ''
  filterStatus.value = ''
  clearGroupFilter()
  reset()
}

onMounted(() => {
  loadProducts()
  loadStats()
  loadGroups()
})
</script>

<style scoped>
/* ---------------- 分组树侧栏 + 主区双栏布局 ---------------- */
.device-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.group-panel {
  flex-shrink: 0;
  width: 230px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
}
.group-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.group-panel__header h4 {
  margin: 0;
  font-size: 14px;
  color: #303133;
}
.device-main {
  flex: 1;
  min-width: 0;
}
.group-node {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  overflow: hidden;
}
.group-node__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-node__label .el-icon {
  color: #909399;
}
.group-node__actions {
  display: none;
  gap: 4px;
  color: #909399;
}
.group-node:hover .group-node__actions {
  display: inline-flex;
}
.group-node__act {
  cursor: pointer;
  font-size: 13px;
}
.group-node__act:hover {
  color: #409eff;
}
.group-node__act--danger:hover {
  color: #f56c6c;
}
.batch-group-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
}
@media (max-width: 960px) {
  .device-layout {
    flex-direction: column;
  }
  .group-panel {
    width: 100%;
  }
}

.metric-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.metric-text {
  font-size: 12px;
  white-space: nowrap;
}
.metric-text.muted,
.muted {
  color: var(--el-text-color-placeholder);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.device-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.device-cell__text {
  min-width: 0;
}
.device-cell__sub {
  font-size: 12px;
  color: #909399;
}
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.drawer-section {
  margin-top: 24px;
}
.drawer-section h4 {
  margin-bottom: 12px;
  font-size: 14px;
  color: #303133;
}
.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.trend-header h4 {
  margin-bottom: 0;
  white-space: nowrap;
}
.trend-chart-wrap {
  min-height: 240px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 8px 4px 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.trend-chart {
  width: 100%;
  height: 240px;
}
.trend-footnote {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

/* ---------------- 设备影子 ---------------- */
.shadow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.shadow-header h4 {
  margin-bottom: 0;
}
.shadow-version {
  font-size: 12px;
  color: #909399;
  font-family: Consolas, Monaco, monospace;
}
.shadow-body {
  min-height: 60px;
}
.shadow-desired {
  color: #e6a23c;
  font-weight: 500;
}
.shadow-empty {
  color: #c0c4cc;
}
.shadow-edit {
  margin-top: 12px;
  padding: 12px;
  border: 1px dashed #ebeef5;
  border-radius: 6px;
}
.shadow-edit__title {
  margin-bottom: 10px;
  font-size: 12px;
  color: #909399;
}
.shadow-edit__row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.shadow-edit__label {
  min-width: 130px;
  font-size: 13px;
  color: #303133;
}
.shadow-edit__id {
  color: #909399;
  font-size: 11px;
  margin-left: 4px;
}
.shadow-edit__msg {
  margin-left: 8px;
  font-size: 12px;
  color: #67c23a;
}

/* ---------------- 生命周期时间轴 ---------------- */
.timeline-body {
  max-height: 360px;
  overflow-y: auto;
  padding: 4px 4px 0;
}
.timeline-list {
  padding-left: 4px;
}
.timeline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.timeline-type {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.6;
}
.timeline-type--alert {
  background: #fef0f0;
  color: #f56c6c;
}
.timeline-type--command {
  background: #ecf5ff;
  color: #409eff;
}
.timeline-type--upgrade {
  background: #f0f9eb;
  color: #67c23a;
}
.timeline-type--mqtt {
  background: #f4f4f5;
  color: #909399;
}
.timeline-type--shadow {
  background: #fdf6ec;
  color: #e6a23c;
}
.timeline-type--lifecycle {
  background: #f0f9eb;
  color: #67c23a;
}
.timeline-title {
  font-size: 13px;
  color: #303133;
  word-break: break-all;
}
.timeline-detail {
  margin-top: 2px;
  font-size: 12px;
  color: #909399;
  word-break: break-all;
}

/* ---------------- 远程控制 ---------------- */
.ctrl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.ctrl-header h4 {
  margin-bottom: 0;
  white-space: nowrap;
}
.ctrl-form {
  margin-bottom: 12px;
}
.ctrl-error {
  margin-top: 4px;
  font-size: 12px;
  color: #f56c6c;
  line-height: 1.5;
}
.ctrl-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
.ctrl-history {
  margin-top: 12px;
  max-height: 280px;
  overflow-y: auto;
  border-top: 1px dashed #ebeef5;
  padding-top: 8px;
}
.ctrl-item {
  padding: 8px 0;
  border-bottom: 1px dashed #f0f2f5;
}
.ctrl-item:last-child {
  border-bottom: none;
}
.ctrl-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ctrl-item__cmd {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}
.ctrl-item__time {
  margin-left: auto;
  font-size: 11px;
  color: #909399;
}
.ctrl-item__params,
.ctrl-item__result {
  margin-top: 4px;
  padding: 6px 8px;
  background: #f5f7fa;
  border-radius: 4px;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  color: #606266;
  line-height: 1.5;
  word-break: break-all;
}
.ctrl-item__result {
  background: #fef0f0;
  color: #f56c6c;
}
.prop-card {
  margin-bottom: 12px;
}
.prop-card__name {
  font-size: 12px;
  color: #909399;
}
.prop-card__value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-top: 4px;
}

/* ---------------- 固件订阅链接对话框 ---------------- */
.sub-body {
  min-height: 160px;
}
.sub-alert,
.sub-desc,
.sub-block {
  margin-bottom: 16px;
}
.sub-block__title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.sub-url {
  display: flex;
  gap: 8px;
}
.sub-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #909399;
}
.sub-hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #606266;
  font-family: Consolas, Monaco, monospace;
  word-break: break-all;
}
.sub-hint--accent {
  margin-top: 4px;
  color: #409eff;
}
.sub-hint--accent strong {
  font-weight: 600;
}
.sub-details {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.sub-details > summary {
  cursor: pointer;
  font-size: 13px;
  color: #606266;
  user-select: none;
}
.sub-json {
  margin: 8px 0 0;
  padding: 12px;
  max-height: 240px;
  overflow: auto;
  border-radius: 4px;
  background: #f5f7fa;
  color: #303133;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.sub-json--tall {
  max-height: 340px;
}
.sub-details__actions {
  margin-top: 4px;
  text-align: right;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  word-break: break-all;
}
.link {
  color: #409eff;
  text-decoration: none;
}
.muted {
  color: #c0c4cc;
}
</style>
