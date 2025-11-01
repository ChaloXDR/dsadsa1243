import type { Settings } from '../types';

/**
 * Limpia el texto de Markdown para el TTS y el conteo de palabras.
 * @param {string} text - El texto con Markdown.
 * @returns {string} - El texto plano.
 */
export const stripMarkdown = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Negrita (**)
    .replace(/_(.*?)_/g, '$1')     // Itálica (_)
    .replace(/\*(.*?)\*/g, '$1')     // Itálica (*)
    .replace(/#{1,6}\s/g, '')      // Encabezados (#)
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Links [texto](url)
    .replace(/`([^`]+)`/g, '$1');    // Código (`code`)
};

export const cleanArticleText = (text: string, settings: Settings): string => {
  let cleaned = text;

  // Detener en secciones finales
  if (settings.stopAtConclusion) {
    const regex = /(Conclusion|Conclusions|Discussion|Discusión|Discusiones|Final Remarks|Closing|Conclusión|Conclusiones)\s*(\n|:)/i;
    const match = cleaned.match(regex);
    if (match && match.index !== undefined) {
      const endIndex = match.index + match[0].length;
      const afterConclusion = cleaned.substring(endIndex);
      const nextSectionMatch = afterConclusion.match(/\n\s*(\n[A-Z0-9]|\nReferences|\nReferencias)/);
      if (nextSectionMatch && nextSectionMatch.index !== undefined) {
        cleaned = cleaned.substring(0, endIndex + nextSectionMatch.index);
      }
    }
  }

  // Remover conflictos, fondos, contribuciones (Multilínea)
  const sectionsToRemove = [
    'Conflicts? of Interest', 'Competing Interests?', 'Disclosure',
    'Funding', 'Author Contributions', 'Declaración de.*',
    'Conflictos de interés', 'Fondos', 'Contribuciones de los autores',
    'Agradecimientos', 'Acknowledgments'
  ];
  if (settings.removeConflicts || settings.removeAuthors) {
    for (const section of sectionsToRemove) {
      const regex = new RegExp(`(\\n|\\A)${section}[\\s\\S]*?(?=(\\n\\n[A-Z0-9])|(\\n\\nReferences?)|(\\n\\nReferencias?)|(\\z))`, 'gi');
      cleaned = cleaned.replace(regex, '');
    }
  }

  // Remover sección de referencias completa
  if (settings.removeReferences) {
    cleaned = cleaned.replace(/(References?|Referencias|Bibliography|Works Cited|Literature Cited)\s*\n[\s\S]*$/i, '');
  }

  // Remover metadatos del inicio (single-line)
  if (settings.removeAuthors) {
    cleaned = cleaned.replace(/^[\s\S]*?(Abstract|Resumen)/i, '$1');
    cleaned = cleaned.replace(/Academic Editor:.*?\n/g, '');
    cleaned = cleaned.replace(/Received:.*?\n/g, '');
    cleaned = cleaned.replace(/Revised:.*?\n/g, '');
    cleaned = cleaned.replace(/Accepted:.*?\n/g, '');
    cleaned = cleaned.replace(/Published:.*?\n/g, '');
    cleaned = cleaned.replace(/Corrected:.*?\n/g, '');
    cleaned = cleaned.replace(/Citation:.*?\n/g, '');
    cleaned = cleaned.replace(/Copyright:.*?\n/g, '');
    cleaned = cleaned.replace(/Department of.*?\n/g, '');
    cleaned = cleaned.replace(/\* Correspondence:.*?\n/g, '');
  }

  // Remover URLs
  if (settings.removeUrls) {
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    cleaned = cleaned.replace(/www\.[^\s]+/g, '');
  }

  // Remover DOIs
  if (settings.removeDois) {
    cleaned = cleaned.replace(/doi:\s*[\d./]+/gi, '');
    cleaned = cleaned.replace(/https:\/\/doi\.org\/[^\s]+/g, '');
  }

  // Remover emails
  if (settings.removeEmails) {
    cleaned = cleaned.replace(/[\w.-]+@[\w.-]+\.\w+/g, '');
  }

  // Remover citas en múltiples formatos: [1], {20}, (5), [1,2], [1-3]
  if (settings.removeCitations) {
    cleaned = cleaned.replace(/\[\s*\d+\s*(?:[-,;]\s*\d+\s*)*\s*\]/g, ''); // [1, 2-5]
    cleaned = cleaned.replace(/\{\s*\d+\s*(?:[-,;]\s*\d+\s*)*\s*\}/g, ''); // {1, 2}
    cleaned = cleaned.replace(/\(\s*\d+\s*(?:[-,;]\s*\d+\s*)*\s*\)/g, ''); // (1, 2)
    cleaned = cleaned.replace(/\b(et al\.|e\.g\.|i\.e\.)/gi, ''); // et al.
  }

  // Remover etiquetas de figuras y tablas
  if (settings.removeFigureLabels) {
    cleaned = cleaned.replace(/(Figure|Fig\.|Tabla) \d+[.:].*?\n/gi, '');
    cleaned = cleaned.replace(/Scale bar:.*?\n/gi, '');
  }

  // Remover tablas (Multilínea)
  if (settings.removeTables) {
    cleaned = cleaned.replace(/Table \d+\.[\s\S]*?(?=(\n\n[A-Z])|(\n\n\d+\.)|(\n\nConclusion))/g, '');
  }

  // Limpieza final
  cleaned = cleaned.replace(/[^\w\s.,;:!?¿¡()áéíóúñÁÉÍÓÚÑüÜ\-–—%]/g, ''); // Caracteres extraños, preserves %
  cleaned = cleaned.replace(/[ \t]+/g, ' '); // Múltiples espacios
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Múltiples saltos
  cleaned = cleaned.trim();
  
  return cleaned;
};
