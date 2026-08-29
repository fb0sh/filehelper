// Plain download: a hidden anchor without the `download` attribute — the
// server controls the real filename via Content-Disposition:
// attachment; filename*=UTF-8''...
export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}