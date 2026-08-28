const FILE_ICON_MAP: Record<string, string> = {
  zip: 'ZIP', rar: 'ZIP', '7z': 'ZIP', gz: 'ZIP', tar: 'ZIP',
  pdf: 'PDF',
  doc: 'DOC', docx: 'DOC',
  xls: 'XLS', xlsx: 'XLS', csv: 'XLS',
  ppt: 'PPT', pptx: 'PPT',
  txt: 'TXT', log: 'TXT', md: 'TXT',
  apk: 'APK',
  dmg: 'DMG',
  iso: 'ISO',
  exe: 'EXE', msi: 'EXE',
  js: 'CODE', ts: 'CODE', py: 'CODE', rs: 'CODE', go: 'CODE',
  java: 'CODE', c: 'CODE', cpp: 'CODE', h: 'CODE', html: 'CODE',
  css: 'CODE', scss: 'CODE', json: 'CODE', xml: 'CODE', yaml: 'CODE',
  sql: 'CODE', sh: 'CODE', bash: 'CODE', toml: 'CODE',
};

export function getFileIconLabel(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return FILE_ICON_MAP[ext] || 'FILE';
}

export function getFileIconColor(label: string): string {
  const colors: Record<string, string> = {
    ZIP: '#f5a623', PDF: '#e74c3c', DOC: '#2b7bd6', XLS: '#27ae60',
    PPT: '#e67e22', TXT: '#7f8c8d', APK: '#8e44ad', DMG: '#95a5a6',
    ISO: '#3498db', EXE: '#2c3e50', CODE: '#1abc9c', FILE: '#7f8c8d',
  };
  return colors[label] || '#7f8c8d';
}

export function isImage(mimeType: string | null): boolean {
  return mimeType ? mimeType.startsWith('image/') : false;
}

export function isVideo(mimeType: string | null): boolean {
  return mimeType ? mimeType.startsWith('video/') : false;
}

export function isAudio(mimeType: string | null): boolean {
  return mimeType ? mimeType.startsWith('audio/') : false;
}