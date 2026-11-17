import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cargarCertificado,
  estadoDeCertificados,
  generarPedidoDeCertificado,
  type DependenciasDeAccionesDeCertificadoDeArcaWeb,
  type DependenciasDeCertificadoDeArcaWeb,
} from "../../src/composicion/certificado-de-arca-web";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import { armarWeb } from "../../src/composicion/web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { certificadoDeArca, crearServicios, type ServiciosDePrueba } from "./certificados-apoyo";
import { crearBaseAparte, cuitUnico } from "./entorno";
import {
  crearEscenarioDeConfiguracion,
  otraPersona,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import type { RolDePrueba } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";
import { sufijoUnico } from "./unicos";

/**
 * Las dos acciones del certificado de ARCA con la composición REAL (conexiones y web, base de verdad, roles limitados): generar el
 * pedido (el CSR en PEM, público) y cargar el certificado que ARCA devolvió. Solo el gerente (`certificados.gestionar`). Repetir no
 * duplica (ni otra clave, ni otro certificado). Dos a la vez no se pisan. Cada empresa ve lo suyo. Y nunca sale la clave privada, lo
 * cifrado, la huella ni el PEM del certificado. Los permisos de cada caso de uso y su guard están en `guard-primero-certificados.test.ts`
 * y el comportamiento del dominio en `certificados-*.test.ts`: acá se prueba lo que agrega la web (la forma del pedido, lo que sale y
 * cómo salen los errores). Las autoridades de ARCA nacen en la propia prueba: ninguna es real.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const DIA = 86_400_000;

const uuid = (): string => randomUUID();
const SIN_PERMISO = { ok: false, error: { codigo: "SIN_PERMISO" } };
const INESPERADO = {
  ok: false,
  error: { codigo: "ERROR_INTERNO", referencia: expect.stringMatching(/^PD-/) as string },
};

describe.skipIf(base === null)(
  "fiscal: certificado de ARCA, generar el pedido y cargarlo (web)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let conexiones: Conexiones;
    let servicios: ServiciosDePrueba;
    const registrados: string[] = [];
    /** Con las reglas de la facturación construida y las autoridades de la prueba. */
    let d: DependenciasDeAccionesDeCertificadoDeArcaWeb;
    let consultas: DependenciasDeCertificadoDeArcaWeb;
    /** Con las reglas REALES de empresa: la facturación todavía está «en desarrollo». */
    let dReales: DependenciasDeAccionesDeCertificadoDeArcaWeb;
    /** Con la facturación construida pero SIN autoridades de ARCA (lo que corre hoy en producción). */
    let dSinCadenas: DependenciasDeAccionesDeCertificadoDeArcaWeb;

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
      dReales = { casosDeUso: armarWeb(conexiones).casosDeUsoDeCertificados, respuesta };
      dSinCadenas = {
        casosDeUso: armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION })
          .casosDeUsoDeCertificados,
        respuesta,
      };
    }, 120_000);
    afterAll(async () => {
      await conexiones.transaccionesDeApp().cerrar();
      await dueno.end();
      await propia.destruir();
    });

    const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
      (await dueno.query<T>(texto, p)).rows;
    const certificados = (empresa: string) =>
      filas<{
        id: string;
        estado: string;
        alias: string;
        ambiente: string;
        emisor_id: string;
        huella_sha256: string | null;
        certificado_pem: string | null;
        pedido_pem: string;
        clave_cifrada: Buffer;
      }>(
        `select id, estado, alias, ambiente, emisor_id, huella_sha256, certificado_pem, pedido_pem, clave_cifrada
         from certificado_arca where empresa_id = $1 order by creado_en, id`,
        [empresa],
      );
    const auditorias = (empresa: string, accion?: string) =>
      filas<{ accion: string; actor: string | null; antes: unknown; despues: unknown }>(
        `select accion, actor_persona_id as actor, antes, despues from auditoria_empresa
        where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
        [empresa, accion ?? null],
      );
    /** Una empresa con el módulo de facturación activado de verdad (plan y activación), porque los certificados son de facturación. */
    async function nuevo(rol: RolDePrueba = "GERENTE"): Promise<EscenarioDeConfiguracion> {
      const e = await crearEscenarioDeConfiguracion(dueno, { rol });
      const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
      await asignarPlan(dueno, e.mundo.tenant, version);
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
        [e.mundo.empresa],
      );
      return e;
    }
    const ahora = () => new Date();
    const como = (e: EscenarioDeConfiguracion): ContextoOperativo => e.como(ahora());
    const pedido = (e: EscenarioDeConfiguracion, cambios: Record<string, unknown> = {}) => ({
      id: uuid(),
      emisorId: e.mundo.emisor,
      ambiente: "HOMOLOGACION",
      alias: `pedernal${sufijoUnico()}`,
      cuitTitular: e.mundo.cuit,
      organizacion: "Panadería Zulú SA",
      ...cambios,
    });

    /** Lo que sale en la respuesta: el dato (si salió bien) o el error público. */
    const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: unknown }): T => {
      if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
      return r.dato;
    };
    async function generar(e: EscenarioDeConfiguracion, cambios: Record<string, unknown> = {}) {
      const p = pedido(e, cambios);
      return { p, r: await generarPedidoDeCertificado(d, como(e), p) };
    }
    /** Lo que haría ARCA con el pedido: el certificado de la autoridad del ambiente. */
    const deArca = (
      pedidoPem: string,
      opciones: Parameters<typeof certificadoDeArca>[3] = {},
      ambiente: "HOMOLOGACION" | "PRODUCCION" = "HOMOLOGACION",
    ) => certificadoDeArca(servicios, ambiente, pedidoPem, opciones);

    /** Nada de lo secreto en lo que se muestra: ni la clave privada, ni lo cifrado, ni la huella, ni el certificado. */
    async function sinSecretos(e: EscenarioDeConfiguracion, respuestas: readonly unknown[]) {
      const vistas = JSON.stringify(respuestas);
      expect(vistas).not.toMatch(/PRIVATE KEY/);
      for (const c of await certificados(e.mundo.empresa)) {
        expect(vistas).not.toContain(c.clave_cifrada.toString("hex"));
        expect(vistas).not.toContain(c.clave_cifrada.toString("base64"));
        if (c.huella_sha256 !== null) expect(vistas).not.toContain(c.huella_sha256);
        if (c.certificado_pem !== null) {
          expect(vistas).not.toContain(c.certificado_pem.split("\n")[1] ?? "x".repeat(40));
        }
      }
      const auditadas = JSON.stringify(await auditorias(e.mundo.empresa));
      expect(auditadas).not.toMatch(/PRIVATE KEY|clave_cifrada|BEGIN CERTIFICATE/);
    }

    // ---------------------------------------------------------------------------------------------------------------

    describe("el camino completo", () => {
      it("generar el pedido devuelve el CSR en PEM, y cargar el certificado lo deja vigente; en ningún paso sale la clave, lo cifrado ni la huella", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        const generado = dato(r);
        expect(Object.keys(generado).sort()).toEqual(["certificadoId", "pedidoPem", "yaExistia"]);
        expect(generado.yaExistia).toBe(false);
        expect(generado.certificadoId).toBe(p.id);
        expect(generado.pedidoPem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----\n/);

        const [fila] = await certificados(e.mundo.empresa);
        expect(fila).toMatchObject({
          id: p.id,
          estado: "PEDIDO_GENERADO",
          alias: p.alias,
          ambiente: "HOMOLOGACION",
          emisor_id: e.mundo.emisor,
          pedido_pem: generado.pedidoPem,
        });
        expect(fila?.clave_cifrada.length).toBeGreaterThan(0);
        const pedidos = await auditorias(e.mundo.empresa, "CERTIFICADO_PEDIDO_GENERADO");
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0]).toMatchObject({
          actor: e.persona,
          despues: { estado: "PEDIDO_GENERADO", alias: p.alias, ambiente: "HOMOLOGACION" },
        });

        const estadoDelPedido = dato(
          await estadoDeCertificados(consultas, como(e), { emisorId: e.mundo.emisor }),
        );
        expect(estadoDelPedido[0]).toMatchObject({
          ambiente: "HOMOLOGACION",
          situacion: "PEDIDO_GENERADO",
          certificadoId: p.id,
          alias: p.alias,
        });

        const pem = await deArca(generado.pedidoPem);
        const cargado = await cargarCertificado(d, como(e), {
          certificadoId: p.id,
          certificadoPem: pem,
        });
        const salida = dato(cargado);
        expect(Object.keys(salida).sort()).toEqual(["venceEn", "yaEstaba"]);
        expect(salida.yaEstaba).toBe(false);
        expect(Date.parse(salida.venceEn)).toBeGreaterThan(Date.now() + 300 * DIA);

        const [vigente] = await certificados(e.mundo.empresa);
        expect(vigente).toMatchObject({ id: p.id, estado: "VIGENTE" });
        expect(vigente?.huella_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_CARGADO")).toHaveLength(1);

        const estadoVigente = dato(
          await estadoDeCertificados(consultas, como(e), { emisorId: e.mundo.emisor }),
        );
        expect(estadoVigente[0]).toMatchObject({
          situacion: "VIGENTE",
          certificadoId: p.id,
          vencido: false,
          autorizacion: { estado: "SIN_VERIFICAR" },
          pedidoPendiente: null,
        });
        await sinSecretos(e, [r, cargado]);
        // El pedido (CSR) es público y es lo único que sale; el estado no lo muestra.
        expect(JSON.stringify(estadoVigente)).not.toContain("CERTIFICATE");
      });

      it("cargar otro certificado para el mismo emisor y ambiente deja el anterior reemplazado", async () => {
        const e = await nuevo();
        const primero = await generar(e);
        const pem1 = await deArca(dato(primero.r).pedidoPem);
        dato(
          await cargarCertificado(d, como(e), {
            certificadoId: primero.p.id,
            certificadoPem: pem1,
          }),
        );
        const segundo = await generar(e);
        const pem2 = await deArca(dato(segundo.r).pedidoPem);
        const cargado = dato(
          await cargarCertificado(d, como(e), {
            certificadoId: segundo.p.id,
            certificadoPem: pem2,
          }),
        );
        expect(Object.keys(cargado).sort()).toEqual(["venceEn", "yaEstaba"]);
        const estados = Object.fromEntries(
          (await certificados(e.mundo.empresa)).map((c) => [c.id, c.estado]),
        );
        expect(estados).toEqual({ [primero.p.id]: "REEMPLAZADO", [segundo.p.id]: "VIGENTE" });
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_REEMPLAZADO")).toHaveLength(1);
      });

      it("un pedido mal armado no llega al caso de uso: «revisá los datos marcados» con el campo, y nada se escribe", async () => {
        const e = await nuevo();
        const mal = async (cambios: Record<string, unknown>, campo: string) => {
          expect(await generarPedidoDeCertificado(d, como(e), pedido(e, cambios))).toMatchObject({
            ok: false,
            error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo },
          });
        };
        await mal({ id: "no-es-un-uuid" }, "id");
        await mal({ emisorId: "x" }, "emisorId");
        await mal({ ambiente: "PRUEBAS" }, "ambiente");
        await mal({ alias: 7 }, "alias");
        await mal({ cuitTitular: null }, "cuitTitular");
        await mal({ organizacion: undefined }, "organizacion");
        expect(
          await cargarCertificado(d, como(e), { certificadoId: "x", certificadoPem: "a" }),
        ).toMatchObject({
          ok: false,
          error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "certificadoId" },
        });
        expect(
          await cargarCertificado(d, como(e), { certificadoId: uuid(), certificadoPem: 5 }),
        ).toMatchObject({
          ok: false,
          error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "certificadoPem" },
        });
        expect(await certificados(e.mundo.empresa)).toHaveLength(0);
        expect(await auditorias(e.mundo.empresa)).toHaveLength(0);
      });

      it("la empresa y la persona salen del servidor: lo que el navegador mande de más se descarta", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const { p, r } = await generar(a, { empresaId: b.mundo.empresa, creadoPor: b.persona });
        dato(r);
        expect(await certificados(b.mundo.empresa)).toHaveLength(0);
        const [fila] = await filas<{ empresa_id: string; creado_por: string }>(
          "select empresa_id, creado_por from certificado_arca where id = $1",
          [p.id],
        );
        expect(fila).toEqual({ empresa_id: a.mundo.empresa, creado_por: a.persona });
      });
    });

    // ---------------------------------------------------------------------------------------------------------------

    describe("lo que no sirve se rechaza sin escribir ni mostrar nada", () => {
      it("un dato del pedido que el negocio no acepta (alias, CUIT, organización) sale como error inesperado con referencia: no tiene texto aprobado", async () => {
        const e = await nuevo();
        registrados.length = 0;
        for (const cambios of [
          { alias: "con espacio" },
          { alias: "a".repeat(31) },
          { cuitTitular: "20123456780" },
          { organizacion: "   " },
        ]) {
          expect(await generarPedidoDeCertificado(d, como(e), pedido(e, cambios))).toMatchObject(
            INESPERADO,
          );
        }
        expect(await certificados(e.mundo.empresa)).toHaveLength(0);
        expect(await auditorias(e.mundo.empresa)).toHaveLength(0);
        // El código queda en el registro del servidor, nunca en la respuesta.
        expect(registrados.join("\n")).toMatch(/ALIAS_INVALIDO/);
      });

      it("un emisor inactivo y uno que no existe: lo primero tiene su texto aprobado, lo segundo sale inesperado; en ningún caso se escribe", async () => {
        const e = await nuevo();
        expect(
          await generarPedidoDeCertificado(d, como(e), pedido(e, { emisorId: uuid() })),
        ).toMatchObject(INESPERADO);
        // El principal no puede estar inactivo (lo impide la base): se prueba con uno secundario.
        const [secundario] = await filas<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [e.mundo.empresa, cuitUnico()],
        );
        await dueno.query("update emisor set activo = false where id = $1", [secundario?.id]);
        expect(
          await generarPedidoDeCertificado(d, como(e), pedido(e, { emisorId: secundario?.id })),
        ).toMatchObject({ ok: false, error: { codigo: "FISCAL_EMISOR_INACTIVO" } });
        expect(await certificados(e.mundo.empresa)).toHaveLength(0);
        expect(await auditorias(e.mundo.empresa)).toHaveLength(0);
      });

      it("un certificado que no es el del pedido (otra clave, otro titular, vencido o de otra cadena) no se carga: el pedido sigue pendiente", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        // El otro pedido va a producción: uno nuevo del mismo ambiente anularía a este (D-92).
        const otro = await generar(e, { ambiente: "PRODUCCION" });
        const pedidoPem = dato(r).pedidoPem;
        const casos: [string, string, string][] = [
          // El certificado que ARCA hizo para OTRO pedido (otra clave).
          [
            "NO_CORRESPONDE_A_LA_CLAVE",
            await deArca(dato(otro.r).pedidoPem, {}, "PRODUCCION"),
            p.id,
          ],
          [
            "NO_CORRESPONDE_AL_TITULAR",
            await deArca(pedidoPem, { numeroDeSerie: "CUIT 20111111112" }),
            p.id,
          ],
          [
            "CERTIFICADO_VENCIDO",
            await deArca(pedidoPem, {
              noAntes: new Date(Date.now() - 400 * DIA),
              noDespues: new Date(Date.now() - DIA),
            }),
            p.id,
          ],
          // La autoridad de PRODUCCION no sirve para un pedido de HOMOLOGACION (cada ambiente confía solo en su cadena).
          ["CADENA_NO_CONFIABLE", await deArca(pedidoPem, {}, "PRODUCCION"), p.id],
          ["CERTIFICADO_ILEGIBLE", "esto no es un certificado", p.id],
        ];
        for (const [error, pem, id] of casos) {
          registrados.length = 0;
          const respuesta = await cargarCertificado(d, como(e), {
            certificadoId: id,
            certificadoPem: pem,
          });
          expect(respuesta, error).toMatchObject(INESPERADO);
          expect(JSON.stringify(respuesta)).not.toContain(error);
          expect(registrados.join("\n"), error).toContain(error);
        }
        expect((await certificados(e.mundo.empresa)).map((c) => c.estado)).toEqual([
          "PEDIDO_GENERADO",
          "PEDIDO_GENERADO",
        ]);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_CARGADO")).toHaveLength(0);
      });

      it("una clave privada pegada por error nunca se guarda ni se repite", async () => {
        const e = await nuevo();
        const { p } = await generar(e);
        const pegada =
          "-----BEGIN PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUA==\n-----END PRIVATE KEY-----\n";
        registrados.length = 0;
        const r = await cargarCertificado(d, como(e), {
          certificadoId: p.id,
          certificadoPem: pegada,
        });
        expect(r).toMatchObject(INESPERADO);
        expect(JSON.stringify([r, registrados])).not.toContain("QUJDREVGR0hJSktMTU5PUA");
        expect((await certificados(e.mundo.empresa))[0]?.certificado_pem).toBeNull();
      });

      it("hoy, sin las cadenas de confianza de ARCA en la composición, ninguna carga cierra: falla cerrado y el pedido sigue pendiente", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        const pem = await deArca(dato(r).pedidoPem);
        registrados.length = 0;
        const sin = await cargarCertificado(dSinCadenas, como(e), {
          certificadoId: p.id,
          certificadoPem: pem,
        });
        expect(sin).toMatchObject(INESPERADO);
        expect(registrados.join("\n")).toContain("CADENA_NO_CONFIABLE");
        expect((await certificados(e.mundo.empresa))[0]?.estado).toBe("PEDIDO_GENERADO");
      });

      it("un pedido que no existe no se puede cargar", async () => {
        const e = await nuevo();
        const { r } = await generar(e);
        const pem = await deArca(dato(r).pedidoPem);
        expect(
          await cargarCertificado(d, como(e), { certificadoId: uuid(), certificadoPem: pem }),
        ).toMatchObject(INESPERADO);
      });
    });

    // ---------------------------------------------------------------------------------------------------------------

    describe("repetir no duplica", () => {
      it("el mismo pedido con el mismo id devuelve el mismo pedido, «ya existía», sin otra clave ni otro certificado ni otra auditoría", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        const primero = dato(r);
        const [antes] = await certificados(e.mundo.empresa);

        const repetido = await generarPedidoDeCertificado(d, como(e), p);
        expect(dato(repetido)).toEqual({ ...primero, yaExistia: true });
        const filasDespues = await certificados(e.mundo.empresa);
        expect(filasDespues).toHaveLength(1);
        // La clave cifrada no se regeneró.
        expect(filasDespues[0]?.clave_cifrada.equals(antes?.clave_cifrada ?? Buffer.alloc(0))).toBe(
          true,
        );
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_PEDIDO_GENERADO")).toHaveLength(1);
        await sinSecretos(e, [r, repetido]);
      });

      it("la misma clave de intento con otro contenido es un pedido repetido con otros datos: no se pisa lo que ya existe", async () => {
        const e = await nuevo();
        const { p } = await generar(e);
        const otroAlias = await generarPedidoDeCertificado(d, como(e), {
          ...p,
          alias: "otroalias",
        });
        expect(otroAlias).toMatchObject({ ok: false, error: { codigo: "FISCAL_PEDIDO_REPETIDO" } });
        const otroAmbiente = await generarPedidoDeCertificado(d, como(e), {
          ...p,
          ambiente: "PRODUCCION",
        });
        expect(otroAmbiente).toMatchObject({
          ok: false,
          error: { codigo: "FISCAL_PEDIDO_REPETIDO" },
        });
        const filasDespues = await certificados(e.mundo.empresa);
        expect(filasDespues).toHaveLength(1);
        expect(filasDespues[0]).toMatchObject({ alias: p.alias, ambiente: "HOMOLOGACION" });
      });

      it("el mismo certificado cargado dos veces: la segunda dice «ya estaba», con el mismo vencimiento, sin escribir ni auditar", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        const pem = await deArca(dato(r).pedidoPem);
        const entrada = { certificadoId: p.id, certificadoPem: pem };
        const primero = dato(await cargarCertificado(d, como(e), entrada));
        const [antes] = await certificados(e.mundo.empresa);

        const repetido = dato(await cargarCertificado(d, como(e), entrada));
        expect(repetido).toEqual({ venceEn: primero.venceEn, yaEstaba: true });
        // Pegado con otros saltos de línea y blancos (lo que hace un archivo de ARCA): es el mismo certificado.
        const conOtrosSaltos = dato(
          await cargarCertificado(d, como(e), {
            certificadoId: p.id,
            certificadoPem: `\n  ${pem.replace(/\n/g, "\r\n")}  \n`,
          }),
        );
        expect(conOtrosSaltos).toEqual({ venceEn: primero.venceEn, yaEstaba: true });
        expect(await certificados(e.mundo.empresa)).toHaveLength(1);
        expect((await certificados(e.mundo.empresa))[0]?.huella_sha256).toBe(antes?.huella_sha256);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_CARGADO")).toHaveLength(1);
      });

      it("otro certificado sobre un pedido que ya tiene el suyo no lo pisa", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        const pedidoPem = dato(r).pedidoPem;
        dato(
          await cargarCertificado(d, como(e), {
            certificadoId: p.id,
            certificadoPem: await deArca(pedidoPem),
          }),
        );
        const [antes] = await certificados(e.mundo.empresa);
        // Otro certificado del mismo pedido (otra vigencia, otra huella).
        const otro = await deArca(pedidoPem, { noDespues: new Date(Date.now() + 100 * DIA) });
        expect(
          await cargarCertificado(d, como(e), { certificadoId: p.id, certificadoPem: otro }),
        ).toMatchObject(INESPERADO);
        expect((await certificados(e.mundo.empresa))[0]?.huella_sha256).toBe(antes?.huella_sha256);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_CARGADO")).toHaveLength(1);
      });
    });

    // ---------------------------------------------------------------------------------------------------------------

    describe("dos a la vez sobre lo mismo", () => {
      it("el mismo pedido dos veces a la vez (doble clic): los dos salen bien con el mismo pedido, uno escribe y el otro es «ya existía»", async () => {
        const e = await nuevo();
        const p = pedido(e);
        const [x, y] = await Promise.all([
          generarPedidoDeCertificado(d, como(e), p),
          generarPedidoDeCertificado(d, como(e), p),
        ]);
        expect([x, y].every((r) => r.ok)).toBe(true);
        expect([x, y].filter((r) => r.ok && r.dato.yaExistia)).toHaveLength(1);
        expect(dato(x).pedidoPem).toBe(dato(y).pedidoPem);
        expect(dato(x).certificadoId).toBe(dato(y).certificadoId);
        expect(await certificados(e.mundo.empresa)).toHaveLength(1);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_PEDIDO_GENERADO")).toHaveLength(1);
        await sinSecretos(e, [x, y]);
      });

      it("dos pedidos distintos para el mismo emisor y ambiente (dos pestañas): cada uno con su clave y su auditoría, y queda pendiente uno solo: el otro, descartado (D-92)", async () => {
        const e = await nuevo();
        const [x, y] = await Promise.all([
          generarPedidoDeCertificado(d, como(e), pedido(e)),
          generarPedidoDeCertificado(d, como(e), pedido(e)),
        ]);
        expect([x, y].every((r) => r.ok)).toBe(true);
        expect([x, y].filter((r) => r.ok && r.dato.yaExistia)).toHaveLength(0);
        expect(dato(x).pedidoPem).not.toBe(dato(y).pedidoPem);
        const filasDespues = await certificados(e.mundo.empresa);
        expect(filasDespues.map((c) => c.estado).sort()).toEqual(["DESCARTADO", "PEDIDO_GENERADO"]);
        expect(
          filasDespues[0]?.clave_cifrada.equals(filasDespues[1]?.clave_cifrada ?? Buffer.alloc(0)),
        ).toBe(false);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_PEDIDO_GENERADO")).toHaveLength(2);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_PEDIDO_DESCARTADO")).toHaveLength(1);
      });

      it("el mismo certificado cargado dos veces a la vez: uno lo carga y el otro es «ya estaba»; un solo vigente y una sola auditoría", async () => {
        const e = await nuevo();
        const { p, r } = await generar(e);
        const entrada = { certificadoId: p.id, certificadoPem: await deArca(dato(r).pedidoPem) };
        const [x, y] = await Promise.all([
          cargarCertificado(d, como(e), entrada),
          cargarCertificado(d, como(e), entrada),
        ]);
        expect([x, y].every((r) => r.ok)).toBe(true);
        expect([x, y].filter((r) => r.ok && r.dato.yaEstaba)).toHaveLength(1);
        expect(dato(x).venceEn).toBe(dato(y).venceEn);
        expect((await certificados(e.mundo.empresa)).map((c) => c.estado)).toEqual(["VIGENTE"]);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_CARGADO")).toHaveLength(1);
      });

      it("un pedido nuevo anula al anterior: el certificado del primero ya no se carga (sin texto aprobado: inesperado) y el del segundo sí; un solo vigente", async () => {
        const e = await nuevo();
        const uno = await generar(e);
        const dos = await generar(e);
        const [pemUno, pemDos] = await Promise.all([
          deArca(dato(uno.r).pedidoPem),
          deArca(dato(dos.r).pedidoPem),
        ]);
        registrados.length = 0;
        expect(
          await cargarCertificado(d, como(e), { certificadoId: uno.p.id, certificadoPem: pemUno }),
        ).toMatchObject(INESPERADO);
        expect(registrados.join("\n")).toContain("PEDIDO_NO_PENDIENTE");
        expect(
          (await cargarCertificado(d, como(e), { certificadoId: dos.p.id, certificadoPem: pemDos }))
            .ok,
        ).toBe(true);
        expect((await certificados(e.mundo.empresa)).map((c) => c.estado)).toEqual([
          "DESCARTADO",
          "VIGENTE",
        ]);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_CARGADO")).toHaveLength(1);
        expect(await auditorias(e.mundo.empresa, "CERTIFICADO_REEMPLAZADO")).toHaveLength(0);
      });
    });

    // ---------------------------------------------------------------------------------------------------------------

    describe("cada empresa, lo suyo", () => {
      it("otra empresa no puede cargar el certificado de un pedido ajeno ni pedir un certificado para un emisor ajeno, y no se entera de si existen", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const { p, r } = await generar(a);
        const pem = await deArca(dato(r).pedidoPem);

        // Cargar en un pedido de A desde B: se dice igual que un pedido que no existe.
        const ajeno = await cargarCertificado(d, como(b), {
          certificadoId: p.id,
          certificadoPem: pem,
        });
        expect(ajeno).toMatchObject(INESPERADO);
        expect(
          await cargarCertificado(d, como(b), { certificadoId: uuid(), certificadoPem: pem }),
        ).toEqual({
          ...ajeno,
          error: {
            ...(ajeno as { error: object }).error,
            referencia: expect.any(String) as string,
          },
        });
        // Pedir un pedido para el emisor de A desde B: se dice igual que un emisor que no existe.
        expect(await generarPedidoDeCertificado(d, como(b), pedido(a))).toMatchObject(INESPERADO);

        expect((await certificados(a.mundo.empresa)).map((c) => c.estado)).toEqual([
          "PEDIDO_GENERADO",
        ]);
        expect(await certificados(b.mundo.empresa)).toHaveLength(0);
        expect(await auditorias(b.mundo.empresa)).toHaveLength(0);
      });

      it("el mismo id de pedido en otra empresa no da pistas de la primera: no se pisa ni se lee su pedido", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const { p, r } = await generar(a);
        const intento = await generarPedidoDeCertificado(d, como(b), { ...pedido(b), id: p.id });
        expect(JSON.stringify(intento)).not.toContain(dato(r).pedidoPem.slice(40, 80));
        expect(intento.ok).toBe(false);
        const [fila] = await filas<{ empresa_id: string }>(
          "select empresa_id from certificado_arca where id = $1",
          [p.id],
        );
        expect(fila?.empresa_id).toBe(a.mundo.empresa);
        expect(await certificados(b.mundo.empresa)).toHaveLength(0);
      });

      it("cada empresa ve en el estado solo sus certificados", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const { p } = await generar(a);
        const deA = dato(
          await estadoDeCertificados(consultas, como(a), { emisorId: a.mundo.emisor }),
        );
        expect(deA[0]).toMatchObject({ situacion: "PEDIDO_GENERADO", certificadoId: p.id });
        const deB = dato(
          await estadoDeCertificados(consultas, como(b), { emisorId: b.mundo.emisor }),
        );
        expect(deB.map((s) => s.situacion)).toEqual(["FALTA_CARGAR", "FALTA_CARGAR"]);
      });
    });

    // ---------------------------------------------------------------------------------------------------------------

    describe("solo el gerente", () => {
      it("administrador y operador reciben SIN_PERMISO en las dos acciones y no se escribe ni se audita nada", async () => {
        const g = await nuevo();
        const { p, r } = await generar(g);
        const pem = await deArca(dato(r).pedidoPem);
        const antes = {
          filas: await certificados(g.mundo.empresa),
          auditorias: (await auditorias(g.mundo.empresa)).length,
        };
        for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
          const c = como(await otraPersona(dueno, g, rol));
          expect(await generarPedidoDeCertificado(d, c, pedido(g))).toMatchObject(SIN_PERMISO);
          expect(
            await cargarCertificado(d, c, { certificadoId: p.id, certificadoPem: pem }),
          ).toMatchObject(SIN_PERMISO);
        }
        expect((await certificados(g.mundo.empresa)).map((c) => c.id)).toEqual(
          antes.filas.map((c) => c.id),
        );
        expect((await certificados(g.mundo.empresa))[0]?.estado).toBe("PEDIDO_GENERADO");
        expect((await auditorias(g.mundo.empresa)).length).toBe(antes.auditorias);
      });

      it("con las reglas reales de empresa (facturación disponible): sin activarla en la empresa es MODULO_NO_ACTIVO y nada se escribe; activada, se genera el pedido", async () => {
        const sinActivar = await crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });
        expect(
          await generarPedidoDeCertificado(dReales, como(sinActivar), pedido(sinActivar)),
        ).toMatchObject({
          ok: false,
          error: { codigo: "MODULO_NO_ACTIVO" },
        });
        expect(await certificados(sinActivar.mundo.empresa)).toHaveLength(0);
        const e = await nuevo();
        expect(await generarPedidoDeCertificado(dReales, como(e), pedido(e))).toMatchObject({
          ok: true,
        });
        expect(await certificados(e.mundo.empresa)).toHaveLength(1);
      });
    });
  },
);
