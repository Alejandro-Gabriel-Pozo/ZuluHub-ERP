import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { lineaRazonable } from "../../../../test/propiedades/generadores";
import {
  EMISOR_1,
  EMISOR_2,
  EMISOR_3,
  SOLICITUD_1,
  SOLICITUD_2,
  serieLibre,
} from "../../../../test/utilidades/fiscal";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import {
  importeCero,
  importeDesdeTexto,
  importesIguales,
  sumar,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import type { DesenlaceDeAutorizacion } from "./estados-de-comprobante";
import type { EmisorId, SolicitudId } from "./identificadores";
import {
  cerrarSerie,
  reconciliarSerie,
  reservarNumero,
  resincronizarSerie,
  transicionDeSerieValida,
  verificarSecuencia,
  type Serie,
} from "./numeracion";
import {
  calcularComprobantesDeVenta,
  planificarComprobantes,
  repartirCobro,
  totalDeLaVenta,
  type PuntoDeVentaDeSucursal,
} from "./plan-de-comprobantes";
import {
  resolverEmisor,
  type DatosDeLinea,
  type DatosAFacturar,
  type ReglaDeEmisor,
} from "./resolucion-de-emisor";
import { estadoDeVersion, versionVigente, type VersionConfirmada } from "./vigencia";
import { puntoDeVentaId } from "./identificadores";

const emisores: readonly EmisorId[] = [EMISOR_1, EMISOR_2, EMISOR_3];

// --- versionVigente ---------------------------------------------------------------------------

const versiones = fc
  .array(fc.integer({ min: 0, max: 20 }), { minLength: 0, maxLength: 8 })
  .map((desdes): VersionConfirmada[] =>
    desdes.map((d, i) => ({ numero: i + 1, vigenteDesde: new Date(d * 1000) })),
  );
const instante = fc.integer({ min: -5, max: 25 }).map((s) => new Date(s * 1000));

describe("versionVigente: propiedades", () => {
  it("es una de las versiones, ya empezó, y ninguna otra que ya empezó la supera", () => {
    fc.assert(
      fc.property(versiones, instante, (vs, ahora) => {
        const vigente = versionVigente(vs, ahora);
        const empezadas = vs.filter((v) => v.vigenteDesde.getTime() <= ahora.getTime());
        if (empezadas.length === 0) {
          expect(vigente).toBeNull();
          return;
        }
        expect(vigente).not.toBeNull();
        if (vigente === null) return;
        expect(vs).toContain(vigente);
        for (const v of empezadas) {
          const gana =
            v.vigenteDesde.getTime() < vigente.vigenteDesde.getTime() ||
            (v.vigenteDesde.getTime() === vigente.vigenteDesde.getTime() &&
              v.numero <= vigente.numero);
          expect(gana).toBe(true);
        }
      }),
    );
  });

  it("no depende del orden de la lista (determinista ante empates)", () => {
    fc.assert(
      fc.property(versiones, instante, fc.integer(), (vs, ahora, semilla) => {
        const barajadas = [...vs].sort(
          (a, b) => ((a.numero * 31 + semilla) % 7) - ((b.numero * 31 + semilla) % 7),
        );
        expect(versionVigente(barajadas, ahora)).toBe(versionVigente(vs, ahora));
      }),
    );
  });

  it("agregar una versión no cambia lo vigente en instantes anteriores a su vigencia (nada se pisa)", () => {
    fc.assert(
      fc.property(versiones, fc.integer({ min: 0, max: 20 }), instante, (vs, desde, ahora) => {
        const nueva: VersionConfirmada = {
          numero: vs.length + 1,
          vigenteDesde: new Date(desde * 1000),
        };
        if (ahora.getTime() < nueva.vigenteDesde.getTime()) {
          expect(versionVigente([...vs, nueva], ahora)).toBe(versionVigente(vs, ahora));
        }
      }),
    );
  });

  it("a lo sumo una versión está vigente y las futuras no lo están", () => {
    fc.assert(
      fc.property(versiones, instante, (vs, ahora) => {
        const estados = vs.map((v) => estadoDeVersion(vs, v, ahora));
        expect(estados.filter((e) => e === "VIGENTE").length).toBeLessThanOrEqual(1);
        vs.forEach((v, i) => {
          expect(estados[i] === "FUTURA").toBe(v.vigenteDesde.getTime() > ahora.getTime());
        });
        expect(estados.includes("VIGENTE")).toBe(vs.some((v) => v.vigenteDesde <= ahora));
      }),
    );
  });
});

// --- resolverEmisor ---------------------------------------------------------------------------

const emisorOpcional = fc.constantFrom<EmisorId | null>(null, ...emisores);
const regla = fc.record({ permitirEleccionManual: fc.boolean() }) as fc.Arbitrary<ReglaDeEmisor>;
const activos = fc.subarray([...emisores]).map((lista): ReadonlySet<EmisorId> => new Set(lista));
const venta = fc.record({
  puntoDeVentaElegido: fc.option(
    emisorOpcional
      .filter((e): e is EmisorId => e !== null)
      .map((emisorId) => ({
        id: puntoDeVentaId("pv-x"),
        emisorId,
      })),
    { nil: null },
  ),
  eleccionManual: emisorOpcional,
  emisoresActivos: activos,
}) as fc.Arbitrary<DatosAFacturar>;
const linea = fc.record({
  emisorDelProducto: emisorOpcional,
  emisorDelDeposito: emisorOpcional,
}) as fc.Arbitrary<DatosDeLinea>;

describe("resolverEmisor: propiedades", () => {
  it("lo exclusivo siempre gana: ni el punto de venta ni la elección manual ni la regla lo pisan", () => {
    fc.assert(
      fc.property(regla, venta, linea, (r, v, l) => {
        const exclusivo = l.emisorDelProducto ?? l.emisorDelDeposito;
        const resultado = resolverEmisor(r, v, l);
        if (exclusivo === null) return;
        if (resultado.ok) {
          expect(resultado.valor).toEqual({ emisorId: exclusivo, motivo: "EXCLUSIVO" });
        } else {
          expect(["EMISOR_EN_CONFLICTO", "EMISOR_INACTIVO"]).toContain(resultado.error);
        }
      }),
    );
  });

  it("el resultado es un emisor activo o un error: nunca un emisor inactivo", () => {
    fc.assert(
      fc.property(regla, venta, linea, (r, v, l) => {
        const resultado = resolverEmisor(r, v, l);
        if (resultado.ok) expect(v.emisoresActivos.has(resultado.valor.emisorId)).toBe(true);
      }),
    );
  });

  it("producto y depósito de emisores distintos son siempre un conflicto", () => {
    fc.assert(
      fc.property(regla, venta, linea, (r, v, l) => {
        const { emisorDelProducto: p, emisorDelDeposito: d } = l;
        if (p !== null && d !== null && p !== d) {
          expect(resolverEmisor(r, v, l)).toEqual({ ok: false, error: "EMISOR_EN_CONFLICTO" });
        }
      }),
    );
  });

  it("la elección manual solo cuenta si la regla la permite y no hay nada que la preceda", () => {
    fc.assert(
      fc.property(regla, venta, linea, (r, v, l) => {
        const resultado = resolverEmisor(r, v, l);
        if (resultado.ok && resultado.valor.motivo === "MANUAL") {
          expect(r.permitirEleccionManual).toBe(true);
          expect(l.emisorDelProducto ?? l.emisorDelDeposito).toBeNull();
          expect(v.puntoDeVentaElegido).toBeNull();
          expect(resultado.valor.emisorId).toBe(v.eleccionManual);
        }
      }),
    );
  });
});

// --- planificarComprobantes -------------------------------------------------------------------

const PV_1A: PuntoDeVentaDeSucursal = { id: puntoDeVentaId("pv-1a"), emisorId: EMISOR_1 };
const PV_1B: PuntoDeVentaDeSucursal = { id: puntoDeVentaId("pv-1b"), emisorId: EMISOR_1 };
const PV_2A: PuntoDeVentaDeSucursal = { id: puntoDeVentaId("pv-2a"), emisorId: EMISOR_2 };
const PV_3A: PuntoDeVentaDeSucursal = { id: puntoDeVentaId("pv-3a"), emisorId: EMISOR_3 };
const PUNTOS: readonly PuntoDeVentaDeSucursal[] = [PV_1A, PV_1B, PV_2A, PV_3A];
const habilitadosArb = fc.subarray([...PUNTOS]);
const lineasDeVenta = fc
  .array(fc.constantFrom(...emisores), { minLength: 0, maxLength: 12 })
  .chain((es) =>
    fc.shuffledSubarray(
      es.map((emisorId, i) => ({ posicion: i * 3 + 1, emisorId })),
      { minLength: es.length, maxLength: es.length },
    ),
  );

describe("planificarComprobantes: propiedades", () => {
  it("cada línea está en exactamente un plan, con el emisor del plan, y hay un plan por emisor", () => {
    fc.assert(
      fc.property(
        lineasDeVenta,
        habilitadosArb,
        fc.option(fc.constantFrom(...PUNTOS), { nil: null }),
        (ls, hab, elegido) => {
          const r = planificarComprobantes(ls, hab, elegido?.id ?? null);
          if (!r.ok) return;
          const planes = r.valor;
          const emisoresDeLasLineas = new Set(ls.map((l) => l.emisorId));
          expect(planes.length).toBe(emisoresDeLasLineas.size);
          expect(new Set(planes.map((p) => p.emisorId)).size).toBe(planes.length);
          for (const l of ls) {
            const que = planes.filter((p) => p.posiciones.includes(l.posicion));
            expect(que).toHaveLength(1);
            expect(que[0]?.emisorId).toBe(l.emisorId);
          }
          expect(planes.flatMap((p) => p.posiciones).length).toBe(ls.length);
        },
      ),
    );
  });

  it("el punto de venta de cada plan es uno habilitado y es del emisor del plan", () => {
    fc.assert(
      fc.property(lineasDeVenta, habilitadosArb, (ls, hab) => {
        const r = planificarComprobantes(ls, hab, null);
        if (!r.ok) return;
        for (const plan of r.valor) {
          const punto = hab.find((p) => p.id === plan.puntoDeVentaId);
          expect(punto).toBeDefined();
          expect(punto?.emisorId).toBe(plan.emisorId);
        }
      }),
    );
  });

  it("sin elegido, un error es exactamente que algún emisor tenga cero o varios habilitados", () => {
    fc.assert(
      fc.property(lineasDeVenta, habilitadosArb, (ls, hab) => {
        const r = planificarComprobantes(ls, hab, null);
        const cantidades = [...new Set(ls.map((l) => l.emisorId))].map(
          (e) => hab.filter((p) => p.emisorId === e).length,
        );
        expect(r.ok).toBe(cantidades.every((c) => c === 1));
      }),
    );
  });

  it("el resultado no depende del orden en que llegan las líneas y los planes salen por primera posición", () => {
    fc.assert(
      fc.property(lineasDeVenta, fc.integer(), (ls, semilla) => {
        const hab = [PV_1A, PV_2A, PV_3A];
        const otraVez = [...ls].sort(
          (a, b) => ((a.posicion * 17 + semilla) % 5) - ((b.posicion * 17 + semilla) % 5),
        );
        const a = planificarComprobantes(ls, hab, PV_1A.id);
        const b = planificarComprobantes(otraVez, hab, PV_1A.id);
        expect(b).toEqual(a);
        if (a.ok) {
          const primeras = a.valor.map((p) => p.posiciones[0] ?? -1);
          expect(primeras).toEqual([...primeras].sort((x, y) => x - y));
          for (const p of a.valor)
            expect(p.posiciones).toEqual([...p.posiciones].sort((x, y) => x - y));
        }
      }),
    );
  });
});

// --- dinero: venta mixta ----------------------------------------------------------------------

describe("venta mixta: propiedades de dinero", () => {
  const ventaConLineas = fc
    .array(fc.record({ emisorId: fc.constantFrom(...emisores), linea: lineaRazonable }), {
      minLength: 1,
      maxLength: 10,
    })
    .map((ls) => ls.map((l, i) => ({ posicion: i + 1, ...l })));
  const habilitados = [PV_1A, PV_2A, PV_3A];

  it("la suma de los totales por comprobante es el total de la venta, y el cobro repartido suma exacto", () => {
    fc.assert(
      fc.property(ventaConLineas, fc.bigInt({ min: 1n, max: 10n ** 12n }), (ls, centavos) => {
        const plan = planificarComprobantes(ls, habilitados, null);
        if (!plan.ok) throw new Error("plan inválido");
        const calculados = calcularComprobantesDeVenta(ARS, ls, plan.valor, POLITICA_VIGENTE);
        const totales = calculados.map((c) => c.calculado.total);
        const suma = totales.reduce(sumar, importeCero(ARS));
        expect(importesIguales(totalDeLaVenta(ARS, calculados), suma)).toBe(true);
        expect(calculados).toHaveLength(plan.valor.length);

        if (suma.unidades === 0n) return;
        const cobro = importeDesdeTexto(ARS, formatearDecimalFijo(centavos, 2));
        const partes = repartirCobro(cobro, totales);
        expect(importesIguales(partes.reduce(sumar, importeCero(ARS)), cobro)).toBe(true);
        expect(partes).toHaveLength(totales.length);
      }),
    );
  });
});

// --- numeración -------------------------------------------------------------------------------

type Evento =
  | { tipo: "RESERVAR"; solicitud: 1 | 2 }
  | { tipo: "CERRAR"; solicitud: 1 | 2; desenlace: DesenlaceDeAutorizacion }
  | { tipo: "RECONCILIAR"; informa: -1 | 0 | 1 | 2 | 3; vencida: boolean }
  /** `desfase`: cuánto se aleja el último de ARCA del que la serie tiene, hacia atrás o hacia adelante. */
  | { tipo: "RESINCRONIZAR"; desfase: -2 | -1 | 0 | 1 | 7; viejo: boolean };

const evento: fc.Arbitrary<Evento> = fc.oneof(
  fc.record({
    tipo: fc.constant("RESERVAR" as const),
    solicitud: fc.constantFrom(1 as const, 2 as const),
  }),
  fc.record({
    tipo: fc.constant("CERRAR" as const),
    solicitud: fc.constantFrom(1 as const, 2 as const),
    desenlace: fc.constantFrom<DesenlaceDeAutorizacion>(
      "AUTORIZADO",
      "RECHAZADO",
      "NO_ENVIADO",
      "INCIERTO",
    ),
  }),
  fc.record({
    tipo: fc.constant("RECONCILIAR" as const),
    informa: fc.constantFrom(-1 as const, 0 as const, 1 as const, 2 as const, 3 as const),
    vencida: fc.boolean(),
  }),
  fc.record({
    tipo: fc.constant("RESINCRONIZAR" as const),
    desfase: fc.constantFrom(-2 as const, -1 as const, 0 as const, 1 as const, 7 as const),
    viejo: fc.boolean(),
  }),
);

const solicitudes: Record<1 | 2, SolicitudId> = { 1: SOLICITUD_1, 2: SOLICITUD_2 };

describe("numeración: propiedades", () => {
  it("toda secuencia de eventos deja el último número igual a las autorizaciones desde la última resincronización, sin bajar, sin huecos y con cada paso válido", () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (eventos) => {
        const ahora = new Date(1_000_000);
        let serie: Serie = serieLibre(0n);
        // El tramo actual de la serie: arranca en el último número de la última resincronización (los
        // números de antes de ese salto los emitió otro sistema y no son huecos de ZuluHub).
        let desde = 0n;
        let numeros: bigint[] = [];
        for (const e of eventos) {
          const antes = serie;
          if (e.tipo === "RESERVAR") {
            const r = reservarNumero(serie, solicitudes[e.solicitud], ahora);
            if (r.ok && r.valor.tipo === "RESERVADA") serie = r.valor.serie;
          } else if (e.tipo === "CERRAR") {
            const r = cerrarSerie(serie, solicitudes[e.solicitud], e.desenlace);
            if (r.ok) {
              serie = r.valor.serie;
              if (r.valor.numeroAutorizado !== null) numeros.push(r.valor.numeroAutorizado);
            }
          } else if (e.tipo === "RECONCILIAR") {
            const base = antes.estado === "EN_CURSO" ? antes.ultimoNumero : 0n;
            const momento = e.vencida ? new Date(ahora.getTime() + 10 * 60_000) : ahora;
            const r = reconciliarSerie(serie, base + BigInt(e.informa), momento);
            if (r.ok) {
              serie = r.valor.serie;
              if (r.valor.resolucion === "CERRADA_COMO_AUTORIZADA") {
                numeros.push(r.valor.serie.ultimoNumero);
              }
            }
          } else {
            const deArca = antes.ultimoNumero + BigInt(e.desfase);
            const r = resincronizarSerie(antes, e.viejo ? deArca - 1n : deArca, deArca);
            // Solo sale una bloqueada, con el dato fresco, y nunca hacia atrás.
            expect(r.ok).toBe(antes.estado === "BLOQUEADA" && !e.viejo && e.desfase >= 0);
            if (r.ok) {
              serie = r.valor;
              expect(verificarSecuencia(desde, numeros).ok).toBe(true);
              desde = serie.ultimoNumero;
              numeros = [];
            }
          }
          expect(transicionDeSerieValida(antes, serie)).toBe(true);
          expect(serie.ultimoNumero >= antes.ultimoNumero).toBe(true);
          // El último número es exactamente el del tramo más sus autorizaciones (bloquear no avanza).
          expect(serie.ultimoNumero).toBe(desde + BigInt(numeros.length));
        }
        expect(verificarSecuencia(desde, numeros).ok).toBe(true);
      }),
    );
  });
});
