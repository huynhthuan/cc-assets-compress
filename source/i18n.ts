import { join } from 'path';

export type TranslationVariables = Record<string, string | number>;
export type SupportedLocale = 'en' | 'zh' | 'vi';

interface TranslationMap {
    [key: string]: string | TranslationMap;
}

const fallbackMaps = new Map<string, TranslationMap>();
let selectedLocale: SupportedLocale | null = null;

function normalizeLocale(language: string): SupportedLocale {
    const normalized = language.toLowerCase();
    if (normalized.startsWith('zh')) {
        return 'zh';
    }
    if (normalized.startsWith('vi')) {
        return 'vi';
    }
    return 'en';
}

export function getLanguage(): SupportedLocale {
    return selectedLocale || normalizeLocale(Editor.I18n.getLanguage());
}

export function setLanguage(locale: SupportedLocale): void {
    selectedLocale = locale;
}

function loadFallbackMap(locale: SupportedLocale): TranslationMap | null {
    const cachedMap = fallbackMaps.get(locale);
    if (cachedMap) {
        return cachedMap;
    }

    const extensionPath = Editor.Package.getPath('cc-assets-compress') || join(__dirname, '..');

    try {
        // The compiled helper lives in dist/, while locale files stay in i18n/.
        const map = require(join(extensionPath, 'i18n', `${locale}.js`)) as TranslationMap;
        fallbackMaps.set(locale, map);
        return map;
    } catch (error) {
        console.warn(`[cc-assets-compress] Cannot load ${locale} translations`, error);
        return null;
    }
}

function findFallbackTranslation(map: TranslationMap, key: string): string | null {
    const directValue = map[key];
    if (typeof directValue === 'string') {
        return directValue;
    }

    let current: string | TranslationMap | undefined = map;
    for (const segment of key.split('.')) {
        if (typeof current !== 'object') {
            return null;
        }
        current = current[segment];
    }
    return typeof current === 'string' ? current : null;
}

function replaceVariables(value: string, variables?: TranslationVariables): string {
    if (!variables) {
        return value;
    }
    return value.replace(/\{([^}]+)\}/g, (match, name: string) => (
        Object.prototype.hasOwnProperty.call(variables, name)
            ? String(variables[name])
            : match
    ));
}

export function t(key: string, variables?: TranslationVariables): string {
    const fullKey = `cc-assets-compress.${key}`;
    const locale = getLanguage();
    const editorLocale = normalizeLocale(Editor.I18n.getLanguage());
    let translated = '';
    if (locale === editorLocale) {
        try {
            translated = Editor.I18n.t(fullKey, variables);
        } catch (error) {
            console.warn(`[cc-assets-compress] Cannot resolve i18n key ${fullKey}`, error);
        }
    }
    if (translated && translated !== fullKey && translated !== `i18n:${fullKey}`) {
        return translated;
    }

    const fallbackMap = loadFallbackMap(locale);
    const fallback = fallbackMap && findFallbackTranslation(fallbackMap, key);
    return fallback ? replaceVariables(fallback, variables) : fullKey;
}
