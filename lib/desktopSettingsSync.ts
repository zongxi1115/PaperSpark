'use client'

import type { AppSettings } from './types'
import { defaultSettings } from './types'
import { getSettings, saveSettings } from './storage'

function trimValue(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function mergeDesktopLauncherStateIntoSettings(
  currentSettings: AppSettings,
  launcherState: Awaited<ReturnType<NonNullable<Window['papersparkDesktop']>['launcher']['getState']>>,
): AppSettings {
  const currentDocumentParse = currentSettings.documentParse || defaultSettings.documentParse!
  const nextProviders = {
    ...defaultSettings.documentParse!.providers,
    ...currentDocumentParse.providers,
  }
  let nextDefaultProvider = currentDocumentParse.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider

  const deploymentMode = launcherState.savedDeploymentMode
  const serviceUrl = trimValue(launcherState.savedServiceUrl)
  const mineruUrl = trimValue(launcherState.savedMineruUrl)
  const mineruApiKey = trimValue(launcherState.savedMineruApiKey)
  const mineruModelVersion = trimValue(launcherState.savedMineruModelVersion) || 'vlm'

  if (deploymentMode === 'cloud' && serviceUrl) {
    nextDefaultProvider = 'surya-modal'
    nextProviders['surya-modal'] = {
      ...nextProviders['surya-modal'],
      baseUrl: serviceUrl,
    }
  } else if (deploymentMode === 'mineru') {
    nextDefaultProvider = 'mineru'
    nextProviders.mineru = {
      ...nextProviders.mineru,
      baseUrl: mineruUrl || nextProviders.mineru?.baseUrl || defaultSettings.documentParse!.providers.mineru.baseUrl,
      apiKey: mineruApiKey,
      modelVersion: mineruModelVersion,
    }
  } else if (launcherState.savedLocalParserEnabled) {
    nextDefaultProvider = 'surya-local'
  }

  return {
    ...currentSettings,
    documentParse: {
      defaultAdvancedProvider: nextDefaultProvider,
      providers: nextProviders,
    },
  }
}

export async function syncDesktopLauncherSettingsToLocalStorage() {
  if (typeof window === 'undefined') return

  const desktopApi = window.papersparkDesktop
  if (!desktopApi?.isDesktop || !desktopApi.launcher?.getState) return

  try {
    const launcherState = await desktopApi.launcher.getState()
    const currentSettings = getSettings()
    const nextSettings = mergeDesktopLauncherStateIntoSettings(currentSettings, launcherState)

    if (JSON.stringify(nextSettings.documentParse) === JSON.stringify(currentSettings.documentParse)) {
      return
    }

    saveSettings(nextSettings)
  } catch (error) {
    console.warn('Desktop launcher settings sync failed:', error)
  }
}
