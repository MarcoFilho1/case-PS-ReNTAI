import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import logoRentai from '../assets/logo_rentai.png';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const response = await api.post('/login', formData);
      
      sessionStorage.setItem('token', response.data.access_token);
      
      navigate('/dashboard');
    } catch (err: any) {
      setError('E-mail ou senha incorretos. Por favor, tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-zinc-50/50 px-4 overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-200/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-200/10 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-white border border-zinc-200/80 rounded-2xl shadow-xl shadow-zinc-100/50 p-8 sm:p-10 transition-all duration-300">
        
        <div className="flex flex-col items-center mb-6 text-center">
          <img src={logoRentai} alt="ReNTAI Logo" className="h-12 w-auto mb-4 object-contain" />
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">ReNTAI</h1>
          <p className="text-sm text-zinc-500 mt-1">Acesso à plataforma de telemedicina</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-600 animate-fadeIn">
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
              E-mail corporativo
            </label>
            <input 
              id="email"
              type="email" 
              placeholder="exemplo@rentai.com" 
              required
              className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800"
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="password" className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Senha de acesso
              </label>
            </div>
            <input 
              id="password"
              type="password" 
              placeholder="••••••••" 
              required
              className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm placeholder-zinc-400 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 transition-all duration-200 text-zinc-800"
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-indigo-600/20 active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Acessando...</span>
              </>
            ) : (
              <span>Entrar no sistema</span>
            )}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-zinc-500">
          Novo na plataforma?{' '}
          <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500 hover:underline transition-colors duration-200">
            Crie sua conta
          </Link>
        </p>
      </div>
    </div>
  );
}