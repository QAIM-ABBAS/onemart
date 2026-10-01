import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  tone?: "positive" | "negative" | "info";
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
}

let counter = 0;

const LIFETIME = 5000;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],

  push: (toast) => {
    const id = ++counter;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, LIFETIME);
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function toast(
  message: string,
  options: { tone?: ToastItem["tone"]; action?: ToastAction } = {},
): number {
  return useToasts.getState().push({ message, ...options });
}
