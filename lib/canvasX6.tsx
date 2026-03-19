export interface CanvasBlockProps {
  graphData: string
  previewDataUrl: string
  width: number
  height: number
}

export interface CanvasOriginRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasGraphSession {
  graph: any
  history: any
  clipboard: any
  keyboard: any
  selection: any
  dispose: () => void
}

type CanvasPresetGroupId = 'basic' | 'flow' | 'architecture' | 'paper'

type CanvasShapeVariant =
  | 'rectangle'
  | 'rounded'
  | 'ellipse'
  | 'diamond'
  | 'parallelogram'
  | 'document'
  | 'multiDocument'
  | 'cylinder'
  | 'cloud'
  | 'comparison'
  | 'annotation'
  | 'text'
  | 'icon'

export interface CanvasPaletteItem {
  id: string
  label: string
  description: string
  icon: string
  iconAsset?: string
  color: string
  group: CanvasPresetGroupId
  variant: CanvasShapeVariant
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  keepAspect?: boolean
}

export interface CanvasPaletteGroup {
  id: CanvasPresetGroupId
  title: string
  items: CanvasPaletteItem[]
}

type CanvasRuntime = {
  Graph: any
  Shape: any
  Snapline: any
  Selection: any
  Clipboard: any
  Keyboard: any
  History: any
}

const LEGACY_NODE_SHAPE = 'paperspark-canvas-node'

export const DEFAULT_CANVAS_WIDTH = 1200
export const DEFAULT_CANVAS_HEIGHT = 720
export const DEFAULT_PREVIEW_MAX_WIDTH = 800
export const DEFAULT_PREVIEW_MAX_HEIGHT = 600
export const CANVAS_DRAG_MIME = 'application/x-paperspark-canvas-preset'

const PALETTE_GROUP_META: Array<{ id: CanvasPresetGroupId; title: string }> = [
  { id: 'basic', title: '基本形状' },
  { id: 'flow', title: '流程元素' },
  { id: 'architecture', title: '系统架构' },
  { id: 'paper', title: '论文图表' },
]

const CANVAS_PRESETS: CanvasPaletteItem[] = [
  { id: 'rect', label: '矩形', description: '通用模块', icon: 'mdi:shape-rectangle-plus', color: '#4f46e5', group: 'basic', variant: 'rectangle', minWidth: 88, minHeight: 56 },
  { id: 'rounded', label: '圆角矩形', description: '柔和模块', icon: 'mdi:rectangle-rounded', color: '#7c3aed', group: 'basic', variant: 'rounded', minWidth: 88, minHeight: 56 },
  { id: 'ellipse', label: '圆 / 椭圆', description: '开始或结束', icon: 'mdi:ellipse-outline', color: '#0891b2', group: 'basic', variant: 'ellipse', width: 132, height: 92, minWidth: 72, minHeight: 72 },
  { id: 'diamond', label: '菱形', description: '判断节点', icon: 'mdi:source-branch', color: '#f59e0b', group: 'basic', variant: 'diamond', width: 138, height: 96, minWidth: 88, minHeight: 64 },
  { id: 'parallelogram', label: '平行四边形', description: '输入输出', icon: 'mdi:shape-parallelogram-plus', color: '#ef4444', group: 'basic', variant: 'parallelogram', width: 152, height: 84, minWidth: 96, minHeight: 56 },

  { id: 'start', label: '开始 / 结束', description: '流程起止', icon: 'mdi:play-circle-outline', color: '#0f766e', group: 'flow', variant: 'ellipse', width: 146, height: 86, minWidth: 88, minHeight: 72 },
  { id: 'process', label: '处理块', description: '标准流程', icon: 'mdi:cog-outline', color: '#4338ca', group: 'flow', variant: 'rectangle', minWidth: 92, minHeight: 56 },
  { id: 'decision', label: '决策', description: '条件分支', icon: 'mdi:call-split', color: '#f59e0b', group: 'flow', variant: 'diamond', width: 144, height: 100, minWidth: 92, minHeight: 72 },
  { id: 'data', label: '数据', description: '输入输出', icon: 'mdi:database-arrow-right-outline', color: '#dc2626', group: 'flow', variant: 'parallelogram', width: 150, height: 84, minWidth: 96, minHeight: 56 },
  { id: 'document', label: '文档', description: '资料或报告', icon: 'mdi:file-document-outline', color: '#f97316', group: 'flow', variant: 'document', width: 146, height: 104, minWidth: 98, minHeight: 72 },
  { id: 'multiDocument', label: '多文档', description: '多份资料', icon: 'mdi:file-multiple-outline', color: '#ec4899', group: 'flow', variant: 'multiDocument', width: 154, height: 110, minWidth: 104, minHeight: 72 },
  { id: 'storage', label: '数据存储', description: '数据库或磁盘', icon: 'mdi:database-outline', color: '#2563eb', group: 'flow', variant: 'cylinder', width: 150, height: 100, minWidth: 104, minHeight: 72 },

  { id: 'server', label: '服务器', description: '后端服务图标', icon: 'mdi:server-outline', iconAsset: 'server', color: '#0f766e', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 16, minHeight: 16 },
  { id: 'client', label: '客户端', description: '桌面或网页图标', icon: 'mdi:monitor-dashboard', iconAsset: 'client', color: '#7c3aed', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'browser', label: '浏览器', description: '浏览器图标', icon: 'mdi:web', iconAsset: 'browser', color: '#2563eb', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'mobile', label: '移动端', description: '手机图标', icon: 'mdi:cellphone', iconAsset: 'mobile', color: '#2563eb', group: 'architecture', variant: 'icon', width: 18, height: 26, minWidth: 12, minHeight: 16 },
  { id: 'gateway', label: '网关', description: '访问入口图标', icon: 'mdi:api', iconAsset: 'gateway', color: '#ea580c', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'apiIcon', label: 'API', description: '接口服务图标', icon: 'mdi:api', iconAsset: 'api', color: '#2563eb', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'cloud', label: '云服务', description: '云资源图标', icon: 'mdi:cloud-outline', iconAsset: 'cloud', color: '#0284c7', group: 'architecture', variant: 'icon', width: 28, height: 20, minWidth: 16, minHeight: 12 },
  { id: 'databaseIcon', label: '数据库', description: '数据库图标', icon: 'mdi:database-outline', iconAsset: 'database', color: '#0891b2', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'folderIcon', label: '文件夹', description: '文件夹图标', icon: 'mdi:folder-outline', iconAsset: 'folder', color: '#ca8a04', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'bucketIcon', label: '存储桶', description: '对象存储图标', icon: 'mdi:bucket-outline', iconAsset: 'bucket', color: '#0f766e', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'searchIcon', label: '搜索', description: '搜索图标', icon: 'mdi:magnify', iconAsset: 'search', color: '#0284c7', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'userIcon', label: '用户', description: '用户图标', icon: 'mdi:account-outline', iconAsset: 'user', color: '#9333ea', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'usersIcon', label: '用户组', description: '多用户图标', icon: 'mdi:account-group-outline', iconAsset: 'users', color: '#9333ea', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'shieldIcon', label: '安全', description: '安全图标', icon: 'mdi:shield-check-outline', iconAsset: 'shield', color: '#16a34a', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'lockIcon', label: '权限', description: '锁图标', icon: 'mdi:lock-outline', iconAsset: 'lock', color: '#16a34a', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'module', label: '模块框', description: '系统分区', icon: 'mdi:view-dashboard-outline', color: '#16a34a', group: 'architecture', variant: 'rectangle', minWidth: 92, minHeight: 56 },
  { id: 'queue', label: '队列', description: '异步通道图标', icon: 'mdi:transit-connection-variant', iconAsset: 'queue', color: '#9333ea', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'chartIcon', label: '图表', description: '指标图标', icon: 'mdi:chart-box-outline', iconAsset: 'chart', color: '#dc2626', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'uploadIcon', label: '上传', description: '上传流向图标', icon: 'mdi:upload-outline', iconAsset: 'upload', color: '#0d9488', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'downloadIcon', label: '下载', description: '下载流向图标', icon: 'mdi:download-outline', iconAsset: 'download', color: '#0284c7', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'mailIcon', label: '消息', description: '消息通知图标', icon: 'mdi:email-outline', iconAsset: 'mail', color: '#ea580c', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'terminalIcon', label: '终端', description: '命令行图标', icon: 'mdi:console', iconAsset: 'terminal', color: '#475569', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'globeIcon', label: '网络', description: '全球网络图标', icon: 'mdi:web', iconAsset: 'globe', color: '#0284c7', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'settingsIcon', label: '配置', description: '配置图标', icon: 'mdi:cog-outline', iconAsset: 'settings', color: '#64748b', group: 'architecture', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'chip', label: '算力', description: '计算模块图标', icon: 'mdi:memory', iconAsset: 'chip', color: '#0d9488', group: 'architecture', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },

  { id: 'dataset', label: '数据集', description: '论文数据源', icon: 'mdi:database-search-outline', color: '#059669', group: 'paper', variant: 'cylinder', width: 150, height: 100, minWidth: 104, minHeight: 72 },
  { id: 'model', label: '模型 / 算法', description: '方法模块', icon: 'mdi:brain', color: '#7c3aed', group: 'paper', variant: 'rounded', minWidth: 92, minHeight: 56 },
  { id: 'experiment', label: '实验流程', description: '步骤模块', icon: 'mdi:flask-outline', color: '#0284c7', group: 'paper', variant: 'rectangle', minWidth: 92, minHeight: 56 },
  { id: 'result', label: '实验结果', description: '输出结论', icon: 'mdi:chart-box-outline', color: '#dc2626', group: 'paper', variant: 'document', width: 148, height: 104, minWidth: 98, minHeight: 72 },
  { id: 'comparison', label: '对比表', description: '实验对照', icon: 'mdi:table-large', color: '#ea580c', group: 'paper', variant: 'comparison', width: 154, height: 98, minWidth: 104, minHeight: 72 },
  { id: 'annotation', label: '批注框', description: '箭头说明', icon: 'mdi:comment-text-outline', color: '#475569', group: 'paper', variant: 'annotation', width: 162, height: 98, minWidth: 112, minHeight: 72 },
  { id: 'paperIcon', label: '论文', description: '论文文档图标', icon: 'mdi:file-document-outline', iconAsset: 'paper', color: '#ea580c', group: 'paper', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'robotIcon', label: '模型', description: '智能模型图标', icon: 'mdi:robot-outline', iconAsset: 'robot', color: '#7c3aed', group: 'paper', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'notebookIcon', label: '笔记', description: '笔记图标', icon: 'mdi:notebook-outline', iconAsset: 'notebook', color: '#0f766e', group: 'paper', variant: 'icon', width: 24, height: 24, minWidth: 12, minHeight: 12 },
  { id: 'ideaIcon', label: '想法', description: '灵感图标', icon: 'mdi:lightbulb-outline', iconAsset: 'idea', color: '#f59e0b', group: 'paper', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'citationIcon', label: '引用', description: '引用图标', icon: 'mdi:format-quote-close', iconAsset: 'citation', color: '#2563eb', group: 'paper', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'labIcon', label: '实验', description: '实验图标', icon: 'mdi:flask-outline', iconAsset: 'lab', color: '#dc2626', group: 'paper', variant: 'icon', width: 22, height: 22, minWidth: 12, minHeight: 12 },
  { id: 'textLabel', label: '自由文本', description: '独立文本标签', icon: 'mdi:format-text', color: '#334155', group: 'paper', variant: 'text', width: 180, height: 52, minWidth: 88, minHeight: 36 },
]

let runtimePromise: Promise<CanvasRuntime> | null = null

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizeHex(hex: string) {
  const value = hex.replace('#', '').trim()
  if (value.length === 3) {
    return value.split('').map((char) => `${char}${char}`).join('')
  }
  if (value.length === 6) {
    return value
  }
  return '64748b'
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = normalizeHex(hex)
  const red = parseInt(normalized.slice(0, 2), 16)
  const green = parseInt(normalized.slice(2, 4), 16)
  const blue = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`
}

function getCanvasSurfaceColor(isDark: boolean) {
  return isDark ? '#0a1325' : '#f8fafc'
}

function getCanvasCardColor(isDark: boolean) {
  return isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.96)'
}

function getCanvasTextColor(isDark: boolean) {
  return isDark ? '#e2e8f0' : '#0f172a'
}

function getCanvasBorderColor(isDark: boolean) {
  return isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(148, 163, 184, 0.24)'
}

function getCanvasEdgeColor(isDark: boolean) {
  return isDark ? '#94a3b8' : '#64748b'
}

function getNodeLabelAttrs(label: string, isDark: boolean) {
  const text = label.trim()
  return {
    text,
    refX: '50%',
    refY: '50%',
    textAnchor: 'middle',
    textVerticalAnchor: 'middle',
    fontSize: 13,
    fontWeight: 600,
    fill: getCanvasTextColor(isDark),
    opacity: text ? 1 : 0,
    pointerEvents: 'none',
  }
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getIconAssetDataUri(iconAsset: string | undefined, color: string) {
  const stroke = color

  switch (iconAsset) {
    case 'server':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="10" width="36" height="16" rx="4"/><rect x="14" y="30" width="36" height="16" rx="4"/><circle cx="22" cy="18" r="1.6" fill="${stroke}" stroke="none"/><circle cx="22" cy="38" r="1.6" fill="${stroke}" stroke="none"/><path d="M28 18h14M28 38h14"/></svg>`)
    case 'client':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="14" width="40" height="24" rx="4"/><path d="M24 50h16M32 38v12"/></svg>`)
    case 'browser':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="14" width="44" height="34" rx="5"/><path d="M10 24h44"/><circle cx="18" cy="19" r="1.5" fill="${stroke}" stroke="none"/><circle cx="24" cy="19" r="1.5" fill="${stroke}" stroke="none"/><circle cx="30" cy="19" r="1.5" fill="${stroke}" stroke="none"/></svg>`)
    case 'mobile':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="22" y="8" width="20" height="48" rx="5"/><path d="M28 14h8"/><circle cx="32" cy="48" r="1.8" fill="${stroke}" stroke="none"/></svg>`)
    case 'gateway':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M32 8 48 17v18L32 44 16 35V17Z"/><path d="M25 25h14M28 20l-5 5 5 5M36 20l5 5-5 5"/></svg>`)
    case 'api':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 16h10l-8 16h10l-8 16"/><rect x="34" y="16" width="12" height="12" rx="3"/><rect x="34" y="36" width="12" height="12" rx="3"/><path d="M46 22h6M46 42h6"/></svg>`)
    case 'cloud':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 46h24a10 10 0 0 0 0-20 14 14 0 0 0-27-3 9 9 0 0 0 3 23Z"/></svg>`)
    case 'database':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="32" cy="16" rx="18" ry="8"/><path d="M14 16v20c0 4 8 8 18 8s18-4 18-8V16"/><path d="M14 26c0 4 8 8 18 8s18-4 18-8"/></svg>`)
    case 'folder':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 22h16l4 5h24v17a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z"/><path d="M10 22v-4a4 4 0 0 1 4-4h12l4 5h20a4 4 0 0 1 4 4v4"/></svg>`)
    case 'bucket':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20h28l-4 28a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4Z"/><path d="M22 20v-4a10 10 0 0 1 20 0v4"/></svg>`)
    case 'search':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="14"/><path d="m39 39 13 13"/></svg>`)
    case 'user':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="22" r="9"/><path d="M16 50c3-8 10-12 16-12s13 4 16 12"/></svg>`)
    case 'users':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="7"/><circle cx="40" cy="22" r="6"/><path d="M12 50c2-7 7-11 12-11s10 4 12 11"/><path d="M34 48c1.5-5.5 5.5-8.5 10-8.5 3.5 0 6.5 1.5 8 4.5"/></svg>`)
    case 'shield':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M32 10 48 16v12c0 11-7 18-16 24-9-6-16-13-16-24V16Z"/><path d="m24 30 6 6 10-12"/></svg>`)
    case 'lock':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="28" width="28" height="22" rx="4"/><path d="M24 28v-6a8 8 0 0 1 16 0v6"/><circle cx="32" cy="39" r="2"/><path d="M32 41v4"/></svg>`)
    case 'queue':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 20h22"/><path d="m28 14 8 6-8 6"/><path d="M28 44H50"/><path d="m36 38-8 6 8 6"/><path d="M14 32h36"/></svg>`)
    case 'chart':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 50h36"/><path d="M20 46V30"/><path d="M32 46V22"/><path d="M44 46V14"/><path d="m18 26 12-10 12-6"/></svg>`)
    case 'upload':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 42v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6"/><path d="M32 14v24"/><path d="m22 24 10-10 10 10"/></svg>`)
    case 'download':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 42v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6"/><path d="M32 14v24"/><path d="m22 28 10 10 10-10"/></svg>`)
    case 'mail':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="18" width="40" height="28" rx="4"/><path d="m16 22 16 12 16-12"/></svg>`)
    case 'terminal':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="14" width="44" height="34" rx="4"/><path d="m18 24 6 6-6 6"/><path d="M30 36h10"/></svg>`)
    case 'globe':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="20"/><path d="M12 32h40"/><path d="M32 12a30 30 0 0 1 0 40"/><path d="M32 12a30 30 0 0 0 0 40"/></svg>`)
    case 'settings':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="6"/><path d="M32 12v6M32 46v6M18 18l4 4M42 42l4 4M12 32h6M46 32h6M18 46l4-4M42 22l4-4"/></svg>`)
    case 'chip':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="18" width="28" height="28" rx="4"/><path d="M24 10v8M32 10v8M40 10v8M24 46v8M32 46v8M40 46v8M10 24h8M10 32h8M10 40h8M46 24h8M46 32h8M46 40h8"/></svg>`)
    case 'paper':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h20l8 8v36H18Z"/><path d="M38 10v8h8"/><path d="M24 30h16M24 38h16"/></svg>`)
    case 'robot':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="18" width="28" height="22" rx="6"/><path d="M32 12v6M24 46v6M40 46v6M14 28h4M46 28h4"/><circle cx="27" cy="29" r="2" fill="${stroke}" stroke="none"/><circle cx="37" cy="29" r="2" fill="${stroke}" stroke="none"/><path d="M26 36h12"/></svg>`)
    case 'notebook':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="12" width="28" height="40" rx="4"/><path d="M24 20h16M24 28h16M24 36h10"/></svg>`)
    case 'idea':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M24 38c-4-3-6-7-6-12a14 14 0 0 1 28 0c0 5-2 9-6 12"/><path d="M26 42h12M27 48h10"/></svg>`)
    case 'citation':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 24h12v12H18zM34 24h12v12H34z"/><path d="M18 36c0 6 4 10 10 10M34 36c0 6 4 10 10 10"/></svg>`)
    case 'lab':
      return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M26 12h12"/><path d="M30 12v14L18 46a4 4 0 0 0 4 6h20a4 4 0 0 0 4-6L34 26V12"/></svg>`)
    default:
      return ''
  }
}

function getPresetById(presetId: string | undefined | null) {
  return CANVAS_PRESETS.find((preset) => preset.id === presetId) ?? null
}

function getLegacyPresetId(legacyPresetId: string, legacyVariant: string) {
  if (getPresetById(legacyPresetId)) {
    return legacyPresetId
  }

  switch (legacyVariant) {
    case 'rectangle':
      return 'rect'
    case 'rounded':
      return 'rounded'
    case 'circle':
      return 'ellipse'
    case 'diamond':
      return 'diamond'
    case 'parallelogram':
      return 'parallelogram'
    case 'cylinder':
      return 'storage'
    case 'document':
      return 'document'
    case 'multiDocument':
      return 'multiDocument'
    case 'cloud':
      return 'cloud'
    case 'comparison':
      return 'comparison'
    case 'annotation':
      return 'annotation'
    default:
      return 'process'
  }
}

function getPresetVariantShape(variant: CanvasShapeVariant) {
  switch (variant) {
    case 'ellipse':
      return 'ellipse'
    case 'diamond':
    case 'parallelogram':
      return 'polygon'
    case 'document':
    case 'cylinder':
    case 'cloud':
    case 'annotation':
      return 'path'
    case 'icon':
    case 'text':
      return 'rect'
    default:
      return 'rect'
  }
}

function getPresetVariantMarkup(variant: CanvasShapeVariant) {
  switch (variant) {
    case 'comparison':
      return [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'path', selector: 'grid' },
        { tagName: 'text', selector: 'text' },
      ]
    case 'multiDocument':
      return [
        { tagName: 'rect', selector: 'back' },
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'text' },
      ]
    case 'icon':
      return [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'image', selector: 'icon' },
        { tagName: 'text', selector: 'text' },
      ]
    default:
      return undefined
  }
}

function getPresetVariantPath(variant: CanvasShapeVariant) {
  switch (variant) {
    case 'document':
      return 'M 10 8 H 98 L 132 38 V 108 H 10 Z M 98 8 V 38 H 132'
    case 'cylinder':
      return 'M 10 18 C 10 6 132 6 132 18 V 88 C 132 100 10 100 10 88 Z M 10 18 C 10 30 132 30 132 18 M 10 88 C 10 76 132 76 132 88'
    case 'cloud':
      return 'M 32 74 H 116 C 132 74 144 62 144 48 C 144 33 132 22 118 23 C 113 10 102 2 90 2 C 74 2 61 12 57 27 C 52 24 47 23 41 23 C 24 23 10 37 10 54 C 10 65 18 74 32 74 Z'
    case 'annotation':
      return 'M 18 12 H 130 C 137 12 142 17 142 24 V 72 C 142 79 137 84 130 84 H 62 L 36 104 V 84 H 18 C 11 84 6 79 6 72 V 24 C 6 17 11 12 18 12 Z'
    default:
      return undefined
  }
}

function createPortConfig(isDark: boolean) {
  const stroke = isDark ? '#cbd5e1' : '#64748b'
  const fill = isDark ? '#0f172a' : '#ffffff'

  return {
    groups: {
      top: {
        position: 'top',
        attrs: {
          circle: {
            r: 4,
            magnet: true,
            stroke,
            strokeWidth: 1.5,
            fill,
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      right: {
        position: 'right',
        attrs: {
          circle: {
            r: 4,
            magnet: true,
            stroke,
            strokeWidth: 1.5,
            fill,
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      bottom: {
        position: 'bottom',
        attrs: {
          circle: {
            r: 4,
            magnet: true,
            stroke,
            strokeWidth: 1.5,
            fill,
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      left: {
        position: 'left',
        attrs: {
          circle: {
            r: 4,
            magnet: true,
            stroke,
            strokeWidth: 1.5,
            fill,
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
    },
    items: [
      { id: 'top', group: 'top' },
      { id: 'right', group: 'right' },
      { id: 'bottom', group: 'bottom' },
      { id: 'left', group: 'left' },
    ],
  }
}

function getVariantAttrs(
  variant: CanvasShapeVariant,
  color: string,
  isDark: boolean,
  label: string,
  iconAsset?: string,
) {
  const stroke = hexToRgba(color, isDark ? 0.94 : 0.88)
  const fill = hexToRgba(color, isDark ? 0.18 : 0.08)
  const subtleFill = hexToRgba(color, isDark ? 0.12 : 0.05)
  const commonBody = {
    fill,
    stroke,
    strokeWidth: 2,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  }

  switch (variant) {
    case 'rounded':
      return {
        body: {
          ...commonBody,
          rx: 18,
          ry: 18,
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'ellipse':
      return {
        body: commonBody,
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'diamond':
      return {
        body: {
          ...commonBody,
          refPoints: '50,0 100,50 50,100 0,50',
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'parallelogram':
      return {
        body: {
          ...commonBody,
          refPoints: '16,0 100,0 84,100 0,100',
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'document':
    case 'cylinder':
    case 'cloud':
      return {
        body: commonBody,
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'comparison':
      return {
        body: {
          ...commonBody,
          width: '100%',
          height: '100%',
          rx: 18,
          ry: 18,
        },
        grid: {
          refD: 'M 33 0 V 100 M 66 0 V 100 M 0 40 H 100 M 0 72 H 100',
          fill: 'none',
          stroke,
          strokeWidth: 1.5,
          opacity: 0.58,
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'multiDocument':
      return {
        back: {
          x: '0%',
          y: '0%',
          width: '84%',
          height: '84%',
          rx: 16,
          ry: 16,
          fill: subtleFill,
          stroke,
          strokeWidth: 1.6,
          opacity: 0.92,
        },
        body: {
          x: '14%',
          y: '14%',
          width: '84%',
          height: '84%',
          rx: 16,
          ry: 16,
          fill,
          stroke,
          strokeWidth: 2,
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    case 'icon':
      return {
        body: {
          fill: 'transparent',
          stroke: 'transparent',
          width: '100%',
          height: '100%',
        },
        icon: {
          'xlink:href': getIconAssetDataUri(iconAsset, color),
          x: 4,
          y: 4,
          width: 16,
          height: 16,
          refWidth: 'calc(w-8)',
          refHeight: 'calc(h-8)',
          preserveAspectRatio: 'xMidYMid meet',
        },
        text: {
          ...getNodeLabelAttrs(label, isDark),
          opacity: label.trim() ? 1 : 0.4,
          text: label.trim() || '双击编辑',
          fontSize: 9,
          fontWeight: 600,
          refY: '100%',
          y: -2,
        },
      }
    case 'text':
      return {
        body: {
          fill: 'transparent',
          stroke: 'transparent',
          width: '100%',
          height: '100%',
        },
        text: {
          ...getNodeLabelAttrs(label, isDark),
          opacity: label.trim() ? 1 : 0.35,
          text: label.trim() || '双击编辑文字',
          fontSize: 16,
          fontWeight: 700,
          fill: label.trim() ? getCanvasTextColor(isDark) : hexToRgba('#64748b', isDark ? 0.72 : 0.64),
        },
      }
    case 'annotation':
      return {
        body: {
          ...commonBody,
          strokeDasharray: '6 5',
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    default:
      return {
        body: {
          ...commonBody,
          rx: 12,
          ry: 12,
        },
        text: getNodeLabelAttrs(label, isDark),
      }
    }
}

function buildNodeMetadata(
  preset: CanvasPaletteItem,
  isDark: boolean,
  overrides: Partial<{
    id: string
    x: number
    y: number
    width: number
    height: number
    label: string
    zIndex: number
    angle: number
  }> = {},
) {
  const label = String(overrides.label ?? '')
  const width = Number(overrides.width ?? preset.width ?? 148)
  const height = Number(overrides.height ?? preset.height ?? 88)
  const markup = getPresetVariantMarkup(preset.variant)
  const path = getPresetVariantPath(preset.variant)
  const ports = preset.variant === 'text' ? { groups: {}, items: [] } : createPortConfig(isDark)
  const metadata: Record<string, unknown> = {
    shape: getPresetVariantShape(preset.variant),
    width,
    height,
    ports,
    attrs: getVariantAttrs(preset.variant, preset.color, isDark, label, preset.iconAsset),
    data: {
      presetId: preset.id,
      label,
      color: preset.color,
      iconAsset: preset.iconAsset ?? '',
      variant: preset.variant,
      minWidth: preset.minWidth ?? 72,
      minHeight: preset.minHeight ?? 56,
      keepAspect: Boolean(preset.keepAspect),
    },
  }

  if (typeof overrides.id === 'string') {
    metadata.id = overrides.id
  }
  if (typeof overrides.x === 'number') {
    metadata.x = overrides.x
  }
  if (typeof overrides.y === 'number') {
    metadata.y = overrides.y
  }
  if (typeof overrides.zIndex === 'number') {
    metadata.zIndex = overrides.zIndex
  }
  if (typeof overrides.angle === 'number') {
    metadata.angle = overrides.angle
  }
  if (markup) {
    metadata.markup = markup
  }
  if (path) {
    metadata.path = path
  }

  return metadata
}

function normalizeCanvasGraphData(graphData: any, isDark: boolean) {
  if (!graphData || !Array.isArray(graphData.cells)) {
    return graphData
  }

  return {
    ...graphData,
    cells: graphData.cells.map((cell: any) => {
      if (!cell || cell.shape !== LEGACY_NODE_SHAPE) {
        return cell
      }

      const presetId = getLegacyPresetId(String(cell.data?.presetId ?? ''), String(cell.data?.variant ?? ''))
      const preset = getPresetById(presetId) ?? CANVAS_PRESETS[0]

      return {
        ...buildNodeMetadata(preset, isDark, {
          id: cell.id,
          x: Number(cell.x ?? 0),
          y: Number(cell.y ?? 0),
          width: Number(cell.width ?? preset.width ?? 148),
          height: Number(cell.height ?? preset.height ?? 88),
          label: String(cell.data?.label ?? ''),
          zIndex: typeof cell.zIndex === 'number' ? cell.zIndex : undefined,
          angle: typeof cell.angle === 'number' ? cell.angle : undefined,
        }),
      }
    }),
  }
}

function buildEdgeLabel(text: string, isDark: boolean) {
  return {
    position: {
      distance: 0.5,
    },
    attrs: {
      body: {
        fill: getCanvasCardColor(isDark),
        stroke: getCanvasBorderColor(isDark),
        strokeWidth: 1,
        rx: 10,
        ry: 10,
      },
      label: {
        text,
        fill: getCanvasTextColor(isDark),
        fontSize: 12,
        fontWeight: 600,
      },
    },
  }
}

function hideAllPorts(graph: any) {
  if (!(graph?.container instanceof HTMLElement)) return
  const container = graph.container as HTMLElement
  container.querySelectorAll('.x6-port-body').forEach((element) => {
    ;(element as HTMLElement).style.visibility = 'hidden'
  })
}

function showPortsForCell(graph: any, cellId: string | undefined | null, visible: boolean) {
  if (!(graph?.container instanceof HTMLElement) || !cellId) return
  const container = graph.container as HTMLElement
  const target = container.querySelector(`[data-cell-id="${cellId}"]`) as HTMLElement | null
  target?.querySelectorAll('.x6-port-body').forEach((element) => {
    ;(element as HTMLElement).style.visibility = visible ? 'visible' : 'hidden'
  })
}

function bindPortVisibility(graph: any) {
  graph.on('node:mouseenter', ({ node }: any) => {
    showPortsForCell(graph, node?.id, true)
  })

  graph.on('node:mouseleave', ({ node }: any) => {
    showPortsForCell(graph, node?.id, false)
  })

  graph.on('blank:click', () => {
    hideAllPorts(graph)
  })
}

function bindCanvasShortcuts(session: Omit<CanvasGraphSession, 'dispose'>) {
  const getSelectedCells = () => {
    if (typeof session.selection?.getSelectedCells === 'function') {
      return session.selection.getSelectedCells()
    }
    return []
  }

  session.keyboard.bindKey(['meta+c', 'ctrl+c'], () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      session.clipboard.copy(cells)
    }
    return false
  })

  session.keyboard.bindKey(['meta+x', 'ctrl+x'], () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      session.clipboard.cut(cells)
      session.selection.clean?.()
    }
    return false
  })

  session.keyboard.bindKey(['meta+v', 'ctrl+v'], () => {
    const cells = session.clipboard.paste({ offset: 28 }, session.graph)
    if (Array.isArray(cells) && cells.length > 0) {
      session.selection.reset?.(cells)
    }
    return false
  })

  session.keyboard.bindKey(['meta+z', 'ctrl+z'], () => {
    if (session.history.canUndo?.()) {
      session.history.undo?.()
    }
    return false
  })

  session.keyboard.bindKey(['meta+shift+z', 'ctrl+shift+z', 'meta+y', 'ctrl+y'], () => {
    if (session.history.canRedo?.()) {
      session.history.redo?.()
    }
    return false
  })

  session.keyboard.bindKey(['meta+a', 'ctrl+a'], () => {
    const nodes = session.graph.getNodes?.() ?? []
    if (nodes.length > 0) {
      session.selection.reset?.(nodes)
    }
    return false
  })

  session.keyboard.bindKey(['backspace', 'delete'], () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      session.graph.removeCells?.(cells)
      session.selection.clean?.()
    }
    return false
  })

  session.keyboard.bindKey(['meta+1', 'ctrl+1'], () => {
    session.graph.zoom?.(0.1)
    return false
  })

  session.keyboard.bindKey(['meta+2', 'ctrl+2'], () => {
    session.graph.zoom?.(-0.1)
    return false
  })
}

function getOppositePort(portId: string | null | undefined) {
  switch (portId) {
    case 'top':
      return 'bottom'
    case 'right':
      return 'left'
    case 'bottom':
      return 'top'
    case 'left':
      return 'right'
    default:
      return 'left'
  }
}

function bindAutoCreateNode(graph: any, isDark: boolean) {
  graph.on('edge:connected', ({ edge, currentPoint }: any) => {
    const sourceCellId = edge?.getSourceCellId?.()
    const targetCellId = edge?.getTargetCellId?.()

    if (sourceCellId && targetCellId) return
    if (!currentPoint) return

    const anchorCellId = sourceCellId || targetCellId
    if (!anchorCellId) return

    const anchorCell = graph.getCellById?.(anchorCellId)
    if (!anchorCell || anchorCell.isEdge?.()) return

    const anchorData = anchorCell.getData?.() ?? {}
    const preset =
      getPresetById(String(anchorData.presetId ?? '')) ??
      getPresetById(getLegacyPresetId('', String(anchorData.variant ?? ''))) ??
      CANVAS_PRESETS[0]
    const size = anchorCell.getSize?.() ?? { width: preset.width ?? 148, height: preset.height ?? 88 }
    const nextNode = graph.addNode(
      buildNodeMetadata(preset, isDark, {
        x: Number(currentPoint.x) - Number(size.width ?? 148) / 2,
        y: Number(currentPoint.y) - Number(size.height ?? 88) / 2,
        width: Number(size.width ?? preset.width ?? 148),
        height: Number(size.height ?? preset.height ?? 88),
      }),
    )

    if (!targetCellId) {
      edge.setTarget({
        cell: nextNode.id,
        port: getOppositePort(edge?.getSourcePortId?.()),
      })
    } else {
      edge.setSource({
        cell: nextNode.id,
        port: getOppositePort(edge?.getTargetPortId?.()),
      })
    }

    graph.cleanSelection?.()
    graph.select?.([nextNode, edge])
  })
}

export function getCanvasPresetGroups(): CanvasPaletteGroup[] {
  return PALETTE_GROUP_META.map((groupMeta) => ({
    id: groupMeta.id,
    title: groupMeta.title,
    items: CANVAS_PRESETS.filter((preset) => preset.group === groupMeta.id),
  }))
}

export function getCanvasNodeLabel(node: any) {
  return String(node?.getData?.()?.label ?? '')
}

export function getCanvasEdgeLabel(edge: any) {
  const label = edge?.getLabels?.()?.[0]
  return String(label?.attrs?.label?.text ?? '')
}

export function applyCanvasNodeTheme(node: any, isDark: boolean) {
  const data = node?.getData?.() ?? {}
  const preset = getPresetById(String(data.presetId ?? ''))
  if (!preset) return

  const nextData = {
    ...data,
    color: String(data.color ?? preset.color),
    iconAsset: String(data.iconAsset ?? preset.iconAsset ?? ''),
    label: String(data.label ?? ''),
  }

  node.setData?.(nextData)
  node.setPorts?.(preset.variant === 'text' ? { groups: {}, items: [] } : createPortConfig(isDark))
  node.attr?.(getVariantAttrs(preset.variant, String(nextData.color), isDark, String(nextData.label), String(nextData.iconAsset)))
}

export function setCanvasNodeLabel(node: any, label: string, isDark: boolean) {
  const current = node?.getData?.() ?? {}
  node?.setData?.({
    ...current,
    label,
  })
  applyCanvasNodeTheme(node, isDark)
}

export function setCanvasEdgeLabel(edge: any, label: string, isDark: boolean) {
  const text = label.trim()
  if (!text) {
    edge?.setLabels?.([])
    return
  }

  edge?.setLabels?.([buildEdgeLabel(text, isDark)])
}

export function setCanvasGraphTheme(graph: any, isDark: boolean) {
  if (graph?.container instanceof HTMLElement) {
    graph.container.style.background = getCanvasSurfaceColor(isDark)
  }

  const nodes = graph?.getNodes?.() ?? []
  nodes.forEach((node: any) => applyCanvasNodeTheme(node, isDark))

  const edges = graph?.getEdges?.() ?? []
  edges.forEach((edge: any) => {
    edge.attr?.({
      line: {
        stroke: getCanvasEdgeColor(isDark),
        strokeWidth: 2,
        targetMarker: {
          name: 'block',
          width: 12,
          height: 8,
        },
      },
    })

    const label = getCanvasEdgeLabel(edge)
    if (label) {
      setCanvasEdgeLabel(edge, label, isDark)
    }
  })

  hideAllPorts(graph)
}

export async function loadCanvasX6Runtime(): Promise<CanvasRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('@antv/x6'),
      import('@antv/x6-plugin-snapline'),
      import('@antv/x6-plugin-selection'),
      import('@antv/x6-plugin-clipboard'),
      import('@antv/x6-plugin-keyboard'),
      import('@antv/x6-plugin-history'),
    ]).then(([x6, snapline, selection, clipboard, keyboard, history]) => ({
      Graph: x6.Graph,
      Shape: x6.Shape,
      Snapline: snapline.Snapline,
      Selection: selection.Selection,
      Clipboard: clipboard.Clipboard,
      Keyboard: keyboard.Keyboard,
      History: history.History,
    }))
  }

  return runtimePromise
}

export function insertCanvasPresetNode(options: {
  graph: any
  presetId: string
  point: { x: number; y: number }
  isDark: boolean
}) {
  const preset = getPresetById(options.presetId)
  if (!preset) return null

  const width = preset.width ?? 148
  const height = preset.height ?? 88
  return options.graph.addNode(
    buildNodeMetadata(preset, options.isDark, {
      x: Number(options.point.x) - width / 2,
      y: Number(options.point.y) - height / 2,
      width,
      height,
    }),
  )
}

export async function createCanvasGraphSession(options: {
  container: HTMLElement
  graphData?: string
  isDark: boolean
  width?: number
  height?: number
}): Promise<CanvasGraphSession> {
  const runtime = await loadCanvasX6Runtime()

  const graph = new runtime.Graph({
    container: options.container,
    width: Math.max(options.container.clientWidth || options.width || DEFAULT_CANVAS_WIDTH, 320),
    height: Math.max(options.container.clientHeight || options.height || DEFAULT_CANVAS_HEIGHT, 240),
    background: {
      color: getCanvasSurfaceColor(options.isDark),
    },
    grid: {
      size: 12,
      visible: true,
      type: 'mesh',
      args: {
        color: options.isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.14)',
        thickness: 1,
      },
    },
    panning: {
      enabled: true,
      eventTypes: ['rightMouseDown', 'mouseWheelDown'],
    },
    mousewheel: {
      enabled: true,
      modifiers: ['ctrl', 'meta'],
      zoomAtMousePosition: true,
      minScale: 0.4,
      maxScale: 2.5,
      factor: 1.08,
    },
    interacting: {
      edgeMovable: true,
      edgeLabelMovable: true,
      vertexMovable: true,
      vertexAddable: true,
      vertexDeletable: true,
    },
    connecting: {
      allowBlank: true,
      allowLoop: false,
      allowMulti: 'withPort',
      snap: {
        radius: 20,
      },
      anchor: 'center',
      connectionPoint: 'anchor',
      router: {
        name: 'manhattan',
      },
      connector: {
        name: 'rounded',
        args: {
          radius: 10,
        },
      },
      createEdge() {
        return new runtime.Shape.Edge({
          attrs: {
            line: {
              stroke: getCanvasEdgeColor(options.isDark),
              strokeWidth: 2,
              targetMarker: {
                name: 'block',
                width: 12,
                height: 8,
              },
            },
          },
          zIndex: 0,
        })
      },
      validateConnection({ targetMagnet, targetCellView }: any) {
        if (!targetCellView) return true
        return Boolean(targetMagnet)
      },
    },
    highlighting: {
      magnetAdsorbed: {
        name: 'stroke',
        args: {
          attrs: {
            fill: '#60a5fa',
            stroke: '#60a5fa',
          },
        },
      },
    },
  })

  const history = new runtime.History({ enabled: true })
  const snapline = new runtime.Snapline({ enabled: true, sharp: true })
  const selection = new runtime.Selection({
    enabled: true,
    rubberband: true,
    showNodeSelectionBox: true,
    showEdgeSelectionBox: false,
    multiple: true,
    movable: true,
  })
  const clipboard = new runtime.Clipboard({ enabled: true, useLocalStorage: false })
  const keyboard = new runtime.Keyboard({ enabled: true, global: false })

  graph.use(history)
  graph.use(snapline)
  graph.use(selection)
  graph.use(clipboard)
  graph.use(keyboard)

  const sessionBase = { graph, history, clipboard, keyboard, selection }
  bindCanvasShortcuts(sessionBase)
  bindAutoCreateNode(graph, options.isDark)
  bindPortVisibility(graph)

  if (options.graphData) {
    try {
      const parsed = normalizeCanvasGraphData(JSON.parse(options.graphData), options.isDark)
      graph.fromJSON(parsed)
    } catch (error) {
      console.warn('Failed to restore canvas graph data.', error)
    }
  }

  setCanvasGraphTheme(graph, options.isDark)

  requestAnimationFrame(() => {
    if ((graph.getCells?.() ?? []).length > 0) {
      graph.centerContent?.({ padding: 48 })
    }
  })

  return {
    ...sessionBase,
    dispose: () => {
      graph.dispose?.()
    },
  }
}

export function getViewportRect(): CanvasOriginRect {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0, width: 800, height: 600 }
  }

  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

export async function waitForNextPaint() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function cloneGraphSvg(graph: any, backgroundColor: string, viewBox: { x: number; y: number; width: number; height: number }) {
  const sourceSvg = graph?.view?.svg as SVGSVGElement | undefined
  if (!sourceSvg) {
    throw new Error('未找到可导出的画布 SVG')
  }

  const clone = sourceSvg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`)
  clone.setAttribute('width', String(viewBox.width))
  clone.setAttribute('height', String(viewBox.height))

  clone.querySelectorAll('.x6-port-body').forEach((element) => {
    ;(element as SVGElement).style.visibility = 'hidden'
  })

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('x', String(viewBox.x))
  background.setAttribute('y', String(viewBox.y))
  background.setAttribute('width', String(viewBox.width))
  background.setAttribute('height', String(viewBox.height))
  background.setAttribute('fill', backgroundColor)
  clone.insertBefore(background, clone.firstChild)

  return clone
}

async function renderSvgDataUrlToRaster(options: {
  svgMarkup: string
  width: number
  height: number
  format: 'png' | 'jpeg'
  backgroundColor: string
  quality?: number
}) {
  return await new Promise<string>((resolve, reject) => {
    const blob = new Blob([options.svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = options.width
        canvas.height = options.height
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('无法创建导出画布')
        }

        context.fillStyle = options.backgroundColor
        context.fillRect(0, 0, options.width, options.height)
        context.drawImage(image, 0, 0, options.width, options.height)

        resolve(
          canvas.toDataURL(
            options.format === 'png' ? 'image/png' : 'image/jpeg',
            options.quality ?? 0.82,
          ),
        )
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 转图片失败'))
    }

    image.src = url
  })
}

export async function exportGraphDataUrl(options: {
  graph: any
  format: 'png' | 'jpeg'
  isDark: boolean
  maxWidth?: number
  maxHeight?: number
  quality?: number
}) {
  await waitForNextPaint()
  await waitForNextPaint()

  const bbox = options.graph.getContentBBox?.()
  const padding = 36
  const contentWidth = Math.max(Number(bbox?.width ?? 0) + padding * 2, 320)
  const contentHeight = Math.max(Number(bbox?.height ?? 0) + padding * 2, 240)
  const maxWidth = options.maxWidth ?? DEFAULT_PREVIEW_MAX_WIDTH
  const maxHeight = options.maxHeight ?? DEFAULT_PREVIEW_MAX_HEIGHT
  const ratio = Math.min(maxWidth / contentWidth, maxHeight / contentHeight, 1)
  const width = Math.max(Math.round(contentWidth * ratio), 320)
  const height = Math.max(Math.round(contentHeight * ratio), 240)
  const viewBox = {
    x: Number(bbox?.x ?? 0) - padding,
    y: Number(bbox?.y ?? 0) - padding,
    width: contentWidth,
    height: contentHeight,
  }
  const backgroundColor = getCanvasSurfaceColor(options.isDark)
  const svg = cloneGraphSvg(options.graph, backgroundColor, viewBox)
  const svgMarkup = new XMLSerializer().serializeToString(svg)

  return await renderSvgDataUrlToRaster({
    svgMarkup,
    width,
    height,
    format: options.format,
    backgroundColor,
    quality: options.quality ?? 0.72,
  })
}

export async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl)
  return await response.blob()
}

export function getCanvasBlockDefaults(): CanvasBlockProps {
  return {
    graphData: '',
    previewDataUrl: '',
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
  }
}
