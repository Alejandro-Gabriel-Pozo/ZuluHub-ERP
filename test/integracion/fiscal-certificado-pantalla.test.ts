import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aCertificadoParaMostrar } from "../../apps/web/pantallas/certificado";
import {
  armarElAmbiente,
  armarElPedidoDeCertificado,
  armarLaCargaDeCertificado,
  armarLaListaDeAmbientes,
  lugarDelErrorDelPedido,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado";
import {
  cargarCertificado,
  estadoDeCertificados,
  generarPedidoDeCertificado,
  type DependenciasDeAccionesDeCertificadoDeArcaWeb,
  type DependenciasDeCertificadoDeArcaWeb,
} from "../../src/composicion/certificado-de-arca-web";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import { armarWeb } from "../../src/composicion/web";
import { certificadoDeArca, crearServicios, type ServiciosDePrueba } from "./certificados-apoyo";
import { crearBaseAparte } from "./entorno";
import {
  crearEscenarioDeConfiguracion,
  otraPersona,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * La pantalla «Certificado de ARCA» (asistente de 3 pasos por ambiente) CONTRA EL BACKEND REAL: el recorrido que hace la pantalla con
 * los pedidos que arma su modelo (`modelo-de-certificado.ts`), las acciones reales de la composición (conexiones y web, base de verdad,
 * roles limitados) y la lectura que la pinta. Lo que se prueba: el pedido sale con el PEM en la respuesta, repetir con el mismo `id`
 * devuelve el MISMO pedido sin otra clave, el estado del ambiente deja a la pantalla en el paso que toca, el certificado se carga
 * contra el pedido del estado, el vencimiento sale como fecha civil de Argentina, el reemplazo parte del alias vigente, los rechazos de
 * negocio salen como el error genérico con referencia (nunca con el código ni con el PEM, tampoco en el registro del servidor) y la
 * empresa ajena y quien no es gerente no ven ni tocan nada. Los permisos de cada caso de uso: `guard-primero-certificados.test.ts`; el
 * detalle de las acciones: `fiscal-certificados-web.test.ts`. Las autoridades de ARCA nacen en la propia prueba: ninguna es real.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const uuid = (): string => randomUUID();
const EMISOR_FALTANTE = "00000000-0000-4000-8000-000000000000";

describe.skipIf(base === null)(
  "fiscal: pantalla del certificado de ARCA con el backend real",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let conexiones: Conexiones;
    let servicios: ServiciosDePrueba;
    const registrados: string[] = [];
    let d: DependenciasDeAccionesDeCertificadoDeArcaWeb;
    let consultas: DependenciasDeCertificadoDeArcaWeb;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      servicios = await crearServicios();
      const fuente = {
        PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.base.app,
        // Una clave maestra al azar de esta corrida: nunca una real.
        PEDERNAL_CLAVE_CERTIFICADOS: `k1:${randomBytes(32).toString("hex")}`,
      };
      conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
      const respuesta = { registrar: (x: string) => registrados.push(x) };
      const web = armarWeb(conexiones, {
        reglas: REGLAS_CON_FACTURACION,
        cadenasDeConfianza: {
          HOMOLOGACION: [
            servicios.homologacion.raiz.certificadoPem,
            servicios.homologacion.intermedia.certificadoPem,
          ],
          PRODUCCION: [
            servicios.produccion.raiz.certificadoPem,
            servicios.produccion.intermedia.certificadoPem,
          ],
        },
      });
      d = { casosDeUso: web.casosDeUsoDeCertificados, respuesta };
      consultas = { consultas: web.consultasDeFacturacion, respuesta };
    }, 120_000);
    afterAll(async () => {
      await conexiones.transaccionesDeApp().cerrar();
      await dueno.end();
      await propia.destruir();
    });

    /** Una empresa con la facturación activada de verdad (plan y activación): los certificados son de facturación. */
    async function nuevo(): Promise<EscenarioDeConfiguracion> {
      const e = await crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });
      const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
      await asignarPlan(dueno, e.mundo.tenant, version);
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
        [e.mundo.empresa],
      );
      return e;
    }
    const ctx = (e: EscenarioDeConfiguracion) => e.como(new Date());
    const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: unknown }): T => {
      if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
      return r.dato;
    };
    /** Lo que lee la pantalla de un ambiente: el estado del servidor con el vencimiento ya como fecha civil. */
    async function arranqueDe(
      e: EscenarioDeConfiguracion,
      ambiente: "HOMOLOGACION" | "PRODUCCION",
    ) {
      const estado = dato(
        await estadoDeCertificados(consultas, ctx(e), { emisorId: e.mundo.emisor }),
      );
      const del = estado.find((c) => c.ambiente === ambiente);
      if (del === undefined) throw new Error("falta el ambiente");
      return { estado, arranque: armarElAmbiente(aCertificadoParaMostrar(del)) };
    }
    const valores = (e: EscenarioDeConfiguracion, alias: string) => ({
      alias,
      cuitTitular: e.mundo.cuit,
      organizacion: "Panadería Zulú SA",
    });
    const pedidoDe = (e: EscenarioDeConfiguracion, alias: string, id: string = uuid()) =>
      armarElPedidoDeCertificado(valores(e, alias), id, e.mundo.emisor, "HOMOLOGACION");
    const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
      (await dueno.query<T>(texto, p)).rows;

    it("el recorrido de la pantalla: falta cargar → paso 1 → pedido (una vez) → paso 3 → vigente con su fecha → reemplazo con el mismo alias", async () => {
      const e = await nuevo();
      const alias = `pedernal${randomBytes(3).toString("hex")}`;

      // Falta cargar: la pantalla arranca en el paso 1 y la lista dice «Falta cargar» en los dos ambientes.
      const inicial = await arranqueDe(e, "HOMOLOGACION");
      expect(inicial.arranque).toEqual({ vista: "generar", aliasInicial: "" });
      expect(
        armarLaListaDeAmbientes(inicial.estado.map(aCertificadoParaMostrar)).map(
          (f) => f.cartel?.texto,
        ),
      ).toEqual(["Falta cargar", "Falta cargar"]);

      // Paso 1: el pedido que arma el modelo; el PEM viene en la respuesta y se muestra una vez.
      const id = uuid();
      const pedido = armarElPedidoDeCertificado(
        valores(e, alias),
        id,
        e.mundo.emisor,
        "HOMOLOGACION",
      );
      const generado = dato(await generarPedidoDeCertificado(d, ctx(e), pedido));
      expect(generado.certificadoId).toBe(id);
      expect(generado.yaExistia).toBe(false);
      expect(generado.pedidoPem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----\n/);

      // Un reintento del mismo envío (corte de red) devuelve el MISMO pedido, sin otra clave ni otra fila.
      const repetido = dato(await generarPedidoDeCertificado(d, ctx(e), pedido));
      expect(repetido).toEqual({ ...generado, yaExistia: true });
      expect(
        await filas("select id from certificado_arca where empresa_id = $1", [e.mundo.empresa]),
      ).toHaveLength(1);

      // Si la persona vuelve: «Pendiente», el paso 3 contra ESE pedido, y el pedido no está en lo que lee la pantalla.
      const pendiente = await arranqueDe(e, "HOMOLOGACION");
      expect(pendiente.arranque).toMatchObject({ vista: "cargar", certificadoId: id });
      expect(JSON.stringify(pendiente)).not.toContain("CERTIFICATE");
      expect(
        armarLaListaDeAmbientes(pendiente.estado.map(aCertificadoParaMostrar)).map(
          (f) => f.cartel?.texto,
        ),
      ).toEqual(["Pendiente", "Falta cargar"]);

      // Paso 3: lo que devuelve ARCA, pegado, contra el pedido del estado.
      const deArca = await certificadoDeArca(servicios, "HOMOLOGACION", generado.pedidoPem);
      const cargado = dato(
        await cargarCertificado(d, ctx(e), armarLaCargaDeCertificado(id, deArca)),
      );
      expect(cargado.yaEstaba).toBe(false);

      // Vigente: el detalle con su fecha dd/mm/aaaa (día civil de Argentina), sin cartel, y el alias para «Reemplazar».
      const vigente = await arranqueDe(e, "HOMOLOGACION");
      const hoy = new Date().getUTCFullYear();
      expect(vigente.arranque).toMatchObject({
        vista: "detalle",
        aliasInicial: alias,
        cartel: null,
      });
      const vence = (
        vigente.arranque as unknown as { datos: { rotulo: string; valor: string }[] }
      ).datos.find((x) => x.rotulo === "Vence");
      expect(vence?.valor).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(Number(vence?.valor.slice(6))).toBeGreaterThanOrEqual(hoy);
      const fila = armarLaListaDeAmbientes(vigente.estado.map(aCertificadoParaMostrar))[0];
      expect(fila).toMatchObject({ cartel: null });
      expect(fila?.vence).toBe(`Vence ${vence?.valor}`);

      // Reemplazar: el paso 1 viene con el alias vigente; el pedido es OTRO (id nuevo), convive con el vigente y no lo toca.
      const reemplazo = armarElPedidoDeCertificado(
        valores(e, (vigente.arranque as { aliasInicial: string }).aliasInicial),
        uuid(),
        e.mundo.emisor,
        "HOMOLOGACION",
      );
      const segundo = dato(await generarPedidoDeCertificado(d, ctx(e), reemplazo));
      expect(segundo.certificadoId).not.toBe(id);
      const tras = await arranqueDe(e, "HOMOLOGACION");
      expect(tras.arranque).toMatchObject({ vista: "detalle", aliasInicial: alias });
      expect(
        await filas<{ estado: string }>(
          "select estado from certificado_arca where empresa_id = $1 order by creado_en",
          [e.mundo.empresa],
        ),
      ).toEqual([{ estado: "VIGENTE" }, { estado: "PEDIDO_GENERADO" }]);
    });

    it("producción es otro pedido: un ambiente no toca al otro", async () => {
      const e = await nuevo();
      const pedido = (ambiente: "HOMOLOGACION" | "PRODUCCION", alias: string) =>
        armarElPedidoDeCertificado(valores(e, alias), uuid(), e.mundo.emisor, ambiente);
      dato(await generarPedidoDeCertificado(d, ctx(e), pedido("PRODUCCION", "pedernalprod")));
      const lista = armarLaListaDeAmbientes(
        dato(await estadoDeCertificados(consultas, ctx(e), { emisorId: e.mundo.emisor })).map(
          aCertificadoParaMostrar,
        ),
      );
      expect(lista.map((f) => [f.titulo, f.cartel?.texto])).toEqual([
        ["Pruebas", "Falta cargar"],
        ["Producción", "Pendiente"],
      ]);
    });

    it("un vencimiento a la medianoche de Argentina sale el día civil de Argentina, no el de UTC", () => {
      const vigente = aCertificadoParaMostrar({
        ambiente: "PRODUCCION",
        situacion: "VIGENTE",
        alias: "a",
        cuitTitular: "20123456786",
        venceEn: "2028-10-13T02:30:00.000Z",
        vencido: false,
        pedidoPendiente: null,
      });
      expect(vigente).toMatchObject({ vence: "2028-10-12" });
    });

    describe("los rechazos salen por la vía común", () => {
      it("un alias mal escrito: error inesperado con referencia; el código queda en el registro del servidor y nada se escribe", async () => {
        const e = await nuevo();
        const antes = registrados.length;
        const r = await generarPedidoDeCertificado(
          d,
          ctx(e),
          armarElPedidoDeCertificado(
            valores(e, "con espacios"),
            uuid(),
            e.mundo.emisor,
            "HOMOLOGACION",
          ),
        );
        expect(r).toMatchObject({
          ok: false,
          error: {
            presentacion: "INESPERADO",
            referencia: expect.stringMatching(/^PD-/) as string,
          },
        });
        expect(JSON.stringify(r)).not.toContain("ALIAS_INVALIDO");
        expect(registrados.slice(antes).join("\n")).toContain("ALIAS_INVALIDO");
        expect(
          await filas("select id from certificado_arca where empresa_id = $1", [e.mundo.empresa]),
        ).toHaveLength(0);
      });

      it("un dato sin la forma pedida: «Revisá los datos marcados.» con su campo", async () => {
        const e = await nuevo();
        const pedido = {
          ...armarElPedidoDeCertificado(valores(e, "x"), uuid(), e.mundo.emisor, "HOMOLOGACION"),
        };
        const r = await generarPedidoDeCertificado(d, ctx(e), {
          ...pedido,
          cuitTitular: undefined,
        });
        expect(r).toMatchObject({
          ok: false,
          error: {
            codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
            clave: "error.fiscal_configuracion_datos_invalidos",
          },
        });
        const campo = (r as { error: { campo?: string } }).error.campo;
        expect(lugarDelErrorDelPedido(campo)).toBe("cuitTitular");
      });

      it("un certificado que no es del pedido pendiente (o el de un pedido anulado por D-92): error inesperado con referencia, sin el PEM en el registro, y el pendiente sigue pendiente", async () => {
        const e = await nuevo();
        const pedir = async (alias: string, id: string) =>
          dato(await generarPedidoDeCertificado(d, ctx(e), pedidoDe(e, alias, id)));
        // D-92: el pedido nuevo anula al anterior; el certificado desajustado sale de ese primero (otra clave).
        const viejoId = uuid();
        const viejo = await pedir("pedernaly", viejoId);
        const delViejo = await certificadoDeArca(servicios, "HOMOLOGACION", viejo.pedidoPem);
        const id = uuid();
        const generado = await pedir("pedernalx", id);
        const rechazo = async (certificadoId: string) => {
          const antes = registrados.length;
          const carga = armarLaCargaDeCertificado(certificadoId, delViejo);
          const r = await cargarCertificado(d, ctx(e), carga);
          expect(r).toMatchObject({
            ok: false,
            error: {
              presentacion: "INESPERADO",
              referencia: expect.stringMatching(/^PD-/) as string,
            },
          });
          const registro = registrados.slice(antes).join("\n");
          expect(registro).not.toContain("BEGIN CERTIFICATE");
          expect(registro).not.toContain(generado.pedidoPem.split("\n")[1] ?? "x".repeat(40));
          return { registro, publico: JSON.stringify(r) };
        };
        // Contra el único pendiente: no corresponde (la clave es otra).
        const noCorresponde = await rechazo(id);
        expect(noCorresponde.registro).toContain("NO_CORRESPONDE");
        expect(noCorresponde.publico).not.toContain("NO_CORRESPONDE");
        // Contra el pedido anulado: ya no está pendiente, por la misma vía común.
        const anulado = await rechazo(viejoId);
        expect(anulado.registro).toContain("PEDIDO_NO_PENDIENTE");
        expect(anulado.publico).not.toContain("PEDIDO_NO_PENDIENTE");
        expect(
          await filas(
            "select estado from certificado_arca where empresa_id = $1 order by creado_en",
            [e.mundo.empresa],
          ),
        ).toEqual([{ estado: "DESCARTADO" }, { estado: "PEDIDO_GENERADO" }]);
      });

      it("un certificado ilegible pegado: error inesperado con referencia; ni lo pegado ni el pedido llegan al registro", async () => {
        const e = await nuevo();
        const id = uuid();
        const generado = dato(
          await generarPedidoDeCertificado(d, ctx(e), pedidoDe(e, "pedernalz", id)),
        );
        const antes = registrados.length;
        const r = await cargarCertificado(
          d,
          ctx(e),
          armarLaCargaDeCertificado(id, "esto no es un certificado"),
        );
        expect(r).toMatchObject({ ok: false, error: { presentacion: "INESPERADO" } });
        const registro = registrados.slice(antes).join("\n");
        expect(registro).not.toContain("esto no es un certificado");
        expect(registro).not.toContain(generado.pedidoPem.split("\n")[1] ?? "x".repeat(40));
        expect(registrados.join("\n")).not.toMatch(/PRIVATE KEY/);
      });
    });

    describe("quién ve y toca", () => {
      it("otra empresa no ve el estado ni puede cargar contra un pedido ajeno (indistinguible de uno que no existe)", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const id = uuid();
        const generado = dato(
          await generarPedidoDeCertificado(d, ctx(a), pedidoDe(a, "pedernala", id)),
        );
        // El emisor de otra empresa no existe para B.
        expect(
          await estadoDeCertificados(consultas, ctx(b), { emisorId: a.mundo.emisor }),
        ).toMatchObject({
          ok: false,
        });
        const deArca = await certificadoDeArca(servicios, "HOMOLOGACION", generado.pedidoPem);
        expect(
          await cargarCertificado(d, ctx(b), armarLaCargaDeCertificado(id, deArca)),
        ).toMatchObject({
          ok: false,
          error: { presentacion: "INESPERADO" },
        });
        expect(
          await generarPedidoDeCertificado(
            d,
            ctx(b),
            armarElPedidoDeCertificado(
              valores(b, "pedernalb"),
              uuid(),
              EMISOR_FALTANTE,
              "HOMOLOGACION",
            ),
          ),
        ).toMatchObject({ ok: false });
        // Lo de A sigue pendiente, intacto.
        expect((await arranqueDe(a, "HOMOLOGACION")).arranque).toMatchObject({
          vista: "cargar",
          certificadoId: id,
        });
      });

      it("quien no es gerente recibe «sin permiso» en las dos acciones y en la lectura", async () => {
        const g = await nuevo();
        const id = uuid();
        dato(await generarPedidoDeCertificado(d, ctx(g), pedidoDe(g, "pedernalg", id)));
        const otro = ctx(await otraPersona(dueno, g, "ADMINISTRADOR"));
        const sinPermiso = { ok: false, error: { codigo: "SIN_PERMISO" } };
        expect(
          await generarPedidoDeCertificado(
            d,
            otro,
            armarElPedidoDeCertificado(
              valores(g, "pedernalh"),
              uuid(),
              g.mundo.emisor,
              "HOMOLOGACION",
            ),
          ),
        ).toMatchObject(sinPermiso);
        expect(await cargarCertificado(d, otro, armarLaCargaDeCertificado(id, "x"))).toMatchObject(
          sinPermiso,
        );
        expect(
          await estadoDeCertificados(consultas, otro, { emisorId: g.mundo.emisor }),
        ).toMatchObject(sinPermiso);
        expect(
          await filas("select id from certificado_arca where empresa_id = $1", [g.mundo.empresa]),
        ).toHaveLength(1);
      });
    });
  },
);
