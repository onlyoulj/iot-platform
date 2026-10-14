<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand">
        <el-icon :size="34" color="#409eff"><Connection /></el-icon>
        <h1>IoT 物联网管理平台</h1>
        <p>设备接入 · 固件订阅 · OTA 升级 · 告警监控</p>
      </div>

      <el-tabs v-model="mode" class="auth-tabs" stretch>
        <!-- ---------------- 登录 ---------------- -->
        <el-tab-pane label="登录" name="login">
          <el-form
            ref="loginFormRef"
            :model="loginForm"
            :rules="loginRules"
            label-position="top"
            size="large"
            @keyup.enter="handleLogin"
          >
            <el-form-item label="用户名" prop="username">
              <el-input v-model="loginForm.username" placeholder="请输入用户名" clearable>
                <template #prefix><el-icon><User /></el-icon></template>
              </el-input>
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="请输入密码"
                show-password
                clearable
              >
                <template #prefix><el-icon><Lock /></el-icon></template>
              </el-input>
            </el-form-item>
            <el-button type="primary" class="submit-btn" :loading="loading" @click="handleLogin">
              登 录
            </el-button>
          </el-form>

          <p v-if="allowRegister" class="switch-tip">
            还没有账号？<el-link type="primary" underline="never" @click="mode = 'register'">
              立即注册
            </el-link>
          </p>
        </el-tab-pane>

        <!-- ---------------- 注册 ---------------- -->
        <el-tab-pane v-if="allowRegister" label="注册" name="register">
          <el-form
            ref="registerFormRef"
            :model="registerForm"
            :rules="registerRules"
            label-position="top"
            size="large"
            @keyup.enter="handleRegister"
          >
            <el-form-item label="用户名" prop="username">
              <el-input v-model="registerForm.username" placeholder="字母开头，3-20 位" clearable />
            </el-form-item>
            <el-form-item label="昵称" prop="nickname">
              <el-input v-model="registerForm.nickname" placeholder="选填，默认与用户名一致" clearable />
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input v-model="registerForm.password" type="password" placeholder="6-32 位，至少含两种字符" show-password />
            </el-form-item>
            <el-form-item label="确认密码" prop="confirm">
              <el-input v-model="registerForm.confirm" type="password" placeholder="再次输入密码" show-password />
            </el-form-item>
            <el-form-item label="邮箱" prop="email">
              <el-input v-model="registerForm.email" placeholder="选填" clearable />
            </el-form-item>
            <el-button type="primary" class="submit-btn" :loading="loading" @click="handleRegister">
              注 册
            </el-button>
          </el-form>

          <el-alert
            class="register-note"
            type="info"
            :closable="false"
            show-icon
            title="注册账号默认归入「只读访客」组，仅可查看数据；如需更多权限请联系管理员。"
          />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/element'
import { authApi } from '@/utils/api'
import { setSession } from '@/utils/auth'

const route = useRoute()
const router = useRouter()

const mode = ref('login')
const loading = ref(false)
// 注册开关：由登录页探测后端配置（后端未开放时隐藏注册页签）
const allowRegister = ref(true)

const loginFormRef = ref()
const registerFormRef = ref()

const loginForm = reactive({ username: '', password: '' })
const registerForm = reactive({ username: '', nickname: '', password: '', confirm: '', email: '' })

const loginRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

const registerRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/,
      message: '字母开头，可含数字与下划线，长度 3-20 位',
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 32, message: '密码长度 6-32 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== registerForm.password) callback(new Error('两次输入的密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}

/** 登录成功后跳回被拦截的目标页，默认仪表盘 */
function redirectAfterAuth() {
  const target = route.query.redirect
  router.replace(typeof target === 'string' && target.startsWith('/') ? target : '/dashboard')
}

async function handleLogin() {
  const valid = await loginFormRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const data = await authApi.login({ ...loginForm })
    setSession({ token: data.token, user: data.user })
    ElMessage.success(`欢迎回来，${data.user.nickname || data.user.username}`)
    redirectAfterAuth()
  } catch (err) {
    ElMessage.error(err.message || '登录失败')
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  const valid = await registerFormRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const { confirm, ...payload } = registerForm
    const data = await authApi.register(payload)
    setSession({ token: data.token, user: data.user })
    ElMessage.success(`注册成功，已加入「${data.default_group || '只读访客'}」用户组`)
    redirectAfterAuth()
  } catch (err) {
    ElMessage.error(err.message || '注册失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (route.query.mode === 'register' && allowRegister.value) mode.value = 'register'
})
</script>

<style scoped>
.auth-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 15% 20%, rgba(64, 158, 255, 0.28), transparent 45%),
    radial-gradient(circle at 85% 80%, rgba(118, 75, 162, 0.28), transparent 45%),
    #1d1e2c;
  padding: 24px;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 14px;
  padding: 32px 36px 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
}

.brand {
  text-align: center;
  margin-bottom: 18px;
}
.brand h1 {
  font-size: 20px;
  font-weight: 700;
  color: #1d1e2c;
  margin: 10px 0 6px;
}
.brand p {
  font-size: 12px;
  color: #909399;
  margin: 0;
}

.auth-tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
}

.submit-btn {
  width: 100%;
  margin-top: 4px;
}

.switch-tip {
  margin: 14px 0 0;
  text-align: center;
  font-size: 13px;
  color: #909399;
}

.register-note {
  margin-top: 14px;
}
</style>
