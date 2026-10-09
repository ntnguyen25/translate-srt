
import React, { useState } from 'react';
import { FileText, ArrowRight, Download, RefreshCw, Globe, CheckCircle2, AlertCircle, Zap, Cpu, Loader2, ListOrdered, X, Users, Sparkles, Plus, Trash2, Edit3, ChevronDown, ChevronUp, BookOpen, KeyRound, Eye, EyeOff, ShieldCheck, ExternalLink, Cloud, Check } from 'lucide-react';
import FileUploader from './components/FileUploader';
import { parseSRT, generateSRT, renumberSubtitles, parseASS, generateASS, AssMeta } from './utils/srtParser';
import { translateBatch, analyzeSubtitleContext, getStoredApiKey, setStoredApiKey, getEffectiveApiKey, hasAvailableApiKey, hasEnvApiKey, testGeminiApiKey } from './services/geminiService';
import { SubtitleBlock, SubtitleItem, LANGUAGES, TranslationStatus, MODELS, ModelOption, CharacterAnalysis, RelationshipRule } from './types';

// How many subtitles to send to Gemini at once (25 ensures 100% 1-to-1 block and timing accuracy)
const BATCH_SIZE = 25;

const App: React.FC = () => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'srt' | 'ass'>('srt');
  const [assMeta, setAssMeta] = useState<AssMeta | null>(null);

  const [originalSubtitles, setOriginalSubtitles] = useState<SubtitleBlock[]>([]);
  const [translatedSubtitles, setTranslatedSubtitles] = useState<SubtitleBlock[]>([]);
  
  const [sourceLang, setSourceLang] = useState<string>('auto');
  const [targetLang, setTargetLang] = useState<string>('vi');
  const [selectedModel, setSelectedModel] = useState<string>(MODELS[0].id);
  
  const [status, setStatus] = useState<TranslationStatus>(TranslationStatus.IDLE);
  const [progress, setProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  // API Key & Cloudflare State
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => getStoredApiKey());
  const [showKeySecret, setShowKeySecret] = useState<boolean>(false);
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [keySaveMessage, setKeySaveMessage] = useState<string | null>(null);
  const [hasValidKey, setHasValidKey] = useState<boolean>(() => hasAvailableApiKey());

  // Dialogue Context & Relationship Analysis State
  const [enableContextAnalysis, setEnableContextAnalysis] = useState<boolean>(true);
  const [characterAnalysis, setCharacterAnalysis] = useState<CharacterAnalysis | null>(null);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState<boolean>(false);

  // New relationship input state
  const [newSpeaker, setNewSpeaker] = useState('');
  const [newListener, setNewListener] = useState('');
  const [newPronounSpeaker, setNewPronounSpeaker] = useState('');
  const [newPronounListener, setNewPronounListener] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Renumbering State
  const [showRenumberModal, setShowRenumberModal] = useState(false);
  const [renumberStart, setRenumberStart] = useState<number>(1);

  const handleFileLoaded = (content: string, name: string) => {
    try {
      setStatus(TranslationStatus.PARSING);
      setErrorMsg(null);
      
      let parsed: SubtitleBlock[] = [];
      
      if (name.toLowerCase().endsWith('.ass')) {
        const result = parseASS(content);
        parsed = result.blocks;
        setAssMeta(result.meta);
        setFileType('ass');
      } else {
        parsed = parseSRT(content);
        setFileType('srt');
        setAssMeta(null);
      }

      if (parsed.length === 0) {
        throw new Error("No valid subtitles found in file.");
      }
      setOriginalSubtitles(parsed);
      setFileName(name);
      setTranslatedSubtitles([]); // Reset previous translations
      setCharacterAnalysis(null); // Clear previous analysis for new file
      setShowAnalysisPanel(false);
      setStatus(TranslationStatus.IDLE);
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to parse subtitle file. Please check the format.");
      setStatus(TranslationStatus.ERROR);
    }
  };

  const handleTranslate = async () => {
    if (originalSubtitles.length === 0) return;
    
    setErrorMsg(null);
    setRetryCount(0);

    let activeAnalysis = characterAnalysis;

    // Step 1: Analyze context and relationships if enabled & not analyzed yet
    if (enableContextAnalysis && !activeAnalysis) {
      setStatus(TranslationStatus.ANALYZING);
      try {
        activeAnalysis = await analyzeSubtitleContext(
          originalSubtitles,
          sourceLang,
          targetLang,
          selectedModel
        );
        setCharacterAnalysis(activeAnalysis);
        setShowAnalysisPanel(true);
      } catch (err: any) {
        console.warn("Context analysis failed, proceeding with translation:", err);
      }
    }

    setStatus(TranslationStatus.TRANSLATING);

    // Initialize with exact clones of original blocks so all IDs and timestamps are 100% locked
    let currentTranslations: SubtitleBlock[] = translatedSubtitles.length === originalSubtitles.length
        ? [...translatedSubtitles] 
        : originalSubtitles.map(orig => ({
            id: orig.id,
            startTime: orig.startTime,
            endTime: orig.endTime,
            text: orig.text
          }));

    try {
      for (let i = 0; i < originalSubtitles.length; i += BATCH_SIZE) {
        const batch = originalSubtitles.slice(i, i + BATCH_SIZE);
        
        // Check if all blocks in this batch are already translated (true resume check)
        const isBatchTranslated = translatedSubtitles.length === originalSubtitles.length && batch.every((block, idx) => {
            const globalIndex = i + idx;
            const t = translatedSubtitles[globalIndex];
            return t && t.text && t.text !== block.text && t.text.trim() !== '';
        });

        if (isBatchTranslated) {
            setProgress(Math.round(((i + batch.length) / originalSubtitles.length) * 100));
            continue;
        }

        const itemsToTranslate: SubtitleItem[] = batch.map(b => ({
          id: b.id,
          text: b.text
        }));
        
        const translatedMap = await translateBatch(
          itemsToTranslate, 
          sourceLang, 
          targetLang, 
          selectedModel,
          (attempt, delayMs) => {
            // Update UI to show retry status
            setStatus(TranslationStatus.RETRYING);
            setRetryCount(attempt);
          },
          activeAnalysis
        );
        
        // Reset status back to translating if it was retrying
        setStatus(TranslationStatus.TRANSLATING);
        setRetryCount(0);

        // Update each block strictly matching its ID to ensure 100% timing and block accuracy
        batch.forEach((block, idx) => {
            const globalIndex = i + idx;
            const orig = originalSubtitles[globalIndex];
            const translatedText = translatedMap.get(block.id);

            currentTranslations[globalIndex] = {
                id: orig.id,
                startTime: orig.startTime,
                endTime: orig.endTime,
                text: (translatedText !== undefined && translatedText.trim() !== '')
                      ? translatedText
                      : block.text // Fallback to original if missing
            };
        });

        setTranslatedSubtitles([...currentTranslations]);
        setProgress(Math.round(((i + batch.length) / originalSubtitles.length) * 100));
      }
      
      setStatus(TranslationStatus.COMPLETED);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "An error occurred during translation. Try switching models if quota is exceeded.");
      setStatus(TranslationStatus.ERROR);
    }
  };

  const handleRunAnalysisOnly = async () => {
    if (originalSubtitles.length === 0) return;
    setStatus(TranslationStatus.ANALYZING);
    setErrorMsg(null);
    try {
      const res = await analyzeSubtitleContext(
        originalSubtitles,
        sourceLang,
        targetLang,
        selectedModel
      );
      setCharacterAnalysis(res);
      setShowAnalysisPanel(true);
      setStatus(TranslationStatus.IDLE);
    } catch (e: any) {
      console.error(e);
      setErrorMsg("Không thể phân tích ngữ cảnh. Vui lòng thử lại.");
      setStatus(TranslationStatus.ERROR);
    }
  };

  const handleAddRelationship = () => {
    if (!newSpeaker || !newListener) return;
    const updatedRules: RelationshipRule[] = [
      ...(characterAnalysis?.relationships || []),
      {
        speaker: newSpeaker,
        listener: newListener,
        pronounSpeaker: newPronounSpeaker || 'Tôi',
        pronounListener: newPronounListener || 'Bạn',
        notes: newNotes
      }
    ];

    setCharacterAnalysis(prev => prev ? {
      ...prev,
      relationships: updatedRules
    } : {
      summary: "Người dùng tự định nghĩa mối quan hệ.",
      tone: "Thường nhật",
      relationships: updatedRules,
      customGuidelines: ""
    });

    setNewSpeaker('');
    setNewListener('');
    setNewPronounSpeaker('');
    setNewPronounListener('');
    setNewNotes('');
  };

  const handleDeleteRelationship = (index: number) => {
    if (!characterAnalysis) return;
    const updated = characterAnalysis.relationships.filter((_, idx) => idx !== index);
    setCharacterAnalysis({
      ...characterAnalysis,
      relationships: updated
    });
  };

  const handleRenumber = () => {
    if (originalSubtitles.length === 0) return;

    const newOriginals = renumberSubtitles(originalSubtitles, renumberStart);
    setOriginalSubtitles(newOriginals);

    if (translatedSubtitles.length > 0) {
      const newTranslated = renumberSubtitles(translatedSubtitles, renumberStart);
      setTranslatedSubtitles(newTranslated);
    }

    setShowRenumberModal(false);
  };

  const handleDownload = () => {
    const subtitlesToSave = translatedSubtitles.length > 0 ? translatedSubtitles : originalSubtitles;
    let content = '';
    let ext = '';

    if (fileType === 'ass' && assMeta) {
        content = generateASS(subtitlesToSave, assMeta);
        ext = '.ass';
    } else {
        content = generateSRT(subtitlesToSave);
        ext = '.srt';
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const originalName = fileName || 'subtitles';
    const nameWithoutExt = originalName.lastIndexOf('.') !== -1 
        ? originalName.substring(0, originalName.lastIndexOf('.')) 
        : originalName;
        
    const newName = `${nameWithoutExt}_${targetLang}${ext}`;
    
    link.href = url;
    link.download = newName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFileName(null);
    setFileType('srt');
    setAssMeta(null);
    setOriginalSubtitles([]);
    setTranslatedSubtitles([]);
    setCharacterAnalysis(null);
    setShowAnalysisPanel(false);
    setStatus(TranslationStatus.IDLE);
    setProgress(0);
    setErrorMsg(null);
  };

  const handleSaveApiKey = () => {
    setStoredApiKey(apiKeyInput);
    setHasValidKey(hasAvailableApiKey());
    setKeySaveMessage("Đã lưu API Key thành công vào trình duyệt!");
    setTimeout(() => setKeySaveMessage(null), 3000);
  };

  const handleClearApiKey = () => {
    setStoredApiKey('');
    setApiKeyInput('');
    setHasValidKey(hasAvailableApiKey());
    setKeySaveMessage("Đã xóa API Key tùy chỉnh.");
    setTimeout(() => setKeySaveMessage(null), 3000);
  };

  const handleTestKey = async () => {
    setIsTestingKey(true);
    setTestResult(null);
    try {
      const res = await testGeminiApiKey(apiKeyInput.trim() || undefined);
      setTestResult(res);
      if (res.success) {
        setHasValidKey(true);
      }
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || 'Lỗi kiểm tra API Key' });
    } finally {
      setIsTestingKey(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-20 relative">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              SubStream AI
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setApiKeyInput(getStoredApiKey());
                setTestResult(null);
                setKeySaveMessage(null);
                setShowApiKeyModal(true);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                hasValidKey
                  ? 'bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-400'
                  : 'bg-amber-950/60 border-amber-500/50 text-amber-300 hover:bg-amber-900/60 animate-pulse'
              }`}
              title="Cài đặt khóa API Gemini cho Cloudflare / Cá nhân"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {hasValidKey ? 'API Key: Đã sẵn sàng' : 'Cần nhập API Key'}
              </span>
              <span className={`w-2 h-2 rounded-full ${hasValidKey ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            </button>
            <div className="text-sm text-slate-500 font-medium hidden md:block">
              Phân tích xưng hô & Dịch phụ đề thông minh
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        
        {/* Hero / Intro */}
        {status === TranslationStatus.IDLE && !fileName && (
          <div className="text-center max-w-2xl mx-auto mb-12 mt-8">
            <h2 className="text-4xl font-bold text-white mb-4 tracking-tight">
              Phân tích thoại & Dịch phụ đề chuẩn xưng hô
            </h2>
            <p className="text-slate-400 text-lg mb-8">
              Tự động phân tích bối cảnh, giới tính nhân vật và mối quan hệ nam nữ trước khi dịch để đảm bảo đại từ xưng hô luôn chuẩn xác và đồng nhất.
            </p>
          </div>
        )}

        {/* Upload Section */}
        {!fileName && <FileUploader onFileLoaded={handleFileLoaded} />}

        {/* Main Workspace */}
        {fileName && (
          <div className="animate-fade-in space-y-6">
            {/* Toolbar */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col xl:flex-row items-center justify-between gap-4 shadow-xl">
              
              {/* File Info */}
              <div className="flex items-center gap-3 w-full xl:w-auto overflow-hidden">
                <div className="bg-slate-800 p-2 rounded-lg min-w-fit">
                   <FileText className="text-primary-400 w-5 h-5" />
                </div>
                <div className="flex flex-col overflow-hidden">
                    <span className="font-mono text-sm text-slate-300 truncate max-w-[150px]" title={fileName}>
                    {fileName}
                    </span>
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">{fileType} FILE</span>
                </div>
                <span className="text-xs px-2 py-1 bg-slate-800 rounded-full text-slate-400 whitespace-nowrap ml-2">
                  {originalSubtitles.length} dòng
                </span>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-center">
                
                {/* Model Selector */}
                <div className="relative group">
                  <div className="absolute left-3 top-2.5 z-10 text-slate-500">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={status === TranslationStatus.TRANSLATING || status === TranslationStatus.RETRYING || status === TranslationStatus.ANALYZING}
                    className="appearance-none bg-slate-950 border border-slate-700 text-white py-2 pl-10 pr-10 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none disabled:opacity-50 hover:border-slate-600 transition-colors w-48 cursor-pointer"
                  >
                    {MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500">
                    <ArrowRight className="w-3 h-3 rotate-90" />
                  </div>
                </div>

                <div className="h-8 w-px bg-slate-800 hidden md:block"></div>

                {/* Source Lang */}
                <div className="relative group">
                  <select 
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    disabled={status === TranslationStatus.TRANSLATING || status === TranslationStatus.RETRYING || status === TranslationStatus.ANALYZING}
                    className="appearance-none bg-slate-950 border border-slate-700 text-white py-2 pl-4 pr-10 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none disabled:opacity-50 hover:border-slate-600 transition-colors w-32 cursor-pointer"
                  >
                    <option value="auto">Auto Detect</option>
                    {LANGUAGES.map(l => <option key={`source-${l.code}`} value={l.name}>{l.name}</option>)}
                  </select>
                  <Globe className="absolute right-3 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>

                <ArrowRight className="text-slate-600 w-4 h-4" />

                {/* Target Lang */}
                <div className="relative">
                  <select 
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    disabled={status === TranslationStatus.TRANSLATING || status === TranslationStatus.RETRYING || status === TranslationStatus.ANALYZING}
                    className="appearance-none bg-slate-950 border border-slate-700 text-white py-2 pl-4 pr-10 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none disabled:opacity-50 hover:border-slate-600 transition-colors w-32 cursor-pointer"
                  >
                    {LANGUAGES.map(l => <option key={`target-${l.code}`} value={l.code}>{l.name}</option>)}
                  </select>
                  <Globe className="absolute right-3 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>

                {/* Pre-analysis toggle */}
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors">
                  <input 
                    type="checkbox"
                    checked={enableContextAnalysis}
                    onChange={(e) => setEnableContextAnalysis(e.target.checked)}
                    disabled={status === TranslationStatus.TRANSLATING || status === TranslationStatus.RETRYING || status === TranslationStatus.ANALYZING}
                    className="rounded border-slate-700 text-primary-600 focus:ring-primary-500 bg-slate-900"
                  />
                  <span>Phân tích xưng hô nam nữ</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 w-full xl:w-auto">
                {(status === TranslationStatus.IDLE || status === TranslationStatus.COMPLETED || status === TranslationStatus.ERROR) ? (
                  <>
                    <button 
                      onClick={() => setShowAnalysisPanel(!showAnalysisPanel)}
                      className={`px-3 py-2 rounded-lg font-medium text-xs transition-all flex items-center gap-1.5 border ${
                        characterAnalysis 
                          ? 'bg-purple-950/60 border-purple-500/40 text-purple-300 hover:bg-purple-900/60' 
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                      title="Xem & chỉnh sửa bảng quy tắc xưng hô"
                    >
                      <Users className="w-4 h-4 text-purple-400" />
                      <span>Xưng hô</span>
                      {characterAnalysis && (
                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse ml-0.5"></span>
                      )}
                      {showAnalysisPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {status !== TranslationStatus.COMPLETED && (
                      <button 
                        onClick={handleTranslate}
                        className="flex-1 xl:flex-none bg-primary-600 hover:bg-primary-500 text-white px-5 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-900/20 text-sm"
                      >
                        <RefreshCw className="w-4 h-4" />
                        {translatedSubtitles.length > 0 ? 'Dịch tiếp' : 'Bắt đầu Dịch'}
                      </button>
                    )}
                    
                    <button 
                      onClick={handleDownload}
                      className="flex-1 xl:flex-none bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 text-sm"
                      title="Tải phụ đề xuống"
                    >
                      <Download className="w-4 h-4" />
                      Tải File
                    </button>
                    
                    <button 
                      onClick={() => setShowRenumberModal(true)}
                      className="px-2.5 py-2 text-slate-400 hover:text-white transition-colors"
                      title="Đánh lại số thứ tự"
                    >
                      <ListOrdered className="w-5 h-5" />
                    </button>

                    <button 
                      onClick={reset}
                      className="px-2.5 py-2 text-slate-400 hover:text-white transition-colors text-sm"
                      title="Làm mới"
                    >
                      Reset
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 xl:flex-none px-6 py-2 flex items-center gap-3 bg-slate-800 rounded-lg border border-slate-700">
                      {status === TranslationStatus.ANALYZING ? (
                        <>
                          <Sparkles className="w-4 h-4 text-purple-400 animate-spin" />
                          <span className="text-sm text-purple-300 font-medium">Phân tích thoại & xưng hô...</span>
                        </>
                      ) : status === TranslationStatus.RETRYING ? (
                        <>
                           <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                           <span className="text-sm text-amber-400 font-medium">Thử lại ({retryCount})...</span>
                        </>
                      ) : (
                        <>
                          <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-sm text-slate-300 font-medium">Đang dịch...</span>
                        </>
                      )}
                    </div>
                    <button 
                      onClick={handleDownload}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white p-2.5 rounded-lg font-medium transition-all flex items-center justify-center shadow-lg shadow-emerald-900/20"
                      title="Tải phụ đề đã dịch"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Context & Relationship Analysis Panel */}
            {showAnalysisPanel && (
              <div className="bg-slate-900 rounded-xl border border-purple-500/30 p-5 shadow-2xl space-y-4 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
                      <Users className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white flex items-center gap-2">
                        Bảng phân tích mối quan hệ & Đại từ xưng hô
                        {characterAnalysis && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            Đã sẵn sàng
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Hệ thống phân tích thoại kịch bản để cố định cách xưng hô (anh - em, tôi - cậu,...) nhất quán trong suốt bộ phim.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRunAnalysisOnly}
                      disabled={status === TranslationStatus.ANALYZING || status === TranslationStatus.TRANSLATING}
                      className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shadow-md shadow-purple-900/30 disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {characterAnalysis ? 'Phân tích lại thoại' : 'Chạy Phân Tích Mới'}
                    </button>
                  </div>
                </div>

                {characterAnalysis ? (
                  <div className="space-y-4 text-sm">
                    {/* Summary & Tone */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800">
                        <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider block mb-1">
                          Bối cảnh & Cốt truyện
                        </span>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          {characterAnalysis.summary || "Đang phân tích..."}
                        </p>
                      </div>

                      <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800">
                        <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider block mb-1">
                          Giọng điệu & Phong cách thoại
                        </span>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          {characterAnalysis.tone || "Tự nhiên / Thường nhật"}
                        </p>
                      </div>
                    </div>

                    {/* Relationship Table */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-primary-400" />
                        Quy tắc xưng hô giữa các nhân vật
                      </h4>
                      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
                        <table className="w-full text-left text-xs text-slate-300">
                          <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="py-2.5 px-3">Người nói (Speaker)</th>
                              <th className="py-2.5 px-3">Người nghe (Listener)</th>
                              <th className="py-2.5 px-3">Tự xưng</th>
                              <th className="py-2.5 px-3">Gọi đối phương</th>
                              <th className="py-2.5 px-3">Ghi chú ngữ cảnh</th>
                              <th className="py-2.5 px-3 text-right">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {characterAnalysis.relationships.map((rel, idx) => (
                              <tr key={`rel-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                                <td className="py-2 px-3 font-medium text-purple-200">{rel.speaker}</td>
                                <td className="py-2 px-3 font-medium text-slate-300">{rel.listener}</td>
                                <td className="py-2 px-3">
                                  <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 font-mono">
                                    {rel.pronounSpeaker}
                                  </span>
                                </td>
                                <td className="py-2 px-3">
                                  <span className="px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/50 font-mono">
                                    {rel.pronounListener}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-slate-400 italic max-w-xs truncate">
                                  {rel.notes || '—'}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <button
                                    onClick={() => handleDeleteRelationship(idx)}
                                    className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                                    title="Xóa quy tắc này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}

                            {/* Add relationship form row */}
                            <tr className="bg-slate-950/80">
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  placeholder="Nhân vật A (Ví dụ: Nam chính)"
                                  value={newSpeaker}
                                  onChange={(e) => setNewSpeaker(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary-500"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  placeholder="Nhân vật B (Ví dụ: Nữ chính)"
                                  value={newListener}
                                  onChange={(e) => setNewListener(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary-500"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  placeholder="Xưng (Anh)"
                                  value={newPronounSpeaker}
                                  onChange={(e) => setNewPronounSpeaker(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary-500"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  placeholder="Gọi (Em)"
                                  value={newPronounListener}
                                  onChange={(e) => setNewPronounListener(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary-500"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  placeholder="Ghi chú"
                                  value={newNotes}
                                  onChange={(e) => setNewNotes(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary-500"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  onClick={handleAddRelationship}
                                  className="px-2.5 py-1 bg-primary-600 hover:bg-primary-500 text-white rounded text-xs font-medium flex items-center gap-1 ml-auto"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Thêm
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Custom Guidelines Textarea */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Hướng dẫn xưng hô bổ sung (Custom Pronoun Rules)
                      </label>
                      <textarea
                        value={characterAnalysis.customGuidelines}
                        onChange={(e) => setCharacterAnalysis({ ...characterAnalysis, customGuidelines: e.target.value })}
                        placeholder="Nhập ghi chú tùy chỉnh về cách xưng hô (ví dụ: 'Giữ cách gọi Anh - Em giữa Nam chính và Nữ chính, dùng Tôi - Cậu giữa nhân vật sếp và nhân viên')..."
                        className="w-full h-20 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:ring-1 focus:ring-purple-500 focus:outline-none leading-relaxed"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30 text-purple-400" />
                    <p>Chưa có dữ liệu phân tích. Hãy bấm "Bắt đầu Dịch" hoặc "Chạy Phân Tích Mới" để AI quét toàn bộ kịch bản.</p>
                  </div>
                )}
              </div>
            )}

            {/* Progress Bar */}
            {(status === TranslationStatus.TRANSLATING || status === TranslationStatus.RETRYING || status === TranslationStatus.ANALYZING || status === TranslationStatus.COMPLETED) && (
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden relative shadow-inner">
                <div 
                  className={`h-full transition-all duration-300 ease-out ${
                    status === TranslationStatus.ANALYZING 
                      ? 'bg-purple-500 animate-pulse' 
                      : status === TranslationStatus.RETRYING 
                      ? 'bg-amber-500' 
                      : 'bg-primary-500'
                  }`}
                  style={{ width: status === TranslationStatus.ANALYZING ? '100%' : `${progress}%` }}
                ></div>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center justify-between gap-3 text-sm flex-wrap">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                {errorMsg.toLowerCase().includes('api key') && (
                  <button
                    onClick={() => {
                      setApiKeyInput(getStoredApiKey());
                      setTestResult(null);
                      setShowApiKeyModal(true);
                    }}
                    className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    Cài đặt API Key ngay
                  </button>
                )}
              </div>
            )}

            {/* Comparison View */}
            <div className="grid md:grid-cols-2 gap-6 h-[600px]">
              {/* Original */}
              <div className="flex flex-col h-full">
                <h3 className="text-slate-400 font-medium mb-3 px-1 uppercase text-xs tracking-wider">Gốc (Original)</h3>
                <div className="bg-slate-900 rounded-xl border border-slate-800 flex-1 overflow-y-auto p-4 space-y-4">
                  {originalSubtitles.map((sub) => (
                    <div key={`orig-${sub.id}`} className="group hover:bg-slate-800/50 p-2 rounded-lg transition-colors">
                      <div className="flex justify-between text-xs text-slate-500 font-mono mb-1">
                        <span>#{sub.id}</span>
                        <span>{sub.startTime} - {sub.endTime}</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{sub.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Translated */}
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-primary-400 font-medium uppercase text-xs tracking-wider">Bản Dịch (Translated)</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        {MODELS.find(m => m.id === selectedModel)?.name}
                      </span>
                      {characterAnalysis && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/50 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                          Chuẩn xưng hô
                        </span>
                      )}
                    </div>
                    {status === TranslationStatus.COMPLETED && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Hoàn tất
                        </span>
                    )}
                </div>
                <div className="bg-slate-900 rounded-xl border border-slate-800 flex-1 overflow-y-auto p-4 space-y-4 relative">
                  {translatedSubtitles.length === 0 && status !== TranslationStatus.TRANSLATING && status !== TranslationStatus.RETRYING && status !== TranslationStatus.ANALYZING ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                        <Globe className="w-12 h-12 mb-3 opacity-20" />
                        <p className="text-sm">Bản dịch phụ đề sẽ xuất hiện ở đây</p>
                    </div>
                  ) : (
                    (translatedSubtitles.length > 0 ? translatedSubtitles : originalSubtitles).map((sub, idx) => (
                        <div key={`trans-${sub.id}`} className="group hover:bg-slate-800/50 p-2 rounded-lg transition-colors">
                            <div className="flex justify-between text-xs text-slate-500 font-mono mb-1">
                                <span>#{sub.id}</span>
                                <span>{sub.startTime} - {sub.endTime}</span>
                            </div>
                            <p className={`leading-relaxed whitespace-pre-wrap ${translatedSubtitles[idx] ? 'text-emerald-100' : 'text-slate-600 blur-[2px]'}`}>
                                {translatedSubtitles[idx] ? translatedSubtitles[idx].text : sub.text}
                            </p>
                        </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Renumber Modal */}
      {showRenumberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm shadow-2xl relative">
                <button 
                  onClick={() => setShowRenumberModal(false)}
                  className="absolute top-4 right-4 text-slate-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <ListOrdered className="w-5 h-5 text-primary-400" />
                    Đánh lại số thứ tự Phụ đề
                </h3>
                <div className="mb-6">
                    <label className="block text-sm text-slate-400 mb-2">Số bắt đầu</label>
                    <input 
                        type="number" 
                        value={renumberStart}
                        onChange={(e) => setRenumberStart(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                        min="0"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                        Hệ thống sẽ gắn lại số ID tuần tự cho tất cả khối phụ đề bắt đầu từ số trên.
                    </p>
                </div>
                <div className="flex justify-end gap-3">
                    <button 
                        onClick={() => setShowRenumberModal(false)}
                        className="px-4 py-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
                    >
                        Hủy
                    </button>
                    <button 
                        onClick={handleRenumber}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-medium shadow-lg shadow-primary-900/20"
                    >
                        Áp dụng
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Cloudflare & Gemini API Key Settings Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative">
            <button 
              onClick={() => setShowApiKeyModal(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-primary-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Cấu hình Gemini API Key</h3>
                <p className="text-xs text-slate-400">Hỗ trợ hoạt động khi deploy lên Cloudflare Pages & Web cá nhân</p>
              </div>
            </div>

            {/* Current Status */}
            <div className="mb-4 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Biến môi trường (Cloudflare/Build):</span>
                <span className={`font-mono px-2 py-0.5 rounded text-[11px] ${
                  hasEnvApiKey() 
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50' 
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {hasEnvApiKey() ? 'Đã thiết lập (GEMINI_API_KEY)' : 'Chưa thiết lập'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Khóa tùy chỉnh trong trình duyệt:</span>
                <span className={`font-mono px-2 py-0.5 rounded text-[11px] ${
                  getStoredApiKey() 
                    ? 'bg-sky-950 text-sky-300 border border-sky-800/50' 
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {getStoredApiKey() ? 'Đã lưu (localStorage)' : 'Trống'}
                </span>
              </div>
            </div>

            {/* Input field */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Google Gemini API Key
              </label>
              <div className="relative">
                <input
                  type={showKeySecret ? 'text' : 'password'}
                  placeholder="AIzaSy..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl pl-3 pr-10 py-2.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKeySecret(!showKeySecret)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showKeySecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Khóa được lưu cục bộ trên trình duyệt của bạn (localStorage), không bao giờ gửi ra máy chủ thứ ba.
              </p>
            </div>

            {/* Notification messages */}
            {keySaveMessage && (
              <div className="mb-4 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{keySaveMessage}</span>
              </div>
            )}

            {testResult && (
              <div className={`mb-4 p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}>
                {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Cloudflare Deploy Instructions Box */}
            <div className="mb-5 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 space-y-2">
              <div className="flex items-center gap-2 text-slate-200 font-semibold">
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>Cách deploy lên Cloudflare Pages</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 leading-relaxed">
                <li>Kết nối repository với <strong className="text-slate-300">Cloudflare Pages</strong>.</li>
                <li>Build command: <code className="bg-slate-900 px-1 py-0.5 rounded text-primary-300 font-mono">npm run build</code></li>
                <li>Output directory: <code className="bg-slate-900 px-1 py-0.5 rounded text-primary-300 font-mono">dist</code></li>
                <li>Cấu hình biến môi trường <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300 font-mono">GEMINI_API_KEY</code> trong <em>Settings &gt; Environment variables</em>.</li>
              </ol>
              <div className="pt-1">
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary-400 hover:text-primary-300 text-[11px] font-medium transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Lấy API Key miễn phí tại Google AI Studio
                </a>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                onClick={handleTestKey}
                disabled={isTestingKey}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isTestingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-primary-400" />}
                <span>{isTestingKey ? 'Đang kiểm tra...' : 'Kiểm tra API Key'}</span>
              </button>

              <div className="flex items-center gap-2">
                {getStoredApiKey() && (
                  <button
                    onClick={handleClearApiKey}
                    className="px-3 py-2 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors"
                  >
                    Xóa lưu trữ
                  </button>
                )}
                <button
                  onClick={handleSaveApiKey}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-medium shadow-lg shadow-primary-900/20 transition-colors"
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
