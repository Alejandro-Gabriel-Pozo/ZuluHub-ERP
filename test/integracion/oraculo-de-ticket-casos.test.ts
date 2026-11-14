import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearCasosDeUsoDeCierre,
  huellaDeControles,
  type AporteAlCierreDelDia,
} from "../../src/modulos/cierre/publico";
import { ORACULO_DE_COMPROBANTE } from "../../src/modulos/fiscal/dominio/oraculo-de-comprobante";
import { ORACULO_DE_VENTAS } from "../../src/modulos/ventas/dominio/oraculo-de-ticket";
import {
  celdasEjecutables,
  celdasPendientes,
  etiquetaDePendiente,
  type CeldaDeOraculo,
} from "../../src/primitivas/oraculo/celdas";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { TxDePrueba } from "./entorno";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  REGLAS_DE_PRUEBA,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura,
  receptorConsumidorFinal,
  ticketCobrado,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * EL ORÁCULO CONTRA EL CÓDIGO REAL: cada celda del oráculo de ventas y de fiscal que HOY coincide con el código se ejecuta con los casos de
 * uso reales (ventas, caja, cierre, fiscal con ARCA falsa) y, en las celdas que impone la base, con SQL directo del dueño (los disparadores
 * valen también para él). El resultado (permitido o no, y el código de error) se compara con la celda: si el oráculo permite y el código
 * rechaza, o al revés, FALLA (hallazgo de auditoría, no error del oráculo). Las celdas que esperan su tramo no se ejecutan: figuran como
 * `PENDIENTE (tramo X)` con su id. Las pocas celdas que otra prueba ya ejecuta contra el código real se citan en `CUBIERTAS_POR_OTRA_PRUEBA`
 * (y esta prueba comprueba que ese archivo y ese título existen). Fuente: `Pedernal-docs/11-especificaciones/auditoria-de-reglas/oraculo-ticket-cobranza.md`.
 * La concurrencia de las celdas D está en `oraculo-de-ticket-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Cualquiera = Resultado<unknown, unknown>;
type Observado = Readonly<{ permitido: boolean; codigos: readonly string[] }>;

/** El código de un resultado: el error si es texto, o su `error`, `codigo` o `tipo`. Un `ok` no tiene código. */
function codigoDe(r: Cualquiera): string | null {
  if (r.ok) return null;
  const x = r.error;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x !== null) {
    for (const clave of ["error", "codigo", "tipo"] as const) {
      const v = (x as Record<string, unknown>)[clave];
      if (typeof v === "string") return v;
    }
  }
  return "otro";
}

const rechazo = (...resultados: Cualquiera[]): Observado => ({
  permitido: false,
  codigos: resultados.map((r) => codigoDe(r) ?? "ok"),
});
const permitido = (...resultados: Cualquiera[]): Observado => ({
  permitido: resultados.every((r) => r.ok),
  codigos: resultados.map(codigoDe).filter((c): c is string => c !== null),
});

/** Las celdas que ya ejecuta otra prueba contra el código real: archivo y título (se comprueba que existen). */
const CUBIERTAS_POR_OTRA_PRUEBA: Readonly<
  Record<string, Readonly<{ archivo: string; titulo: string }>>
> = {
  "B-15": {
    archivo: "test/integracion/facturacion-factura-de-origen.test.ts",
    titulo: "un total esperado un centavo menor que el calculado",
  },
  "C-04": {
    archivo: "src/modulos/fiscal/dominio/oraculo-de-comprobante.test.ts",
    titulo: "C-04: otra empresa, otro emisor u otro ambiente",
  },
  "C-09": {
    archivo: "test/integracion/facturacion-estados.test.ts",
    titulo: "AUTORIZADO, RECHAZADO y DESCARTADO no salen",
  },
  "C-10": {
    archivo: "test/integracion/facturacion-sql.test.ts",
    titulo: "el mismo origen, emisor y clase no se repite mientras el comprobante esté vigente",
  },
};

const RAIZ = join(import.meta.dirname, "../..");

describe.skipIf(base === null)(
  "oráculo de ticket, cobranza, factura y nota de crédito: casos de uso reales",
  () => {
    let m: MundoDeVentas;
    let fiscal: ReturnType<typeof crearFiscalDePrueba>;
    let e: EscenarioDeFacturacionDeTickets;
    let caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base, { facturacion: true, conexiones: 16 });
      fiscal = crearFiscalDePrueba(m);
      e = await escenarioFacturable(m);
      caja = await m.cajaAbierta(e);
    });
    afterAll(async () => {
      if (base === null) return;
      await fiscal.cerrar();
      await m.cerrar();
    });

    const monto = (v: string) => ({ moneda: "ARS", monto: v });

    /** Una cuenta con una línea del producto de $1000 (o del producto dado). */
    const cuentaAbierta = async (
      escenario: EscenarioDeVentas = e,
      producto: string = escenario.producto,
      confirmaciones: string[] = [],
    ) => {
      const cuenta = nuevoId();
      valorDe(
        await m.casos.abrirCuenta(escenario.gerente, {
          cuentaId: cuenta,
          sucursalId: escenario.sucursal,
        }),
      );
      valorDe(
        await m.casos.agregarLinea(escenario.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: producto,
          opcionIds: [],
          cantidad: "1",
          confirmaciones,
        }),
      );
      return cuenta;
    };
    const cerrar = (cuenta: string, ejemplarId = nuevoId(), confirmaciones: string[] = []) =>
      m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId, confirmaciones });

    /** Un ticket EMITIDO (cerrado sin cobrar) del producto de $1000. */
    const ticketEmitido = async () => valorDe(await cerrar(await cuentaAbierta()));
    /** Un ticket CORTESIA (total 0, confirmado). */
    const ticketCortesia = async () => {
      const gratis = await m.productoVendible(e.empresa, "0");
      return valorDe(
        await cerrar(await cuentaAbierta(e, gratis, ["VENTA_A_CERO"]), nuevoId(), ["VENTA_A_CERO"]),
      );
    };

    const entradaDeCobrar = (
      t: Readonly<{ ticketId: string; ejemplarId: string }>,
      importe: string,
      medio = "EFECTIVO",
      claveIdempotencia = nuevaClave(),
      cajaDeCobro = caja,
    ) => ({
      claveIdempotencia,
      ticketId: t.ticketId,
      ejemplarId: t.ejemplarId,
      cajaId: cajaDeCobro.cajaId,
      cobros: [
        {
          medioDePagoId: cajaDeCobro.medios[medio] as string,
          cuentaDeCobroId: null,
          importe: monto(importe),
        },
      ],
    });
    const cobrar = (t: Readonly<{ ticketId: string; ejemplarId: string }>, importe = "1000.00") =>
      m.casos.cobrar(e.gerente, entradaDeCobrar(t, importe));
    /** Un ticket COBRADO por el camino del salón (cerrar, después cobrar). */
    const ticketPagado = async () => {
      const t = await ticketEmitido();
      valorDe(await cobrar(t));
      return t;
    };

    const anular = (
      t: Readonly<{ ticketId: string; ejemplarId: string }>,
      extra: { claveIdempotencia?: string; ejemplarNuevoId?: string } = {},
    ) =>
      m.casos.anularTicket(e.gerente, {
        claveIdempotencia: extra.claveIdempotencia ?? nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: extra.ejemplarNuevoId ?? nuevoId(),
        motivo: "Error del cajero",
      });

    const facturar = (ticketId: string, clave = nuevaClaveDeFactura(), de = e) =>
      m.casos.emitirComprobanteDeTicket(
        { ...de.gerente, ahora: fiscal.reloj.ahora() },
        { ticketId, receptor: receptorConsumidorFinal(), puntoDeVentaId: de.pv, clave },
      );
    /** Un ticket COBRADO por `venderYCobrar` (el mostrador) listo para facturar. */
    const ticketParaFacturar = async () => {
      fiscal.adelantar();
      return await ticketCobrado(m, e, caja);
    };
    const estadoDe = async (ticketId: string) =>
      (await m.filas<{ estado: string }>("select estado from ticket where id = $1", [ticketId]))[0]
        ?.estado;
    const comprobantes = (empresa = e.empresa) =>
      m.contar("select count(*) as n from comprobante where empresa_id = $1", [empresa]);

    /** SQL directo del dueño: lo que hace la base, aun para quien es dueño de las tablas. Devuelve la restricción que saltó, o `null`. */
    const sqlDelDueno = async (texto: string, parametros: unknown[]): Promise<string | null> => {
      try {
        await m.dueno.query(texto, parametros);
        return null;
      } catch (error) {
        return (error as { constraint?: string }).constraint ?? "sin restriccion";
      }
    };
    /** Insertar un documento de ticket con un comprobante inexistente: si la base rechaza por el ESTADO del ticket o por el ejemplar, lo dice el disparador de alta. */
    const insertarDocumento = (ticketId: string, ejemplarId: string) =>
      sqlDelDueno(
        `insert into documento_de_ticket (id, empresa_id, ticket_id, ejemplar_id, comprobante_id, intento, vigente, clave, creado_por, creado_en)
       values ($1, $2, $3, $4, $5, 1, true, $6, $7, now())`,
        [nuevoId(), e.empresa, ticketId, ejemplarId, nuevoId(), nuevoId(), e.gerente.personaId],
      );

    /** Cada celda ejecutable → lo que el código real hace hoy. */
    const EJECUTORES: Readonly<Record<string, () => Promise<Observado>>> = {
      // ---- A: el ticket ----------------------------------------------------------------------------------------------------------
      "A-01": async () => {
        const r = await cerrar(await cuentaAbierta());
        const ok = valorDe(r);
        expect(ok.estado).toBe("EMITIDO");
        expect(await estadoDe(ok.ticketId)).toBe("EMITIDO");
        return permitido(r);
      },
      "A-02": async () => {
        const cuenta = nuevoId();
        valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
        return rechazo(await cerrar(cuenta));
      },
      "A-03": async () => {
        const cuenta = await cuentaAbierta();
        valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: cuenta, motivo: "Se fue" }));
        return rechazo(await cerrar(cuenta));
      },
      "A-04": async () => {
        const cuenta = await cuentaAbierta();
        const ejemplar = nuevoId();
        const primera = await cerrar(cuenta, ejemplar);
        const segunda = await cerrar(cuenta, ejemplar);
        expect(valorDe(primera).yaEstabaCerrada).toBe(false);
        expect(valorDe(segunda).yaEstabaCerrada).toBe(true);
        expect(valorDe(segunda).ticketId).toBe(valorDe(primera).ticketId);
        expect(
          await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
        ).toBe(1);
        return permitido(primera, segunda);
      },
      "A-07": async () => {
        const t = await ticketEmitido();
        const r = await cobrar(t, "500.00");
        expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
        return rechazo(r);
      },
      "A-08": async () => {
        const t = await ticketPagado();
        return rechazo(await cobrar(t));
      },
      "A-09": async () => {
        const t = await ticketCortesia();
        expect(t.estado).toBe("CORTESIA");
        return rechazo(await cobrar(t));
      },
      "A-10": async () => {
        const t = await ticketEmitido();
        valorDe(await anular(t));
        return rechazo(await cobrar(t));
      },
      "A-11": async () => {
        const t = await ticketEmitido();
        const r = await cobrar({ ticketId: t.ticketId, ejemplarId: nuevoId() });
        expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
        return rechazo(r);
      },
      "A-12": async () => {
        // Una caja sin sesión (SIN_SESION_ABIERTA) y, con otra, la sesión que empezó a contarse (CAJA_EN_CIERRE).
        const t = await ticketEmitido();
        const { rows } = await m.dueno.query<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin sesión') returning id",
          [e.empresa, e.sucursal],
        );
        const sinSesion = await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(t, "1000.00", "EFECTIVO", nuevaClave(), {
            ...caja,
            cajaId: rows[0]?.id as string,
          }),
        );
        const otro = await escenarioFacturable(m);
        const cajaEnCierre = await m.cajaAbierta(otro);
        valorDe(await m.caja.iniciarCierre(otro.gerente, { sesionId: cajaEnCierre.sesionId }));
        const cuenta = nuevoId();
        valorDe(
          await m.casos.abrirCuenta(otro.gerente, { cuentaId: cuenta, sucursalId: otro.sucursal }),
        );
        valorDe(
          await m.casos.agregarLinea(otro.gerente, {
            cuentaId: cuenta,
            lineaId: nuevoId(),
            productoId: otro.producto,
            opcionIds: [],
            cantidad: "1",
          }),
        );
        const t2 = valorDe(
          await m.casos.cerrarCuenta(otro.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
        );
        const enCierre = await m.casos.cobrar(
          otro.gerente,
          entradaDeCobrar(t2, "1000.00", "EFECTIVO", nuevaClave(), cajaEnCierre),
        );
        expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
        return rechazo(sinSesion, enCierre);
      },
      "A-13": async () => {
        const emitido = await ticketEmitido();
        const cobrado = await ticketPagado();
        const cortesia = await ticketCortesia();
        const resultados = [await anular(emitido), await anular(cobrado), await anular(cortesia)];
        expect(await estadoDe(emitido.ticketId)).toBe("ANULADO");
        expect(await estadoDe(cobrado.ticketId)).toBe("ANULADO");
        expect(await estadoDe(cortesia.ticketId)).toBe("ANULADO");
        return permitido(...resultados);
      },
      "A-15": async () => {
        const t = await ticketEmitido();
        valorDe(await anular(t));
        return rechazo(await anular(t));
      },
      "A-16": async () => {
        const otro = await m.escenario();
        const cuenta = nuevoId();
        valorDe(
          await m.casos.abrirCuenta(otro.gerente, { cuentaId: cuenta, sucursalId: otro.sucursal }),
        );
        valorDe(
          await m.casos.agregarLinea(otro.gerente, {
            cuentaId: cuenta,
            lineaId: nuevoId(),
            productoId: otro.producto,
            opcionIds: [],
            cantidad: "1",
          }),
        );
        const t = valorDe(
          await m.casos.cerrarCuenta(otro.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
        );
        const sinAportes: readonly AporteAlCierreDelDia<TxDePrueba>[] = [];
        const cierre = crearCasosDeUsoDeCierre({
          transacciones: m.entorno,
          reglas: REGLAS_DE_PRUEBA,
          aportes: sinAportes,
        });
        const jornada = { sucursalId: otro.sucursal, fechaDeNegocio: "2026-11-09" };
        valorDe(await cierre.iniciarAuditoria(otro.gerente, jornada));
        valorDe(
          await cierre.cerrarJornada(otro.gerente, {
            ...jornada,
            huellaVista: huellaDeControles([]),
            reconocimientos: [],
            observacion: null,
          }),
        );
        const r = await m.casos.anularTicket(otro.gerente, {
          claveIdempotencia: nuevaClave(),
          ticketId: t.ticketId,
          ejemplarBaseId: t.ejemplarId,
          ejemplarNuevoId: nuevoId(),
          motivo: "Error",
        });
        expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
        return rechazo(r);
      },
      "A-20": async () => {
        const t = await ticketEmitido();
        valorDe(await anular(t));
        const restriccion = await sqlDelDueno(
          "update ticket set ejemplar_vigente = ejemplar_vigente + 1 where id = $1",
          [t.ticketId],
        );
        expect(restriccion).toBe("ticket_transicion_invalida");
        return { permitido: restriccion === null, codigos: [] };
      },
      // ---- B: facturar -----------------------------------------------------------------------------------------------------------
      "B-01": async () => {
        const t = await ticketParaFacturar();
        const r = await facturar(t.ticketId);
        expect(valorDe(r).yaExistia).toBe(false);
        return permitido(r);
      },
      "B-03": async () => {
        const t = await ticketEmitido();
        const antes = await comprobantes();
        const r = await facturar(t.ticketId);
        expect(await comprobantes()).toBe(antes);
        return rechazo(r);
      },
      "B-04": async () => {
        const t = await ticketCortesia();
        const r = await facturar(t.ticketId);
        // La base también: un documento de un ticket que no está COBRADO no entra.
        expect(await insertarDocumento(t.ticketId, t.ejemplarId)).toBe(
          "documento_ticket_no_facturable",
        );
        return rechazo(r);
      },
      "B-05": async () => {
        const t = await ticketEmitido();
        valorDe(await anular(t));
        const r = await facturar(t.ticketId);
        expect(await insertarDocumento(t.ticketId, t.ejemplarId)).toBe(
          "documento_ticket_no_facturable",
        );
        return rechazo(r);
      },
      "B-07": async () => {
        const t = await ticketParaFacturar();
        valorDe(await facturar(t.ticketId));
        const antes = await comprobantes();
        const r = await facturar(t.ticketId);
        expect(await comprobantes()).toBe(antes);
        return rechazo(r);
      },
      "B-11": async () => {
        const t = await ticketParaFacturar();
        const restriccion = await insertarDocumento(t.ticketId, nuevoId());
        expect(restriccion).toBe("documento_ejemplar_no_vigente");
        return { permitido: restriccion === null, codigos: [] };
      },
      "B-12": async () => {
        const t = await ticketParaFacturar();
        const clave = nuevaClaveDeFactura();
        const primera = await facturar(t.ticketId, clave);
        const segunda = await facturar(t.ticketId, clave);
        expect(valorDe(segunda).yaExistia).toBe(true);
        expect(valorDe(segunda).comprobanteId).toBe(valorDe(primera).comprobanteId);
        return permitido(primera, segunda);
      },
      "B-13": async () => {
        const t = await ticketParaFacturar();
        const otro = await ticketParaFacturar();
        const clave = nuevaClaveDeFactura();
        valorDe(await facturar(t.ticketId, clave));
        const antes = await comprobantes();
        const r = await facturar(otro.ticketId, clave);
        expect(await comprobantes()).toBe(antes);
        return rechazo(r);
      },
      "B-14": async () => {
        // Con su propia empresa: un comprobante «Confirmando» deja la serie en curso y no deja autorizar a los demás.
        const otro = await escenarioFacturable(m);
        const cajaOtra = await m.cajaAbierta(otro);
        fiscal.adelantar();
        const t = await ticketCobrado(m, otro, cajaOtra);
        const primera = valorDe(await facturar(t.ticketId, nuevaClaveDeFactura(), otro));
        fiscal.falsa.programar("INCIERTO");
        await fiscal.autorizar(otro, primera.comprobanteId);
        const estado = (
          await m.filas<{ estado: string }>("select estado from comprobante where id = $1", [
            primera.comprobanteId,
          ])
        )[0]?.estado;
        expect(estado).toBe("INCIERTO");
        return rechazo(await facturar(t.ticketId, nuevaClaveDeFactura(), otro));
      },
      // ---- C: factura y nota de crédito ------------------------------------------------------------------------------------------
      "C-01": async () => {
        const t = await ticketParaFacturar();
        const f = valorDe(await facturar(t.ticketId));
        await fiscal.autorizar(e, f.comprobanteId);
        return permitido(await fiscal.intentarNotaDeCredito(e, f.comprobanteId, "400.00"));
      },
      "C-02": async () => {
        const t = await ticketParaFacturar();
        const f = valorDe(await facturar(t.ticketId));
        await fiscal.autorizar(e, f.comprobanteId);
        // Más de lo facturado ($1000): sin tope ni aviso (D-11, D-83).
        return permitido(await fiscal.intentarNotaDeCredito(e, f.comprobanteId, "1500.00"));
      },
      "C-03": async () => {
        const t = await ticketParaFacturar();
        const f = valorDe(await facturar(t.ticketId));
        // Sin autorizar (PENDIENTE): no se acredita.
        return rechazo(await fiscal.intentarNotaDeCredito(e, f.comprobanteId, "100.00"));
      },
      "C-05": async () => {
        const t = await ticketParaFacturar();
        const f = valorDe(await facturar(t.ticketId));
        await fiscal.autorizar(e, f.comprobanteId);
        const nota = valorDe(
          await fiscal.intentarNotaDeCredito(e, f.comprobanteId, "100.00"),
        ).comprobanteId;
        await fiscal.autorizar(e, nota);
        return rechazo(await fiscal.intentarNotaDeCredito(e, nota, "50.00"));
      },
      "C-06": async () => {
        const t = await ticketParaFacturar();
        const f = valorDe(await facturar(t.ticketId));
        await fiscal.autorizar(e, f.comprobanteId);
        await fiscal.autorizar(e, await fiscal.notaDeCredito(e, f.comprobanteId, "1000.00"));
        // El documento dejó de valer: su puntero se marca no vigente al volver a facturar (C-08), sin que quede otro vigente.
        const nueva = await facturar(t.ticketId);
        const punteros = await m.filas<{ vigente: boolean }>(
          "select vigente from documento_de_ticket where ticket_id = $1 order by intento",
          [t.ticketId],
        );
        expect(punteros.map((p) => p.vigente)).toEqual([false, true]);
        return permitido(nueva);
      },
      "C-08": async () => {
        const t = await ticketParaFacturar();
        const f = valorDe(await facturar(t.ticketId));
        await fiscal.autorizar(e, f.comprobanteId);
        await fiscal.autorizar(e, await fiscal.notaDeCredito(e, f.comprobanteId, "1000.00"));
        const nueva = await facturar(t.ticketId);
        const origen = (
          await m.filas<{ origen_tipo: string }>(
            "select origen_tipo from comprobante where id = $1",
            [valorDe(nueva).comprobanteId],
          )
        )[0]?.origen_tipo;
        expect(origen).toBe("REEMISION_DE_TICKET");
        return permitido(nueva);
      },
      // ---- D: idempotencia (las carreras están en oraculo-de-ticket-concurrencia.test.ts) --------------------------------------------
      "D-02": async () => {
        const t = await ticketEmitido();
        const clave = nuevaClave();
        const primera = await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(t, "1000.00", "EFECTIVO", clave),
        );
        const segunda = await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(t, "1000.00", "EFECTIVO", clave),
        );
        expect(valorDe(segunda).yaExistia).toBe(true);
        expect(valorDe(segunda).cobranzaId).toBe(valorDe(primera).cobranzaId);
        expect(
          await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
            t.ticketId,
          ]),
        ).toBe(1);
        return permitido(primera, segunda);
      },
      "D-03": async () => {
        const t = await ticketEmitido();
        const clave = nuevaClave();
        valorDe(await m.casos.cobrar(e.gerente, entradaDeCobrar(t, "1000.00", "EFECTIVO", clave)));
        const r = await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(t, "1000.00", "TARJETA_DEBITO", clave),
        );
        expect(
          await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
            t.ticketId,
          ]),
        ).toBe(1);
        return rechazo(r);
      },
      "D-06": async () => {
        const t = await ticketEmitido();
        const clave = nuevaClave();
        const ejemplarNuevoId = nuevoId();
        const primera = await anular(t, { claveIdempotencia: clave, ejemplarNuevoId });
        const segunda = await anular(t, { claveIdempotencia: clave, ejemplarNuevoId });
        expect(valorDe(segunda).yaExistia).toBe(true);
        expect(
          await m.contar(
            "select count(*) as n from ticket_ejemplar where ticket_id = $1 and tipo = 'ANULACION'",
            [t.ticketId],
          ),
        ).toBe(1);
        return permitido(primera, segunda);
      },
      "D-07": async () => {
        // La carrera está en el otro archivo; acá, la misma situación en secuencia: cobrar un ticket ya anulado no lo deja a medias.
        const t = await ticketEmitido();
        valorDe(await anular(t));
        const r = await cobrar(t);
        expect(await estadoDe(t.ticketId)).toBe("ANULADO");
        expect(
          await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
            t.ticketId,
          ]),
        ).toBe(0);
        return { permitido: true, codigos: [codigoDe(r) ?? ""].filter((c) => c !== "") };
      },
      "D-08": async () => {
        const t = await ticketParaFacturar();
        const clave = nuevaClaveDeFactura();
        await facturar(t.ticketId, clave); // la respuesta se perdió en la red
        const repetido = await facturar(t.ticketId, clave);
        const otraClave = await facturar(t.ticketId); // otra pantalla, otra clave: sigue siendo la misma factura
        expect(valorDe(repetido).yaExistia).toBe(true);
        expect(codigoDe(otraClave)).toBe("TICKET_YA_FACTURADO");
        expect(
          await m.contar("select count(*) as n from documento_de_ticket where ticket_id = $1", [
            t.ticketId,
          ]),
        ).toBe(1);
        return permitido(repetido);
      },
    };

    const CELDAS: readonly CeldaDeOraculo[] = [...ORACULO_DE_VENTAS, ...ORACULO_DE_COMPROBANTE];
    const ejecutables = celdasEjecutables(CELDAS);

    it("cada celda que hoy coincide tiene quién la ejecute (o su prueba citada); ninguna pendiente se ejecuta", () => {
      const conEjecutor = new Set([
        ...Object.keys(EJECUTORES),
        ...Object.keys(CUBIERTAS_POR_OTRA_PRUEBA),
      ]);
      expect([...conEjecutor].sort()).toEqual(ejecutables.map((c) => c.id).sort());
      for (const celda of celdasPendientes(CELDAS))
        expect(conEjecutor.has(celda.id), celda.id).toBe(false);
    });

    it("las pruebas citadas existen (archivo y título)", () => {
      for (const [id, { archivo, titulo }] of Object.entries(CUBIERTAS_POR_OTRA_PRUEBA)) {
        expect(existsSync(join(RAIZ, archivo)), `${id}: ${archivo}`).toBe(true);
        expect(
          readFileSync(join(RAIZ, archivo), "utf8").includes(titulo),
          `${id}: «${titulo}»`,
        ).toBe(true);
      }
    });

    it.each(
      ejecutables
        .filter((c) => EJECUTORES[c.id] !== undefined)
        .map((c) => [c.id, `${c.accion}: ${c.partida}`, c] as const),
    )("%s %s", async (id, _titulo, celda) => {
      const ejecutor = EJECUTORES[id];
      if (ejecutor === undefined) throw new Error(`falta el ejecutor de ${id}`);
      const observado = await ejecutor();
      // Una celda que se rechaza: lo que el código devolvió tiene que ser EXACTAMENTE lo que la celda nombra.
      if (!celda.permitido && celda.errores.length > 0) {
        expect([...new Set(observado.codigos)].sort(), `${id}: errores`).toEqual(
          [...celda.errores].sort(),
        );
      }
      expect(observado.permitido, `${id}: permitido`).toBe(celda.permitido);
    });

    // Las celdas que esperan su tramo: no se ejecutan (la prueba nacería roja si el tramo no está). Se activan al construir cada tramo.
    for (const celda of celdasPendientes(CELDAS)) {
      it(`${celda.id} ${etiquetaDePendiente(celda) ?? ""}: ${celda.accion}: ${celda.partida}`, () => {
        expect(celda.pendiente).not.toBeNull();
      });
    }
  },
);
