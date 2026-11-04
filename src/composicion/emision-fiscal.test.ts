import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TransporteFalso } from "../../test/utilidades/arca";
import { solicitudDeAutorizacion } from "../../test/utilidades/emision-falsa";
import { emisorId, solicitudId } from "../modulos/fiscal/publico";
import { cuitDesdeTexto } from "../primitivas/identificacion-fiscal/cuit";
import { empresaId } from "../primitivas/identificadores/marca";
import { armarConexiones } from "./conexiones";
import { armarEmisionFiscal } from "./emision-fiscal";
import type { FuenteDeEntorno } from "./entorno";

/**
 * El proveedor de emisión de la composición sin base: armar no lee nada (P-12) y, sin una clave de certificados
 * que sirva, `para` NO lanza: devuelve un cliente que falla con valores seguros, y la causa va al registro sin
 * ningún valor. Que cada (emisor, ambiente) use SUS credenciales y SU ticket lo prueba, contra una base real,
 * `test/integracion/fiscal-cableado-emision.test.ts`. Los valores de acá se inventan en cada corrida.
 */

const EMPRESA = empresaId("11111111-1111-4111-8111-111111111111");
const EMISOR = emisorId("22222222-2222-4222-8222-222222222222");
const PUNTO_DE_VENTA = (() => {
  const cuit = cuitDesdeTexto("20111111112");
  if (!cuit.ok) throw new Error("CUIT de prueba");
  return { cuit: cuit.valor, numero: 1 };
})();

const SOLICITUD = solicitudDeAutorizacion({
  puntoDeVenta: PUNTO_DE_VENTA,
  tipo: "FACTURA_B",
  numero: 14n,
  solicitud: solicitudId("33333333-3333-4333-8333-333333333333"),
});

const claveDeCertificados = (): string => `k1:${randomBytes(32).toString("hex")}`;

/** La fuente con lo necesario para armar las transacciones de la aplicación; la base no existe (no se conecta). */
const fuenteBase = (): Record<string, string> => ({
  PEDERNAL_CLAVE_CONTEXTO: `1:${randomBytes(32).toString("hex")}`,
  PEDERNAL_DB_APP: "postgres://usuario:relleno@127.0.0.1:1/base",
});

function armar(fuente: FuenteDeEntorno) {
  const delEntorno: string[] = [];
  const delProveedor: string[] = [];
  let lecturas = 0;
  const conexiones = armarConexiones({
    fuente: () => {
      lecturas += 1;
      return fuente;
    },
    registrar: (detalle) => delEntorno.push(detalle),
  });
  const transporte = new TransporteFalso();
  const proveedor = armarEmisionFiscal(conexiones, {
    transporte: transporte.transporte,
    esperar: () => Promise.resolve(),
    registrar: (detalle) => delProveedor.push(detalle),
  });
  return { proveedor, transporte, delEntorno, delProveedor, lecturas: () => lecturas };
}

describe("armarEmisionFiscal: sin una clave de certificados que sirva", () => {
  it("armar el proveedor no lee el entorno (P-12): recién `para` lo pide", () => {
    const { proveedor, lecturas } = armar(fuenteBase());
    expect(lecturas()).toBe(0);
    proveedor.para(EMPRESA, EMISOR, "HOMOLOGACION");
    expect(lecturas()).toBeGreaterThan(0);
  });

  it.each([
    ["falta", undefined],
    ["no tiene la forma <kid>:<hexadecimales>", "sin-separador"],
    ["tiene la forma pero no son 32 bytes", `k1:${randomBytes(16).toString("hex")}`],
  ])(
    "la clave %s: `para` no lanza y el cliente falla seguro, sin tocar la red",
    async (_caso, clave) => {
      const fuente: Record<string, string> = fuenteBase();
      if (clave !== undefined) fuente["PEDERNAL_CLAVE_CERTIFICADOS"] = clave;
      const { proveedor, transporte, delEntorno, delProveedor } = armar(fuente);

      const cliente = proveedor.para(EMPRESA, EMISOR, "PRODUCCION");

      // `NO_ENVIADO`: seguro que no salió, el número reservado se libera y el comprobante vuelve a PENDIENTE.
      const autorizacion = await cliente.autorizar(SOLICITUD);
      expect(autorizacion.tipo).toBe("NO_ENVIADO");
      // `CONSULTA_FALLIDA`: no se sabe, la reconciliación reintenta (nunca «no existe»).
      expect((await cliente.consultar(PUNTO_DE_VENTA, "FACTURA_B", 1n)).tipo).toBe(
        "CONSULTA_FALLIDA",
      );
      // El servicio «no está disponible» (se reintenta); no es una credencial rota (eso sería definitivo).
      const ultimo = await cliente.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(ultimo.ok).toBe(false);
      expect(!ultimo.ok && ultimo.error.codigo).toBe("SERVICIO_NO_DISPONIBLE");
      expect(transporte.pedidos).toEqual([]);

      // La causa va al registro del servidor con el NOMBRE de la variable y ningún valor.
      expect(delEntorno.join("\n")).toContain("PEDERNAL_CLAVE_CERTIFICADOS");
      expect(delProveedor.length).toBeGreaterThan(0);
      const todo = JSON.stringify([delEntorno, delProveedor, autorizacion, ultimo]);
      if (clave !== undefined) expect(todo).not.toContain(clave);
      expect(todo).not.toContain("usuario:relleno");
    },
  );

  it("no memoriza el fallo: corregida la variable, el próximo cliente ya sirve", async () => {
    const fuente: Record<string, string> = fuenteBase();
    const { proveedor } = armar(fuente);
    expect((await proveedor.para(EMPRESA, EMISOR, "HOMOLOGACION").autorizar(SOLICITUD)).tipo).toBe(
      "NO_ENVIADO",
    );
    fuente["PEDERNAL_CLAVE_CERTIFICADOS"] = claveDeCertificados();
    // Con la clave, el cliente real sale a buscar el ticket a la base (que acá no existe): cae en «no disponible»,
    // no en el cliente que no se pudo armar. Sin conexión a la base no se sabe más, y no se filtra la cadena.
    const ultimo = await proveedor
      .para(EMPRESA, EMISOR, "HOMOLOGACION")
      .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(ultimo.ok).toBe(false);
    expect(JSON.stringify(ultimo)).not.toContain("usuario:relleno");
  });
});
