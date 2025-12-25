import React, { useState, useEffect, useRef } from 'react';
import { AppState, TopicGraphData, PresentationData, VideoData, GraphNode } from './types';
import { analyzeChannelContent, generateRebuttal } from './services/geminiService';
import ForceGraph from './components/ForceGraph';
import PresentationView from './components/PresentationView';
import { DEFAULT_CHANNEL_URL } from './constants';
import { Search, Youtube, Activity, PlayCircle, BrainCircuit, AlertCircle, X, TextQuote, Upload, Download, Terminal, FileText } from 'lucide-react';
// @ts-ignore
import { parse, stringify } from 'smol-toml';

const App: React.FC = () => {
  const [url, setUrl] = useState(DEFAULT_CHANNEL_URL);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [graphData, setGraphData] = useState<TopicGraphData | null>(null);
  const [videoList, setVideoList] = useState<VideoData[]>([]);
  const [presentationData, setPresentationData] = useState<PresentationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress] = useState(0);
  
  // New features state
  const [logs, setLogs] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Modal State
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Auto-increment progress for smoother UX during long waits
  const progressIntervalRef = useRef<number | null>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
  };

  const startProgressSimulation = (startAt: number = 0, capAt: number = 90) => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setProgress(startAt);
    
    progressIntervalRef.current = window.setInterval(() => {
      setProgress(prev => {
        if (prev >= capAt) return prev;
        // Slow down as we get closer to cap
        const increment = Math.max(0.1, (capAt - prev) / 50); 
        return Math.min(capAt, prev + increment);
      });
    }, 200);
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    setAppState(AppState.ANALYZING);
    setError(null);
    setLogs([]);
    setStatusMsg("Initializing analysis...");
    addLog("Starting channel analysis sequence...");
    startProgressSimulation(0, 95);

    try {
      const { videos, graph } = await analyzeChannelContent(url, (msg, p) => {
        setStatusMsg(msg);
        addLog(msg);
        setProgress(p); 
        startProgressSimulation(p, 98); 
      });
      setVideoList(videos || []);
      setGraphData(graph);
      addLog("Analysis complete. Loading dashboard.");
      stopProgressSimulation();
      setProgress(100);
      setTimeout(() => setAppState(AppState.DASHBOARD), 500);
    } catch (err: any) {
      console.error(err);
      setError("Analysis failed. Please ensure the URL is valid and try again. Gemini might be overloaded.");
      addLog(`Error: ${err.message}`);
      stopProgressSimulation();
      setAppState(AppState.IDLE);
    }
  };

  const handleGeneratePresentation = async () => {
    if (!graphData || !videoList?.length) return;

    setAppState(AppState.GENERATING_SLIDES);
    setStatusMsg("Preparing presentation...");
    addLog("Initializing presentation generation module...");
    if (customInstructions) addLog(`Applied custom instructions: "${customInstructions.substring(0, 30)}..."`);
    startProgressSimulation(0, 90);

    try {
      const slides = await generateRebuttal(url, graphData.summary, videoList, customInstructions, (msg, p) => {
         setStatusMsg(msg);
         addLog(msg);
         setProgress(p);
         startProgressSimulation(p, 95);
      });
      setPresentationData(slides);
      addLog("Slides generated successfully.");
      stopProgressSimulation();
      setProgress(100);
      setTimeout(() => setAppState(AppState.PRESENTATION), 500);
    } catch (err: any) {
      console.error(err);
      setError("Failed to generate presentation. Please try again.");
      addLog(`Error: ${err.message}`);
      stopProgressSimulation();
      setAppState(AppState.DASHBOARD);
    }
  };

  const handleExport = () => {
    if (!graphData) return;
    try {
        // Sanitize data to remove undefined values which might break TOML stringify
        const cleanGraph = {
            ...graphData,
            nodes: graphData.nodes.map(node => ({
                id: node.id,
                group: node.group,
                relevance: node.relevance,
                popularity: node.popularity,
                desc: node.desc || "",
                longDescription: node.longDescription || ""
            })),
            // Explicitly map links to IDs to avoid circular structure objects from D3
            links: graphData.links.map(link => ({
                source: (link.source as any).id || link.source,
                target: (link.target as any).id || link.target,
                value: link.value
            }))
        };

        const exportData = {
            meta: {
                timestamp: new Date().toISOString(),
                url: url
            },
            videos: videoList,
            graph: cleanGraph
        };

        const tomlStr = stringify(exportData);
        const blob = new Blob([tomlStr], { type: 'application/toml' });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = `channel_dissector_${new Date().getTime()}.toml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(href);
    } catch (e) {
        console.error("Export failed", e);
        setError("Failed to export TOML data.");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAppState(AppState.ANALYZING);
    setStatusMsg("Parsing TOML file...");
    addLog("Reading import file...");
    setProgress(50);

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const text = event.target?.result as string;
            const data: any = parse(text);
            
            if (!data.graph || !data.videos) {
                throw new Error("Invalid TOML structure. Missing graph or videos.");
            }

            if (data.meta?.url) setUrl(data.meta.url);
            setGraphData(data.graph);
            setVideoList(data.videos);
            addLog("Import successful. Skiping scraping.");
            setProgress(100);
            
            // Go right to building the video (Dashboard for generation)
            setTimeout(() => setAppState(AppState.DASHBOARD), 800);
        } catch (err: any) {
            console.error("Import failed", err);
            setError("Failed to parse TOML file. " + err.message);
            setAppState(AppState.IDLE);
        }
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const reset = () => {
    setAppState(AppState.IDLE);
    setGraphData(null);
    setVideoList([]);
    setPresentationData(null);
    setError(null);
    setLogs([]);
    stopProgressSimulation();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Loading Overlay with Progress Bar & Console */}
      {(appState === AppState.ANALYZING || appState === AppState.GENERATING_SLIDES) && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-lg space-y-6 text-center">
            <h2 className="text-2xl font-bold text-white tracking-tight animate-pulse">
              {appState === AppState.ANALYZING ? 'Deconstructing Channel' : 'Synthesizing Rebuttal'}
            </h2>
            
            {/* Custom Progress Bar */}
            <div className="relative w-full h-8 bg-zinc-800/50 rounded-full border border-zinc-700/50 overflow-hidden shadow-inner">
               <div 
                 className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-emerald-500 transition-all duration-300 ease-linear shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                 style={{ width: `${progress}%` }}
               />
               <div className="absolute inset-0 flex items-center justify-center z-10">
                 <span className="text-xs font-bold text-white uppercase tracking-wider drop-shadow-md px-2 truncate">
                   {statusMsg}
                 </span>
               </div>
               <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12 translate-x-[-100%] animate-shimmer" />
            </div>

            <div className="flex justify-between text-xs text-zinc-500 font-mono px-1">
               <span>{Math.round(progress)}%</span>
               <span>GEMINI 2.0 PROCESSING</span>
            </div>

            {/* Scrolling Console Panel */}
            <div className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-xs text-left shadow-2xl h-48 flex flex-col">
                <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 mb-2 text-zinc-500 uppercase tracking-widest text-[10px]">
                    <Terminal className="w-3 h-3" /> System Buffer
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-zinc-700">
                    {logs.map((log, i) => (
                        <div key={i} className="text-zinc-400 break-words">
                            <span className="text-blue-900/50 mr-2">➜</span>{log}
                        </div>
                    ))}
                    {logs.length === 0 && <span className="text-zinc-700 italic">Waiting for process start...</span>}
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Node Detail Modal */}
      {selectedNode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelectedNode(null)}>
           <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl scale-100" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                     <span className={`text-xs font-bold px-2 py-1 rounded border mb-2 inline-block ${
                       selectedNode.group === 1 ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : 
                       selectedNode.group === 2 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : 
                       "bg-purple-500/20 text-purple-400 border-purple-500/30"
                     }`}>
                       {selectedNode.group === 1 ? "CORE THEME" : selectedNode.group === 2 ? "MAJOR CONCEPT" : "SPECIFIC ARGUMENT"}
                     </span>
                     <h2 className="text-2xl font-bold text-white">{selectedNode.id}</h2>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
                    <p className="text-zinc-300 leading-relaxed text-sm">
                      {selectedNode.longDescription || selectedNode.desc || "No detailed analysis available for this node."}
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-zinc-800/30 rounded border border-zinc-800">
                      <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Relevance Score</div>
                      <div className="flex items-end gap-2">
                        <span className="text-2xl font-mono font-bold text-blue-400">{selectedNode.relevance || 5}</span>
                        <span className="text-xs text-zinc-500 mb-1">/ 10</span>
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-800/30 rounded border border-zinc-800">
                      <div className="text-xs text-zinc-500 uppercase font-bold mb-1">Popularity Score</div>
                      <div className="flex items-end gap-2">
                        <span className="text-2xl font-mono font-bold text-green-400">{selectedNode.popularity || 5}</span>
                        <span className="text-xs text-zinc-500 mb-1">/ 10</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-zinc-500 flex items-center gap-2 pt-2">
                    <TextQuote className="w-3 h-3" />
                    <span>Data inferred from channel content search analysis</span>
                  </div>
                </div>
              </div>
              <div className="bg-zinc-950 p-4 border-t border-zinc-800 flex justify-end">
                <button 
                  onClick={() => setSelectedNode(null)}
                  className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-semibold rounded text-sm transition-colors"
                >
                  Close Analysis
                </button>
              </div>
           </div>
        </div>
      )}

      {/* Presentation Mode */}
      {appState === AppState.PRESENTATION && presentationData && (
        <PresentationView 
          data={presentationData} 
          onClose={() => setAppState(AppState.DASHBOARD)} 
        />
      )}

      {/* Navbar */}
      <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
            <Activity className="w-6 h-6 text-blue-500" />
            <span className="font-bold text-lg tracking-tight">Channel<span className="text-blue-500">Dissector</span></span>
          </div>
          <div className="text-xs font-mono text-zinc-500 hidden sm:block">POWERED BY GEMINI 2.0</div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* IDLE State: Input */}
        {appState === AppState.IDLE && (
          <div className="flex flex-col items-center justify-center py-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-full max-w-2xl text-center space-y-6">
              <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-400">
                Deconstruct <br/> Any Channel
              </h1>
              <p className="text-zinc-400 text-lg md:text-xl max-w-lg mx-auto">
                Generate knowledge graphs and critical rebuttals for science and philosophy content creators.
              </p>
              
              <form onSubmit={handleAnalyze} className="relative mt-8 group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-emerald-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative flex shadow-2xl">
                  <div className="flex-1 bg-zinc-900 rounded-l-lg border border-r-0 border-zinc-700 flex items-center px-4">
                    <Youtube className="w-5 h-5 text-zinc-500" />
                    <input 
                      type="text" 
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste YouTube Channel URL..."
                      className="w-full bg-transparent border-none focus:ring-0 text-white px-3 py-4 placeholder-zinc-500 font-mono text-sm"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-r-lg font-semibold transition-all flex items-center gap-2"
                  >
                    Analyze <Search className="w-4 h-4" />
                  </button>
                </div>
              </form>
              
              <div className="flex justify-center mt-6">
                <input 
                    type="file" 
                    ref={fileInputRef}
                    accept=".toml"
                    onChange={handleImport} 
                    className="hidden" 
                />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 text-zinc-500 hover:text-white text-sm transition-colors border border-zinc-800 rounded-full px-4 py-2 hover:bg-zinc-900"
                >
                    <Upload className="w-4 h-4" /> Import Scrap Data (TOML)
                </button>
              </div>

              <div className="pt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
                {[
                  { icon: BrainCircuit, title: "Topic Mapping", desc: "Visualize connections between concepts." },
                  { icon: Search, title: "Deep Retrieval", desc: "Scans video history for core arguments." },
                  { icon: PlayCircle, title: "Auto-Rebuttal", desc: "Generates critical presentation decks." },
                ].map((feature, i) => (
                  <div key={i} className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                    <feature.icon className="w-6 h-6 text-zinc-500 mb-3" />
                    <h3 className="font-bold text-zinc-200 mb-1">{feature.title}</h3>
                    <p className="text-sm text-zinc-500">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* DASHBOARD State */}
        {appState === AppState.DASHBOARD && graphData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-500 h-[calc(100vh-8rem)]">
            
            {/* Left Col: Channel Info & Actions */}
            <div className="lg:col-span-1 flex flex-col gap-6 h-full overflow-hidden">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex-shrink-0 flex flex-col">
                <div className="flex justify-between items-start mb-2">
                    <h2 className="text-xl font-bold">Analysis Summary</h2>
                    <button 
                        onClick={handleExport}
                        title="Save Graph Data"
                        className="text-zinc-500 hover:text-blue-400 transition-colors p-1"
                    >
                        <Download className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed mb-4 max-h-32 overflow-y-auto">
                  {graphData.summary}
                </p>
                
                <div className="mt-auto space-y-3">
                    <div className="relative">
                        <textarea
                            value={customInstructions}
                            onChange={(e) => setCustomInstructions(e.target.value)}
                            placeholder="Add custom instructions for the rebuttal (e.g., 'Focus on economic fallacies' or 'Be more sarcastic')..."
                            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none h-20"
                        />
                        <div className="absolute bottom-2 right-2 text-[10px] text-zinc-600 pointer-events-none">
                            OPTIONAL
                        </div>
                    </div>

                    <button 
                    onClick={handleGeneratePresentation}
                    className="w-full py-3 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white rounded-lg font-bold shadow-lg shadow-rose-900/20 flex items-center justify-center gap-2 transition-transform active:scale-95"
                    >
                    <PlayCircle className="w-5 h-5" />
                    Generate Rebuttal Deck
                    </button>
                </div>
              </div>

              <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur sticky top-0">
                  <h3 className="font-bold text-zinc-300 flex items-center gap-2">
                    <Youtube className="w-4 h-4" /> Analyzed Videos
                  </h3>
                </div>
                <div className="overflow-y-auto p-4 space-y-4">
                  {videoList?.map((video, idx) => (
                    <div key={idx} className="group p-3 rounded-lg bg-zinc-950/50 border border-zinc-800 hover:border-zinc-700 transition">
                      <h4 className="font-medium text-blue-400 text-sm mb-1 group-hover:underline cursor-pointer line-clamp-1">{video.title}</h4>
                      <p className="text-xs text-zinc-500 line-clamp-3">{video.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Col: Graph Visualization */}
            <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[500px] lg:h-auto relative group">
               <div className="absolute top-4 left-4 z-10 pointer-events-none">
                  <h3 className="font-bold text-zinc-200 bg-black/50 px-2 py-1 rounded">Topic Galaxy</h3>
                  <p className="text-xs text-zinc-500 px-2">Force-directed concept map</p>
               </div>
               <ForceGraph 
                 data={graphData} 
                 onNodeDoubleClick={(node) => setSelectedNode(node)} 
               />
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default App;