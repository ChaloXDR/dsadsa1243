import React, { useState, useEffect } from 'react';

interface RsvpViewerProps {
    word: string;
    nextWord: string;
    previousWord: string;
    className?: string;
    statusMessage?: string;
}

const RsvpViewer: React.FC<RsvpViewerProps> = ({ word, nextWord, previousWord, className, statusMessage }) => {
  const [focal, setFocal] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');

  useEffect(() => {
    if (!word) {
      setPrefix('');
      setFocal('');
      setSuffix('');
      return;
    }

    const len = word.length;
    let pivot = 1;
    if (len > 1) pivot = Math.floor(len * 0.25);
    if (len > 7) pivot = Math.floor(len * 0.35);
    if (pivot >= len) pivot = len - 1;
    if (pivot < 0) pivot = 0; // handle single letter words

    setPrefix(word.substring(0, pivot));
    setFocal(word[pivot]);
    setSuffix(word.substring(pivot + 1));
  }, [word]);

  if (statusMessage) {
    return (
        <div className={`relative w-full h-40 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4 font-mono select-none border border-gray-200 dark:border-gray-700 ${className}`}>
            <div className="text-xl md:text-2xl text-gray-500 dark:text-gray-400 animate-pulse">
                {statusMessage}
            </div>
        </div>
    );
  }

  return (
    <div className={`relative w-full h-40 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4 font-mono select-none border border-gray-200 dark:border-gray-700 ${className}`}>
      {/* Indicador focal (línea roja) */}
      <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-full bg-red-500/30 dark:bg-red-400/30" style={{ left: 'calc(50% + 0.25ch)' }}></div>
      
      {/* Palabra principal */}
      <div 
        className={`relative text-5xl md:text-7xl font-bold tracking-wider`}
        style={{ width: '20ch', textAlign: 'center' }}
      >
        <span className="text-gray-600 dark:text-gray-400" style={{ transform: `translateX(0.5ch)` }}>
          {prefix}
        </span>
        <span className="text-red-600 dark:text-red-500">{focal}</span>
        <span className="text-gray-600 dark:text-gray-400">{suffix}</span>
      </div>

      {/* Palabra Anterior (preview) */}
      <div 
        className={`absolute bottom-4 left-4 text-2xl text-gray-400 dark:text-gray-500 truncate max-w-[calc(50%-2rem)]`}
      >
        {previousWord}
      </div>

      {/* Siguiente palabra (preview) */}
      <div 
        className={`absolute bottom-4 right-4 text-2xl text-gray-400 dark:text-gray-500 truncate max-w-[calc(50%-2rem)] text-right`}
      >
        {nextWord}
      </div>
    </div>
  );
};

export default RsvpViewer;
