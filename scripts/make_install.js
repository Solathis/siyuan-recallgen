/*
 * Copyright (c) 2024 by frostime. All Rights Reserved.
 * @Author       : frostime
 * @Date         : 2024-03-28 20:03:59
 * @FilePath     : /scripts/make_install.js
 * @LastEditTime : 2024-09-06 18:08:19
 * @Description  :
 */
// make_install.js
import fs from "fs";
import path from "path";
import { log, error, getSiYuanDir, chooseTarget, copyDirectory, getThisPluginName } from "./utils.js";

let targetDir = "";

/**
 * 1. Get the parent directory to install the plugin
 */
log('>>> Try to visit constant "targetDir" in make_install.js...');
if (targetDir === "") {
    log('>>> Constant "targetDir" is empty, try to get SiYuan directory automatically....');
    let res = await getSiYuanDir();

    if (res === null || res === undefined || res.length === 0) {
        error(">>> Can not get SiYuan directory automatically");
        process.exit(1);
    } else {
        targetDir = await chooseTarget(res);
    }
    log(`>>> Successfully got target directory: ${targetDir}`);
}
if (!fs.existsSync(targetDir)) {
    error(`Failed! Plugin directory not exists: "${targetDir}"`);
    error("Please set the plugin directory in scripts/make_install.js");
    process.exit(1);
}

const name = getThisPluginName();
if (name === null) {
    process.exit(1);
}

/**
 * 2. The built output directory.
 * `pnpm build` 会优先写 OUTPUT_DIR（见 vite.config.ts 与 .env.local），
 * 这时 dist/ 可能压根没被更新——直接复制 dist 会把旧产物装进插件目录。
 */
const distDir = resolveBuildDir();
if (!fs.existsSync(distDir)) {
    error(`Failed! Build output directory not exists: "${distDir}"`);
    error("Please run `pnpm run build` first (or unset OUTPUT_DIR).");
    process.exit(1);
}
if (!fs.existsSync(`${distDir}/index.js`)) {
    error(`Failed! "${distDir}" does not look like a build output (no index.js).`);
    process.exit(1);
}

/** 与 vite.config.ts 保持一致：OUTPUT_DIR > .env.local 的 OUTPUT_DIR > dist */
function resolveBuildDir() {
    const fromEnv = process.env.OUTPUT_DIR;
    if (fromEnv) return path.resolve(process.cwd(), fromEnv);
    const envFile = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envFile)) {
        const line = fs
            .readFileSync(envFile, "utf8")
            .split(/\r?\n/)
            .find((l) => l.trim().startsWith("OUTPUT_DIR="));
        if (line) {
            const value = line.slice(line.indexOf("=") + 1).trim();
            if (value) return path.resolve(process.cwd(), value);
        }
    }
    return path.join(process.cwd(), "dist");
}

/**
 * 3. The target directory to install the plugin
 */
const targetPath = `${targetDir}/${name}`;

/**
 * 4. Copy the compiled plugin code to the target directory
 */
copyDirectory(distDir, targetPath);
