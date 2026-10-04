/*
 * 从 CHANGELOG.md 中取出指定版本的段落，作为 GitHub Release 的说明。
 *
 * 没有对应段落时回落到「Unreleased」段落，再没有就输出一行兜底说明：
 * 宁可发布说明写得少，也不要让 release 步骤失败。
 */
import fs from "node:fs";

const version = process.argv[2];
if (!version) {
    console.error("用法: node scripts/extract_changelog.js <version>");
    process.exit(1);
}

const text = fs.readFileSync("CHANGELOG.md", "utf8");
const lines = text.split(/\r?\n/);

/** 取出从标题行到下一个同级标题之间的内容 */
function sectionOf(heading) {
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^##\s/.test(line));
    const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
    return body;
}

const body = sectionOf(`## ${version}`) ?? sectionOf("## Unreleased");
process.stdout.write(body ? `${body}\n` : `Release ${version}\n`);
