import { describe, expect, it } from 'vitest';
import { parseFile } from '../fileParser.js';

const NO_FILES = new Set<string>();

describe('parseFile', () => {
  it('finds a function component that returns JSX', () => {
    const result = parseFile(
      'src/Header.tsx',
      'export function Header({ title }: { title: string }) { return <h1>{title}</h1>; }',
      NO_FILES,
    );
    expect(result.components.map((c) => c.name)).toEqual(['Header']);
    expect(result.components[0]?.isExported).toBe(true);
  });

  it('finds an arrow-function component', () => {
    const result = parseFile(
      'src/Badge.tsx',
      'export const Badge = () => <span>hi</span>;',
      NO_FILES,
    );
    expect(result.components.map((c) => c.name)).toEqual(['Badge']);
  });

  it('treats a lowercase function returning JSX as not a component', () => {
    const result = parseFile(
      'src/util.tsx',
      'export function renderThing() { return <div />; }',
      NO_FILES,
    );
    expect(result.components).toHaveLength(0);
  });

  it('distinguishes hooks from components by the use* convention', () => {
    const result = parseFile(
      'src/useCounter.ts',
      'export function useCounter() { return 0; }',
      NO_FILES,
    );
    expect(result.hooks.map((h) => h.name)).toEqual(['useCounter']);
    expect(result.components).toHaveLength(0);
  });

  it('resolves a relative import to a known file', () => {
    const known = new Set(['src/components/Header.tsx']);
    const result = parseFile(
      'src/App.tsx',
      "import { Header } from './components/Header';\nexport function App() { return <Header />; }",
      known,
    );
    const resolved = result.imports.map((i) => i.resolvedPath);
    expect(resolved).toContain('src/components/Header.tsx');
  });

  it('does not resolve bare package imports to local files', () => {
    const result = parseFile(
      'src/App.tsx',
      "import { useState } from 'react';\nexport function App() { return <div />; }",
      NO_FILES,
    );
    expect(result.imports.every((i) => i.resolvedPath === null)).toBe(true);
  });

  it('parses without throwing on syntactically broken input', () => {
    expect(() =>
      parseFile('src/Broken.tsx', 'export function Broken( { return <div>', NO_FILES),
    ).not.toThrow();
  });
});
