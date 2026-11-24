import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cotizarLaFactura,
  leerElNivelParaComprar,
  registrarLaCompra,
  type DependenciasDeComprarWeb,
  type DependenciasDeRegistrarCompraWeb,
} from "../../src/composicion/comprar-web";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras PR 7: las dos lecturas que acompañan a «Nueva compra» con factura, con una base real. `nivelParaComprar` dice SOLO si la empresa compra «Con factura» a quien carga compras, sin escribir (no crea la fila de la
 * configuración), por empresa y sin darle a quien opera el poder de cambiar el nivel. `cotizarFactura` hace las cuentas de la factura con la MISMA función que el alta: no escribe, da EXACTAMENTE lo mismo que el alta
 * con los mismos datos (con las dos condiciones frente al IVA de la empresa), rechaza lo mismo y no mezcla empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({
    ok: false,
    error: { codigo: expect.stringMatching(/_NO_PERMITIDA$|^SIN_PERMISO$|^MODULO/) as unknown },
  });

describe.skipIf(base === null)(
  "composición web: nivel y cuentas de la factura de «Nueva compra»",
  () => {
    let c: MontajeDeCompras;
    let lectura: DependenciasDeComprarWeb;
    let alta: DependenciasDeRegistrarCompraWeb;
    const registrados: string[] = [];

    beforeAll(async () => {
      if (base === null) return;
      c = await montarCompras(base);
      lectura = {
        consultas: () => c.consultas,
        respuesta: { registrar: (x) => registrados.push(x) },
      };
      alta = { casosDeUso: () => c.casos, respuesta: { registrar: (x) => registrados.push(x) } };
    });
    afterAll(async () => {
      if (base !== null) await c.cerrar();
    });

    const filasDeConfiguracion = (e: EscenarioDeCompras) =>
      c.contar("select count(*) as n from configuracion_de_compras where empresa_id = $1", [
        e.empresa,
      ]);
    const comprobantes = (e: EscenarioDeCompras) =>
      c.contar("select count(*) as n from comprobante_de_proveedor where empresa_id = $1", [
        e.empresa,
      ]);

    it("NIVEL: los tres roles lo ven y dicen solo `conFactura`; una empresa sin configurar es «sin factura» y mirar NO crea la fila", async () => {
      const e = await c.escenario();
      const antes = await filasDeConfiguracion(e);
      for (const quien of [e.operador, e.gerente, e.administrador]) {
        const r = await leerElNivelParaComprar(lectura, quien);
        expect(r).toEqual({ ok: true, dato: { conFactura: false } });
      }
      expect(await filasDeConfiguracion(e)).toBe(antes);
    });

    it("NIVEL: «Con factura» lo dice a quien opera, que sigue sin poder CAMBIARLO; cada empresa ve el suyo", async () => {
      const con = await c.escenario();
      const sin = await c.escenario();
      valorDe(
        await c.casos.configurarCompras(con.gerente, {
          nivel: "CON_COMPROBANTE",
          versionEsperada: 1,
        }),
      );
      expect(await leerElNivelParaComprar(lectura, con.operador)).toEqual({
        ok: true,
        dato: { conFactura: true },
      });
      expect(await leerElNivelParaComprar(lectura, sin.operador)).toEqual({
        ok: true,
        dato: { conFactura: false },
      });
      expect(
        await c.casos.configurarCompras(con.operador, {
          nivel: "COMPRA_SIMPLE",
          versionEsperada: 2,
        }),
      ).toMatchObject({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await leerElNivelParaComprar(lectura, con.operador)).toEqual({
        ok: true,
        dato: { conFactura: true },
      });
    });

    it("NIVEL: con el módulo de compras apagado se rechaza (el guard del servidor manda)", async () => {
      const e = await c.escenario();
      c.apagarModulo("compras");
      try {
        esGenerico(await leerElNivelParaComprar(lectura, e.operador));
      } finally {
        c.encenderModulo("compras");
      }
    });

    const lineas = (alicuota: string | null) => [
      { cantidadFacturada: "2000", precioNeto: "1.2345", alicuota },
      { cantidadFacturada: "3", precioNeto: "10.005", alicuota },
    ];
    const cotizar = (quien: EscenarioDeCompras["operador"], factura: Record<string, unknown>) =>
      cotizarLaFactura(lectura, quien, factura);

    it("COTIZAR: no escribe nada (ni comprobante, ni auditoría); da las cuentas exactas en texto decimal y avisa si el total no coincide", async () => {
      const e = await c.escenario();
      const comprobantesAntes = await comprobantes(e);
      const auditoriaAntes = (await c.auditoria(e.empresa, "COMPRA_REGISTRADA")).length;
      const r = await cotizar(e.operador, {
        tipo: "FACTURA_A",
        lineas: lineas("21"),
        percepciones: "",
        totalSegunFactura: "1.00",
      });
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.dato.lineas).toEqual([
        { netoDeLinea: "2469.00", ivaDeLinea: "518.49" },
        { netoDeLinea: "30.02", ivaDeLinea: "6.30" },
      ]);
      expect(r.dato.totalCalculado).toBe("3023.81");
      expect(r.dato.totalSegunFactura).toBe("1.00");
      expect(r.dato.totalCoincide).toBe(false);
      expect(typeof r.dato.iva).toBe("string");
      expect(await comprobantes(e)).toBe(comprobantesAntes);
      expect((await c.auditoria(e.empresa, "COMPRA_REGISTRADA")).length).toBe(auditoriaAntes);
    });

    for (const condicion of ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO"] as const) {
      it(`COTIZAR da EXACTAMENTE lo mismo que el alta con los mismos datos (empresa ${condicion}): neto, IVA, tributos y totales`, async () => {
        c.fijarCondicionDeIva(condicion);
        try {
          const x = await c.escenario();
          valorDe(
            await c.casos.configurarCompras(x.gerente, {
              nivel: "CON_COMPROBANTE",
              versionEsperada: 1,
            }),
          );
          const deposito = await c.deposito(x);
          const { producto } = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
          const proveedor = await c.proveedor(x.operador, {
            condicionIva: "RESPONSABLE_INSCRIPTO",
          });
          valorDe(await c.casos.agregarPuntoDeVenta(x.gerente, { parteId: proveedor, numero: 5 }));
          const factura = {
            tipo: "FACTURA_A",
            lineas: [{ cantidadFacturada: "2000", precioNeto: "1.2345", alicuota: "21" }],
            percepciones: "10.50",
            totalSegunFactura: "3000.00",
          };
          const cotizada = await cotizar(x.operador, factura);
          expect(cotizada).toMatchObject({ ok: true });
          const guardada = await registrarLaCompra(alta, x.operador, x.sucursal, {
            clave: nuevoId(),
            proveedorId: proveedor,
            renglones: [
              {
                productoId: producto,
                unidadDeCompraId: "KILOGRAMO",
                cantidad: "2",
                precioPor: "UNIDAD",
                unidadDePrecioId: "KILOGRAMO",
                precio: "1000.00",
              },
            ],
            factura: {
              ...factura,
              puntoDeVenta: "5",
              numero: String(numeroUnico()),
              fecha: "2026-10-10",
              lineas: [{ renglon: 1, ...factura.lineas[0] }],
              cuitDelProveedor: cuitUnico(),
            },
          });
          expect(guardada).toMatchObject({ ok: true });
          const [fila] = await c.filas<Record<string, string>>(
            `select neto_gravado::text as neto, iva::text as iva, tributos_total::text as tributos, total_calculado::text as calculado, total_segun_factura::text as papel
             from comprobante_de_proveedor where proveedor_id = $1`,
            [proveedor],
          );
          if (!cotizada.ok) return;
          expect(fila).toEqual({
            neto: cotizada.dato.netoGravado,
            iva: cotizada.dato.iva,
            tributos: cotizada.dato.tributosTotal,
            calculado: cotizada.dato.totalCalculado,
            papel: cotizada.dato.totalSegunFactura,
          });
        } finally {
          c.fijarCondicionDeIva("RESPONSABLE_INSCRIPTO");
        }
      });
    }

    it("COTIZAR rechaza lo mismo que el alta, con el genérico: tipo que no es de la lista, alícuota inexistente, cantidad en cero, campos de más; y no mezcla empresas (la empresa sale de la sesión)", async () => {
      const e = await c.escenario();
      const bueno = { tipo: "FACTURA_A", lineas: lineas("21"), totalSegunFactura: "100.00" };
      expect(await cotizar(e.operador, bueno)).toMatchObject({ ok: true });
      for (const malo of [
        { ...bueno, tipo: "FACTURA_Z" },
        { ...bueno, lineas: lineas("99") },
        { ...bueno, lineas: [{ cantidadFacturada: "0", precioNeto: "1", alicuota: "21" }] },
        { ...bueno, lineas: [{ cantidadFacturada: "1", precioNeto: "1", alicuota: null }] },
        { ...bueno, empresaId: e.empresa },
        { ...bueno, lineas: [] },
        { ...bueno, totalSegunFactura: 100 },
      ]) {
        expect(await cotizar(e.operador, malo)).toMatchObject({ ok: false });
      }
      // Una B sin alícuota (no discrimina IVA) sí se cotiza.
      expect(
        await cotizar(e.operador, {
          tipo: "FACTURA_B",
          lineas: lineas(null),
          totalSegunFactura: "100.00",
        }),
      ).toMatchObject({ ok: true });
    });
  },
);
