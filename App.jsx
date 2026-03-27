import React, { useState, useEffect } from 'react';
import { BookOpen, PenTool, Copy, CheckCircle, Loader2, Sparkles, RefreshCw, Info, LayoutTemplate, Calendar, Gift, DollarSign, Trash2, Plus, Clock, TrendingUp, ChevronLeft, ChevronRight, X, BarChart3, Settings2, PieChart, Menu } from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- 나만의 Firebase 클라우드 세팅 ---
let app, auth, db, appId;
try {
  // 배포 시 내 Firebase를 바라보도록 설정 (현재 테스트 환경과 호환 유지)
  const firebaseConfig = typeof __firebase_config !== 'undefined' 
    ? JSON.parse(__firebase_config) 
    : {
        apiKey: "AIzaSyDH56ZTcYkeH2HxRCnzho9MSgKs8vFO1VQ",
        authDomain: "powerbloger-e514b.firebaseapp.com",
        projectId: "powerbloger-e514b",
        storageBucket: "powerbloger-e514b.firebasestorage.app",
        messagingSenderId: "311330371495",
        appId: "1:311330371495:web:f8b96031ade4e86015e882",
        measurementId: "G-3XMK3PL4T5"
      };
      
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  appId = typeof __app_id !== 'undefined' ? __app_id : 'powerbloger-app';
} catch (e) {
  console.error("Firebase init error:", e);
}

// --- 제미나이 API 호출 함수 ---
const callGemini = async (prompt, systemInstruction = "") => {
  // ★ Vercel 등 외부 배포 시, 아래 빈 따옴표 안에 아까 발급받은 제미나이 키를 넣으세요! ★
  // 예: const apiKey = "AIzaSyBzlYhlhNSXCe6HJP9PxV8NTySWFm4tsqU";
  const apiKey = "AIzaSyBzlYhlhNSXCe6HJP9PxV8NTySWFm4tsqU"; 
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } })
  };

  const delay = (ms) => new Promise(res => setTimeout(res, ms));
  const retries = [1000, 2000, 4000, 8000, 16000];

  for (let attempt = 0; attempt <= retries.length; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "결과를 생성하지 못했습니다.";
    } catch (error) {
      if (attempt === retries.length) {
        throw new Error("AI 서버와 통신 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
      await delay(retries[attempt]);
    }
  }
};

const CATEGORIES = ['일상', '숙소', '맛집', '식물', '뷰티'];

export default function App() {
  // --- 클라우드 자동 저장 상태 ---
  const [user, setUser] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true); // 사이드바 펼침/접힘 상태

  const [activeTab, setActiveTab] = useState('generation');
  
  // 카테고리별 학습된 스타일
  const [learnedStyles, setLearnedStyles] = useState({
    '일상': '아직 학습된 스타일이 없습니다. 예시 글을 넣고 학습시켜주세요.',
    '숙소': '아직 학습된 스타일이 없습니다. 예시 글을 넣고 학습시켜주세요.',
    '맛집': '아직 학습된 스타일이 없습니다. 예시 글을 넣고 학습시켜주세요.',
    '식물': '아직 학습된 스타일이 없습니다. 예시 글을 넣고 학습시켜주세요.',
    '뷰티': '아직 학습된 스타일이 없습니다. 예시 글을 넣고 학습시켜주세요.',
  });

  const [activeCategory, setActiveCategory] = useState('맛집');
  const [learningInput, setLearningInput] = useState('');
  const [isLearning, setIsLearning] = useState(false);

  // 리뷰 생성 폼
  const [genInputs, setGenInputs] = useState({ 
    title: '', pros: '', cons: '', keywords: '', wordCount: '', photoCount: '', tone: '', avoidKeywords: ''
  });
  const [generatedPosts, setGeneratedPosts] = useState([]);
  const [activeVersionTab, setActiveVersionTab] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // --- 협찬 및 일정 관리 상태 ---
  const SPONSOR_SITES = ['레뷰', '디너의여왕', '강남맛집', '링블', '리플', '개인협찬', '기타'];
  const [campaigns, setCampaigns] = useState([]);
  
  const [newCampaign, setNewCampaign] = useState({ 
    site: '레뷰', title: '', item: '', region: '', amount: '', visitDate: '', deadline: '', notes: '' 
  });
  
  const [campaignFilter, setCampaignFilter] = useState('전체'); 
  const [sortOption, setSortOption] = useState('마감순'); 
  const [statusFilter, setStatusFilter] = useState('전체'); 

  // --- 광고수익 (애드포스트) 상태 ---
  const [adRevenue, setAdRevenue] = useState({});
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingDate, setEditingDate] = useState(null);
  const [editAmount, setEditAmount] = useState('');

  // --- 클라우드 인증 및 데이터 동기화 (useEffect) ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error('인증 에러:', error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 클라우드에서 내 데이터 불러오기
  useEffect(() => {
    if (!user || !db) return;

    const stylesRef = doc(db, 'artifacts', appId, 'users', user.uid, 'appData', 'styles');
    const unsubStyles = onSnapshot(stylesRef, (docSnap) => {
      if (docSnap.exists()) setLearnedStyles(docSnap.data().data);
    }, (err) => console.error(err));

    const campaignsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'appData', 'campaigns');
    const unsubCampaigns = onSnapshot(campaignsRef, (docSnap) => {
      if (docSnap.exists()) setCampaigns(docSnap.data().data);
    }, (err) => console.error(err));

    const revenueRef = doc(db, 'artifacts', appId, 'users', user.uid, 'appData', 'adRevenue');
    const unsubRevenue = onSnapshot(revenueRef, (docSnap) => {
      if (docSnap.exists()) setAdRevenue(docSnap.data().data);
    }, (err) => console.error(err));

    return () => { unsubStyles(); unsubCampaigns(); unsubRevenue(); };
  }, [user]);

  // 클라우드 저장 헬퍼 함수들
  const updateLearnedStyles = async (newStyles) => {
    setLearnedStyles(newStyles);
    if (user && db) {
      setIsSyncing(true);
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'appData', 'styles'), { data: newStyles });
      setIsSyncing(false);
    }
  };

  const updateCampaigns = async (newCampaigns) => {
    setCampaigns(newCampaigns);
    if (user && db) {
      setIsSyncing(true);
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'appData', 'campaigns'), { data: newCampaigns });
      setIsSyncing(false);
    }
  };

  const updateAdRevenue = async (newRevenue) => {
    setAdRevenue(newRevenue);
    if (user && db) {
      setIsSyncing(true);
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'appData', 'adRevenue'), { data: newRevenue });
      setIsSyncing(false);
    }
  };

  const extractNumber = (str) => {
    if (!str) return 0;
    let multiplier = str.includes('만') ? 10000 : 1;
    const numStr = str.replace(/[^0-9.]/g, '');
    return (parseFloat(numStr) || 0) * multiplier;
  };

  const calculateDDay = (dateString) => {
    if (!dateString) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateString);
    const diff = target.getTime() - today.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'D-Day';
    return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
  };

  const handleAddCampaign = () => {
    if (!newCampaign.title || !newCampaign.deadline) return alert('상호명(프로젝트명)과 마감일은 필수입니다!');
    updateCampaigns([...campaigns, { ...newCampaign, id: Date.now(), status: 'pending', expStatus: 'pending', paybackStatus: false }]);
    setNewCampaign({ site: '레뷰', title: '', item: '', region: '', amount: '', visitDate: '', deadline: '', notes: '' });
  };

  const toggleCampaignStatus = (id) => {
    updateCampaigns(campaigns.map(c => c.id === id ? { ...c, status: c.status === 'pending' ? 'completed' : 'pending' } : c));
  };

  const toggleExpStatus = (id) => {
    updateCampaigns(campaigns.map(c => {
      if (c.id === id) {
        const nextStatus = c.expStatus === 'pending' ? 'shipping' : c.expStatus === 'shipping' ? 'completed' : 'pending';
        return { ...c, expStatus: nextStatus };
      }
      return c;
    }));
  };

  const togglePaybackStatus = (id) => {
    updateCampaigns(campaigns.map(c => c.id === id ? { ...c, paybackStatus: !c.paybackStatus } : c));
  };

  const deleteCampaign = (id) => {
    updateCampaigns(campaigns.filter(c => c.id !== id));
  };

  // --- 광고수익 로직 ---
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const openRevenueModal = (dateStr, currentAmount) => {
    setEditingDate(dateStr);
    setEditAmount(currentAmount ? currentAmount.toString() : '');
  };

  const saveRevenue = () => {
    const numAmount = parseInt(editAmount.replace(/[^0-9]/g, ''), 10);
    const newRevenue = { ...adRevenue };
    if (isNaN(numAmount) || numAmount === 0) delete newRevenue[editingDate];
    else newRevenue[editingDate] = numAmount;
    
    updateAdRevenue(newRevenue);
    setEditingDate(null);
  };

  // --- 통계 요약 계산 ---
  const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const monthlyEntries = Object.entries(adRevenue).filter(([date, amt]) => date.startsWith(currentYearMonth) && amt > 0);
  const totalRevenue = monthlyEntries.reduce((sum, [_, amt]) => sum + amt, 0);
  const maxRevenue = monthlyEntries.length > 0 ? Math.max(...monthlyEntries.map(e => e[1])) : 0;
  const avgRevenue = monthlyEntries.length > 0 ? Math.round(totalRevenue / monthlyEntries.length) : 0;

  const allEntries = Object.entries(adRevenue).filter(([_, amt]) => amt > 0);
  const allTimeTotal = allEntries.reduce((sum, [_, amt]) => sum + amt, 0);
  const allTimeMax = allEntries.length > 0 ? Math.max(...allEntries.map(e => e[1])) : 0;
  const allTimeAvg = allEntries.length > 0 ? Math.round(allTimeTotal / allEntries.length) : 0;

  const sponsorSiteStats = {};
  campaigns.forEach(c => {
    if (!sponsorSiteStats[c.site]) sponsorSiteStats[c.site] = { totalAmount: 0, count: 0, completedCount: 0 };
    sponsorSiteStats[c.site].totalAmount += extractNumber(c.amount);
    sponsorSiteStats[c.site].count += 1;
    if (c.status === 'completed') sponsorSiteStats[c.site].completedCount += 1;
  });

  const totalSponsorAmount = campaigns.reduce((sum, c) => sum + extractNumber(c.amount), 0);
  const completedSponsorAmount = campaigns.filter(c => c.status === 'completed').reduce((sum, c) => sum + extractNumber(c.amount), 0);
  const sortedSponsorSites = Object.entries(sponsorSiteStats)
    .filter(([_, data]) => data.count > 0)
    .sort((a, b) => b[1].totalAmount - a[1].totalAmount);

  // --- 알고리즘 학습 로직 ---
  const handleLearnStyle = async () => {
    if (!learningInput.trim()) return alert("학습할 블로그 글을 입력해주세요!");
    setIsLearning(true);

    try {
      const currentStyle = learnedStyles[activeCategory];
      let prompt = `다음은 내 블로그의 [${activeCategory}] 카테고리 포스팅 예시입니다.\n`;
      prompt += `이 글의 문체(존댓말/반말, 어미), 이모티콘 사용 빈도, 문단 나누기 방식, 강조 포인트를 분석해주세요.\n`;
      
      if (currentStyle && !currentStyle.includes('아직 학습된')) {
        prompt += `\n기존 규칙:\n${currentStyle}\n`;
        prompt += `\n새로운 예시를 바탕으로 규칙을 정교하게 업데이트하여 '핵심 가이드라인 5가지'를 마크다운으로 요약해줘.\n`;
      } else {
        prompt += `\nAI가 이 스타일을 완벽하게 모방하도록 '핵심 가이드라인 5가지'를 마크다운으로 요약해줘.\n`;
      }
      prompt += `\n[예시 글]:\n${learningInput}`;

      const newStyle = await callGemini(prompt, "너는 블로그 글쓰기 스타일 분석 전문가야.");
      updateLearnedStyles({ ...learnedStyles, [activeCategory]: newStyle });
      setLearningInput('');
      alert(`${activeCategory} 카테고리 학습이 완료되었습니다! 클라우드에 자동 저장됩니다.`);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsLearning(false);
    }
  };

  // --- 리뷰 생성 로직 ---
  const handleGeneratePost = async () => {
    if (!genInputs.title) return alert("제품/장소명을 입력해주세요!");
    setIsGenerating(true);
    setCopied(false);
    setGeneratedPosts([]);

    try {
      const styleGuide = learnedStyles[activeCategory];
      let prompt = `주제: ${genInputs.title}\n장점/특징: ${genInputs.pros || '특별한 장점 없음'}\n단점/아쉬운점: ${genInputs.cons || '특별한 단점 없음'}\n`;
      
      if (genInputs.keywords) prompt += `필수 포함 키워드: ${genInputs.keywords}\n`;
      if (genInputs.avoidKeywords) prompt += `절대 포함하면 안 되는 금지어: ${genInputs.avoidKeywords} (본문에 절대 쓰지 마)\n`;
      if (genInputs.wordCount) prompt += `요구 분량: ${genInputs.wordCount}\n`;
      if (genInputs.tone) prompt += `원하는 분위기: ${genInputs.tone}\n`;
      if (genInputs.photoCount) prompt += `사진 배치: ${genInputs.photoCount} (조건에 맞춰 본문 중간에 "[사진 들어갈 곳]" 적절히 분배해)\n`;

      prompt += `
위 내용을 바탕으로 네이버 블로그 포스팅 초안을 작성해줘. 제목도 추천해줘.
서로 다른 도입부, 분위기, 전개 방식을 가진 **3가지 다른 버전**의 블로그 초안을 작성해줘.
각 버전 사이에는 반드시 "|||" 기호만 넣어서 구분해줘.`;

      const systemInstruction = `너는 내 블로그 메인 에디터야. 아래 [글쓰기 가이드라인]을 철저하게 지켜서 작성해야 해. 자연스러운 사람 냄새가 나야 해.\n[글쓰기 가이드라인]\n${styleGuide}`;

      const result = await callGemini(prompt, systemInstruction);
      const versions = result.split('|||').map(v => v.trim()).filter(v => v.length > 0);
      
      if (versions.length > 0) {
        setGeneratedPosts(versions);
        setActiveVersionTab(0);
      } else {
        throw new Error("결과 파싱 실패. 다시 시도해주세요.");
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (generatedPosts.length === 0) return;
    const textArea = document.createElement("textarea");
    textArea.value = generatedPosts[activeVersionTab];
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {}
    document.body.removeChild(textArea);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-gray-800 overflow-hidden">
      
      {/* Sidebar Navigation */}
      <nav className={`bg-white border-b md:border-b-0 md:border-r border-gray-200 px-4 py-3 md:py-6 flex flex-row md:flex-col gap-2 z-20 flex-shrink-0 overflow-x-auto items-center md:items-stretch no-scrollbar transition-all duration-300 w-full ${isSidebarExpanded ? 'md:w-64' : 'md:w-20'}`}>
        <div className={`flex items-center px-2 md:mb-6 flex-shrink-0 mr-4 md:mr-0 ${isSidebarExpanded ? 'justify-between' : 'justify-center w-full'}`}>
          <div className={`flex items-center gap-2 ${!isSidebarExpanded ? 'md:hidden' : ''}`}>
            <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-[#03C75A]" />
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-gray-900 whitespace-nowrap">블로그 AI메이트</h1>
          </div>
          <button 
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
            className="hidden md:flex p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
            title={isSidebarExpanded ? "메뉴 접기" : "메뉴 펼치기"}
          >
            {isSidebarExpanded ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-6 h-6 text-gray-700" />}
          </button>
        </div>
        
        <button onClick={() => setActiveTab('generation')} title={!isSidebarExpanded ? "블로그 리뷰 생성" : ""} className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap flex-shrink-0 text-sm md:text-base ${isSidebarExpanded ? 'md:px-4 justify-start' : 'md:px-0 md:justify-center'} ${activeTab === 'generation' ? 'bg-[#03C75A]/10 text-[#03C75A] font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}>
          <PenTool className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
          <span className={!isSidebarExpanded ? 'md:hidden' : ''}>블로그 리뷰 생성</span>
        </button>

        <button onClick={() => setActiveTab('learning')} title={!isSidebarExpanded ? "알고리즘 학습" : ""} className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap flex-shrink-0 text-sm md:text-base ${isSidebarExpanded ? 'md:px-4 justify-start' : 'md:px-0 md:justify-center'} ${activeTab === 'learning' ? 'bg-[#03C75A]/10 text-[#03C75A] font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}>
          <BookOpen className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
          <span className={!isSidebarExpanded ? 'md:hidden' : ''}>알고리즘 학습 메뉴</span>
        </button>

        <button onClick={() => setActiveTab('campaigns')} title={!isSidebarExpanded ? "협찬 & 일정 관리" : ""} className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap flex-shrink-0 text-sm md:text-base ${isSidebarExpanded ? 'md:px-4 justify-start' : 'md:px-0 md:justify-center'} ${activeTab === 'campaigns' ? 'bg-[#03C75A]/10 text-[#03C75A] font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}>
          <Calendar className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
          <span className={!isSidebarExpanded ? 'md:hidden' : ''}>협찬 & 일정 관리</span>
        </button>

        <button onClick={() => setActiveTab('stats')} title={!isSidebarExpanded ? "협찬 성과 통계" : ""} className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap flex-shrink-0 text-sm md:text-base ${isSidebarExpanded ? 'md:px-4 justify-start' : 'md:px-0 md:justify-center'} ${activeTab === 'stats' ? 'bg-[#03C75A]/10 text-[#03C75A] font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}>
          <PieChart className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
          <span className={!isSidebarExpanded ? 'md:hidden' : ''}>협찬 성과 통계</span>
        </button>

        <button onClick={() => setActiveTab('ad_revenue')} title={!isSidebarExpanded ? "광고수익" : ""} className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap flex-shrink-0 text-sm md:text-base ${isSidebarExpanded ? 'md:px-4 justify-start' : 'md:px-0 md:justify-center'} ${activeTab === 'ad_revenue' ? 'bg-[#03C75A]/10 text-[#03C75A] font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}>
          <TrendingUp className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
          <span className={!isSidebarExpanded ? 'md:hidden' : ''}>광고수익 (애드포스트)</span>
        </button>

        <div className={`mt-auto p-4 bg-gray-50 rounded-xl border border-gray-100 text-sm text-gray-500 leading-relaxed hidden ${isSidebarExpanded ? 'md:block' : 'md:hidden'}`}>
          <Info className="w-4 h-4 mb-2 inline-block mr-1 text-[#03C75A]"/><br/>
          한 번에 <b>3가지 버전</b>의 포스팅 초안을 생성합니다.
          <div className="mt-4 pt-3 border-t border-gray-200 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${user ? (isSyncing ? 'bg-orange-400 animate-pulse' : 'bg-[#03C75A]') : 'bg-gray-300'}`}></div>
            <span className="text-xs font-semibold">{user ? (isSyncing ? '클라우드 동기화 중...' : '클라우드 자동 저장됨') : '오프라인 모드'}</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto scroll-smooth">
        {(activeTab === 'learning' || activeTab === 'generation') && (
          <div className="mb-6 md:mb-8">
            <h2 className="text-xs md:text-sm font-bold text-gray-500 mb-2 md:mb-3 uppercase tracking-wider">카테고리 선택</h2>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-4 py-1.5 md:px-5 md:py-2 rounded-full text-sm md:text-base font-medium transition-all duration-200 border ${activeCategory === cat ? 'bg-[#03C75A] text-white border-[#03C75A] shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:border-[#03C75A]/50 hover:bg-gray-50'}`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 1. LEARNING TAB */}
        {activeTab === 'learning' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BookOpen className="w-6 h-6 text-[#03C75A]" /> 내 블로그 스타일 학습하기</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <label className="block text-sm font-semibold text-gray-700 mb-2">기존 '{activeCategory}' 블로그 글 붙여넣기</label>
                <textarea value={learningInput} onChange={(e) => setLearningInput(e.target.value)} placeholder="본문 내용을 복사해서 붙여넣으세요." className="w-full h-64 p-4 rounded-xl border border-gray-200 focus:border-[#03C75A] focus:ring-2 focus:ring-[#03C75A]/20 resize-none outline-none transition-all text-sm" />
                <button onClick={handleLearnStyle} disabled={isLearning} className="w-full mt-4 bg-[#03C75A] hover:bg-[#02b350] text-white font-semibold py-3 rounded-xl transition-colors flex justify-center items-center gap-2 disabled:opacity-70">
                  {isLearning ? <><Loader2 className="w-5 h-5 animate-spin" /> 학습 중...</> : <><RefreshCw className="w-5 h-5" /> 알고리즘 업데이트</>}
                </button>
              </div>
              <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200 flex flex-col">
                <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-[#03C75A]" /> 현재 '{activeCategory}' 규칙</h3>
                <div className="prose prose-sm max-w-none text-gray-600 bg-white p-5 rounded-xl border border-gray-100 flex-1 overflow-y-auto whitespace-pre-wrap">{learnedStyles[activeCategory]}</div>
              </div>
            </div>
          </div>
        )}

        {/* 2. GENERATION TAB */}
        {activeTab === 'generation' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><PenTool className="w-6 h-6 text-[#03C75A]" /> 리뷰 자동 생성</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 flex flex-col gap-4">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 h-full flex flex-col">
                  <div className="space-y-4 mb-6">
                    <div><label className="block text-sm font-semibold text-gray-700 mb-1">제품 / 장소명 *</label><input type="text" value={genInputs.title} onChange={(e) => setGenInputs({...genInputs, title: e.target.value})} className="w-full p-3 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                    <div><label className="block text-sm font-semibold text-gray-700 mb-1">장점</label><textarea value={genInputs.pros} onChange={(e) => setGenInputs({...genInputs, pros: e.target.value})} className="w-full p-3 rounded-xl border border-gray-200 outline-none resize-none h-20 text-sm" /></div>
                    <div><label className="block text-sm font-semibold text-gray-700 mb-1">단점</label><textarea value={genInputs.cons} onChange={(e) => setGenInputs({...genInputs, cons: e.target.value})} className="w-full p-3 rounded-xl border border-gray-200 outline-none resize-none h-16 text-sm" /></div>
                  </div>
                  <div className="border-t border-gray-100 pt-5 space-y-4 flex-1">
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3"><Settings2 className="w-4 h-4 text-indigo-500" /> 상세 조건</h3>
                    <div><label className="block text-xs font-semibold text-gray-500 mb-1">필수 키워드</label><input type="text" value={genInputs.keywords} onChange={(e) => setGenInputs({...genInputs, keywords: e.target.value})} className="w-full p-2.5 rounded-lg border border-gray-200 text-sm bg-gray-50" /></div>
                    <div><label className="block text-xs font-semibold text-gray-500 mb-1">피해야 할 문구 (금지어)</label><input type="text" value={genInputs.avoidKeywords} onChange={(e) => setGenInputs({...genInputs, avoidKeywords: e.target.value})} className="w-full p-2.5 rounded-lg border border-red-200 text-sm bg-red-50/50" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs font-semibold text-gray-500 mb-1">사진 개수</label><input type="text" value={genInputs.photoCount} onChange={(e) => setGenInputs({...genInputs, photoCount: e.target.value})} className="w-full p-2.5 rounded-lg border border-gray-200 text-sm bg-gray-50" /></div>
                      <div><label className="block text-xs font-semibold text-gray-500 mb-1">목표 글자수</label><input type="text" value={genInputs.wordCount} onChange={(e) => setGenInputs({...genInputs, wordCount: e.target.value})} className="w-full p-2.5 rounded-lg border border-gray-200 text-sm bg-gray-50" /></div>
                    </div>
                    <div><label className="block text-xs font-semibold text-gray-500 mb-1">원하는 분위기/컨셉</label><input type="text" value={genInputs.tone} onChange={(e) => setGenInputs({...genInputs, tone: e.target.value})} className="w-full p-2.5 rounded-lg border border-gray-200 text-sm bg-gray-50" /></div>
                  </div>
                  <button onClick={handleGeneratePost} disabled={isGenerating || !genInputs.title} className="w-full mt-6 bg-gray-900 hover:bg-black text-white font-semibold py-3.5 rounded-xl flex justify-center items-center gap-2 disabled:opacity-70">
                    {isGenerating ? <><Loader2 className="w-5 h-5 animate-spin" /> 3개 뽑는 중...</> : <><LayoutTemplate className="w-5 h-5" /> 3개 초안 뽑기</>}
                  </button>
                </div>
              </div>
              <div className="lg:col-span-8">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full min-h-[550px]">
                  <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <h3 className="font-semibold text-gray-800">완성된 초안</h3>
                    <button onClick={copyToClipboard} disabled={generatedPosts.length === 0} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${copied ? 'bg-[#03C75A] text-white' : 'bg-white border text-gray-700'}`}>
                      {copied ? <><CheckCircle className="w-4 h-4" /> 복사 완료!</> : <><Copy className="w-4 h-4" /> 현재 버전 복사하기</>}
                    </button>
                  </div>
                  {generatedPosts.length > 0 && (
                    <div className="flex border-b border-gray-100 px-2 pt-2 bg-gray-50 overflow-x-auto no-scrollbar">
                      {generatedPosts.map((_, index) => (
                        <button key={index} onClick={() => setActiveVersionTab(index)} className={`px-6 py-3 text-sm font-semibold rounded-t-lg whitespace-nowrap ${activeVersionTab === index ? 'bg-white text-[#03C75A] border-t border-l border-r border-gray-100 shadow-[0_-2px_4px_rgba(0,0,0,0.02)] -mb-[1px]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>버전 {index + 1}</button>
                      ))}
                    </div>
                  )}
                  <div className="p-6 flex-1 overflow-y-auto bg-white rounded-b-2xl">
                    {generatedPosts.length > 0 ? <div className="prose prose-gray max-w-none whitespace-pre-wrap text-sm md:text-base">{generatedPosts[activeVersionTab]}</div> : <div className="h-full flex flex-col items-center justify-center text-gray-400"><LayoutTemplate className="w-12 h-12 mb-3 opacity-20" /><p>내용을 입력하고 버튼을 눌러보세요.</p></div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. CAMPAIGNS TAB */}
        {activeTab === 'campaigns' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
            <div className="mb-6"><h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Calendar className="w-6 h-6 text-[#03C75A]" /> 협찬 & 일정 관리</h2></div>
            <div className="flex flex-col gap-6 h-full">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex-shrink-0">
                <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-4 h-4 text-[#03C75A]" /> 상세 일정 등록</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
                  <div className="col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">플랫폼</label><select value={newCampaign.site} onChange={(e) => setNewCampaign({...newCampaign, site: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm bg-white">{SPONSOR_SITES.map(site => <option key={site} value={site}>{site}</option>)}</select></div>
                  <div className="col-span-1 md:col-span-2 lg:col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">상호명 (프로젝트명) *</label><input type="text" value={newCampaign.title} onChange={(e) => setNewCampaign({...newCampaign, title: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">물품 (제공내역)</label><input type="text" value={newCampaign.item} onChange={(e) => setNewCampaign({...newCampaign, item: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">지역</label><input type="text" value={newCampaign.region} onChange={(e) => setNewCampaign({...newCampaign, region: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">금액</label><input type="text" value={newCampaign.amount} onChange={(e) => setNewCampaign({...newCampaign, amount: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">예약날짜</label><input type="date" value={newCampaign.visitDate} onChange={(e) => setNewCampaign({...newCampaign, visitDate: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-1"><label className="block text-[11px] font-bold text-gray-500 mb-1">포스팅 기한 *</label><input type="date" value={newCampaign.deadline} onChange={(e) => setNewCampaign({...newCampaign, deadline: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-1 md:col-span-2 lg:col-span-2"><label className="block text-[11px] font-bold text-gray-500 mb-1">비고</label><input type="text" value={newCampaign.notes} onChange={(e) => setNewCampaign({...newCampaign, notes: e.target.value})} className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm" /></div>
                  <div className="col-span-2 md:col-span-4 lg:col-span-5 flex justify-end mt-2"><button onClick={handleAddCampaign} className="px-8 py-2.5 bg-gray-900 text-white font-semibold rounded-xl flex items-center gap-2 text-sm"><Plus className="w-4 h-4" /> 리스트에 추가</button></div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-4 mb-5">
                  <div className="flex justify-between items-center"><h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Clock className="w-5 h-5 text-gray-600" /> 진행 중인 목록</h3>
                    <div className="flex gap-2">
                      <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="text-xs bg-white text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200"><option>마감순</option><option>등록순</option><option>최신순</option><option>고금액순</option><option>저금액순</option></select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">{['전체', '진행중', '완료됨'].map(status => <button key={status} onClick={() => setStatusFilter(status)} className={`px-4 py-1.5 rounded-full text-xs font-medium border ${statusFilter === status ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200'}`}>{status}</button>)}</div>
                    <div className="flex gap-2 flex-wrap">{['전체', ...SPONSOR_SITES].map(site => <button key={site} onClick={() => setCampaignFilter(site)} className={`px-4 py-1.5 rounded-full text-xs font-medium border ${campaignFilter === site ? 'bg-[#03C75A] text-white border-[#03C75A]' : 'bg-white text-gray-600 border-gray-200'}`}>{site}</button>)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {campaigns.filter(c => campaignFilter === '전체' || c.site === campaignFilter).filter(c => statusFilter === '전체' ? true : statusFilter === '진행중' ? c.status === 'pending' : c.status === 'completed').sort((a, b) => {
                      if (a.status === 'completed' && b.status !== 'completed') return 1; if (a.status !== 'completed' && b.status === 'completed') return -1;
                      switch (sortOption) { case '등록순': return a.id - b.id; case '최신순': return b.id - a.id; case '고금액순': return extractNumber(b.amount) - extractNumber(a.amount); case '저금액순': return extractNumber(a.amount) - extractNumber(b.amount); case '마감순': default: return new Date(a.deadline).getTime() - new Date(b.deadline).getTime(); }
                    }).map(campaign => (
                      <div key={campaign.id} className={`flex flex-col justify-between p-5 rounded-2xl border relative ${campaign.status === 'completed' ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'}`}>
                        <div className="absolute -top-3 right-4 flex gap-1.5 shadow-sm">
                           <button onClick={() => toggleExpStatus(campaign.id)} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${campaign.expStatus === 'completed' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : campaign.expStatus === 'shipping' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-white text-gray-400 border-gray-200'}`}>
                              {campaign.expStatus === 'completed' ? '🎒 체험완료' : campaign.expStatus === 'shipping' ? '🚚 배송중' : '⏳ 체험전'}
                            </button>
                            <button onClick={() => togglePaybackStatus(campaign.id)} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${campaign.paybackStatus ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-gray-400 border-gray-200'}`}>
                                {campaign.paybackStatus ? '💸 페이백완료' : '💳 페이백대기'}
                              </button>
                        </div>
                        <div>
                          <div className="flex justify-between items-start mb-2 pt-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${campaign.status === 'completed' ? 'bg-gray-200 text-gray-600' : 'bg-gray-800 text-white'}`}>{campaign.site}</span>
                              {campaign.region && <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">📍 {campaign.region}</span>}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${calculateDDay(campaign.deadline).includes('+') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{campaign.status === 'completed' ? '종료' : calculateDDay(campaign.deadline)}</span>
                            </div>
                            <button onClick={() => toggleCampaignStatus(campaign.id)} className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${campaign.status === 'completed' ? 'bg-[#03C75A] border-[#03C75A]' : 'border-gray-300'}`}>
                              {campaign.status === 'completed' && <CheckCircle className="w-4 h-4 text-white" />}
                            </button>
                          </div>
                          <h4 className={`font-bold text-[16px] mt-1 ${campaign.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{campaign.title}</h4>
                          {campaign.item && <p className="text-sm font-medium text-[#03C75A] mt-0.5">{campaign.item}</p>}
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-1.5 text-xs text-gray-500">
                          {campaign.visitDate && <div className="flex justify-between"><span>예약날짜:</span><span className="font-semibold text-gray-700">{campaign.visitDate}</span></div>}
                          <div className="flex justify-between"><span>포스팅 기한:</span><span className="font-semibold text-gray-700">{campaign.deadline}</span></div>
                          {campaign.amount && <div className="flex justify-between"><span>금액:</span><span className="font-semibold text-gray-700">{campaign.amount}</span></div>}
                          {campaign.notes && <div className="flex justify-between mt-1 pt-1 border-t border-gray-50"><span>비고:</span><span className="text-gray-600 truncate max-w-[150px]">{campaign.notes}</span></div>}
                        </div>
                        <button onClick={() => deleteCampaign(campaign.id)} className="absolute bottom-4 right-4 text-gray-300 hover:text-red-500 p-1.5 bg-white rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. STATS TAB */}
        {activeTab === 'stats' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col relative">
            <div className="mb-4 md:mb-6"><h2 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2"><PieChart className="w-5 h-5 md:w-6 md:h-6 text-[#03C75A]" /> 협찬 성과 통계</h2></div>
            <div className="flex-1 overflow-y-auto pb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"><p className="text-xs text-gray-500 mb-1">총 누적 협찬 가치</p><p className="text-2xl font-bold text-gray-900 mt-2">{totalSponsorAmount.toLocaleString()}<span className="text-sm ml-1">원</span></p></div>
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"><p className="text-xs text-gray-500 mb-1">수령 완료 가치</p><p className="text-2xl font-bold text-blue-600 mt-2">{completedSponsorAmount.toLocaleString()}<span className="text-sm ml-1">원</span></p></div>
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"><p className="text-xs text-gray-500 mb-1">진행 중인 가치</p><p className="text-2xl font-bold text-orange-600 mt-2">{(totalSponsorAmount - completedSponsorAmount).toLocaleString()}<span className="text-sm ml-1">원</span></p></div>
                <div className="bg-gradient-to-br from-indigo-900 to-slate-800 rounded-2xl p-5 shadow-md text-white"><p className="text-xs text-indigo-300 mb-1">전체 달성률</p><div className="flex items-end gap-2 mt-2"><p className="text-3xl font-bold">{totalSponsorAmount > 0 ? Math.round((completedSponsorAmount / totalSponsorAmount) * 100) : 0}<span className="text-lg ml-1">%</span></p></div></div>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-gray-600" /> 플랫폼별 상세 분석</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sortedSponsorSites.map(([siteName, data]) => {
                  const sitePercentage = totalSponsorAmount > 0 ? Math.round((data.totalAmount / totalSponsorAmount) * 100) : 0;
                  const completionRate = data.count > 0 ? Math.round((data.completedCount / data.count) * 100) : 0;
                  const averageAmount = data.count > 0 ? Math.round(data.totalAmount / data.count) : 0;
                  return (
                    <div key={siteName} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-50 flex justify-center items-center font-bold text-indigo-600 text-sm border">{siteName.substring(0, 2)}</div>
                          <div><h4 className="font-bold text-gray-900">{siteName}</h4><p className="text-[11px] text-gray-500">수익 점유율: {sitePercentage}%</p></div>
                        </div>
                        <div className="text-right"><p className="text-lg font-bold text-indigo-600">{data.totalAmount.toLocaleString()}원</p><p className="text-[11px] text-gray-500">평균 단가: {averageAmount.toLocaleString()}원</p></div>
                      </div>
                      <div className="mt-auto pt-4 border-t border-gray-50 grid grid-cols-2 gap-4">
                        <div><div className="flex justify-between text-[11px] font-semibold text-gray-500 mb-1.5"><span>진행 현황</span><span>{completionRate}%</span></div><div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden"><div className="bg-[#03C75A] h-1.5 rounded-full" style={{ width: `${completionRate}%` }}></div></div></div>
                        <div className="flex justify-end items-center gap-2 text-xs"><span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md font-semibold border border-gray-200">대기 {data.count - data.completedCount}건</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 5. AD REVENUE TAB */}
        {activeTab === 'ad_revenue' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col relative">
            <div className="mb-4 md:mb-6"><h2 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2"><TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-[#03C75A]" /> 광고수익 기록</h2></div>
            <div className="flex flex-col gap-3 md:gap-4 mb-4 md:mb-6">
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-5 md:p-6 shadow-md text-white flex-shrink-0">
                <h3 className="text-xs md:text-sm font-semibold text-gray-300 mb-3 md:mb-4 flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#03C75A]" /> 역대 누적 애드포스트 성과</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 divide-y sm:divide-y-0 sm:divide-x divide-gray-700">
                  <div className="pt-2 sm:pt-0"><p className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1">총 누적 수익</p><p className="text-2xl md:text-3xl font-bold">{allTimeTotal.toLocaleString()}원</p></div>
                  <div className="pt-3 sm:pt-0 sm:pl-4 md:pl-6"><p className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1">전체 일 평균 수익</p><p className="text-lg md:text-xl font-semibold">{allTimeAvg.toLocaleString()}원</p></div>
                  <div className="pt-3 sm:pt-0 sm:pl-4 md:pl-6"><p className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1">역대 최고 매출 (1일)</p><p className="text-lg md:text-xl font-semibold">{allTimeMax.toLocaleString()}원</p></div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm border border-gray-100 flex items-center gap-3 md:gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0"><DollarSign className="w-5 h-5 md:w-6 md:h-6 text-blue-500" /></div>
                  <div><p className="text-[10px] md:text-xs font-semibold text-gray-500 mb-0.5 md:mb-1">{currentDate.getMonth() + 1}월 총 수익</p><p className="text-lg md:text-xl font-bold text-gray-900">{totalRevenue.toLocaleString()}원</p></div>
                </div>
                <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm border border-gray-100 flex items-center gap-3 md:gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0"><TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-emerald-500" /></div>
                  <div><p className="text-[10px] md:text-xs font-semibold text-gray-500 mb-0.5 md:mb-1">{currentDate.getMonth() + 1}월 일 평균</p><p className="text-lg md:text-xl font-bold text-gray-900">{avgRevenue.toLocaleString()}원</p></div>
                </div>
                <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm border border-gray-100 flex items-center gap-3 md:gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-purple-50 flex items-center justify-center flex-shrink-0"><Clock className="w-5 h-5 md:w-6 md:h-6 text-purple-500" /></div>
                  <div><p className="text-[10px] md:text-xs font-semibold text-gray-500 mb-0.5 md:mb-1">{currentDate.getMonth() + 1}월 최고 매출</p><p className="text-lg md:text-xl font-bold text-gray-900">{maxRevenue.toLocaleString()}원</p></div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-6 flex-1 flex flex-col min-h-[400px]">
              <div className="flex justify-between items-center mb-4 md:mb-6">
                <button onClick={handlePrevMonth} className="p-1.5 md:p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5 md:w-6 md:h-6 text-gray-600" /></button>
                <h3 className="text-base md:text-lg font-bold text-gray-800">{currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월</h3>
                <button onClick={handleNextMonth} className="p-1.5 md:p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5 md:w-6 md:h-6 text-gray-600" /></button>
              </div>
              <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden flex-1">
                {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => <div key={day} className={`bg-gray-50 py-2 text-center text-xs md:text-sm font-semibold ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-700'}`}>{day}</div>)}
                {Array.from({ length: getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth()) }).map((_, i) => <div key={`empty-${i}`} className="bg-white min-h-[60px] md:min-h-[90px]" />)}
                {Array.from({ length: getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth()) }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const amount = adRevenue[dateStr];
                  const isToday = new Date().toDateString() === new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toDateString();
                  return (
                    <div key={day} onClick={() => openRevenueModal(dateStr, amount)} className={`bg-white min-h-[60px] md:min-h-[90px] p-1 md:p-2 cursor-pointer hover:bg-gray-50 flex flex-col group ${isToday ? 'ring-2 ring-inset ring-[#03C75A]' : ''}`}>
                      <span className={`text-[10px] md:text-sm font-medium mb-0.5 md:mb-1 ${isToday ? 'text-[#03C75A]' : 'text-gray-600'}`}>{day}</span>
                      {amount && <div className="mt-auto bg-green-50 text-green-700 text-[9px] md:text-xs font-bold py-0.5 px-1 md:py-1 md:px-1.5 rounded text-right truncate">+{amount.toLocaleString()}원</div>}
                      {!amount && <div className="mt-auto opacity-0 md:group-hover:opacity-100 text-[8px] md:text-[10px] text-gray-400 text-right hidden md:block">클릭</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {editingDate && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 rounded-2xl backdrop-blur-sm p-4">
                <div className="bg-white p-5 md:p-6 rounded-2xl shadow-xl w-full max-w-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-gray-800 text-base md:text-lg">{editingDate.split('-')[1]}월 {editingDate.split('-')[2]}일 수익 입력</h4>
                    <button onClick={() => setEditingDate(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="relative mb-5">
                    <input type="text" value={editAmount} onChange={(e) => setEditAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="숫자만 입력" className="w-full p-3 pr-8 rounded-xl border border-gray-200 outline-none text-right font-bold text-base md:text-lg" autoFocus />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">원</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingDate(null)} className="flex-1 py-2.5 md:py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 text-sm md:text-base">취소</button>
                    <button onClick={saveRevenue} className="flex-1 py-2.5 md:py-3 rounded-xl bg-[#03C75A] text-white font-semibold hover:bg-[#02b350] shadow-sm text-sm md:text-base">저장하기</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
