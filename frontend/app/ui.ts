/* Netlab DOM/UI helpers (S5 split from app.ts; no behavior change). */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | number | null): HTMLElementTagNameMap[K];
export function el<T extends HTMLElement = HTMLElement>(tag: string, cls?: string | null, text?: string | number | null): T;
export function el(tag: string, cls?: string | null, text?: string | number | null): HTMLElement {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

export function div(cls?: string | null, text?: string | number | null): HTMLDivElement {
    return el<HTMLDivElement>('div', cls, text);
  }

export function button(label?: string | null, cls?: string | null, onClick?: ((event: MouseEvent) => void) | null): HTMLButtonElement {
    const node = el<HTMLButtonElement>('button', cls || 'btn', label);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }




export function clone<T>(value: T): T {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

export function isFormTarget(target: EventTarget | null): boolean {
    if (!target) return false;
    const tag = (target as HTMLElement).tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
  }
