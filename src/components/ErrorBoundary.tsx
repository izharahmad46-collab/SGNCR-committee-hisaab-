import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../firebase';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  detail: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '', detail: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    try {
      const parsed = JSON.parse(error.message) as FirestoreErrorInfo;
      if (parsed && typeof parsed.error === 'string' && parsed.operationType) {
        const isPerm = parsed.error.toLowerCase().includes('permission');
        return {
          hasError: true,
          message: isPerm
            ? 'Cloud Firestore permission denied for this operation. Please sign in with an authorized account.'
            : 'A Cloud Firestore synchronization error occurred.',
          detail: `${parsed.operationType.toUpperCase()} ${parsed.path || ''} — ${parsed.error}`,
        };
      }
    } catch {
      // Standard runtime error
    }
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
      detail: null,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F6F8F7] dark:bg-[#0B120F] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-base font-bold">S.G.N Committee Portal — Recovery Notice</h1>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{this.state.message}</p>
            {this.state.detail && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-data text-slate-600 dark:text-slate-400 break-words">
                {this.state.detail}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '', detail: null });
                window.location.reload();
              }}
              className="w-full min-h-[44px] rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload Portal</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
