<template>
  <view class="pwd-page anim-page">
    <view class="card anim-rise">
      <view class="field">
        <text class="label">原密码</text>
        <input class="input" v-model="form.oldPassword" password placeholder="请输入原密码" placeholder-class="ph" />
      </view>
      <view class="field">
        <text class="label">新密码</text>
        <input class="input" v-model="form.newPassword" password placeholder="6-32位，字母/数字/符号至少两种" placeholder-class="ph" />
      </view>
      <view class="field">
        <text class="label">确认新密码</text>
        <input class="input" v-model="form.confirm" password placeholder="再次输入新密码" placeholder-class="ph" />
      </view>
      <button class="btn-primary" :disabled="loading" @click="submit">
        {{ loading ? '提交中…' : '确认修改' }}
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { authApi } from '../../utils/api'

const form = ref({ oldPassword: '', newPassword: '', confirm: '' })
const loading = ref(false)

async function submit() {
  const { oldPassword, newPassword, confirm } = form.value
  if (!oldPassword || !newPassword) {
    return uni.showToast({ title: '请填写完整', icon: 'none' })
  }
  if (newPassword !== confirm) {
    return uni.showToast({ title: '两次输入的新密码不一致', icon: 'none' })
  }
  loading.value = true
  try {
    await authApi.password({ oldPassword, newPassword })
    uni.showModal({
      title: '修改成功',
      content: '请使用新密码重新登录',
      showCancel: false,
      success: () => {
        uni.removeStorageSync('token')
        uni.removeStorageSync('user')
        uni.reLaunch({ url: '/pages/login/login' })
      },
    })
  } catch (e) {
    // 统一 toast
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.field {
  margin-bottom: 28rpx;
}
.label {
  font-size: 26rpx;
  color: #5a6070;
  margin-bottom: 12rpx;
  display: block;
}
.input {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.ph {
  color: #b3b8c2;
}
</style>
