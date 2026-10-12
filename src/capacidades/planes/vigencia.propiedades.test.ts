import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  TOLERANCIA_DE_VIGENCIA_EN_MS,
  decidirCambio,
  estadoDeDecision,
  vigenteEn,
  type Decision,
} from "./vigencia";

/**
 * «La última decisión manda» (§B.5.6) como propiedades sobre historiales GENERADOS: el oráculo es la
 * regla dicha de otra forma (simular el paso del tiempo y quedarse con el mayor número que empezó).
 */

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const HORA = 3_600_000;
const ahora = new Date(BASE);

/** Un historial con números 1..n y vigencias en un rango de ±10 días alrededor de ahora (en horas). */
const historial = fc
  .array(fc.integer({ min: -240, max: 240 }), { minLength: 0, maxLength: 8 })
  .map((horas) =>
    horas.map((h, i): Decision => ({ numero: i + 1, vigenteDesde: new Date(BASE + h * HORA) })),
  );

const mezclado = historial.chain((h) =>
  fc.shuffledSubarray(h, { minLength: h.length, maxLength: h.length }).map((m) => ({ h, m })),
);

describe("vigencia: propiedades", () => {
  it("vigenteEn es el de mayor número entre los empezados, sin importar el orden", () => {
    fc.assert(
      fc.property(mezclado, ({ h, m }) => {
        const empezados = h.filter((d) => d.vigenteDesde.getTime() <= BASE);
        const esperado = empezados.reduce<Decision | null>(
          (mejor, d) => (mejor === null || d.numero > mejor.numero ? d : mejor),
          null,
        );
        expect(vigenteEn(m, ahora)?.numero).toBe(esperado?.numero);
        expect(vigenteEn(h, ahora)?.numero).toBe(esperado?.numero);
      }),
    );
  });

  it("hay exactamente una VIGENTE si algo empezó, y ninguna si nada empezó", () => {
    fc.assert(
      fc.property(historial, (h) => {
        const vigentes = h.filter((d) => estadoDeDecision(h, d, ahora) === "VIGENTE");
        const empezo = h.some((d) => d.vigenteDesde.getTime() <= BASE);
        expect(vigentes.length).toBe(empezo ? 1 : 0);
        expect(vigentes[0]?.numero).toBe(vigenteEn(h, ahora)?.numero);
      }),
    );
  });

  it("las que no empezaron son PROGRAMADA o SIN_EFECTO; las que empezaron, VIGENTE, ANTERIOR o SIN_EFECTO", () => {
    fc.assert(
      fc.property(historial, (h) => {
        for (const d of h) {
          const estado = estadoDeDecision(h, d, ahora);
          const empezo = d.vigenteDesde.getTime() <= BASE;
          expect(
            empezo
              ? ["VIGENTE", "ANTERIOR", "SIN_EFECTO"].includes(estado)
              : ["PROGRAMADA", "SIN_EFECTO"].includes(estado),
          ).toBe(true);
        }
      }),
    );
  });

  it("una decisión SIN_EFECTO nunca rige, en ningún instante", () => {
    fc.assert(
      fc.property(historial, fc.integer({ min: -400, max: 400 }), (h, horas) => {
        const instante = new Date(BASE + horas * HORA);
        const vigente = vigenteEn(h, instante);
        for (const d of h) {
          if (estadoDeDecision(h, d, ahora) === "SIN_EFECTO") {
            expect(vigente?.numero).not.toBe(d.numero);
          }
        }
      }),
    );
  });

  it("una PROGRAMADA o la VIGENTE sí rigen en algún instante (las demás, no)", () => {
    fc.assert(
      fc.property(historial, (h) => {
        const instantes = h.flatMap((d) => [
          d.vigenteDesde.getTime(),
          d.vigenteDesde.getTime() + 1,
        ]);
        const rigieron = new Set(
          instantes.map((i) => vigenteEn(h, new Date(i))?.numero).filter((n) => n !== undefined),
        );
        for (const d of h) {
          const estado = estadoDeDecision(h, d, ahora);
          if (estado === "SIN_EFECTO") expect(rigieron.has(d.numero)).toBe(false);
          else expect(rigieron.has(d.numero)).toBe(true);
        }
      }),
    );
  });

  it("decidirCambio acepta solo con el número esperado correcto, y entonces el número es el último + 1", () => {
    fc.assert(
      fc.property(historial, fc.integer({ min: 0, max: 10 }), (h, esperado) => {
        const ultimo = h.length;
        const r = decidirCambio(h, {
          ahora,
          vigenteDesde: ahora,
          numeroEsperado: esperado === 0 ? null : esperado,
          reemplazaProgramada: true,
        });
        const correcto = ultimo === 0 ? esperado === 0 : esperado === ultimo;
        expect(r.ok).toBe(correcto);
        if (r.ok) expect(r.valor.numero).toBe(ultimo + 1);
      }),
    );
  });

  it("una decisión nueva que empieza ya pasa a ser la vigente (la última decisión manda)", () => {
    fc.assert(
      fc.property(historial, fc.integer({ min: -1, max: 0 }), (h, minutos) => {
        const desde = new Date(BASE + minutos * 30_000);
        const r = decidirCambio(h, {
          ahora,
          vigenteDesde: desde,
          numeroEsperado: h.length === 0 ? null : h.length,
          reemplazaProgramada: true,
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const con = [...h, { numero: r.valor.numero, vigenteDesde: desde }];
        expect(vigenteEn(con, ahora)?.numero).toBe(r.valor.numero);
      }),
    );
  });

  it("las reemplazadas informadas quedan SIN_EFECTO, y las programadas anteriores que no, siguen programadas", () => {
    fc.assert(
      fc.property(historial, fc.integer({ min: 0, max: 240 }), (h, horas) => {
        const desde = new Date(BASE + horas * HORA);
        const r = decidirCambio(h, {
          ahora,
          vigenteDesde: desde,
          numeroEsperado: h.length === 0 ? null : h.length,
          reemplazaProgramada: true,
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const con = [...h, { numero: r.valor.numero, vigenteDesde: desde }];
        for (const numero of r.valor.programadasPendientes) {
          const d = con.find((x) => x.numero === numero) as Decision;
          const estado = estadoDeDecision(con, d, ahora);
          expect(estado).toBe(r.valor.reemplazadas.includes(numero) ? "SIN_EFECTO" : "PROGRAMADA");
        }
      }),
    );
  });

  it("sin reemplazaProgramada, con programadas pendientes se rechaza; sin ellas, se acepta", () => {
    fc.assert(
      fc.property(historial, (h) => {
        const hay = h.some((d) => estadoDeDecision(h, d, ahora) === "PROGRAMADA");
        const r = decidirCambio(h, {
          ahora,
          vigenteDesde: ahora,
          numeroEsperado: h.length === 0 ? null : h.length,
          reemplazaProgramada: false,
        });
        expect(r.ok).toBe(!hay);
        if (!r.ok) expect(r.error.codigo).toBe("CAMBIO_PROGRAMADO_PENDIENTE");
      }),
    );
  });

  it("la vigencia retroactiva se rechaza más allá de la tolerancia, sea cual sea el historial", () => {
    fc.assert(
      fc.property(historial, fc.integer({ min: 1, max: 5000 }), (h, ms) => {
        const r = decidirCambio(h, {
          ahora,
          vigenteDesde: new Date(BASE - TOLERANCIA_DE_VIGENCIA_EN_MS - ms),
          numeroEsperado: h.length === 0 ? null : h.length,
          reemplazaProgramada: true,
        });
        expect(r).toEqual({ ok: false, error: { codigo: "VIGENCIA_RETROACTIVA" } });
      }),
    );
  });
});
