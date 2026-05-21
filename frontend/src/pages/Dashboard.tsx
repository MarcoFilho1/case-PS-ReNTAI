import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface Opinion {
  id: string;
  specialist_id: string;
  content: string;
  created_at: string;
}

interface StatusHistory {
  id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string;
  created_at: string;
}

interface Teleconsultation {
  id: string;
  patient_name: string;
  patient_dob: string;
  specialty: string;
  status: string;
  diagnostic_hypothesis: string;
  clinical_history: string;
  ai_confidence_score: number | null;
  ai_rejection_reason?: string | null;
  created_at: string;
  requester_id?: string;
  specialist_id?: string | null;
  opinions?: Opinion[];
  status_history?: StatusHistory[];
}

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  specialty: string | null;
}

const MOCK_DATA: Teleconsultation[] = [
  {
    id: "1",
    patient_name: "Mariana Souza Santos",
    patient_dob: "1988-04-12",
    specialty: "CARDIOLOGIA",
    status: "PENDENTE",
    diagnostic_hypothesis: "Insuficiência cardíaca congestiva leve. Paciente relata dispneia aos esforços moderados e palpitações ocasionais.",
    clinical_history: "Histórico de hipertensão arterial sistêmica há 5 anos, em uso de Losartana 50mg/dia. Exame físico sem edema de membros inferiores.",
    ai_confidence_score: 0.88,
    created_at: "2026-05-20T10:15:00Z"
  },
  {
    id: "2",
    patient_name: "Carlos Eduardo Oliveira",
    patient_dob: "1965-09-23",
    specialty: "CIRURGIA_ROBOTICA",
    status: "CONCLUIDA",
    diagnostic_hypothesis: "Adenocarcinoma prostático localizado. Indicação de prostatectomia radical assistida por robô.",
    clinical_history: "Elevação progressiva do PSA nos últimos 6 meses (PSA atual 6.8). Biópsia confirmou Gleason 3+4.",
    ai_confidence_score: 0.95,
    created_at: "2026-05-19T14:30:00Z"
  },
  {
    id: "3",
    patient_name: "Beatriz Helena Costa",
    patient_dob: "2012-07-31",
    specialty: "DOENCAS_RARAS",
    status: "EM_ANDAMENTO",
    diagnostic_hypothesis: "Suspeita de Mucopolissacaridose tipo I devido a atraso no desenvolvimento neuropsicomotor.",
    clinical_history: "Facies infiltrada, hepatoesplenomegalia discreta, rigidez articular progressiva relatada pelos pais.",
    ai_confidence_score: 0.72,
    created_at: "2026-05-18T09:00:00Z"
  },
  {
    id: "4",
    patient_name: "Roberto de Alencar",
    patient_dob: "1952-11-05",
    specialty: "OXIGENOTERAPIA",
    status: "PENDENTE",
    diagnostic_hypothesis: "DPOC exacerbação grave. Necessidade de oxigenoterapia domiciliar prolongada.",
    clinical_history: "Ex-tabagista (40 anos/maço). Apresenta dispneia aos mínimos esforços e saturação de O2 em ar ambiente de 84%.",
    ai_confidence_score: 0.45,
    created_at: "2026-05-17T11:45:00Z"
  }
];

export function Dashboard() {
  const navigate = useNavigate();
  const [consultations, setConsultations] = useState<Teleconsultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [specialtyFilter, setSpecialtyFilter] = useState('ALL');
  const [dateFilterType, setDateFilterType] = useState('ALL');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<Teleconsultation | null>(null);

  const [newCaseData, setNewCaseData] = useState({
    patient_name: '',
    patient_dob: '',
    specialty: 'CARDIOLOGIA',
    diagnostic_hypothesis: '',
    clinical_history: '',
  });
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analyzingIA, setAnalyzingIA] = useState(false);
  const [pollIntervalId, setPollIntervalId] = useState<any>(null);

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'info' | 'success' | 'warning' }[]>([]);
  const [isOpinionFormOpen, setIsOpinionFormOpen] = useState(false);
  const [opinionContent, setOpinionContent] = useState('');
  const [submittingOpinion, setSubmittingOpinion] = useState(false);

  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const showToastRef = useRef<(message: string, type?: 'info' | 'success' | 'warning') => void>(() => {});
  showToastRef.current = (message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  useEffect(() => {
    if (!isDetailsModalOpen) {
      setIsOpinionFormOpen(false);
      setOpinionContent('');
    }
  }, [isDetailsModalOpen]);

  const fetchCurrentUser = async () => {
    try {
      const response = await api.get('/me');
      setCurrentUser(response.data);
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      console.warn("API '/me' indisponível. Carregando usuário mockado para demonstração.");
      setCurrentUser({
        id: "mock-solicitante-id",
        name: "Médico Solicitante (Mock)",
        email: "solicitante@rentai.com",
        role: "SOLICITANTE",
        specialty: null
      });
      setIsDemoMode(true);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchConsultations(true);
  }, []);

  const fetchConsultations = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await api.get('/teleconsultations');
      setConsultations(response.data);
      setIsDemoMode(false);
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      
      console.warn("API '/teleconsultations' indisponível. Carregando dados locais/mockados.");
      const stored = localStorage.getItem('rentai_consultations');
      if (stored) {
        setConsultations(JSON.parse(stored));
      } else {
        setConsultations(MOCK_DATA);
        localStorage.setItem('rentai_consultations', JSON.stringify(MOCK_DATA));
      }
      setIsDemoMode(true);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const fetchCaseDetails = async (caseId: string) => {
    try {
      if (isDemoMode) {
        const found = consultations.find(c => c.id === caseId);
        if (found) {
          setSelectedCase(found);
        }
      } else {
        const response = await api.get(`/teleconsultations/${caseId}`);
        setSelectedCase(response.data);
      }
    } catch (err) {
      console.error("Erro ao obter detalhes da teleconsultoria:", err);
    }
  };

  const detailsOpenRef = useRef(isDetailsModalOpen);
  const selectedCaseRef = useRef(selectedCase);

  useEffect(() => {
    detailsOpenRef.current = isDetailsModalOpen;
    selectedCaseRef.current = selectedCase;
  }, [isDetailsModalOpen, selectedCase]);

  useEffect(() => {
    const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    let socket: WebSocket;
    let reconnectTimeout: any;

    const connectSocket = () => {
      const token = sessionStorage.getItem('token');
      if (!token) {
        // Se não houver token, aguarda 3 segundos e tenta novamente
        reconnectTimeout = setTimeout(connectSocket, 3000);
        return;
      }

      const wsUrl = `${apiBaseUrl.replace(/^http/, 'ws')}/ws?token=${token}`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('Conectado ao WebSocket de teleconsultas');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'TELECONSULTATION_CREATED' || data.type === 'TELECONSULTATION_UPDATED') {
            fetchConsultations(false);

            if (detailsOpenRef.current && selectedCaseRef.current && selectedCaseRef.current.id === data.id) {
              fetchCaseDetails(data.id);
            }

            const currentU = currentUserRef.current;
            if (currentU) {
              if (data.type === 'TELECONSULTATION_UPDATED') {
                if (currentU.role === 'ESPECIALISTA') {
                  if (data.specialty === currentU.specialty && data.status === 'EM_ANDAMENTO') {
                    showToastRef.current?.(`Nova solicitação de ${formatSpecialty(data.specialty)} recebida para o paciente ${data.patient_name}.`, 'info');
                  }
                } else if (currentU.role === 'SOLICITANTE' && data.requester_id === currentU.id) {
                  if (data.status === 'CONCLUIDA') {
                    showToastRef.current?.(`O parecer para o paciente ${data.patient_name} foi emitido com sucesso!`, 'success');
                  } else if (data.status === 'CANCELADA') {
                    showToastRef.current?.(`A solicitação para o paciente ${data.patient_name} foi rejeitada pela IA.`, 'warning');
                  } else if (data.status === 'EM_ANDAMENTO') {
                    showToastRef.current?.(`A solicitação para o paciente ${data.patient_name} foi aprovada pela IA e está em andamento.`, 'success');
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error('Erro ao processar mensagem do WebSocket:', err);
        }
      };

      socket.onclose = (event) => {
        console.log('WebSocket desconectado. Tentando reconectar em 3 segundos...', event.reason);
        reconnectTimeout = setTimeout(() => {
          connectSocket();
        }, 3000);
      };

      socket.onerror = (err) => {
        console.error('Erro no WebSocket:', err);
        socket.close();
      };
    };

    connectSocket();

    return () => {
      if (socket) socket.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  const pollCaseStatus = (caseId: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 30) {
        clearInterval(interval);
        setPollIntervalId(null);
        setAnalyzingIA(false);
        setIsCreateModalOpen(false);
        fetchConsultations();
        return;
      }

      try {
        const response = await api.get(`/teleconsultations/${caseId}`);
        const updatedCase = response.data;
        if (updatedCase.status !== 'PENDENTE') {
          clearInterval(interval);
          setPollIntervalId(null);
          setAnalyzingIA(false);
          setIsCreateModalOpen(false);
          fetchConsultations();
        }
      } catch (err) {
        console.error("Erro ao verificar status do caso:", err);
      }
    }, 2000);

    return interval;
  };

  const handleReturnToMenu = () => {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      setPollIntervalId(null);
    }
    setAnalyzingIA(false);
    setIsCreateModalOpen(false);
    fetchConsultations();
  };

  const handleOpenDetails = async (caseId: string) => {
    try {
      if (isDemoMode) {
        const found = consultations.find(c => c.id === caseId);
        if (found) {
          setSelectedCase(found);
          setIsDetailsModalOpen(true);
        }
      } else {
        const response = await api.get(`/teleconsultations/${caseId}`);
        setSelectedCase(response.data);
        setIsDetailsModalOpen(true);
      }
    } catch (err) {
      console.error("Erro ao obter detalhes da teleconsultoria:", err);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    navigate('/login');
  };

  const formatDate = (dateStr: string) => {
    try {
      if (dateStr.includes('-') && !dateStr.includes('T') && !dateStr.includes(' ')) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const dateObj = new Date(year, month - 1, day);
        return dateObj.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
      }
      const dateObj = new Date(dateStr);
      return dateObj.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const calculateAge = (dobStr: string) => {
    try {
      let birthDate;
      if (dobStr.includes('-') && !dobStr.includes('T') && !dobStr.includes(' ')) {
        const [year, month, day] = dobStr.split('-').map(Number);
        birthDate = new Date(year, month - 1, day);
      } else {
        birthDate = new Date(dobStr);
      }
      const difference = Date.now() - birthDate.getTime();
      const ageDate = new Date(difference);
      return Math.abs(ageDate.getUTCFullYear() - 1970);
    } catch {
      return null;
    }
  };

  const formatSpecialty = (spec: string) => {
    return spec.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAnalyzingIA(true);

    try {
      if (!isDemoMode) {
        if (!uploadedFile) {
          alert("Por favor, selecione um anexo clínico (documento de apoio).");
          setIsSubmitting(false);
          setAnalyzingIA(false);
          return;
        }

        const formData = new FormData();
        formData.append('patient_name', newCaseData.patient_name);
        formData.append('patient_dob', newCaseData.patient_dob);
        formData.append('specialty', newCaseData.specialty);
        formData.append('diagnostic_hypothesis', newCaseData.diagnostic_hypothesis);
        formData.append('clinical_history', newCaseData.clinical_history);
        formData.append('document', uploadedFile);

        const response = await api.post('/teleconsultations', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        
        fetchConsultations();
        const newCase = response.data;
        const intervalId = pollCaseStatus(newCase.id);
        setPollIntervalId(intervalId);
      } else {
        await new Promise(resolve => setTimeout(resolve, 1800));
        const randomScore = Number((0.65 + Math.random() * 0.33).toFixed(2));
        const newCase: Teleconsultation = {
          id: Math.random().toString(36).substring(2, 9),
          patient_name: newCaseData.patient_name,
          patient_dob: newCaseData.patient_dob,
          specialty: newCaseData.specialty,
          status: 'PENDENTE',
          diagnostic_hypothesis: newCaseData.diagnostic_hypothesis,
          clinical_history: newCaseData.clinical_history,
          ai_confidence_score: randomScore,
          created_at: new Date().toISOString()
        };

        const updatedList = [newCase, ...consultations];
        setConsultations(updatedList);
        localStorage.setItem('rentai_consultations', JSON.stringify(updatedList));
        setAnalyzingIA(false);
        setIsCreateModalOpen(false);
      }

      setNewCaseData({
        patient_name: '',
        patient_dob: '',
        specialty: 'CARDIOLOGIA',
        diagnostic_hypothesis: '',
        clinical_history: '',
      });
      setUploadedFile(null);
    } catch (err) {
      console.error("Erro ao salvar teleconsultoria:", err);
      alert("Houve um erro ao registrar a teleconsultoria.");
      setAnalyzingIA(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpinionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setSubmittingOpinion(true);

    try {
      if (!isDemoMode) {
        const formData = new FormData();
        formData.append('content', opinionContent);
        await api.post(`/teleconsultations/${selectedCase.id}/opinions`, formData);
        
        await fetchCaseDetails(selectedCase.id);
        fetchConsultations();
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const newOpinion: Opinion = {
          id: Math.random().toString(36).substring(2, 9),
          specialist_id: currentUser?.id || "mock-spec-id",
          content: opinionContent,
          created_at: new Date().toISOString()
        };
        const updatedCase: Teleconsultation = {
          ...selectedCase,
          status: 'CONCLUIDA',
          opinions: [...(selectedCase.opinions || []), newOpinion]
        };
        setConsultations(consultations.map(c => c.id === selectedCase.id ? updatedCase : c));
        setSelectedCase(updatedCase);
      }
      setIsOpinionFormOpen(false);
      setOpinionContent('');
      showToastRef.current?.("Parecer registrado com sucesso!", "success");
    } catch (err) {
      console.error("Erro ao enviar parecer:", err);
      alert("Houve um erro ao registrar seu parecer.");
    } finally {
      setSubmittingOpinion(false);
    }
  };

  const filteredConsultations = consultations.filter(item => {
    const patientName = item.patient_name || '';
    const diagHypothesis = item.diagnostic_hypothesis || '';
    const matchesSearch = patientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          diagHypothesis.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const matchesSpecialty = specialtyFilter === 'ALL' || item.specialty === specialtyFilter;

    let matchesDate = true;
    if (dateFilterType !== 'ALL') {
      const itemDate = new Date(item.created_at);
      if (dateFilterType === 'TODAY') {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        matchesDate = itemDate >= startOfToday;
      } else if (dateFilterType === '3_DAYS') {
        const limit = new Date();
        limit.setDate(limit.getDate() - 3);
        limit.setHours(0, 0, 0, 0);
        matchesDate = itemDate >= limit;
      } else if (dateFilterType === '7_DAYS') {
        const limit = new Date();
        limit.setDate(limit.getDate() - 7);
        limit.setHours(0, 0, 0, 0);
        matchesDate = itemDate >= limit;
      } else if (dateFilterType === '15_DAYS') {
        const limit = new Date();
        limit.setDate(limit.getDate() - 15);
        limit.setHours(0, 0, 0, 0);
        matchesDate = itemDate >= limit;
      } else if (dateFilterType === '30_DAYS') {
        const limit = new Date();
        limit.setDate(limit.getDate() - 30);
        limit.setHours(0, 0, 0, 0);
        matchesDate = itemDate >= limit;
      } else if (dateFilterType === 'CUSTOM') {
        if (customStartDate) {
          const start = new Date(customStartDate + 'T00:00:00');
          matchesDate = matchesDate && itemDate >= start;
        }
        if (customEndDate) {
          const end = new Date(customEndDate + 'T23:59:59');
          matchesDate = matchesDate && itemDate <= end;
        }
      }
    }

    return matchesSearch && matchesStatus && matchesSpecialty && matchesDate;
  });

  const totalCases = consultations.length;
  const pendingCases = consultations.filter(c => c.status === 'PENDENTE').length;
  const completedCases = consultations.filter(c => c.status === 'CONCLUIDA').length;

  return (
    <div className="min-h-screen bg-zinc-50/50 flex flex-col">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-zinc-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/10">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-lg text-zinc-950 tracking-tight">ReNTAI</span>
              <span className="text-[10px] ml-2 px-1.5 py-0.5 bg-zinc-100 rounded-md text-zinc-500 font-medium">v1.0</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
              isDemoMode 
                ? 'bg-amber-50 text-amber-700 border-amber-100' 
                : 'bg-emerald-50 text-emerald-700 border-emerald-100'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isDemoMode ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`}></span>
              {isDemoMode ? 'Modo de Demonstração' : 'Conectado'}
            </div>

            <div className="flex items-center gap-3 pl-4 border-l border-zinc-200">
              <div className="hidden md:block text-right">
                <p className="text-sm font-semibold text-zinc-800">{currentUser?.name || 'Carregando...'}</p>
                <p className="text-xs text-zinc-400">
                  {currentUser?.role === 'ESPECIALISTA' 
                    ? `Especialista (${formatSpecialty(currentUser.specialty || '')})` 
                    : 'Médico Solicitante'}
                </p>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 rounded-xl text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-all duration-200"
                title="Sair do sistema"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight">Teleconsultorias</h1>
            <p className="text-sm text-zinc-500 mt-1">Gerencie solicitações de suporte clínico guiadas por inteligência artificial.</p>
          </div>
          {currentUser?.role !== 'ESPECIALISTA' && (
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="self-start sm:self-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm shadow-indigo-600/10 hover:shadow-md hover:shadow-indigo-600/20 active:scale-[0.98] transition-all duration-200 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Nova Teleconsultoria</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Total de Casos</span>
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-extrabold text-zinc-900">{totalCases}</p>
            <p className="text-xs text-zinc-400 mt-1">Registrados na plataforma</p>
          </div>

          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Aguardando Parecer</span>
              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-extrabold text-amber-600">{pendingCases}</p>
            <p className="text-xs text-zinc-400 mt-1">Casos pendentes de avaliação</p>
          </div>

          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Casos Concluídos</span>
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-extrabold text-emerald-600">{completedCases}</p>
            <p className="text-xs text-zinc-400 mt-1">Pareceres emitidos</p>
          </div>
        </div>

        <div className="bg-white border border-zinc-200/80 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center gap-4">
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Buscar por paciente ou hipótese diagnóstica..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800"
            />
            <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-zinc-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[130px]">
              <select 
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="w-full pl-3 pr-8 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-medium text-zinc-600 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 appearance-none cursor-pointer"
              >
                <option value="ALL">Todos Status</option>
                <option value="PENDENTE">Pendente</option>
                <option value="EM_ANDAMENTO">Em Andamento</option>
                <option value="CONCLUIDA">Concluída</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-zinc-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <div className="relative min-w-[160px]">
              <select 
                value={specialtyFilter}
                onChange={e => setSpecialtyFilter(e.target.value)}
                className="w-full pl-3 pr-8 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-medium text-zinc-600 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 appearance-none cursor-pointer"
              >
                <option value="ALL">Todas Especialidades</option>
                <option value="CARDIOLOGIA">Cardiologia</option>
                <option value="CIRURGIA_ROBOTICA">Cirurgia Robótica</option>
                <option value="ODONTOLOGIA">Odontologia</option>
                <option value="DOENCAS_RARAS">Doenças Raras</option>
                <option value="OXIGENOTERAPIA">Oxigenoterapia</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-zinc-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <div className="relative min-w-[140px]">
              <select 
                value={dateFilterType}
                onChange={e => setDateFilterType(e.target.value)}
                className="w-full pl-3 pr-8 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-medium text-zinc-600 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 appearance-none cursor-pointer"
              >
                <option value="ALL">Todo Período</option>
                <option value="TODAY">Hoje</option>
                <option value="3_DAYS">Últimos 3 dias</option>
                <option value="7_DAYS">Últimos 7 dias</option>
                <option value="15_DAYS">Últimos 15 dias</option>
                <option value="30_DAYS">Últimos 30 dias</option>
                <option value="CUSTOM">Data Personalizada</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-zinc-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {dateFilterType === 'CUSTOM' && (
              <div className="flex items-center gap-2 animate-fadeIn">
                <input 
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-600 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200"
                  title="Data Início"
                />
                <span className="text-zinc-400 text-xs font-bold">até</span>
                <input 
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-600 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200"
                  title="Data Fim"
                />
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="animate-spin h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-sm font-medium text-zinc-400">Carregando dados das teleconsultas...</p>
          </div>
        ) : (
          <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm overflow-hidden">
            {filteredConsultations.length === 0 ? (
              <div className="p-16 text-center">
                <div className="w-12 h-12 bg-zinc-50 border border-zinc-200/80 text-zinc-400 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-zinc-800">Nenhum caso encontrado</h3>
                <p className="text-xs text-zinc-400 mt-1">Experimente alterar os filtros ou cadastrar uma nova solicitação.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {filteredConsultations.map((item) => (
                  <div 
                    key={item.id} 
                    onClick={() => handleOpenDetails(item.id)}
                    className="p-5 hover:bg-zinc-50/60 transition-colors duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-sm font-bold text-zinc-800 hover:text-indigo-600 transition-colors duration-150">{item.patient_name}</h3>
                        <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-md">
                          {formatSpecialty(item.specialty)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 line-clamp-1 max-w-2xl">{item.diagnostic_hypothesis}</p>
                      <p className="text-[10px] text-zinc-400">Solicitado em: {formatDate(item.created_at)}</p>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-5">
                      {item.ai_confidence_score != null && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-zinc-400">Score IA:</span>
                          <span className={`text-xs font-bold ${
                            item.ai_confidence_score >= 0.8 
                              ? 'text-emerald-600' 
                              : item.ai_confidence_score >= 0.6 
                                ? 'text-amber-600' 
                                : 'text-rose-600'
                          }`}>
                            {Math.round(item.ai_confidence_score * 100)}%
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 text-[10px] font-extrabold tracking-wider rounded-full border uppercase ${
                          item.status === 'PENDENTE' 
                            ? 'bg-amber-50 text-amber-700 border-amber-200/50' 
                            : item.status === 'CONCLUIDA' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                              : item.status === 'EM_ANDAMENTO'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200/50'
                                : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                        }`}>
                          {item.status}
                        </span>

                        <svg className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-950/20 backdrop-blur-sm" onClick={() => {
            if (analyzingIA) {
              handleReturnToMenu();
            } else if (!isSubmitting) {
              setIsCreateModalOpen(false);
            }
          }}></div>
          
          <div className="relative w-full max-w-lg bg-white border border-zinc-200 rounded-2xl shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] overflow-y-auto">
            {analyzingIA ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-2 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                    <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Análise de IA ReNTAI</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">Extraindo dados do documento e calculando o índice de conformidade com OCR...</p>
                </div>
                <button
                  type="button"
                  onClick={handleReturnToMenu}
                  className="mt-6 px-4 py-2 bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 text-xs font-semibold rounded-xl shadow-sm transition-all duration-200 active:scale-[0.98] focus:outline-none"
                >
                  Retornar ao menu
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-zinc-900">Nova Solicitação</h2>
                  <button 
                    onClick={() => setIsCreateModalOpen(false)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleCreateSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="pname" className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">
                      Nome do Paciente
                    </label>
                    <input 
                      id="pname"
                      type="text" 
                      required
                      placeholder="Nome completo do paciente"
                      className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800"
                      value={newCaseData.patient_name}
                      onChange={e => setNewCaseData({...newCaseData, patient_name: e.target.value})}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="dob" className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">
                        Data de Nascimento
                      </label>
                      <input 
                        id="dob"
                        type="date" 
                        required
                        className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800"
                        value={newCaseData.patient_dob}
                        onChange={e => setNewCaseData({...newCaseData, patient_dob: e.target.value})}
                      />
                    </div>

                    <div>
                      <label htmlFor="spec" className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">
                        Especialidade
                      </label>
                      <div className="relative">
                        <select 
                          id="spec"
                          className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 appearance-none text-zinc-800"
                          value={newCaseData.specialty}
                          onChange={e => setNewCaseData({...newCaseData, specialty: e.target.value})}
                        >
                          <option value="CARDIOLOGIA">Cardiologia</option>
                          <option value="CIRURGIA_ROBOTICA">Cirurgia Robótica</option>
                          <option value="ODONTOLOGIA">Odontologia</option>
                          <option value="DOENCAS_RARAS">Doenças Raras</option>
                          <option value="OXIGENOTERAPIA">Oxigenoterapia</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-3.5 pointer-events-none text-zinc-400">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="hypoth" className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">
                      Hipótese Diagnóstica
                    </label>
                    <textarea 
                      id="hypoth"
                      required
                      rows={2}
                      placeholder="Descrição clara das suspeitas clínicas principais..."
                      className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800 resize-none"
                      value={newCaseData.diagnostic_hypothesis}
                      onChange={e => setNewCaseData({...newCaseData, diagnostic_hypothesis: e.target.value})}
                    />
                  </div>

                  <div>
                    <label htmlFor="history" className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">
                      Histórico Clínico do Paciente
                    </label>
                    <textarea 
                      id="history"
                      required
                      rows={3}
                      placeholder="Histórico, doenças pré-existentes, sintomas atuais e exames preliminares..."
                      className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800 resize-none"
                      value={newCaseData.clinical_history}
                      onChange={e => setNewCaseData({...newCaseData, clinical_history: e.target.value})}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
                      Anexo Clínico de Apoio (Laudos / Exames)
                    </label>
                    <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center hover:bg-zinc-50 transition-colors duration-150 relative cursor-pointer group">
                      <input 
                        type="file" 
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={e => e.target.files && setUploadedFile(e.target.files[0])}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="p-1.5 bg-zinc-100 text-zinc-500 rounded-lg group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-colors">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                        </div>
                        {uploadedFile ? (
                          <div className="text-xs">
                            <span className="font-semibold text-indigo-600">{uploadedFile.name}</span>
                            <span className="text-zinc-400 ml-1.5">({(uploadedFile.size / 1024).toFixed(0)} KB)</span>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-zinc-700">Clique ou arraste um PDF ou Imagem</p>
                            <p className="text-[10px] text-zinc-400">Tamanho máximo recomendado: 10MB</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-indigo-600/20 active:scale-[0.99] flex items-center justify-center gap-2 mt-4"
                  >
                    <span>Confirmar e Enviar solicitação</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {isDetailsModalOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-950/20 backdrop-blur-sm" onClick={() => setIsDetailsModalOpen(false)}></div>
          
          <div className="relative w-full max-w-2xl bg-white border border-zinc-200 rounded-2xl shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => setIsDetailsModalOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="mb-6 space-y-2">
              <span className="text-[10px] font-extrabold tracking-wider uppercase px-2.5 py-1 bg-zinc-100 text-zinc-600 rounded-full border border-zinc-200">
                {formatSpecialty(selectedCase.specialty)}
              </span>
              <h2 className="text-2xl font-bold text-zinc-900">{selectedCase.patient_name}</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>Nascimento: {formatDate(selectedCase.patient_dob)} {calculateAge(selectedCase.patient_dob) && `(${calculateAge(selectedCase.patient_dob)} anos)`}</span>
                <span>•</span>
                <span>Caso ID: {selectedCase.id}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-zinc-100 pt-6">
              
              <div className="md:col-span-2 space-y-5">
                <div>
                  <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Hipótese Diagnóstica</h4>
                  <p className="text-sm text-zinc-700 leading-relaxed bg-zinc-50 p-4 border border-zinc-100 rounded-xl">{selectedCase.diagnostic_hypothesis}</p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Histórico Clínico</h4>
                  <p className="text-sm text-zinc-700 leading-relaxed bg-zinc-50 p-4 border border-zinc-100 rounded-xl">{selectedCase.clinical_history}</p>
                </div>

                {selectedCase.status === 'CANCELADA' && selectedCase.ai_rejection_reason && (
                  <div className="w-full bg-rose-50 border border-rose-100 rounded-xl p-4 text-left animate-fadeIn">
                    <span className="block text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-1">Motivo da Rejeição (IA)</span>
                    <p className="text-sm text-rose-700 leading-relaxed font-medium">{selectedCase.ai_rejection_reason}</p>
                  </div>
                )}

                {selectedCase.opinions && selectedCase.opinions.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-zinc-100">
                    <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Pareceres Registrados</h4>
                    <div className="space-y-3">
                      {selectedCase.opinions.map((op) => (
                        <div key={op.id} className="bg-emerald-50/40 border border-emerald-100/60 rounded-xl p-4 animate-fadeIn">
                          <p className="text-[10px] text-zinc-400 mb-1 font-semibold uppercase">
                            Emitido por Especialista em {formatDate(op.created_at)}
                          </p>
                          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">{op.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {currentUser?.role === 'ESPECIALISTA' && selectedCase.status === 'EM_ANDAMENTO' && (
                  <div className="border-t border-zinc-100 pt-4 space-y-4">
                    {!isOpinionFormOpen ? (
                      <button
                        onClick={() => setIsOpinionFormOpen(true)}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-xl shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98] flex items-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>Registrar Parecer</span>
                      </button>
                    ) : (
                      <form onSubmit={handleOpinionSubmit} className="space-y-3 animate-fadeIn">
                        <label htmlFor="opinionText" className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                          Seu Parecer Técnico
                        </label>
                        <textarea
                          id="opinionText"
                          required
                          rows={4}
                          value={opinionContent}
                          onChange={e => setOpinionContent(e.target.value)}
                          placeholder="Digite aqui o seu parecer clínico detalhado e recomendações..."
                          className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800 resize-y"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={submittingOpinion}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {submittingOpinion ? (
                              <>
                                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                <span>Enviando...</span>
                              </>
                            ) : (
                              <span>Enviar Parecer</span>
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={submittingOpinion}
                            onClick={() => setIsOpinionFormOpen(false)}
                            className="px-4 py-2 bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 text-xs font-semibold rounded-xl shadow-sm transition-all duration-200 active:scale-[0.98]"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center md:items-stretch gap-6 border-t md:border-t-0 md:border-l border-zinc-100 pt-6 md:pt-0 md:pl-6">
                
                <div className="w-full text-center md:text-left bg-zinc-50 border border-zinc-100 rounded-xl p-4">
                  <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Status Atual</span>
                  <span className={`inline-flex px-3 py-1 text-xs font-extrabold tracking-wider rounded-full border uppercase ${
                    selectedCase.status === 'PENDENTE' 
                      ? 'bg-amber-50 text-amber-700 border-amber-200/50' 
                      : selectedCase.status === 'CONCLUIDA' 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                        : selectedCase.status === 'EM_ANDAMENTO'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200/50'
                          : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                  }`}>
                    {selectedCase.status}
                  </span>
                </div>

                {selectedCase.ai_confidence_score != null && (
                  <div className="w-full bg-zinc-50 border border-zinc-100 rounded-xl p-4 flex flex-col items-center">
                    <span className="w-full block text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Conformidade IA</span>
                    
                    <div className="relative flex items-center justify-center w-24 h-24">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                        <path
                          className="text-zinc-200"
                          strokeWidth="2.5"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className={`${
                            selectedCase.ai_confidence_score >= 0.8 
                              ? 'text-emerald-500' 
                              : selectedCase.ai_confidence_score >= 0.6 
                                ? 'text-amber-500' 
                                : 'text-rose-500'
                          } transition-all duration-500`}
                          strokeDasharray={`${selectedCase.ai_confidence_score * 100}, 100`}
                          strokeWidth="3"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div className="absolute text-center">
                        <span className="text-xl font-extrabold text-zinc-800">{Math.round(selectedCase.ai_confidence_score * 100)}%</span>
                      </div>
                    </div>
                    
                    <p className="text-[10px] text-zinc-400 mt-2 text-center">Nível de segurança documental extraído pela IA.</p>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      <div className="fixed top-4 right-4 z-50 pointer-events-none flex flex-col gap-3 max-w-sm w-full">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 bg-white border rounded-xl shadow-xl animate-slideIn transition-all duration-300 ${
              toast.type === 'success'
                ? 'border-emerald-100 bg-emerald-50/95 text-emerald-800'
                : toast.type === 'warning'
                  ? 'border-rose-100 bg-rose-50/95 text-rose-800'
                  : 'border-indigo-100 bg-indigo-50/95 text-indigo-800'
            }`}
          >
            <div className="mt-0.5">
              {toast.type === 'success' && (
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {toast.type === 'warning' && (
                <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              {toast.type === 'info' && (
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                {toast.type === 'success' ? 'Sucesso' : toast.type === 'warning' ? 'Atenção' : 'Notificação'}
              </p>
              <p className="text-sm font-medium mt-0.5">{toast.message}</p>
            </div>
            <button
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}