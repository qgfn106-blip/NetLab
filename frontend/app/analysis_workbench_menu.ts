/* 工作台子图/标签页的弹出菜单：DOM 创建、定位与点击外部关闭。
 *
 * 从画布组合模块拆出以满足 S5 单模块 ≤800 行上限；不改变菜单语义。
 */

export interface MenuItem {
  label: string;
  action(): void;
  disabled?: boolean;
}

export class WorkbenchMenu {
  private menu: HTMLElement | null = null;
  private away: ((event: PointerEvent) => void) | null = null;

  open(anchor: HTMLElement, items: MenuItem[]): void {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'awb-menu';
    menu.dataset.awb = 'menu';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'awb-menu-item';
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      button.addEventListener('click', () => {
        this.close();
        item.action();
      });
      menu.append(button);
    }
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4)) + 'px';
    this.menu = menu;
    window.setTimeout(() => {
      const away = (event: PointerEvent): void => {
        if (this.menu && !this.menu.contains(event.target as Node)) this.close();
      };
      this.away = away;
      if (!this.menu) return;
      window.addEventListener('pointerdown', away);
    }, 0);
  }

  close(): void {
    if (this.away) {
      window.removeEventListener('pointerdown', this.away);
      this.away = null;
    }
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
  }
}
