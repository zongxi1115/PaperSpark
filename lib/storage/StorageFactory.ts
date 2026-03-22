/**
 * 存储工厂
 * 负责创建和管理存储提供者实例
 */

import type { StorageProvider, EventfulStorageProvider, StorageConfig } from './StorageProvider'
import { defaultStorageConfig } from './StorageProvider'
import { LocalStorageAdapter } from './LocalStorageAdapter'

/**
 * 内存存储适配器（用于测试或 SSR 环境）
 */
class MemoryStorageAdapter implements EventfulStorageProvider {
  private storage: Map<string, string> = new Map()
  private listeners: Set<(key: string, newValue: string | null, oldValue: string | null) => void> = new Set()

  getItem(key: string): string | null {
    return this.storage.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    const oldValue = this.storage.get(key) ?? null
    this.storage.set(key, value)
    this.notifyListeners(key, value, oldValue)
  }

  removeItem(key: string): void {
    const oldValue = this.storage.get(key) ?? null
    this.storage.delete(key)
    this.notifyListeners(key, null, oldValue)
  }

  clear(): void {
    this.storage.clear()
  }

  getAllKeys(): string[] {
    return Array.from(this.storage.keys())
  }

  hasKey(key: string): boolean {
    return this.storage.has(key)
  }

  getLength(): number {
    return this.storage.size
  }

  getMultiple(keys: string[]): Record<string, string | null> {
    const result: Record<string, string | null> = {}
    keys.forEach(key => {
      result[key] = this.getItem(key)
    })
    return result
  }

  setMultiple(items: Record<string, string>): void {
    Object.entries(items).forEach(([key, value]) => {
      this.setItem(key, value)
    })
  }

  removeMultiple(keys: string[]): void {
    keys.forEach(key => {
      this.removeItem(key)
    })
  }

  addListener(listener: (key: string, newValue: string | null, oldValue: string | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  removeListener(listener: (key: string, newValue: string | null, oldValue: string | null) => void): void {
    this.listeners.delete(listener)
  }

  private notifyListeners(key: string, newValue: string | null, oldValue: string | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(key, newValue, oldValue)
      } catch (error) {
        console.error('Memory storage listener error:', error)
      }
    })
  }
}

/**
 * 存储工厂类
 */
export class StorageFactory {
  private static instance: StorageFactory
  private providers: Map<string, StorageProvider> = new Map()
  private defaultProvider: StorageProvider | null = null

  private constructor() {}

  /**
   * 获取工厂单例
   */
  static getInstance(): StorageFactory {
    if (!StorageFactory.instance) {
      StorageFactory.instance = new StorageFactory()
    }
    return StorageFactory.instance
  }

  /**
   * 创建存储提供者
   */
  createProvider(config: StorageConfig = defaultStorageConfig): StorageProvider {
    const { type, prefix = 'paper_reader_', provider } = config

    switch (type) {
      case 'localStorage':
        return new LocalStorageAdapter(prefix)

      case 'memory':
        return new MemoryStorageAdapter()

      case 'custom':
        if (!provider) {
          throw new Error('Custom storage provider is required when type is "custom"')
        }
        return provider

      case 'sessionStorage':
        // TODO: 实现 sessionStorage 适配器
        throw new Error('SessionStorage adapter not implemented yet')

      case 'indexedDB':
        // TODO: 实现 IndexedDB 适配器
        throw new Error('IndexedDB adapter not implemented yet')

      default:
        throw new Error(`Unknown storage type: ${type}`)
    }
  }

  /**
   * 获取或创建命名存储提供者
   */
  getProvider(name: string, config?: StorageConfig): StorageProvider {
    if (!this.providers.has(name)) {
      const provider = this.createProvider(config)
      this.providers.set(name, provider)
    }
    return this.providers.get(name)!
  }

  /**
   * 获取默认存储提供者
   */
  getDefaultProvider(): StorageProvider {
    if (!this.defaultProvider) {
      this.defaultProvider = this.createProvider()
    }
    return this.defaultProvider
  }

  /**
   * 设置默认存储提供者
   */
  setDefaultProvider(provider: StorageProvider): void {
    this.defaultProvider = provider
  }

  /**
   * 销毁所有存储提供者
   */
  destroyAll(): void {
    this.providers.forEach(provider => {
      if ('destroy' in provider && typeof provider.destroy === 'function') {
        provider.destroy()
      }
    })
    this.providers.clear()
    this.defaultProvider = null
  }

  /**
   * 销毁指定的存储提供者
   */
  destroyProvider(name: string): void {
    const provider = this.providers.get(name)
    if (provider) {
      if ('destroy' in provider && typeof provider.destroy === 'function') {
        provider.destroy()
      }
      this.providers.delete(name)
    }
  }
}

/**
 * 获取默认存储提供者（便捷函数）
 */
export function getStorage(): StorageProvider {
  return StorageFactory.getInstance().getDefaultProvider()
}

/**
 * 创建带前缀的存储提供者（便捷函数）
 */
export function createPrefixedStorage(prefix: string): StorageProvider {
  return StorageFactory.getInstance().getProvider(prefix, { type: 'localStorage', prefix })
}