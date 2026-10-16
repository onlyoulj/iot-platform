package com.iot.mobile;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * IoT 移动端套壳：WebView 加载打包内置的 uni-app H5 产物（assets/h5）。
 * 页面内所有请求（API /uploads）由 H5 内的 baseURL 配置指向局域网后端；
 * 外部链接（http/https 之外的 scheme）交系统处理。
 */
public class MainActivity extends Activity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 状态栏与页面同色（白底）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        getWindow().requestFeature(Window.FEATURE_NO_TITLE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);          // uni storage / 登录凭证持久化依赖
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true); // assets 内 H5 相对资源加载
        settings.setAllowUniversalAccessFromFileURLs(true); // file:// 页面请求 http 后端（局域网）
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(settings.getUserAgentString() + " iot-mobile-app/1.0.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 全部由 WebView 内部处理（hash 路由、API 请求）
                return false;
            }
        });

        webView.loadUrl("file:///android_asset/h5/index.html");
    }

    @Override
    public void onBackPressed() {
        // H5 内部可返回则先返回，否则最小化到桌面（不销毁，保活登录态）
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
