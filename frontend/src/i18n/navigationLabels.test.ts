import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// #1408: two pt-BR sidebar labels were left in English.
describe('pt-BR navigation labels', () => {
  const ptBR = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'pt-BR.json'), 'utf8'));

  it('pt-BR names the TCLE builder in Portuguese', () => {
    expect(ptBR.navigation.tcleBuilder).toBe('Construtor de TCLE');
  });

  it('pt-BR names the data dictionary in Portuguese', () => {
    expect(ptBR.navigation.dataDictionary).toBe('Dicionário de Dados');
  });
});
