/**
 * 存储工具函数
 * 提供类型安全的存储操作封装
 */

import type { StorageProvider } from './StorageProvider'
import { getStorage } from './StorageFactory'

/**
 * 获取 JSON 对象
 */
export function getJSON<T>(key: string, defaultValue: T): T {
  const storage = getStorage()
  try {
    const raw = storage.getItem(key)
    if (!raw) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

/**
 * 设置 JSON 对象
 */
export function setJSON<T>(key: string, value: T): void {
  const storage = getStorage()
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error('Failed to save JSON to storage:', error)
  }
}

/**
 * 获取字符串值
 */
export function getString(key: string, defaultValue: string = ''): string {
  const storage = getStorage()
  return storage.getItem(key) ?? defaultValue
}

/**
 * 设置字符串值
 */
export function setString(key: string, value: string): void {
  const storage = getStorage()
  storage.setItem(key, value)
}

/**
 * 获取数字值
 */
export function getNumber(key: string, defaultValue: number = 0): number {
  const storage = getStorage()
  const raw = storage.getItem(key)
  if (!raw) return defaultValue
  const num = Number(raw)
  return isNaN(num) ? defaultValue : num
}

/**
 * 设置数字值
 */
export function setNumber(key: string, value: number): void {
  const storage = getStorage()
  storage.setItem(key, String(value))
}

/**
 * 获取布尔值
 */
export function getBoolean(key: string, defaultValue: boolean = false): boolean {
  const storage = getStorage()
  const raw = storage.getItem(key)
  if (!raw) return defaultValue
  return raw === 'true'
}

/**
 * 设置布尔值
 */
export function setBoolean(key: string, value: boolean): void {
  const storage = getStorage()
  storage.setItem(key, String(value))
}

/**
 * 删除存储项
 */
export function removeItem(key: string): void {
  const storage = getStorage()
  storage.removeItem(key)
}

/**
 * 检查键是否存在
 */
export function hasItem(key: string): boolean {
  const storage = getStorage()
  return storage.hasKey(key)
}

/**
 * 清空所有存储
 */
export function clearAll(): void {
  const storage = getStorage()
  storage.clear()
}

/**
 * 获取数组（如果不存在则返回默认值）
 */
export function getArray<T>(key: string, defaultValue: T[] = []): T[] {
  return getJSON<T[]>(key, defaultValue)
}

/**
 * 设置数组
 */
export function setArray<T>(key: string, value: T[]): void {
  setJSON(key, value)
}

/**
 * 向数组中添加项（如果不存在）
 */
export function addToArray<T>(key: string, item: T, compareFn?: (a: T, b: T) => boolean): void {
  const array = getArray<T>(key)
  const exists = compareFn
    ? array.some(existing => compareFn(existing, item))
    : array.includes(item)

  if (!exists) {
    array.push(item)
    setArray(key, array)
  }
}

/**
 * 从数组中移除项
 */
export function removeFromArray<T>(key: string, item: T, compareFn?: (a: T, b: T) => boolean): void {
  const array = getArray<T>(key)
  const filtered = compareFn
    ? array.filter(existing => !compareFn(existing, item))
    : array.filter(existing => existing !== item)

  setArray(key, filtered)
}

/**
 * 更新数组中的项
 */
export function updateInArray<T extends { id: string }>(
  key: string,
  item: T,
  merge: boolean = true
): void {
  const array = getArray<T>(key)
  const index = array.findIndex(existing => existing.id === item.id)

  if (index >= 0) {
    array[index] = merge ? { ...array[index], ...item } : item
  } else {
    array.unshift(item)
  }

  setArray(key, array)
}

/**
 * 从数组中删除项（通过 ID）
 */
export function deleteFromArray<T extends { id: string }>(key: string, id: string): void {
  const array = getArray<T>(key)
  const filtered = array.filter(item => item.id !== id)
  setArray(key, filtered)
}

/**
 * 获取对象中的单个项（通过 ID）
 */
export function getItemById<T extends { id: string }>(key: string, id: string): T | null {
  const array = getArray<T>(key)
  return array.find(item => item.id === id) ?? null
}

/**
 * 批量获取存储值
 */
export function getMultiple(keys: string[]): Record<string, string | null> {
  const storage = getStorage()
  return storage.getMultiple(keys)
}

/**
 * 批量设置存储值
 */
export function setMultiple(items: Record<string, string>): void {
  const storage = getStorage()
  storage.setMultiple(items)
}

/**
 * 批量删除存储项
 */
export function removeMultiple(keys: string[]): void {
  const storage = getStorage()
  storage.removeMultiple(keys)
}