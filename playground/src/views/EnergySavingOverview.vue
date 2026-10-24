<template>
  <div class="energy-overview-page">
    <!-- 顶部筛选区域 -->
    <a-card style="margin-bottom: 24px;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
          <!-- 1. 地市选择 (模拟存在隐藏下拉菜单的同构 DOM) -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 500;">🌍 所属区域:</span>
            <a-dropdown :trigger="['click']">
              <a class="ant-dropdown-link theme-dropdown-link" id="city-link">
                <span>{{ selectedCity }}</span>
                <DownOutlined />
              </a>
              <template #overlay>
                <a-menu @click="handleCitySelect">
                  <a-menu-item key="3300">浙江省 (全省)</a-menu-item>
                  <a-menu-item key="3301">杭州市</a-menu-item>
                  <a-menu-item key="3302">宁波市</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>

          <!-- 2. 日期选择 (无 href 的自定义 a 标签) -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 500;">📅 统计日期:</span>
            <a-dropdown v-model:open="dateDropdownOpen" :trigger="['click']">
              <a class="ant-dropdown-link theme-dropdown-link" id="date-link">
                <span id="date-text">{{ selectedDate }}</span>
                <DownOutlined />
              </a>
              <template #overlay>
                <a-menu @click="handleDateSelect">
                  <a-menu-item key="2026-10-20" data-menu-id="2026-10-20">2026-10-20</a-menu-item>
                  <a-menu-item key="2026-10-21" data-menu-id="2026-10-21">2026-10-21</a-menu-item>
                  <a-menu-item key="2026-10-22" data-menu-id="2026-10-22">2026-10-22</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>

          <!-- 3. 网络维度 (无 href 的自定义 a 标签) -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 500;">📶 网络制式:</span>
            <a class="ant-dropdown-link theme-dropdown-link" id="net-link" @click="toggleNet">
              <span id="net-text">{{ selectedNet }}</span>
              <DownOutlined />
            </a>
          </div>

          <!-- 4. 场景下拉 (空数据空态，展示 ant-select-dropdown-empty) -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 500;">💡 场景模式:</span>
            <a-select
              id="scene-select"
              v-model:value="selectedScene"
              placeholder="场景节能模式"
              :options="[]"
              style="width: 180px;"
            />
          </div>
        </div>

        <div>
          <!-- 5. 设置按钮，唤起 Modal 弹窗 -->
          <a-button id="setting-btn" @click="showSettingModal = true">设 置</a-button>
        </div>
      </div>
    </a-card>

    <!-- 模拟留存的隐藏同构 Dropdown DOM (测试可见性仲裁跳过隐藏节点) -->
    <div class="ant-dropdown ant-dropdown-hidden ant-dropdown-placement-bottomLeft" style="display: none !important;">
      <ul class="ant-dropdown-menu" role="menu">
        <li class="ant-dropdown-menu-item" role="menuitem" data-menu-id="hidden-1">隐藏历史项-1</li>
        <li class="ant-dropdown-menu-item" role="menuitem" data-menu-id="hidden-2">隐藏历史项-2</li>
      </ul>
    </div>

    <!-- 实时指标卡片看板 (供自动化测试断言) -->
    <a-row :gutter="16" style="margin-bottom: 24px;">
      <a-col :span="6">
        <a-card>
          <a-statistic title="当前统计日期" :value="selectedDate">
            <template #prefix><CalendarOutlined /></template>
          </a-statistic>
          <div style="margin-top: 8px;">
            徽章状态: <span class="status-badge" id="badge-date">{{ selectedDate }}</span>
          </div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic title="当前网络制式" :value="selectedNet">
            <template #prefix><WifiOutlined /></template>
          </a-statistic>
          <div style="margin-top: 8px;">
            徽章状态: <span class="status-badge" id="badge-net">{{ selectedNet }}</span>
          </div>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic title="全天节电总量" :precision="1" :value="14820.5" suffix="kWh">
            <template #prefix><ThunderboltOutlined style="color: #faad14;" /></template>
          </a-statistic>
          <a-progress :percent="86" stroke-color="#52c41a" status="active" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic title="最后交互反馈" :value="lastAction">
            <template #prefix><CheckCircleOutlined style="color: #52c41a;" /></template>
          </a-statistic>
          <div style="margin-top: 8px;">
            动作记录: <span class="status-badge" id="badge-action" style="background: #f6ffed; color: #52c41a;">{{ lastAction }}</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 节能业务图表与明细数据卡片 -->
    <a-card title="各地市节能效果分布与 24 小时节电监控">
      <a-empty v-if="selectedScene === null && !selectedCity" description="暂无场景筛选数据" />
      <div v-else style="padding: 16px 0;">
        <a-alert
          message="节能运行概览"
          :description="`当前正在监控 [${selectedCity}] 在 [${selectedDate}] 的 [${selectedNet}] 运行状态，能耗策略调度正常执行中。`"
          type="success"
          show-icon
          style="margin-bottom: 16px;"
        />
        <a-table
          :dataSource="tableData"
          :columns="columns"
          rowKey="id"
          :pagination="{ pageSize: 5 }"
        />
      </div>
    </a-card>

    <!-- 设置弹窗 (Ant Design Modal) -->
    <a-modal
      v-model:open="showSettingModal"
      title="⚙️ 节能概览板块显隐设置"
      @ok="handleSaveModal"
      @cancel="showSettingModal = false"
    >
      <div style="padding: 12px 0;">
        <p style="margin-bottom: 12px; color: #666;">勾选或取消勾选对应的概览展示板块：</p>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <a-checkbox v-model:checked="panels.overview" id="chk-overview">概览指标卡片</a-checkbox>
          <a-checkbox v-model:checked="panels.charts" id="chk-charts">24小时与一周节电图表</a-checkbox>
          <a-checkbox v-model:checked="panels.table" id="chk-table">地市节能明细表格</a-checkbox>
        </div>
      </div>
      <template #footer>
        <a-button id="modal-cancel-btn" @click="showSettingModal = false">取 消</a-button>
        <a-button id="modal-ok-btn" type="primary" @click="handleSaveModal">保 存</a-button>
      </template>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { message } from "ant-design-vue";
import {
  DownOutlined,
  CalendarOutlined,
  WifiOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons-vue";

const selectedCity = ref("浙江省 / 杭州市");
const selectedDate = ref("2026-10-22");
const selectedNet = ref("4G能耗");
const selectedScene = ref<string | null>(null);
const lastAction = ref("就绪");
const dateDropdownOpen = ref(true); // 初始保持可见以供可见性仲裁快速测试
const showSettingModal = ref(false);

const panels = ref({
  overview: true,
  charts: true,
  table: true,
});

function handleCitySelect(e: any) {
  const map: Record<string, string> = {
    "3300": "浙江省 (全省)",
    "3301": "浙江省 / 杭州市",
    "3302": "浙江省 / 宁波市",
  };
  selectedCity.value = map[e.key] || "浙江省 / 杭州市";
  lastAction.value = `切换城市至 ${selectedCity.value}`;
}

function handleDateSelect(e: any) {
  selectedDate.value = String(e.key);
  lastAction.value = `切换日期至 ${e.key}`;
  dateDropdownOpen.value = false;
  message.success(`已切换统计日期为 ${e.key}`);
}

function toggleNet() {
  selectedNet.value = selectedNet.value === "4G能耗" ? "5G能耗" : "4G能耗";
  lastAction.value = `切换维度至 ${selectedNet.value}`;
}

function handleSaveModal() {
  showSettingModal.value = false;
  lastAction.value = "保存板块设置配置";
  message.success("板块显隐配置已保存！");
}

const columns = [
  { title: "地市名称", dataIndex: "city", key: "city" },
  { title: "基站在线总数", dataIndex: "totalStations", key: "totalStations" },
  { title: "节能开启基站", dataIndex: "savingStations", key: "savingStations" },
  { title: "节电量 (kWh)", dataIndex: "kwh", key: "kwh" },
  { title: "节能综合比率", dataIndex: "rate", key: "rate" },
];

const tableData = ref([
  { id: 1, city: "杭州市", totalStations: 12540, savingStations: 10830, kwh: 5820.4, rate: "86.4%" },
  { id: 2, city: "宁波市", totalStations: 9820, savingStations: 8240, kwh: 4310.2, rate: "83.9%" },
  { id: 3, city: "温州市", totalStations: 8430, savingStations: 6910, kwh: 3120.8, rate: "82.0%" },
  { id: 4, city: "嘉兴市", totalStations: 5210, savingStations: 4420, kwh: 2180.0, rate: "84.8%" },
  { id: 5, city: "绍兴市", totalStations: 6100, savingStations: 5190, kwh: 2540.6, rate: "85.1%" },
]);
</script>

<style scoped>
.energy-overview-page {
  padding: 0;
}
a.theme-dropdown-link {
  color: #1890ff;
  text-decoration: none;
  cursor: pointer;
  padding: 6px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  transition: all 0.2s;
}
a.theme-dropdown-link:hover {
  border-color: #40a9ff;
  color: #40a9ff;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: #e6f7ff;
  color: #1890ff;
  font-size: 13px;
  font-weight: 500;
}
</style>
