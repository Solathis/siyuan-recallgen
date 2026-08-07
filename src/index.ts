import { Plugin, showMessage, getFrontend } from "siyuan";
import "./index.scss";

const STORAGE_NAME = "recallgen-config";

/**
 * RecallGen: AI-powered quiz generation and spaced review for SiYuan.
 * 入口类，后续在 Step 17 完整编排菜单/命令/Tab/设置面板。
 */
export default class RecallGenPlugin extends Plugin {
    isMobile = false;

    async onload() {
        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
        this.data[STORAGE_NAME] = {};
        console.log(`[${this.name}] loading, frontend=${frontEnd}`);
    }

    async onunload() {
        console.log(`[${this.name}] unload`);
        showMessage(this.i18n.byePlugin);
    }

    async uninstall() {
        await this.removeData(STORAGE_NAME).catch((e) => {
            showMessage(`[${this.name}] remove data fail: ${e.msg}`);
        });
    }
}
