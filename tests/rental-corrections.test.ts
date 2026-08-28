import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/007_rental_corrections.sql',import.meta.url),'utf8');

describe('correções de alugueres',()=>{
  it('só permite corrigir alugueres em aberto',()=>expect(migration).toContain("r.status<>'Em aberto'"));
  it('só permite adicionar bicicletas disponíveis',()=>expect(migration).toContain("b.status<>'Disponível'"));
  it('impede remover a última bicicleta',()=>expect(migration).toContain('remaining<=1'));
  it('regista adições e remoções na auditoria',()=>{expect(migration).toContain("'adicionar bicicleta'");expect(migration).toContain("'remover bicicleta'")});
});
