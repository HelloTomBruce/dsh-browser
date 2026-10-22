<template>
  <a-layout style="min-height: 100vh">
    <!-- 侧边栏 -->
    <a-layout-sider v-model:collapsed="collapsed" collapsible width="240">
      <div class="logo">
        <span v-if="!collapsed">🔥 企业级中台管理系统</span>
        <span v-else>🔥</span>
      </div>
      <a-menu v-model:selectedKeys="selectedMenu" theme="dark" mode="inline">
        <a-menu-item key="dashboard">
          <template #icon><DashboardOutlined /></template>
          <span>仪表盘总览</span>
        </a-menu-item>
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
            <a-breadcrumb-item>业务中心</a-breadcrumb-item>
            <a-breadcrumb-item>全场景复杂控制台</a-breadcrumb-item>
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

      <!-- 主工作区 -->
      <a-layout-content style="margin: 24px 24px 0; overflow: initial;">
        <!-- 统计面板 -->
        <a-row :gutter="16" style="margin-bottom: 24px;">
          <a-col :span="6">
            <a-card>
              <a-statistic title="今日活跃用户" :value="112893" style="margin-right: 50px">
                <template #suffix><ArrowUpOutlined style="color: #3f8600" /></template>
              </a-statistic>
              <a-progress :percent="78" stroke-color="#52c41a" status="active" />
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card>
              <a-statistic title="实收交易总额 (CNY)" :precision="2" :value="983210.45">
                <template #prefix>¥</template>
              </a-statistic>
              <a-progress :percent="92" stroke-color="#1890ff" />
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card>
              <a-statistic title="未解决风险警报" :value="9" :value-style="{ color: '#cf1322' }">
                <template #prefix><AlertOutlined /></template>
              </a-statistic>
              <a-progress :percent="30" stroke-color="#f5222d" />
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card>
              <a-statistic title="系统自动化作业覆盖率" :value="94.6" suffix="%" />
              <a-progress :percent="94.6" stroke-color="#722ed1" />
            </a-card>
          </a-col>
        </a-row>

        <!-- 复杂功能 Tabs 导航 -->
        <a-card style="margin-bottom: 24px;">
          <a-tabs v-model:activeKey="activeTabKey">
            <!-- TAB 1: 复杂表单配置 -->
            <a-tab-pane key="tab1" tab="复杂表单与控制中心">
              <a-alert
                message="系统配置变更说明"
                description="修改核心参数将直接触发边缘节点热重载，请确认以下级联与表单字段配置完整准确。"
                type="info"
                show-icon
                closable
                style="margin-bottom: 24px;"
              />

              <a-form :model="formData" layout="vertical" @finish="onFormSubmit">
                <a-row :gutter="24">
                  <a-col :span="8">
                    <a-form-item label="集群名称" name="clusterName" :rules="[{ required: true, message: '请输入集群名称' }]">
                      <a-input v-model:value="formData.clusterName" placeholder="例如：k8s-prod-shanghai-01" />
                    </a-form-item>
                  </a-col>
                  <a-col :span="8">
                    <a-form-item label="所属地域/环境" name="region" :rules="[{ required: true, message: '请选择所属地域' }]">
                      <a-select v-model:value="formData.region" placeholder="请选择云厂商与地域">
                        <a-select-option value="cn-east-1">华东1 (杭州 - 阿里云)</a-select-option>
                        <a-select-option value="cn-north-2">华北2 (北京 - 腾讯云)</a-select-option>
                        <a-select-option value="cn-south-1">华南1 (深圳 - 华为云)</a-select-option>
                        <a-select-option value="ap-southeast-1">亚太东南 (新加坡 - AWS)</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :span="8">
                    <a-form-item label="多级组织架构" name="cascader">
                      <a-cascader v-model:value="formData.cascader" :options="cascaderOptions" placeholder="请选择组织层级" />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-row :gutter="24">
                  <a-col :span="8">
                    <a-form-item label="时间范围 (RangePicker)" name="dateRange">
                      <a-range-picker v-model:value="formData.dateRange" show-time style="width: 100%" />
                    </a-form-item>
                  </a-col>
                  <a-col :span="8">
                    <a-form-item label="实例最大副本数 (Slider/InputNumber)" name="replicas">
                      <div style="display: flex; align-items: center; gap: 16px;">
                        <a-slider v-model:value="formData.replicas" :min="1" :max="100" style="flex: 1" />
                        <a-input-number v-model:value="formData.replicas" :min="1" :max="100" />
                      </div>
                    </a-form-item>
                  </a-col>
                  <a-col :span="8">
                    <a-form-item label="重要性权重 (Rate)" name="rate">
                      <a-rate v-model:value="formData.rate" allow-half />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-row :gutter="24">
                  <a-col :span="8">
                    <a-form-item label="网络协议与特性" name="features">
                      <a-checkbox-group v-model:value="formData.features" :options="featureOptions" />
                    </a-form-item>
                  </a-col>
                  <a-col :span="8">
                    <a-form-item label="负载均衡调度模式" name="mode">
                      <a-radio-group v-model:value="formData.mode">
                        <a-radio value="rr">Round-Robin (轮询)</a-radio>
                        <a-radio value="lc">Least-Connection (最少连接)</a-radio>
                        <a-radio value="ip_hash">IP-Hash (源散列)</a-radio>
                      </a-radio-group>
                    </a-form-item>
                  </a-col>
                  <a-col :span="8">
                    <a-form-item label="全量热旁路切换 (Switch)" name="enableBypass">
                      <a-switch v-model:checked="formData.enableBypass" checked-children="开启" un-checked-children="关闭" />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-row :gutter="24">
                  <a-col :span="12">
                    <a-form-item label="多标签多选选择器 (Tags Select)" name="tags">
                      <a-select
                        v-model:value="formData.tags"
                        mode="multiple"
                        placeholder="选择或输入标签"
                        :options="tagOptions"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :span="12">
                    <a-form-item label="树形归属选择器 (TreeSelect)" name="treeSelect">
                      <a-tree-select
                        v-model:value="formData.treeSelect"
                        show-search
                        style="width: 100%"
                        :dropdown-style="{ maxHeight: '400px', overflow: 'auto' }"
                        placeholder="请选择组织树节点"
                        allow-clear
                        tree-default-expand-all
                        :tree-data="treeData"
                      />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-form-item label="操作员权限分配穿梭框 (Transfer)">
                  <a-transfer
                    :data-source="transferMockData"
                    :target-keys="targetTransferKeys"
                    :render="item => item.title"
                    @change="handleTransferChange"
                  />
                </a-form-item>

                <div style="display: flex; gap: 12px; margin-top: 16px;">
                  <a-button type="primary" html-type="submit" :loading="formSubmitting">立即保存配置</a-button>
                  <a-button @click="resetForm">重置表单</a-button>
                  <a-button type="dashed" @click="showModal = true">打开高级参数 Modal</a-button>
                  <a-button @click="showDrawer = true">打开属性抽屉 Drawer</a-button>
                  <a-popconfirm title="确定要同步清除全局缓存吗？" ok-text="确认" cancel-text="取消" @confirm="onClearCache">
                    <a-button danger>清除全局缓存</a-button>
                  </a-popconfirm>
                </div>
              </a-form>
            </a-tab-pane>

            <!-- TAB 2: 海量数据表格与高密度操作 -->
            <a-tab-pane key="tab2" tab="海量数据表格与复杂操作">
              <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 8px;">
                  <a-button type="primary" @click="addBatchRows">批量插入 50 条记录</a-button>
                  <a-button @click="clearSelectedRows" :disabled="!hasSelected">清空选中 ({{ selectedRowKeys.length }})</a-button>
                  <a-button danger :disabled="!hasSelected" @click="batchDelete">批量删除选中</a-button>
                </div>
                <a-input-search
                  v-model:value="tableSearchText"
                  placeholder="筛选任务名称或负责人..."
                  style="width: 250px"
                />
              </div>

              <!-- 高密度带固定列、展开行、勾选列的复杂表格 -->
              <a-table
                :columns="columns"
                :data-source="filteredTableData"
                :row-selection="{ selectedRowKeys: selectedRowKeys, onChange: onSelectChange }"
                :pagination="{ pageSize: 20, showSizeChanger: true, showQuickJumper: true }"
                :scroll="{ x: 1300, y: 500 }"
                row-key="id"
                bordered
              >
                <template #expandedRowRender="{ record }">
                  <div style="padding: 12px; background: #fafafa;">
                    <h4>详细调用链分析追踪 ({{ record.id }})</h4>
                    <a-timeline>
                      <a-timeline-item color="green">请求入站 网关时间: {{ record.createdAt }}</a-timeline-item>
                      <a-timeline-item color="blue">认证通过，JWT 校验通过 (耗时 4ms)</a-timeline-item>
                      <a-timeline-item color="red">数据库查询读写分离延迟: {{ record.latency }}ms</a-timeline-item>
                      <a-timeline-item>最终渲染响应: Status {{ record.status }}</a-timeline-item>
                    </a-timeline>
                  </div>
                </template>

                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'status'">
                    <a-tag :color="record.status === 'RUNNING' ? 'processing' : record.status === 'SUCCESS' ? 'success' : 'error'">
                      {{ record.status }}
                    </a-tag>
                  </template>
                  <template v-else-if="column.key === 'priority'">
                    <a-badge :status="record.priority === 'HIGH' ? 'error' : record.priority === 'MEDIUM' ? 'warning' : 'default'" :text="record.priority" />
                  </template>
                  <template v-else-if="column.key === 'action'">
                    <div style="display: flex; gap: 8px;">
                      <a-button type="link" size="small" @click="handleEditRecord(record)">编辑</a-button>
                      <a-popconfirm title="确认删除此项？" @confirm="handleDeleteRecord(record.id)">
                        <a-button type="link" danger size="small">删除</a-button>
                      </a-popconfirm>
                    </div>
                  </template>
                </template>
              </a-table>
            </a-tab-pane>

            <!-- TAB 3: 复杂折叠面板与树状架构 -->
            <a-tab-pane key="tab3" tab="组织架构树与级联信息">
              <a-row :gutter="24">
                <a-col :span="10">
                  <a-card title="部门与权限树形视图" :bordered="false">
                    <a-directory-tree
                      multiple
                      default-expand-all
                      :tree-data="deepTreeData"
                    />
                  </a-card>
                </a-col>
                <a-col :span="14">
                  <a-collapse v-model:activeKey="activeCollapseKeys">
                    <a-collapse-panel key="1" header="微服务治理架构规范">
                      <p>每个微服务必须具备独立的健康检查探针 (Liveness & Readiness probe)，默认超时设置为 3s。</p>
                      <p>跨服务 RPC 需使用 mTLS 互相认证，链路追踪透传 traceId。</p>
                    </a-collapse-panel>
                    <a-collapse-panel key="2" header="容灾与多活备份策略">
                      <p>核心数据层采用 MySQL 双主多从 + 异地 DTS 准实时同步，RPO &lt; 1s，RTO &lt; 30s。</p>
                    </a-collapse-panel>
                    <a-collapse-panel key="3" header="灰度发布与金丝雀测试规范">
                      <p>采用 Header 带流量标路由机制，首批金丝雀流量占总量 5%，监控观察期不少于 15 分钟。</p>
                    </a-collapse-panel>
                  </a-collapse>
                </a-col>
              </a-row>
            </a-tab-pane>

            <!-- TAB 4: 步骤审批流 -->
            <a-tab-pane key="tab4" tab="流程审批与步骤协同">
              <a-steps :current="currentStep" style="margin-bottom: 32px;">
                <a-step title="提交申请" description="填写工单并提交附件" />
                <a-step title="部门主管审批" description="技术总监审核评估" />
                <a-step title="合规风控审查" description="法务与数据合规确认" />
                <a-step title="全自动部署发版" description="流水线构建与发布" />
              </a-steps>

              <div style="background: #f0f2f5; padding: 24px; border-radius: 6px; margin-bottom: 24px;">
                <h3>当前步骤：第 {{ currentStep + 1 }} 阶段</h3>
                <p v-if="currentStep === 0">请确认已在 Tab 1 完成配置并附带相关参数。</p>
                <p v-if="currentStep === 1">正在等待部门主管签字确认...</p>
                <p v-if="currentStep === 2">合规与审计部门进行敏感数据出海检测...</p>
                <p v-if="currentStep === 3">CI/CD 引擎自动化部署中，预计耗时 120 秒。</p>
              </div>

              <div style="display: flex; gap: 12px;">
                <a-button :disabled="currentStep === 0" @click="currentStep--">上一步</a-button>
                <a-button type="primary" :disabled="currentStep === 3" @click="currentStep++">下一步</a-button>
              </div>
            </a-tab-pane>
          </a-tabs>
        </a-card>

        <!-- 弹窗 Modal -->
        <a-modal v-model:open="showModal" title="高级运行时参数微调" @ok="handleModalOk">
          <a-form layout="vertical">
            <a-form-item label="内核连接池大小 (Max Pool Size)">
              <a-input-number style="width: 100%" :min="10" :max="1000" v-model:value="modalPoolSize" />
            </a-form-item>
            <a-form-item label="GC 阈值与频率">
              <a-radio-group v-model:value="modalGcMode">
                <a-radio value="conservative">保守模式 (Low Latency)</a-radio>
                <a-radio value="aggressive">积极回收 (Throughput First)</a-radio>
              </a-radio-group>
            </a-form-item>
            <a-form-item label="附注说明">
              <a-textarea placeholder="填写变更说明..." :rows="3" />
            </a-form-item>
          </a-form>
        </a-modal>

        <!-- 侧拉抽屉 Drawer -->
        <a-drawer
          v-model:open="showDrawer"
          title="系统节点拓扑详情"
          placement="right"
          width="400"
        >
          <p>节点标识: node-shanghai-prod-worker-08</p>
          <p>宿主规格: 32C 64G eCS 裸金属</p>
          <a-divider />
          <h4>实时负载曲线</h4>
          <a-progress type="circle" :percent="68" />
          <div style="margin-top: 16px;">
            <a-button type="primary" block @click="showDrawer = false">关闭抽屉</a-button>
          </div>
        </a-drawer>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { message } from "ant-design-vue";
import {
  DashboardOutlined,
  AppstoreOutlined,
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  BellOutlined,
  DownOutlined,
  ArrowUpOutlined,
  AlertOutlined,
} from "@ant-design/icons-vue";

const collapsed = ref(false);
const selectedMenu = ref(["dashboard"]);
const headerSearch = ref("");
const activeTabKey = ref("tab1");
const showModal = ref(false);
const showDrawer = ref(false);
const modalPoolSize = ref(128);
const modalGcMode = ref("conservative");
const currentStep = ref(0);
const activeCollapseKeys = ref(["1"]);
const formSubmitting = ref(false);

const formData = ref({
  clusterName: "prod-cloud-cluster-01",
  region: "cn-east-1",
  cascader: ["zhejiang", "hangzhou", "xihu"],
  dateRange: [] as any[],
  replicas: 16,
  rate: 4.5,
  features: ["ssl", "http2", "brotli"],
  mode: "rr",
  enableBypass: true,
  tags: ["高性能", "多可用区"],
  treeSelect: "leaf1",
});

const cascaderOptions = [
  {
    value: "zhejiang",
    label: "浙江省",
    children: [
      {
        value: "hangzhou",
        label: "杭州市",
        children: [
          { value: "xihu", label: "西湖区科技园" },
          { value: "binjiang", label: "滨江高新区" },
        ],
      },
    ],
  },
  {
    value: "beijing",
    label: "北京市",
    children: [
      {
        value: "haidian",
        label: "海淀区中关村",
      },
    ],
  },
];

const featureOptions = [
  { label: "TLS/SSL 终结", value: "ssl" },
  { label: "HTTP/2 多路复用", value: "http2" },
  { label: "Brotli 压缩", value: "brotli" },
  { label: "gRPC 转发", value: "grpc" },
  { label: "Websocket 支持", value: "ws" },
];

const tagOptions = [
  { value: "高性能", label: "高性能" },
  { value: "多可用区", label: "多可用区" },
  { value: "低延迟", label: "低延迟" },
  { value: "金融级隔离", label: "金融级隔离" },
  { value: "冷热分层", label: "冷热分层" },
];

const treeData = [
  {
    title: "集团技术中心",
    value: "tech",
    children: [
      {
        title: "基础架构平台部",
        value: "infra",
        children: [
          { title: "云原生容器组", value: "leaf1" },
          { title: "分布式中间件组", value: "leaf2" },
        ],
      },
      {
        title: "AI 智能应用部",
        value: "ai",
      },
    ],
  },
];

// 穿梭框模拟数据 (50 条)
const transferMockData = Array.from({ length: 50 }, (_, i) => ({
  key: i.toString(),
  title: `权限策略策略集_${i + 1}`,
  description: `系统策略定义策略_${i + 1}`,
  disabled: i % 5 === 0,
}));
const targetTransferKeys = ref<string[]>(["2", "3", "7", "11", "24"]);

const handleTransferChange = (nextTargetKeys: string[]) => {
  targetTransferKeys.value = nextTargetKeys;
};

// 表格数据定义 (预置 100 条复杂记录，产生大量 DOM 元素)
const tableData = ref<any[]>(
  Array.from({ length: 100 }, (_, i) => ({
    id: `TASK-${1000 + i}`,
    name: `分布式定时巡检任务 #${i + 1}`,
    operator: ["张工", "李工", "王工", "赵工"][i % 4],
    status: ["RUNNING", "SUCCESS", "FAILED"][i % 3],
    priority: ["HIGH", "MEDIUM", "LOW"][i % 3],
    qps: Math.floor(Math.random() * 5000 + 500),
    latency: Math.floor(Math.random() * 80 + 10),
    createdAt: new Date(Date.now() - i * 3600000).toLocaleString(),
    errorCount: Math.floor(Math.random() * 5),
  }))
);

const columns = [
  { title: "任务编号", dataIndex: "id", key: "id", width: 140, fixed: "left" },
  { title: "任务名称", dataIndex: "name", key: "name", width: 220 },
  { title: "负责人", dataIndex: "operator", key: "operator", width: 100 },
  { title: "当前状态", dataIndex: "status", key: "status", width: 120 },
  { title: "优先级", dataIndex: "priority", key: "priority", width: 100 },
  { title: "实时 QPS", dataIndex: "qps", key: "qps", width: 120, sorter: (a: any, b: any) => a.qps - b.qps },
  { title: "平均延迟 (ms)", dataIndex: "latency", key: "latency", width: 130, sorter: (a: any, b: any) => a.latency - b.latency },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
  { title: "异常频次", dataIndex: "errorCount", key: "errorCount", width: 100 },
  { title: "操作", key: "action", fixed: "right", width: 140 },
];

const selectedRowKeys = ref<string[]>([]);
const hasSelected = computed(() => selectedRowKeys.value.length > 0);
const onSelectChange = (keys: string[]) => {
  selectedRowKeys.value = keys;
};

const tableSearchText = ref("");
const filteredTableData = computed(() => {
  if (!tableSearchText.value) return tableData.value;
  const q = tableSearchText.value.toLowerCase();
  return tableData.value.filter(
    (item) => item.name.toLowerCase().includes(q) || item.operator.toLowerCase().includes(q)
  );
});

const addBatchRows = () => {
  const start = tableData.value.length;
  const newRows = Array.from({ length: 50 }, (_, i) => ({
    id: `TASK-${2000 + start + i}`,
    name: `动态批量生成任务 #${start + i + 1}`,
    operator: "自动化探针",
    status: "RUNNING",
    priority: "MEDIUM",
    qps: 1200,
    latency: 25,
    createdAt: new Date().toLocaleString(),
    errorCount: 0,
  }));
  tableData.value.unshift(...newRows);
  message.success("已成功追加 50 条任务记录");
};

const clearSelectedRows = () => {
  selectedRowKeys.value = [];
};

const batchDelete = () => {
  tableData.value = tableData.value.filter(item => !selectedRowKeys.value.includes(item.id));
  message.success(`已批量删除 ${selectedRowKeys.value.length} 项`);
  selectedRowKeys.value = [];
};

const handleEditRecord = (record: any) => {
  message.info(`正在编辑: ${record.id}`);
};

const handleDeleteRecord = (id: string) => {
  tableData.value = tableData.value.filter(item => item.id !== id);
  message.success(`已删除记录 ${id}`);
};

// 深度树形数据
const deepTreeData = [
  {
    title: "杭州总部 (集团董事会)",
    key: "0-0",
    children: [
      {
        title: "技术研发中心 (580人)",
        key: "0-0-0",
        children: [
          { title: "基础架构团队", key: "0-0-0-0" },
          { title: "大模型算法团队", key: "0-0-0-1" },
          { title: "前端效能工程团队", key: "0-0-0-2" },
        ],
      },
      {
        title: "用户增长与业务运营 (320人)",
        key: "0-0-1",
        children: [
          { title: "电商运营", key: "0-0-1-0" },
          { title: "海外增长", key: "0-0-1-1" },
        ],
      },
    ],
  },
  {
    title: "硅谷海外研发中心 (R&D)",
    key: "0-1",
    children: [
      { title: "分布式系统研究实验室", key: "0-1-0" },
      { title: "跨模态推理工程组", key: "0-1-1" },
    ],
  },
];

const onHeaderSearch = (val: string) => {
  message.info(`全局检索: ${val}`);
};

const handleLogout = () => {
  message.warning("退出登录操作");
};

const onFormSubmit = () => {
  formSubmitting.value = true;
  setTimeout(() => {
    formSubmitting.value = false;
    message.success("表单数据保存成功！");
  }, 600);
};

const resetForm = () => {
  formData.value.clusterName = "";
  message.info("已重置表单");
};

const onClearCache = () => {
  message.success("已清除全局缓存");
};

const handleModalOk = () => {
  showModal.value = false;
  message.success("已更新运行时高级参数");
};
</script>

<style scoped>
.logo {
  height: 48px;
  margin: 16px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
  border-radius: 4px;
}
</style>
