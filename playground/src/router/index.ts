import { createRouter, createWebHashHistory } from "vue-router";
import DashboardView from "../views/DashboardView.vue";
import EnergySavingOverview from "../views/EnergySavingOverview.vue";
import ObjectSceneRecognitionAlgoConfigView from "../views/ObjectSceneRecognitionAlgoConfigView.vue";

const routes = [
  {
    path: "/",
    name: "Dashboard",
    component: DashboardView,
  },
  {
    path: "/WirelessPowerSaving/EnergySavingOverview",
    name: "EnergySavingOverview",
    component: EnergySavingOverview,
  },
  {
    path: "/WirelessPowerSaving/ObjectSceneRecognitionAlgoConfig",
    name: "ObjectSceneRecognitionAlgoConfig",
    component: ObjectSceneRecognitionAlgoConfigView,
  },
  {
    path: "/algo-config",
    redirect: "/WirelessPowerSaving/ObjectSceneRecognitionAlgoConfig",
  },
  {
    path: "/energy-overview",
    redirect: "/WirelessPowerSaving/EnergySavingOverview",
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
