import React, { useState, useEffect } from 'react';
import { PresentationData, Slide } from '../types';
import { ChevronLeft, ChevronRight, X, MonitorPlay, FileText, Sparkles, Box, ShieldAlert, Zap } from 'lucide-react';
import { generateSlideImage } from '../services/geminiService';

interface PresentationViewProps {
  data: PresentationData;
  onClose: () => void;
}

const PresentationView: React.FC<PresentationViewProps> = ({ data, onClose }) => {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [images, setImages] = useState<Record<number, string>>({});
  const [loadingImage, setLoadingImage] = useState(false);

  // Safety check: ensure slides exist
  if (!data || !data.slides || data.slides.length === 0) {
      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 text-white">
              <div className="text-center">
                  <p className="mb-4">No presentation data available.</p>
                  <button onClick={onClose} className="px-4 py-2 bg-zinc-800 rounded">Close</button>
              </div>
          </div>
      );
  }

  const currentSlide: Slide = data.slides[currentSlideIndex];
  const totalSlides = data.slides.length;

  useEffect(() => {
    const loadVisual = async () => {
        if (images[currentSlideIndex]) return;
        
        if (currentSlide.visualPrompt) {
            setLoadingImage(true);
            try {
               const imgData = await generateSlideImage(currentSlide.visualPrompt);
               if (imgData) {
                   setImages(prev => ({...prev, [currentSlideIndex]: imgData}));
               }
            } catch (e) {
                console.error("Failed to load slide visual", e);
            } finally {
                setLoadingImage(false);
            }
        }
    };
    loadVisual();
  }, [currentSlideIndex, currentSlide.visualPrompt, images]);

  const nextSlide = () => {
    if (currentSlideIndex < totalSlides - 1) setCurrentSlideIndex(p => p + 1);
  };

  const prevSlide = () => {
    if (currentSlideIndex > 0) setCurrentSlideIndex(p => p - 1);
  };
  
  // Icon selection helper based on content roughly (randomized for variety)
  const SlideIcon = [Sparkles, Box, ShieldAlert, Zap][currentSlideIndex % 4];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white animate-in fade-in duration-300">
      {/* Header / Toolbar */}
      <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900 z-20 shadow-lg">
        <div className="flex items-center gap-2">
           <MonitorPlay className="w-5 h-5 text-rose-500" />
           <span className="font-semibold text-sm tracking-wide">DEEP DIVE REBUTTAL DECK</span>
        </div>
        
        <div className="flex items-center gap-4">
           <span className="text-zinc-500 text-sm font-mono">{currentSlideIndex + 1} / {totalSlides}</span>
           <button 
             onClick={() => setShowNotes(!showNotes)}
             className={`p-2 rounded hover:bg-zinc-800 transition-colors ${showNotes ? 'text-blue-400' : 'text-zinc-500'}`}
             title="Toggle Speaker Notes"
           >
             <FileText className="w-5 h-5" />
           </button>
           <button 
             onClick={onClose}
             className="p-2 rounded hover:bg-zinc-800 hover:text-red-400 transition-colors"
           >
             <X className="w-5 h-5" />
           </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Full Bleed Background Image */}
        <div className="absolute inset-0 z-0 bg-zinc-950 transition-opacity duration-700 ease-in-out">
            {images[currentSlideIndex] ? (
                <div 
                    key={`bg-${currentSlideIndex}`}
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 animate-in fade-in duration-1000 scale-105"
                    style={{ backgroundImage: `url(${images[currentSlideIndex]})` }}
                />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-800 opacity-100" />
            )}
             {/* Gradient Overlay for Readability */}
            <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/90 to-zinc-950/60" />
        </div>

        {/* Slide Canvas */}
        <div className="flex-1 flex items-center justify-center p-8 md:p-16 relative z-10">
           
           {/* Slide Content Container */}
           <div 
             key={currentSlideIndex}
             className="w-full max-w-6xl aspect-video relative flex flex-col justify-between animate-in slide-in-from-right-8 fade-in duration-500"
           >
              {/* Decorative Header Element */}
              <div className="mb-8 border-l-4 border-rose-500 pl-6">
                <div className="flex items-center gap-2 text-rose-400 mb-2 font-mono text-xs tracking-widest uppercase">
                    <SlideIcon className="w-4 h-4" />
                    <span>Analysis Module {currentSlideIndex + 1}</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight drop-shadow-lg max-w-4xl">
                    {currentSlide.title || "Untitled Slide"}
                </h2>
              </div>

              {/* Body Content */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-12 flex-1 items-start">
                <div className="md:col-span-3 space-y-6">
                    {currentSlide.bulletPoints && currentSlide.bulletPoints.map((point, idx) => {
                        const hasLabel = point.includes(":");
                        const label = hasLabel ? point.split(":")[0] : "";
                        const content = hasLabel ? point.substring(point.indexOf(":") + 1) : point;
                        
                        return (
                        <div key={idx} className="flex gap-4 group">
                            <div className="mt-2 w-2 h-2 rounded-full bg-blue-500 group-hover:bg-blue-400 transition-colors shadow-[0_0_10px_rgba(59,130,246,0.5)] shrink-0" />
                            <p className="text-lg md:text-xl text-zinc-200 font-light leading-relaxed group-hover:text-white transition-colors">
                                {hasLabel ? (
                                    <>
                                        <span className="font-bold text-blue-400 tracking-wide">{label}:</span>
                                        <span>{content}</span>
                                    </>
                                ) : (
                                    point
                                )}
                            </p>
                        </div>
                    )})}
                </div>

                {/* Right Side / Rebuttal Box */}
                <div className="md:col-span-2 flex flex-col justify-end h-full">
                    {currentSlide.rebuttal && (
                        <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-700/50 p-6 rounded-xl relative overflow-hidden group">
                           <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-rose-500 to-purple-600" />
                           <Zap className="w-12 h-12 text-white/5 absolute -right-2 -bottom-2 group-hover:scale-110 transition-transform duration-500" />
                           
                           <h3 className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                             <ShieldAlert className="w-4 h-4" /> Rebuttal Strategy
                           </h3>
                           <p className="text-zinc-200 italic text-sm md:text-base leading-loose border-l-2 border-zinc-700 pl-4">
                             "{currentSlide.rebuttal}"
                           </p>
                        </div>
                    )}
                </div>
              </div>

              {/* Footer / Branding */}
              <div className="mt-8 flex justify-between items-end border-t border-zinc-800 pt-4">
                 <div className="text-zinc-500 text-xs font-mono">CHANNEL DISSECTOR AI v2.0</div>
                 {loadingImage && (
                     <div className="flex items-center gap-2 text-xs text-blue-400 animate-pulse">
                         <Sparkles className="w-3 h-3" /> Generating Neural Visuals...
                     </div>
                 )}
              </div>
           </div>
           
           {/* Navigation Buttons */}
           <button 
             onClick={prevSlide}
             disabled={currentSlideIndex === 0}
             className="absolute left-6 top-1/2 -translate-y-1/2 p-4 rounded-full bg-black/20 hover:bg-black/40 hover:scale-110 text-white/50 hover:text-white disabled:opacity-0 transition-all backdrop-blur-sm z-20 border border-white/5"
           >
             <ChevronLeft className="w-8 h-8" />
           </button>
           <button 
             onClick={nextSlide}
             disabled={currentSlideIndex === totalSlides - 1}
             className="absolute right-6 top-1/2 -translate-y-1/2 p-4 rounded-full bg-black/20 hover:bg-black/40 hover:scale-110 text-white/50 hover:text-white disabled:opacity-0 transition-all backdrop-blur-sm z-20 border border-white/5"
           >
             <ChevronRight className="w-8 h-8" />
           </button>
        </div>

        {/* Speaker Notes Sidebar */}
        {showNotes && (
          <div className="w-96 border-l border-zinc-800 bg-zinc-950/95 p-8 overflow-y-auto hidden md:block z-30 shadow-2xl relative">
            <h3 className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-6 flex items-center gap-2">
                <FileText className="w-4 h-4" /> Speaker Notes
            </h3>
            <div className="prose prose-invert prose-sm">
              <p className="whitespace-pre-wrap text-zinc-300 font-serif text-lg leading-loose">
                {currentSlide.speakerNotes || "No notes available for this slide."}
              </p>
            </div>
            {/* Visual Prompt Debug (Optional, adds "tech" feel) */}
            <div className="mt-12 pt-6 border-t border-zinc-800/50 opacity-50">
                <p className="text-[10px] text-zinc-600 font-mono uppercase mb-2">Visual Generator Prompt</p>
                <p className="text-[10px] text-zinc-700 font-mono break-words">{currentSlide.visualPrompt}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PresentationView;