import { describe, expect, it } from "vitest";
import {
  DIAS_DE_AVISO_POR_DEFECTO,
  certificadosPorVencer,
  type CertificadoParaAvisar,
} from "./vencimiento-de-certificados";
import { certificadoId, emisorId } from "./identificadores";

const DIA = 86_400_000;
const AHORA = new Date("2026-10-14T12:00:00.000Z");
const en = (ms: number) => new Date(AHORA.getTime() + ms);

const cert = (
  id: string,
  venceEn: Date | null,
  cambios: Partial<CertificadoParaAvisar> = {},
): CertificadoParaAvisar => ({
  id: certificadoId(id),
  emisorId: emisorId("emisor-1"),
  ambiente: "PRODUCCION",
  alias: `alias${id}`,
  estado: "VIGENTE",
  venceEn,
  ...cambios,
});

describe("certificadosPorVencer", () => {
  it("el aviso por defecto es de 30 días", () => {
    expect(DIAS_DE_AVISO_POR_DEFECTO).toBe(30);
    const avisos = certificadosPorVencer(
      [cert("a", en(30 * DIA)), cert("b", en(30 * DIA + 1))],
      AHORA,
    );
    expect(avisos.map((a) => a.certificadoId)).toEqual(["a"]);
  });

  it("avisa de los vigentes que vencen dentro de los N días, con el límite inclusive", () => {
    const certificados = [
      cert("lejos", en(11 * DIA)),
      cert("justo", en(10 * DIA)),
      cert("cerca", en(3 * DIA)),
    ];
    expect(certificadosPorVencer(certificados, AHORA, 10).map((a) => a.certificadoId)).toEqual([
      "cerca",
      "justo",
    ]);
    expect(certificadosPorVencer(certificados, AHORA, 0)).toEqual([]);
    expect(certificadosPorVencer(certificados, AHORA, 365)).toHaveLength(3);
  });

  it("un aviso lleva qué certificado, de quién y cuándo vence, y los días que faltan (hacia arriba)", () => {
    const venceEn = en(2 * DIA + 1);
    expect(certificadosPorVencer([cert("a", venceEn)], AHORA, 10)).toEqual([
      {
        certificadoId: "a",
        emisorId: "emisor-1",
        ambiente: "PRODUCCION",
        alias: "aliasa",
        venceEn,
        diasRestantes: 3,
        vencido: false,
      },
    ]);
    expect(certificadosPorVencer([cert("a", en(2 * DIA))], AHORA, 10)[0]?.diasRestantes).toBe(2);
    expect(certificadosPorVencer([cert("a", en(1))], AHORA, 10)[0]?.diasRestantes).toBe(1);
  });

  it("un vigente que ya venció avisa, marcado como vencido; en el instante exacto también", () => {
    const avisos = certificadosPorVencer(
      [cert("ayer", en(-DIA)), cert("ahora", en(0)), cert("pronto", en(1))],
      AHORA,
      5,
    );
    expect(avisos.map((a) => [a.certificadoId, a.vencido, a.diasRestantes])).toEqual([
      ["ayer", true, -1],
      ["ahora", true, 0],
      ["pronto", false, 1],
    ]);
  });

  it("solo avisa de los vigentes: pedidos, reemplazados y descartados no, ni los sin vencimiento", () => {
    const soon = en(DIA);
    const certificados = [
      cert("p", null, { estado: "PEDIDO_GENERADO" }),
      cert("r", soon, { estado: "REEMPLAZADO" }),
      cert("d", soon, { estado: "DESCARTADO" }),
      cert("p2", soon, { estado: "PEDIDO_GENERADO" }),
      cert("sin", null),
      cert("v", soon),
    ];
    expect(certificadosPorVencer(certificados, AHORA, 10).map((a) => a.certificadoId)).toEqual([
      "v",
    ]);
  });

  it("ordena por vencimiento y deja en su orden a los que vencen a la vez", () => {
    const mismo = en(5 * DIA);
    const avisos = certificadosPorVencer(
      [cert("z", mismo), cert("tarde", en(9 * DIA)), cert("a", mismo), cert("ya", en(-DIA))],
      AHORA,
      10,
    );
    expect(avisos.map((a) => a.certificadoId)).toEqual(["ya", "z", "a", "tarde"]);
  });

  it("sin certificados no hay avisos y no toca lo recibido", () => {
    expect(certificadosPorVencer([], AHORA)).toEqual([]);
    const entrada = [cert("b", en(2 * DIA)), cert("a", en(DIA))];
    certificadosPorVencer(entrada, AHORA, 10);
    expect(entrada.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "unos días de aviso que no son un entero mayor o igual a 0 (%s) son un defecto: RangeError",
    (dias) => {
      expect(() => certificadosPorVencer([], AHORA, dias)).toThrow(
        new RangeError("los días de aviso son un entero mayor o igual a 0"),
      );
    },
  );
});
