/**
 * 测试用的 siyuan 包替身。
 * `siyuan@1.2.3` 只提供类型声明，没有运行时实现（真实实现由思源宿主注入），
 * 因此单测中需要把裸导入 `siyuan` 指到这里。
 *
 * `fetchSyncPost` 的响应可通过 __setFetchSyncPost 替换，便于构造失败/重试场景。
 */

export interface IWebSocketData {
    code: number;
    msg: string;
    data: unknown;
}

type FetchSyncPostHandler = (url: string, data?: unknown) => Promise<IWebSocketData> | IWebSocketData;

const okResponse: FetchSyncPostHandler = () => ({ code: 0, msg: "", data: null });

let handler: FetchSyncPostHandler = okResponse;

/** 替换内核 API 响应实现（仅测试用） */
export function __setFetchSyncPost(next: FetchSyncPostHandler): void {
    handler = next;
}

/** 恢复默认响应实现（仅测试用） */
export function __resetFetchSyncPost(): void {
    handler = okResponse;
}

export async function fetchSyncPost(url: string, data?: unknown): Promise<IWebSocketData> {
    return handler(url, data);
}

export function fetchPost(_url: string, _data?: unknown, cb?: (r: IWebSocketData) => void): void {
    cb?.({ code: 0, msg: "", data: null });
}

export function showMessage(_msg: string, _timeout?: number): void {}
export function getFrontend(): string {
    return "desktop";
}
export function openTab(_options: unknown): void {}
export function confirm(_title: string, _text: string, yes?: () => void, _no?: () => void): void {
    yes?.();
}
export function getAllEditor(): unknown[] {
    return [];
}

/**
 * 插件基类替身。
 *
 * 真实实现由思源宿主注入（`siyuan` 包只有类型），因此这里按宿主的公开契约
 * 提供最小实现：把 addTab/addTopBar/addCommand/addIcons 的注册记录下来，
 * 并把数据文件放在内存里。这样插件入口可以在 jsdom 下真正跑一遍
 * onload / onunload，而不是只做模块导入冒烟。
 */
export interface TabRegistration {
    type: string;
    init?: (this: unknown) => void;
    destroy?: (this: unknown) => void;
}

export class Plugin {
    name = "siyuan-recallgen";
    displayName = "RecallGen";
    i18n: Record<string, string> = {};
    eventBus = {
        on: (_event: string, _handler: unknown) => undefined,
        off: (_event: string, _handler: unknown) => undefined,
    };
    readonly tabs: TabRegistration[] = [];
    readonly topBars: unknown[] = [];
    readonly commands: unknown[] = [];
    readonly icons: string[] = [];
    private readonly files = new Map<string, unknown>();

    addTab(reg: TabRegistration): void {
        this.tabs.push(reg);
    }
    addTopBar(options: unknown): void {
        this.topBars.push(options);
    }
    addCommand(options: unknown): void {
        this.commands.push(options);
    }
    addIcons(icon: string): void {
        this.icons.push(icon);
    }
    async loadData(name: string): Promise<unknown> {
        return this.files.has(name) ? this.files.get(name) : null;
    }
    async saveData(name: string, content: unknown): Promise<void> {
        this.files.set(name, content);
    }
    async removeData(name: string): Promise<void> {
        this.files.delete(name);
    }
}

export class Setting {}
export class Dialog {}
export class Menu {}
