export interface Settings {
  removeReferences: boolean;
  removeUrls: boolean;
  removeDois: boolean;
  removeEmails: boolean;
  removeTables: boolean;
  removeFigureLabels: boolean;
  removeAuthors: boolean;
  removeCitations: boolean;
  removeConflicts: boolean;
  stopAtConclusion: boolean;
}

export interface SettingOption {
    key: keyof Settings;
    label: string;
}
