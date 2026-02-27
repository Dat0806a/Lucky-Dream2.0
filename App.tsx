
import React, { useState, useEffect, useRef } from 'react';
import { Garment, GarmentType, GeminiOutfitResponse, Post, ChatConversation, Message, TravelPlan, User } from './types';
import { supabase } from './lib/supabase';
import { authService } from './services/authService';
import { postService } from './services/postService';
import { chatService } from './services/chatService';
import { GarmentCard } from './components/GarmentCard';
import { OutfitResult } from './components/OutfitResult';
import { SocialPost } from './components/SocialPost';
import { ChatPanel } from './components/ChatPanel';
import { AuthView } from './components/AuthView';
import { OnboardingView } from './components/OnboardingView';
import { PersonalizedSetup } from './components/PersonalizedSetup';
import { onboardingManager } from './services/onboardingManager';
import { generateOutfitsFromImages } from './services/geminiService';

const STYLE_CATEGORIES = [
  { id: 's1', name: 'Thượng lưu', icon: 'fa-crown' },
  { id: 's2', name: 'Tối giản', icon: 'fa-leaf' },
  { id: 's3', name: 'Đường phố', icon: 'fa-bolt' },
  { id: 's4', name: 'Công sở', icon: 'fa-briefcase' },
  { id: 's5', name: 'Hẹn hò', icon: 'fa-heart' },
  { id: 's6', name: 'Cổ điển', icon: 'fa-camera' }
];

const GENERATING_STATUSES = [
  "Đang dệt sợi vải ảo...",
  "Đang giải mã phom dáng AI...",
  "Đang cân bằng bảng màu thượng lưu...",
  "Đang đo đạc tỷ lệ vàng cho bộ đồ...",
  "Đang tinh chỉnh phong cách riêng của bạn..."
];

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !sessionStorage.getItem('luckydream_onboarding_session_done');
  });
  const [showPersonalSetup, setShowPersonalSetup] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'generate' | 'profile'>('home');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [tops, setTops] = useState<Garment[]>([]);
  const [bottoms, setBottoms] = useState<Garment[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStatusIdx, setLoadingStatusIdx] = useState(0);
  const [result, setResult] = useState<GeminiOutfitResponse | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatContextPost, setChatContextPost] = useState<Post | null>(null);
  const [activeChatId, setSelectedChatId] = useState<string | null>(null);
  const [travelPlans, setTravelPlans] = useState<Record<number, {plan: TravelPlan, sources: any[], city: string}>>({});
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedHistoryPost, setSelectedHistoryPost] = useState<Post | null>(null);
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);

  const homeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initApp = async () => {
      setIsLoading(true);
      try {
        // Check Supabase Connection
        const { error: pingError } = await supabase.from('profiles').select('count', { count: 'exact', head: true }).limit(1);
        if (pingError && pingError.message.includes('FetchError')) {
          setSupabaseStatus('error');
        } else {
          setSupabaseStatus('connected');
        }

        // Check Auth Session
        const user = await authService.getCurrentUser();
        if (user) {
          setCurrentUser(user);
          // Load Data
          const [fetchedPosts, fetchedChats] = await Promise.all([
            postService.getPosts(),
            chatService.getConversations(user.id)
          ]);
          setPosts(fetchedPosts);
          setConversations(fetchedChats);
        }
      } catch (err) {
        console.error('Init error:', err);
        setSupabaseStatus('error');
      } finally {
        setIsLoading(false);
      }
    };
    initApp();
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (currentUser) {
      const shouldShow = onboardingManager.shouldShow();
      if (shouldShow) {
        setShowPersonalSetup(true);
        onboardingManager.markAsShownInSession();
      }
    }
  }, [currentUser]);

  useEffect(() => {
    let statusInterval: any;
    if (isGenerating) {
      statusInterval = setInterval(() => {
        setLoadingStatusIdx(prev => (prev + 1) % GENERATING_STATUSES.length);
      }, 2500);
    } else {
      setLoadingStatusIdx(0);
    }
    return () => clearInterval(statusInterval);
  }, [isGenerating]);

  const handleOnboardingComplete = () => {
    sessionStorage.setItem('luckydream_onboarding_session_done', 'true');
    setShowOnboarding(false);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-brand-red flex flex-col items-center justify-center z-[500]">
        <div className="w-20 h-20 border-4 border-brand-gold border-t-transparent rounded-full animate-spin mb-6"></div>
        <h2 className="text-brand-gold font-black uppercase tracking-widest animate-pulse">LuckyDream VN</h2>
      </div>
    );
  }

  if (showOnboarding) {
    return <OnboardingView onComplete={handleOnboardingComplete} />;
  }

  if (!currentUser) {
    return <AuthView onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  if (showPersonalSetup) {
    return (
      <PersonalizedSetup 
        onThemeChange={(isDark) => setIsDarkMode(isDark)}
        onComplete={() => setShowPersonalSetup(false)} 
      />
    );
  }

  const handleOpenChatFromPost = async (post: Post) => {
    if (!currentUser || post.user.id === currentUser.id) return;
    
    try {
      let conversationId;
      if (post.isVirtual) {
        // ID của virtual post được lưu trong post.id (đã map từ virtual_posts.id)
        conversationId = await chatService.startVirtualConversation(currentUser.id, post.id);
      } else {
        conversationId = await chatService.startConversation(currentUser.id, post.user.id);
      }
      
      // Refresh conversations to get the new one
      const updated = await chatService.getConversations(currentUser.id);
      setConversations(updated);
      
      setSelectedChatId(conversationId);
      setChatContextPost(post);
      setIsChatOpen(true);
    } catch (err) {
      console.error('Start conversation error:', err);
    }
  };

  const handleSendMessage = async (chatId: string, text: string, messageIdToEdit?: string, replyTo?: Message['replyTo']) => {
    if (!currentUser) return;
    
    try {
      const chat = conversations.find(c => c.id === chatId);
      const isVirtual = chat?.isVirtual || false;

      if (!messageIdToEdit) {
        const newMsg = await chatService.sendMessage(chatId, currentUser.id, text, isVirtual);
        
        // Update local state ONLY, do not refetch all conversations
        setConversations(prev => prev.map(c => {
          if (c.id === chatId) {
            return {
              ...c,
              lastMessage: text,
              messages: [...c.messages, {
                id: newMsg.id,
                text: newMsg.text,
                time: new Date(newMsg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                isMe: true,
                isEdited: false,
                isRecalled: false
              }]
            };
          }
          return c;
        }));
      } else {
        await chatService.editMessage(messageIdToEdit, text, isVirtual);
        
        setConversations(prev => prev.map(c => {
          if (c.id === chatId) {
            return {
              ...c,
              messages: c.messages.map(m => m.id === messageIdToEdit ? { ...m, text: text, isEdited: true } : m)
            };
          }
          return c;
        }));
      }
    } catch (err) {
      console.error('Send message error:', err);
    }
  };

  const handleRecallMessage = async (chatId: string, messageId: string) => {
    try {
      const chat = conversations.find(c => c.id === chatId);
      await chatService.recallMessage(messageId, chat?.isVirtual);
      
      setConversations(prev => prev.map(c => {
        if (c.id === chatId) {
          return {
            ...c,
            messages: c.messages.map(m => m.id === messageId ? { ...m, text: 'Tin nhắn đã được thu hồi', isRecalled: true, reaction: undefined } : m)
          };
        }
        return c;
      }));
    } catch (err) {
      console.error('Recall error:', err);
    }
  };

  const handleDeleteMessage = async (chatId: string, messageId: string) => {
    try {
      const chat = conversations.find(c => c.id === chatId);
      await chatService.deleteMessage(messageId, chat?.isVirtual);
      
      setConversations(prev => prev.map(c => {
        if (c.id === chatId) {
          return {
            ...c,
            messages: c.messages.filter(m => m.id !== messageId)
          };
        }
        return c;
      }));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleReactToMessage = (chatId: string, messageId: string, reaction: string) => {
    setConversations(prev => prev.map(chat => {
      if (chat.id === chatId) {
        return {
          ...chat,
          messages: chat.messages.map(m => {
            if (m.id === messageId) {
              return { ...m, reaction: m.reaction === reaction ? undefined : reaction };
            }
            return m;
          })
        };
      }
      return chat;
    }));
  };

  const handlePublishPost = async (postData: Partial<Post>, onSuccess?: () => void) => {
    if (!currentUser) return;
    
    setIsPublishing(true);
    try {
      // 1. Đảm bảo Profile tồn tại (Double-check để tránh lỗi 23503)
      const verifiedUser = await authService.getCurrentUser();
      if (!verifiedUser) throw new Error('Không thể xác thực người dùng');

      // 2. Lưu bài đăng vào Supabase
      await postService.createPost(postData, verifiedUser.id);
      
      // 3. Làm mới feed
      const updatedPosts = await postService.getPosts();
      setPosts(updatedPosts);
      
      // 4. Gọi callback thành công (để đóng modal)
      if (onSuccess) onSuccess();
      
      // 5. Điều hướng về Trang chủ
      setActiveTab('home'); 
      
      // 6. Cuộn lên đầu trang
      setTimeout(() => {
        if (homeScrollRef.current) {
          homeScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 100);
    } catch (err: any) {
      console.error('Publish error:', err);
      let errorMsg = err.message || 'Unknown error';
      if (err.code === '23503') {
        errorMsg = 'Lỗi hệ thống: Hồ sơ người dùng chưa sẵn sàng. Vui lòng thử lại sau vài giây.';
      }
      alert('Không thể chia sẻ bài đăng. ' + errorMsg);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: GarmentType) => {
    const files = e.target.files;
    if (!files) return;
    (Array.from(files) as File[]).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newGarment: Garment = { id: Math.random().toString(36).substr(2, 9), type, name: file.name, image: reader.result as string };
        if (type === GarmentType.TOP) setTops(prev => [...prev, newGarment]);
        else setBottoms(prev => [...prev, newGarment]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleGenerate = async () => {
    if (tops.length === 0 || bottoms.length === 0) return;
    setIsGenerating(true);
    try {
      const response = await generateOutfitsFromImages(tops, bottoms);
      if (response) {
        setResult(response);
        setTravelPlans({});
      }
    } catch (err) { console.error(err); }
    finally { 
      setTimeout(() => setIsGenerating(false), 500);
    }
  };

  const handleDeletePost = async (postId: string) => {
    console.log("App.tsx: handleDeletePost called with id:", postId);
    try {
      console.log("App.tsx: Calling postService.deletePost...");
      await postService.deletePost(postId);
      console.log("App.tsx: postService.deletePost succeeded");
      
      // Cập nhật UI ngay lập tức
      setPosts(prev => {
        const newPosts = prev.filter(p => p.id !== postId);
        console.log(`App.tsx: Updating posts state. Old length: ${prev.length}, New length: ${newPosts.length}`);
        return newPosts;
      });
      
      // Nếu đang xem chi tiết bài đăng này thì đóng modal
      if (selectedHistoryPost?.id === postId) {
        console.log("App.tsx: Closing history post modal");
        setSelectedHistoryPost(null);
      }
      
      alert('Đã xóa bài viết thành công!');
    } catch (err) {
      console.error('App.tsx: Delete error:', err);
      throw err; // Để SocialPost xử lý loading state
    }
  };

  const myPosts = posts.filter(p => p.user.id === currentUser.id);

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-xl md:max-w-3xl lg:max-w-5xl mx-auto bg-brand-cream dark:bg-slate-950 relative shadow-2xl overflow-hidden font-sans transition-colors duration-300">
      <header className="bg-brand-red dark:bg-slate-900 px-6 pt-12 pb-5 flex items-center justify-between border-b-2 border-brand-gold/40 sticky top-0 z-30 shadow-lg w-full">
        <h1 className="text-2xl font-black text-brand-goldLight tracking-tighter uppercase italic">LuckyDream</h1>
        <div className="flex items-center gap-2">
           <button 
             onClick={() => { 
               setChatContextPost(null); 
               setSelectedChatId(null);
               setIsChatOpen(true); 
             }} 
             className="w-9 h-9 bg-brand-gold/20 rounded-full flex items-center justify-center text-brand-goldLight border border-brand-gold/40 shadow-inner"
           >
             <i className="fa-solid fa-comment-dots"></i>
           </button>
           <button onClick={async () => { await authService.signOut(); setCurrentUser(null); }} className="w-9 h-9 bg-brand-gold/20 rounded-full flex items-center justify-center text-brand-goldLight border border-brand-gold/40 shadow-inner">
             <i className="fa-solid fa-right-from-bracket"></i>
           </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Home Tab */}
        <div ref={homeScrollRef} className={`absolute inset-0 overflow-y-auto smooth-scroll scrollbar-hide ${activeTab === 'home' ? 'block' : 'hidden'}`}>
          <div className="space-y-6 animate-in fade-in duration-500 pb-24">
            <div className="px-6 pt-6">
              <div className="relative h-48 md:h-64 bg-brand-red dark:bg-slate-900 rounded-[2.5rem] overflow-hidden p-8 text-white shadow-xl border-b-4 border-brand-gold/50 flex flex-col justify-center transition-all duration-500">
                <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                  <i className="fa-solid fa-shirt absolute -right-6 -bottom-8 text-[140px] md:text-[200px] text-white opacity-[0.15] dark:opacity-[0.05] rotate-[15deg]"></i>
                </div>
                <div className="relative z-10 space-y-3">
                  <h2 className="text-[28px] md:text-[40px] font-black text-brand-goldLight drop-shadow-md tracking-tight leading-none">Chào {currentUser.name}!</h2>
                  <p className="text-[13px] md:text-[16px] text-white/95 max-w-[240px] md:max-w-md leading-tight font-bold uppercase tracking-wide">Phong cách thượng lưu đang đợi bạn.</p>
                </div>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between px-7">
                <h3 className="text-[10px] md:text-[12px] font-black text-brand-red dark:text-slate-100 uppercase tracking-widest">Khám phá phong cách</h3>
                <span className="text-[9px] md:text-[11px] font-bold text-brand-gold uppercase">Xem thêm</span>
              </div>
              <div className="flex overflow-x-auto gap-4 px-6 pb-2 scrollbar-hide md:justify-center">
                {STYLE_CATEGORIES.map((cat) => (
                  <div key={cat.id} className="flex-shrink-0 flex flex-col items-center gap-2 group cursor-pointer">
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-white dark:bg-slate-900 rounded-3xl border border-brand-gold/20 flex items-center justify-center text-brand-red shadow-sm group-active:scale-90 transition-all">
                      <i className={`fa-solid ${cat.icon} text-xl md:text-2xl`}></i>
                    </div>
                    <span className="text-[9px] font-black uppercase text-slate-500 tracking-tighter">{cat.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <section className="space-y-6 px-6 pt-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm md:text-lg font-black text-brand-red dark:text-slate-100 uppercase tracking-widest">Cộng đồng LuckyDream</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {posts.map(post => (
                  <SocialPost key={post.id} post={post} onTransactionClick={() => handleOpenChatFromPost(post)} isOwnPost={post.user.id === currentUser.id} onDelete={handleDeletePost} />
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Generate Tab */}
        <div className={`absolute inset-0 overflow-y-auto px-6 pt-6 pb-24 smooth-scroll scrollbar-hide ${activeTab === 'generate' ? 'block' : 'hidden'}`}>
           <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500 pb-10">
            {!result ? (
              <>
                <section className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="font-black text-brand-red dark:text-slate-200 uppercase text-xs tracking-wider">Áo (Tops)</h3>
                    <label className="text-brand-goldLight bg-brand-red text-[10px] font-black px-4 py-2 rounded-full cursor-pointer border border-brand-gold/30">+ THÊM<input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, GarmentType.TOP)} /></label>
                  </div>
                  {tops.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-brand-gold/20 rounded-[2rem] h-32 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">Chưa có ảnh áo</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">{tops.map(g => <GarmentCard key={g.id} garment={g} onRemove={() => setTops(tops.filter(i => i.id !== g.id))} />)}</div>
                  )}
                </section>
                <section className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="font-black text-brand-red dark:text-slate-200 uppercase text-xs tracking-wider">Quần & Váy</h3>
                    <label className="text-brand-goldLight bg-brand-red text-[10px] font-black px-4 py-2 rounded-full cursor-pointer border border-brand-gold/30">+ THÊM<input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, GarmentType.BOTTOM)} /></label>
                  </div>
                  {bottoms.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-brand-gold/20 rounded-[2rem] h-32 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">Chưa có ảnh quần</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">{bottoms.map(g => <GarmentCard key={g.id} garment={g} onRemove={() => setBottoms(bottoms.filter(i => i.id !== g.id))} />)}</div>
                  )}
                </section>
                <button onClick={handleGenerate} disabled={isGenerating || tops.length === 0} className="w-full h-16 bg-brand-red text-brand-goldLight rounded-[1.5rem] font-black shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-all">
                  {isGenerating ? <i className="fa-solid fa-circle-notch animate-spin"></i> : "PHỐI ĐỒ NGAY"}
                </button>
              </>
            ) : (
              <div className="space-y-12 pb-10">
                <div className="flex items-center justify-between px-1">
                   <h3 className="text-xl md:text-3xl font-black text-brand-red uppercase tracking-tighter">Gợi ý phong cách</h3>
                   <button onClick={() => { setResult(null); setTravelPlans({}); }} className="text-[10px] font-black text-white bg-brand-red px-4 py-2 rounded-full border border-brand-gold/30 uppercase">Làm lại</button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  {result.outfits.map((outfit, idx) => (
                    <OutfitResult key={idx} outfit={outfit} top={tops[outfit.topIndex]} bottom={bottoms[outfit.bottomIndex]} savedTravelPlan={travelPlans[idx]} onTravelPlanGenerated={(data) => setTravelPlans(prev => ({...prev, [idx]: data}))} onPostPublished={handlePublishPost} isPublishing={isPublishing} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Profile Tab */}
        <div className={`absolute inset-0 overflow-y-auto px-6 pt-6 pb-24 smooth-scroll scrollbar-hide ${activeTab === 'profile' ? 'block' : 'hidden'}`}>
          <div className="space-y-8 animate-in slide-in-from-left-4 duration-500 pb-10 max-w-2xl mx-auto">
            {/* Header with Stats */}
            <div className="flex flex-col items-center pt-8 space-y-5">
              <div className="relative">
                <div className="w-28 h-28 bg-brand-red rounded-[2.8rem] flex items-center justify-center text-4xl text-brand-gold border-4 border-brand-gold shadow-[0_10px_40px_rgba(128,0,0,0.3)] relative overflow-hidden group">
                  {currentUser.avatar.startsWith('http') ? (
                    <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover relative z-10" />
                  ) : (
                    <span className="font-black relative z-10">{currentUser.avatar}</span>
                  )}
                  <div className="absolute inset-0 bg-brand-gold/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20"></div>
                </div>
                <div className="absolute -bottom-1 -right-1 w-9 h-9 bg-brand-gold rounded-full flex items-center justify-center border-4 border-brand-cream dark:border-slate-950 shadow-lg">
                  <i className="fa-solid fa-check text-brand-red text-xs"></i>
                </div>
              </div>
              
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-black text-brand-red dark:text-slate-100 uppercase tracking-tighter">{currentUser.name}</h2>
                <div className="flex flex-col items-center justify-center gap-2">
                   <span className="text-[10px] font-black text-brand-gold uppercase tracking-[0.2em] bg-brand-red px-4 py-1.5 rounded-full shadow-sm">{currentUser.level}</span>
                   <div className="flex items-center gap-1.5 mt-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        supabaseStatus === 'connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                        supabaseStatus === 'error' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'
                      }`}></div>
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                        Supabase: {supabaseStatus === 'connected' ? 'Đã kết nối' : supabaseStatus === 'error' ? 'Lỗi kết nối' : 'Đang kiểm tra...'}
                      </span>
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-3 w-full bg-white dark:bg-slate-900/50 rounded-[2.5rem] py-5 border border-brand-gold/10 shadow-sm">
                <div className="text-center border-r border-brand-gold/10 px-2">
                   <p className="text-lg font-black text-brand-red dark:text-slate-100 leading-none">{myPosts.length}</p>
                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Bài viết</p>
                </div>
                <div className="text-center border-r border-brand-gold/10 px-2">
                   <p className="text-lg font-black text-brand-red dark:text-slate-100 leading-none">1.2K</p>
                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Followers</p>
                </div>
                <div className="text-center px-2">
                   <p className="text-lg font-black text-brand-red dark:text-slate-100 leading-none">482</p>
                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Following</p>
                </div>
              </div>
            </div>

            {/* Premium Settings Groups */}
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4">Hệ thống & Giao diện</h3>
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-brand-gold/10 overflow-hidden shadow-sm">
                  {/* Dark Mode */}
                  <div className="flex items-center justify-between p-5 border-b border-brand-gold/5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 shadow-inner">
                        <i className={`fa-solid ${isDarkMode ? 'fa-moon' : 'fa-sun'}`}></i>
                      </div>
                      <span className="text-sm font-black text-brand-red dark:text-slate-200 uppercase tracking-tight">Giao diện tối</span>
                    </div>
                    <button onClick={() => setIsDarkMode(!isDarkMode)} className={`w-12 h-6 rounded-full transition-all relative ${isDarkMode ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${isDarkMode ? 'left-7' : 'left-1'}`}></div>
                    </button>
                  </div>

                  {/* Language */}
                  <button className="w-full flex items-center justify-between p-5 border-b border-brand-gold/5 active:bg-brand-cream dark:active:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-brand-gold/10 rounded-2xl flex items-center justify-center text-brand-gold">
                        <i className="fa-solid fa-earth-asia"></i>
                      </div>
                      <span className="text-sm font-black text-brand-red dark:text-slate-200 uppercase tracking-tight">Ngôn ngữ</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400">Tiếng Việt</span>
                      <i className="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>
                    </div>
                  </button>

                  {/* Notifications */}
                  <button className="w-full flex items-center justify-between p-5 active:bg-brand-cream dark:active:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-brand-red/5 rounded-2xl flex items-center justify-center text-brand-red">
                        <i className="fa-solid fa-bell"></i>
                      </div>
                      <span className="text-sm font-black text-brand-red dark:text-slate-200 uppercase tracking-tight">Thông báo</span>
                    </div>
                    <i className="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4">Tài khoản & Bảo mật</h3>
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-brand-gold/10 overflow-hidden shadow-sm">
                  {/* Account Settings */}
                  <button className="w-full flex items-center justify-between p-5 border-b border-brand-gold/5 active:bg-brand-cream dark:active:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-600">
                        <i className="fa-solid fa-user-gear"></i>
                      </div>
                      <span className="text-sm font-black text-brand-red dark:text-slate-200 uppercase tracking-tight">Chỉnh sửa Profile</span>
                    </div>
                    <i className="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>
                  </button>

                  {/* Privacy */}
                  <button className="w-full flex items-center justify-between p-5 border-b border-brand-gold/5 active:bg-brand-cream dark:active:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-brand-gold/10 rounded-2xl flex items-center justify-center text-brand-gold">
                        <i className="fa-solid fa-shield-halved"></i>
                      </div>
                      <span className="text-sm font-black text-brand-red dark:text-slate-200 uppercase tracking-tight">Quyền riêng tư</span>
                    </div>
                    <i className="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>
                  </button>

                  {/* Logout */}
                  <button onClick={async () => { await authService.signOut(); setCurrentUser(null); }} className="w-full flex items-center justify-between p-5 active:bg-red-50 dark:active:bg-red-950/20 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center text-red-600">
                        <i className="fa-solid fa-right-from-bracket"></i>
                      </div>
                      <span className="text-sm font-black text-red-600 uppercase tracking-tight">Đăng xuất</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* Grid Post History */}
            <section className="space-y-6 pt-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xs font-black text-brand-red dark:text-slate-100 uppercase tracking-[0.2em] flex items-center gap-3">
                  <i className="fa-solid fa-grid-2 text-brand-gold"></i>
                  Lịch sử bài đăng
                </h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{myPosts.length} MỤC</span>
              </div>
              
              {myPosts.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 px-1">
                  {myPosts.map(post => (
                    <button 
                      key={post.id} 
                      onClick={() => setSelectedHistoryPost(post)}
                      className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-hidden relative group active:scale-95 transition-all shadow-sm border border-brand-gold/10"
                    >
                       <div className="absolute inset-0 flex flex-col">
                          <img src={post.topImage} className="h-1/2 w-full object-cover border-b border-white/20" alt="Top" />
                          <img src={post.bottomImage} className="h-1/2 w-full object-cover" alt="Bottom" />
                       </div>
                       <div className="absolute inset-0 bg-brand-red/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 text-white text-[10px] font-black">
                          <span className="flex items-center gap-1"><i className="fa-solid fa-heart"></i> {post.stats.likes}</span>
                          <span className="flex items-center gap-1"><i className="fa-solid fa-comment"></i> {post.stats.comments}</span>
                       </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-20 flex flex-col items-center justify-center opacity-30 text-center space-y-4">
                   <div className="w-20 h-20 rounded-[2rem] bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
                      <i className="fa-solid fa-images text-4xl text-slate-400"></i>
                   </div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Chưa có dấu ấn phong cách</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* HIỂN THỊ CHI TIẾT BÀI ĐĂNG TRONG LỊCH SỬ (Khôi phục tính năng) */}
      {selectedHistoryPost && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full max-w-lg bg-brand-cream dark:bg-slate-950 rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500 border border-brand-gold/30 flex flex-col max-h-[90dvh]">
            <div className="p-6 border-b border-brand-gold/20 flex items-center justify-between bg-brand-red dark:bg-slate-900">
              <h3 className="text-sm font-black text-brand-goldLight uppercase tracking-widest">Chi tiết bài đăng</h3>
              <button 
                onClick={() => setSelectedHistoryPost(null)} 
                className="w-10 h-10 bg-brand-gold/20 rounded-full flex items-center justify-center text-brand-goldLight border border-brand-gold/40 shadow-inner active:scale-90 transition-all"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              <SocialPost post={selectedHistoryPost} onTransactionClick={() => {
                setSelectedHistoryPost(null);
                handleOpenChatFromPost(selectedHistoryPost);
              }} isOwnPost={selectedHistoryPost.user.id === currentUser.id} onDelete={handleDeletePost} />
            </div>
          </div>
        </div>
      )}

      <ChatPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} conversations={conversations} initialChatId={activeChatId} contextPost={chatContextPost} onSendMessage={handleSendMessage} onRecallMessage={handleRecallMessage} onDeleteMessage={handleDeleteMessage} onReactToMessage={handleReactToMessage} />

      <nav className="fixed bottom-0 left-0 right-0 w-full max-w-xl md:max-w-3xl lg:max-w-5xl mx-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border-t border-brand-gold/30 z-40 safe-pb shadow-lg">
        <div className="grid grid-cols-3 items-center h-20 px-4">
          <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center justify-center gap-1 ${activeTab === 'home' ? 'text-brand-red' : 'text-slate-400'}`}>
            <i className={`fa-solid fa-house-chimney text-xl`}></i>
            <span className="text-[9px] font-black uppercase tracking-tighter">Trang chủ</span>
          </button>
          <div className="relative flex justify-center">
            <button onClick={() => setActiveTab('generate')} className={`w-14 h-14 bg-brand-red rounded-full flex items-center justify-center shadow-xl border-4 border-brand-gold/50 absolute -top-12 active:scale-95 transition-all`}>
              <i className="fa-solid fa-wand-magic-sparkles text-brand-gold text-xl"></i>
            </button>
            <span className={`text-[9px] font-black uppercase mt-8 ${activeTab === 'generate' ? 'text-brand-red' : 'text-slate-400'} tracking-tighter`}>Phối đồ</span>
          </div>
          <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center justify-center gap-1 ${activeTab === 'profile' ? 'text-brand-red' : 'text-slate-400'}`}>
            <i className={`fa-solid fa-user-large text-xl`}></i>
            <span className="text-[9px] font-black uppercase tracking-tighter">Tôi</span>
          </button>
        </div>
      </nav>

      {/* LUXURY REDESIGNED GENERATING OVERLAY - OPTIMIZED FOR DARK MODE */}
      {(isGenerating || isPublishing) && (
        <div className={`fixed inset-0 z-[400] flex items-center justify-center overflow-hidden transition-all duration-1000 ${
          isDarkMode 
          ? 'bg-gradient-to-br from-slate-950 via-[#0a0000] to-slate-950' 
          : 'bg-gradient-to-br from-[#1a0000] via-brand-red to-[#250000]'
        }`}>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
             <div className={`absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full blur-[180px] animate-pulse ${
               isDarkMode ? 'bg-brand-gold/5' : 'bg-brand-redBright/5'
             }`}></div>
             <div className={`absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full blur-[140px] animate-[pulse_6s_infinite] ${
               isDarkMode ? 'bg-brand-red/10' : 'bg-brand-gold/5'
             }`}></div>
          </div>
          <div className={`absolute inset-0 pointer-events-none z-10 ${isDarkMode ? 'opacity-30' : 'opacity-40'}`}>
             <div className="absolute top-[20%] left-[15%] animate-random-glow text-brand-gold/40">
                <i className="fa-solid fa-shirt text-[64px]"></i>
             </div>
             <div className="absolute top-[15%] right-[12%] animate-random-glow text-white/30" style={{ animationDelay: '4s' }}>
                <i className="fa-solid fa-person-dress text-[72px]"></i>
             </div>
             <div className="absolute top-[48%] left-[10%] animate-random-glow text-brand-gold/35" style={{ animationDelay: '7s' }}>
                <i className="fa-solid fa-scissors text-[56px]"></i>
             </div>
             <div className="absolute top-[42%] right-[18%] animate-random-glow text-white/30" style={{ animationDelay: '2s' }}>
                <i className="fa-solid fa-gem text-[52px]"></i>
             </div>
             <div className="absolute bottom-[25%] left-[20%] animate-random-glow text-brand-gold/40" style={{ animationDelay: '5s' }}>
                <i className="fa-solid fa-ring text-[56px]"></i>
             </div>
             <div className="absolute bottom-[20%] right-[15%] animate-random-glow text-white/30" style={{ animationDelay: '9s' }}>
                <i className="fa-solid fa-bag-shopping text-[68px]"></i>
             </div>
             <div className={`absolute left-0 right-0 h-[2px] z-20 animate-scan-vertical ${
               isDarkMode 
               ? 'bg-brand-gold/80 shadow-[0_0_40px_rgba(212,175,55,1)]' 
               : 'bg-brand-gold/60 shadow-[0_0_30px_rgba(212,175,55,1)]'
             }`}></div>
          </div>
          <div className="relative z-30 flex flex-col items-center justify-center w-full max-w-[340px] px-10 animate-luxury-reveal">
            <div className="relative w-56 h-56 flex items-center justify-center mb-16">
               <div className={`absolute inset-0 border rounded-full animate-pulse-ring ${
                 isDarkMode ? 'border-brand-gold/20' : 'border-brand-gold/10'
               }`}></div>
               <div className={`absolute inset-0 border rounded-full animate-pulse-ring ${
                 isDarkMode ? 'border-brand-gold/10' : 'border-brand-gold/5'
               }`} style={{ animationDelay: '1.5s' }}></div>
               <div className="absolute inset-0 border border-brand-gold/5 rounded-full animate-pulse-ring" style={{ animationDelay: '3s' }}></div>
               <div className={`absolute inset-8 border-[0.5px] rounded-[2.5rem] animate-spin-slow ${
                 isDarkMode ? 'border-brand-gold/40' : 'border-brand-gold/20'
               }`}></div>
               <div className={`absolute inset-12 border-[0.5px] rounded-[2.8rem] animate-[spin_10s_linear_infinite_reverse] ${
                 isDarkMode ? 'border-brand-gold/30' : 'border-brand-gold/15'
               }`}></div>
               <div className={`w-24 h-24 bg-white rounded-full flex items-center justify-center relative group border-4 ${
                 isDarkMode 
                 ? 'border-brand-gold shadow-[0_0_80px_rgba(212,175,55,0.6)]' 
                 : 'border-brand-gold shadow-[0_0_60px_rgba(212,175,55,0.4)]'
               }`}>
                  <i className={`fa-solid ${isGenerating ? 'fa-wand-magic-sparkles' : 'fa-paper-plane'} text-4xl text-brand-red drop-shadow-sm`}></i>
               </div>
               <div className="absolute w-2 h-2 bg-brand-gold rounded-full animate-[spin_4s_linear_infinite] origin-[112px_112px] top-0 left-0"></div>
               <div className="absolute w-1.5 h-1.5 bg-white/40 rounded-full animate-[spin_3s_linear_infinite_reverse] origin-[100px_100px] top-4 left-4"></div>
            </div>
            <div className="space-y-12 w-full flex flex-col items-center">
              <div className="w-full text-center">
                <h2 className="text-2xl font-black text-white uppercase tracking-wider mb-2 drop-shadow-lg">
                   {isGenerating ? "THIẾT KẾ PHONG CÁCH" : "CHIA SẺ OUTFIT"}
                </h2>
                <div className="h-14 w-full flex items-center justify-center px-4">
                  <p className={`text-[13px] font-bold uppercase tracking-[0.1em] leading-relaxed animate-in fade-in duration-700 text-center ${
                    isDarkMode ? 'text-brand-goldLight' : 'text-brand-gold'
                  }`}>
                    {isGenerating ? "Đang thiết kế phong cách..." : "Đang đăng tải bài viết của bạn..."}
                  </p>
                </div>
              </div>
              <div className="space-y-8 w-full flex flex-col items-center">
                <div className={`w-full h-[1px] relative overflow-hidden ${
                  isDarkMode ? 'bg-white/10' : 'bg-white/5'
                }`}>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-gold to-transparent w-1/2 animate-shimmer"></div>
                </div>
                <div className="flex flex-col items-center space-y-3">
                   <div className="flex items-center gap-5">
                      <div className="w-1.5 h-1.5 bg-brand-gold/70 rounded-full animate-pulse"></div>
                      <span className={`text-[10px] font-black uppercase tracking-[0.6em] italic text-center drop-shadow-sm ${
                        isDarkMode ? 'text-brand-gold' : 'text-brand-gold/80'
                      }`}>
                        {isGenerating ? "LUCKY DREAM OUTFIT" : "LUCKY DREAM PUBLISHING"}
                      </span>
                      <div className="w-1.5 h-1.5 bg-brand-gold/70 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }}></div>
                   </div>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute bottom-14 opacity-30 text-center w-full px-12">
             <div className="h-[0.5px] w-full bg-brand-gold/40 mb-4 mx-auto max-w-[140px]"></div>
             <p className="text-[9px] font-black text-brand-gold uppercase tracking-[0.8em] whitespace-nowrap text-center">Luxury Ecosystem</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
