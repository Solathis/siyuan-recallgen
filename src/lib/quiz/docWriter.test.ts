import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetFetchSyncPost, __setFetchSyncPost } from "@/test/siyuan-stub";
import { initI18n } from "@/lib/i18n";
import type { Question } from "@/types/quiz";
import { appendAnalysis, buildQuestionsMarkdown, titleOf } from "./docWriter";

beforeEach(() => {
    initI18n({
        "type.single_choice": "单选",
        "type.multiple_choice": "多选",
        "type.fill_blank": "填空",
        "type.true_false": "判断",
        "type.subjective": "主观",
        "type.coding": "编程",
        "diff.easy": "初级",
        "diff.medium": "中级",
        "diff.hard": "高级",
        "doc.titlePrefix": "复习题",
        "doc.answerSummary": "查看答案与解析",
        "doc.answerLabel": "**答案：** ",
        "doc.explanationLabel": "**解析：** ",
        "doc.seeCode": "见参考代码",
        "doc.blankLabel": "第 {0} 空",
        "common.true": "正确",
        "common.false": "错误",
    });
});

const q = (over: Partial<Question> & Pick<Question, "type">): Question =>
    ({ id: "q-1", difficulty: "easy", question: "题干", ...over }) as Question;

describe("titleOf", () => {
    const date = new Date(2026, 8, 23);

    it("包含前缀、日期时间与来源标题", () => {
        expect(titleOf("我的笔记", date)).toBe("复习题_20260923-000000_我的笔记");
    });

    it("同一天不同时刻保存得到不同标题（回归：只到天会导致重复建文档）", () => {
        const morning = new Date(2026, 8, 23, 9, 15, 30);
        const afternoon = new Date(2026, 8, 23, 14, 5, 6);
        expect(titleOf("我的笔记", morning)).not.toBe(titleOf("我的笔记", afternoon));
        expect(titleOf("我的笔记", morning)).toBe("复习题_20260923-091530_我的笔记");
        expect(titleOf("我的笔记", afternoon)).toBe("复习题_20260923-140506_我的笔记");
    });

    it("替换路径非法字符", () => {
        expect(titleOf('a/b\\c:d*e?f"g<h>i|j', date)).toBe("复习题_20260923-000000_a_b_c_d_e_f_g_h_i_j");
    });

    it("剔除控制字符", () => {
        expect(titleOf("前\u0000中\u001f后", date)).toBe("复习题_20260923-000000_前中后");
    });

    it("折叠连续空白并去掉结尾的点与空格（Windows 不允许）", () => {
        expect(titleOf("标题. .  ", date)).toBe("复习题_20260923-000000_标题");
        expect(titleOf("  a   b  ", date)).toBe("复习题_20260923-000000_a b");
    });

    it("超长标题被截断到 40 字符", () => {
        const title = titleOf("长".repeat(100), date);
        expect(title).toBe(`复习题_20260923-000000_${"长".repeat(40)}`);
    });

    it("来源标题清洗后为空时退化为前缀", () => {
        expect(titleOf("...", date)).toBe("复习题_20260923-000000_复习题");
        expect(titleOf("", date)).toBe("复习题_20260923-000000_复习题");
    });
});

describe("buildQuestionsMarkdown", () => {
    it("题干块带 custom-recallgen-id 的 IAL", () => {
        const md = buildQuestionsMarkdown([q({ type: "true_false", answer: true })]);
        expect(md).toContain('{: custom-recallgen-id="q-1"}');
    });

    it("答案与解析放在折叠块中", () => {
        const md = buildQuestionsMarkdown([q({ type: "true_false", answer: true, explanation: "因为如此" })]);
        expect(md).toContain("<details><summary>查看答案与解析</summary>");
        expect(md).toContain("</details>");
        expect(md).toContain("因为如此");
    });

    it("解析缺失时不输出「解析：undefined」（回归）", () => {
        const md = buildQuestionsMarkdown([q({ type: "true_false", answer: true })]);
        expect(md).not.toContain("undefined");
        expect(md).not.toContain("**解析：**");
    });

    it("选择题选项按 A/B/C 编号", () => {
        const md = buildQuestionsMarkdown([
            q({ type: "single_choice", options: ["甲", "乙", "丙"], answer: 1 } as never),
        ]);
        expect(md).toContain("A. 甲");
        expect(md).toContain("B. 乙");
        expect(md).toContain("C. 丙");
    });

    it("单选题答案输出为字母", () => {
        const md = buildQuestionsMarkdown([q({ type: "single_choice", options: ["甲", "乙"], answer: 1 } as never)]);
        expect(md).toContain("**答案：** B");
    });

    it("多选题答案按字母升序输出", () => {
        const md = buildQuestionsMarkdown([
            q({ type: "multiple_choice", options: ["甲", "乙", "丙"], answer: [2, 0] } as never),
        ]);
        expect(md).toContain("**答案：** A、C");
    });

    it("判断题答案使用本地化文案", () => {
        expect(buildQuestionsMarkdown([q({ type: "true_false", answer: false })])).toContain("**答案：** 错误");
    });

    it("填空题按空编号列出可接受答案", () => {
        const md = buildQuestionsMarkdown([q({ type: "fill_blank", answer: [["巴黎", "Paris"], ["法国"]] } as never)]);
        expect(md).toContain("第 1 空: 巴黎 / Paris");
        expect(md).toContain("第 2 空: 法国");
    });

    it("编程题无初始代码时不输出空代码块", () => {
        const md = buildQuestionsMarkdown([q({ type: "coding", language: "python", answer: "print(1)" } as never)]);
        const blocks = md.match(/```/g) ?? [];
        // 仅参考答案一个代码块 → 两个围栏标记
        expect(blocks).toHaveLength(2);
    });

    it("编程题有初始代码时输出模板与参考答案两个代码块", () => {
        const md = buildQuestionsMarkdown([
            q({
                type: "coding",
                language: "python",
                starter_code: "def f():",
                answer: "def f():\n    return 1",
            } as never),
        ]);
        expect(md.match(/```/g) ?? []).toHaveLength(4);
        expect(md).toContain("def f():");
    });

    it("参考答案含反引号时围栏自动加长，避免提前闭合", () => {
        const md = buildQuestionsMarkdown([
            q({ type: "coding", language: "markdown", answer: "```\ncode\n```" } as never),
        ]);
        expect(md).toContain("````markdown");
    });

    it("主观题输出参考答案原文", () => {
        const md = buildQuestionsMarkdown([q({ type: "subjective", reference_answer: "要点一、要点二" } as never)]);
        expect(md).toContain("**答案：** 要点一、要点二");
    });

    it("标题行包含题型与难度标签", () => {
        const md = buildQuestionsMarkdown([
            q({ type: "subjective", difficulty: "hard", reference_answer: "x" } as never),
        ]);
        expect(md).toContain("### 主观 · 高级");
    });

    it("多题顺序输出且各自带 id", () => {
        const md = buildQuestionsMarkdown([
            q({ id: "q-1", type: "true_false", answer: true }),
            q({ id: "q-2", type: "true_false", answer: false }),
        ]);
        expect(md.indexOf("q-1")).toBeLessThan(md.indexOf("q-2"));
    });

    it("空题目列表返回空串", () => {
        expect(buildQuestionsMarkdown([])).toBe("");
    });
});

describe("文档写入的注入与脏数据防护", () => {
    const single = (over: Record<string, unknown> = {}) =>
        q({ type: "single_choice", options: ["甲", "乙"], answer: 0, ...over });
    const QUOTE = String.fromCharCode(34);
    const LF = String.fromCharCode(10);
    const NUL = String.fromCharCode(0);

    it("含引号与换行的题目 id 不会写进 IAL 属性（回归：可注入任意 Markdown/IAL）", () => {
        const evil = single({ id: "x" + QUOTE + LF + '{: custom-hacked="1"}' + LF + LF + "恶意内容" });
        const md = buildQuestionsMarkdown([evil]);
        expect(md).not.toContain("custom-recallgen-id");
        expect(md).not.toContain("custom-hacked");
    });

    it("合法 id 仍会写入", () => {
        const md = buildQuestionsMarkdown([single({ id: "q-1_ab.c" })]);
        expect(md).toContain('{: custom-recallgen-id="q-1_ab.c"}');
    });

    it("选项缺失时不再因 forEach 抛错", () => {
        expect(() => buildQuestionsMarkdown([single({ options: undefined })])).not.toThrow();
    });

    it("越界/非法的答案下标不会产出 NUL 等控制字符", () => {
        for (const answer of [NaN, -1, 26, 1.5]) {
            const md = buildQuestionsMarkdown([single({ answer })]);
            expect(md.includes(NUL), String(answer)).toBe(false);
        }
    });

    it("多选题答案数组缺失时输出为空而不是抛错", () => {
        const broken = q({ type: "multiple_choice", options: ["甲", "乙"], answer: undefined as never });
        expect(() => buildQuestionsMarkdown([broken])).not.toThrow();
    });

    it("标题按码点截断，不切开 emoji 代理对", () => {
        const hasLoneSurrogate = (text: string) =>
            [...text].some((ch) => {
                const code = ch.charCodeAt(0);
                return ch.length === 1 && code >= 0xd800 && code <= 0xdfff;
            });
        const title = titleOf("🎓".repeat(60));
        expect(hasLoneSurrogate(title)).toBe(false);
        // 源标题部分按码点截到 40（emoji 算一个码点，不是 UTF-16 的两个）
        expect(title.endsWith("🎓".repeat(40))).toBe(true);
        expect(title).not.toContain("🎓".repeat(41));
    });

    it("Windows 保留设备名被加前缀规避", () => {
        expect(titleOf("nul")).toContain("_nul");
        expect(titleOf("CON")).toContain("_CON");
    });
});

describe("appendAnalysis 的空内容处理", () => {
    it("分析为空或只有空白时完全不写（回归：会留下空的分析标题）", async () => {
        const calls: unknown[] = [];
        __setFetchSyncPost((url, data) => {
            calls.push({ url, data });
            return { code: 0, msg: "", data: [{ id: "b1", doOperations: [] }] };
        });
        await appendAnalysis("doc-1", "");
        await appendAnalysis("doc-1", "   \n\t ");
        expect(calls).toHaveLength(0);
        __resetFetchSyncPost();
    });

    it("有内容时仍然追加", async () => {
        const calls: Array<{ url: string; data: unknown }> = [];
        __setFetchSyncPost((url, data) => {
            calls.push({ url, data });
            return { code: 0, msg: "", data: [{ id: "b1", doOperations: [] }] };
        });
        await appendAnalysis("doc-1", "薄弱点在导数应用");
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain("appendBlock");
        expect(JSON.stringify(calls[0].data)).toContain("薄弱点在导数应用");
        __resetFetchSyncPost();
    });
});
