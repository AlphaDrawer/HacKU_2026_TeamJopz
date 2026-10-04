/**
 * ui/layout.ts（顶栏 + 内容容器 + 路由跳转）
 * 提供 mountLayout() 建立一次的固定骨架，并暴露 navigate()。
 */
import { ROUTE_PREFIX, ROUTES } from "./constants";

export interface Layout {
  content: HTMLElement;
  navigate(route: string): void;
}

/** 顶部导航项（繁体文案） */
const NAV_ITEMS: Array<{ route: string; label: string }> = [
  { route: ROUTES.HOME, label: "首页" },
  { route: ROUTES.SETUP, label: "准备" },
  { route: ROUTES.HISTORY, label: "历史" },
];

export function mountLayout(root: HTMLElement): Layout {
  root.innerHTML = "";

  const header = document.createElement("header");
  header.className = "topbar";

  const brand = document.createElement("a");
  brand.className = "brand";
  brand.href = `${ROUTE_PREFIX}${ROUTES.HOME}`;
  brand.innerHTML =
    '<span class="brand-mark">步</span><span>GaitTrace<small>隐私优先・步态日记</small></span>';

  const nav = document.createElement("nav");
  NAV_ITEMS.forEach((item) => {
    const link = document.createElement("a");
    link.className = "button ghost";
    link.href = `${ROUTE_PREFIX}${item.route}`;
    link.textContent = item.label;
    link.dataset.route = item.route;
    nav.appendChild(link);
  });

  header.append(brand, nav);

  const content = document.createElement("main");
  content.className = "page-content";
  content.id = "view";

  const disclaimerBar = document.createElement("div");
  disclaimerBar.className = "disclaimer-bar";
  disclaimerBar.textContent = "用于筛查与自我追踪，不构成医学诊断";

  root.append(header, content, disclaimerBar);

  const layout: Layout = {
    content,
    navigate: (route: string) => {
      const target = `${ROUTE_PREFIX}${route}`;
      if (location.hash !== target) location.hash = target;
    },
  };
  return layout;
}
