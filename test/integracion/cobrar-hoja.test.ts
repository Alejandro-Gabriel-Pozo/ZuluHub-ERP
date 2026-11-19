import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cobrarLaVenta,
  cobroParaLaPantalla,
  type DependenciasDeCobrarWeb,
} from "../../src/composicion/cobrar-web";
import {
  cambiarUnDato,
  estadoDelCobro,
  pagoNuevo,
  pedidoDeCobro,
  type OpcionesParaCobrar,
} from "../../apps/web/ui/plantillas/cobrar/modelo-de-cobro";
import { aporteDeVentas } from "../../src/modulos/ventas/publico";
import { crearCasosDeUsoDeCierre } from "../../src/modulos/cierre/publico";
import {
  FECHA_DE_NEGOCIO,
  REGLAS_DE_PRUEBA,
  nuevaClave,
  nuevoId,
  montarVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * La HOJA DE COBRAR de punta a punta contra la base real, sin navegador: (1) lo que la página resuelve (qué caja y qué opciones: lista, hay que abrirla o no se permite) y (2) que el pedido que arma el
 * MODELO de la pantalla con lo que el servidor ofreció es exactamente lo que el servidor acepta (el contrato entre la pantalla y el servidor): efectivo con vuelto (llega el neto), división entre
 * tarjeta y efectivo, y los datos de la tarjeta (cupón, últimos 4, marca, cuotas) y del DNI. Los casos de uso, la idempotencia y la atomicidad del cobro tienen sus pruebas en `cobrar-web.test.ts` y
 * `ventas-cobro*.test.ts`: acá se prueba la unión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)(
  "hoja de cobrar: lo que la pantalla pide y lo que el servidor acepta",
  () => {
    let m: MundoDeVentas;
    let d: DependenciasDeCobrarWeb;
    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base);
      d = {
        casosDeUso: () => m.casos,
        consultas: () => m.consultas,
        respuesta: { registrar: () => undefined },
      };
    });
    afterAll(async () => {
      await m.cerrar();
    });

    const preparar = async (e: Awaited<ReturnType<MundoDeVentas["escenario"]>>) => {
      const r = await cobroParaLaPantalla(d, e.gerente, e.sucursal);
      if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
      return r.dato;
    };

    it("con una caja abierta: LISTO con su caja y las opciones (medios activos, datos que pide cada uno)", async () => {
      const e = await m.escenario();
      const caja = await m.cajaAbierta(e);
      const p = await preparar(e);
      expect(p.estado).toBe("LISTO");
      if (p.estado !== "LISTO") return;
      expect(p.cajaId).toBe(caja.cajaId);
      expect(p.opciones.medios.map((x) => x.tipo)).toEqual(
        expect.arrayContaining(["EFECTIVO", "QR"]),
      );
      // Nace todo cerrado: ningún medio pide datos hasta que se los habilita.
      expect(p.opciones.medios.every((x) => Object.values(x.datosQuePide).every((v) => !v))).toBe(
        true,
      );
    });

    it("con una caja sin sesión: hay que abrirla; sin ninguna caja o con otra sucursal: no se permite", async () => {
      const e = await m.escenario();
      await m.dueno.query(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja cerrada')",
        [e.empresa, e.sucursal],
      );
      expect(await preparar(e)).toEqual({ estado: "ABRIR_LA_CAJA" });
      // Una sucursal sin ninguna caja: la lectura no encuentra con qué cobrar y no se asume nada.
      const sinCajas = await m.escenario();
      await m.dueno.query("delete from caja where empresa_id = $1", [sinCajas.empresa]);
      expect((await preparar(sinCajas)).estado).not.toBe("LISTO");
    });

    it("con dos cajas abiertas no elige una por la persona (DEC-0502)", async () => {
      const e = await m.escenario();
      await m.cajaAbierta(e);
      await m.cajaAbierta(e);
      expect(await preparar(e)).toEqual({ estado: "NO_PERMITIDO", jornadaAbierta: true });
    });

    it("con el día en auditoría: no se permite y la lectura dice que la jornada ya no está abierta", async () => {
      const e = await m.escenario();
      await m.cajaAbierta(e);
      const cierre = crearCasosDeUsoDeCierre({
        transacciones: m.entorno,
        reglas: REGLAS_DE_PRUEBA,
        aportes: [aporteDeVentas],
      });
      const auditoria = await cierre.iniciarAuditoria(e.administrador, {
        sucursalId: e.sucursal,
        fechaDeNegocio: FECHA_DE_NEGOCIO,
      });
      expect(auditoria.ok).toBe(true);
      expect(await preparar(e)).toEqual({ estado: "NO_PERMITIDO", jornadaAbierta: false });
    });

    it("sin permiso o con una persona de otra sucursal, la lectura falla cerrada (no devuelve una caja)", async () => {
      const e = await m.escenario();
      await m.cajaAbierta(e);
      const r = await cobroParaLaPantalla(d, e.operador, e.otraSucursal);
      expect(r.ok).toBe(false);
    });

    /** Lo que hace la pantalla: arma las filas, calcula el estado con lo que el servidor ofreció y manda el pedido. */
    const cobrarComoLaPantalla = async (
      e: Awaited<ReturnType<MundoDeVentas["escenario"]>>,
      opciones: OpcionesParaCobrar,
      cajaId: string,
      filas: (medioId: (tipo: string) => string) => ReturnType<typeof pagoNuevo>[],
    ) => {
      const medioId = (tipo: string) => {
        const medio = opciones.medios.find((x) => x.tipo === tipo);
        if (medio === undefined) throw new Error(`el servidor no ofreció ${tipo}`);
        return medio.id;
      };
      const total = monto("1000.00");
      const pagos = filas(medioId);
      const estado = estadoDelCobro(total, pagos, opciones.medios);
      expect(estado.listo).toBe(true);
      if (estado.vuelto === null) throw new Error("sin cuenta");
      const lineaId = nuevoId();
      const pedido = pedidoDeCobro({
        ids: { cuentaId: nuevoId(), ejemplarId: nuevoId(), lineas: new Map([["l", lineaId]]) },
        cajaId,
        cuenta: [
          {
            clave: "l",
            productoId: e.producto,
            varianteId: null,
            opcionIds: [],
            cantidad: 10_000,
            revision: 0,
          },
        ],
        total,
        pagos,
        medios: opciones.medios,
        vuelto: estado.vuelto,
      });
      if (pedido === null) throw new Error("sin pedido");
      return {
        pedido,
        estado,
        respuesta: await cobrarLaVenta(d, e.gerente, e.sucursal, {
          ...pedido,
          claveIdempotencia: nuevaClave(),
        }),
      };
    };

    it("efectivo con vuelto: al servidor llega el neto y el ticket queda cobrado por el total", async () => {
      const e = await m.escenario();
      const caja = await m.cajaAbierta(e);
      const p = await preparar(e);
      if (p.estado !== "LISTO") throw new Error("se esperaba LISTO");
      const { estado, respuesta } = await cobrarComoLaPantalla(e, p.opciones, p.cajaId, (medio) => [
        pagoNuevo("a", medio("EFECTIVO"), "1500.00"),
      ]);
      expect(estado.vuelto).toMatchObject({ vuelto: "500.00", netoEnEfectivo: "1000.00" });
      expect(respuesta.ok && respuesta.dato).toMatchObject({
        estado: "COBRADO",
        total: monto("1000.00"),
      });
      expect(respuesta.ok && respuesta.dato.cobros).toEqual([
        expect.objectContaining({
          medioDePagoId: caja.medios["EFECTIVO"],
          importe: monto("1000.00"),
        }),
      ]);
    });

    it("dividido entre débito y efectivo con vuelto: dos cobros que suman el total justo", async () => {
      const e = await m.escenario();
      await m.cajaAbierta(e);
      const p = await preparar(e);
      if (p.estado !== "LISTO") throw new Error("se esperaba LISTO");
      const { respuesta } = await cobrarComoLaPantalla(e, p.opciones, p.cajaId, (medio) => [
        pagoNuevo("a", medio("TARJETA_DEBITO"), "700.00"),
        pagoNuevo("b", medio("EFECTIVO"), "500.00"),
      ]);
      expect(respuesta.ok && respuesta.dato.cobros.map((c) => c.importe.monto).sort()).toEqual([
        "300.00",
        "700.00",
      ]);
    });

    it("con los datos habilitados, lo que la pantalla escribe llega al cobro; el DNI es de la transferencia", async () => {
      const e = await m.escenario();
      const caja = await m.cajaAbierta(e);
      await m.dueno.query(
        "update medio_de_pago set pide_cupon = true, pide_ultimos4 = true, pide_marca = true where id = $1",
        [caja.medios["TARJETA_DEBITO"]],
      );
      await m.dueno.query("update medio_de_pago set pide_dni = true where id = $1", [
        caja.medios["TRANSFERENCIA"],
      ]);
      const visa = (
        await m.filas<{ id: string }>("select id from valor_de_lista where nombre = 'Visa'")
      )[0]?.id as string;
      const p = await preparar(e);
      if (p.estado !== "LISTO") throw new Error("se esperaba LISTO");
      const debito = p.opciones.medios.find((x) => x.tipo === "TARJETA_DEBITO");
      expect(debito?.datosQuePide).toMatchObject({
        cupon: true,
        ultimos4: true,
        marca: true,
        cuotas: false,
      });
      expect(p.opciones.marcasDeTarjeta.some((x) => x.id === visa)).toBe(true);
      const { respuesta } = await cobrarComoLaPantalla(e, p.opciones, p.cajaId, (medio) => {
        let tarjeta = pagoNuevo("a", medio("TARJETA_DEBITO"), "600.00");
        tarjeta = cambiarUnDato(
          cambiarUnDato(cambiarUnDato(tarjeta, "cupon", "ZX-9981"), "ultimos4", "0042"),
          "marca",
          visa,
        );
        // Las cuotas son solo del crédito: en débito la pantalla no las manda aunque estuvieran escritas.
        tarjeta = cambiarUnDato(tarjeta, "cuotas", "6");
        const transferencia = cambiarUnDato(
          pagoNuevo("b", medio("TRANSFERENCIA"), "400.00"),
          "dni",
          "30123456",
        );
        return [tarjeta, transferencia];
      });
      expect(respuesta.ok).toBe(true);
      const cobros = await m.filas<Record<string, unknown>>(
        "select cupon, ultimos4, marca_de_tarjeta_id, cuotas, dni from cobro where empresa_id = $1 order by origen_orden",
        [e.empresa],
      );
      // El servidor ordena los cobros a su manera (orden canónico): importa qué datos llegaron a qué cobro, no el orden.
      expect(cobros).toHaveLength(2);
      expect(cobros).toEqual(
        expect.arrayContaining([
          {
            cupon: "ZX-9981",
            ultimos4: "0042",
            marca_de_tarjeta_id: visa,
            cuotas: null,
            dni: null,
          },
          { cupon: null, ultimos4: null, marca_de_tarjeta_id: null, cuotas: null, dni: "30123456" },
        ]),
      );
    });
  },
);
