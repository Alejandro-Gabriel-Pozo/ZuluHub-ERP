import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  activarPuntoDeVenta,
  confirmarDatosFiscales,
  crearPuntoDeVenta,
  datosFiscalesDelEmisor,
  desactivarPuntoDeVenta,
  empezarCorreccionDeDatosFiscales,
  editarPuntoDeVenta,
  estadoDeLaConfiguracionFiscal,
  guardarBorradorDeDatosFiscales,
  puntosDeVentaDelEmisor,
  type DependenciasDeConfiguracionFiscalWeb,
} from "../../src/composicion/configuracion-fiscal-web";
import { estadoDeCertificados } from "../../src/composicion/certificado-de-arca-web";
import { armarWeb } from "../../src/composicion/web";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearBaseAparte } from "./entorno";
import {
  crearEscenarioDeConfiguracion,
  otraPersona,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";
import {
  crearDomicilio,
  crearPuntoDeVenta as insertarPuntoDeVenta,
  crearSerie,
} from "./fiscal-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import type { RolDePrueba } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * La pantalla de Configuración fiscal (D-43) con la composición REAL (conexiones y web, base de verdad, roles limitados) y las reglas
 * REALES de empresa (la facturación está «en desarrollo»: la configuración no depende de ella). Solo el gerente; administrador y operador,
 * `SIN_PERMISO` sin escribir nada. Cada empresa ve lo suyo. Repetir no duplica. Dos a la vez no se pisan. Ingresos Brutos no existe
 * para la pantalla (D-45). Los permisos de cada caso de uso y su guard están en `fiscal-configuracion-acceso.test.ts`: acá se prueba
 * lo que agrega la web (la forma del pedido, lo que se muestra y cómo salen los errores).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const DIA = 86_400_000;

const uuid = (): string => randomUUID();
const SIN_PERMISO = { ok: false, error: { codigo: "SIN_PERMISO" } };

/** Los campos de un domicilio nuevo, como los manda la pantalla. */
const domicilioNuevo = (cambios: Record<string, unknown> = {}) => ({
  tipo: "NUEVO",
  id: uuid(),
  calle: "Av. Corrientes",
  numero: "1234",
  piso: null,
  departamento: null,
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "S2000",
  ...cambios,
});

describe.skipIf(base === null)("fiscal: pantalla de Configuración fiscal (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  const registrados: string[] = [];
  let d: DependenciasDeConfiguracionFiscalWeb;
  let dConFacturacion: DependenciasDeConfiguracionFiscalWeb;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
    const respuesta = { registrar: (x: string) => registrados.push(x) };
    // Las reglas REALES: la facturación todavía no se puede usar y la configuración igual funciona.
    const web = armarWeb(conexiones);
    d = {
      casosDeUso: web.casosDeUsoDeConfiguracionFiscal,
      consultas: web.consultasDeFacturacion,
      respuesta,
    };
    // Con el módulo construido, para lo que SÍ es de facturación (el estado de los certificados).
    const webConFacturacion = armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION });
    dConFacturacion = {
      casosDeUso: webConFacturacion.casosDeUsoDeConfiguracionFiscal,
      consultas: webConFacturacion.consultasDeFacturacion,
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
  const cuenta = async (tabla: string, empresa: string) =>
    (
      await filas<{ n: number }>(`select count(*)::int as n from ${tabla} where empresa_id = $1`, [
        empresa,
      ])
    )[0]?.n;
  const auditorias = (empresa: string, accion?: string) =>
    filas<{ accion: string; actor: string | null; antes: unknown; despues: unknown }>(
      `select accion, actor_persona_id as actor, antes, despues from auditoria_empresa
        where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
      [empresa, accion ?? null],
    );
  const nuevo = (rol: RolDePrueba = "GERENTE") => crearEscenarioDeConfiguracion(dueno, { rol });
  /** Una empresa con el módulo de facturación activado de verdad (plan y activación), para lo que es de facturación. */
  async function nuevoConFacturacion(rol: RolDePrueba = "GERENTE") {
    const e = await nuevo(rol);
    const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
    await asignarPlan(dueno, e.mundo.tenant, version);
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [e.mundo.empresa],
    );
    return e;
  }
  const ahora = () => new Date();
  async function conCertificado(
    e: EscenarioDeConfiguracion,
    estado: "PEDIDO_GENERADO" | "VIGENTE",
  ) {
    const { rows } = await dueno.query<{ id: string }>(
      `insert into certificado_arca (empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada, clave_nonce,
                                     clave_etiqueta, clave_kid, creado_por)
       values ($1, $2, 'HOMOLOGACION', 'pedernal1', $3, 'PEDIDO-SECRETO', '\\x01', '\\x000000000000000000000000',
               '\\x00000000000000000000000000000000', 'kid-1', $4) returning id`,
      [e.mundo.empresa, e.mundo.emisor, e.mundo.cuit, e.persona],
    );
    const id = (rows[0] as { id: string }).id;
    if (estado === "VIGENTE") {
      await dueno.query(
        `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'PEM-SECRETO', huella_sha256 = $2, vence_en = $3 where id = $1`,
        [id, "cd".repeat(32), new Date(Date.now() + 60 * DIA)],
      );
    }
    return id;
  }

  /** Lo que sale en la respuesta: el dato (si salió bien) o el error público. */
  const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: unknown }): T => {
    if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const completos = (cambios: Record<string, unknown> = {}) => ({
    razonSocial: "Panadería Zulu SA",
    condicionIva: "RESPONSABLE_INSCRIPTO",
    inicioActividades: "2020-03-01",
    domicilio: domicilioNuevo(),
    ...cambios,
  });
  async function guardar(e: EscenarioDeConfiguracion, cambios: Record<string, unknown> = {}) {
    const borradorId = (cambios["borradorId"] as string | undefined) ?? uuid();
    const r = await guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
      emisorId: e.mundo.emisor,
      borradorId,
      ...completos(),
      ...cambios,
    });
    return { borradorId, r };
  }

  // ---------------------------------------------------------------------------------------------------------------

  describe("la lista de lo que falta", () => {
    it("una empresa recién creada: nada cargado, sin puntos de venta y sin certificados; el emisor es el principal", async () => {
      const e = await nuevo();
      expect(dato(await estadoDeLaConfiguracionFiscal(d, e.como(ahora())))).toEqual({
        emisorId: e.mundo.emisor,
        datosFiscales: { estado: "SIN_CARGAR" },
        puntosDeVenta: { estado: "SIN_PUNTOS", total: 0, activos: 0, ambientesEnUso: [] },
        certificados: [
          { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
          { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
        ],
      });
    });

    it("sigue el camino completo: borrador, confirmado, punto de venta sin activar, activo y certificado", async () => {
      const e = await nuevo();
      const lista = async () => dato(await estadoDeLaConfiguracionFiscal(d, e.como(ahora())));

      const { borradorId, r } = await guardar(e);
      const guardado = dato(r) as { version: number };
      expect((await lista()).datosFiscales.estado).toBe("BORRADOR");

      dato(
        await confirmarDatosFiscales(d, e.como(ahora()), {
          emisorId: e.mundo.emisor,
          borradorId,
          versionEsperada: guardado.version,
          motivo: "Alta inicial",
        }),
      );
      expect((await lista()).datosFiscales.estado).toBe("VIGENTES");

      const pv = uuid();
      dato(
        await crearPuntoDeVenta(d, e.como(ahora()), {
          id: pv,
          emisorId: e.mundo.emisor,
          sucursalId: e.mundo.sucursal,
          numero: 1,
          domicilio: domicilioNuevo(),
        }),
      );
      expect((await lista()).puntosDeVenta).toEqual({
        estado: "SIN_ACTIVOS",
        total: 1,
        activos: 0,
        ambientesEnUso: [],
      });
      dato(await activarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: pv }));
      expect((await lista()).puntosDeVenta).toEqual({
        estado: "CON_ACTIVOS",
        total: 1,
        activos: 1,
        ambientesEnUso: ["HOMOLOGACION"],
      });

      // Un pedido de certificado y, después, uno vigente que vence en 90 días (cargado a mano en la base: la carga real necesita las
      // cadenas de ARCA, que todavía no están).
      const vence = new Date(Date.now() + 90 * DIA);
      const cert = { id: await conCertificado(e, "PEDIDO_GENERADO") };
      expect((await lista()).certificados[0]).toMatchObject({
        situacion: "PEDIDO_GENERADO",
        venceEn: null,
      });
      await dueno.query(
        `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'PEM-SECRETO', huella_sha256 = $2, vence_en = $3 where id = $1`,
        [cert.id, "ab".repeat(32), vence],
      );
      const final = await lista();
      expect(final.certificados).toEqual([
        {
          ambiente: "HOMOLOGACION",
          situacion: "VIGENTE",
          venceEn: vence.toISOString(),
          vencido: false,
        },
        { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
      ]);
      expect(JSON.stringify(final)).not.toMatch(/SECRETO|abab|pedernal1|clave|kid-1/);
    });

    it("lo que rige gana sobre un borrador nuevo que se está editando", async () => {
      const e = await nuevo();
      const { borradorId, r } = await guardar(e);
      dato(
        await confirmarDatosFiscales(d, e.como(ahora()), {
          emisorId: e.mundo.emisor,
          borradorId,
          versionEsperada: (dato(r) as { version: number }).version,
          motivo: "Alta",
        }),
      );
      // Un segundo borrador (para corregir) no tapa la versión que rige.
      dato((await guardar(e)).r);
      const lista = dato(await estadoDeLaConfiguracionFiscal(d, e.como(ahora())));
      expect(lista.datosFiscales.estado).toBe("VIGENTES");
    });

    it("cada empresa ve lo suyo: los puntos de venta y los datos de otra no cuentan", async () => {
      const a = await nuevo();
      const b = await nuevo();
      await insertarPuntoDeVenta(dueno, b.mundo, { numero: 1, activo: true });
      dato((await guardar(b)).r);
      expect(dato(await estadoDeLaConfiguracionFiscal(d, a.como(ahora())))).toMatchObject({
        emisorId: a.mundo.emisor,
        datosFiscales: { estado: "SIN_CARGAR" },
        puntosDeVenta: { estado: "SIN_PUNTOS", total: 0 },
      });
    });

    it("solo el gerente la ve: el administrador y el operador reciben SIN_PERMISO", async () => {
      const g = await nuevo();
      for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
        const otra = await otraPersona(dueno, g, rol);
        expect(await estadoDeLaConfiguracionFiscal(d, otra.como(ahora()))).toMatchObject(
          SIN_PERMISO,
        );
      }
      expect(await estadoDeLaConfiguracionFiscal(d, (await nuevo()).como(ahora()))).toMatchObject({
        ok: true,
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("datos fiscales: ver, guardar a mano y confirmar", () => {
    it("guardar crea el borrador con el domicilio, audita en la misma transacción y la pantalla lo vuelve a leer", async () => {
      const e = await nuevo();
      const antes = (await auditorias(e.mundo.empresa)).length;
      const { borradorId, r } = await guardar(e, { razonSocial: "  Zulu SA  " });
      expect(dato(r)).toEqual({ borradorId, version: 1, yaEstaba: false });
      const auditoria = await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.actor).toBe(e.persona);
      expect((await auditorias(e.mundo.empresa)).length).toBe(antes + 1);

      const leido = dato(
        await datosFiscalesDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(leido.vigente).toBeNull();
      expect(leido.borrador).toMatchObject({
        id: borradorId,
        version: 1,
        razonSocial: "Zulu SA",
        condicionIva: "RESPONSABLE_INSCRIPTO",
        inicioActividades: "2020-03-01",
        domicilio: {
          calle: "Av. Corrientes",
          numero: "1234",
          localidad: "Rosario",
          provincia: "AR-S",
        },
      });
    });

    it("un borrador parcial vuelve con lo que ya tiene cargado y nulo en lo que falta", async () => {
      const e = await nuevo();
      dato(
        await guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
          emisorId: e.mundo.emisor,
          borradorId: uuid(),
          razonSocial: "Zulu",
        }),
      );
      const leido = dato(
        await datosFiscalesDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(leido.borrador).toMatchObject({
        razonSocial: "Zulu",
        condicionIva: null,
        domicilio: null,
        inicioActividades: null,
      });
    });

    it("D-45: Ingresos Brutos se descarta aunque el pedido lo traiga: la base lo guarda vacío y nada lo muestra", async () => {
      const e = await nuevo();
      const { borradorId, r } = await guardar(e, {
        iibbNumero: "902-123456-7",
        iibbCondicion: "LOCAL",
      });
      const { version } = dato(r) as { version: number };
      dato(
        await confirmarDatosFiscales(d, e.como(ahora()), {
          emisorId: e.mundo.emisor,
          borradorId,
          versionEsperada: version,
          motivo: "Alta",
        }),
      );
      const [fila] = await filas<{ iibb_numero: string | null; iibb_condicion: string | null }>(
        "select iibb_numero, iibb_condicion from datos_fiscales where id = $1",
        [borradorId],
      );
      expect(fila).toEqual({ iibb_numero: null, iibb_condicion: null });
      const leido = await datosFiscalesDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor });
      expect(JSON.stringify(leido)).not.toMatch(/[iI]ibb|902-123456/);
      const audit = JSON.stringify(await auditorias(e.mundo.empresa));
      expect(audit).not.toContain("902-123456");
    });

    it("repetir el guardado (doble clic, reintento de red): «ya estaba», sin escribir ni auditar otra vez", async () => {
      const e = await nuevo();
      const borradorId = uuid();
      const pedido = {
        emisorId: e.mundo.emisor,
        borradorId,
        razonSocial: "Zulu",
        inicioActividades: "2020-03-01",
      };
      expect(dato(await guardarBorradorDeDatosFiscales(d, e.como(ahora()), pedido))).toMatchObject({
        yaEstaba: false,
      });
      expect(dato(await guardarBorradorDeDatosFiscales(d, e.como(ahora()), pedido))).toEqual({
        borradorId,
        version: 1,
        yaEstaba: true,
      });
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(1);
      expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(1);
    });

    it("cambiar un borrador con la versión que vio la pantalla funciona; con una vieja, no pisa lo del otro", async () => {
      const e = await nuevo();
      const { borradorId } = await guardar(e);
      const base = { emisorId: e.mundo.emisor, borradorId };
      expect(
        dato(
          await guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
            ...base,
            versionEsperada: 1,
            razonSocial: "Nueva SA",
          }),
        ),
      ).toMatchObject({ version: 2, yaEstaba: false });
      // La otra pestaña todavía tiene la versión 1.
      const vieja = await guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
        ...base,
        versionEsperada: 1,
        razonSocial: "Otra SA",
      });
      expect(vieja).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" },
      });
      const [fila] = await filas<{ razon_social: string; version: number }>(
        "select razon_social, version from datos_fiscales where id = $1",
        [borradorId],
      );
      expect(fila).toEqual({ razon_social: "Nueva SA", version: 2 });
    });

    it.each([
      ["razón social vacía", { razonSocial: "   " }, "razonSocial"],
      ["condición de IVA que no existe", { condicionIva: "CONSUMIDOR_FINAL" }, "condicionIva"],
      [
        "inicio de actividades que no es una fecha",
        { inicioActividades: "2026-02-30" },
        "inicioActividades",
      ],
      ["domicilio sin calle", { domicilio: domicilioNuevo({ calle: "  " }) }, "domicilio.calle"],
      [
        "domicilio con una provincia que no existe",
        { domicilio: domicilioNuevo({ provincia: "AR-ZZ" }) },
        "domicilio.provincia",
      ],
      [
        "domicilio con un número que no es número",
        { domicilio: domicilioNuevo({ numero: "doce" }) },
        "domicilio.numero",
      ],
    ])("%s: datos inválidos del campo, sin escribir nada", async (_caso, cambios, campo) => {
      const e = await nuevo();
      const { r } = await guardar(e, cambios);
      expect(r).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo },
      });
      expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(0);
      expect(await cuenta("domicilio", e.mundo.empresa)).toBe(0);
      expect(await auditorias(e.mundo.empresa)).toHaveLength(0);
    });

    it("confirmar con obligatorios sin cargar: datos inválidos del primer campo que falta, sin confirmar", async () => {
      const e = await nuevo();
      const borradorId = uuid();
      dato(
        await guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
          emisorId: e.mundo.emisor,
          borradorId,
          condicionIva: "MONOTRIBUTO",
        }),
      );
      const r = await confirmarDatosFiscales(d, e.como(ahora()), {
        emisorId: e.mundo.emisor,
        borradorId,
        versionEsperada: 1,
        motivo: "Alta",
      });
      expect(r).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "razonSocial" },
      });
      const [fila] = await filas<{ estado: string }>(
        "select estado from datos_fiscales where id = $1",
        [borradorId],
      );
      expect(fila?.estado).toBe("BORRADOR");
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toHaveLength(0);
    });

    it("confirmar sin motivo o con una versión vieja: cada uno su error y nada confirmado", async () => {
      const e = await nuevo();
      const { borradorId, r } = await guardar(e);
      const { version } = dato(r) as { version: number };
      const base = { emisorId: e.mundo.emisor, borradorId, versionEsperada: version };
      expect(
        await confirmarDatosFiscales(d, e.como(ahora()), { ...base, motivo: "  " }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_MOTIVO_INVALIDO", campo: "motivo" },
      });
      expect(
        await confirmarDatosFiscales(d, e.como(ahora()), {
          ...base,
          versionEsperada: version + 5,
          motivo: "Alta",
        }),
      ).toMatchObject({ ok: false, error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } });
      const [fila] = await filas<{ estado: string }>(
        "select estado from datos_fiscales where id = $1",
        [borradorId],
      );
      expect(fila?.estado).toBe("BORRADOR");
    });

    it("confirmar rige desde ya si no se dice otra cosa; repetirlo da «ya estaba» con el mismo número y no audita de nuevo", async () => {
      const e = await nuevo();
      const { borradorId, r } = await guardar(e);
      const pedido = {
        emisorId: e.mundo.emisor,
        borradorId,
        versionEsperada: (dato(r) as { version: number }).version,
        motivo: "Alta inicial",
      };
      const contexto = e.como(new Date());
      const primera = dato(await confirmarDatosFiscales(d, contexto, pedido));
      expect(primera).toMatchObject({ borradorId, numero: 1, yaEstaba: false });
      expect(primera.vigenteDesde).toBe(contexto.ahora.toISOString());
      expect(dato(await confirmarDatosFiscales(d, e.como(new Date()), pedido))).toEqual({
        ...primera,
        yaEstaba: true,
      });
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toHaveLength(1);
      const leido = dato(
        await datosFiscalesDelEmisor(d, e.como(new Date(Date.now() + 1000)), {
          emisorId: e.mundo.emisor,
        }),
      );
      expect(leido.vigente).toMatchObject({
        id: borradorId,
        numero: 1,
        razonSocial: "Panadería Zulu SA",
      });
      expect(leido.borrador).toBeNull();
    });

    it.each([
      ["futuro", () => new Date(Date.now() + 30 * DIA).toISOString()],
      ["pasado", () => new Date(Date.now() - 2 * DIA).toISOString()],
    ])(
      "D-61: un «rige desde» %s que mande el navegador se descarta: rige desde ya con el reloj del servidor y la pantalla lo ve vigente",
      async (_caso, instante) => {
        const e = await nuevo();
        const { borradorId, r } = await guardar(e);
        const contexto = e.como(new Date());
        const confirmada = dato(
          await confirmarDatosFiscales(d, contexto, {
            emisorId: e.mundo.emisor,
            borradorId,
            versionEsperada: (dato(r) as { version: number }).version,
            motivo: "Cambio de domicilio",
            vigenteDesde: instante(),
          }),
        );
        expect(confirmada.vigenteDesde).toBe(contexto.ahora.toISOString());
        const [fila] = await filas<{ vigente_desde: Date }>(
          "select vigente_desde from datos_fiscales where id = $1",
          [borradorId],
        );
        expect(fila?.vigente_desde.toISOString()).toBe(contexto.ahora.toISOString());
        expect(
          dato(await estadoDeLaConfiguracionFiscal(d, e.como(ahora()))).datosFiscales.estado,
        ).toBe("VIGENTES");
        expect(
          dato(await datosFiscalesDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }))
            .vigente,
        ).toMatchObject({ id: borradorId, numero: 1 });
      },
    );

    it("solo el gerente: el administrador y el operador no ven, ni guardan, ni confirman, y no se escribe nada", async () => {
      const g = await nuevo();
      const { borradorId, r } = await guardar(g);
      const pedido = { emisorId: g.mundo.emisor, borradorId };
      const antesDeAuditoria = (await auditorias(g.mundo.empresa)).length;
      for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
        const otra = await otraPersona(dueno, g, rol);
        const c = otra.como(ahora());
        expect(await datosFiscalesDelEmisor(d, c, pedido)).toMatchObject(SIN_PERMISO);
        expect(
          await guardarBorradorDeDatosFiscales(d, c, {
            ...pedido,
            versionEsperada: 1,
            razonSocial: "Intruso SA",
          }),
        ).toMatchObject(SIN_PERMISO);
        expect(
          await confirmarDatosFiscales(d, c, {
            ...pedido,
            versionEsperada: (dato(r) as { version: number }).version,
            motivo: "Intruso",
          }),
        ).toMatchObject(SIN_PERMISO);
      }
      const [fila] = await filas<{ estado: string; razon_social: string }>(
        "select estado, razon_social from datos_fiscales where id = $1",
        [borradorId],
      );
      expect(fila).toEqual({ estado: "BORRADOR", razon_social: "Panadería Zulu SA" });
      expect((await auditorias(g.mundo.empresa)).length).toBe(antesDeAuditoria);
    });

    it("aislamiento: el emisor o el domicilio de otra empresa no existen para quien pregunta; nada se lee ni se escribe de la otra", async () => {
      const a = await nuevo();
      const b = await nuevo();
      const deB = await guardar(b);
      dato(deB.r);
      const domicilioDeB = await crearDomicilio(dueno, b.mundo.empresa);
      const inexistente = uuid();
      const registrosAntes = registrados.length;

      // El emisor de B, visto desde A, es indistinguible de uno que no existe.
      const ajeno = await datosFiscalesDelEmisor(d, a.como(ahora()), { emisorId: b.mundo.emisor });
      const nadie = await datosFiscalesDelEmisor(d, a.como(ahora()), { emisorId: inexistente });
      expect(ajeno).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      expect(nadie).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      const sinReferencia = (r: typeof ajeno) =>
        r.ok ? r : { ...r, error: { ...r.error, referencia: undefined } };
      expect(sinReferencia(ajeno)).toEqual(sinReferencia(nadie));
      expect(
        await puntosDeVentaDelEmisor(d, a.como(ahora()), { emisorId: b.mundo.emisor }),
      ).toMatchObject({ ok: false });
      // …y escribirle datos a ese emisor tampoco hace nada (ni el domicilio nuevo queda).
      const intento = await guardarBorradorDeDatosFiscales(d, a.como(ahora()), {
        emisorId: b.mundo.emisor,
        borradorId: uuid(),
        ...completos(),
      });
      expect(intento).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      expect(registrados.slice(registrosAntes).join("\n")).toContain("EMISOR_NO_ENCONTRADO");
      // Un domicilio existente de B no se puede usar desde A.
      const conDomicilioAjeno = await guardarBorradorDeDatosFiscales(d, a.como(ahora()), {
        emisorId: a.mundo.emisor,
        borradorId: uuid(),
        domicilio: { tipo: "EXISTENTE", id: domicilioDeB },
      });
      expect(conDomicilioAjeno).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      expect(await cuenta("datos_fiscales", a.mundo.empresa)).toBe(0);
      expect(await cuenta("domicilio", a.mundo.empresa)).toBe(0);
      // Lo de B quedó como estaba.
      expect(await cuenta("datos_fiscales", b.mundo.empresa)).toBe(1);
    });
  });

  it("D-65: los datos fiscales traen el CUIT del emisor (11 dígitos, solo para leer) y cada empresa ve el suyo", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const deA = dato(
      await datosFiscalesDelEmisor(d, a.como(ahora()), { emisorId: a.mundo.emisor }),
    );
    const deB = dato(
      await datosFiscalesDelEmisor(d, b.como(ahora()), { emisorId: b.mundo.emisor }),
    );
    expect(deA.cuit).toBe(a.mundo.cuit);
    expect(deB.cuit).toBe(b.mundo.cuit);
    expect(deA.cuit).toMatch(/^\d{11}$/);
    expect(deA.cuit).not.toBe(deB.cuit);
    // También con una versión confirmada: el CUIT no se versiona con los datos.
    const { borradorId, r } = await guardar(a);
    dato(
      await confirmarDatosFiscales(d, a.como(ahora()), {
        emisorId: a.mundo.emisor,
        borradorId,
        versionEsperada: (dato(r) as { version: number }).version,
        motivo: "Alta",
      }),
    );
    const conVersion = dato(
      await datosFiscalesDelEmisor(d, a.como(new Date(Date.now() + 1000)), {
        emisorId: a.mundo.emisor,
      }),
    );
    expect(conVersion.cuit).toBe(a.mundo.cuit);
    expect(Object.keys(conVersion.vigente ?? {})).not.toContain("cuit");
    // El CUIT de B no sale por la puerta de A (el emisor de otra empresa no existe) ni lo lee quien no es gerente.
    expect(
      await datosFiscalesDelEmisor(d, a.como(ahora()), { emisorId: b.mundo.emisor }),
    ).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    const operador = await otraPersona(dueno, a, "OPERADOR");
    const sinPermiso = await datosFiscalesDelEmisor(d, operador.como(ahora()), {
      emisorId: a.mundo.emisor,
    });
    expect(sinPermiso).toMatchObject(SIN_PERMISO);
    expect(JSON.stringify(sinPermiso)).not.toContain(a.mundo.cuit);
  });

  it("D-62: empezar la corrección crea el borrador desde lo vigente; repetir o llamar desde otra pestaña devuelve el que existe", async () => {
    const e = await nuevo();
    const { borradorId: confirmada, r } = await guardar(e);
    dato(
      await confirmarDatosFiscales(d, e.como(ahora()), {
        emisorId: e.mundo.emisor,
        borradorId: confirmada,
        versionEsperada: (dato(r) as { version: number }).version,
        motivo: "Alta",
      }),
    );
    const contexto = () => e.como(new Date(Date.now() + 1000));
    const id = uuid();
    expect(
      dato(
        await empezarCorreccionDeDatosFiscales(d, contexto(), {
          emisorId: e.mundo.emisor,
          borradorId: id,
        }),
      ),
    ).toEqual({ borradorId: id, version: 1, yaEstaba: false });
    // La pantalla ve lo vigente y el borrador precargado con lo mismo.
    const leido = dato(await datosFiscalesDelEmisor(d, contexto(), { emisorId: e.mundo.emisor }));
    expect(leido.vigente).toMatchObject({ id: confirmada, razonSocial: "Panadería Zulu SA" });
    expect(leido.borrador).toMatchObject({
      id,
      version: 1,
      razonSocial: "Panadería Zulu SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      inicioActividades: "2020-03-01",
    });
    expect(leido.borrador?.domicilio?.id).toBe(leido.vigente?.domicilio.id);
    const antes = (await auditorias(e.mundo.empresa)).length;
    // Repetir, y otra pestaña con otra clave: el mismo borrador, sin escribir.
    for (const clave of [id, uuid()]) {
      expect(
        dato(
          await empezarCorreccionDeDatosFiscales(d, contexto(), {
            emisorId: e.mundo.emisor,
            borradorId: clave,
          }),
        ),
      ).toEqual({ borradorId: id, version: 1, yaEstaba: true });
    }
    expect((await auditorias(e.mundo.empresa)).length).toBe(antes);
    expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(2);
  });

  it("D-62: sin datos vigentes dice «faltan los datos fiscales»; un pedido mal armado, «revisá los datos marcados»; otra empresa y otro rol, lo de siempre", async () => {
    const e = await nuevo();
    const pedido = { emisorId: e.mundo.emisor, borradorId: uuid() };
    expect(await empezarCorreccionDeDatosFiscales(d, e.como(ahora()), pedido)).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SIN_DATOS_FISCALES" },
    });
    expect(await empezarCorreccionDeDatosFiscales(d, e.como(ahora()), { emisorId: "uno" })).toEqual(
      {
        ok: false,
        error: {
          codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
          clave: "error.fiscal_configuracion_datos_invalidos",
          presentacion: "AVISO",
          campo: "emisorId",
        },
      },
    );
    expect(
      await empezarCorreccionDeDatosFiscales(d, e.como(ahora()), { ...pedido, borradorId: "x" }),
    ).toMatchObject({ ok: false, error: { campo: "borradorId" } });
    const ajena = await nuevo();
    expect(await empezarCorreccionDeDatosFiscales(d, ajena.como(ahora()), pedido)).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO" },
    });
    for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
      const otra = await otraPersona(dueno, e, rol);
      expect(await empezarCorreccionDeDatosFiscales(d, otra.como(ahora()), pedido)).toMatchObject(
        SIN_PERMISO,
      );
    }
    expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(0);
  });

  it("D-68: una pantalla que quedó abierta sin borrador mientras otra lo creó (YA_HAY_BORRADOR) recibe «versión desactualizada»", async () => {
    const e = await nuevo();
    const primero = await guardar(e);
    dato(primero.r);
    const rezagada = await guardar(e);
    expect(rezagada.r).toEqual({
      ok: false,
      error: {
        codigo: "FISCAL_VERSION_DESACTUALIZADA",
        clave: "error.fiscal_version_desactualizada",
        presentacion: "AVISO",
      },
    });
    expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(1);
  });

  it("D-68: guardar sobre una versión que otra pantalla ya confirmó también dice «versión desactualizada» y no cambia nada", async () => {
    const e = await nuevo();
    const { borradorId, r } = await guardar(e);
    dato(
      await confirmarDatosFiscales(d, e.como(ahora()), {
        emisorId: e.mundo.emisor,
        borradorId,
        versionEsperada: (dato(r) as { version: number }).version,
        motivo: "Alta",
      }),
    );
    const antes = await cuenta("datos_fiscales", e.mundo.empresa);
    const viejo = await guardar(e, { borradorId, versionEsperada: 1, razonSocial: "Vieja SA" });
    expect(viejo.r).toEqual({
      ok: false,
      error: {
        codigo: "FISCAL_VERSION_DESACTUALIZADA",
        clave: "error.fiscal_version_desactualizada",
        presentacion: "AVISO",
      },
    });
    expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(antes);
    const [fila] = await filas<{ razon_social: string }>(
      "select razon_social from datos_fiscales where id = $1",
      [borradorId],
    );
    expect(fila?.razon_social).toBe("Panadería Zulu SA");
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("puntos de venta: ver, crear, editar, activar y desactivar", () => {
    const crear = (e: EscenarioDeConfiguracion, cambios: Record<string, unknown> = {}) =>
      crearPuntoDeVenta(d, e.como(ahora()), {
        id: uuid(),
        emisorId: e.mundo.emisor,
        sucursalId: e.mundo.sucursal,
        numero: 1,
        ...cambios,
      });

    it("crear: nace inactivo y en pruebas, con su sucursal; la pantalla lo ve con su versión y se audita", async () => {
      const e = await nuevo();
      const id = uuid();
      expect(dato(await crear(e, { id, numero: 7 }))).toEqual({
        puntoDeVentaId: id,
        version: 1,
        yaExistia: false,
      });
      const lista = dato(
        await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(lista).toEqual({
        emisorId: e.mundo.emisor,
        items: [
          {
            id,
            numero: 7,
            activo: false,
            ambiente: "HOMOLOGACION",
            sucursal: { id: e.mundo.sucursal, nombre: "Casa central", activa: true },
            tieneDomicilio: false,
            domicilio: null,
            hayNumerosUsados: false,
            version: 1,
          },
        ],
      });
      const auditoria = await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.actor).toBe(e.persona);
    });

    it("repetir el alta con el mismo id: «ya existía»; con el mismo id y otros datos, sin texto aprobado (error inesperado) y sin cambios", async () => {
      const e = await nuevo();
      const id = uuid();
      dato(await crear(e, { id, numero: 3 }));
      expect(dato(await crear(e, { id, numero: 3 }))).toEqual({
        puntoDeVentaId: id,
        version: 1,
        yaExistia: true,
      });
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO")).toHaveLength(1);
      const otroNumero = await crear(e, { id, numero: 4 });
      expect(otroNumero).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      expect(registrados.at(-1)).toContain("ID_EN_USO");
      expect(await cuenta("punto_de_venta", e.mundo.empresa)).toBe(1);
    });

    it("número fuera de rango: datos inválidos del campo «numero»; no queda ni el domicilio nuevo (todo o nada)", async () => {
      const e = await nuevo();
      for (const numero of [0, 100000]) {
        expect(await crear(e, { numero, domicilio: domicilioNuevo() })).toMatchObject({
          ok: false,
          error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "numero" },
        });
      }
      expect(await cuenta("punto_de_venta", e.mundo.empresa)).toBe(0);
      expect(await cuenta("domicilio", e.mundo.empresa)).toBe(0);
      expect(await auditorias(e.mundo.empresa)).toHaveLength(0);
    });

    it("número repetido en el mismo emisor: «Ya existe un punto de venta con ese número.» (D-66); nada nuevo", async () => {
      const e = await nuevo();
      dato(await crear(e, { numero: 5 }));
      const repetido = await crear(e, { numero: 5 });
      expect(repetido).toEqual({
        ok: false,
        error: {
          codigo: "FISCAL_PUNTO_DE_VENTA_DUPLICADO",
          clave: "error.fiscal_punto_de_venta_duplicado",
          presentacion: "AVISO",
          campo: "numero",
        },
      });
      expect(await cuenta("punto_de_venta", e.mundo.empresa)).toBe(1);
    });

    it("una sucursal de otra empresa no sirve: es un pedido armado a mano, sale como error inesperado y no se crea nada", async () => {
      const a = await nuevo();
      const b = await nuevo();
      const r = await crear(a, { sucursalId: b.mundo.sucursal });
      expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      expect(await cuenta("punto_de_venta", a.mundo.empresa)).toBe(0);
      expect(await cuenta("punto_de_venta", b.mundo.empresa)).toBe(0);
    });

    it("activar necesita domicilio; con domicilio activa, y repetir es «ya estaba» sin auditar de nuevo", async () => {
      const e = await nuevo();
      const sinDomicilio = uuid();
      dato(await crear(e, { id: sinDomicilio, numero: 1 }));
      expect(
        await activarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: sinDomicilio }),
      ).toMatchObject({
        ok: false,
        error: {
          codigo: "FISCAL_PUNTO_DE_VENTA_SIN_DOMICILIO",
          clave: "error.fiscal_punto_de_venta_sin_domicilio",
          campo: "domicilio",
        },
      });
      const conDomicilio = uuid();
      dato(await crear(e, { id: conDomicilio, numero: 2, domicilio: domicilioNuevo() }));
      expect(
        dato(await activarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: conDomicilio })),
      ).toEqual({ yaEstaba: false });
      expect(
        dato(await activarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: conDomicilio })),
      ).toEqual({ yaEstaba: true });
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).toHaveLength(1);
    });

    it("desactivar (dar de baja): nada se borra, sigue en la lista como inactivo; repetir es «ya estaba»", async () => {
      const e = await nuevo();
      const id = await insertarPuntoDeVenta(dueno, e.mundo, { numero: 1, activo: true });
      expect(
        dato(await desactivarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: id })),
      ).toEqual({ yaEstaba: false });
      expect(
        dato(await desactivarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: id })),
      ).toEqual({ yaEstaba: true });
      const lista = dato(
        await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(lista.items).toMatchObject([{ id, activo: false, tieneDomicilio: true }]);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_DESACTIVADO")).toHaveLength(1);
    });

    it("editar: con la versión que vio la pantalla cambia el número; con una vieja no pisa; sin cambios no escribe", async () => {
      const e = await nuevo();
      const id = uuid();
      dato(await crear(e, { id, numero: 1 }));
      const editar = (cambios: Record<string, unknown>) =>
        editarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: id, ...cambios });
      expect(dato(await editar({ versionEsperada: 1, numero: 9 }))).toEqual({
        version: 2,
        sinCambios: false,
      });
      expect(await editar({ versionEsperada: 1, numero: 10 })).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" },
      });
      expect(dato(await editar({ versionEsperada: 2, numero: 9 }))).toEqual({
        version: 2,
        sinCambios: true,
      });
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toHaveLength(1);
      const lista = dato(
        await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(lista.items[0]).toMatchObject({ numero: 9, version: 2 });
    });

    // -------------------------------------------------------------------------------------------------------------
    // El domicilio de cada punto de venta en la lista (D-63): lo que la pantalla muestra y precarga al editar.
    // -------------------------------------------------------------------------------------------------------------
    describe("la lista trae el domicilio de cada punto de venta", () => {
      const lista = async (e: EscenarioDeConfiguracion) =>
        dato(await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }));
      const alta = (e: EscenarioDeConfiguracion, cambios: Record<string, unknown>) =>
        crearPuntoDeVenta(d, e.como(ahora()), {
          id: uuid(),
          emisorId: e.mundo.emisor,
          sucursalId: e.mundo.sucursal,
          ...cambios,
        });

      it("cada uno con el suyo (lista blanca de Datos fiscales), sin domicilio es null, y uno compartido sale en los dos", async () => {
        const e = await nuevo();
        const idDomicilio = uuid();
        dato(
          await alta(e, {
            numero: 1,
            domicilio: domicilioNuevo({ id: idDomicilio, piso: "3", departamento: "B" }),
          }),
        );
        dato(await alta(e, { numero: 2 }));
        dato(await alta(e, { numero: 3, domicilio: { tipo: "EXISTENTE", id: idDomicilio } }));
        const { items } = await lista(e);
        expect(items.map((i) => [i.numero, i.tieneDomicilio])).toEqual([
          [1, true],
          [2, false],
          [3, true],
        ]);
        const esperado = {
          id: idDomicilio,
          calle: "Av. Corrientes",
          numero: "1234",
          piso: "3",
          departamento: "B",
          localidad: "Rosario",
          provincia: "AR-S",
          codigoPostal: "S2000",
        };
        expect(items.map((i) => i.domicilio)).toEqual([esperado, null, esperado]);

        // Misma forma y mismas claves que el domicilio de Datos fiscales: una sola lista blanca.
        const fiscales = dato(
          await guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
            emisorId: e.mundo.emisor,
            borradorId: uuid(),
            ...completos(),
          }),
        );
        const borrador = dato(
          await datosFiscalesDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
        ).borrador;
        expect(fiscales.borradorId).toBe(borrador?.id);
        expect(Object.keys(items[0]?.domicilio ?? {}).sort()).toEqual(
          Object.keys(borrador?.domicilio ?? {}).sort(),
        );
      });

      it("editar el domicilio lo cambia en la lista; el anterior se conserva (un domicilio no se edita)", async () => {
        const e = await nuevo();
        const primero = uuid();
        const segundo = uuid();
        const id = uuid();
        dato(await alta(e, { id, numero: 1, domicilio: domicilioNuevo({ id: primero }) }));
        dato(
          await editarPuntoDeVenta(d, e.como(ahora()), {
            puntoDeVentaId: id,
            versionEsperada: 1,
            domicilio: domicilioNuevo({ id: segundo, calle: "Mitre", numero: "55" }),
          }),
        );
        expect((await lista(e)).items[0]?.domicilio).toMatchObject({
          id: segundo,
          calle: "Mitre",
          numero: "55",
        });
        expect(await cuenta("domicilio", e.mundo.empresa)).toBe(2);
      });

      it("aislamiento: cada empresa ve solo los domicilios de sus puntos de venta, y el emisor de otra no existe", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const deA = uuid();
        const deB = uuid();
        dato(
          await alta(a, { numero: 1, domicilio: domicilioNuevo({ id: deA, calle: "Calle A" }) }),
        );
        dato(
          await alta(b, { numero: 1, domicilio: domicilioNuevo({ id: deB, calle: "Calle B" }) }),
        );
        expect((await lista(a)).items.map((i) => i.domicilio?.calle)).toEqual(["Calle A"]);
        expect((await lista(b)).items.map((i) => i.domicilio?.calle)).toEqual(["Calle B"]);
        const ajeno = await puntosDeVentaDelEmisor(d, a.como(ahora()), {
          emisorId: b.mundo.emisor,
        });
        expect(ajeno).toMatchObject({ ok: false });
        expect(JSON.stringify(ajeno)).not.toContain("Calle B");
      });

      it("solo el gerente: administrador y operador reciben SIN_PERMISO y ningún domicilio", async () => {
        const g = await nuevo();
        dato(await alta(g, { numero: 1, domicilio: domicilioNuevo({ calle: "Secreta 1" }) }));
        for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
          const c = (await otraPersona(dueno, g, rol)).como(ahora());
          const r = await puntosDeVentaDelEmisor(d, c, { emisorId: g.mundo.emisor });
          expect(r).toMatchObject(SIN_PERMISO);
          expect(JSON.stringify(r)).not.toContain("Secreta");
        }
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    // Editar cuando la respuesta se perdió: guardó, el navegador no lo supo y reintenta con la MISMA versión esperada.
    // Regla del dueño: cualquier acción puede llegar dos veces; repetirla no duplica ni perjudica. Si lo pedido ya es el
    // estado actual, es éxito sin cambios (aunque la versión esperada haya quedado vieja); si difiere, sigue siendo
    // «versión desactualizada».
    // -------------------------------------------------------------------------------------------------------------
    describe("editar con la respuesta perdida", () => {
      const nuevaSucursal = async (e: EscenarioDeConfiguracion, nombre = "Sucursal norte") =>
        (
          await filas<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
            [e.mundo.empresa, nombre],
          )
        )[0]?.id ?? "";
      async function conPunto(rol: RolDePrueba = "GERENTE") {
        const e = await nuevo(rol);
        const id = uuid();
        dato(
          await crearPuntoDeVenta(d, e.como(ahora()), {
            id,
            emisorId: e.mundo.emisor,
            sucursalId: e.mundo.sucursal,
            numero: 1,
          }),
        );
        const editar = (cambios: Record<string, unknown>, quien = e) =>
          editarPuntoDeVenta(d, quien.como(ahora()), { puntoDeVentaId: id, ...cambios });
        const fila = async () =>
          (
            await filas<{
              numero: number;
              sucursal_id: string;
              domicilio_id: string | null;
              version: number;
            }>(
              "select numero, sucursal_id, domicilio_id, version from punto_de_venta where id = $1",
              [id],
            )
          )[0];
        const editadas = async () =>
          (await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).length;
        return { e, id, editar, fila, editadas };
      }
      const DESACTUALIZADA = { ok: false, error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } };

      it("el número: el reintento con la misma versión es «sin cambios» con la versión actual, y no escribe ni audita", async () => {
        const { editar, fila, editadas } = await conPunto();
        expect(dato(await editar({ versionEsperada: 1, numero: 9 }))).toEqual({
          version: 2,
          sinCambios: false,
        });
        // La respuesta se perdió: el navegador reintenta el mismo pedido, con la misma versión esperada (1).
        expect(dato(await editar({ versionEsperada: 1, numero: 9 }))).toEqual({
          version: 2,
          sinCambios: true,
        });
        expect(dato(await editar({ versionEsperada: 1, numero: 9 }))).toEqual({
          version: 2,
          sinCambios: true,
        });
        expect(await fila()).toMatchObject({ numero: 9, version: 2 });
        expect(await editadas()).toBe(1);
      });

      it("sucursal y domicilio nuevo juntos: el reintento (mismo id de domicilio) es «sin cambios» y no deja otro domicilio", async () => {
        const { e, editar, fila, editadas } = await conPunto();
        const norte = await nuevaSucursal(e);
        const pedido = {
          versionEsperada: 1,
          numero: 5,
          sucursalId: norte,
          domicilio: domicilioNuevo({ id: uuid() }),
        };
        expect(dato(await editar(pedido))).toEqual({ version: 2, sinCambios: false });
        const domicilios = await cuenta("domicilio", e.mundo.empresa);
        expect(dato(await editar(pedido))).toEqual({ version: 2, sinCambios: true });
        expect(await cuenta("domicilio", e.mundo.empresa)).toBe(domicilios);
        expect(await fila()).toMatchObject({ numero: 5, sucursal_id: norte, version: 2 });
        expect(await editadas()).toBe(1);
      });

      it("con contenido distinto sigue siendo «versión desactualizada»: no cambia nada, ni deja el domicilio nuevo", async () => {
        const { e, editar, fila, editadas } = await conPunto();
        dato(await editar({ versionEsperada: 1, numero: 9 }));
        const antes = await fila();
        const domicilios = await cuenta("domicilio", e.mundo.empresa);
        // Otro número.
        expect(await editar({ versionEsperada: 1, numero: 10 })).toMatchObject(DESACTUALIZADA);
        // Mitad igual y mitad distinto: no se aplica ni se da por hecho a medias.
        expect(
          await editar({ versionEsperada: 1, numero: 9, sucursalId: await nuevaSucursal(e) }),
        ).toMatchObject(DESACTUALIZADA);
        // Otro domicilio: la base no guarda el nuevo (todo o nada).
        expect(
          await editar({
            versionEsperada: 1,
            numero: 9,
            domicilio: domicilioNuevo({ id: uuid() }),
          }),
        ).toMatchObject(DESACTUALIZADA);
        expect(await fila()).toEqual(antes);
        expect(await cuenta("domicilio", e.mundo.empresa)).toBe(domicilios);
        expect(await editadas()).toBe(1);
      });

      it("si otra pestaña cambió después lo mismo a otro valor, el reintento no lo pisa", async () => {
        const { editar, fila, editadas } = await conPunto();
        dato(await editar({ versionEsperada: 1, numero: 9 }));
        // Otra pestaña (hay un solo gerente por empresa) lo vio ya cambiado y lo cambia otra vez.
        dato(await editar({ versionEsperada: 2, numero: 10 }));
        expect(await editar({ versionEsperada: 1, numero: 9 })).toMatchObject(DESACTUALIZADA);
        expect(await fila()).toMatchObject({ numero: 10, version: 3 });
        expect(await editadas()).toBe(2);
      });

      it("pedir lo que ya es el estado actual con una versión vieja sin que nadie lo haya editado tampoco escribe", async () => {
        const { editar, fila, editadas } = await conPunto();
        expect(dato(await editar({ versionEsperada: 77, numero: 1 }))).toEqual({
          version: 1,
          sinCambios: true,
        });
        expect(await fila()).toMatchObject({ numero: 1, version: 1 });
        expect(await editadas()).toBe(0);
      });

      it("un domicilio nuevo con OTRO id (aunque tenga el mismo contenido) es un pedido distinto: versión desactualizada y no queda huérfano", async () => {
        const { e, editar, editadas } = await conPunto();
        const datosDelDomicilio = { calle: "Mitre", numero: "55" };
        dato(
          await editar({
            versionEsperada: 1,
            domicilio: domicilioNuevo({ id: uuid(), ...datosDelDomicilio }),
          }),
        );
        const domicilios = await cuenta("domicilio", e.mundo.empresa);
        expect(
          await editar({
            versionEsperada: 1,
            domicilio: domicilioNuevo({ id: uuid(), ...datosDelDomicilio }),
          }),
        ).toMatchObject(DESACTUALIZADA);
        expect(await cuenta("domicilio", e.mundo.empresa)).toBe(domicilios);
        expect(await editadas()).toBe(1);
      });

      it("el permiso va primero: quien no es gerente no se entera del estado aunque lo pedido ya esté aplicado", async () => {
        const { e, editar, fila, editadas } = await conPunto();
        dato(await editar({ versionEsperada: 1, numero: 9 }));
        const antes = await fila();
        for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
          const otro = await otraPersona(dueno, e, rol);
          expect(await editar({ versionEsperada: 1, numero: 9 }, otro)).toMatchObject(SIN_PERMISO);
        }
        expect(await fila()).toEqual(antes);
        expect(await editadas()).toBe(1);
      });

      it("aislamiento: el gerente de otra empresa no puede reintentar ni cambiar el punto de venta, ni siquiera con lo ya aplicado", async () => {
        const { e, id, editar, fila, editadas } = await conPunto();
        dato(await editar({ versionEsperada: 1, numero: 9 }));
        const ajeno = await nuevo();
        const antes = await fila();
        for (const pedido of [
          { versionEsperada: 1, numero: 9 },
          { versionEsperada: 2, numero: 30 },
        ]) {
          expect(
            await editarPuntoDeVenta(d, ajeno.como(ahora()), { puntoDeVentaId: id, ...pedido }),
          ).toMatchObject({ ok: false, error: { codigo: "FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO" } });
        }
        expect(await fila()).toEqual(antes);
        expect(await editadas()).toBe(1);
        expect(await cuenta("punto_de_venta", ajeno.mundo.empresa)).toBe(0);
        expect(e.mundo.empresa).not.toBe(ajeno.mundo.empresa);
      });

      it("dos veces a la vez (doble clic): los dos salen bien, uno escribe y el otro es «sin cambios»; una sola auditoría", async () => {
        const { editar, fila, editadas } = await conPunto();
        const pedido = { versionEsperada: 1, numero: 9 };
        const salidas = (await Promise.all([editar(pedido), editar(pedido)])).map(dato);
        expect(salidas.map((x) => x.sinCambios).sort()).toEqual([false, true]);
        expect(salidas.map((x) => x.version)).toEqual([2, 2]);
        expect(await fila()).toMatchObject({ numero: 9, version: 2 });
        expect(await editadas()).toBe(1);
      });

      it("el reintento perdido y uno nuevo distinto a la vez: gana uno solo y no se mezclan", async () => {
        const { e, editar, fila, editadas } = await conPunto();
        const norte = await nuevaSucursal(e);
        dato(await editar({ versionEsperada: 1, numero: 9 }));
        // A la vez: el reintento de la edición ya aplicada y otra edición (otra sucursal) con la versión vigente.
        const [reintento, nueva] = await Promise.all([
          editar({ versionEsperada: 1, numero: 9 }),
          editar({ versionEsperada: 2, sucursalId: norte }),
        ]);
        expect(dato(reintento).sinCambios).toBe(true);
        expect(dato(nueva)).toEqual({ version: 3, sinCambios: false });
        expect(await fila()).toMatchObject({ numero: 9, sucursal_id: norte, version: 3 });
        expect(await editadas()).toBe(2);
      });

      it("dos ediciones de campos distintos con la misma versión: una gana y la otra no se aplica ni a medias", async () => {
        const { e, editar, fila, editadas } = await conPunto();
        const norte = await nuevaSucursal(e);
        const [x, y] = await Promise.all([
          editar({ versionEsperada: 1, numero: 9 }),
          editar({ versionEsperada: 1, sucursalId: norte }),
        ]);
        expect([x, y].filter((r) => r.ok)).toHaveLength(1);
        expect([x, y].filter((r) => !r.ok)).toMatchObject([DESACTUALIZADA]);
        const despues = await fila();
        expect(despues?.version).toBe(2);
        const ganoNumero = despues?.numero === 9 && despues.sucursal_id === e.mundo.sucursal;
        const ganoSucursal = despues?.numero === 1 && despues.sucursal_id === norte;
        expect(ganoNumero || ganoSucursal).toBe(true);
        expect(await editadas()).toBe(1);
      });
    });

    it("hayNumerosUsados: lo dice la lista, y con números usados el número no se puede cambiar", async () => {
      const e = await nuevo();
      const id = await insertarPuntoDeVenta(dueno, e.mundo, { numero: 1, activo: true });
      let lista = dato(
        await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(lista.items[0]?.hayNumerosUsados).toBe(false);
      await crearSerie(dueno, e.mundo.empresa, id, e.mundo.emisor, "FACTURA_B", 12);
      lista = dato(await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }));
      expect(lista.items[0]?.hayNumerosUsados).toBe(true);
      expect(
        await editarPuntoDeVenta(d, e.como(ahora()), {
          puntoDeVentaId: id,
          versionEsperada: lista.items[0]?.version,
          numero: 2,
        }),
      ).toMatchObject({
        ok: false,
        error: {
          codigo: "FISCAL_PUNTO_DE_VENTA_NUMERO_INMUTABLE",
          clave: "error.fiscal_punto_de_venta_numero_inmutable",
          campo: "numero",
        },
      });
    });

    it("el ambiente se ve por punto de venta (pruebas o producción)", async () => {
      const e = await nuevo();
      const id = await insertarPuntoDeVenta(dueno, e.mundo, { numero: 1, activo: true });
      await dueno.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [id]);
      const lista = dato(
        await puntosDeVentaDelEmisor(d, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(lista.items[0]?.ambiente).toBe("PRODUCCION");
    });

    it("cada empresa ve sus puntos de venta; uno de otra empresa no se activa, ni se edita, ni se da de baja", async () => {
      const a = await nuevo();
      const b = await nuevo();
      const deB = await insertarPuntoDeVenta(dueno, b.mundo, { numero: 1, activo: true });
      const deA = await insertarPuntoDeVenta(dueno, a.mundo, { numero: 1 });
      expect(
        dato(
          await puntosDeVentaDelEmisor(d, a.como(ahora()), { emisorId: a.mundo.emisor }),
        ).items.map((i) => i.id),
      ).toEqual([deA]);
      const noExiste = { ok: false, error: { codigo: "FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO" } };
      expect(await activarPuntoDeVenta(d, a.como(ahora()), { puntoDeVentaId: deB })).toMatchObject(
        noExiste,
      );
      expect(
        await desactivarPuntoDeVenta(d, a.como(ahora()), { puntoDeVentaId: deB }),
      ).toMatchObject(noExiste);
      expect(
        await editarPuntoDeVenta(d, a.como(ahora()), {
          puntoDeVentaId: deB,
          versionEsperada: 1,
          numero: 8,
        }),
      ).toMatchObject(noExiste);
      // Igual que uno que no existe.
      expect(
        await activarPuntoDeVenta(d, a.como(ahora()), { puntoDeVentaId: uuid() }),
      ).toMatchObject(noExiste);
      const [fila] = await filas<{ estado: string; numero: number }>(
        "select estado, numero from punto_de_venta where id = $1",
        [deB],
      );
      expect(fila).toEqual({ estado: "ACTIVO", numero: 1 });
    });

    it("solo el gerente: el administrador y el operador no ven, ni crean, ni editan, ni activan, ni desactivan", async () => {
      const g = await nuevo();
      const pv = await insertarPuntoDeVenta(dueno, g.mundo, { numero: 1, activo: true });
      const antes = await auditorias(g.mundo.empresa);
      for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
        const c = (await otraPersona(dueno, g, rol)).como(ahora());
        expect(await puntosDeVentaDelEmisor(d, c, { emisorId: g.mundo.emisor })).toMatchObject(
          SIN_PERMISO,
        );
        expect(
          await crearPuntoDeVenta(d, c, {
            id: uuid(),
            emisorId: g.mundo.emisor,
            sucursalId: g.mundo.sucursal,
            numero: 2,
          }),
        ).toMatchObject(SIN_PERMISO);
        expect(
          await editarPuntoDeVenta(d, c, { puntoDeVentaId: pv, versionEsperada: 1, numero: 3 }),
        ).toMatchObject(SIN_PERMISO);
        expect(await activarPuntoDeVenta(d, c, { puntoDeVentaId: pv })).toMatchObject(SIN_PERMISO);
        expect(await desactivarPuntoDeVenta(d, c, { puntoDeVentaId: pv })).toMatchObject(
          SIN_PERMISO,
        );
      }
      expect(await cuenta("punto_de_venta", g.mundo.empresa)).toBe(1);
      const [fila] = await filas<{ estado: string; numero: number }>(
        "select estado, numero from punto_de_venta where id = $1",
        [pv],
      );
      expect(fila).toEqual({ estado: "ACTIVO", numero: 1 });
      expect(await auditorias(g.mundo.empresa)).toHaveLength(antes.length);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("certificado de ARCA: el estado, sin nada secreto", () => {
    it("un certificado vigente ya vencido figura vencido, en la lista y en su estado", async () => {
      const e = await nuevoConFacturacion();
      const id = await conCertificado(e, "PEDIDO_GENERADO");
      const vencio = new Date(Date.now() - DIA);
      await dueno.query(
        `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'PEM', huella_sha256 = $2, vence_en = $3 where id = $1`,
        [id, "ef".repeat(32), vencio],
      );
      const lista = dato(await estadoDeLaConfiguracionFiscal(d, e.como(ahora())));
      expect(lista.certificados[0]).toEqual({
        ambiente: "HOMOLOGACION",
        situacion: "VIGENTE",
        venceEn: vencio.toISOString(),
        vencido: true,
      });
      const estado = dato(
        await estadoDeCertificados(dConFacturacion, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(estado[0]).toMatchObject({ situacion: "VIGENTE", vencido: true });
    });

    it("pedido generado y vigente: lo que la pantalla necesita para cargar o renovar, y nunca la clave, el pedido, el PEM ni la huella", async () => {
      const e = await nuevoConFacturacion();
      const pedido = await conCertificado(e, "PEDIDO_GENERADO");
      const pedidoDeHomologacion = dato(
        await estadoDeCertificados(dConFacturacion, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(pedidoDeHomologacion[0]).toMatchObject({
        ambiente: "HOMOLOGACION",
        situacion: "PEDIDO_GENERADO",
        certificadoId: pedido,
        alias: "pedernal1",
        cuitTitular: e.mundo.cuit,
      });
      expect(pedidoDeHomologacion[1]).toEqual({
        ambiente: "PRODUCCION",
        situacion: "FALTA_CARGAR",
      });

      const vigente = await conCertificado(e, "VIGENTE");
      const lista = dato(
        await estadoDeCertificados(dConFacturacion, e.como(ahora()), { emisorId: e.mundo.emisor }),
      );
      expect(lista[0]).toMatchObject({
        situacion: "VIGENTE",
        certificadoId: vigente,
        vencido: false,
        autorizacion: { estado: "SIN_VERIFICAR" },
        pedidoPendiente: { certificadoId: pedido, alias: "pedernal1" },
      });
      expect(typeof (lista[0] as { venceEn: unknown }).venceEn).toBe("string");
      expect(JSON.stringify(lista)).not.toMatch(/SECRETO|cdcd|kid-1|clave|huella|pem/i);
    });

    it("solo el gerente (con la facturación habilitada): administrador y operador, SIN_PERMISO", async () => {
      const g = await nuevoConFacturacion();
      for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
        const c = (await otraPersona(dueno, g, rol)).como(ahora());
        expect(
          await estadoDeCertificados(dConFacturacion, c, { emisorId: g.mundo.emisor }),
        ).toMatchObject(SIN_PERMISO);
      }
    });

    it("el emisor de otra empresa no existe para quien pregunta, y con las reglas reales la facturación todavía no se puede usar", async () => {
      const a = await nuevoConFacturacion();
      const b = await nuevoConFacturacion();
      expect(
        await estadoDeCertificados(dConFacturacion, a.como(ahora()), { emisorId: b.mundo.emisor }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "ERROR_INTERNO" },
      });
      // Con las reglas reales (módulo en desarrollo) el certificado se ve en la lista (administracion), no por su consulta propia.
      expect(
        await estadoDeCertificados(d, a.como(ahora()), { emisorId: a.mundo.emisor }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO" },
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("dos a la vez sobre lo mismo", () => {
    it("dos guardados del mismo borrador con la misma versión: uno gana y el otro recibe «cambió mientras lo mirabas»", async () => {
      const e = await nuevo();
      const { borradorId } = await guardar(e);
      const pedir = (razonSocial: string) =>
        guardarBorradorDeDatosFiscales(d, e.como(ahora()), {
          emisorId: e.mundo.emisor,
          borradorId,
          versionEsperada: 1,
          razonSocial,
        });
      const [x, y] = await Promise.all([pedir("Uno SA"), pedir("Dos SA")]);
      const salieron = [x, y];
      expect(salieron.filter((r) => r.ok)).toHaveLength(1);
      expect(salieron.filter((r) => !r.ok)).toMatchObject([
        { error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } },
      ]);
      const [fila] = await filas<{ razon_social: string; version: number }>(
        "select razon_social, version from datos_fiscales where id = $1",
        [borradorId],
      );
      expect(fila?.version).toBe(2);
      expect(["Uno SA", "Dos SA"]).toContain(fila?.razon_social);
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(2);
    });

    it("el mismo guardado dos veces a la vez (doble clic): los dos salen bien, uno escribe y el otro es «ya estaba»", async () => {
      const e = await nuevo();
      const pedido = {
        emisorId: e.mundo.emisor,
        borradorId: uuid(),
        razonSocial: "Zulu",
        inicioActividades: "2020-03-01",
      };
      const [x, y] = await Promise.all([
        guardarBorradorDeDatosFiscales(d, e.como(ahora()), pedido),
        guardarBorradorDeDatosFiscales(d, e.como(ahora()), pedido),
      ]);
      expect([x, y].every((r) => r.ok)).toBe(true);
      expect([x, y].filter((r) => r.ok && r.dato.yaEstaba)).toHaveLength(1);
      expect(await cuenta("datos_fiscales", e.mundo.empresa)).toBe(1);
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toHaveLength(1);
    });

    it("dos confirmaciones a la vez del mismo borrador: una versión confirmada, una sola auditoría", async () => {
      const e = await nuevo();
      const { borradorId, r } = await guardar(e);
      const pedido = {
        emisorId: e.mundo.emisor,
        borradorId,
        versionEsperada: (dato(r) as { version: number }).version,
        motivo: "Alta",
      };
      const [x, y] = await Promise.all([
        confirmarDatosFiscales(d, e.como(ahora()), pedido),
        confirmarDatosFiscales(d, e.como(ahora()), pedido),
      ]);
      expect([x, y].every((r) => r.ok)).toBe(true);
      expect([x, y].filter((r) => r.ok && r.dato.yaEstaba)).toHaveLength(1);
      const confirmadas = await filas(
        "select numero from datos_fiscales where emisor_id = $1 and estado = 'CONFIRMADA'",
        [e.mundo.emisor],
      );
      expect(confirmadas).toEqual([{ numero: 1 }]);
      expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toHaveLength(1);
    });

    it("dos altas del mismo número a la vez (dos pestañas): se crea una sola; la otra no pisa nada", async () => {
      const e = await nuevo();
      const alta = () =>
        crearPuntoDeVenta(d, e.como(ahora()), {
          id: uuid(),
          emisorId: e.mundo.emisor,
          sucursalId: e.mundo.sucursal,
          numero: 4,
        });
      const [x, y] = await Promise.all([alta(), alta()]);
      expect([x, y].filter((r) => r.ok)).toHaveLength(1);
      expect([x, y].filter((r) => !r.ok)).toMatchObject([
        { error: { codigo: "FISCAL_PUNTO_DE_VENTA_DUPLICADO", campo: "numero" } },
      ]);
      expect(await cuenta("punto_de_venta", e.mundo.empresa)).toBe(1);
      expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO")).toHaveLength(1);
    });

    it("activar y desactivar a la vez: no hay error ni estado a medias, y la auditoría cuenta lo que pasó", async () => {
      const e = await nuevo();
      const id = await insertarPuntoDeVenta(dueno, e.mundo, { numero: 1, activo: true });
      const c = (): ContextoOperativo => e.como(ahora());
      const [x, y] = await Promise.all([
        desactivarPuntoDeVenta(d, c(), { puntoDeVentaId: id }),
        activarPuntoDeVenta(d, c(), { puntoDeVentaId: id }),
      ]);
      expect(x.ok && y.ok).toBe(true);
      const [fila] = await filas<{ estado: string }>(
        "select estado from punto_de_venta where id = $1",
        [id],
      );
      expect(["ACTIVO", "INACTIVO"]).toContain(fila?.estado);
      const cambios =
        (await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_DESACTIVADO")).length +
        (await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).length;
      // Si el estado final es ACTIVO hubo una baja y un alta; si es INACTIVO, solo la baja (la alta llegó antes y ya estaba).
      expect(cambios).toBe(fila?.estado === "ACTIVO" ? 2 : 1);
    });

    it("dos ediciones del mismo punto de venta con la misma versión: una gana y la otra recibe la versión desactualizada", async () => {
      const e = await nuevo();
      const id = uuid();
      dato(
        await crearPuntoDeVenta(d, e.como(ahora()), {
          id,
          emisorId: e.mundo.emisor,
          sucursalId: e.mundo.sucursal,
          numero: 1,
        }),
      );
      const editar = (numero: number) =>
        editarPuntoDeVenta(d, e.como(ahora()), { puntoDeVentaId: id, versionEsperada: 1, numero });
      const [x, y] = await Promise.all([editar(2), editar(3)]);
      expect([x, y].filter((r) => r.ok)).toHaveLength(1);
      expect([x, y].filter((r) => !r.ok)).toMatchObject([
        { error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } },
      ]);
    });
  });
});
