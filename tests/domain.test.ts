import {describe,expect,it} from "vitest";
import {durationPrice,estimateImpact,returnSelectionAllowed} from "../src/domain";

describe("regras operacionais",()=>{
  it("exige a devolução integral nos alugueres normais",()=>{
    expect(returnSelectionAllowed("normal",["a","b"],["a"])).toBe(false);
    expect(returnSelectionAllowed("frequent",["a","b"],["a","b"])).toBe(true);
    expect(returnSelectionAllowed("school",["a"],["a"])).toBe(true);
  });
  it("permite devolução parcial apenas no institucional",()=>{
    expect(returnSelectionAllowed("institutional",["a","b"],["a"])).toBe(true);
    expect(returnSelectionAllowed("institutional",["a","b"],["x"])).toBe(false);
  });
  it("aplica o preço diário como teto",()=>{
    expect(durationPrice(4,10,1)).toBe(4);
    expect(durationPrice(4,10,2)).toBe(8);
    expect(durationPrice(4,10,3)).toBe(10);
  });
  it("calcula distância e CO2 de forma determinística",()=>{
    expect(estimateImpact(2,2)).toEqual({distance:32,co2:6.528});
  });
});
