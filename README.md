<div align="center">

# ⚡ PaperSpark

**点燃学术灵感 · AI 驱动的论文阅读与写作助手**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-orange)](LICENSE)

</div>

---

## ✨ 项目简介

PaperSpark 是一款 AI 驱动的学术论文阅读与写作工具，帮助研究者更高效地阅读文献、整理知识库、撰写高质量学术内容。

- 📚 **知识库管理** — 集中管理文献，一键同步 Zotero
- ✍️ **智能写作编辑器** — 基于 BlockNote 的富文本编辑，写作流畅不中断
- 🤖 **AI 语法纠错** — 实时检测并修正英文写作错误，段落切换时自动触发
- 🌐 **AI 翻译** — 中英文一键互译，支持学术风格
- 📝 **论文摘要生成** — 大模型自动提炼文献核心内容
- 🗂️ **目录导航** — 右侧边栏实时生成文档目录，快速定位章节

---

## 🖼️ 功能一览

| 模块 | 功能 |
|------|------|
| 文档列表 | 创建、管理、删除文档，快速跳转 |
| 编辑器 | 富文本写作 + 段落 AI 纠错 + 自动保存 |
| 知识库 | 上传文献 / Zotero 同步 / AI 摘要 / 翻译 |
| 设置 | 配置大模型与小模型（兼容 OpenAI 格式接口） |

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8（推荐）

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 即可使用。

---

## ⚙️ 配置 AI 模型

进入 **设置** 页面，分别配置以下两个模型：

### 小模型（语法纠错）
负责实时英文语法检查，建议使用响应快、成本低的模型，例如 `gpt-4o-mini`。

### 大模型（翻译 / 摘要）
负责文献翻译与摘要生成，建议使用能力强的模型，例如 `gpt-4o`、`claude-3-5-sonnet`。

> 两个模型均支持任意兼容 OpenAI 格式的 API（如 Ollama、DeepSeek、硅基流动等），API Key 仅存储在本地浏览器，不会上传服务器。

---

## 📖 Zotero 集成

1. 前往 [Zotero 账户设置](https://www.zotero.org/settings/keys) 获取 User ID 和 API Key
2. 在 PaperSpark 知识库面板中填入配置并点击同步
3. 文献条目将自动导入本地知识库，支持 AI 摘要与翻译

---

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| [Next.js 15](https://nextjs.org/) | 全栈框架 |
| [React 19](https://react.dev/) | UI 框架 |
| [BlockNote](https://www.blocknotejs.org/) | 富文本编辑器 |
| [HeroUI](https://www.heroui.com/) | 组件库 |
| [Vercel AI SDK](https://sdk.vercel.ai/) | AI 接口调用 |
| [Framer Motion](https://www.framer.motion.com/) | 动画效果 |
| [Tailwind CSS v4](https://tailwindcss.com/) | 样式系统 |

---

## 📁 项目结构

```
paper_reader/
├── app/                   # Next.js App Router 页面与 API
│   ├── api/
│   │   ├── ai/            # AI 纠错 / 翻译接口
│   │   ├── knowledge/     # 知识库摘要 / 上传接口
│   │   └── zotero/        # Zotero 同步接口
│   ├── documents/         # 文档列表页
│   ├── editor/[id]/       # 编辑器页面
│   └── settings/          # 设置页面
├── components/            # React 组件
│   ├── Editor/            # 编辑器核心组件
│   ├── Knowledge/         # 知识库面板
│   ├── Sidebar/           # 目录 / 右侧边栏
│   └── Settings/          # 设置表单
└── lib/                   # 工具函数
    ├── ai.ts              # AI 调用封装
    ├── storage.ts         # 本地存储操作
    └── types.ts           # TypeScript 类型定义
```

---

## �️ Roadmap

以下是计划中的功能方向，欢迎社区参与讨论与贡献：


- [ ] 精读文章列表利用RAG生成一个知识图谱
- [ ] 助手交互端要能生成图片、mermaid这类图并且一键添加到资产库
- [ ] 助手生成大纲，并且在主界面需要有进行中的过程查看
- [ ] 选中文本内容，助手可以基于选中内容进行完成用户要求的操作
- [ ] 可引用资产库


> 💬 有新想法？欢迎提 [Issue](../../issues) 参与讨论！



## 致谢
感谢以下项目与资源的支持：
- [Next.js](https://nextjs.org/) — 强大的 React 全栈框架
- [BlockNote](https://www.blocknotejs.org/) — 灵活的富文本编辑器
- [Vercel AI SDK](https://sdk.vercel.ai/) — 便捷的 AI 接口调用工具
- [HeroUI](https://www.heroui.com/) — 美观的 React 组件库
- [Framer Motion](https://www.framer.motion.com/) — 流畅的动画效果
- [Tailwind CSS](https://tailwindcss.com/) — 高效的实用类 CSS 框架
- [Zotero](https://www.zotero.org/) — 强大的文献管理工具
- [surya-ocr](https://github.com/surya-ocr/surya) — 论文 OCR 解析服务



---

## 📄 License

本项目基于 **CC BY-NC 4.0** 协议开源。

- ✅ 允许：学习、研究、个人使用、署名转载
- ❌ 禁止：任何形式的商业化使用、付费分发、集成至商业产品

详见 [LICENSE](LICENSE) 文件。