!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 PaperSpark"
  !define MUI_WELCOMEPAGE_TEXT "PaperSpark 是一个面向论文阅读、知识沉淀与学术写作的桌面工作台。$\r$\n$\r$\n安装后，你可以在本地管理文献、同步 Zotero、进行沉浸式阅读，并按需连接 Python OCR 与文档分析服务。$\r$\n$\r$\n建议保留默认安装路径，或选择一个你常用的位置以便后续升级与数据管理。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载 PaperSpark"
  !define MUI_WELCOMEPAGE_TEXT "PaperSpark 会帮助你整理论文、知识和写作流程。$\r$\n$\r$\n如果当前不再需要它，你可以继续卸载；卸载完成后，应用程序文件将从电脑中移除。$\r$\n$\r$\n你的本地数据是否保留，取决于后续的卸载选项与系统设置。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
