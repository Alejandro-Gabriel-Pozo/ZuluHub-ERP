import fc from "fast-check";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import "../propiedades/configuracion";
import { ganchoDeSucursalDeCaja } from "../../src/modulos/caja/publico";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { armarCaja, armarEmpresasConGanchos, crearEntornoDeCaja } from "./caja-configuracion-apoyo";
import {
  CERO,
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  fechaLocal,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * El arqueo exacto al centavo (e3 §5.1 #4) y el corte de día (§5.1 #5) a través de los casos de uso, con una base real:
 *  - propiedades: con movimientos al azar con centavos, la suma en TypeScript (`bigint`), la suma en SQL (`numeric`) y el esperado de cada
 *    línea del cierre son EXACTAMENTE lo mismo; el efectivo contado con todas las denominaciones y monedas con centavos da la diferencia
 *    exacta; anular neutraliza (el esperado vuelve al que tenía); nunca `number`;
 *  - corte de día: la jornada la sella la apertura (zona de la empresa y hora de corte de la sucursal) y todo lo que entra después en esa
 *    sesión cae en ella aunque el corte cambie o el reloj pase la medianoche; los bordes exactos; cambiar el corte no toca lo existente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Fila = Record<string, unknown>;
const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100] as const;

/** Texto decimal canónico de unos centavos, escrito a mano (el oráculo no usa la primitiva de importes). */
function textoDe(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos).toString().padStart(3, "0");
  return `${negativo ? "-" : ""}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}

describe.skipIf(base === null)("arqueo exacto y corte de día", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const casos = () => caja.casos;
  const consultas = () => caja.consultas;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const en = (dias: number, minutos = 0, hora = "10:00") =>
    new Date(instanteLocal(dias, hora).getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeOperacion, dias = 1, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), en(dias, minutos, hora));

  // =============================================================================================
  describe("el arqueo es exacto al centavo (propiedades)", () => {
    it("Σ en TypeScript (bigint) = Σ en SQL (numeric) = esperado del cierre; efectivo contado con billetes y monedas con centavos; diferencia exacta", async () => {
      type Medio = "efectivo" | "debito" | "qr";
      const cantidad = fc.integer({ min: 0, max: 30 });
      const monto = fc.bigInt({ min: 1n, max: 999_999n });
      const operacion = fc.oneof(
        fc.record({ tipo: fc.constant("ingreso" as const), centavos: monto }),
        fc.record({ tipo: fc.constant("egreso" as const), centavos: monto }),
        fc.record({
          tipo: fc.constant("ajuste" as const),
          medio: fc.constantFrom<Medio>("efectivo", "debito", "qr"),
          centavos: fc.bigInt({ min: -999_999n, max: 999_999n }).filter((c) => c !== 0n),
        }),
      );
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: 99_999_999n }),
          fc.array(operacion, { maxLength: 10 }),
          fc.array(cantidad, { minLength: 7, maxLength: 7 }),
          fc.bigInt({ min: 0n, max: 99_999n }),
          fc.bigInt({ min: 0n, max: 999_999n }),
          fc.boolean(),
          async (fondo, operaciones, cantidades, monedas, declaradoDeMas, conforme) => {
            // Un mundo por corrida: si una falla, las que siguen (el encogimiento) no heredan una sesión abierta.
            const m = await crearMundoDeOperacion(entornoBase, dueno, caja);
            const debito = await casos().crearMedioDePago(m.ctx(), {
              tipo: "TARJETA_DEBITO",
              nombre: "Débito",
            });
            const qr = await casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre: "QR" });
            if (!debito.ok || !qr.ok) throw new Error("no se crearon los medios");
            const efectivoId = (
              await filas<{ id: string }>(
                "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
                [m.empresa],
              )
            )[0]?.id as string;
            const medios: Record<Medio, string> = {
              efectivo: efectivoId,
              debito: debito.valor.medioDePagoId,
              qr: qr.valor.medioDePagoId,
            };
            const abierta = await casos().abrirSesion(ctxEn(m, 1, 0), {
              claveDeIdempotencia: claveNueva(),
              sucursalId: m.sucursal,
              cajaId: m.cajaId,
              fondoInicial: pesos(textoDe(fondo)),
            });
            if (!abierta.ok) throw new Error(`no abrió: ${JSON.stringify(abierta.error)}`);
            const sesion = abierta.valor.sesionId;

            // El oráculo: lo que cada línea tiene que sumar, calculado a mano con bigint.
            const esperado: Record<Medio, bigint> = { efectivo: fondo, debito: 0n, qr: 0n };
            const usados = new Set<Medio>(["efectivo"]);
            const anulables: { id: string; medio: Medio; centavos: bigint }[] = [];
            for (const op of operaciones) {
              let id: string;
              let medio: Medio;
              let centavos: bigint;
              if (op.tipo === "ajuste") {
                medio = op.medio;
                centavos = op.centavos;
                const r = await casos().registrarAjuste(ctxEn(m, 1, 1), {
                  claveDeIdempotencia: claveNueva(),
                  sesionId: sesion,
                  medioDePagoId: medios[medio],
                  cuentaDeCobroId: null,
                  importe: pesos(textoDe(centavos)),
                  motivo: "Ajuste de prueba",
                  corrigeJornada: null,
                });
                if (!r.ok) throw new Error(`no ajustó: ${JSON.stringify(r.error)}`);
                id = r.valor.movimientoId;
              } else {
                medio = "efectivo";
                centavos = op.tipo === "ingreso" ? op.centavos : -op.centavos;
                const r = await casos().registrarMovimientoManual(ctxEn(m, 1, 1), {
                  claveDeIdempotencia: claveNueva(),
                  sesionId: sesion,
                  sentido: op.tipo === "ingreso" ? "INGRESO" : "EGRESO",
                  importe: pesos(textoDe(op.centavos)),
                  motivo: "Movimiento de prueba",
                });
                if (!r.ok) throw new Error(`no registró: ${JSON.stringify(r.error)}`);
                id = r.valor.movimientoId;
              }
              usados.add(medio);
              esperado[medio] += centavos;
              anulables.push({ id, medio, centavos });
            }

            // Anular neutraliza: se anula uno de cada dos y el esperado vuelve a lo que sumaban los que quedan.
            for (const [i, a] of anulables.entries()) {
              if (i % 2 !== 0) continue;
              const r = await casos().anularMovimientoDeCaja(ctxEn(m, 1, 2), {
                claveDeIdempotencia: claveNueva(),
                movimientoId: a.id,
                motivo: "Se anula",
              });
              if (!r.ok) throw new Error(`no anuló: ${JSON.stringify(r.error)}`);
              esperado[a.medio] -= a.centavos;
            }

            // Σ en SQL (numeric), por medio: lo mismo que el oráculo en bigint, sin redondeos.
            const enSql = await filas<{ medio: string; suma: string }>(
              "select medio_de_pago_id as medio, sum(importe)::text as suma from movimiento_caja where sesion_id = $1 group by 1",
              [sesion],
            );
            const deSql = Object.fromEntries(enSql.map((f) => [f.medio, f.suma]));
            for (const nombre of usados) {
              expect(deSql[medios[nombre]], nombre).toBe(textoDe(esperado[nombre]));
            }

            // El efectivo se cuenta con billetes (todas las denominaciones) y monedas con centavos.
            const billetes = DENOMINACIONES.map((denominacion, i) => ({
              denominacion,
              cantidad: cantidades[i] ?? 0,
            }));
            const enBilletes = billetes.reduce(
              (suma, b) => suma + BigInt(b.denominacion) * BigInt(b.cantidad) * 100n,
              0n,
            );
            const contadoEfectivo = enBilletes + monedas;
            // Un medio que no es efectivo se declara con un desvío exacto (o se acepta con el conforme).
            const otros = (["debito", "qr"] as const)
              .filter((nombre) => usados.has(nombre))
              .map((nombre) => ({ nombre, declarado: esperado[nombre] + declaradoDeMas }))
              // Un total declarado no puede ser negativo (`contado >= 0`): con un esperado negativo se acepta lo registrado.
              .filter((o) => o.declarado >= 0n);
            const conformeGeneral =
              conforme || otros.length < [...usados].filter((n) => n !== "efectivo").length;
            const cierre = await casos().cerrarSesion(ctxEn(m, 1, 3), {
              sesionId: sesion,
              conteo: { billetes, monedas: pesos(textoDe(monedas)) },
              otros: otros.map((o) => ({
                medioDePagoId: medios[o.nombre],
                cuentaDeCobroId: null,
                contado: pesos(textoDe(o.declarado)),
              })),
              conformeGeneral,
              observacion: null,
            });
            if (!cierre.ok) throw new Error(`no cerró: ${JSON.stringify(cierre.error)}`);

            const lineas = Object.fromEntries(cierre.valor.arqueo.map((l) => [l.medioDePagoId, l]));
            const delEfectivo = lineas[medios.efectivo];
            expect(delEfectivo?.esperado.monto).toBe(textoDe(esperado.efectivo));
            expect(delEfectivo?.contado?.monto).toBe(textoDe(contadoEfectivo));
            expect(delEfectivo?.contadoMonedas?.monto).toBe(textoDe(monedas));
            expect(delEfectivo?.diferencia?.monto).toBe(
              textoDe(contadoEfectivo - esperado.efectivo),
            );
            for (const nombre of usados) {
              if (nombre === "efectivo") continue;
              const linea = lineas[medios[nombre]];
              expect(linea?.esperado.monto, nombre).toBe(textoDe(esperado[nombre]));
              const declarada = otros.find((o) => o.nombre === nombre);
              if (declarada === undefined) {
                expect(linea).toMatchObject({ conforme: true, contado: null, diferencia: null });
              } else {
                expect(linea?.contado?.monto).toBe(textoDe(declarada.declarado));
                expect(linea?.diferencia?.monto).toBe(textoDe(declaradoDeMas));
              }
            }
            // Lo guardado es lo calculado: la base recalculó al confirmar y la diferencia la genera ella, igual.
            const guardadas = await filas<{
              medio_de_pago_id: string;
              esperado: string;
              contado: string | null;
              diferencia: string | null;
            }>(
              "select medio_de_pago_id, esperado::text, contado::text, diferencia::text from arqueo_caja where sesion_id = $1",
              [sesion],
            );
            expect(guardadas).toHaveLength(usados.size);
            for (const g of guardadas) {
              const linea = lineas[g.medio_de_pago_id];
              expect(g.esperado).toBe(linea?.esperado.monto);
              expect(g.contado).toBe(linea?.contado?.monto ?? null);
              expect(g.diferencia).toBe(linea?.diferencia?.monto ?? null);
            }
            // Σ de las líneas = Σ de todos los movimientos de la sesión (nada quedó fuera del arqueo).
            const total = (
              await filas<{ t: string }>(
                "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1",
                [sesion],
              )
            )[0]?.t;
            const sumaDeLineas = cierre.valor.arqueo.reduce(
              (suma, l) => suma + BigInt(l.esperado.monto.replace(".", "")),
              0n,
            );
            expect(total).toBe(textoDe(sumaDeLineas));
            expect(sumaDeLineas).toBe(esperado.efectivo + esperado.debito + esperado.qr);
          },
        ),
        { numRuns: 25 },
      );
    });

    it("jamás number: el 0.1 + 0.2 de la coma flotante no existe, y un total de miles de millones queda exacto", async () => {
      const m = await crearMundoDeOperacion(entornoBase, dueno, caja);
      const abierta = await casos().abrirSesion(ctxEn(m), {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal,
        cajaId: m.cajaId,
        fondoInicial: pesos("0.10"),
      });
      if (!abierta.ok) throw new Error("no abrió");
      const sesion = abierta.valor.sesionId;
      for (const monto of ["0.20", "999999999.99", "0.01"]) {
        const r = await casos().registrarMovimientoManual(ctxEn(m, 1, 5), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos(monto),
          motivo: "Prueba",
        });
        expect(r.ok).toBe(true);
      }
      const resumen = await consultas().resumenDeSesion(ctxEn(m, 1, 10), { sesionId: sesion });
      // 0.10 + 0.20 + 999999999.99 + 0.01 = 1000000000.30, sin 0.30000000000000004 ni pérdida de centavos.
      expect(resumen.ok && resumen.valor.lineas.map((l) => l.esperado.monto)).toEqual([
        "1000000000.30",
      ]);
      const cierre = await casos().cerrarSesion(ctxEn(m, 1, 20), {
        sesionId: sesion,
        conteo: { billetes: [{ denominacion: 20000, cantidad: 50_000 }], monedas: pesos("0.30") },
        otros: [],
        conformeGeneral: true,
        observacion: null,
      });
      expect(cierre.ok && cierre.valor.arqueo[0]).toMatchObject({
        esperado: pesos("1000000000.30"),
        contado: pesos("1000000000.30"),
        diferencia: pesos("0.00"),
      });
    });
  });

  // =============================================================================================
  describe("el corte de día respeta la hora de corte (UTC-3; e3 §3.4 y §5.1 #5)", () => {
    const cambiarElCorte = async (m: MundoDeOperacion, horaDeCorte: string) => {
      const [sucursal] = await filas<{ version: number; nombre: string }>(
        "select version, nombre from sucursal where id = $1",
        [m.sucursal],
      );
      const empresas = armarEmpresasConGanchos(entorno, [ganchoDeSucursalDeCaja]);
      const r = await empresas.editarSucursal(m.ctx(), {
        sucursalId: m.sucursal,
        versionEsperada: sucursal?.version as number,
        nombre: sucursal?.nombre as string,
        horaDeCorte,
      });
      if (!r.ok) throw new Error(`no se cambió el corte: ${JSON.stringify(r.error)}`);
    };
    const abrir = async (m: MundoDeOperacion, ahora: Date, cajaId = m.cajaId) => {
      const r = await casos().abrirSesion(conAhora(m.ctx(), ahora), {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal,
        cajaId,
        fondoInicial: pesos("100.00"),
      });
      if (!r.ok) throw new Error(`no abrió: ${JSON.stringify(r.error)}`);
      return r.valor;
    };
    const sello = async (sesionId: string) =>
      (
        await filas<{ fecha: string; corte: string; zona: string }>(
          "select fecha_negocio::text as fecha, to_char(hora_de_corte, 'HH24:MI') as corte, zona_horaria as zona from sesion_caja where id = $1",
          [sesionId],
        )
      )[0];

    it("sesión abierta con corte 00:00, el corte pasa a 06:00 y se cobra a la 01:30: todo cae en el sello de la apertura (la jornada del día que abrió)", async () => {
      const m = await crearMundoDeOperacion(entornoBase, dueno, caja);
      const apertura = en(2, 0, "19:00");
      const { sesionId, fechaDeNegocio } = await abrir(m, apertura);
      expect(fechaDeNegocio).toBe(fechaLocal(apertura));
      expect(await sello(sesionId)).toEqual({
        fecha: fechaLocal(apertura),
        corte: "00:00",
        zona: "America/Argentina/Buenos_Aires",
      });
      await cambiarElCorte(m, "06:00");
      // 01:30 del día siguiente: con el corte nuevo sería la jornada anterior, con el viejo ya es la de mañana. Da igual: es de la sesión.
      const aLaUnaYMedia = en(3, 0, "01:30");
      const r = await casos().registrarMovimientoManual(conAhora(m.ctx(), aLaUnaYMedia), {
        claveDeIdempotencia: claveNueva(),
        sesionId,
        sentido: "INGRESO",
        importe: pesos("50.00"),
        motivo: "Venta de madrugada",
      });
      expect(r.ok).toBe(true);
      // El sello no cambió, y el movimiento hereda la jornada de su sesión.
      expect(await sello(sesionId)).toEqual({
        fecha: fechaLocal(apertura),
        corte: "00:00",
        zona: "America/Argentina/Buenos_Aires",
      });
      const ficha = await consultas().fichaDeSesion(conAhora(m.ctx(), aLaUnaYMedia), { sesionId });
      expect(ficha.ok && ficha.valor.sesion.fechaDeNegocio).toBe(fechaLocal(apertura));
      expect(ficha.ok && ficha.valor.horaDeCorte).toBe("00:00");
      // El reloj de la sesión vencida no la cierra ni la refecha: sigue abierta en su jornada.
      expect(ficha.ok && ficha.valor.sesion.estado).toBe("ABIERTA");
      // Las sesiones que se abran DESPUÉS ya llevan el corte nuevo: 05:30 con corte 06:00 es la jornada anterior.
      await casos().cerrarSesion(conAhora(m.ctx(), en(3, 10, "01:30")), {
        sesionId,
        conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: pesos("50.00") },
        otros: [],
        conformeGeneral: true,
        observacion: null,
      });
      const nueva = await abrir(m, en(3, 0, "05:30"));
      expect(await sello(nueva.sesionId)).toEqual({
        fecha: fechaLocal(apertura),
        corte: "06:00",
        zona: "America/Argentina/Buenos_Aires",
      });
    });

    it("y al revés: sesión abierta con corte 06:00 a las 05:30 (jornada anterior), el corte pasa a 00:00 y lo que entra después sigue en la jornada anterior", async () => {
      const m = await crearMundoDeOperacion(entornoBase, dueno, caja);
      await cambiarElCorte(m, "06:00");
      const apertura = en(2, 0, "05:30");
      const { sesionId, fechaDeNegocio } = await abrir(m, apertura);
      const ayer = fechaLocal(en(1, 0, "12:00"));
      expect(fechaDeNegocio).toBe(ayer);
      await cambiarElCorte(m, "00:00");
      const r = await casos().registrarMovimientoManual(conAhora(m.ctx(), en(2, 0, "08:00")), {
        claveDeIdempotencia: claveNueva(),
        sesionId,
        sentido: "INGRESO",
        importe: pesos("10.00"),
        motivo: "Cambio",
      });
      expect(r.ok).toBe(true);
      expect(await sello(sesionId)).toEqual({
        fecha: ayer,
        corte: "06:00",
        zona: "America/Argentina/Buenos_Aires",
      });
    });

    it("bordes exactos con corte 06:00: 05:59:59.999 es la jornada anterior y 06:00:00.000 la nueva", async () => {
      const m = await crearMundoDeOperacion(entornoBase, dueno, caja, { limiteDeCajas: 2 });
      const otra = await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 2" });
      if (!otra.ok) throw new Error("no se creó la caja 2");
      await cambiarElCorte(m, "06:00");
      const seisEnPunto = en(2, 0, "06:00");
      const antes = await abrir(m, new Date(seisEnPunto.getTime() - 1));
      const justo = await abrir(m, seisEnPunto, otra.valor.cajaId);
      expect(antes.fechaDeNegocio).toBe(fechaLocal(en(1, 0, "12:00")));
      expect(justo.fechaDeNegocio).toBe(fechaLocal(seisEnPunto));
      expect(antes.fechaDeNegocio).not.toBe(justo.fechaDeNegocio);
      // Y la base lo confirmó con su propia fórmula (el disparador del sello la verifica en el alta).
      expect((await sello(antes.sesionId))?.fecha).toBe(antes.fechaDeNegocio);
      expect((await sello(justo.sesionId))?.fecha).toBe(justo.fechaDeNegocio);
    });

    it("cambiar el corte no toca las sesiones que ya existen (sello inmutable), también cerradas", async () => {
      const m = await crearMundoDeOperacion(entornoBase, dueno, caja);
      const { sesionId } = await abrir(m, en(2, 0, "03:00"));
      await casos().cerrarSesion(conAhora(m.ctx(), en(2, 30, "03:00")), {
        sesionId,
        conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: CERO },
        otros: [],
        conformeGeneral: true,
        observacion: null,
      });
      const antes = await filas("select * from sesion_caja where id = $1", [sesionId]);
      for (const corte of ["06:00", "23:59", "00:00"]) await cambiarElCorte(m, corte);
      expect(await filas("select * from sesion_caja where id = $1", [sesionId])).toEqual(antes);
      // La consulta por fecha de negocio sigue encontrándola en SU jornada, con el corte que tenía.
      const dia = fechaLocal(en(2, 0, "03:00"));
      const lista = await consultas().listarSesiones(conAhora(m.ctx(), en(3)), {
        sucursalId: m.sucursal,
        desde: dia,
        hasta: dia,
      });
      expect(lista.ok && lista.valor.map((s) => s.id)).toEqual([sesionId]);
    });

    it("la jornada de una sesión que sigue abierta al día siguiente es la suya: sigue sumando movimientos en ella", async () => {
      const m = await crearMundoDeOperacion(entornoBase, dueno, caja);
      const apertura = en(2, 0, "22:00");
      const { sesionId } = await abrir(m, apertura);
      for (const [dias, hora] of [
        [3, "00:30"],
        [3, "09:00"],
        [3, "23:59"],
      ] as const) {
        const r = await casos().registrarMovimientoManual(conAhora(m.ctx(), en(dias, 0, hora)), {
          claveDeIdempotencia: claveNueva(),
          sesionId,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        });
        expect(r.ok, `${dias} ${hora}`).toBe(true);
      }
      const resumen = await consultas().resumenDeSesion(conAhora(m.ctx(), en(4)), { sesionId });
      expect(resumen.ok && resumen.valor.sesion.fechaDeNegocio).toBe(fechaLocal(apertura));
      expect(resumen.ok && resumen.valor.lineas[0]?.esperado).toEqual(pesos("103.00"));
    });
  });
});
