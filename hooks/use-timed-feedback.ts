'use client';

import { useEffect, useState } from 'react';

/** Busy/error/message state whose error and message clear themselves after 3 seconds. */
export function useTimedFeedback() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!error && !message) return;
    const timer = window.setTimeout(() => {
      setError('');
      setMessage('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, message]);
  return { busy, setBusy, error, setError, message, setMessage };
}
