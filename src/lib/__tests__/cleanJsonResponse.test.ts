import { describe, it, expect } from 'vitest';
import { cleanJsonResponse } from '../ai';

// テキストモードのプロバイダー（claude/openai/groq/openrouter/lmstudio/custom）は
// コードフェンスや前置きを付けて JSON を返すことがあるため、本体だけを抜き出せることの検証。
describe('cleanJsonResponse', () => {
  it('```json フェンスを除去する', () => {
    expect(cleanJsonResponse('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('言語指定なしの ``` フェンスも除去する', () => {
    expect(cleanJsonResponse('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('前置き・後置きのテキストを捨てて {...} 本体を抜き出す', () => {
    const raw = '以下が結果です。\n{"candidates":[{"title":"x"}]}\nご確認ください。';
    expect(cleanJsonResponse(raw)).toBe('{"candidates":[{"title":"x"}]}');
  });

  it('純粋な JSON はそのまま返す', () => {
    expect(cleanJsonResponse('{"a":1}')).toBe('{"a":1}');
  });

  it('入れ子の閉じ括弧まで含めて最後の } を取る', () => {
    const raw = 'x {"a":{"b":2}} y';
    expect(cleanJsonResponse(raw)).toBe('{"a":{"b":2}}');
  });

  it('JSON が見つからなければ trim した原文を返す', () => {
    expect(cleanJsonResponse('  申し訳ございません  ')).toBe('申し訳ございません');
  });
});
