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

export class Plugin {}
export class Setting {}
export class Dialog {}
export class Menu {}
