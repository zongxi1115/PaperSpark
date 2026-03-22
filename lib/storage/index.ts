/**
 * 存储模块入口
 */

// 导出类型
export type {
  StorageProvider,
  EventfulStorageProvider,
  StorageEventListener,
  StorageConfig,
} from './StorageProvider'

export { defaultStorageConfig } from './StorageProvider'

// 导出适配器
export { LocalStorageAdapter } from './LocalStorageAdapter'

// 导出工厂
export { StorageFactory, getStorage, createPrefixedStorage } from './StorageFactory'

// 导出工具函数
export {
  getJSON,
  setJSON,
  getString,
  setString,
  getNumber,
  setNumber,
  getBoolean,
  setBoolean,
  removeItem,
  hasItem,
  clearAll,
  getArray,
  setArray,
  addToArray,
  removeFromArray,
  updateInArray,
  deleteFromArray,
  getItemById,
  getMultiple,
  setMultiple,
  removeMultiple,
} from './StorageUtils'