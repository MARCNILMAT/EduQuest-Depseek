import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  ChevronRight, 
  RotateCcw, 
  CheckCircle2, 
  Brain, 
  GraduationCap,
  Loader2, 
  Settings2, 
  AlertTriangle, 
  ArrowRight, 
  Eye, 
  Clock, 
  Pause, 
  Play,
  RefreshCw,
  FileDown,
  Volume2,
  VolumeX
} from 'lucide-react';
import OpenAI from 'openai';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { CURRICULUM_DATA } from './data/curriculum';

interface Question {
  question: string;
  answerOptions: {
    text: string;
    rationale: string;
    isCorrect: boolean;
  }[];
  hint: string;
}

export default function App() {
  const [step, setStep] = useState('selection'); 
  const [selection, setSelection] = useState({ grade: '6', subject: '', topic: '', classGroup: '' });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<(number | null)[][]>(new Array(10).fill(null).map(() => new Array(5).fill(null)));
  const [revealedQuestions, setRevealedQuestions] = useState<boolean[]>(new Array(10).fill(false));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(240); // 4 minutos por questão
  const [isPaused, setIsPaused] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // Stop speaking when question changes
  useEffect(() => {
    if (audioElement) {
      audioElement.pause();
      setAudioElement(null);
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [currentQuestionIdx, step]);

  const handleSpeak = (text: string) => {
    console.log("handleSpeak called with text:", text.substring(0, 30) + "...");
    
    if (isSpeaking) {
      console.log("Already speaking, stopping...");
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);

    try {
      if (!window.speechSynthesis) {
        console.error("Speech Synthesis not supported by this browser");
        setIsSpeaking(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR'; // Let's try Portuguese voice
      utterance.rate = 1.0;

      utterance.onend = () => {
        console.log("Web Speech API ended");
        setIsSpeaking(false);
      };

      utterance.onerror = (e) => {
        console.error("SpeechSynthesis error:", e);
        setIsSpeaking(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Web Speech API failed:", error);
      setIsSpeaking(false);
    }
  };

  // Calculate scores per group
  const groupScores = Array.from({ length: 5 }).map((_, groupIdx) => {
    return userAnswers.reduce((acc, qAnswers, qIdx) => {
      const ans = qAnswers[groupIdx];
      // Count if revealed OR if we are already in the results screen
      const shouldCount = revealedQuestions[qIdx] || step === 'results';
      if (ans !== null && shouldCount && questions[qIdx]?.answerOptions[ans]?.isCorrect) {
        return acc + 1;
      }
      return acc;
    }, 0);
  });

  const totalPossible = questions.length * 5;
  const totalScore = groupScores.reduce((a, b) => a + b, 0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (step === 'quiz' && timeLeft > 0 && !isPaused && !revealedQuestions[currentQuestionIdx]) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && step === 'quiz' && !revealedQuestions[currentQuestionIdx]) {
      handleRevealAll();
    }
    return () => { if (timer) clearInterval(timer); };
  }, [step, timeLeft, isPaused, currentQuestionIdx, revealedQuestions]);

  useEffect(() => {
    if (step === 'quiz') {
      setTimeLeft(240);
      setIsPaused(false);
    }
  }, [step, currentQuestionIdx]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatMath = (text: string) => {
    if (!text) return "";
    return text.replace(/(\w+|\d+)\^(\(?[\w\d+-]+\)?)/g, '$1<sup>$2</sup>')
               .replace(/\(([\w\d+-]+)\)/g, '$1'); 
  };

  const generateQuestions = async (grade: string, subject: string, topic: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        setError("Erro: Chave de API (DEEPSEEK_API_KEY) não configurada.");
        setIsLoading(false);
        return;
      }

      // Initialize OpenAI client with DeepSeek settings
      const openai = new OpenAI({
        apiKey,
        baseURL: "https://api.deepseek.com/v1",
        dangerouslyAllowBrowser: true // Enable for client-side
      });

      const response = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `És um professor especialista no CRMG 2026 de Minas Gerais.
            Gera 10 questões de escolha múltipla para o ${grade}º ano sobre o tópico "${topic}" da disciplina "${subject}".
            ${subject === 'Inglês' ? 'IMPORTANTE: Como a disciplina é Inglês, as perguntas, alternativas e explicações devem ser bilíngues (Inglês seguido de tradução em Português entre parênteses) para garantir a melhor compreensão do aluno.' : ''}
            IMPORTANTE: As respostas corretas devem estar distribuídas de forma equilibrada entre as alternativas A, B, C e D, garantindo que a posição da resposta correta mude a cada questão (não repita a mesma letra em questões seguidas).
            Para potências e notação científica usa obrigatoriamente "base^expoente" (ex: 2^3 ou 10^5).
            Retorna obrigatoriamente um objeto JSON com a chave "questions" contendo um array de objetos com:
            - question: string
            - answerOptions: array de objetos com text (string), rationale (string), isCorrect (boolean)
            - hint: string`
          },
          {
            role: "user",
            content: `Gera 10 questões sobre ${topic}.`
          }
        ],
        response_format: { type: "json_object" }
      });

      const content = response.choices[0]?.message?.content;
      const data = JSON.parse(content || "{}");
      
      if (data?.questions?.length > 0) {
        setQuestions(data.questions);
        setStep('quiz');
      } else {
        throw new Error("Dados inválidos recebidos da IA.");
      }
    } catch (err) {
      console.error(err);
      setError("Erro ao carregar questões. Verifique sua conexão ou tente um tópico diferente.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartQuiz = () => {
    if (!selection.subject || !selection.topic) return;
    generateQuestions(selection.grade, selection.subject, selection.topic);
  };

  const handleOptionSelect = (groupIdx: number, optIdx: number) => {
    if (revealedQuestions[currentQuestionIdx]) return;
    
    const newAnswers = [...userAnswers];
    newAnswers[currentQuestionIdx] = [...newAnswers[currentQuestionIdx]];
    newAnswers[currentQuestionIdx][groupIdx] = optIdx;
    setUserAnswers(newAnswers);
  };

  const handleRevealAll = () => {
    if (userAnswers[currentQuestionIdx].every(a => a === null)) return;
    const newRevealed = [...revealedQuestions];
    newRevealed[currentQuestionIdx] = true;
    setRevealedQuestions(newRevealed);
  };

  useEffect(() => {
    if (step === 'quiz' && timeLeft === 60 && !isPaused) {
      handleSpeak("Atenção, o tempo está se esgotando");
    }
  }, [timeLeft, step, isPaused]);

  const resetQuiz = () => {
    setStep('selection');
    setSelection({ grade: '6', subject: '', topic: '', classGroup: '' });
    setQuestions([]);
    setCurrentQuestionIdx(0);
    setUserAnswers(new Array(10).fill(null).map(() => new Array(5).fill(null)));
    setRevealedQuestions(new Array(10).fill(false));
    setError(null);
    setIsPaused(false);
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(22);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text("EduQuest MG 2026 - Resultado", 14, 22);
    
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text(`Assunto: ${selection.topic}`, 14, 32);
    doc.text(`Disciplina: ${selection.subject} - ${selection.grade}º Ano`, 14, 38);
    if (selection.classGroup) {
      doc.text(`Turma: ${selection.classGroup}`, 14, 44);
      doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, 14, 50);
    } else {
      doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, 14, 44);
    }

    // Table
    const tableData = groupScores.map((score, idx) => [
      `Grupo ${idx + 1}`,
      `${score}/10`,
      `${Math.round((score / 10) * 100)}%`
    ]);

    autoTable(doc, {
      startY: selection.classGroup ? 60 : 55,
      head: [['Grupo', 'Acertos', 'Aproveitamento']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 5 },
      columnStyles: {
        0: { fontStyle: 'bold' },
        2: { halign: 'center' }
      }
    });

    // Summary
    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text(`Total Geral de Acertos: ${totalScore}/50`, 14, finalY);
    doc.text(`Nota Final: ${totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0}%`, 14, finalY + 8);

    // Footer
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text("Gerado por Quiz Interativo - Planos de Ensino 2026", 14, 285);

    doc.save(`resultado-simulado-${selection.topic.toLowerCase().replace(/\s+/g, '-')}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center text-slate-800">
        <Loader2 className="w-16 h-16 text-blue-600 animate-spin mb-4" />
        <h2 className="text-2xl font-black tracking-tight font-display">A preparar o Simulado...</h2>
        <p className="text-slate-500 mt-2">Consultando o Plano de Curso 2026 MG via IA</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-950 p-4 md:p-6 font-sans">
      <div className="max-w-[80%] mx-auto px-2 md:px-8">
        
        {/* Header */}
        <div className="bg-white p-6 rounded-[2rem] shadow-md border border-slate-300 flex items-center justify-between mb-8">
          <div className="flex items-center gap-5">
            <div className="p-3 bg-blue-700 rounded-[1.2rem] text-white shadow-xl shadow-blue-200">
              <GraduationCap size={28} />
            </div>
            <div>
              <h1 className="font-black text-2xl text-slate-900 leading-tight font-display animate-rotate-3d">Quiz Interativo</h1>
              <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Planos de Ensino 2026</p>
            </div>
            {step !== 'selection' && (
              <button onClick={resetQuiz} className="p-3 bg-green-600 hover:bg-green-700 rounded-xl transition-all text-white shadow-lg shadow-green-200 flex items-center justify-center" title="Reiniciar Simulado">
                <RotateCcw size={28} />
              </button>
            )}
          </div>
        </div>

        {/* Seleção */}
        {step === 'selection' && (
          <div className="max-w-4xl mx-auto bg-white rounded-[2.5rem] p-8 md:p-12 shadow-xl border border-slate-300 animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-3xl font-black mb-10 text-center text-slate-900 tracking-tight text-balance font-display animate-rotate-3d">Quiz Interativo</h2>
            
            <div className="space-y-8 text-slate-800">
              <div className="space-y-4">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Settings2 size={14} /> Seleciona o Ano
                </label>
                <div className="flex gap-2 flex-wrap">
                  {Object.keys(CURRICULUM_DATA).map(g => (
                    <button key={g} onClick={() => setSelection({...selection, grade: g, subject: '', topic: ''})}
                      className={`flex-1 min-w-[100px] py-5 rounded-[1.5rem] font-black text-lg transition-all border-2 ${selection.grade === g ? "bg-blue-700 text-white border-blue-700 shadow-xl shadow-blue-200" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"}`}>
                      {g}º Ano
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <GraduationCap size={14} /> Selecionar Turma
                </label>
                <div className="flex gap-2 flex-wrap">
                  {['601', '602', '701', '801', '802', '901', '902']
                    .filter(t => t.startsWith(selection.grade))
                    .map(t => (
                      <button key={t} onClick={() => setSelection({...selection, classGroup: t})}
                        className={`flex-1 min-w-[80px] py-4 rounded-[1.2rem] font-black text-base transition-all border-2 ${selection.classGroup === t ? "bg-blue-700 text-white border-blue-700 shadow-md" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"}`}>
                        {t}
                      </button>
                    ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <BookOpen size={14} /> Disciplina
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-slate-700">
                  {CURRICULUM_DATA[selection.grade as keyof typeof CURRICULUM_DATA]?.subjects.map(s => (
                    <button key={s} onClick={() => setSelection({...selection, subject: s, topic: ''})}
                      className={`py-5 px-6 rounded-[1.5rem] text-lg font-black text-left transition-all truncate border-2 ${selection.subject === s ? "border-blue-700 bg-blue-50 text-blue-800 shadow-md" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {selection.subject && (
                <div className="space-y-4 animate-in fade-in">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Brain size={14} /> Tópico Específico (CRMG)
                  </label>
                  <div className="grid grid-cols-1 gap-3 text-slate-700">
                    {CURRICULUM_DATA[selection.grade as keyof typeof CURRICULUM_DATA]?.topics[selection.subject as keyof (typeof CURRICULUM_DATA)["6"]["topics"]]?.map(t => (
                      <button key={t} onClick={() => setSelection({...selection, topic: t})}
                        className={`py-6 px-8 rounded-[2rem] text-xl font-black text-left transition-all border-2 ${selection.topic === t ? "border-blue-700 bg-blue-50 text-blue-800 shadow-md" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-6 p-6 bg-red-50 text-red-700 rounded-3xl border border-red-100 flex flex-col items-center gap-4">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle size={20} /> {error}
                </div>
                <button 
                  onClick={handleStartQuiz}
                  className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors text-sm"
                >
                  <RefreshCw size={16} /> Tentar Novamente
                </button>
              </div>
            )}

            <button onClick={handleStartQuiz} disabled={!selection.topic || !selection.classGroup || isLoading}
              className={`mt-12 w-full py-8 rounded-[2.5rem] font-black text-2xl transition-all flex items-center justify-center gap-4 ${selection.topic && selection.classGroup ? "bg-slate-900 text-white shadow-2xl hover:bg-black" : "bg-slate-100 text-slate-300 cursor-not-allowed"}`}>
              {isLoading ? <Loader2 className="w-8 h-8 animate-spin" /> : <>Gerar Simulado <ArrowRight size={28} /></>}
            </button>
          </div>
        )}

        {/* Quiz */}
        {step === 'quiz' && questions.length > 0 && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 pb-64">
            <div className="flex flex-col md:flex-row items-center justify-between px-2 gap-4">
              <div className="flex items-center gap-3 flex-1 w-full">
                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-600 transition-all duration-500" 
                    style={{ width: `${((currentQuestionIdx + 1) / questions.length) * 100}%` }} 
                  />
                </div>
                <span className="text-xs font-black text-slate-400 uppercase tracking-tight shrink-0">
                  Questão: {currentQuestionIdx + 1}/{questions.length}
                </span>
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => {
                    if (showEndConfirm) {
                      setStep('results');
                      setShowEndConfirm(false);
                    } else {
                      setShowEndConfirm(true);
                      setTimeout(() => setShowEndConfirm(false), 3000); // Reset after 3s
                    }
                  }}
                  className={`p-2.5 rounded-2xl transition-all shadow-md flex items-center gap-2 font-bold text-sm ${showEndConfirm ? "bg-red-700 ring-4 ring-red-200" : "bg-red-600 hover:bg-red-700"} text-white`}
                >
                  <AlertTriangle size={18} />
                  {showEndConfirm ? "Confirmar?" : "Encerrar"}
                </button>
                <button 
                  onClick={togglePause}
                  className={`p-2.5 rounded-2xl transition-all shadow-sm flex items-center gap-2 font-bold text-sm ${isPaused ? "bg-orange-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}
                >
                  {isPaused ? <Play size={18} /> : <Pause size={18} />}
                  {isPaused ? "Retomar" : "Pausar"}
                </button>
              </div>
            </div>

            {/* Circular Timer - Fixed at Top Right */}
            <div 
              className={`fixed top-8 right-8 z-50 w-32 h-32 rounded-full flex flex-col items-center justify-center font-black border-6 transition-all shadow-2xl ${timeLeft <= 60 ? "bg-red-50 text-red-600 border-red-500 animate-pulse" : "bg-white text-slate-950 border-slate-900"} ${isPaused ? "opacity-40 scale-90" : "scale-100"}`}
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              <span className="text-[10px] uppercase tracking-widest mb-[-4px]">Tempo</span>
              <div className="text-[40px] leading-none">
                {formatTime(timeLeft)}
              </div>
            </div>

            {/* Main Quiz Layout: Sidebar Scores + Question */}
            <div className="flex flex-col lg:flex-row gap-6 items-stretch">
              {/* Vertical Score Sidebar */}
              <div className="w-full lg:w-72 shrink-0 animate-in slide-in-from-left-4 duration-500 flex flex-col">
                <div className="bg-white rounded-[1.5rem] p-4 border border-slate-300 shadow-lg h-full">
                  <div className="flex flex-col gap-2 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center text-blue-700 shadow-sm">
                        <CheckCircle2 size={18} />
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Simulado</p>
                        <h4 className="text-[16px] font-black text-slate-900 uppercase tracking-tight leading-none">Acertos</h4>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 bg-slate-50 p-2.5 rounded-[1rem] border border-slate-200">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Geral</span>
                        <span className="text-xl font-black text-slate-950 leading-none">{totalScore}<span className="text-slate-400 text-xs">/50</span></span>
                      </div>
                      <div className="w-full h-7 bg-slate-950 rounded-lg flex items-center justify-center text-white font-black text-sm shadow-md">
                        {totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0}%
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {groupScores.map((groupScore, idx) => {
                      const currentQAnswer = userAnswers[currentQuestionIdx][idx];
                      const isRevealed = revealedQuestions[currentQuestionIdx];
                      const isCorrect = isRevealed && currentQAnswer !== null && questions[currentQuestionIdx]?.answerOptions[currentQAnswer]?.isCorrect;
                      const isAnswered = currentQAnswer !== null;
                      
                      return (
                        <div key={idx} className={`flex flex-col p-2.5 rounded-[1rem] border-2 transition-all gap-1 overflow-hidden ${
                          isRevealed 
                            ? (isCorrect ? "bg-green-50 border-green-500 shadow-sm" : "bg-red-50 border-red-500 shadow-sm")
                            : (isAnswered ? "bg-blue-50 border-blue-200 shadow-sm" : "bg-slate-50 border-slate-100")
                        }`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black shadow-sm shrink-0 ${
                              isRevealed 
                                ? (isCorrect ? "bg-green-600 text-white" : "bg-red-600 text-white")
                                : (isAnswered ? "bg-blue-700 text-white" : "bg-slate-300 text-slate-600")
                            }`}>
                              {idx + 1}
                            </span>
                            <span className="text-[13px] font-bold text-slate-900 truncate">Grupo {idx + 1}</span>
                          </div>
                          
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[13px] font-black text-slate-600 uppercase tracking-tight">Acertos: {groupScore}/10</span>
                            {isRevealed ? (
                              isCorrect ? (
                                <span className="text-[9px] font-black text-green-700 uppercase tracking-widest bg-green-100/50 px-2 py-0.5 rounded-md self-start">Correto</span>
                              ) : (
                                <span className="text-[9px] font-black text-red-700 uppercase tracking-widest bg-red-100/50 px-2 py-0.5 rounded-md self-start">Incorreto</span>
                              )
                            ) : (
                              isAnswered ? (
                                <span className="text-[9px] font-black text-blue-700 uppercase tracking-widest bg-blue-100/50 px-2 py-0.5 rounded-md self-start">Marcado</span>
                              ) : (
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-200/50 px-2 py-0.5 rounded-md self-start">Pendente</span>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Main Content: Current Question */}
              <div className="flex-1 w-full flex flex-col">
                {(() => {
                  const qIdx = currentQuestionIdx;
                  const question = questions[qIdx];
                  if (!question) return null;

                  return (
                    <div key={qIdx} className="bg-white rounded-[2.5rem] p-4 md:p-6 shadow-xl border border-slate-300 relative overflow-hidden flex-1 flex flex-col">
                      {isPaused && (
                        <div className="absolute top-0 left-0 right-0 h-1 bg-orange-600 animate-pulse z-10" />
                      )}

                      <div className="flex items-center gap-4 mb-3">
                        <span className="w-9 h-9 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center font-black text-sm shadow-sm shrink-0">
                          {qIdx + 1}
                        </span>
                        <h3 className="text-[22px] font-black text-slate-900 leading-tight font-display transition-opacity flex-1" 
                            dangerouslySetInnerHTML={{ __html: formatMath(String(question.question)) }} />
                        <button 
                          onClick={() => handleSpeak(String(question.question))}
                          className={`p-2 rounded-xl transition-all shadow-md flex items-center justify-center ${isSpeaking ? "bg-red-100 text-red-600 border-2 border-red-200" : "bg-green-50 text-green-700 border-2 border-green-100 hover:bg-green-100"}`}
                          title={isSpeaking ? "Parar Leitura" : "Ouvir Questão"}
                        >
                          {isSpeaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 mb-3 transition-all opacity-100 flex-1 content-start">
                        {question.answerOptions.map((opt, idx) => {
                          let styles = "bg-slate-50 text-slate-700 border-2 border-slate-200 shadow-sm";
                          const isRevealed = revealedQuestions[qIdx];
                          
                          if (isRevealed) {
                            if (opt.isCorrect) styles = "bg-green-50 text-green-800 border-green-600 ring-4 ring-green-100 shadow-none";
                            else styles = "bg-white text-slate-400 border-slate-200 opacity-50 shadow-none";
                          }

                          return (
                            <div key={idx} className={`group text-left p-2.5 rounded-[1rem] transition-all flex items-center gap-3 ${styles}`}>
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black shrink-0 shadow-sm text-xs ${
                                isRevealed && opt.isCorrect ? "bg-green-600 text-white" : 
                                "bg-white text-slate-500"
                              }`}>
                                {String.fromCharCode(65 + idx)}
                              </div>
                              <span className="text-[16px] font-bold flex-1" dangerouslySetInnerHTML={{ __html: formatMath(String(opt.text)) }} />
                            </div>
                          );
                        })}
                      </div>

                      {revealedQuestions[qIdx] && (
                        <div className="p-3.5 bg-slate-900 rounded-[1.2rem] text-white animate-in slide-in-from-top-4 shadow-2xl mb-3">
                          <div className="flex items-center gap-2 mb-1 text-blue-400 font-black text-xs uppercase tracking-widest">
                            <Brain size={14} /> Explicação
                          </div>
                          <p className="text-slate-300 text-xs leading-relaxed italic"
                             dangerouslySetInnerHTML={{ __html: formatMath(String(question.answerOptions.find(o => o.isCorrect)?.rationale || "Explicação não disponível.")) }} />
                        </div>
                      )}

                      <div className="flex justify-between items-center mt-4 gap-3">
                        <button 
                          disabled={currentQuestionIdx === 0}
                          onClick={() => setCurrentQuestionIdx(prev => prev - 1)}
                          className="px-10 py-5 bg-slate-100 text-slate-600 rounded-2xl font-black disabled:opacity-30 hover:bg-slate-200 transition-all text-lg"
                        >
                          Anterior
                        </button>

                        {!revealedQuestions[qIdx] && userAnswers.some(a => a !== null) && (
                          <button 
                            onClick={handleRevealAll}
                            className="flex-1 py-5 bg-blue-600 text-white rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-lg text-lg"
                          >
                            Obter Respostas <Eye size={22} />
                          </button>
                        )}

                        <button 
                          onClick={() => {
                            if (currentQuestionIdx < 9) setCurrentQuestionIdx(prev => prev + 1);
                            else setStep('results');
                          }}
                          className={`px-10 py-5 rounded-2xl font-black transition-all text-lg ${
                            currentQuestionIdx === 9 && !revealedQuestions[9]
                              ? "bg-slate-100 text-slate-300"
                              : "bg-slate-900 text-white hover:bg-black"
                          }`}
                        >
                          {currentQuestionIdx < 9 ? "Próxima" : "Finalizar"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Group Navigation Buttons at Bottom - Now with 5 independent slots */}
            <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t-4 border-slate-300 p-6 z-30 shadow-[0_-15px_50px_rgba(0,0,0,0.15)]">
              <div className="max-w-[80%] mx-auto px-8">
                <div className="grid grid-cols-5 gap-4 md:gap-8">
                  {Array.from({ length: 5 }).map((_, groupIdx) => {
                    const isCurrent = false; // Clicking G buttons no longer changes question
                    
                    return (
                      <div key={groupIdx} className="flex flex-col gap-2">
                        <div
                          className={`py-2.5 rounded-xl font-black text-[12px] md:text-sm uppercase tracking-tighter transition-all border-2 text-center bg-slate-100 text-slate-700 border-slate-200 shadow-sm`}
                        >
                          Grupo {groupIdx + 1}
                        </div>
                        
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-center bg-slate-50 p-2 rounded-xl border-2 border-slate-200 shadow-inner">
                            <div className="flex gap-1.5">
                              {['A', 'B', 'C', 'D'].map((letter, optIdx) => {
                                const isSelected = userAnswers[currentQuestionIdx][groupIdx] === optIdx;
                                const isCorrect = questions[currentQuestionIdx]?.answerOptions[optIdx]?.isCorrect;
                                const isShown = revealedQuestions[currentQuestionIdx];
                                
                                let btnClass = "w-6 h-6 md:w-10 md:h-10 text-[10px] md:text-[16px] font-black rounded-lg flex items-center justify-center transition-all shadow-sm ";
                                if (isShown) {
                                  if (isCorrect) btnClass += "bg-green-600 text-white";
                                  else if (isSelected) btnClass += "bg-red-600 text-white";
                                  else btnClass += "bg-slate-200 text-slate-400";
                                } else {
                                  if (isSelected) btnClass += "bg-blue-700 text-white ring-4 ring-blue-200";
                                  else btnClass += "bg-white text-slate-600 border-2 border-slate-300 hover:border-blue-500 hover:text-blue-600";
                                }

                                return (
                                  <button
                                    key={optIdx}
                                    disabled={isShown}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOptionSelect(groupIdx, optIdx);
                                    }}
                                    className={btnClass}
                                  >
                                    {letter}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {!revealedQuestions[currentQuestionIdx] && userAnswers[currentQuestionIdx].some(a => a !== null) && (
                  <button 
                    onClick={handleRevealAll}
                    className="mt-4 w-full py-4 bg-blue-700 text-white rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-800 transition-all shadow-xl shadow-blue-200 active:scale-[0.98]"
                  >
                    Obter Respostas de Todos os Grupos <Eye size={18} />
                  </button>
                )}

                {revealedQuestions[currentQuestionIdx] && currentQuestionIdx === 9 && (
                  <button 
                    onClick={() => setStep('results')}
                    className="mt-4 w-full py-4 bg-slate-950 text-white rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-black transition-all shadow-xl active:scale-[0.98]"
                  >
                    Ver Resultado Final <CheckCircle2 size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Resultados */}
        {step === 'results' && (
          <div className="max-w-4xl mx-auto bg-white rounded-[2.5rem] p-8 md:p-16 shadow-2xl border border-slate-300 text-center animate-in zoom-in-95">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner border-2 border-blue-100">
              <CheckCircle2 size={40} className="text-blue-700" />
            </div>
            <h2 className="text-4xl font-black text-slate-950 mb-2 tracking-tight font-display">Simulado Encerrado</h2>
            <p className="text-slate-500 mb-8">Confira o desempenho de cada grupo abaixo</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10 text-slate-900">
              <div className="bg-green-50 p-6 rounded-[2rem] border-2 border-green-200 shadow-sm flex flex-col items-center justify-center">
                <div className="text-4xl font-black text-green-700 leading-none mb-1">{totalScore}</div>
                <div className="text-[10px] font-black text-green-900 uppercase tracking-widest">Acertos Totais</div>
              </div>
              <div className="bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-200 shadow-sm flex flex-col items-center justify-center">
                <div className="text-4xl font-black text-slate-950 leading-none mb-1">{totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0}%</div>
                <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Aproveitamento Geral</div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-200 mb-10">
              <h3 className="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight flex items-center justify-center gap-2">
                <GraduationCap size={20} className="text-blue-600" /> Placar por Grupo
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {groupScores.map((score, idx) => (
                  <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center">
                    <span className="w-8 h-8 bg-blue-700 text-white rounded-lg flex items-center justify-center font-black text-sm mb-2 shadow-sm">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-slate-500 uppercase mb-1">Grupo {idx + 1}</span>
                    <div className="text-2xl font-black text-slate-900">{score}<span className="text-slate-400 text-xs">/10</span></div>
                    <div className="mt-2 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600" style={{ width: `${(score / 10) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={exportToPDF} 
                className="flex-1 py-5 bg-slate-950 text-white rounded-3xl font-black text-lg hover:bg-black shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                Exportar PDF <FileDown size={22} />
              </button>
              <button 
                onClick={resetQuiz} 
                className="flex-1 py-5 bg-blue-700 text-white rounded-3xl font-black text-lg hover:bg-blue-800 shadow-xl shadow-blue-200 transition-all active:scale-95"
              >
                Novo Simulado
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
