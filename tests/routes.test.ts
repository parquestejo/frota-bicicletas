import {describe,expect,it} from 'vitest';

function normalizePath(rawPath:string|string[]|undefined){
  const parts=(Array.isArray(rawPath)?rawPath.map(String):String(rawPath||'').split('/')).filter(Boolean);
  return '/'+parts.join('/');
}

describe('rotas catch-all do Cloudflare Pages',()=>{
  it('normaliza uma rota com um segmento',()=>expect(normalizePath('bootstrap')).toBe('/bootstrap'));
  it('normaliza uma rota multiparte recebida como lista',()=>expect(normalizePath(['auth','login'])).toBe('/auth/login'));
  it('normaliza uma rota multiparte recebida como texto',()=>expect(normalizePath('rentals/123/return')).toBe('/rentals/123/return'));
  it('normaliza a rota do talão de fecho diário',()=>expect(normalizePath(['daily-closures','abc','receipt'])).toBe('/daily-closures/abc/receipt'));
});
