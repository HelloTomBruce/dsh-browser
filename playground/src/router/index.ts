import { createRouter, createWebHashHistory } from "vue-router";
import DashboardView from "../views/DashboardView.vue";
import EnergySavingOverview from "../views/EnergySavingOverview.vue";

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
    path: "/energy-overview",
    redirect: "/WirelessPowerSaving/EnergySavingOverview",
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
