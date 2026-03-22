/**
 * LocalStorage 存储适配器
 * 实现 StorageProvider 接口，提供 localStorage 的封装
 */

import type { EventfulStorageProvider, StorageEventListener } from './StorageProvider'

export class LocalStorageAdapter implements EventfulStorageProvider {
  private prefix: string
  private listeners: Set<StorageEventListener> = new Set()
  private boundStorageHandler: ((event: StorageEvent) => void) | null = null

  constructor(prefix: string = 'paper_reader_') {
    this.prefix = prefix
    this.setupStorageListener()
  }

  /**
   * 获取带前缀的完整键名
   */
  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }

  /**
   * 从完整键名中提取原始键名
   */
  private getOriginalKey(fullKey: string): string {
    if (fullKey.startsWith(this.prefix)) {
      return fullKey.slice(this.prefix.length)
    }
    return fullKey
  }

  /**
   * 设置 storage 事件监听
   */
  private setupStorageListener(): void {
    if (typeof window === 'undefined') return

    this.boundStorageHandler = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith(this.prefix)) return

      const originalKey = this.getOriginalKey(event.key)
      this.notifyListeners(originalKey, event.newValue, event.oldValue)
    }

    window.addEventListener('storage', this.boundStorageHandler)
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(key: string, newValue: string | null, oldValue: string | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(key, newValue, oldValue)
      } catch (error) {
        console.error('Storage listener error:', error)
      }
    })
  }

  /**
   * 检查是否在浏览器环境
   */
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
  }

  getItem(key: string): string | null {
    if (!this.isBrowser()) return null
    try {
      return localStorage.getItem(this.getFullKey(key))
    } catch (error) {
      console.error('LocalStorage getItem error:', error)
      return null
    }
  }

  setItem(key: string, value: string): void {
    if (!this.isBrowser()) return
    try {
      const fullKey = this.getFullKey(key)
      const oldValue = localStorage.getItem(fullKey)
      localStorage.setItem(fullKey, value)
      this.notifyListeners(key, value, oldValue)
    } catch (error) {
      console.error('LocalStorage setItem error:', error)
    }
  }

  removeItem(key: string): void {
    if (!this.isBrowser()) return
    try {
      const fullKey = this.getFullKey(key)
      const oldValue = localStorage.getItem(fullKey)
      localStorage.removeItem(fullKey)
      this.notifyListeners(key, null, oldValue)
    } catch (error) {
      console.error('LocalStorage removeItem error:', error)
    }
  }

  clear(): void {
    if (!this.isBrowser()) return
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(this.prefix)) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
    } catch (error) {
      console.error('LocalStorage clear error:', error)
    }
  }

  getAllKeys(): string[] {
    if (!this.isBrowser()) return []
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(this.prefix)) {
          keys.push(this.getOriginalKey(key))
        }
      }
      return keys
    } catch (error) {
      console.error('LocalStorage getAllKeys error:', error)
      return []
    }
  }

  hasKey(key: string): boolean {
    if (!this.isBrowser()) return false
    try {
      return localStorage.getItem(this.getFullKey(key)) !== null
    } catch (error) {
      console.error('LocalStorage hasKey error:', error)
      return false
    }
  }

  getLength(): number {
    return this.getAllKeys().length
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

  addListener(listener: StorageEventListener): () => void {
    this.listeners.add(listener)
    return () => this.removeListener(listener)
  }

  removeListener(listener: StorageEventListener): void {
    this.listeners.delete(listener)
  }

  /**
   * 销毁适配器，清理事件监听
   */
  destroy(): void {
    if (this.boundStorageHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.boundStorageHandler)
      this.boundStorageHandler = null
    }
    this.listeners.clear()
  }
}