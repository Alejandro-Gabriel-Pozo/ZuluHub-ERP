import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import {
  costoDefinitivo,
  entrar,
  ESTADO_DE_COSTO_INICIAL,
  salir,
  SIN_COSTO,
  transferir,
  type EstadoDeCosto,
} from "./costo";

/** Texto decimal de `unidades` con `escala` decimales, escrito aparte de la implementación (oráculo). */
const aTexto = (unidades: bigint, escala: number): string => {
  const s = unidades.toString().padStart(escala + 1, "0");
  return `${s.slice(0, s.length - escala)}.${s.slice(s.length - escala)}`;
};
const q = (u: bigint) => cantidadDesdeTexto(aTexto(u, 4));
const c = (u: bigint) => costoDefinitivo(precioUnitarioDesdeTexto(aTexto(u, 6)));

const cantidad = fc.bigInt({ min: 1n, max: 10n ** 9n });
const costo = fc.bigInt({ min: 0n, max: 10n ** 10n });

type Paso =
  | { tipo: "CON_COSTO"; q: bigint; c: bigint }
  | { tipo: "SIN_COSTO"; q: bigint }
  | { tipo: "SALIDA"; q: bigint };
const paso = fc.oneof(
  fc.record({ tipo: fc.constant("CON_COSTO" as const), q: cantidad, c: costo }),
  fc.record({ tipo: fc.constant("SIN_COSTO" as const), q: cantidad }),
  fc.record({ tipo: fc.constant("SALIDA" as const), q: cantidad }),
);

/** Oráculo: mitad hacia arriba para valores no negativos (es la política vigente cuando no hay signo). */
const mitadSube = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);

function aplicar(estado: EstadoDeCosto, p: Paso): EstadoDeCosto {
  if (p.tipo === "CON_COSTO") return entrar(estado, q(p.q), c(p.c));
  if (p.tipo === "SIN_COSTO") return entrar(estado, q(p.q), SIN_COSTO);
  return salir(estado, q(p.q)).estado;
}

describe("costo promedio: propiedades (P23, lo puro)", () => {
  it("una entrada con costo da el promedio redondeado una vez, calculado con aritmética bigint aparte", () => {
    fc.assert(
      fc.property(cantidad, costo, cantidad, costo, (qp, cp, qi, ci) => {
        const previo = entrar(ESTADO_DE_COSTO_INICIAL, q(qp), c(cp));
        const nuevo = entrar(previo, q(qi), c(ci));
        expect(nuevo.promedio?.unidades).toBe(mitadSube(qp * cp + qi * ci, qp + qi));
        expect(nuevo.cantidadValorizada.unidades).toBe(qp + qi);
      }),
    );
  });

  it("el promedio queda entre el menor y el mayor de los costos que entraron", () => {
    fc.assert(
      fc.property(cantidad, costo, cantidad, costo, (qp, cp, qi, ci) => {
        const nuevo = entrar(entrar(ESTADO_DE_COSTO_INICIAL, q(qp), c(cp)), q(qi), c(ci));
        const promedio = nuevo.promedio?.unidades as bigint;
        expect(promedio >= (cp < ci ? cp : ci)).toBe(true);
        expect(promedio <= (cp < ci ? ci : cp)).toBe(true);
      }),
    );
  });

  it("las entradas sin costo nunca cambian el estado, en ningún orden", () => {
    fc.assert(
      fc.property(fc.array(paso, { maxLength: 12 }), cantidad, (pasos, qs) => {
        const estado = pasos.reduce(aplicar, ESTADO_DE_COSTO_INICIAL);
        expect(entrar(estado, q(qs), SIN_COSTO)).toBe(estado);
      }),
    );
  });

  it("con cualquier historia: la cantidad valorizada nunca es negativa y el promedio solo lo cambian las entradas con costo", () => {
    fc.assert(
      fc.property(fc.array(paso, { maxLength: 15 }), (pasos) => {
        let estado = ESTADO_DE_COSTO_INICIAL;
        for (const p of pasos) {
          const antes = estado;
          estado = aplicar(estado, p);
          expect(estado.cantidadValorizada.unidades >= 0n).toBe(true);
          if (p.tipo !== "CON_COSTO") expect(estado.promedio).toBe(antes.promedio);
          if (p.tipo === "SALIDA") {
            expect(estado.cantidadValorizada.unidades).toBe(
              antes.cantidadValorizada.unidades > p.q
                ? antes.cantidadValorizada.unidades - p.q
                : 0n,
            );
          }
        }
      }),
    );
  });

  it("una salida congela el promedio vigente; sin historia, SIN_COSTO", () => {
    fc.assert(
      fc.property(fc.array(paso, { maxLength: 12 }), cantidad, (pasos, qs) => {
        const estado = pasos.reduce(aplicar, ESTADO_DE_COSTO_INICIAL);
        const r = salir(estado, q(qs));
        if (estado.promedio === null) expect(r.costo).toBe(SIN_COSTO);
        else expect(r.costo).toEqual({ estado: "DEFINITIVO", costoUnitario: estado.promedio });
      }),
    );
  });

  it("transferir lleva el costo de origen y conserva la cantidad valorizada total cuando el origen alcanza", () => {
    fc.assert(
      fc.property(
        fc.array(paso, { maxLength: 8 }),
        fc.array(paso, { maxLength: 8 }),
        cantidad,
        (pasosO, pasosD, qt) => {
          const origen = pasosO.reduce(aplicar, ESTADO_DE_COSTO_INICIAL);
          const destino = pasosD.reduce(aplicar, ESTADO_DE_COSTO_INICIAL);
          const r = transferir(origen, destino, q(qt));
          expect(r.costo).toEqual(
            origen.promedio === null
              ? SIN_COSTO
              : { estado: "DEFINITIVO", costoUnitario: origen.promedio },
          );
          if (origen.promedio !== null && origen.cantidadValorizada.unidades >= qt) {
            expect(
              r.origen.cantidadValorizada.unidades + r.destino.cantidadValorizada.unidades,
            ).toBe(origen.cantidadValorizada.unidades + destino.cantidadValorizada.unidades);
          }
        },
      ),
    );
  });

  it("anular una salida (entrar al costo congelado) devuelve la cantidad valorizada cuando no hubo piso", () => {
    fc.assert(
      fc.property(fc.array(paso, { maxLength: 10 }), cantidad, (pasos, qs) => {
        const estado = pasos.reduce(aplicar, ESTADO_DE_COSTO_INICIAL);
        fc.pre(estado.cantidadValorizada.unidades >= qs);
        const s = salir(estado, q(qs));
        const vuelta = entrar(s.estado, q(qs), s.costo);
        expect(vuelta.cantidadValorizada.unidades).toBe(estado.cantidadValorizada.unidades);
        // el promedio entra igual a sí mismo: no se mueve
        expect(vuelta.promedio?.unidades).toBe(estado.promedio?.unidades);
      }),
    );
  });
});
