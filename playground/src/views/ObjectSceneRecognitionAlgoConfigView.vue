<template>
  <div class="page-container" style="padding: 24px; background: #fff; min-height: 100vh;">
    <h2 style="margin-bottom: 24px;">对象场景识别算法配置 (ObjectSceneRecognitionAlgoConfig)</h2>

    <!-- 搜索栏 + 操作按钮 -->
    <div class="page-top-bar" style="display: flex; justify-content: space-between; margin-bottom: 16px;">
      <div class="page-search" style="display: flex; gap: 12px; align-items: center;">
        <a-select
          id="city-select"
          v-model:value="searchForm.city"
          placeholder="地市"
          allow-clear
          style="width: 140px"
          :options="cityOptions"
          @change="onCityChange"
        />
        <a-select
          id="district-select"
          v-model:value="searchForm.district"
          placeholder="区县"
          allow-clear
          style="width: 160px"
          :options="districtOptions"
          :disabled="!searchForm.city"
        />
        <a-button type="primary" id="search-btn" @click="handleSearch">查询</a-button>
        <a-button id="reset-btn" @click="handleReset">重置</a-button>
      </div>

      <div class="page-op">
        <a-button type="primary" id="add-btn" @click="showAddModal = true">新增规则</a-button>
      </div>
    </div>

    <!-- 列表 -->
    <a-table
      :columns="columns"
      :data-source="tableData"
      :pagination="false"
      row-key="id"
      bordered
    >
      <template #bodyCell="{ column, record, index }">
        <template v-if="column.key === 'index'">
          {{ index + 1 }}
        </template>
        <template v-else-if="column.key === 'enableFlag'">
          <a-switch
            :checked="record.enableFlag === 1"
            checked-children="启用"
            un-checked-children="停用"
            @change="(checked) => handleEnabledChange(record, checked)"
          />
        </template>
        <template v-else-if="column.key === 'action'">
          <div style="display: flex; gap: 8px;">
            <a class="operate-item action-info" @click="handleDetail(record)">详情</a>
            <a class="operate-item action-primary" @click="handleEdit(record)">编辑</a>
            <a class="operate-item action-success" @click="handleCopy(record)">复制</a>
            <a class="operate-item action-danger" style="color: #ff4d4f; cursor: pointer;" @click="handleDelete(record)">删除</a>
          </div>
        </template>
      </template>
    </a-table>

    <!-- 新增/编辑配置 Modal -->
    <a-modal
      v-model:open="showAddModal"
      title="配置算法规则"
      ok-text="保存"
      cancel-text="取消"
      @ok="handleModalSubmit"
    >
      <a-form layout="vertical">
        <a-form-item label="规则名称" required>
          <a-input v-model:value="modalForm.configName" id="modal-rule-name" placeholder="请输入规则名称..." />
        </a-form-item>
        <a-form-item label="归属地市" required>
          <a-select v-model:value="modalForm.city" placeholder="请选择地市" :options="cityOptions" />
        </a-form-item>
        <a-form-item label="多选覆盖区县 (多选模式)" required>
          <a-select
            id="modal-districts-select"
            v-model:value="modalForm.districts"
            mode="multiple"
            placeholder="请选择覆盖区县 (支持多选)"
            :options="allDistrictOptions"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="规则描述">
          <a-textarea v-model:value="modalForm.remark" placeholder="填写算法规则描述..." :rows="3" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, h } from "vue";
import { Modal, message } from "ant-design-vue";

// 初始化网络请求模拟记录，挂载到全局供 E2E 校验
(window as any).__networkRequests = [];

function recordNetworkRequest(endpoint: string, payload: any) {
  const req = { endpoint, payload, time: Date.now() };
  (window as any).__networkRequests.push(req);
  console.log("[Mock Network]", endpoint, payload);
}

const cityOptions = [
  { label: "杭州市", value: "杭州市" },
  { label: "宁波市", value: "宁波市" },
  { label: "温州市", value: "温州市" },
];

const allDistrictOptions = [
  { label: "西湖区", value: "西湖区" },
  { label: "滨江区", value: "滨江区" },
  { label: "余杭区", value: "余杭区" },
  { label: "海曙区", value: "海曙区" },
  { label: "鄞州区", value: "鄞州区" },
];

const searchForm = reactive({
  city: undefined as string | undefined,
  district: undefined as string | undefined,
});

const districtOptions = ref<{ label: string; value: string }[]>([]);

function onCityChange(val: string) {
  searchForm.district = undefined;
  if (val === "杭州市") {
    districtOptions.value = [
      { label: "西湖区", value: "西湖区" },
      { label: "滨江区", value: "滨江区" },
      { label: "余杭区", value: "余杭区" },
    ];
  } else if (val === "宁波市") {
    districtOptions.value = [
      { label: "海曙区", value: "海曙区" },
      { label: "鄞州区", value: "鄞州区" },
    ];
  } else {
    districtOptions.value = [];
  }
}

function handleSearch() {
  message.info(`查询条件: ${searchForm.city || "全部"} / ${searchForm.district || "全部"}`);
  recordNetworkRequest("/api/queryObjSceneConfig", { ...searchForm });
}

function handleReset() {
  searchForm.city = undefined;
  searchForm.district = undefined;
  districtOptions.value = [];
}

const columns = [
  { title: "序号", key: "index", width: 70, align: "center" },
  { title: "规则编号", dataIndex: "ruleCode", key: "ruleCode", width: 160 },
  { title: "名称", dataIndex: "configName", key: "configName", minWidth: 180 },
  { title: "地市", dataIndex: "city", key: "city", width: 100 },
  { title: "区县", dataIndex: "district", key: "district", minWidth: 140 },
  { title: "启用", key: "enableFlag", width: 100, align: "center" },
  { title: "操作", key: "action", width: 220 },
];

const tableData = ref([
  {
    id: "alg-001",
    ruleCode: "RULE-HZ-01",
    configName: "杭州高密商业区场景节能算法",
    city: "杭州市",
    district: "滨江区",
    enableFlag: 1,
    remark: "针对白天高负荷与夜间低负荷自适应调整",
  },
  {
    id: "alg-002",
    ruleCode: "RULE-HZ-02",
    configName: "西湖景区节假日人流特征算法",
    city: "杭州市",
    district: "西湖区",
    enableFlag: 0,
    remark: "周末与节假日客流激增场景",
  },
  {
    id: "alg-003",
    ruleCode: "RULE-NB-01",
    configName: "宁波港口物流重保算法",
    city: "宁波市",
    district: "海曙区",
    enableFlag: 1,
    remark: "全天候重保无线频段协同",
  },
]);

// 启用/停用确认 (真实还原 hooks.ts 中的 Modal.confirm 逻辑)
function handleEnabledChange(record: any, checked: boolean | string | number) {
  const isEnable = checked === true;
  Modal.confirm({
    title: isEnable ? "启用确认" : "停用确认",
    content: isEnable
      ? `确定要开启「${record.configName}」吗？`
      : `确定要停用「${record.configName}」吗？停用不影响已引用的任务。`,
    okText: "确定",
    cancelText: "取消",
    onOk: async () => {
      record.enableFlag = isEnable ? 1 : 0;
      recordNetworkRequest("/api/updateEnableFlag", { id: record.id, enableFlag: record.enableFlag });
      message.success(`规则「${record.configName}」已${isEnable ? "启用" : "停用"}`);
    },
  });
}

// 删除确认 (真实还原 hooks.ts 中的 Modal.confirm 逻辑)
function handleDelete(record: any) {
  Modal.confirm({
    title: "确认删除",
    content: `确定删除"${record.configName}"吗？`,
    okText: "确定",
    cancelText: "取消",
    onOk: async () => {
      tableData.value = tableData.value.filter((item) => item.id !== record.id);
      recordNetworkRequest("/api/deleteObjSceneConfig", { ids: [record.id] });
      message.success(`删除成功: ${record.configName}`);
    },
  });
}

function handleDetail(record: any) {
  message.info(`查看详情: ${record.configName}`);
}

function handleEdit(record: any) {
  modalForm.configName = record.configName;
  modalForm.city = record.city;
  modalForm.districts = [record.district];
  modalForm.remark = record.remark;
  showAddModal.value = true;
}

function handleCopy(record: any) {
  modalForm.configName = `${record.configName}_副本`;
  modalForm.city = record.city;
  modalForm.districts = [record.district];
  modalForm.remark = record.remark;
  showAddModal.value = true;
}

const showAddModal = ref(false);
const modalForm = reactive({
  configName: "",
  city: "杭州市",
  districts: ["滨江区"],
  remark: "",
});

function handleModalSubmit() {
  recordNetworkRequest("/api/saveObjSceneConfig", { ...modalForm });
  message.success("规则保存成功！");
  showAddModal.value = false;
}
</script>
