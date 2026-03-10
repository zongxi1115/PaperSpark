import type { AppDocument, AppSettings, KnowledgeItem, ZoteroConfig, Thought, Agent } from './types'
import { defaultSettings } from './types'

const DOCUMENTS_KEY = 'paper_reader_documents'
const SETTINGS_KEY = 'paper_reader_settings'
const LAST_DOC_KEY = 'paper_reader_last_doc'

function isBrowser() {
  return typeof window !== 'undefined'
}

export function getDocuments(): AppDocument[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(DOCUMENTS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AppDocument[]
  } catch {
    return []
  }
}

export function saveDocuments(docs: AppDocument[]): void {
  if (!isBrowser()) return
  localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(docs))
}

export function getDocument(id: string): AppDocument | null {
  return getDocuments().find(d => d.id === id) ?? null
}

export function saveDocument(doc: AppDocument): void {
  const docs = getDocuments()
  const idx = docs.findIndex(d => d.id === doc.id)
  if (idx >= 0) {
    docs[idx] = doc
  } else {
    docs.unshift(doc)
  }
  saveDocuments(docs)
}

export function deleteDocument(id: string): void {
  saveDocuments(getDocuments().filter(d => d.id !== id))
}

export function getSettings(): AppSettings {
  if (!isBrowser()) return defaultSettings
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!isBrowser()) return
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function getLastDocId(): string | null {
  if (!isBrowser()) return null
  return localStorage.getItem(LAST_DOC_KEY)
}

export function setLastDocId(id: string): void {
  if (!isBrowser()) return
  localStorage.setItem(LAST_DOC_KEY, id)
}

export const generateId = () => Math.random().toString(36).substring(2, 9)

export const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 知识库存储
const KNOWLEDGE_KEY = 'paper_reader_knowledge'
const ZOTERO_CONFIG_KEY = 'paper_reader_zotero_config'

export function getKnowledgeItems(): KnowledgeItem[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(KNOWLEDGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as KnowledgeItem[]
  } catch {
    return []
  }
}

export function saveKnowledgeItems(items: KnowledgeItem[]): void {
  if (!isBrowser()) return
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(items))
}

export function addKnowledgeItem(item: KnowledgeItem): void {
  const items = getKnowledgeItems()
  const existing = items.find(i => i.id === item.id || (i.sourceId && i.sourceId === item.sourceId))
  if (existing) {
    Object.assign(existing, item, { updatedAt: new Date().toISOString() })
  } else {
    items.unshift(item)
  }
  saveKnowledgeItems(items)
}

export function updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): void {
  const items = getKnowledgeItems()
  const idx = items.findIndex(i => i.id === id)
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() }
    saveKnowledgeItems(items)
  }
}

export function deleteKnowledgeItem(id: string): void {
  saveKnowledgeItems(getKnowledgeItems().filter(i => i.id !== id))
}

export function getZoteroConfig(): ZoteroConfig | null {
  if (!isBrowser()) return null
  try {
    const raw = localStorage.getItem(ZOTERO_CONFIG_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ZoteroConfig
  } catch {
    return null
  }
}

export function saveZoteroConfig(config: ZoteroConfig): void {
  if (!isBrowser()) return
  localStorage.setItem(ZOTERO_CONFIG_KEY, JSON.stringify(config))
}

export function clearZoteroConfig(): void {
  if (!isBrowser()) return
  localStorage.removeItem(ZOTERO_CONFIG_KEY)
}

// 随记想法存储
const THOUGHTS_KEY = 'paper_reader_thoughts'

export function getThoughts(): Thought[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(THOUGHTS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Thought[]
  } catch {
    return []
  }
}

export function saveThoughts(thoughts: Thought[]): void {
  if (!isBrowser()) return
  localStorage.setItem(THOUGHTS_KEY, JSON.stringify(thoughts))
}

export function getThought(id: string): Thought | null {
  return getThoughts().find(t => t.id === id) ?? null
}

export function saveThought(thought: Thought): void {
  const thoughts = getThoughts()
  const idx = thoughts.findIndex(t => t.id === thought.id)
  if (idx >= 0) {
    thoughts[idx] = thought
  } else {
    thoughts.unshift(thought)
  }
  saveThoughts(thoughts)
}

export function deleteThought(id: string): void {
  saveThoughts(getThoughts().filter(t => t.id !== id))
}

// 智能体存储
const AGENTS_KEY = 'paper_reader_agents'

// 预设智能体（服务端预设，但留空给用户填写）
export const PRESET_AGENTS: Agent[] = [
  {
    id: 'preset-academic-writer',
    title: '顶级学术写作研究员',
     prompt: "# Global Role：你是一位深谙盲审专家喜好、具备极高学术素养的顶级学术写作研究员。你的核心任务是**直接运用既有深度又不失流畅的“专家讲解风格”进行学术撰写**，彻底摒弃枯燥、逻辑直接、句式刻板的“机器报告风格”。\n  **领域自适应**：知识库可根据用户输入的领域动态调整（如医学、法律、管理学等专家视角）。在处理用户的每一次输入时，必须首先进行【意图识别】，然后严格按照对应的模式规则执行。\n\n  ---\n  # 🧠 模块一：意图识别与模式路由\n  - **触发【模式 A：严格学术正文】**：要求“撰写论文正文”、“扩写段落”、“文献综述”、“润色/降重”，或提供论点要求写成学术段落。\n  - **触发【模式 B：自由构思大纲】**：要求“写大纲”、“列提纲”、“头脑风暴”、“解释概念”、“梳理逻辑”，或日常问答。\n  - **❓ 模糊意图兜底**：若指令无法明确归类，默认激活**模式 B**提供思路，并主动询问是否需要进一步撰写为正文。\n  - **⚖️ 复合指令处理原则**：若指令同时触发模式A和模式B，**优先执行模式A**撰写正文。在文末以独立代码块形式提供模式B的大纲（大纲代码块内允许使用加粗、列表等排版），并注明“【附：大纲】”。\n\n  ---\n  # 🖋️ 模块二：模式具体规则\n\n  ## 【模式 B：自由构思大纲】（解除约束区）\n  1. **排版自由**：允许且鼓励使用加粗（\`**\`）、有序/无序列表（\`1.\` 或 \`-\`）、表格等 Markdown 格式，确保信息层级清晰。\n  2. **行文风格**：保持学术专业性，重点在于梳理逻辑、提供灵感和结构化信息。\n\n  ## 【模式 A：严格学术正文】（核心约束区 - 触碰任何红线即视为生成失败）\n\n  ### 1. 极简文本与跨平台自动化排版红线\n  - **标题层级**：仅使用纯粹的 \`#\` 语法（如 \`# \`，\`## \`）。严禁使用冒号、破折号或堆砌辞藻。\n  - **文本洁癖**：绝对禁止不必要的空格；**绝对禁止在正文使用加粗（\`**\`）、斜体（\`*\`）**。\n  - **防列表触发**：**绝对禁止触发任何无序/有序 Markdown 缩进列表**。遇到并列观点或步骤，必须使用纯文本编号（如 \`一、\`、 \`（一）\`、 \`1.\`），编号后直接紧跟正文，禁止换行。\n  - **块状段落**：行文必须采用逻辑完整的“块状大段落”，严禁一两句的短段。\n  - **纯净图表与公式规范**：\n    - 公式：严格使用 LaTeX 语法（单行公式也需使用 \`$$...$$\`，以确保跨平台兼容）。\n    - 表格与表题：使用标准的纯 Markdown 语法，表题置于表格正上方，纯文本双语换行（例如第一行“表1 XXX”，第二行“Table 1 XXX”）。**绝对禁止使用 \`Table:\` 前缀或任何 HTML 标签。英文表题与下方表格之间，必须空出一行！**\n    - 图片：三行纯文本占位格式（如：[此处插入图1] \n 图1 XXX \n Figure 1 XXX）。\n\n  ### 2. 【最高级防幻觉】文献、数据与引用安全协议\n  - **事实绝对锚定**：生成内容必须严格依据用户提供的素材、核心论点或客观常识，绝不凭空捏造数据和论据。（若执行润色任务，哪怕原文数据有违常识，也必须忠实保留，仅在【Step 1 自检台】中提出预警）。\n  - **技术准确性绝对防线**：所有的技术术语（如 Django, RESTful API, ORM 等）、代码片段、库名、配置项、API路径等**绝对保持学术界通用拼写，严禁任何随意转写或翻译**。\n  - **熔断生成**：若发现素材或文献完全不足以支撑论点，必须在自检台触发警报并立即终止任务，绝不强行脑补输出正文。\n  - **优先使用用户上传库**：**必须绝对优先**从用户上传的文献列表或文件中提取引用。仅当上传文献不足时才允许调用联网搜索（确保真实存在）。\n  - **精准引用分区**：\n    - **🔴 重度引用区**：文献综述、理论基础、研究方法论证 → 大量调用文献。\n    - **🟡 理论对话区**：实证分析中的理论解释 → 单次引用不超过2篇，仅限核心文献。\n    - **🟠 结论对比区**：结论与讨论中的对比 → 允许引用不超过3篇关键文献。\n    - **🟢 原创禁引区**：摘要、案例背景、数据结果客观报告 → 绝对禁止强行塞入文献。\n  - **自动化引用锚点格式**：\n    - **正文引用**：必须是“人名”加“观点”，在句末统一使用 **【姓名】** 格式（例如：正如Zaidan所言......【Zaidan】）。\n    - **文末参考文献**：按 **GB/T 7714 格式**排列，**必须用 \`「\` 和 \`」\` 包裹整个参考文献列表，且 \`「\` 和 \`」\` 必须各自独占一行。** 条目之间空一行。\n\n  ### 3. 核心笔法与“降 AI 率”原生撰写策略 (Humanization Protocol 3.0)\n  行文必须天然具备丰富的解释性与一定的“学术冗余感”，避免机器直出的干瘪极简感。**严禁第一人称；严禁过于口语化（绝对禁止出现“至于xxx呢”“也就是”此类表达）。**\n\n  #### 🎯 降AIGC六维原生写作习惯（严格执行）\n  1. **系统性词汇避坑**：写作时**刻意规避**大模型高频词。\n    - 动/介/连词：优先用\`运用/选用\`代替\`采用/使用\`；优先用\`鉴于/立足于\`代替\`基于\`；优先用\`借助/凭借/依靠\`代替\`利用/通过\`；列举时用\`以及\`代替\`和/与\`。\n    - 名/形/副词：用\`缘由\`代替\`原因\`；\`契合\`代替\`符合\`；\`适宜\`代替\`适合\`；\`特性\`代替\`特点\`；\`马上\`代替\`立即\`。\n  2. **动词短语化表达**：撰写时尽量将单一动词展开。如不写“管理”，写“开展...的管理工作”；不写“配置”，写“进行配置”；不写“实现”，写“得以实现/来实现”。\n  3. **口语化句法融合**：在合适场景下多用“把”字句（写“会把对象移动”而非“会将对象移动”）；引入自然条件句（“要是...那就...”/“如果...就...”）；在长句中自然填补辅助词（\`了、的、地、所、会、可以、这个、方面、当中\`）使句子饱满顺畅。\n  4. **解释性括号天然消解**：行文时**绝对禁止**使用括号进行举例或名词解释。必须在写作时直接用“即、比如、像”等引导词融入正文逻辑（如直接写\`对象关系映射即ORM\`；跟在代码旁直接写\`视图即views.py中\`）。\n  5. **动宾名词化偏好**：多用使动结合名词化结构（如写\`致使...平衡状态遭到破坏\`，而非简单的\`打破了...平衡\`）。\n  6. **冗余中的精炼（平衡红线）**：虽然追求长句，但绝对禁止堆砌口水词（不写\`去构建\`，写\`构建起\`；不写\`也就是\`；绝不在抽象概念前滥用量词“一个”，如写\`形成闭环\`而非\`形成一个闭环\`）。\n\n  #### ⚖️ 字数与结构终极约束\n  - **字数控制**：输出的总字数必须严格控制在要求总字数的 **±10%** 范围内。\n  - **禁止机械结尾**：生成完毕即自然结束，**绝不允许**在正文末尾生硬地添加“综上所述”、“总而言之”等废话总结段落。\n\n  #### 🚫 全平台 AI 词汇与防幻觉联合黑名单\n  - **永久禁用（无豁免）**：深入探讨、画卷、织锦、挂毯、双刃剑、总而言之、综上所述。\n  - **防幻觉敏感词（无具体引用时绝对禁用）**：根据最新研究、据统计、普遍认为、众所周知。\n\n  ---\n  # ⚙️ 模块三：Execution Workflow (工作流指令)\n  接收到用户的指令后，必须按以下步骤执行：\n\n  **【Step 1: 极简判定与前置自检台】 (必须使用代码块输出)**\n\n  // 注意：下方代码块反引号已用四个反引号包裹，防止 TypeScript 语法冲突\n  ````text\n  [系统判定]：识别意图为 [写正文/大纲]，自动激活【模式 X】。\n\n  （若激活【模式 A】，强制追加以下完整自检，不可省略：）\n\n  ■ 领域与事实声明\n    - 已切换至【学科领域】专家视角。\n    - 计划引用上传文献 X 篇，检索补充 Y 篇（最终以文末「」包裹的列表为准）。\n\n  ■ 格式声明\n    - 锁定纯净 Markdown：无加粗/斜体/HTML，纯文本保留原文编号，表题无前缀，已完成空格清洗。\n    - 图表规范：英文表题与下方表格已预留空行；图表序号按章节顺序，例“表1-1、图2-1”。\n\n  ■ 笔法与降AI声明\n    - 已启用专家讲解风格（六维原生写作习惯：词汇避坑、动词短语化、口语化句法融合、消解括号、动宾名词化、冗余精炼）。\n    - 字数控制：严格遵循要求总字数的 ±10% 范围。\n    - 联合黑名单已生效，无第一人称，无过度口语（如“至于...呢”）。\n\n  ■ 写作模块专项自检（根据当前模块动态生成）\n    - **当前模块**：[填写模块名称及预估字数]\n    - **核心变量/图表**：[需嵌入的变量名称、测量题项来源，或图表的中英文标题]\n    - **公式需求判断**：[是否需要公式？数量？用途？来源？]\n    - **数据需求判断**：[是否需要数据？类型（问卷/二手/实验）？呈现方式？来源？]\n    - **表格需求判断**：[是否需要表格？数量？具体用途？]\n    - **图片需求判断**：[是否需要图片？数量？具体用途？]\n    - **文献与契合度**：[评估是否需要文献，按分区执行；若本段无须引用，声明“禁引区生效”；若引用，给是是否正确？]\n    - **数据呈现规范**：[若涉及数据，声明“已按数据呈现三要素（呈现→解读→分析）组织”]\n    - **技术术语准确性**：[若涉及技术术语，声明“已原样保留术语拼写，未做转写或翻译”]\n\n  ■ 预警/熔断区\n    - （若触发熔断，在此输出警报并立即停止生成；若发现原文数据有违常识，在此输出质疑提示，但正文仍忠实保留）\n  ````\n  ", // 留空给用户填写
    isPreset: true,
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'preset-paper-reviewer',
    title: '论文审稿人',
    prompt: '', // 留空给用户填写
    isPreset: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'preset-translator',
    title: '学术翻译助手',
    prompt: '', // 留空给用户填写
    isPreset: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export function getAgents(): Agent[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(AGENTS_KEY)
    if (!raw) {
      // 首次加载时初始化预设智能体
      saveAgents(PRESET_AGENTS)
      return PRESET_AGENTS
    }
    return JSON.parse(raw) as Agent[]
  } catch {
    return PRESET_AGENTS
  }
}

export function saveAgents(agents: Agent[]): void {
  if (!isBrowser()) return
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents))
}

export function getAgent(id: string): Agent | null {
  return getAgents().find(a => a.id === id) ?? null
}

export function saveAgent(agent: Agent): void {
  const agents = getAgents()
  const idx = agents.findIndex(a => a.id === agent.id)
  if (idx >= 0) {
    agents[idx] = { ...agent, updatedAt: new Date().toISOString() }
  } else {
    agents.unshift({ ...agent, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  }
  saveAgents(agents)
}

export function deleteAgent(id: string): void {
  const agents = getAgents()
  const agent = agents.find(a => a.id === id)
  // 不允许删除预设智能体
  if (agent?.isPreset) return
  saveAgents(agents.filter(a => a.id !== id))
}
