/**
 * ui/router.ts（哈希路由器 + 生命周期）
 * ------------------------------------------------------------------
 * - 解析 location.hash → 路由名；非法/悬空路由做守卫重定向。
 * - 每次切换：先 destroy 旧视图（停相机/取消会话），再挂新视图。
 * - pagehide / visibilitychange 监听器在【顶层注册一次】（修复旧版
 *   把 pagehide 写在 hashchange 回调里、重复注册的 bug）。
 */
import type { AppContext } from "./appContext";
import { mountLayout, type Layout } from "./layout";
import { ROUTES, ROUTE_PREFIX, VALID_ROUTES } from "./constants";
import { historyView, homeView, reportView, setupView } from "./views";
import { measurementView } from "./measurementView";

interface ActiveView {
  destroy?(): void;
}

export class Router {
  private readonly layout: Layout;
  private active: ActiveView | null = null;
  private rendering = false;

  constructor(
    private readonly ctx: AppContext,
    root: HTMLElement,
  ) {
    this.layout = mountLayout(root);
  }

  start(): void {
    window.addEventListener("hashchange", () => void this.render());
    window.addEventListener("pagehide", () => this.teardown());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.teardown();
    });
    void this.render();
  }

  /** 当前路由名（非法/空时给默认 home） */
  private currentRoute(): string {
    const raw = location.hash.replace(ROUTE_PREFIX, "").split("?")[0];
    if (!raw) return ROUTES.HOME;
    if (!VALID_ROUTES.has(raw)) return ROUTES.HOME;
    return raw;
  }

  private async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      let route = this.currentRoute();

      // 守卫：手改 URL 直接进 measurement 但尚未看过准备页，
      // 统一重定向到 setup（避免相机空态的悬空路由）
      if (route === ROUTES.MEASUREMENT && !sessionStorage.getItem(ROUTE_GUIDE_KEY)) {
        route = ROUTES.SETUP;
        this.layout.navigate(ROUTES.SETUP);
      }

      // 清理旧视图
      this.active?.destroy?.();
      this.active = null;
      this.layout.content.innerHTML = "";

      await this.mount(route);
    } finally {
      this.rendering = false;
    }
  }

  private async mount(route: string): Promise<void> {
    const navigate = this.layout.navigate.bind(this.layout);

    switch (route) {
      case ROUTES.HOME:
        sessionStorage.setItem(ROUTE_GUIDE_KEY, "1");
        this.layout.content.appendChild(homeView(this.ctx, navigate));
        break;
      case ROUTES.SETUP:
        sessionStorage.setItem(ROUTE_GUIDE_KEY, "1");
        this.layout.content.appendChild(setupView(this.ctx, navigate));
        break;
      case ROUTES.MEASUREMENT: {
        const view = measurementView(this.ctx, navigate);
        this.active = view;
        this.layout.content.appendChild(view.el);
        break;
      }
      case ROUTES.REPORT:
        this.layout.content.appendChild(reportView(this.ctx, navigate));
        break;
      case ROUTES.HISTORY:
        this.layout.content.appendChild(await historyView(this.ctx, navigate));
        break;
      default:
        this.layout.content.appendChild(homeView(this.ctx, navigate));
    }
  }

  private teardown(): void {
    this.active?.destroy?.();
    this.active = null;
  }
}

/** 标记本会话已看过引导（首页/准备页），用于悬空路由守卫 */
const ROUTE_GUIDE_KEY = "gaittrace:guide-seen";
