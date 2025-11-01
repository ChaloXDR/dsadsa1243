import type { SettingOption } from './types';

export const SETTINGS_OPTIONS: readonly SettingOption[] = [
  { key: 'removeReferences', label: 'Eliminar sección de referencias' },
  { key: 'removeCitations', label: 'Eliminar citas [1], {20}, (3)' },
  { key: 'removeConflicts', label: 'Eliminar conflictos/fondos' },
  { key: 'stopAtConclusion', label: 'Detener en conclusión/discusión' },
  { key: 'removeUrls', label: 'Eliminar URLs y DOIs' },
  { key: 'removeEmails', label: 'Eliminar correos electrónicos' },
  { key: 'removeTables', label: 'Eliminar tablas' },
  { key: 'removeFigureLabels', label: 'Eliminar etiquetas de figuras' },
  { key: 'removeAuthors', label: 'Eliminar metadatos de autores' },
];
