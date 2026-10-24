<template>
  <a-layout style="min-height: 100vh">
    <!-- 侧边栏 -->
    <a-layout-sider v-model:collapsed="collapsed" collapsible width="240">
      <div class="logo">
        <span v-if="!collapsed">🔥 企业级中台管理系统</span>
        <span v-else>🔥</span>
      </div>
      <a-menu v-model:selectedKeys="selectedMenu" theme="dark" mode="inline">
        <a-menu-item key="dashboard" @click="$router.push('/')">
          <template #icon><DashboardOutlined /></template>
          <span>仪表盘总览</span>
        </a-menu-item>
        <a-sub-menu key="wireless">
          <template #icon><ThunderboltOutlined /></template>
          <template #title>无线节能管理</template>
          <a-menu-item key="energy-overview" @click="$router.push('/WirelessPowerSaving/EnergySavingOverview')">
            节能概览页面
          </a-menu-item>
        </a-sub-menu>
        <a-sub-menu key="business">
          <template #icon><AppstoreOutlined /></template>
          <template #title>业务管理</template>
          <a-menu-item key="orders">订单中心</a-menu-item>
          <a-menu-item key="products">商品管理</a-menu-item>
          <a-menu-item key="users">用户画像</a-menu-item>
        </a-sub-menu>
        <a-sub-menu key="system">
          <template #icon><SettingOutlined /></template>
          <template #title>系统设置</template>
          <a-menu-item key="security">安全策略</a-menu-item>
          <a-menu-item key="logs">审计日志</a-menu-item>
        </a-sub-menu>
      </a-menu>
    </a-layout-sider>

    <a-layout>
      <!-- 顶部 Header -->
      <a-layout-header style="background: #fff; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 4px rgba(0,21,41,.08); z-index: 9;">
        <div style="display: flex; align-items: center; gap: 16px;">
          <a-button type="text" @click="collapsed = !collapsed">
            <MenuUnfoldOutlined v-if="collapsed" />
            <MenuFoldOutlined v-else />
          </a-button>
          <a-breadcrumb>
            <a-breadcrumb-item>首页</a-breadcrumb-item>
            <a-breadcrumb-item>{{ currentBreadcrumbParent }}</a-breadcrumb-item>
            <a-breadcrumb-item>{{ currentBreadcrumbTitle }}</a-breadcrumb-item>
          </a-breadcrumb>
        </div>

        <div style="display: flex; align-items: center; gap: 20px;">
          <a-input-search
            v-model:value="headerSearch"
            placeholder="搜索全站资源、订单、组件..."
            style="width: 260px"
            @search="onHeaderSearch"
          />
          <a-badge :count="12">
            <a-button shape="circle">
              <template #icon><BellOutlined /></template>
            </a-button>
          </a-badge>
          <a-dropdown>
            <a class="ant-dropdown-link" @click.prevent style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
              <a-avatar src="https://api.dicebear.com/7.x/miniavs/svg?seed=1" />
              <span>超级管理员 (Admin)</span>
              <DownOutlined />
            </a>
            <template #overlay>
              <a-menu>
                <a-menu-item key="profile">个人中心</a-menu-item>
                <a-menu-item key="settings">账户设置</a-menu-item>
                <a-menu-divider />
                <a-menu-item key="logout" @click="handleLogout">退出登录</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </a-layout-header>

      <!-- 主工作区：通过 Vue Router 承载对应视图页面 -->
      <a-layout-content style="margin: 24px 24px 0; overflow: initial;">
        <router-view />
      </a-layout-content>

      <!-- 底部版权声明 -->
      <a-layout-footer style="text-align: center; color: #888; font-size: 13px;">
        dsh-browser-view Playground · 企业级 Ant Design Vue 真实全场景
      </a-layout-footer>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute } from "vue-router";
import { message } from "ant-design-vue";
import {
  DashboardOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  BellOutlined,
  DownOutlined,
} from "@ant-design/icons-vue";

const route = useRoute();
const collapsed = ref(false);
const selectedMenu = ref(["dashboard"]);
const headerSearch = ref("");

const currentBreadcrumbParent = computed(() => {
  if (route.path.includes("WirelessPowerSaving")) return "无线节能管理";
  return "业务中心";
});

const currentBreadcrumbTitle = computed(() => {
  if (route.path.includes("WirelessPowerSaving")) return "节能概览";
  return "全场景复杂控制台";
});

function onHeaderSearch(val: string) {
  if (val) message.info(`正在全站检索关键词: ${val}`);
}

function handleLogout() {
  message.success("已安全注销登录态");
}
</script>

<style scoped>
.logo {
  height: 48px;
  margin: 16px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
  font-size: 15px;
  letter-spacing: 0.5px;
  transition: all 0.3s;
}
</style>
