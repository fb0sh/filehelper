import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SearchHighlightedText } from '../features/search/SearchHighlightedText';

describe('SearchHighlightedText', () => {
  it('highlights every occurrence with <mark> and keeps the rest intact', () => {
    const { container } = render(
      <SearchHighlightedText text="FileHelper abc FileHelper xyz FileHelper" query="FileHelper" />
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(3);
    marks.forEach((m) => expect(m.textContent).toBe('FileHelper'));
    // All original text is preserved, in order, including non-matches.
    expect(container.textContent).toBe('FileHelper abc FileHelper xyz FileHelper');
  });

  it('is case-insensitive', () => {
    const { container } = render(
      <SearchHighlightedText text="Hello world" query="hello" />
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Hello');
  });

  it('renders plain text when there is no match or no query', () => {
    const { container, rerender } = render(
      <SearchHighlightedText text="nothing here" query="nope" />
    );
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(container.textContent).toBe('nothing here');

    rerender(<SearchHighlightedText text="anything" query="" />);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(container.textContent).toBe('anything');
  });

  it('highlights regex-special characters literally', () => {
    const { container } = render(
      <SearchHighlightedText text="a+b test[1] hello.world foo(bar)" query="test[1]" />
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('test[1]');
  });

  it('highlights Chinese and emoji', () => {
    const { container } = render(
      <SearchHighlightedText text="文件助手搜索测试" query="文件助手" />
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('文件助手');

    const emoji = render(
      <SearchHighlightedText text="release🚀ready" query="🚀" />
    );
    expect(emoji.container.querySelectorAll('mark')).toHaveLength(1);
  });

  it('uses real DOM <mark> elements (not dangerouslySetInnerHTML)', () => {
    const { container } = render(
      <SearchHighlightedText text="x <img src=x onerror=alert(1)> y" query="img" />
    );
    // The injected text stays inert text — no element is parsed.
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
