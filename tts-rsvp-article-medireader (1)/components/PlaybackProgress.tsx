import React from 'react';

interface PlaybackProgressProps {
    wpm: number;
    current: number;
    total: number;
}

const PlaybackProgress: React.FC<PlaybackProgressProps> = ({ wpm, current, total }) => {
  const progress = total > 0 ? (current / total) * 100 : 0;
  const wordsRemaining = total - current;
  const minutesRemaining = wpm > 0 ? Math.floor(wordsRemaining / wpm) : 0;
  const secondsRemaining = wpm > 0 ? Math.floor((wordsRemaining % wpm) * (60 / wpm)) : 0;

  const timeEstimate = total > 0 ? 
    `${minutesRemaining}m ${secondsRemaining.toString().padStart(2, '0')}s restantes` :
    '0m 00s restantes';

  return (
    <div className="my-4">
      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
        <span>Progreso de Lectura</span>
        <span className="font-medium">{timeEstimate}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all duration-150 ease-linear" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};

export default PlaybackProgress;