// dsh-browser · DSH 宿主环境客户端类型声明 (消除对本地物理路径的强绑定)

declare module "@deepseek-ai/dsh-client-runtime/client" {
  export interface SlotRegistry {
    inject(name: string, factory: () => unknown): unknown;
    register(meta: Record<string, unknown>, component: unknown): unknown;
  }

  export interface ClientContext {
    slots: SlotRegistry;
    get<T = unknown>(name: string): T | undefined;
    provide(name: string, value: unknown): void;
    inject(deps: string[], callback: (...args: any[]) => void): void;
    effect(fn: () => void | (() => void)): void;
    on(event: string, listener: (...args: any[]) => void): () => void;
    emit(event: string, ...args: any[]): void;
    logger?: {
      info?(msg: string): void;
      warn?(msg: string): void;
      error?(msg: string): void;
      debug?(msg: string): void;
    };
  }
}

declare module "@deepseek-ai/dsh-client-ui-settings/client" {
  export interface SettingsSectionOwnerProps {
    close: () => void;
  }
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  export interface SlotMap {
    [key: string]: unknown;
  }
}
