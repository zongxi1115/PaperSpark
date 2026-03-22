/**
 * 存储提供者抽象接口
 * 定义了存储层的基本操作，支持不同的存储后端实现
 */

export interface StorageProvider {
  /**
   * 获取存储的值
   * @param key 存储键
   * @returns 存储的值，如果不存在返回 null
   */
  getItem(key: string): string | null

  /**
   * 设置存储值
   * @param key 存储键
   * @param value 存储值
   */
  setItem(key: string, value: string): void

  /**
   * 删除存储项
   * @param key 存储键
   */
  removeItem(key: string): void

  /**
   * 清空所有存储
   */
  clear(): void

  /**
   * 获取所有存储键
   * @returns 存储键数组
   */
  getAllKeys(): string[]

  /**
   * 检查键是否存在
   * @param key 存储键
   * @returns 是否存在
   */
  hasKey(key: string): boolean

  /**
   * 获取存储项数量
   * @returns 存储项数量
   */
  getLength(): number

  /**
   * 批量获取存储值
   * @param keys 存储键数组
   * @returns 键值对对象
   */
  getMultiple(keys: string[]): Record<string, string | null>

  /**
   * 批量设置存储值
   * @param items 键值对对象
   */
  setMultiple(items: Record<string, string>): void

  /**
   * 批量删除存储项
   * @param keys 存储键数组
   */
  removeMultiple(keys: string[]): void
}

/**
 * 存储事件监听器类型
 */
export type StorageEventListener = (key: string, newValue: string | null, oldValue: string | null) => void

/**
 * 带事件支持的存储提供者接口
 */
export interface EventfulStorageProvider extends StorageProvider {
  /**
   * 添加存储变化监听器
   * @param listener 监听器函数
   * @returns 取消监听的函数
   */
  addListener(listener: StorageEventListener): () => void

  /**
   * 移除存储变化监听器
   * @param listener 监听器函数
   */
  removeListener(listener: StorageEventListener): void
}

/**
 * 存储配置类型
 */
export interface StorageConfig {
  /**
   * 存储类型
   */
  type: 'localStorage' | 'sessionStorage' | 'indexedDB' | 'memory' | 'custom'

  /**
   * 自定义存储提供者（当 type 为 'custom' 时使用）
   */
  provider?: StorageProvider

  /**
   * 存储前缀（用于隔离不同应用或环境）
   */
  prefix?: string

  /**
   * 是否启用压缩（对于大量数据）
   */
  enableCompression?: boolean

  /**
   * 是否启用加密（对于敏感数据）
   */
  enableEncryption?: boolean

  /**
   * 加密密钥（当 enableEncryption 为 true 时需要）
   */
  encryptionKey?: string
}

/**
 * 默认存储配置
 */
export const defaultStorageConfig: StorageConfig = {
  type: 'localStorage',
  prefix: 'paper_reader_',
  enableCompression: false,
  enableEncryption: false,
}