<script>
export default {
  onLaunch() {
    // 首次启动：未登录则去登录页
    const token = uni.getStorageSync('token')
    if (!token) {
      uni.reLaunch({ url: '/pages/login/login' })
    }
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
