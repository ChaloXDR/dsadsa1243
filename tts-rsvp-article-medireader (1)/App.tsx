import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import type { Settings } from './types';
import { SETTINGS_OPTIONS } from './constants';
import { stripMarkdown, cleanArticleText } from './utils/textCleaner';
import RsvpViewer from './components/RsvpViewer';
import PlaybackProgress from './components/PlaybackProgress';
import HighlightedTextView from './components/HighlightedTextView';
import { 
  FileText, Download, Play, Settings as SettingsIcon, Check, Upload, Mic, BookOpen, Trash2, 
  StopCircle, Pause, SkipBack, SkipForward, Sun, Moon, 
  AlertTriangle, Cpu, Rewind, FastForward, Key, Eye, EyeOff
} from './components/icons';

const GEMINI_SYSTEM_INSTRUCTION = `Propósito y Metas:

* Extraer el contenido principal de artículos PDF y presentarlo en formato de texto plano estructurado.
* Mantener la redacción original del texto sin ninguna modificación.
* Omitir estrictamente todos los elementos que no sean el contenido del artículo: referencias, números de referencias, metadatos, títulos de revista, citas, pies de página, encabezados, y cualquier comentario o introducción.
* Si el artículo fuente está en un idioma diferente al español, traducirlo completamente al español.
* Asegurar una jerarquía de títulos uniforme para todo el texto extraído.
* Entregar únicamente el contenido del texto sin añadir comentarios al inicio ni al final de la respuesta.

Comportamientos y Reglas:

1) Procesamiento del Contenido:
a) Identificar el cuerpo principal del texto del artículo, ignorando todos los elementos periféricos o de formato.
b) Ordenar el contenido extraído en formato de texto plano utilizando títulos para demarcar secciones.
c) Asegurar que la traducción al español, si es requerida, sea precisa y fluida, manteniendo el significado original.
d) Aplicar la misma jerarquía de titulación a lo largo de todo el texto, por ejemplo, utilizando un solo tipo de marcador para las secciones (e.g., TÍTULO PRINCIPAL, SUBTÍTULO).

2) Restricciones de Salida:
a) No incluir ninguna forma de citación o referencia bibliográfica en el texto final.
b) La respuesta debe ser puramente el texto extraído y traducido (si aplica).
c) No preámbulos, no despedidas, no explicaciones adicionales.

Tono General:

* Neutral, profesional y enfocado en la tarea.
* La presentación del texto debe ser directa y sin adornos. No consideres figuras ni tablas; el único formato de input serán archivos. Si existe otro formato (ej. modo palabra), solicita que se te proproporciona un archivo. Si se te proporciona un archivo, realiza siempre el proceso descrito anteriormente. Cada vez que haya una tabla o una figura referenciada en el texto, inserta 'PAUSA VER FIGURA/TABLA X', donde 'X' es el número correspondiente, para que sirva como señal para pausar la grabación TTS y visualizar la figura.`;


type ActiveTab = 'cleaner' | 'tts-rsvp';
type PlaybackState = 'stopped' | 'playing' | 'paused';
type Theme = 'light' | 'dark';
type TtsEngine = 'browser' | 'ai';

interface WordTiming {
    word: string;
    startTime: number;
    endTime: number;
}
interface AudioItem {
    buffer: AudioBuffer;
    timings: WordTiming[];
}

const AI_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const getSpeedInstruction = (wpm: number): string => {
    if (wpm < 160) return 'Habla lentamente:';
    if (wpm < 280) return '';
    if (wpm < 450) return 'Habla rápidamente:';
    return 'Habla muy rápidamente:';
};

const MedicalTTSApp: React.FC = () => {
    const [apiKey, setApiKey] = useState<string>('');
    const [showApiKeyModal, setShowApiKeyModal] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [isKeyVisible, setIsKeyVisible] = useState(false);

    const [activeTab, setActiveTab] = useState<ActiveTab>('cleaner');
    
    const [inputText, setInputText] = useState('');
    const [cleanedText, setCleanedText] = useState('');
    const [settings, setSettings] = useState<Settings>({
        removeReferences: true, removeUrls: true, removeDois: true, removeEmails: true,
        removeTables: true, removeFigureLabels: true, removeAuthors: true,
        removeCitations: true, removeConflicts: true, stopAtConclusion: true,
    });
    const [showSettings, setShowSettings] = useState(false);
    const [isProcessingPdf, setIsProcessingPdf] = useState(false);
    const txtFileInputRef = useRef<HTMLInputElement>(null);
    const pdfFileInputRef = useRef<HTMLInputElement>(null);

    const [ttsText, setTtsText] = useState('');
    const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
    const [previousWord, setPreviousWord] = useState('');
    const [currentWord, setCurrentWord] = useState('');
    const [nextWord, setNextWord] = useState('');
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [wpm, setWpm] = useState(350);
    const [wordRegex] = useState(/([\wáéíóúñÁÉÍÓÚÑüÜ'-]+(?:[.,;!?¿¡:"()\[\]{}])?)/g);
    
    const [words, setWords] = useState<string[]>([]);
    const [paragraphs, setParagraphs] = useState<string[]>([]);
    const [paragraphWordIndices, setParagraphWordIndices] = useState<number[]>([]);
    
    const [modal, setModal] = useState({ show: false, message: '' });

    const [ttsEngine, setTtsEngine] = useState<TtsEngine>('ai');
    const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedBrowserVoiceURI, setSelectedBrowserVoiceURI] = useState<string | null>(null);
    const [selectedAiVoice, setSelectedAiVoice] = useState('Zephyr');
    
    const [isPreProcessingAudio, setIsPreProcessingAudio] = useState(false);
    const [isAudioReady, setIsAudioReady] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
    const [audioDownloadUrl, setAudioDownloadUrl] = useState<string | null>(null);

    const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
    const [seekedWhilePaused, setSeekedWhilePaused] = useState(false);

    const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'light');

    const audioContextRef = useRef<AudioContext | null>(null);
    const audioQueueRef = useRef<(AudioItem | null)[]>([]);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const isPlayingAiRef = useRef(false);
    const animationFrameIdRef = useRef<number>(0);
    const audioStartTimeRef = useRef(0);

    useEffect(() => {
        const savedApiKey = sessionStorage.getItem('gemini-api-key');
        if (savedApiKey) {
            setApiKey(savedApiKey);
        } else {
            setShowApiKeyModal(true);
        }
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);
    
    const handleSaveApiKey = () => {
        if (apiKeyInput.trim()) {
            setApiKey(apiKeyInput);
            sessionStorage.setItem('gemini-api-key', apiKeyInput);
            setShowApiKeyModal(false);
        }
    };

    const handleClearApiKey = () => {
        setApiKey('');
        setApiKeyInput('');
        sessionStorage.removeItem('gemini-api-key');
        setShowApiKeyModal(true);
    };

    const handleStop = useCallback(() => {
        window.speechSynthesis.cancel();
        
        cancelAnimationFrame(animationFrameIdRef.current);
        if (audioSourceRef.current) {
            try { audioSourceRef.current.stop(); } catch (e) {}
            audioSourceRef.current.disconnect();
            audioSourceRef.current = null;
        }
        
        isPlayingAiRef.current = false;

        setPlaybackState('stopped');
        setPreviousWord('');
        setCurrentWord('');
        setNextWord('');
        setCurrentWordIndex(0);
        setCurrentParagraphIndex(0);
        setSeekedWhilePaused(false);
    }, []);

    useEffect(() => {
        const loadVoices = () => {
            let availableVoices = window.speechSynthesis.getVoices();
            if (availableVoices.length > 0) {
                const spanishVoices = availableVoices.filter(v => v.lang.startsWith('es'));
                setBrowserVoices(spanishVoices);
                const defaultSpanish = spanishVoices.find(v => v.default) || spanishVoices[0];
                if (defaultSpanish) setSelectedBrowserVoiceURI(defaultSpanish.voiceURI);
            }
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
        return () => {
            window.speechSynthesis.onvoiceschanged = null;
            handleStop();
        };
    }, [handleStop]);
    
    useEffect(() => {
        setIsAudioReady(false);
    }, [ttsText, selectedAiVoice, wpm, ttsEngine, selectedBrowserVoiceURI]);
    
    useEffect(() => {
        if (audioDownloadUrl) URL.revokeObjectURL(audioDownloadUrl);
        setAudioDownloadUrl(null);
    }, [ttsText, selectedAiVoice, wpm, ttsEngine]);

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = error => reject(error);
        });
    };

    const processPdfWithGemini = async (file: File) => {
        if (!apiKey) {
            setModal({ show: true, message: 'Por favor, configura tu clave de API para usar esta función.' });
            setShowApiKeyModal(true);
            return;
        }
        setIsProcessingPdf(true);
        setInputText(`Procesando ${file.name} con IA...`);
        setCleanedText('');
        try {
            const ai = new GoogleGenAI({ apiKey });
            const base64Data = await fileToBase64(file);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: { parts: [{ inlineData: { mimeType: 'application/pdf', data: base64Data } }] },
                config: { systemInstruction: GEMINI_SYSTEM_INSTRUCTION }
            });
            setCleanedText(response.text);
            setInputText(`Contenido original del PDF: ${file.name} (procesado con IA)`);
        } catch (error) {
            console.error("Error processing PDF with Gemini:", error);
            setModal({ show: true, message: 'Error al procesar el PDF. Revisa tu clave de API y la consola para más detalles.' });
            setInputText('');
        } finally {
            setIsProcessingPdf(false);
        }
    };
    
    const handleTxtFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) setInputText(await file.text());
        e.target.value = '';
    };

    const handlePdfFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await processPdfWithGemini(file);
        e.target.value = '';
    };

    const handleClean = () => setCleanedText(cleanArticleText(inputText, settings));
    const handleDownload = () => {
        const blob = new Blob([cleanedText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'articulo-limpio.txt';
        a.click();
        URL.revokeObjectURL(url);
    };
    const handleCopy = () => navigator.clipboard.writeText(cleanedText).then(() => setModal({ show: true, message: 'Texto copiado' }));
    const toggleSetting = (key: keyof Settings) => setSettings(prev => ({ ...prev, [key]: !prev[key] }));

    const preprocessText = useCallback((text: string) => {
        handleStop();
        const cleanedForTTS = stripMarkdown(text);
        const allWords = (cleanedForTTS.match(wordRegex) || []);
        const allParagraphs = cleanedForTTS.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        
        let wordCount = 0;
        const pWordIndices = allParagraphs.map(p => {
            const startIdx = wordCount;
            wordCount += (p.match(wordRegex) || []).length;
            return startIdx;
        });

        setWords(allWords);
        setParagraphs(allParagraphs);
        setParagraphWordIndices(pWordIndices);
        setPreviousWord('');
        setCurrentWordIndex(0);
        setCurrentParagraphIndex(0);
        setCurrentWord(allWords[0] || '');
        setNextWord(allWords[1] || '');
        
        return allWords.length;
    }, [handleStop, wordRegex]);
    
    const handleSendToTTS = () => {
        setTtsText(cleanedText);
        setActiveTab('tts-rsvp');
    };
    
    const calculateWordTimings = useCallback((paragraphText: string, audioBuffer: AudioBuffer): WordTiming[] => {
        const wordsInParagraph = paragraphText.match(wordRegex) || [];
        if (wordsInParagraph.length === 0) return [];

        const totalDuration = audioBuffer.duration;
        
        const weights = wordsInParagraph.map(word => {
            const punctuationWeight = /[.,;!?:]$/.test(word) ? 3 : 0;
            return word.length + 2 + punctuationWeight;
        });
        
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        if (totalWeight === 0) return [];

        let accumulatedTime = 0;

        return wordsInParagraph.map((word, index) => {
            const startTime = accumulatedTime;
            const wordDuration = (weights[index] / totalWeight) * totalDuration;
            accumulatedTime += wordDuration;
            const endTime = index === wordsInParagraph.length - 1 ? totalDuration : accumulatedTime;
            return { word, startTime, endTime };
        });
    }, [wordRegex]);
    
    const aiRsvpAnimationLoop = useCallback(() => {
        if (!audioContextRef.current || !audioSourceRef.current || !isPlayingAiRef.current) return;
        
        const playbackRate = audioSourceRef.current.playbackRate.value;
        const elapsedTime = (audioContextRef.current.currentTime - audioStartTimeRef.current) * playbackRate;
        
        const currentAudioItem = audioQueueRef.current[currentParagraphIndex];
        if(!currentAudioItem) return;

        const { timings } = currentAudioItem;
        const currentTiming = timings.find(t => elapsedTime >= t.startTime && elapsedTime < t.endTime);
        
        if (currentTiming) {
            const wordIndexInParagraph = timings.indexOf(currentTiming);
            const paragraphStartWordIndex = paragraphWordIndices[currentParagraphIndex] || 0;
            const globalWordIndex = paragraphStartWordIndex + wordIndexInParagraph;

            if (currentWordIndex !== globalWordIndex) {
                 setPreviousWord(words[globalWordIndex - 1] || '');
                 setCurrentWordIndex(globalWordIndex);
                 setCurrentWord(words[globalWordIndex] || '');
                 setNextWord(words[globalWordIndex + 1] || '');
            }
        }
        
        animationFrameIdRef.current = requestAnimationFrame(aiRsvpAnimationLoop);
    }, [currentParagraphIndex, paragraphWordIndices, words, currentWordIndex]);

    const playAiAudio = useCallback((pIndex: number, startTimeOffset = 0) => {
        if (!isPlayingAiRef.current || pIndex >= paragraphs.length) {
            handleStop();
            return;
        }
        
        setCurrentParagraphIndex(pIndex);

        const audioItem = audioQueueRef.current[pIndex];
        if (!audioItem) { 
             playAiAudio(pIndex + 1, 0); // Start next paragraph from beginning
             return;
        }

        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
             audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        audioContextRef.current.resume();
        
        const source = audioContextRef.current.createBufferSource();
        audioSourceRef.current = source;
        source.buffer = audioItem.buffer;
        source.playbackRate.value = 1.0;
        source.connect(audioContextRef.current.destination);
        
        source.onended = () => {
            cancelAnimationFrame(animationFrameIdRef.current);
            if (isPlayingAiRef.current) {
                playAiAudio(pIndex + 1, 0); // Start next paragraph from beginning
            }
        };
        
        audioStartTimeRef.current = audioContextRef.current.currentTime - startTimeOffset;
        source.start(0, startTimeOffset);
        animationFrameIdRef.current = requestAnimationFrame(aiRsvpAnimationLoop);

    }, [paragraphs, handleStop, aiRsvpAnimationLoop]);

    const fetchAudioForParagraph = useCallback(async (text: string, retries = 2): Promise<AudioItem | null> => {
        if (!apiKey) {
            setShowApiKeyModal(true);
            throw new Error("API Key is not configured.");
        }
        for (let i = 0; i <= retries; i++) {
            try {
                const speedInstruction = getSpeedInstruction(wpm);
                const prompt = `${speedInstruction} ${text}`.trim();
                if (!prompt) {
                    console.warn("Skipping empty paragraph for TTS.");
                    return null;
                }
                
                const ai = new GoogleGenAI({ apiKey });
                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash-preview-tts",
                    contents: [{ parts: [{ text: prompt }] }],
                    config: {
                        responseModalities: [Modality.AUDIO],
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedAiVoice }}},
                    },
                });

                const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                
                if (base64Audio && audioContextRef.current && audioContextRef.current.state !== 'closed') {
                    const audioBytes = decode(base64Audio);
                    if(audioBytes.length === 0) {
                         console.warn(`AI TTS: Received empty audio data for paragraph: "${text.substring(0,30)}..."`, "Retrying...");
                         if (i < retries) await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
                         continue;
                    }
                    const audioBuffer = await decodeAudioData(audioBytes, audioContextRef.current, 24000, 1);
                    const wordTimings = calculateWordTimings(text, audioBuffer);
                    return { buffer: audioBuffer, timings: wordTimings };
                } else {
                    console.warn(`AI TTS: No audio data in response for paragraph: "${text.substring(0,30)}...". Retrying...`, response);
                    if (i < retries) await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
                }
            } catch (error) {
                console.error(`AI TTS Error (Attempt ${i + 1}/${retries + 1}) for paragraph: "${text.substring(0,30)}..."`, error);
                if (i === retries) {
                     return null;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
        console.error(`AI TTS: Failed to get audio data for paragraph after all retries: "${text.substring(0,30)}..."`);
        return null;
    }, [selectedAiVoice, wpm, calculateWordTimings, apiKey]);

    const audioBufferToWav = (buffer: AudioBuffer): Blob => {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const bufferArr = new ArrayBuffer(length);
        const view = new DataView(bufferArr);
        let i, sample;
        let offset = 0;
        let pos = 0;
    
        const setString = (str: string) => {
          for (i = 0; i < str.length; i++) {
            view.setUint8(pos++, str.charCodeAt(i));
          }
        };
    
        setString('RIFF');
        view.setUint32(pos, length - 8, true); pos += 4;
        setString('WAVE');
        setString('fmt ');
        view.setUint32(pos, 16, true); pos += 4;
        view.setUint16(pos, 1, true); pos += 2;
        view.setUint16(pos, numOfChan, true); pos += 2;
        view.setUint32(pos, buffer.sampleRate, true); pos += 4;
        view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
        view.setUint16(pos, numOfChan * 2, true); pos += 2;
        view.setUint16(pos, 16, true); pos += 2;
        setString('data');
        view.setUint32(pos, length - pos - 4, true); pos += 4;
    
        const channels = [];
        for (i = 0; i < buffer.numberOfChannels; i++) {
          channels.push(buffer.getChannelData(i));
        }
    
        while (pos < length) {
          for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(pos, sample, true);
            pos += 2;
          }
          offset++;
        }
        return new Blob([view], { type: 'audio/wav' });
    };

    const generateWavFile = useCallback((audioItems: AudioItem[]) => {
        if (!audioItems.length || !audioContextRef.current) return;
    
        const totalLength = audioItems.reduce((acc, item) => acc + (item?.buffer?.length || 0), 0);
        if (totalLength === 0) return;
        
        const validItems = audioItems.filter((item): item is AudioItem => item !== null && item.buffer !== null);
        if(!validItems.length) return;

        const sampleRate = validItems[0].buffer.sampleRate;
        const channels = validItems[0].buffer.numberOfChannels;
    
        const concatenatedBuffer = audioContextRef.current.createBuffer(channels, totalLength, sampleRate);
        let offset = 0;
        for (const item of validItems) {
            for (let channel = 0; channel < channels; channel++) {
                concatenatedBuffer.getChannelData(channel).set(item.buffer.getChannelData(channel), offset);
            }
            offset += item.buffer.length;
        }
        
        const wavBlob = audioBufferToWav(concatenatedBuffer);
        
        if (audioDownloadUrl) URL.revokeObjectURL(audioDownloadUrl);
        setAudioDownloadUrl(URL.createObjectURL(wavBlob));
    }, [audioDownloadUrl]);

    const handlePreProcessBrowserAudio = () => {
        if (!ttsText) return;
        preprocessText(ttsText);
        setIsAudioReady(true);
        setModal({ show: true, message: 'Texto procesado para voz del navegador. Listo para reproducir.' });
    };

    const handlePreProcessAiAudio = async () => {
        if (!apiKey) {
            setModal({ show: true, message: 'Por favor, configura tu clave de API para usar la voz de IA.' });
            setShowApiKeyModal(true);
            return;
        }
        if (!ttsText.trim()) return;

        setIsPreProcessingAudio(true);
        setProcessingProgress(0);
        setEstimatedTime(null);
        if (audioDownloadUrl) URL.revokeObjectURL(audioDownloadUrl);
        setAudioDownloadUrl(null);
        audioQueueRef.current = [];
        
        // Call preprocessText to update global state (words, etc.) for UI components
        preprocessText(ttsText);
        // Use a local variable for paragraphs to avoid race condition with state updates
        const localParagraphs = ttsText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        if (localParagraphs.length === 0) {
            setIsPreProcessingAudio(false);
            return;
        }

        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        const CONCURRENCY_LIMIT = 3;
        const results: (AudioItem | null)[] = Array(localParagraphs.length).fill(null);
        let processedCount = 0;
        let hasFailures = false;
        const startTime = Date.now();

        const queue = [...localParagraphs.entries()];

        const worker = async () => {
            while (true) {
                const item = queue.shift();
                if (!item) return;
                
                const [index, text] = item;
                const audioItem = await fetchAudioForParagraph(text);
                results[index] = audioItem;
                if (!audioItem) {
                    hasFailures = true;
                    console.error(`Fallo final al procesar el párrafo ${index + 1}.`);
                }
                
                processedCount++;
                setProcessingProgress(Math.round((processedCount / localParagraphs.length) * 100));

                const elapsedSeconds = (Date.now() - startTime) / 1000;
                const avgTime = elapsedSeconds / processedCount;
                const remainingSeconds = Math.round(avgTime * (localParagraphs.length - processedCount));
                
                if (remainingSeconds > 0) {
                    const minutes = Math.floor(remainingSeconds / 60);
                    const seconds = remainingSeconds % 60;
                    setEstimatedTime(`${minutes}m ${seconds.toString().padStart(2, '0')}s restantes`);
                } else {
                    setEstimatedTime(null);
                }
            }
        };

        await Promise.all(Array(CONCURRENCY_LIMIT).fill(0).map(worker));
        
        const successfulCount = results.filter(r => r !== null).length;
        
        if (hasFailures) {
            const failedCount = localParagraphs.length - successfulCount;
            setModal({ show: true, message: `Proceso completado. ${failedCount} párrafo(s) fallaron y serán omitidos.` });
        } else {
            setModal({ show: true, message: 'Audio de IA procesado. Listo para reproducir y descargar.' });
        }
        
        audioQueueRef.current = results;
        setIsPreProcessingAudio(false);
        setEstimatedTime(null);
        setIsAudioReady(successfulCount > 0);
        if (successfulCount > 0) {
            generateWavFile(results.filter((r): r is AudioItem => r !== null));
        }
    };

    const startBrowserPlayback = useCallback((pIndex: number, startWordIndexInParagraph = 0) => {
        window.speechSynthesis.cancel();
        
        const paragraphText = paragraphs[pIndex];
        if (!paragraphText?.trim()) { 
            if(pIndex < paragraphs.length - 1) startBrowserPlayback(pIndex + 1);
            else handleStop();
            return; 
        }

        const wordsInParagraph = paragraphText.match(wordRegex) || [];
        const textToSpeak = wordsInParagraph.slice(startWordIndexInParagraph).join(' ');

        if (!textToSpeak.trim()) {
            if(pIndex < paragraphs.length - 1) startBrowserPlayback(pIndex + 1);
            else handleStop();
            return; 
        }

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        
        const voice = browserVoices.find(v => v.voiceURI === selectedBrowserVoiceURI);
        if (voice) utterance.voice = voice;
        
        utterance.rate = wpm / 180;
        utterance.onboundary = (event: SpeechSynthesisEvent) => {
            const textBeingSpoken = event.utterance.text;
            const textBeforeWord = textBeingSpoken.substring(0, event.charIndex);
            const relativeWordIndex = (textBeforeWord.match(wordRegex) || []).length;
            
            const paragraphStartIndex = paragraphWordIndices[pIndex] || 0;
            const globalWordIndex = paragraphStartIndex + startWordIndexInParagraph + relativeWordIndex;
            
            setPreviousWord(words[globalWordIndex - 1] || '');
            setCurrentWordIndex(globalWordIndex);
            setCurrentWord(words[globalWordIndex] || '');
            setNextWord(words[globalWordIndex + 1] || '');
        };
        utterance.onend = () => {
            const nextPIndex = pIndex + 1;
            if (nextPIndex < paragraphs.length) {
                setCurrentParagraphIndex(nextPIndex);
                startBrowserPlayback(nextPIndex);
            } else {
                handleStop();
            }
        };
        utterance.onerror = (e) => {
            if (e.error !== 'interrupted' && e.error !== 'canceled') {
                console.error("SpeechSynthesis Error:", e); 
                setModal({ show: true, message: `Error de voz: ${e.error}.`});
                handleStop();
            }
        };
        setCurrentParagraphIndex(pIndex);
        window.speechSynthesis.speak(utterance);
    }, [words, paragraphs, browserVoices, selectedBrowserVoiceURI, wpm, handleStop, wordRegex, paragraphWordIndices]);
    
    const startPlaybackFromCurrentState = useCallback(() => {
        if (words.length === 0) return;

        window.speechSynthesis.cancel();
        if (audioSourceRef.current) {
            try { audioSourceRef.current.stop(); } catch (e) {}
            audioSourceRef.current.disconnect();
            audioSourceRef.current = null;
        }
        cancelAnimationFrame(animationFrameIdRef.current);
        
        setPlaybackState('playing');
        setSeekedWhilePaused(false);
        
        const startPIndex = currentParagraphIndex;
        const paragraphStartWordIndex = paragraphWordIndices[startPIndex] || 0;
        const wordIndexInParagraph = currentWordIndex - paragraphStartWordIndex;

        if (ttsEngine === 'ai') {
            if (!apiKey) {
                setShowApiKeyModal(true);
                setModal({ show: true, message: "Se necesita una clave de API para reproducir audio de IA." });
                setPlaybackState('stopped');
                return;
            }
            let offset = 0;
            const audioItem = audioQueueRef.current[startPIndex];
            if (audioItem && audioItem.timings[wordIndexInParagraph]) {
                offset = audioItem.timings[wordIndexInParagraph].startTime;
            }
            isPlayingAiRef.current = true;
            playAiAudio(startPIndex, offset);
        } else {
            startBrowserPlayback(startPIndex, wordIndexInParagraph);
        }
    }, [words, currentWordIndex, currentParagraphIndex, ttsEngine, paragraphWordIndices, playAiAudio, startBrowserPlayback, apiKey]);

    const handlePause = useCallback(() => {
        if (playbackState !== 'playing') return;
        if (ttsEngine === 'browser') {
            window.speechSynthesis.pause();
        } else if (audioContextRef.current) {
            audioContextRef.current.suspend();
            isPlayingAiRef.current = false;
            cancelAnimationFrame(animationFrameIdRef.current);
        }
        setSeekedWhilePaused(false);
        setPlaybackState('paused');
    }, [playbackState, ttsEngine]);

    const handlePlay = useCallback(() => {
        if (playbackState === 'playing' || !ttsText) return;
        if (!isAudioReady) {
            setModal({show: true, message: 'Por favor, procesa el audio antes de reproducir.'});
            return;
        }

        if (playbackState === 'paused' && !seekedWhilePaused) {
            if (ttsEngine === 'browser') {
                window.speechSynthesis.resume();
            } else if (audioContextRef.current) {
                audioContextRef.current.resume();
                isPlayingAiRef.current = true;
                animationFrameIdRef.current = requestAnimationFrame(aiRsvpAnimationLoop);
            }
            setPlaybackState('playing');
        } else {
            startPlaybackFromCurrentState();
        }
    }, [playbackState, ttsText, isAudioReady, seekedWhilePaused, ttsEngine, aiRsvpAnimationLoop, startPlaybackFromCurrentState]);

    const handleClearTTS = () => {
        handleStop();
        setTtsText('');
        setWords([]);
        setParagraphs([]);
        setParagraphWordIndices([]);
        setPreviousWord('');
        setIsAudioReady(false);
        setIsPreProcessingAudio(false);
        setProcessingProgress(0);
        if (audioDownloadUrl) URL.revokeObjectURL(audioDownloadUrl);
        setAudioDownloadUrl(null);
    };

    const handleWordClick = useCallback((index: number) => {
        if (playbackState === 'playing' || index < 0 || index >= words.length) return;

        if (playbackState === 'paused') {
            setSeekedWhilePaused(true);
        }

        let paragraphIndex = 0;
        for (let i = 0; i < paragraphWordIndices.length; i++) {
            if (paragraphWordIndices[i] > index) {
                break;
            }
            paragraphIndex = i;
        }
        
        setCurrentParagraphIndex(paragraphIndex);
        setPreviousWord(words[index - 1] || '');
        setCurrentWordIndex(index);
        setCurrentWord(words[index] || '');
        setNextWord(words[index + 1] || '');
    }, [playbackState, words, paragraphWordIndices]);
    
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (activeTab !== 'tts-rsvp') return;

            const activeElement = document.activeElement;
            if (activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)) {
                return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    if (playbackState === 'playing') {
                        handlePause();
                    } else {
                        handlePlay();
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    handleStop();
                    break;
                case 'ArrowRight':
                    if (playbackState !== 'playing') {
                        e.preventDefault();
                        const amount = e.shiftKey ? 10 : 1;
                        handleWordClick(Math.min(words.length - 1, currentWordIndex + amount));
                    }
                    break;
                case 'ArrowLeft':
                    if (playbackState !== 'playing') {
                        e.preventDefault();
                        const amount = e.shiftKey ? 10 : 1;
                        handleWordClick(Math.max(0, currentWordIndex - amount));
                    }
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeTab, playbackState, handlePause, handlePlay, handleStop, handleWordClick, currentWordIndex, words.length]);
    
    const wordCount = cleanedText ? stripMarkdown(cleanedText).split(/\s+/).filter(Boolean).length : 0;
    
    const ControlsPanel: React.FC = () => (
        <div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="space-y-6">
                 <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Motor de Voz</label>
                    <div className="flex bg-gray-200 dark:bg-gray-700 rounded-lg p-1">
                        <button onClick={() => setTtsEngine('browser')} className={`w-1/2 py-2 text-sm font-semibold rounded-md transition ${ttsEngine === 'browser' ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>Navegador</button>
                        <button onClick={() => setTtsEngine('ai')} className={`w-1/2 py-2 text-sm font-semibold rounded-md transition ${ttsEngine === 'ai' ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>Voz IA</button>
                    </div>
                </div>
                 <div>
                    <label htmlFor="voice-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Voz ({ttsEngine === 'ai' ? 'IA' : 'Navegador'})</label>
                    {ttsEngine === 'browser' ? (
                        <select id="voice-select" value={selectedBrowserVoiceURI || ''} onChange={e => setSelectedBrowserVoiceURI(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm">
                            {browserVoices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
                        </select>
                    ) : (
                        <select id="voice-select-ai" value={selectedAiVoice} onChange={e => setSelectedAiVoice(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm" disabled={!apiKey}>
                            {AI_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                        </select>
                    )}
                </div>
                 <div>
                    <label htmlFor="wpm-slider" className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        <span>Velocidad</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{wpm} PPM</span>
                    </label>
                    <input id="wpm-slider" type="range" min="100" max="900" step="25" value={wpm} onChange={e => setWpm(parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                 </div>
                 <div className="space-y-3">
                    {ttsEngine === 'ai' ? (
                         <button onClick={handlePreProcessAiAudio} disabled={!ttsText || isPreProcessingAudio || isAudioReady || !apiKey} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:bg-gray-400 dark:disabled:bg-gray-600">
                             <Cpu className="w-5 h-5"/>
                             {isPreProcessingAudio ? `Procesando...` : isAudioReady ? 'Audio de IA Listo' : 'Procesar Voz de IA'}
                         </button>
                    ) : (
                         <button onClick={handlePreProcessBrowserAudio} disabled={!ttsText || isAudioReady} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:bg-gray-400 dark:disabled:bg-gray-600">
                             <Cpu className="w-5 h-5"/>
                            {isAudioReady ? 'Audio de Navegador Listo' : 'Procesar Voz Navegador'}
                         </button>
                    )}
                    {isPreProcessingAudio && ttsEngine === 'ai' && (
                         <div className="space-y-2">
                             <div className="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-400">
                                 <span>Procesando... {processingProgress}%</span>
                                 {estimatedTime && <span>{estimatedTime}</span>}
                             </div>
                             <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${processingProgress}%` }}></div>
                             </div>
                         </div>
                     )}
                     <a href={audioDownloadUrl || undefined} download="audio.wav"
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition ${!audioDownloadUrl || ttsEngine !== 'ai' ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                        aria-disabled={!audioDownloadUrl || ttsEngine !== 'ai'}
                        onClick={(e) => (!audioDownloadUrl || ttsEngine !== 'ai') && e.preventDefault()}
                    >
                        <Download className="w-5 h-5"/>
                        Descargar Audio (WAV)
                    </a>
                </div>
                
                <div className="flex items-center justify-around pt-4">
                    <button onClick={() => handleWordClick(Math.max(0, currentWordIndex - 10))} className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded-full transition disabled:opacity-50" disabled={playbackState === 'playing'} title="Retroceder 10 palabras (Shift + ←)"><Rewind className="w-6 h-6" /></button>
                    <button onClick={() => handleWordClick(Math.max(0, currentWordIndex - 1))} className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded-full transition disabled:opacity-50" disabled={playbackState === 'playing'} title="Retroceder 1 palabra (←)"><SkipBack className="w-6 h-6" /></button>
                    
                    <button 
                        onClick={playbackState === 'playing' ? handlePause : handlePlay}
                        className={`p-4 text-white rounded-full shadow-lg transition disabled:opacity-50 ${playbackState === 'playing' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'} disabled:bg-gray-400 dark:disabled:bg-gray-600`}
                        disabled={!ttsText || !isAudioReady}
                        title={playbackState === 'playing' ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
                    >
                        {playbackState === 'playing' ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
                    </button>

                    <button onClick={() => handleWordClick(Math.min(words.length - 1, currentWordIndex + 1))} className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded-full transition disabled:opacity-50" disabled={playbackState === 'playing'} title="Adelantar 1 palabra (→)"><SkipForward className="w-6 h-6" /></button>
                    <button onClick={() => handleWordClick(Math.min(words.length - 1, currentWordIndex + 10))} className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded-full transition disabled:opacity-50" disabled={playbackState === 'playing'} title="Adelantar 10 palabras (Shift + →)"><FastForward className="w-6 h-6" /></button>
                </div>
                <div className="flex items-center justify-center gap-4 pt-4">
                     <button onClick={handleStop} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700/50 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition" title="Detener (Esc)">
                        <StopCircle className="w-5 h-5" /> Detener
                    </button>
                    <button onClick={handleClearTTS} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg transition" title="Limpiar texto">
                       <Trash2 className="w-5 h-5" /> Limpiar
                    </button>
                </div>
                 <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 space-y-2 text-center">
                    <p className="font-semibold text-sm mb-3">Atajos de Teclado</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-w-xs mx-auto">
                        <div className="text-right font-mono pr-2 border-r border-gray-300 dark:border-gray-600">Espacio</div>
                        <div className="text-left">Play / Pausa</div>
                        <div className="text-right font-mono pr-2 border-r border-gray-300 dark:border-gray-600">Esc</div>
                        <div className="text-left">Detener</div>
                        <div className="text-right font-mono pr-2 border-r border-gray-300 dark:border-gray-600">→ / ←</div>
                        <div className="text-left">+/- 1 Palabra</div>
                        <div className="text-right font-mono pr-2 border-r border-gray-300 dark:border-gray-600">Shift + → / ←</div>
                        <div className="text-left">+/- 10 Palabras</div>
                    </div>
                </div>
            </div>
        </div>
    );
    
    const ApiKeyModal: React.FC = () => (
        <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" aria-modal="true" role="dialog">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 md:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700 transform transition-all" role="document">
                <div className="flex items-center gap-3 mb-4">
                    <Key className="w-7 h-7 text-blue-500" />
                    <h2 className="text-xl font-bold">Configurar Clave de API</h2>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    Para usar las funciones de IA (Procesamiento de PDF y Voz de IA), necesitas una clave de API de Google AI Studio.
                    Esta clave se guardará solo en tu navegador para esta sesión.
                </p>
                <div className="space-y-2">
                    <label htmlFor="api-key-input" className="text-sm font-medium text-gray-700 dark:text-gray-300">Tu Clave de API de Gemini</label>
                    <div className="relative">
                        <input
                            id="api-key-input"
                            type={isKeyVisible ? 'text' : 'password'}
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            className="w-full pl-3 pr-10 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Introduce tu clave aquí..."
                        />
                        <button
                            type="button"
                            onClick={() => setIsKeyVisible(!isKeyVisible)}
                            className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            title={isKeyVisible ? 'Ocultar clave' : 'Mostrar clave'}
                        >
                            {isKeyVisible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
                <button
                    onClick={handleSaveApiKey}
                    disabled={!apiKeyInput.trim()}
                    className="mt-6 w-full px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition disabled:bg-gray-400 dark:disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                    Guardar y Continuar
                </button>
                <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
                    ¿No tienes una clave? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Obtenla aquí</a>.
                </p>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen p-2 sm:p-4 md:p-8 transition-colors duration-300">
            {showApiKeyModal && <ApiKeyModal />}
            {modal.show && (
                <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3 mb-4">
                            <Check className="w-6 h-6 text-blue-500" />
                            <h3 className="text-lg font-semibold">Notificación</h3>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">{modal.message}</p>
                        <button onClick={() => setModal({ show: false, message: '' })} className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition">Entendido</button>
                    </div>
                </div>
            )}
            
            <main className="max-w-7xl mx-auto" aria-hidden={showApiKeyModal}>
                <header className="relative flex items-center justify-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 flex gap-2">
                         <button onClick={() => setShowApiKeyModal(true)} className="flex items-center justify-center w-10 h-10 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition" title="Configurar Clave de API">
                            <Key className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <BookOpen className="w-8 h-8 text-blue-600 dark:text-blue-500" />
                        <h1 className="text-xl sm:text-2xl font-bold text-center">TTS-RSVP ARTICLE MEDIREADER</h1>
                    </div>
                    <div className="absolute right-0 top-1/2 -translate-y-1/2">
                        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="flex items-center justify-center w-10 h-10 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition" title={`Cambiar tema`}>
                            {theme === 'light' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                        </button>
                    </div>
                </header>

                <div className={`bg-white dark:bg-gray-800/50 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden transition-opacity ${showApiKeyModal ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                    <div className="flex border-b border-gray-200 dark:border-gray-700">
                        <button onClick={() => setActiveTab('cleaner')} className={`flex-1 px-4 py-3 sm:px-6 sm:py-4 text-sm sm:text-base font-semibold transition-colors duration-200 focus:outline-none ${activeTab === 'cleaner' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'border-b-2 border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                           <FileText className="inline w-5 h-5 mr-2" /> <span className="hidden sm:inline">Limpiador de Artículos</span><span className="sm:hidden">Limpiador</span>
                        </button>
                        <button onClick={() => setActiveTab('tts-rsvp')} className={`flex-1 px-4 py-3 sm:px-6 sm:py-4 text-sm sm:text-base font-semibold transition-colors duration-200 focus:outline-none ${activeTab === 'tts-rsvp' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'border-b-2 border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                            <Mic className="inline w-5 h-5 mr-2" /> <span className="hidden sm:inline">Lector TTS-RSVP</span><span className="sm:hidden">Lector</span>
                        </button>
                    </div>
                    
                    <div className="p-4 sm:p-6 md:p-8">
                        {activeTab === 'cleaner' ? (
                            <div className="relative">
                                {isProcessingPdf && (
                                    <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 flex flex-col items-center justify-center z-10 rounded-lg">
                                        <Cpu className="w-12 h-12 animate-pulse text-blue-500" />
                                        <p className="mt-4 text-lg font-semibold">Procesando PDF con IA...</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">Esto puede tardar unos segundos.</p>
                                    </div>
                                )}
                                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
                                  <h2 className="text-xl sm:text-2xl font-bold">Limpiador de Artículos</h2>
                                  <div className="flex flex-wrap gap-3">
                                      <button onClick={() => txtFileInputRef.current?.click()} disabled={isProcessingPdf} className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-semibold rounded-lg transition disabled:opacity-50"> <Upload className="w-5 h-5" />Subir TXT </button>
                                      <input ref={txtFileInputRef} type="file" accept=".txt" onChange={handleTxtFileUpload} className="hidden" />
                                      
                                      <button onClick={() => pdfFileInputRef.current?.click()} disabled={isProcessingPdf || !apiKey} className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:bg-gray-400 dark:disabled:bg-gray-500 disabled:cursor-not-allowed" title={!apiKey ? "Se necesita una clave de API" : ""}> <Cpu className="w-5 h-5" />Procesar PDF (IA) </button>
                                      <input ref={pdfFileInputRef} type="file" accept=".pdf" onChange={handlePdfFileUpload} className="hidden" />

                                      <button onClick={() => setShowSettings(!showSettings)} disabled={isProcessingPdf} className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-semibold rounded-lg transition disabled:opacity-50"> <SettingsIcon className="w-5 h-5" /> Opciones </button>
                                  </div>
                                </div>
                                {showSettings && (
                                  <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border dark:border-gray-600">
                                      <h3 className="font-semibold mb-3">Opciones de limpieza manual:</h3>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                          {SETTINGS_OPTIONS.map(({ key, label }) => (
                                              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                                                  <input type="checkbox" checked={settings[key]} onChange={() => toggleSetting(key)} className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800" />
                                                  {label}
                                              </label>
                                          ))}
                                      </div>
                                  </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label htmlFor="input-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Texto Original</label>
                                        <textarea id="input-text" value={inputText} onChange={e => setInputText(e.target.value)} rows={15} className="w-full p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Pega aquí el texto del artículo o sube un archivo..."></textarea>
                                        <div className="mt-3 flex gap-3">
                                            <button onClick={handleClean} disabled={isProcessingPdf || !inputText} className="flex-1 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400">Limpiar (Manual)</button>
                                            <button onClick={() => { setInputText(''); setCleanedText(''); }} disabled={isProcessingPdf} className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 font-semibold rounded-lg">Borrar Todo</button>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label htmlFor="cleaned-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Texto Limpio ({wordCount} palabras)</label>
                                            <div className="flex gap-2">
                                                <button onClick={handleCopy} disabled={!cleanedText} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">Copiar</button>
                                                <button onClick={handleDownload} disabled={!cleanedText} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">Descargar</button>
                                            </div>
                                        </div>
                                        <textarea id="cleaned-text" value={cleanedText} onChange={e => setCleanedText(e.target.value)} rows={15} className="w-full p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500" placeholder="El texto procesado aparecerá aquí..."></textarea>
                                        <button onClick={handleSendToTTS} disabled={!cleanedText} className="mt-3 w-full px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400">Enviar a Lector TTS-RSVP</button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                           <div className="flex flex-col lg:flex-row gap-8">
                                <div className="flex-grow space-y-6">
                                    <RsvpViewer word={currentWord} nextWord={nextWord} previousWord={previousWord} statusMessage={!ttsText ? 'Envié texto para comenzar' : !isAudioReady ? 'Procese el audio para comenzar' : ''} />
                                    
                                    {!isAudioReady ? (
                                        <textarea 
                                            value={ttsText} 
                                            onChange={e => setTtsText(e.target.value)}
                                            rows={12} 
                                            className="w-full p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="El texto para leer aparecerá aquí. Edítelo si es necesario antes de procesar."
                                        />
                                    ) : (
                                        <HighlightedTextView 
                                            words={words}
                                            currentWordIndex={currentWordIndex}
                                            onWordClick={handleWordClick}
                                            isPlaybackActive={playbackState === 'playing'}
                                        />
                                    )}

                                    <PlaybackProgress wpm={wpm} current={currentWordIndex} total={words.length} />
                                </div>
                                <div className="lg:w-80 xl:w-96 flex-shrink-0">
                                   <ControlsPanel />
                                </div>
                           </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default MedicalTTSApp;
