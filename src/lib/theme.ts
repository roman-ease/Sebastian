import { getSetting, setSetting, SETTING_KEYS } from './settings';

export type Theme = 'light' | 'dark' | 'sepia';

export function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove('theme-dark', 'theme-sepia');
  if (theme === 'dark') html.classList.add('theme-dark');
  if (theme === 'sepia') html.classList.add('theme-sepia');
}

const VALID_THEMES: Theme[] = ['light', 'dark', 'sepia'];

export async function loadAndApplyTheme(): Promise<Theme> {
  const saved = await getSetting(SETTING_KEYS.THEME);
  const theme: Theme = VALID_THEMES.includes(saved as Theme) ? (saved as Theme) : 'light';
  applyTheme(theme);
  return theme;
}

export async function saveTheme(theme: Theme): Promise<void> {
  await setSetting(SETTING_KEYS.THEME, theme);
  applyTheme(theme);
}
