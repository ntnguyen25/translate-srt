import React, { useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';

interface FileUploaderProps {
  onFileLoaded: (content: string, fileName: string) => void;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFileLoaded }) => {
  const handleFile = (file: File) => {
    if (file && (file.name.endsWith('.srt') || file.name.endsWith('.ass'))) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        onFileLoaded(content, file.name);
      };
      reader.readAsText(file);
    } else {
      alert('Please upload a valid .srt or .ass file');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div 
      className="w-full max-w-2xl mx-auto mb-8"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-700 border-dashed rounded-2xl cursor-pointer bg-slate-900 hover:bg-slate-850 transition-all group">
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <div className="bg-slate-800 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300 shadow-lg shadow-primary-500/10">
            <Upload className="w-8 h-8 text-primary-400" />
          </div>
          <p className="mb-2 text-lg text-slate-200 font-medium">
            <span className="font-semibold text-primary-400">Click to upload</span> or drag and drop
          </p>
          <p className="text-sm text-slate-400">SRT or ASS files</p>
        </div>
        <input 
          type="file" 
          className="hidden" 
          accept=".srt,.ass" 
          onChange={handleChange}
        />
      </label>
    </div>
  );
};

export default FileUploader;