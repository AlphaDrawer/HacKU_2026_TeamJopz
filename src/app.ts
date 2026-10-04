/**
 * app.ts（应用入口，已瘦身）
 * ------------------------------------------------------------------
 * 旧版约 600 行的 app.ts（路由+5视图+计时+趋势+绑定）已拆分到
 * src/ui/ 下；本文件只负责：取挂载根节点 → 建立依赖容器 → 启动路由。
 *
 * 分层：
 *   contracts/  冻结契约（不可改）
 *   core/       算法侧（由其他成员交付，UI 只通过 GaitCore 接口调用）
 *   domain/     UI 侧报告领域助手
 *   services/   相机/存储/语音/骨架绘制
 *   adapters/   GaitCore 的合成假实现（仅用于测试/离线演示，可替换）
 *   ui/         路由、视图、测量编排、趋势、布局
 */
import { createAppContext } from "./ui/appContext";
import { Router } from "./ui/router";

const root = document.getElementById("app");
if (!root) {
  throw new Error("找不到 #app 挂载节点");
}

const app = createAppContext();
const router = new Router(app, root);
router.start();
