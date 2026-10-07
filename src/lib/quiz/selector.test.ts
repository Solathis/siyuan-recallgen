import { afterEach, describe, expect, it, vi } from "vitest";
import { listDocTree, sql } from "@/api";
import { MAX_DOCS_PER_NOTEBOOK } from "./content";

vi.mock("@/api", () => ({
    sql: vi.fn(),
    listDocTree: vi.fn(),
    // 其余导出在导入期被引用，给空实现即可
    request: vi.fn(),
    // 与真实实现一致（单引号双写）。否则这条断言只是在测自己的桩：
    // 它要守的是「笔记本 id 经过转义助手」，而不是「查询里直接插值」
    quoteSqlLiteral: (value: string) => `'${String(value).replace(/'/g, "''")}'`,
    getBlockByID: vi.fn(),
    getBlockKramdown: vi.fn(),
    appendBlock: vi.fn(),
    lsNotebooks: vi.fn(),
    createDocWithMd: vi.fn(),
    getHPathByID: vi.fn(),
    exportMdContent: vi.fn(),
}));

const { collectDocIds } = await import("./selector");
const sqlMock = vi.mocked(sql);
const treeMock = vi.mocked(listDocTree);

/** 造 n 个文档节点 */
const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: `doc-${offset + i}` }));

afterEach(() => {
    vi.resetAllMocks();
});

describe("collectDocIds", () => {
    it("SQL 路径：正常返回全部文档", async () => {
        sqlMock.mockResolvedValue(rows(3));
        const result = await collectDocIds("box-1");
        expect(result).toEqual({ ids: ["doc-0", "doc-1", "doc-2"], truncated: false });
        // 查询用 limit + 1 来判断是否超限
        expect(sqlMock.mock.calls[0][0]).toContain(`LIMIT ${MAX_DOCS_PER_NOTEBOOK + 1}`);
    });

    it("SQL 路径：命中上限时如实报告 truncated（不能静默少给内容）", async () => {
        // 多查一条 → 说明还有更多文档没被取到
        sqlMock.mockResolvedValue(rows(MAX_DOCS_PER_NOTEBOOK + 1));
        const result = await collectDocIds("box-1");
        expect(result.ids).toHaveLength(MAX_DOCS_PER_NOTEBOOK);
        expect(result.truncated).toBe(true);
    });

    it("SQL 恰好取满上限但没多出那条时，不算截断", async () => {
        sqlMock.mockResolvedValue(rows(MAX_DOCS_PER_NOTEBOOK));
        const result = await collectDocIds("box-1");
        expect(result.ids).toHaveLength(MAX_DOCS_PER_NOTEBOOK);
        expect(result.truncated).toBe(false);
    });

    it("SQL 返回空（索引未就绪）时回退到文档树", async () => {
        sqlMock.mockResolvedValue([]);
        treeMock.mockResolvedValue([
            { id: "a", children: [{ id: "b" }, { id: "c", children: [{ id: "d" }] }] },
            { id: "e" },
        ] as never);
        const result = await collectDocIds("box-1");
        // 深度优先展平，父文档也在其中
        expect(result.ids).toEqual(["a", "b", "c", "d", "e"]);
        expect(result.truncated).toBe(false);
    });

    it("SQL 抛错时同样回退到文档树", async () => {
        sqlMock.mockRejectedValue(new Error("no sql"));
        treeMock.mockResolvedValue([{ id: "a" }] as never);
        await expect(collectDocIds("box-1")).resolves.toEqual({ ids: ["a"], truncated: false });
    });

    it("回退路径也受上限约束，并如实报告截断", async () => {
        sqlMock.mockResolvedValue(null as never);
        // 文档树里比上限多一堆
        treeMock.mockResolvedValue(
            Array.from({ length: MAX_DOCS_PER_NOTEBOOK + 20 }, (_, i) => ({ id: `doc-${i}` })) as never
        );
        const result = await collectDocIds("box-1");
        expect(result.ids).toHaveLength(MAX_DOCS_PER_NOTEBOOK);
        // 原实现走到上限就静默返回 truncated: false，用户会以为整本笔记都参与了出题
        expect(result.truncated).toBe(true);
    });

    it("文档树节点没有 id 时跳过，不产生空洞", async () => {
        sqlMock.mockResolvedValue([]);
        treeMock.mockResolvedValue([{ id: "" }, { id: "a" }, { children: [{ id: "b" }] }] as never);
        const result = await collectDocIds("box-1");
        expect(result.ids).toEqual(["a", "b"]);
    });

    it("笔记本 id 会被转义后拼进 SQL", async () => {
        sqlMock.mockResolvedValue(rows(1));
        await collectDocIds("box'1");
        expect(sqlMock.mock.calls[0][0]).toContain("'box''1'");
    });
});
