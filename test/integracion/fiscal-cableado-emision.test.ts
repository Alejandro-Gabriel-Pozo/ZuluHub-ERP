import { X509Certificate } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import { armarEmisionFiscal } from "../../src/composicion/emision-fiscal";
import {
  certificadoId,
  solicitudId,
  type ProveedorDeEmision,
} from "../../src/modulos/fiscal/publico";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import { emisorId, empresaId } from "../../src/primitivas/identificadores/marca";
import { TransporteFalso, grabacion, respuestaDeLoginCms, respuestaHttp } from "../utilidades/arca";
import {
  casosDeCertificados,
  certificadoDeArca,
  clavesMaestrasDePrueba,
  crearEntornoDeCertificados,
  crearServicios,
  escenarioDeCertificados,
  pedidoDeCertificado,
  type ServiciosDePrueba,
} from "./certificados-apoyo";
import { solicitudDeAutorizacion } from "../utilidades/emision-falsa";
import { crearBaseAparte } from "./entorno";
import type { EscenarioDeCasos } from "./facturacion-casos-apoyo";

/**
 * Cableado fiscal: el proveedor de emisión de la composición contra una base real, con el servicio de ARCA FALSO
 * (un transporte en memoria que sirve las respuestas reales grabadas en homologación). Lo que se verifica es que
 * cada (empresa, emisor, ambiente) habla con SU certificado y SU ticket y que nada se mezcla:
 *  - el pedido de ticket de homologación va firmado con el certificado de homologación del emisor, y el de producción
 *    con el de producción; cada ticket se guarda con el certificado que lo pidió y se reutiliza;
 *  - el ticket de homologación nunca llega a un pedido de producción (ni al revés);
 *  - el emisor de otra empresa, o de la misma, no obtiene las credenciales de otro.
 * Los certificados, las claves y los tokens nacen en la propia prueba: nada es real.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const TOKEN_DE_HOMOLOGACION = `TOKENHOMO${"Qk3".repeat(30)}`;
const TOKEN_DE_PRODUCCION = `TOKENPROD${"Zx7".repeat(30)}`;
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

/** El vencimiento del ticket que «da» el falso: dentro de 12 horas, con el huso de Argentina. */
const venceDentroDe12Horas = (): string =>
  `${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 23)}-03:00`;

/** El CMS (base64) que viaja en un `loginCms`. */
function cmsDe(cuerpo: string): Buffer {
  const m = /<wsaa:in0>([^<]+)<\/wsaa:in0>/.exec(cuerpo);
  if (m?.[1] === undefined) throw new Error("el pedido de loginCms no trae el CMS");
  return Buffer.from(m[1], "base64");
}
const derDe = (pem: string): Buffer => new X509Certificate(pem).raw;

describe.skipIf(base === null)(
  "cableado fiscal: el proveedor de emisión por (emisor, ambiente)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let servicios: ServiciosDePrueba;
    let entornoDeCertificados: ReturnType<typeof crearEntornoDeCertificados>;
    let conexiones: Conexiones;
    const registrados: string[] = [];

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      const maestra = clavesMaestrasDePrueba();
      servicios = await crearServicios(maestra);
      entornoDeCertificados = crearEntornoDeCertificados(propia.base, 8);
      // La composición REAL, con una clave de certificados de ESTA corrida (la misma con que se cifra al cargar).
      const fuente = {
        PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.base.app,
        PEDERNAL_CLAVE_CERTIFICADOS: `${maestra.kid}:${maestra.clave.toString("hex")}`,
      };
      conexiones = armarConexiones({ fuente: () => fuente, registrar: (d) => registrados.push(d) });
    }, 120_000);
    afterAll(async () => {
      await conexiones.transaccionesDeApp().cerrar();
      await entornoDeCertificados.cerrar();
      await dueno.end();
      await propia.destruir();
    });

    const proveedorConTransporte = (transporte: TransporteFalso): ProveedorDeEmision =>
      armarEmisionFiscal(conexiones, {
        transporte: transporte.transporte,
        esperar: () => Promise.resolve(),
        registrar: (d) => registrados.push(d),
      });

    /** Un transporte que da un ticket distinto por ambiente y responde `FECompUltimoAutorizado` con la grabación. */
    const arcaFalsa = (): TransporteFalso =>
      new TransporteFalso()
        .programar("loginCms", (pedido) =>
          respuestaHttp(
            respuestaDeLoginCms({
              token: pedido.url.includes("wsaahomo") ? TOKEN_DE_HOMOLOGACION : TOKEN_DE_PRODUCCION,
              vence: venceDentroDe12Horas(),
            }),
          ),
        )
        .programar("FECompUltimoAutorizado", respuestaHttp(grabacion(1, "024", "respuesta")));

    /** Una empresa con su emisor y, por cada ambiente pedido, un certificado VIGENTE cargado de verdad. */
    async function empresaConCertificados(ambientes: readonly ("HOMOLOGACION" | "PRODUCCION")[]) {
      const e: EscenarioDeCasos = await escenarioDeCertificados(dueno, propia.base);
      const casos = casosDeCertificados(entornoDeCertificados, servicios);
      const pem: Partial<Record<"HOMOLOGACION" | "PRODUCCION", string>> = {};
      for (const ambiente of ambientes) {
        const entrada = pedidoDeCertificado(e, { ambiente });
        const pedido = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
        if (!pedido.ok) throw new Error(`pedido: ${JSON.stringify(pedido.error)}`);
        const certificado = await certificadoDeArca(servicios, ambiente, pedido.valor.pedidoPem);
        const carga = await casos.cargarCertificado(e.como(new Date()), {
          certificadoId: certificadoId(entrada.id),
          certificadoPem: certificado,
        });
        if (!carga.ok) throw new Error(`carga: ${JSON.stringify(carga.error)}`);
        pem[ambiente] = certificado;
      }
      return { e, empresa: empresaId(e.empresa), emisor: emisorId(e.emisor), pem };
    }

    const ticketsGuardados = async (empresa: string) =>
      (
        await dueno.query<{ ambiente: string; servicio: string }>(
          `select c.ambiente, a.servicio
           from acceso_arca a join certificado_arca c
             on c.empresa_id = a.empresa_id and c.id = a.certificado_id
          where a.empresa_id = $1 and a.credencial_cifrada is not null
          order by c.ambiente`,
          [empresa],
        )
      ).rows;

    it("cada ambiente pide SU ticket con el certificado de ESE ambiente, y lo usa solo en el WSFE de ese ambiente", async () => {
      const x = await empresaConCertificados(["HOMOLOGACION", "PRODUCCION"]);
      const arca = arcaFalsa();
      const proveedor = proveedorConTransporte(arca);

      const enHomologacion = await proveedor
        .para(x.empresa, x.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(enHomologacion).toEqual({ ok: true, valor: 13n });
      const enProduccion = await proveedor
        .para(x.empresa, x.emisor, "PRODUCCION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(enProduccion).toEqual({ ok: true, valor: 13n });

      const [loginHomo, wsfeHomo, loginProd, wsfeProd] = arca.pedidos;
      expect(arca.pedidos.map((p) => TransporteFalso.operacionDe(p))).toEqual([
        "loginCms",
        "FECompUltimoAutorizado",
        "loginCms",
        "FECompUltimoAutorizado",
      ]);
      // Los destinos de cada ambiente.
      expect(loginHomo?.url).toContain("wsaahomo.afip.gov.ar");
      expect(wsfeHomo?.url).toContain("wswhomo.afip.gov.ar");
      expect(loginProd?.url).toContain("wsaa.afip.gov.ar");
      expect(wsfeProd?.url).toContain("servicios1.afip.gov.ar");
      // El pedido de ticket de cada ambiente lleva el certificado de ESE ambiente, y solo ese.
      const homo = derDe(x.pem.HOMOLOGACION ?? "");
      const prod = derDe(x.pem.PRODUCCION ?? "");
      expect(homo.equals(prod)).toBe(false);
      expect(cmsDe(loginHomo?.cuerpo ?? "").includes(homo)).toBe(true);
      expect(cmsDe(loginHomo?.cuerpo ?? "").includes(prod)).toBe(false);
      expect(cmsDe(loginProd?.cuerpo ?? "").includes(prod)).toBe(true);
      expect(cmsDe(loginProd?.cuerpo ?? "").includes(homo)).toBe(false);
      // El ticket de homologación no sale en el WSFE de producción, ni al revés.
      expect(wsfeHomo?.cuerpo).toContain(TOKEN_DE_HOMOLOGACION);
      expect(wsfeHomo?.cuerpo).not.toContain(TOKEN_DE_PRODUCCION);
      expect(wsfeProd?.cuerpo).toContain(TOKEN_DE_PRODUCCION);
      expect(wsfeProd?.cuerpo).not.toContain(TOKEN_DE_HOMOLOGACION);
      // Cada ticket quedó guardado cifrado con el certificado que lo pidió.
      expect(await ticketsGuardados(x.e.empresa)).toEqual([
        { ambiente: "HOMOLOGACION", servicio: "wsfe" },
        { ambiente: "PRODUCCION", servicio: "wsfe" },
      ]);
      const enLaBase = JSON.stringify(
        (await dueno.query("select * from acceso_arca where empresa_id = $1", [x.e.empresa])).rows,
      );
      expect(enLaBase).not.toContain(TOKEN_DE_HOMOLOGACION);
      expect(enLaBase).not.toContain(TOKEN_DE_PRODUCCION);
    });

    it("el ticket guardado se reutiliza: otra llamada, y otro proveedor (otra instancia del servidor), no piden otro", async () => {
      const x = await empresaConCertificados(["HOMOLOGACION"]);
      const arca = arcaFalsa();
      await proveedorConTransporte(arca)
        .para(x.empresa, x.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      const otraInstancia = arcaFalsa();
      const r = await proveedorConTransporte(otraInstancia)
        .para(x.empresa, x.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(r.ok).toBe(true);
      expect(arca.veces("loginCms")).toBe(1);
      // La otra instancia leyó el ticket de la base: ni un pedido a WSAA, y el WSFE llevó ese token.
      expect(otraInstancia.veces("loginCms")).toBe(0);
      expect(otraInstancia.pedidos[0]?.cuerpo).toContain(TOKEN_DE_HOMOLOGACION);
    });

    it("un ambiente sin certificado no usa el del otro: falla sin credencial y no sale NINGÚN pedido a ARCA", async () => {
      const x = await empresaConCertificados(["HOMOLOGACION"]);
      const arca = arcaFalsa();
      const proveedor = proveedorConTransporte(arca);
      // Con el ticket de homologación ya guardado, producción sigue sin tener con qué.
      await proveedor
        .para(x.empresa, x.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      const antes = arca.pedidos.length;
      const enProduccion = await proveedor
        .para(x.empresa, x.emisor, "PRODUCCION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(enProduccion).toMatchObject({ ok: false, error: { codigo: "SIN_CREDENCIAL" } });
      const autorizacion = await proveedor
        .para(x.empresa, x.emisor, "PRODUCCION")
        .autorizar(SOLICITUD);
      expect(autorizacion.tipo).toBe("NO_ENVIADO");
      expect(arca.pedidos.length).toBe(antes);
      expect(JSON.stringify(arca.pedidos.slice(antes))).not.toContain(TOKEN_DE_HOMOLOGACION);
    });

    it("cada emisor usa el certificado de su empresa: el de otra no se obtiene, ni nombrándolo", async () => {
      const a = await empresaConCertificados(["HOMOLOGACION"]);
      const b = await empresaConCertificados(["HOMOLOGACION"]);
      const arca = arcaFalsa();
      const proveedor = proveedorConTransporte(arca);

      // Cada una firma con el suyo.
      await proveedor
        .para(a.empresa, a.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      await proveedor
        .para(b.empresa, b.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      const [loginA, , loginB] = arca.pedidos;
      const derA = derDe(a.pem.HOMOLOGACION ?? "");
      const derB = derDe(b.pem.HOMOLOGACION ?? "");
      expect(cmsDe(loginA?.cuerpo ?? "").includes(derA)).toBe(true);
      expect(cmsDe(loginA?.cuerpo ?? "").includes(derB)).toBe(false);
      expect(cmsDe(loginB?.cuerpo ?? "").includes(derB)).toBe(true);
      expect(cmsDe(loginB?.cuerpo ?? "").includes(derA)).toBe(false);

      // Pedir el emisor de la otra empresa (con cualquiera de las dos empresas) no encuentra credencial.
      const antes = arca.pedidos.length;
      for (const [empresa, emisor] of [
        [a.empresa, b.emisor],
        [b.empresa, a.emisor],
      ] as const) {
        const r = await proveedor
          .para(empresa, emisor, "HOMOLOGACION")
          .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
        expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_CREDENCIAL" } });
      }
      expect(arca.pedidos.length).toBe(antes);
      // Y los tickets guardados siguen siendo uno por empresa.
      expect(await ticketsGuardados(a.e.empresa)).toHaveLength(1);
      expect(await ticketsGuardados(b.e.empresa)).toHaveLength(1);
    });

    it("nada secreto sale en lo que devuelve el cliente, ni en el registro del servidor", async () => {
      const x = await empresaConCertificados(["HOMOLOGACION"]);
      const antes = registrados.length;
      const arca = new TransporteFalso()
        .programar("loginCms", respuestaHttp("<no es xml>", 500))
        .programar("FECompUltimoAutorizado", respuestaHttp(grabacion(1, "024", "respuesta")));
      const r = await proveedorConTransporte(arca)
        .para(x.empresa, x.emisor, "HOMOLOGACION")
        .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(r.ok).toBe(false);
      const visto = JSON.stringify([r, registrados.slice(antes)]);
      for (const secreto of [
        ...servicios.clavesGeneradas.map((c) => c.split("\n")[1] ?? "?"),
        TOKEN_DE_HOMOLOGACION,
        "PRIVATE",
        propia.base.app,
      ]) {
        expect(visto).not.toContain(secreto);
      }
    });
  },
);
