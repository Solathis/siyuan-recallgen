import { describe, expect, it } from "vitest";
import PromiseLimitPool from "./promise-pool";

const tick = () => new Promise((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PromiseLimitPool", () => {
    it("并发数不超过上限，且任务会随槽位释放继续启动", async () => {
        const pool = new PromiseLimitPool<number>(2);
        let inFlight = 0;
        let maxInFlight = 0;
        const started: number[] = [];

        for (let i = 0; i < 6; i++) {
            pool.add(async () => {
                started.push(i);
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await delay(10);
                inFlight--;
                return i;
            });
        }

        const results = await pool.awaitAll();
        expect(maxInFlight).toBe(2);
        expect(started).toHaveLength(6);
        // 结果按加入顺序返回，而不是按完成顺序
        expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("上限为 1 时严格串行", async () => {
        const pool = new PromiseLimitPool<void>(1);
        let inFlight = 0;
        let maxInFlight = 0;
        const order: number[] = [];
        for (let i = 0; i < 4; i++) {
            pool.add(async () => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await delay(5);
                order.push(i);
                inFlight--;
            });
        }
        await pool.awaitAll();
        expect(maxInFlight).toBe(1);
        expect(order).toEqual([0, 1, 2, 3]);
    });

    it("任务抛错时：该任务的 Promise 拒绝，但槽位要释放（否则队列永久卡死）", async () => {
        const pool = new PromiseLimitPool<string>(1);
        const finished: string[] = [];

        pool.add(async () => {
            throw new Error("boom");
        });
        pool.add(async () => {
            finished.push("second");
            return "second";
        });
        pool.add(async () => {
            finished.push("third");
            return "third";
        });

        await expect(pool.awaitAll()).rejects.toThrow("boom");
        // 第一个失败不能挡住后面的任务
        expect(finished).toEqual(["second", "third"]);
    });

    it("空池的 awaitAll 直接返回空数组", async () => {
        const pool = new PromiseLimitPool<number>(3);
        await expect(pool.awaitAll()).resolves.toEqual([]);
    });

    it("异步任务不会因为 add 的同步循环而被误判为「未超限」", async () => {
        // add 是同步的：若上限判断不小心用了「已加入数」而不是「正在跑的数」，
        // 同步加入 5 个任务就会突破并发上限
        const pool = new PromiseLimitPool<number>(2);
        let inFlight = 0;
        let maxInFlight = 0;
        for (let i = 0; i < 5; i++) {
            pool.add(async () => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await tick();
                inFlight--;
                return i;
            });
        }
        await pool.awaitAll();
        expect(maxInFlight).toBe(2);
    });

    it("任务返回 undefined 也能正确收齐（调用方有这种用法）", async () => {
        const pool = new PromiseLimitPool<void>(2);
        const seen: number[] = [];
        for (let i = 0; i < 3; i++) pool.add(async () => void seen.push(i));
        await expect(pool.awaitAll()).resolves.toEqual([undefined, undefined, undefined]);
        expect(seen.sort()).toEqual([0, 1, 2]);
    });
});
