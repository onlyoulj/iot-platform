<template>
  <div class="auth-page">
    <div class="auth-stage" :class="mode === 'register' && allowRegister ? 'is-register' : 'is-login'">
      <!-- 左半：注册表单（注册态露出） -->
      <section v-if="allowRegister" class="pane pane--register">
        <div class="pane__inner">
          <div class="pane__head">
            <el-icon :size="30" color="#409eff"><Connection /></el-icon>
            <h2>创建账号</h2>
            <p>加入平台，开启设备管理之旅</p>
          </div>

          <el-form
            ref="registerFormRef"
            :model="registerForm"
            :rules="registerRules"
            label-position="top"
            size="large"
            @keyup.enter="handleRegister"
          >
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="用户名" prop="username">
                  <el-input v-model="registerForm.username" placeholder="字母开头 3-20 位" clearable />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="昵称" prop="nickname">
                  <el-input v-model="registerForm.nickname" placeholder="选填" clearable />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :span="12">
                <el-form-item label="密码" prop="password">
                  <el-input v-model="registerForm.password" type="password" placeholder="6-32 位" show-password />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="确认密码" prop="confirm">
                  <el-input v-model="registerForm.confirm" type="password" placeholder="再次输入" show-password />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="邮箱" prop="email">
              <el-input v-model="registerForm.email" placeholder="选填，用于找回密码" clearable />
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

          <p class="pane-switch">
            已有账号？
            <el-link type="primary" underline="never" @click="switchMode('login')">返回登录</el-link>
          </p>
        </div>
      </section>

      <!-- 右半：登录表单（登录态露出） -->
      <section class="pane pane--login">
        <div class="pane__inner">
          <div class="pane__head">
            <el-icon :size="30" color="#409eff"><Connection /></el-icon>
            <h2>欢迎回来</h2>
            <p>IoT 物联网管理平台</p>
          </div>

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

          <p class="pane-switch">
            还没有账号？
            <el-link v-if="allowRegister" type="primary" underline="never" @click="switchMode('register')">
              立即注册
            </el-link>
            <span v-else class="pane-switch__muted">请联系管理员开通</span>
          </p>
        </div>
      </section>

      <!-- 视觉面板：登录态盖住左侧注册表单，注册态滑到右侧盖住登录表单 -->
      <aside class="visual" aria-hidden="true">
        <img class="visual__img" :src="authVisual" alt="" />
        <div class="visual__shade"></div>

        <div class="visual__body">
          <div class="visual__brand">
            <el-icon :size="26" color="#fff"><Connection /></el-icon>
            <span>IoT 物联网管理平台</span>
          </div>

          <Transition name="visual-fade" mode="out-in">
            <div v-if="mode === 'login' || !allowRegister" key="login" class="visual__foot">
              <h3>设备接入 · 固件订阅<br />OTA 升级 · 告警监控</h3>
              <p>一站式管理您的物联网设备</p>
              <template v-if="allowRegister">
                <span class="visual__ask">还没有账号？</span>
                <button type="button" class="visual__btn" @click="switchMode('register')">立即注册</button>
              </template>
            </div>
            <div v-else key="register" class="visual__foot">
              <h3>只需一步<br />即可接入您的设备</h3>
              <p>注册后默认归入只读访客组</p>
              <span class="visual__ask">已有账号？</span>
              <button type="button" class="visual__btn" @click="switchMode('login')">返回登录</button>
            </div>
          </Transition>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/element'
import { authApi } from '@/utils/api'
import { setSession } from '@/utils/auth'
import authVisual from '@/assets/auth-visual.png'

const route = useRoute()
const router = useRouter()

const mode = ref('login')
const loading = ref(false)
// 注册开关：由登录页探测后端配置（后端未开放时隐藏注册面板与切换入口）
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

/** 登录态 ⇄ 注册态：视觉面板在左右半区之间侧滑互换 */
function switchMode(next) {
  if (next === 'register' && !allowRegister.value) return
  mode.value = next
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
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 15% 20%, rgba(64, 158, 255, 0.28), transparent 45%),
    radial-gradient(circle at 85% 80%, rgba(118, 75, 162, 0.28), transparent 45%),
    #1d1e2c;
  padding: 24px;
}

/* ---------------- 中央大容器 ---------------- */
.auth-stage {
  position: relative;
  display: flex;
  width: 100%;
  max-width: 960px;
  height: 640px;
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
}

/* ---------------- 表单半区 ---------------- */
.pane {
  width: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 44px;
}

/* 登录态：注册表单淡出（被视觉面板盖住），登录表单浮现 */
.pane--register { order: 0; }
.pane--login    { order: 1; }

.pane__inner {
  width: 100%;
  max-width: 340px;
  transition: opacity 0.45s ease 0.2s;
}

/* 登录态：左侧注册表单隐藏；注册态：右侧登录表单隐藏 */
.is-login  .pane--register .pane__inner,
.is-register .pane--login .pane__inner {
  opacity: 0;
  pointer-events: none;
  transition-delay: 0s;
}

.pane__head {
  margin-bottom: 22px;
}
.pane__head h2 {
  margin: 10px 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: #1d1e2c;
}
.pane__head p {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.submit-btn {
  width: 100%;
  margin-top: 4px;
  letter-spacing: 4px;
}

.register-note {
  margin-top: 14px;
}
.register-note :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.5;
}

.pane-switch {
  display: none;
  margin: 16px 0 0;
  text-align: center;
  font-size: 13px;
  color: #909399;
}
.pane-switch__muted {
  color: #c0c4cc;
}

/* ---------------- 视觉面板（图片层） ---------------- */
.visual {
  position: absolute;
  top: 0;
  left: 0;
  width: 50%;
  height: 100%;
  z-index: 2;
  overflow: hidden;
  /* 登录态贴左，注册态无缝滑到右侧 */
  transform: translateX(0);
  transition: transform 0.7s cubic-bezier(0.65, 0, 0.35, 1);
}
.is-register .visual {
  transform: translateX(100%);
}

.visual__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 深色渐变遮罩：保证文字可读 + 与页面底色衔接 */
.visual__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(29, 30, 44, 0.55) 0%,
    rgba(29, 30, 44, 0.15) 40%,
    rgba(29, 30, 44, 0.82) 100%
  );
}

.visual__body {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 32px 36px;
}

.visual__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.visual__foot h3 {
  margin: 0 0 8px;
  font-size: 20px;
  line-height: 1.55;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}
.visual__foot p {
  margin: 0 0 22px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

.visual__ask {
  display: block;
  margin-bottom: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}

.visual__btn {
  display: inline-block;
  padding: 10px 36px;
  font-size: 14px;
  color: #fff;
  background: transparent;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 22px;
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease, transform 0.15s ease;
}
.visual__btn:hover {
  background: #fff;
  color: #1d1e2c;
}
.visual__btn:active {
  transform: scale(0.96);
}

/* 视觉面板文案切换淡入淡出 */
.visual-fade-enter-active,
.visual-fade-leave-active {
  transition: opacity 0.3s ease;
}
.visual-fade-enter-from,
.visual-fade-leave-to {
  opacity: 0;
}

/* ---------------- 窄屏降级：视觉面板固定顶部，表单纵向堆叠 ---------------- */
@media (max-width: 860px) {
  .auth-stage {
    flex-direction: column;
    height: auto;
    max-width: 460px;
  }
  .visual {
    position: relative;
    width: 100%;
    height: 220px;
    transform: none !important;
    transition: none;
    order: -1;
    flex-shrink: 0;
  }
  .visual__body {
    padding: 20px 24px;
  }
  .visual__foot h3 {
    font-size: 16px;
  }
  .visual__foot p,
  .visual__ask {
    display: none;
  }
  .visual__btn {
    padding: 7px 26px;
    font-size: 13px;
  }
  .pane {
    width: 100%;
    padding: 28px 26px;
  }
  /* 窄屏下非活动表单直接收起（不做侧滑） */
  .is-login  .pane--register,
  .is-register .pane--login {
    display: none;
  }
  .pane__inner {
    opacity: 1 !important;
    pointer-events: auto !important;
  }
  .pane-switch {
    display: block;
  }
}
</style>
