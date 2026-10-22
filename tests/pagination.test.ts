import {describe,expect,it} from "vitest";
import {pagination} from "../functions/api/_shared";

describe("paginação da API",()=>{
  it("aplica valores predefinidos",()=>{
    expect(pagination(new Request("https://app.test/api/activity"))).toEqual({page:1,pageSize:25,from:0,to:24});
  });
  it("calcula o intervalo e limita o tamanho máximo",()=>{
    expect(pagination(new Request("https://app.test/api/activity?page=3&page_size=500"),50,100)).toEqual({page:3,pageSize:100,from:200,to:299});
  });
  it("corrige valores inválidos",()=>{
    expect(pagination(new Request("https://app.test/api/activity?page=-4&page_size=0"),50,100)).toEqual({page:1,pageSize:50,from:0,to:49});
  });
});
