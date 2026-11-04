import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  crearPuntoDeVenta,
  editarPuntoDeVenta,
  puntosDeVentaDelEmisor,
  type DependenciasDeConfiguracionFiscalWeb,
} from "../../src/composicion/configuracion-fiscal-web";
import { armarWeb } from "../../src/composicion/web";
import {
  armarElPedidoDeEdicion,
  valoresParaEditar,
  type PuntoParaConfigurar,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";
import { crearBaseAparte } from "./entorno";
import {
  crearEscenarioDeConfiguracion,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";

/**
 * Editar un punto de venta con su domicilio precargado, contra la composición REAL y una base de verdad: lo que la lista entrega pasa
 * por el modelo de la pantalla (`valoresParaEditar` y `armarElPedidoDeEdicion`) y el pedido resultante vuelve al caso de uso.
 * Sin tocar el domicilio no viaja y el servidor responde «sin cambios»; corregido viaja como NUEVO con un id que no se usó (el mismo id
 * con otro contenido es `ID_EN_USO`); reenviar el MISMO envío tras una respuesta perdida no duplica nada. Previene: que la pantalla
 * precargada reenvíe el domicilio guardado con su id y reciba `ID_EN_USO`, o que cada reintento cree un domicilio más.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const uuid = (): string => randomUUID();

const domicilioNuevo = (cambios: Record<string, unknown> = {}) => ({
  tipo: "NUEVO",
  id: uuid(),
  calle: "Av. Corrientes",
  numero: "1234",
  piso: "3",
  departamento: "B",
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "S2000",
  ...cambios,
});

describe.skipIf(base === null)(
  "fiscal: editar un punto de venta con el domicilio precargado",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let conexiones: Conexiones;
    let d: DependenciasDeConfiguracionFiscalWeb;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      const fuente = {
        PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.base.app,
      };
      conexiones = armarConexiones({ fuente: () => fuente, registrar: () => undefined });
      const web = armarWeb(conexiones);
      d = {
        casosDeUso: web.casosDeUsoDeConfiguracionFiscal,
        consultas: web.consultasDeFacturacion,
        respuesta: { registrar: () => undefined },
      };
    }, 120_000);
    afterAll(async () => {
      await conexiones.transaccionesDeApp().cerrar();
      await dueno.end();
      await propia.destruir();
    });

    const ahora = () => new Date();
    const nuevo = () => crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });
    const cuenta = async (tabla: string, empresa: string, accion?: string): Promise<number> =>
      (
        await dueno.query<{ n: number }>(
          tabla === "auditoria_empresa"
            ? `select count(*)::int as n from auditoria_empresa where empresa_id = $1 and accion = $2`
            : `select count(*)::int as n from ${tabla} where empresa_id = $1`,
          tabla === "auditoria_empresa" ? [empresa, accion] : [empresa],
        )
      ).rows[0]?.n ?? -1;
    const dato = <T>(r: { ok: boolean; dato?: T; error?: unknown }): T => {
      if (!r.ok) throw new Error(`se esperaba un éxito: ${JSON.stringify(r.error)}`);
      return r.dato as T;
    };
    async function alta(e: EscenarioDeConfiguracion, id: string, domicilio?: object) {
      dato(
        await crearPuntoDeVenta(d, e.como(ahora()), {
          id,
          emisorId: e.mundo.emisor,
          sucursalId: e.mundo.sucursal,
          numero: 1,
          ...(domicilio === undefined ? {} : { domicilio }),
        }),
      );
    }
    /** Lo que la pantalla de edición recibe del servidor. */
    async function delServidor(
      e: EscenarioDeConfiguracion,
      id: string,
    ): Promise<PuntoParaConfigurar> {
      const { items } = dato(
        await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      const punto = items.find((i) => i.id === id);
      if (punto === undefined) throw new Error("el punto de venta no está en la lista");
      return punto;
    }
    const editar = (e: EscenarioDeConfiguracion, pedido: object) =>
      editarPuntoDeVenta(d, e.como(ahora()), pedido);
    const IDS = (id: string) => ({ puntoDeVentaId: id, domicilioId: uuid() });

    it("precarga el domicilio actual y, sin tocarlo, no viaja: el servidor responde «sin cambios» y no escribe nada", async () => {
      const e = await nuevo();
      const id = uuid();
      const actual = uuid();
      await alta(e, id, domicilioNuevo({ id: actual }));
      const punto = await delServidor(e, id);
      expect(valoresParaEditar(punto)).toMatchObject({
        calle: "Av. Corrientes",
        numeroDeCalle: "1234",
        piso: "3",
        departamento: "B",
        localidad: "Rosario",
        provincia: "AR-S",
        codigoPostal: "S2000",
      });
      const pedido = armarElPedidoDeEdicion(valoresParaEditar(punto), IDS(id), punto);
      expect(pedido).toEqual({ puntoDeVentaId: id, versionEsperada: punto.version });
      expect(dato(await editar(e, pedido))).toEqual({ version: punto.version, sinCambios: true });
      expect(await cuenta("domicilio", e.mundo.empresa)).toBe(1);
      expect(await cuenta("auditoria_empresa", e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toBe(0);
    });

    it("corregido viaja como NUEVO con un id distinto: queda como el actual y el anterior se conserva; repetir el MISMO envío es «sin cambios»", async () => {
      const e = await nuevo();
      const id = uuid();
      const actual = uuid();
      await alta(e, id, domicilioNuevo({ id: actual }));
      const punto = await delServidor(e, id);
      const ids = IDS(id);
      const pedido = armarElPedidoDeEdicion(
        { ...valoresParaEditar(punto), calle: "Mitre", numeroDeCalle: "55" },
        ids,
        punto,
      );
      expect(pedido).toMatchObject({ domicilio: { tipo: "NUEVO", id: ids.domicilioId } });
      expect(ids.domicilioId).not.toBe(actual);
      expect(dato(await editar(e, pedido))).toEqual({
        version: punto.version + 1,
        sinCambios: false,
      });
      const despues = await delServidor(e, id);
      expect(despues.domicilio).toMatchObject({
        id: ids.domicilioId,
        calle: "Mitre",
        numero: "55",
      });
      expect(await cuenta("domicilio", e.mundo.empresa)).toBe(2);
      // La respuesta se perdió y el formulario reenvía lo MISMO (incluida la versión vieja): ya es el estado actual.
      expect(dato(await editar(e, pedido))).toEqual({ version: despues.version, sinCambios: true });
      expect(await cuenta("domicilio", e.mundo.empresa)).toBe(2);
      expect(await cuenta("auditoria_empresa", e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toBe(1);
    });

    it("reenviar el domicilio guardado con su id y OTRO contenido es ID_EN_USO: por eso el corregido lleva un id nuevo", async () => {
      const e = await nuevo();
      const id = uuid();
      const actual = uuid();
      await alta(e, id, domicilioNuevo({ id: actual }));
      const punto = await delServidor(e, id);
      expect(
        await editar(e, {
          puntoDeVentaId: id,
          versionEsperada: punto.version,
          domicilio: domicilioNuevo({ id: actual, calle: "Mitre" }),
        }),
      ).toMatchObject({ ok: false });
      expect(await cuenta("domicilio", e.mundo.empresa)).toBe(1);
    });

    it("un punto de venta sin domicilio abre en blanco, no manda domicilio si no se escribe nada y, si se escribe, viaja nuevo", async () => {
      const e = await nuevo();
      const id = uuid();
      await alta(e, id);
      const punto = await delServidor(e, id);
      expect(punto.domicilio).toBeNull();
      const vacio = armarElPedidoDeEdicion(valoresParaEditar(punto), IDS(id), punto);
      expect(vacio).toEqual({ puntoDeVentaId: id, versionEsperada: punto.version });
      expect(dato(await editar(e, vacio))).toEqual({ version: punto.version, sinCambios: true });
      const ids = IDS(id);
      const escrito = armarElPedidoDeEdicion(
        {
          ...valoresParaEditar(punto),
          calle: "Mitre",
          numeroDeCalle: "55",
          localidad: "Rosario",
          provincia: "AR-S",
        },
        ids,
        punto,
      );
      expect(dato(await editar(e, escrito))).toEqual({
        version: punto.version + 1,
        sinCambios: false,
      });
      expect((await delServidor(e, id)).domicilio).toMatchObject({
        id: ids.domicilioId,
        calle: "Mitre",
      });
    });
  },
);
