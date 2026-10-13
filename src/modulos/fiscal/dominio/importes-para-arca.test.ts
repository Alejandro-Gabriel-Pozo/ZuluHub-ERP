import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  facturaOSinTotal,
  receptorInscripto,
  renglon,
  renglonArbitrario,
} from "../../../../test/utilidades/facturacion";
import { importeATexto, importeCero, sumar } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { importesParaArca, type ImportesParaArca } from "./importes-para-arca";

const texto = (i: ImportesParaArca) => ({
  total: importeATexto(i.total),
  neto: importeATexto(i.neto),
  iva: importeATexto(i.iva),
  exento: importeATexto(i.exento),
  noGravado: importeATexto(i.noGravado),
  tributos: importeATexto(i.tributos),
  alicuotas: i.alicuotas.map((a) => [a.alicuota, importeATexto(a.base), importeATexto(a.iva)]),
});

const contextoC = contextoDeEmision({ emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }) });

describe("importesParaArca: letras A y B", () => {
  it("B a consumidor final con dos alícuotas (caso E7 del espía): una entrada por alícuota", () => {
    const c = facturaArmada(consumidorFinal, [
      renglon("1210.00", "1", "21"),
      renglon("1050.00", "1", "10.5"),
    ]);
    expect(texto(importesParaArca(c))).toEqual({
      total: "2260.00",
      neto: "1950.23",
      iva: "309.77",
      exento: "0.00",
      noGravado: "0.00",
      tributos: "0.00",
      alicuotas: [
        ["10.5", "950.23", "99.77"],
        ["21", "1000.00", "210.00"],
      ],
    });
  });

  it("A con IVA discriminado (caso E8)", () => {
    const c = facturaArmada(receptorInscripto, [renglon("1000.00", "1", "21")], {
      modoDePrecio: "IVA_DISCRIMINADO",
    });
    expect(texto(importesParaArca(c))).toEqual({
      total: "1210.00",
      neto: "1000.00",
      iva: "210.00",
      exento: "0.00",
      noGravado: "0.00",
      tributos: "0.00",
      alicuotas: [["21", "1000.00", "210.00"]],
    });
  });

  it("exento y no gravado van aparte: ImpOpEx e ImpTotConc, y no figuran en Iva[]", () => {
    const c = facturaArmada(consumidorFinal, [
      renglon("121.00", "1", "21"),
      renglon("10.00", "1", "EXENTO"),
      renglon("20.00", "1", "NO_GRAVADO"),
    ]);
    expect(texto(importesParaArca(c))).toEqual({
      total: "151.00",
      neto: "100.00",
      iva: "21.00",
      exento: "10.00",
      noGravado: "20.00",
      tributos: "0.00",
      alicuotas: [["21", "100.00", "21.00"]],
    });
  });

  it("la alícuota 0 % se informa junto a las demás cuando hay IVA (error 10018)", () => {
    const c = facturaArmada(consumidorFinal, [
      renglon("121.00", "1", "21"),
      renglon("30.00", "1", "0"),
    ]);
    expect(texto(importesParaArca(c)).alicuotas).toEqual([
      ["0", "30.00", "0.00"],
      ["21", "100.00", "21.00"],
    ]);
  });

  it("solo 0 %: ImpIVA es cero y se informa solo esa alícuota", () => {
    const c = facturaArmada(consumidorFinal, [renglon("30.00", "1", "0")]);
    expect(texto(importesParaArca(c))).toMatchObject({
      neto: "30.00",
      iva: "0.00",
      alicuotas: [["0", "30.00", "0.00"]],
    });
  });

  it("solo exento: no hay neto gravado ni entradas de IVA", () => {
    const c = facturaArmada(consumidorFinal, [renglon("30.00", "1", "EXENTO")]);
    expect(texto(importesParaArca(c))).toEqual({
      total: "30.00",
      neto: "0.00",
      iva: "0.00",
      exento: "30.00",
      noGravado: "0.00",
      tributos: "0.00",
      alicuotas: [],
    });
  });

  it("con ImpIVA en cero ARCA solo admite la alícuota 0 %: un total de centavos colapsa a esa entrada (error 10018)", () => {
    // $ 0,01 al 21 %: neto 0,01 e IVA 0,00 (0,0083 redondea a cero)
    const c = facturaArmada(consumidorFinal, [
      renglon("0.01", "1", "21"),
      renglon("0.01", "1", "10.5"),
    ]);
    const i = importesParaArca(c);
    expect(texto(i)).toMatchObject({ total: "0.02", neto: "0.02", iva: "0.00" });
    expect(texto(i).alicuotas).toEqual([["0", "0.02", "0.00"]]);
  });
});

describe("importesParaArca: letra C", () => {
  it("el total es el neto y todo lo demás es cero; no se informa Iva[]", () => {
    const c = facturaArmada(consumidorFinal, [renglon("100.00", "3", null)], {}, contextoC);
    expect(texto(importesParaArca(c))).toEqual({
      total: "300.00",
      neto: "300.00",
      iva: "0.00",
      exento: "0.00",
      noGravado: "0.00",
      tributos: "0.00",
      alicuotas: [],
    });
  });
});

describe("importesParaArca: propiedades", () => {
  it("ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA, exacto, y ningún importe negativo (error 10048)", () => {
    fc.assert(
      fc.property(
        fc.array(renglonArbitrario(), { minLength: 1, maxLength: 6 }),
        fc.constantFrom(consumidorFinal, receptorInscripto),
        fc.constantFrom("IVA_INCLUIDO", "IVA_DISCRIMINADO"),
        (renglones, receptor, modoDePrecio) => {
          const c = facturaOSinTotal(receptor, renglones, { modoDePrecio });
          if (c === null) return;
          const i = importesParaArca(c);
          const suma = [i.noGravado, i.neto, i.exento, i.tributos, i.iva].reduce(
            sumar,
            importeCero(ARS),
          );
          expect(suma).toEqual(i.total);
          for (const x of [i.total, i.neto, i.iva, i.exento, i.noGravado, i.tributos]) {
            expect(x.unidades >= 0n).toBe(true);
          }
        },
      ),
    );
  });

  it("Iva[] no repite alícuotas, suma ImpIVA y su base suma ImpNeto", () => {
    fc.assert(
      fc.property(fc.array(renglonArbitrario(), { minLength: 1, maxLength: 6 }), (renglones) => {
        const c = facturaOSinTotal(consumidorFinal, renglones);
        if (c === null) return;
        const i = importesParaArca(c);
        const codigos = i.alicuotas.map((a) => a.alicuota);
        expect(new Set(codigos).size).toBe(codigos.length);
        expect(i.alicuotas.reduce((acc, a) => sumar(acc, a.iva), importeCero(ARS))).toEqual(i.iva);
        expect(i.alicuotas.reduce((acc, a) => sumar(acc, a.base), importeCero(ARS))).toEqual(
          i.neto,
        );
        if (i.iva.unidades === 0n) expect(codigos.every((a) => a === "0")).toBe(true);
      }),
    );
  });

  it("en la letra C el neto es el total, sin IVA, para cualquier renglón", () => {
    fc.assert(
      fc.property(
        fc.array(renglonArbitrario(fc.constant(null)), { minLength: 1, maxLength: 6 }),
        (renglones) => {
          const c = facturaOSinTotal(consumidorFinal, renglones, {}, contextoC);
          if (c === null) return;
          const i = importesParaArca(c);
          expect(i.neto).toEqual(i.total);
          expect(i.iva.unidades).toBe(0n);
          expect(i.alicuotas).toEqual([]);
        },
      ),
    );
  });
});
