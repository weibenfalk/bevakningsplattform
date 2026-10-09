export interface LlmProvider {
  embed(text: string): Promise<number[]>;
  complete(request: { task: string; system: string; prompt: string }): Promise<string>;
}

export const LLM = Symbol('LLM');
