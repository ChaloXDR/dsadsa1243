import React, { useEffect, useRef, memo } from 'react';

interface HighlightedTextViewProps {
    words: string[];
    currentWordIndex: number;
    onWordClick: (index: number) => void;
    isPlaybackActive: boolean;
}

const HighlightedTextView: React.FC<HighlightedTextViewProps> = ({ words, currentWordIndex, onWordClick, isPlaybackActive }) => {
    const activeWordRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (activeWordRef.current) {
            activeWordRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentWordIndex]);
    
    const handleClick = (index: number) => {
      if (!isPlaybackActive) {
        onWordClick(index);
      }
    };

    return (
        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 text-lg leading-relaxed">
            {words.map((word, index) => {
                const isCurrent = index === currentWordIndex;
                return (
                    <span
                        key={index}
                        ref={isCurrent ? activeWordRef : null}
                        onClick={() => handleClick(index)}
                        className={`
                            ${isCurrent ? 'bg-blue-200 dark:bg-blue-800/60 rounded-md px-1' : ''}
                            ${!isPlaybackActive ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md' : ''}
                        `}
                    >
                        {word}{' '}
                    </span>
                );
            })}
        </div>
    );
};

export default memo(HighlightedTextView);
