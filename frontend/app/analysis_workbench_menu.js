class WorkbenchMenu {
  constructor() {
    this.menu = null;
    this.away = null;
  }
  open(anchor, items) {
    this.close();
    const menu = document.createElement("div");
    menu.className = "awb-menu";
    menu.dataset.awb = "menu";
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "awb-menu-item";
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      button.addEventListener("click", () => {
        this.close();
        item.action();
      });
      menu.append(button);
    }
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left)) + "px";
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4)) + "px";
    this.menu = menu;
    window.setTimeout(() => {
      const away = (event) => {
        if (this.menu && !this.menu.contains(event.target)) this.close();
      };
      this.away = away;
      if (!this.menu) return;
      window.addEventListener("pointerdown", away);
    }, 0);
  }
  close() {
    if (this.away) {
      window.removeEventListener("pointerdown", this.away);
      this.away = null;
    }
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
  }
}
export {
  WorkbenchMenu
};
