/**
 * ui/dom.ts（极简 DOM 工具）
 * 提供 h() 创建元素、escapeHtml 防注入、以及事件委托常用的 data-* 读取。
 * 所有用户/历史文本插入 HTML 前必须 escapeHtml。
 */

/** 创建元素并批量设置 class/属性/子节点 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; attrs?: Record<string, string>; text?: string } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => el.setAttribute(key, value));
  }
  if (options.text !== undefined) el.textContent = options.text;
  children.forEach((child) => el.appendChild(child));
  return el;
}

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 转义文本，防止历史/用户内容产生 XSS */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** 读取元素 data-* 字符串属性（无则 null） */
export function dataset(el: Element | null, key: string): string | null {
  if (!el) return null;
  const value = (el as HTMLElement).dataset?.[key];
  return value === undefined ? null : value;
}

/** 在容器内做一次事件委托：返回解绑函数 */
export function delegate(
  container: HTMLElement,
  type: keyof HTMLElementEventMap,
  selector: string,
  handler: (target: HTMLElement, event: Event) => void,
): () => void {
  const listener = (event: Event): void => {
    const target = (event.target as Element | null)?.closest(selector);
    if (target && container.contains(target)) handler(target as HTMLElement, event);
  };
  container.addEventListener(type, listener);
  return () => container.removeEventListener(type, listener);
}
