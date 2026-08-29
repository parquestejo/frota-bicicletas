import {describe,expect,it} from 'vitest';
import {apiSource} from './project-source';

describe('configuração de palavras-passe no Cloudflare',()=>{
  it('não ultrapassa o limite PBKDF2 de 100.000 iterações',()=>{
    const source=apiSource;
    expect(source).toContain('iterations=100000');
    expect(source).not.toContain('iterations=310000');
  });
});
