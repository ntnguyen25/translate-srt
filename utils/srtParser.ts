import { SubtitleBlock } from '../types';

// SRT Functions
export const parseSRT = (data: string): SubtitleBlock[] => {
  // Normalize line endings
  const normalizedData = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalizedData.split('\n\n');
  
  const subtitles: SubtitleBlock[] = [];

  blocks.forEach(block => {
    const lines = block.split('\n').filter(line => line.trim() !== '');
    if (lines.length >= 3) {
      // Line 1: ID
      const id = parseInt(lines[0], 10);
      
      // Line 2: Timecodes
      const timecodeLine = lines[1];
      const [startTime, endTime] = timecodeLine.split(' --> ');
      
      // Line 3+: Text
      const text = lines.slice(2).join('\n');

      if (!isNaN(id) && startTime && endTime) {
        subtitles.push({
          id,
          startTime: startTime.trim(),
          endTime: endTime.trim(),
          text
        });
      }
    }
  });

  return subtitles;
};

export const generateSRT = (subtitles: SubtitleBlock[]): string => {
  return subtitles.map(sub => {
    return `${sub.id}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}`;
  }).join('\n\n');
};

export const renumberSubtitles = (subtitles: SubtitleBlock[], startNumber: number = 1): SubtitleBlock[] => {
  return subtitles.map((sub, index) => ({
    ...sub,
    id: startNumber + index
  }));
};

// ASS Functions

export type AssLine = string | { blockIndex: number, prefix: string };

export interface AssMeta {
  lines: AssLine[];
}

export const parseASS = (data: string): { blocks: SubtitleBlock[], meta: AssMeta } => {
  const lines = data.split(/\r?\n/);
  const blocks: SubtitleBlock[] = [];
  const metaLines: AssLine[] = [];
  
  let inEvents = false;
  let textIndex = -1; // Default usually 9 (10th field)
  let startIndex = -1; // Default usually 1
  let endIndex = -1; // Default usually 2

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '[Events]') {
      inEvents = true;
      metaLines.push(line);
      continue;
    }

    if (inEvents && line.startsWith('Format:')) {
      // Parse Format line to find where Text, Start, End are
      // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const parts = line.substring(7).split(',').map(s => s.trim());
      textIndex = parts.indexOf('Text');
      startIndex = parts.indexOf('Start');
      endIndex = parts.indexOf('End');
      metaLines.push(line);
      continue;
    }

    if (inEvents && line.startsWith('Dialogue:')) {
       // Fallback defaults if Format line was missing or weird
       if (textIndex === -1) {
         textIndex = 9; 
         startIndex = 1;
         endIndex = 2;
       }

       // We need to split by comma, but the Text field itself can contain commas.
       // So we find the Nth comma (where N = textIndex) and split there.
       let commaCount = 0;
       let splitIdx = -1;
       
       for (let c = 0; c < line.length; c++) {
         if (line[c] === ',') {
           commaCount++;
           if (commaCount === textIndex) {
             splitIdx = c;
             break;
           }
         }
       }

       if (splitIdx !== -1) {
         const prefix = line.substring(0, splitIdx + 1); // Includes the comma
         const text = line.substring(splitIdx + 1);
         
         // Extract timestamps for UI
         const prefixParts = prefix.split(',');
         const start = prefixParts[startIndex]?.trim() || '0:00:00.00';
         const end = prefixParts[endIndex]?.trim() || '0:00:00.00';

         blocks.push({
           id: blocks.length + 1, // ASS doesn't use IDs, but UI needs them
           startTime: start,
           endTime: end,
           text: text
         });

         metaLines.push({
           blockIndex: blocks.length - 1,
           prefix
         });
       } else {
         // Could not parse dialogue line correctly, treat as raw line
         metaLines.push(line);
       }
    } else {
      metaLines.push(line);
    }
  }

  return { blocks, meta: { lines: metaLines } };
};

export const generateASS = (blocks: SubtitleBlock[], meta: AssMeta): string => {
  return meta.lines.map(line => {
    if (typeof line === 'string') {
      return line;
    } else {
      const block = blocks[line.blockIndex];
      // If block is missing (shouldn't happen in translation flow), returns empty string
      return block ? `${line.prefix}${block.text}` : '';
    }
  }).join('\n');
};