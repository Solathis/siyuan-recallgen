/**
 * 服务商 logo（@lobehub/icons-static-svg，与 @lobehub/icons 同一套图标的静态 SVG 版本）。
 *
 * 不用 @lobehub/icons 本体：那是 React 组件，用了就得把 React 打进单文件插件包。
 * 逐个按 ?url 引入，打包时只内联用到的这几个；有彩色版的用彩色版，小米 MiMo 只有单色版。
 */
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import doubao from "@lobehub/icons-static-svg/icons/doubao-color.svg?url";
import huaweicloud from "@lobehub/icons-static-svg/icons/huaweicloud-color.svg?url";
import hunyuan from "@lobehub/icons-static-svg/icons/hunyuan-color.svg?url";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg?url";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import wenxin from "@lobehub/icons-static-svg/icons/wenxin-color.svg?url";
import xiaomimimo from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import zhipu from "@lobehub/icons-static-svg/icons/zhipu-color.svg?url";

/** 目录里 preset.icon → 图标地址 */
export const PROVIDER_ICONS: Record<string, string> = {
    deepseek,
    doubao,
    huaweicloud,
    hunyuan,
    kimi,
    qwen,
    wenxin,
    xiaomimimo,
    zhipu,
};
