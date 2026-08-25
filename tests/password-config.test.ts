import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('configuração de palavras-passe no Cloudflare',()=>{
  it('não ultrapassa o limite PBKDF2 de 100.000 iterações',()=>{
    const source=readFileSync(new URL('../functions/api/[[path]].ts',import.meta.url),'utf8');
    expect(source).toContain('iterations=100000');
    expect(source).not.toContain('iterations=310000');
  });
});
