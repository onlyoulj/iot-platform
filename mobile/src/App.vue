<script>
export default {
  onLaunch() {
    // 登录凭证持久化 + 自动验证：
    // - token/user 存本地存储（uni storage），冷启动直接复用，无需重新登录
    // - 启动页为概览页：有 token 直接进入，后台静默调 /auth/me 校验并刷新用户资料
    //   （头像/积分/权限可能已在别处变更）；失效（401）由 request.js 统一清会话跳登录
    // - 无 token 则 reLaunch 到登录页
    const token = uni.getStorageSync('token')
    if (!token) {
      uni.reLaunch({ url: '/pages/login/login' })
      return
    }
    import('./utils/api').then(({ authApi }) => {
      authApi
        .me({ silent: true })
        .then((profile) => {
          if (profile) uni.setStorageSync('user', profile)
        })
        .catch(() => {})
    })
  },
}
</script>

<style>
page {
  background-color: #f5f6fa;
  font-size: 28rpx;
  color: #30343d;
}

.card {
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin: 20rpx 24rpx;
}

.btn-primary {
  background: #2b6de8;
  color: #ffffff;
  border-radius: 44rpx;
  font-size: 30rpx;
}

.btn-primary[disabled] {
  opacity: 0.55;
  color: #ffffff;
}
</style>

