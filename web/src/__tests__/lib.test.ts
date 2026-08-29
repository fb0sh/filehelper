import { describe, it, expect } from 'vitest';
import { formatBytes, formatSpeed } from '../lib/bytes';
import { formatMessageTime, formatDateSeparator, formatFullDate } from '../lib/dates';
import { getFileIconLabel, getFileIconColor, isImage, isVideo, isAudio } from '../lib/mime';

describe('formatBytes', () => {
  it('handles 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });
  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
  it('formats MB', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });
  it('formats GB', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });
  it('formats TB', () => {
    expect(formatBytes(1099511627776)).toBe('1.0 TB');
  });
});

describe('formatSpeed', () => {
  it('formats speed', () => {
    expect(formatSpeed(1048576)).toBe('1.0 MB/s');
  });
});

describe('formatMessageTime', () => {
  it('formats time with seconds', () => {
    const result = formatMessageTime('2024-01-15T14:30:00.000Z');
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('includes seconds in the output', () => {
    // 20:52:37 local
    const d = new Date(2024, 0, 15, 20, 52, 37);
    expect(formatMessageTime(d.toISOString())).toBe('20:52:37');
  });
});

describe('formatDateSeparator', () => {
  it('returns Today for today', () => {
    const now = new Date();
    const result = formatDateSeparator(now.toISOString());
    expect(result).toBe('Today');
  });
  it('returns Yesterday for yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000);
    const result = formatDateSeparator(yesterday.toISOString());
    expect(result).toBe('Yesterday');
  });
  it('returns formatted date for older', () => {
    const result = formatDateSeparator('2024-01-15T14:30:00.000Z');
    expect(result).toContain('January');
    expect(result).toContain('15');
  });
});

describe('formatFullDate', () => {
  it('includes year, time and seconds', () => {
    const d = new Date(2026, 7, 29, 20, 52, 37); // Aug 29 2026
    const result = formatFullDate(d.toISOString());
    expect(result).toContain('2026');
    expect(result).toContain('20:52:37');
    expect(result).toContain('August 29');
  });
});

describe('getFileIconLabel', () => {
  it('returns ZIP for zip files', () => {
    expect(getFileIconLabel('archive.zip')).toBe('ZIP');
  });
  it('returns PDF for pdf files', () => {
    expect(getFileIconLabel('doc.pdf')).toBe('PDF');
  });
  it('returns CODE for js files', () => {
    expect(getFileIconLabel('script.js')).toBe('CODE');
  });
  it('returns FILE for unknown extensions', () => {
    expect(getFileIconLabel('file.xyz')).toBe('FILE');
  });
  it('handles no extension', () => {
    expect(getFileIconLabel('README')).toBe('FILE');
  });
});

describe('getFileIconColor', () => {
  it('returns color for known types', () => {
    expect(getFileIconColor('ZIP')).toBe('#f5a623');
    expect(getFileIconColor('PDF')).toBe('#e74c3c');
  });
});

describe('MIME type checks', () => {
  it('isImage detects images', () => {
    expect(isImage('image/png')).toBe(true);
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('video/mp4')).toBe(false);
    expect(isImage(null)).toBe(false);
  });
  it('isVideo detects videos', () => {
    expect(isVideo('video/mp4')).toBe(true);
    expect(isVideo('image/png')).toBe(false);
  });
  it('isAudio detects audio', () => {
    expect(isAudio('audio/mpeg')).toBe(true);
    expect(isAudio('video/mp4')).toBe(false);
  });
});