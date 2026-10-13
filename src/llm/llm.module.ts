import { Module } from '@nestjs/common';
import { LLM } from './llm.provider';
import { StubProvider } from './stub.provider';

@Module({ providers: [{ provide: LLM, useClass: StubProvider }], exports: [LLM] })
export class LlmModule {}
