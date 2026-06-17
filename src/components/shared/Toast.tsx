'use client'

import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastType = 'success' | 'error' | 'info'

type Toast = {
  id: string
  type: ToastType
  message: string
}

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${++counterRef.current}`
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl animate-fade-in pointer-events-auto',
              'transition-all duration-300'
            )}
            style={{
              background: 'var(--bg-elevated)',
              borderColor:
                toast.type === 'success' ? 'var(--success)' :
                toast.type === 'error' ? 'var(--danger)' :
                'var(--border)',
            }}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />}
            {toast.type === 'error' && <AlertCircle size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />}
            {toast.type === 'info' && <Info size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />}
            <p className="text-sm flex-1" style={{ color: 'var(--text)' }}>{toast.message}</p>
            <button
              onClick={() => dismiss(toast.id)}
              className="flex-shrink-0 mt-0.5 transition-colors duration-150"
              style={{ color: 'var(--text-subtle)' }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
