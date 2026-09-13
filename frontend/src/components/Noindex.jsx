import { useEffect } from 'react';

/* Adds <meta name="robots" content="noindex, nofollow"> to private application
   pages so search engines never index authenticated dashboards. */
export function useNoindex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      if (meta.parentNode) meta.parentNode.removeChild(meta);
    };
  }, []);
}

export default function Noindex() {
  useNoindex();
  return null;
}