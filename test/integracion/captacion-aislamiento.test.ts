import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  ACCIONES_DE_CAPTACION,
  ACCIONES_DE_PLATAFORMA,
  ACTOR_DE_AUDITORIA_DE_CAPTACION,
  ENTIDAD_DE_AUDITORIA,
} from "../../src/plataforma/captacion/dominio/auditoria";
import {
  ESTADOS_DE_SOLICITUD,
  transicionPermitida,
  type ActorDeSolicitud,
  type EstadoDeSolicitud,
} from "../../src/plataforma/captacion/dominio/estados";
import { MAXIMO_DE_ENVIOS } from "../../src/plataforma/captacion/dominio/envio";
import { RETENCION_DE_CONTADORES_EN_MS } from "../../src/plataforma/captacion/dominio/limites";
import {
  adminPlataformaId,
  empresaId,
  personaId,
  tenantId,
} from "../../src/primitivas/identificadores/marca";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  conCaptacion,
  crearSolicitud,
  emailAlAzar,
  firmarCargaDeCaptacion,
  filaDe,
  sesionDeCaptacion,
  type ClaimDeCaptacion,
  type SolicitudDePrueba,
} from "./captacion-apoyo";
import { AHORA_DE_PRUEBA, comoEmpresa, comoGrupo, comoPlataforma, comoTrabajos } from "./entorno";
import type { BaseDePruebas } from "./global";
import { crearMarca, crearMundoDeMarca, marcaPrincipal, type MundoDeMarca } from "./marcas-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * Alta por solicitud (L1): el AISLAMIENTO. Lo que cada rol real puede y no puede hacer sobre la solicitud, los
 * contadores y las dos tablas compartidas (`trabajo`, `auditoria_plataforma`), con conexiones directas por `pg`
 * con el rol y el contexto firmado de verdad (no pasan por el adaptador). PS-S1 a PS-S5 y PS-A7 de la
 * especificación. La landing es la superficie más expuesta: acá se prueba que un error o un robo de su cadena de
 * conexión no filtra ni toca nada que no sea la solicitud que su contexto firmado nombra.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

// ---- ayudas ----------------------------------------------------------------------------------------------

const rechazado = (r: Intento, codigos: readonly string[] = ["42501"]): void => {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (!r.ok) expect(codigos, `${r.codigo}: ${r.mensaje}`).toContain(r.codigo);
};
const filas = (r: Intento): number => {
  expect(r.ok, r.ok ? "" : `${r.codigo}: ${r.mensaje}`).toBe(true);
  return r.ok ? r.filas : -1;
};
const sinFilas = (r: Intento): void => {
  expect(filas(r)).toBe(0);
};
const unaFila = (r: Intento): void => {
  expect(filas(r)).toBe(1);
};

const ADMIN = ADMIN_DE_PRUEBA as string;
const SOPORTE = SOPORTE_DE_PRUEBA as string;
const T = AHORA_DE_PRUEBA;

describe.skipIf(base === null)("captación: el aislamiento por rol de base", () => {
  const b = () => base as BaseDePruebas;
  let dueno: pg.Client;
  let principal: string;
  let otraMarca: string;
  let mundo: MundoDeMarca;

  // Escenario compartido: dos solicitudes de la marca principal, una de otra marca con el MISMO correo que una de
  // ellas, una anonimizada, una verificada y una con consentimiento de medición.
  let a1: SolicitudDePrueba;
  let a2: SolicitudDePrueba;
  let b1: SolicitudDePrueba;
  let anonimizada: SolicitudDePrueba;
  let verificada: SolicitudDePrueba;
  let conMedicion: SolicitudDePrueba;

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
    principal = await marcaPrincipal(dueno);
    otraMarca = await crearMarca(dueno);
    mundo = await crearMundoDeMarca(dueno, { marca: principal });
    a1 = await crearSolicitud(dueno, { marca: principal });
    a2 = await crearSolicitud(dueno, { marca: principal });
    b1 = await crearSolicitud(dueno, { marca: otraMarca, email: a1.email });
    anonimizada = await crearSolicitud(dueno, { marca: principal, estado: "SPAM" });
    await dueno.query(
      `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null,
              nombre_negocio = null, telefono = null, cuit = null, id_de_medicion = null, nota_interna = null,
              atribucion = atribucion - 'fbclid' where id = $1`,
      [anonimizada.id, T],
    );
    verificada = await crearSolicitud(dueno, { marca: principal, estado: "VERIFICADA" });
    conMedicion = await crearSolicitud(dueno, { marca: principal, medicionConsentida: true });
  });
  afterAll(async () => {
    await dueno.end();
  });

  const porEmail = (s: SolicitudDePrueba, marca = s.marca): ClaimDeCaptacion => ({
    m: marca,
    e: s.email,
  });
  const porId = (s: SolicitudDePrueba): ClaimDeCaptacion => ({ s: s.id });

  // ==========================================================================================================
  // PS-S1: la landing no toca nada de negocio
  // ==========================================================================================================
  describe("PS-S1: la landing no ve ni toca ninguna tabla de negocio", () => {
    it("42501 en la lectura de todas las tablas del esquema salvo la solicitud y los contadores (aun con un contexto válido)", async () => {
      const { rows } = await dueno.query<{ tabla: string }>(
        `select c.relname as tabla from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1`,
      );
      const tablas = rows.map((r) => r.tabla);
      // el control no pasa por vacío: están las de todas las migraciones
      expect(tablas).toEqual(
        expect.arrayContaining([
          "tenant",
          "empresa",
          "persona",
          "membresia",
          "invitacion",
          "sucursal",
        ]),
      );
      expect(tablas).toEqual(
        expect.arrayContaining([
          "auditoria_plataforma",
          "emisor",
          "datos_fiscales",
          "marca",
          "dominio",
          "plan",
        ]),
      );
      await conCaptacion(b(), porEmail(a1), async (s) => {
        for (const tabla of tablas) {
          const r = await s.intentar(`select 1 from ${tabla} limit 1`);
          if (tabla === "solicitud_de_alta" || tabla === "limite_de_captacion") {
            expect(r.ok, tabla).toBe(true);
          } else {
            rechazado(r);
          }
        }
      });
    });

    it("no escribe en ninguna tabla de negocio: INSERT, UPDATE, DELETE y TRUNCATE dan 42501", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        for (const tabla of [
          "tenant",
          "empresa",
          "sucursal",
          "persona",
          "membresia",
          "membresia_tenant",
          "invitacion",
          "invitacion_empresa",
          "auditoria_empresa",
          "auditoria_acceso_grupo",
          "admin_plataforma",
          "idempotencia_plataforma",
          "referencia_de_error",
          "emisor",
          "datos_fiscales",
          "serie_comprobante",
          "marca",
          "dominio",
          "plan",
          "version_de_marca",
          "modulo_de_empresa",
          "traspaso_gerencia",
        ]) {
          rechazado(await s.intentar(`insert into ${tabla} default values`), ["42501"]);
          rechazado(await s.intentar(`update ${tabla} set id = id`), ["42501", "42703", "428C9"]);
          rechazado(await s.intentar(`delete from ${tabla}`));
          rechazado(await s.intentar(`truncate ${tabla}`));
        }
      });
    });

    it("sobre `trabajo` y la auditoría de plataforma solo inserta: no lee, no cambia y no borra", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        for (const tabla of ["trabajo", "auditoria_plataforma"]) {
          rechazado(await s.intentar(`select * from ${tabla}`));
          rechazado(await s.intentar(`select count(*) from ${tabla}`));
          rechazado(await s.intentar(`update ${tabla} set tipo = tipo`), ["42501", "42703"]);
          rechazado(await s.intentar(`delete from ${tabla}`));
          rechazado(await s.intentar(`truncate ${tabla}`));
        }
      });
    });

    it("no hace DDL: ni crear tablas, funciones, temporales, políticas, ni apagar RLS, ni borrar sus tablas", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        for (const sentencia of [
          "create table prueba_ajena (id int)",
          "create temp table prueba_temporal (id int)",
          "create function prueba_ajena() returns int language sql as 'select 1'",
          "create schema prueba_ajena",
          "alter table solicitud_de_alta disable row level security",
          "alter table solicitud_de_alta no force row level security",
          "alter table solicitud_de_alta add column prueba_ajena int",
          "create policy prueba_ajena on solicitud_de_alta for select using (true)",
          "drop policy solicitud_captacion_leer on solicitud_de_alta",
          "drop table solicitud_de_alta",
          "drop table limite_de_captacion",
          "drop function app_captacion()",
          "create trigger prueba_ajena before update on solicitud_de_alta execute function sin_borrado()",
          "alter role zuluhub_captacion bypassrls",
          "alter role zuluhub_captacion superuser",
          "create role prueba_ajena",
          "set role zuluhub_plataforma",
          "set session authorization zuluhub_plataforma",
        ]) {
          rechazado(await s.intentar(sentencia), ["42501"]);
        }
      });
    });

    it("no ejecuta las funciones del actor de plataforma ni las de la aplicación", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        for (const llamada of [
          "admin_plataforma_con_rol(array['ADMIN'])",
          "plataforma_actor_vigente()",
          "app_actor_plataforma()",
          "app_empresa_id()",
          "app_tenant_id()",
          "app_persona_id()",
          "app_token_invitacion()",
          `empresa_operable('${randomUUID()}')`,
          `tenant_de_empresa('${randomUUID()}')`,
        ]) {
          rechazado(await s.intentar(`select ${llamada}`));
        }
      });
    });

    it("no lee la clave de firma del contexto: contexto_clave es del dueño", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        rechazado(await s.intentar("select * from contexto_clave"));
        rechazado(await s.intentar("select secreto from contexto_clave"));
      });
    });
  });

  // ==========================================================================================================
  // PS-S2: sin contexto firmado no hay nada; con él, solo la fila que nombra
  // ==========================================================================================================
  describe("PS-S2: el contexto firmado decide qué fila ve", () => {
    const ids = async (s: SesionDePrueba): Promise<string[]> => {
      const r = await s.intentar("select id from solicitud_de_alta order by id");
      expect(r.ok).toBe(true);
      return r.ok ? r.rows.map((x) => x["id"] as string) : [];
    };

    it("sin contexto: 0 filas de la solicitud y de los contadores, y no escribe nada", async () => {
      await conCaptacion(b(), null, async (s) => {
        expect(await ids(s)).toEqual([]);
        expect(filas(await s.intentar("select 1 from limite_de_captacion"))).toBe(0);
        rechazado(
          await s.intentar(
            `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro,
               version_de_terminos, version_de_privacidad, ultimo_envio_en, creada_en)
             values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3)`,
            [principal, emailAlAzar(), T],
          ),
        );
        sinFilas(
          await s.intentar("update solicitud_de_alta set numero_de_envios = numero_de_envios"),
        );
        rechazado(
          await s.intentar(
            "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ('global:solicitudes', 'HORA', $1, 1)",
            [T],
          ),
        );
        sinFilas(await s.intentar("delete from limite_de_captacion"));
      });
    });

    it("con el contexto de OTRO rol (plataforma, aplicación) o de otro tipo: tampoco hay filas", async () => {
      const tokens = {
        plataforma: firmarCargaDeCaptacion(b(), {
          u: "zuluhub_plataforma",
          a: ADMIN,
          c: { s: a1.id },
        }),
        aplicacion: firmarCargaDeCaptacion(b(), { u: "zuluhub_app", c: { s: a1.id } }),
        // el rol de la sesión es captación pero el token dice que es de otro
        publico: firmarCargaDeCaptacion(b(), { u: "zuluhub_publico", c: { s: a1.id } }),
      };
      for (const [nombre, token] of Object.entries(tokens)) {
        const s = await SesionDePrueba.abrirConToken(b(), "zuluhub_captacion", token);
        try {
          expect(await ids(s), nombre).toEqual([]);
        } finally {
          await s.cerrar();
        }
      }
    });

    it("un token adulterado, vencido, firmado con otra clave o con un kid desconocido no sirve", async () => {
      const bueno = firmarCargaDeCaptacion(b(), { c: { s: a1.id } });
      const [v, kid, payload, mac] = bueno.split(".") as [string, string, string, string];
      const tokens: Record<string, string> = {
        "firma alterada": `${v}.${kid}.${payload}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`,
        "payload alterado": `${v}.${kid}.${Buffer.from(
          Buffer.from(payload, "hex").toString("utf8").replace(a1.id, a2.id),
          "utf8",
        ).toString("hex")}.${mac}`,
        vencido: firmarCargaDeCaptacion(b(), {
          x: Math.floor(Date.now() / 1000) - 10,
          c: { s: a1.id },
        }),
        "otra clave": firmarCargaDeCaptacion(
          b(),
          { c: { s: a1.id } },
          { secreto: randomBytes(32) },
        ),
        "kid desconocido": bueno.replace(`v1.${kid}.`, "v1.31999."),
        "sin firma": `${v}.${kid}.${payload}`,
        basura: "no-es-un-token",
        vacío: "",
      };
      for (const [nombre, token] of Object.entries(tokens)) {
        const s = await SesionDePrueba.abrirConToken(b(), "zuluhub_captacion", token);
        try {
          expect(await ids(s), nombre).toEqual([]);
        } finally {
          await s.cerrar();
        }
      }
      // y el bueno sí
      const s = await SesionDePrueba.abrirConToken(b(), "zuluhub_captacion", bueno);
      try {
        expect(await ids(s)).toEqual([a1.id]);
      } finally {
        await s.cerrar();
      }
    });

    it("un claim `c` que no es un objeto (null, texto, número, lista) vale como «sin contexto»", async () => {
      for (const c of [null, "x", 5, ["s"], true]) {
        const s = await SesionDePrueba.abrirConToken(
          b(),
          "zuluhub_captacion",
          firmarCargaDeCaptacion(b(), { c }),
        );
        try {
          expect(await ids(s), JSON.stringify(c)).toEqual([]);
          expect(
            filas(await s.intentar("select 1 from limite_de_captacion")),
            JSON.stringify(c),
          ).toBe(0);
          rechazado(
            await s.intentar(
              "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ('global:solicitudes', 'HORA', $1, 1)",
              [T],
            ),
          );
        } finally {
          await s.cerrar();
        }
      }
    });

    it("`{s: A}` ve solo A; con el id de otra o inexistente no ve nada; nunca ve una anonimizada", async () => {
      await conCaptacion(b(), porId(a1), async (s) => expect(await ids(s)).toEqual([a1.id]));
      await conCaptacion(b(), porId(a2), async (s) => expect(await ids(s)).toEqual([a2.id]));
      await conCaptacion(b(), { s: randomUUID() }, async (s) => expect(await ids(s)).toEqual([]));
      await conCaptacion(b(), porId(anonimizada), async (s) => expect(await ids(s)).toEqual([]));
      // una VERIFICADA se lee (la landing muestra «listo»), pero ya no se cambia (lo prueba PS-S3)
      await conCaptacion(b(), porId(verificada), async (s) => {
        const r = await s.intentar("select estado, verificada_en from solicitud_de_alta");
        expect(r.ok && r.rows.map((x) => x["estado"])).toEqual(["VERIFICADA"]);
      });
      // la que dio su consentimiento de medición muestra a la landing su identificador y su fbclid
      await conCaptacion(b(), porId(conMedicion), async (s) => {
        const r = await s.intentar(
          "select medicion_consentida, id_de_medicion, atribucion from solicitud_de_alta",
        );
        expect(r.ok && r.rows[0]?.["medicion_consentida"]).toBe(true);
        expect(r.ok && r.rows[0]?.["id_de_medicion"]).toEqual(expect.any(String));
      });
    });

    it("`{m, e}` ve solo la solicitud de ese correo en esa marca: no la de otra marca con el mismo correo, ni la de otro correo", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => expect(await ids(s)).toEqual([a1.id]));
      await conCaptacion(b(), porEmail(b1), async (s) => expect(await ids(s)).toEqual([b1.id]));
      await conCaptacion(b(), { m: principal, e: b1.email }, async (s) =>
        expect(await ids(s)).toEqual([a1.id]),
      );
      await conCaptacion(b(), { m: otraMarca, e: a2.email }, async (s) =>
        expect(await ids(s)).toEqual([]),
      );
      await conCaptacion(b(), { m: principal, e: "nadie@prueba.test" }, async (s) =>
        expect(await ids(s)).toEqual([]),
      );
    });

    it("`{m}` sin correo, `{e}` sin marca o `{}` no ven ninguna solicitud (no se puede listar a los interesados)", async () => {
      for (const claim of [{ m: principal }, { e: a1.email }, {}, { m: principal, e: "" }]) {
        await conCaptacion(b(), claim as ClaimDeCaptacion, async (s) =>
          expect(await ids(s), JSON.stringify(claim)).toEqual([]),
        );
      }
      // ni con una consulta que intente abarcar más (el filtro lo pone la política, no la consulta)
      await conCaptacion(b(), porEmail(a1), async (s) => {
        expect(
          filas(
            await s.intentar("select id from solicitud_de_alta where true or marca_id is not null"),
          ),
        ).toBe(1);
        expect(
          filas(await s.intentar("select id from solicitud_de_alta where email like '%@%'")),
        ).toBe(1);
        expect(
          filas(
            await s.intentar("select id from solicitud_de_alta where marca_id = $1", [otraMarca]),
          ),
        ).toBe(0);
      });
    });

    it("lee las columnas del GRANT y NO el nombre, el negocio, el teléfono, el CUIT, la nota ni la decisión, ni siquiera para filtrar", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        unaFila(
          await s.intentar(`select id, marca_id, estado, email, numero_de_envios, ultimo_envio_en,
          verificada_en, decidida_en, motivo_de_rechazo, medicion_consentida, id_de_medicion, atribucion,
          rubro, provincia, anonimizada_en, version, creada_en from solicitud_de_alta`),
        );
        for (const columna of [
          "nombre_contacto",
          "nombre_negocio",
          "telefono",
          "cuit",
          "nota_interna",
          "finalidad",
          "version_de_terminos",
          "version_de_privacidad",
          "version_de_aviso_de_medicion",
          "decidida_por",
          "empresa_creada_id",
          "actualizado_en",
        ]) {
          rechazado(await s.intentar(`select ${columna} from solicitud_de_alta`));
          rechazado(
            await s.intentar(`select id from solicitud_de_alta where ${columna} is not null`),
          );
          rechazado(await s.intentar(`select id from solicitud_de_alta order by ${columna}`));
        }
        rechazado(await s.intentar("select * from solicitud_de_alta"));
        rechazado(await s.intentar("select s.* from solicitud_de_alta s"));
        rechazado(await s.intentar("select to_jsonb(s) from solicitud_de_alta s"));
      });
    });
  });

  // ==========================================================================================================
  // PS-S3: lo que la landing no puede hacer con lo que sí ve
  // ==========================================================================================================
  describe("PS-S3: la landing solo crea una NUEVA, la verifica y encola y deja constancia de lo suyo", () => {
    const INSERTAR_BASE = (columnas: string[]) =>
      `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro,
         version_de_terminos, version_de_privacidad, ultimo_envio_en, creada_en${columnas.map((c) => `, ${c}`).join("")})
       values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3${columnas.map((_, i) => `, $${i + 4}`).join("")})`;

    it("crea una solicitud de su contexto: nace NUEVA, con un envío y sin decisión", async () => {
      const email = emailAlAzar();
      await conCaptacion(b(), { m: principal, e: email }, async (s) => {
        const r = await s.intentar(
          `${INSERTAR_BASE([])} returning id, estado, numero_de_envios, version, verificada_en, decidida_en, anonimizada_en`,
          [principal, email, T],
        );
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.rows[0]).toMatchObject({
            estado: "NUEVA",
            numero_de_envios: 1,
            version: 1,
            verificada_en: null,
            decidida_en: null,
            anonimizada_en: null,
          });
        }
      });
    });

    it("no crea con otra marca ni con otro correo que los de su contexto, ni sin `m` y `e`, ni con solo `s`", async () => {
      const email = emailAlAzar();
      await conCaptacion(b(), { m: principal, e: email }, async (s) => {
        rechazado(await s.intentar(INSERTAR_BASE([]), [otraMarca, email, T]));
        rechazado(await s.intentar(INSERTAR_BASE([]), [principal, emailAlAzar(), T]));
      });
      await conCaptacion(b(), { s: randomUUID() }, async (s) => {
        rechazado(await s.intentar(INSERTAR_BASE([]), [principal, email, T]));
      });
      await conCaptacion(b(), { m: principal }, async (s) => {
        rechazado(await s.intentar(INSERTAR_BASE([]), [principal, email, T]));
      });
      await conCaptacion(b(), null, async (s) => {
        rechazado(await s.intentar(INSERTAR_BASE([]), [principal, email, T]));
      });
    });

    it("no puede dar valor a las columnas de estado, envíos, decisión, anonimización, nota, finalidad ni versión (42501)", async () => {
      const email = emailAlAzar();
      const valores: Record<string, unknown> = {
        estado: "APROBADA",
        numero_de_envios: 3,
        verificada_en: T,
        decidida_por: ADMIN,
        decidida_en: T,
        motivo_de_rechazo: "OTRO",
        empresa_creada_id: mundo.empresa,
        anonimizada_en: T,
        nota_interna: "x",
        finalidad: "EVALUAR_ALTA",
        version: 9,
        actualizado_en: T,
        id: randomUUID(),
      };
      await conCaptacion(b(), { m: principal, e: email }, async (s) => {
        for (const [columna, valor] of Object.entries(valores)) {
          rechazado(await s.intentar(INSERTAR_BASE([columna]), [principal, email, T, valor]), [
            "42501",
          ]);
        }
      });
    });

    it("no crea una segunda abierta del mismo correo y marca (23505), aunque su contexto lo permita", async () => {
      await conCaptacion(b(), porEmail(a1), async (s) => {
        const r = await s.intentar(INSERTAR_BASE([]), [principal, a1.email, T]);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.codigo).toBe("23505");
          expect(r.restriccion).toBe("solicitud_abierta_uk");
        }
      });
    });

    it("verifica su NUEVA (NUEVA → VERIFICADA) y la segunda vez no encuentra nada que verificar", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        unaFila(
          await s.intentar(
            "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1 and estado = 'NUEVA'",
            [s1.id, T],
          ),
        );
        // ahora ya no es NUEVA: el mismo UPDATE no toca nada (la repetición no es un error)
        sinFilas(
          await s.intentar(
            "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1 and estado = 'NUEVA'",
            [s1.id, T],
          ),
        );
      });
    });

    it("reenvía (suma de a uno los envíos de una NUEVA) hasta el tope y ni uno más", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        for (let n = 2; n <= MAXIMO_DE_ENVIOS; n++) {
          unaFila(
            await s.intentar(
              "update solicitud_de_alta set numero_de_envios = $2, ultimo_envio_en = $3 where id = $1",
              [s1.id, n, new Date(T.getTime() + n * 120_000)],
            ),
          );
        }
        rechazado(
          await s.intentar(
            "update solicitud_de_alta set numero_de_envios = 6, ultimo_envio_en = $2 where id = $1",
            [s1.id, new Date(T.getTime() + 9_999_000)],
          ),
          ["23514"],
        );
        rechazado(
          await s.intentar("update solicitud_de_alta set numero_de_envios = 1 where id = $1", [
            s1.id,
          ]),
          ["23514"],
        );
      });
    });

    it("no pasa a APROBADA, RECHAZADA ni SPAM, ni deja una NUEVA «verificada a medias»", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        for (const hasta of ["APROBADA", "ALTA_CREADA"]) {
          rechazado(
            await s.intentar("update solicitud_de_alta set estado = $2 where id = $1", [
              s1.id,
              hasta,
            ]),
            ["23514", "42501"],
          );
        }
        // RECHAZADA y SPAM son transiciones válidas del estado: la política es la que las frena
        for (const hasta of ["RECHAZADA", "SPAM"]) {
          rechazado(
            await s.intentar("update solicitud_de_alta set estado = $2 where id = $1", [
              s1.id,
              hasta,
            ]),
            ["42501"],
          );
        }
        rechazado(
          await s.intentar("update solicitud_de_alta set verificada_en = $2 where id = $1", [
            s1.id,
            T,
          ]),
          ["23514"],
        );
      });
      expect((await filaDe(dueno, s1.id))["estado"]).toBe("NUEVA");
    });

    it("no cambia la decisión, los datos personales, la atribución, la marca, el rubro ni nada que no sea suyo (42501)", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        for (const set of [
          "decidida_por = 'sistema'",
          "decidida_en = now()",
          "motivo_de_rechazo = 'OTRO'",
          "empresa_creada_id = null",
          "anonimizada_en = now()",
          "nota_interna = 'x'",
          "email = 'otro@prueba.test'",
          "nombre_contacto = 'Beto'",
          "nombre_negocio = 'Bar'",
          "telefono = null",
          "cuit = null",
          "id_de_medicion = null",
          "atribucion = '{}'::jsonb",
          "marca_id = gen_random_uuid()",
          "rubro = 'otro'",
          "provincia = 'AR-C'",
          "creada_en = now()",
          "version = 99",
          "id = gen_random_uuid()",
          "medicion_consentida = true",
        ]) {
          rechazado(await s.intentar(`update solicitud_de_alta set ${set} where id = $1`, [s1.id]));
        }
      });
    });

    it("no toca la solicitud de otro: con `{s: A}`, un UPDATE o un DELETE sobre B no afecta nada", async () => {
      const otra = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(a2), async (s) => {
        sinFilas(
          await s.intentar(
            "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1",
            [otra.id, new Date(T.getTime() + 300_000)],
          ),
        );
        sinFilas(
          await s.intentar(
            "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1",
            [otra.id, T],
          ),
        );
        rechazado(await s.intentar("delete from solicitud_de_alta where id = $1", [otra.id]));
      });
      expect((await filaDe(dueno, otra.id))["estado"]).toBe("NUEVA");
    });

    it("no actúa sobre una solicitud que ya no es NUEVA (verificada, aprobada, cerrada): su UPDATE no encuentra la fila", async () => {
      for (const estado of [
        "VERIFICADA",
        "APROBADA",
        "RECHAZADA",
        "SPAM",
        "ALTA_CREADA",
      ] as const) {
        const s1 = await crearSolicitud(dueno, { marca: principal, estado });
        await conCaptacion(b(), porId(s1), async (s) => {
          sinFilas(
            await s.intentar(
              "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1",
              [s1.id, new Date(T.getTime() + 300_000)],
            ),
          );
          sinFilas(
            await s.intentar(
              "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1",
              [s1.id, T],
            ),
          );
        });
      }
    });

    // ---- trabajos -----------------------------------------------------------------------------------------

    const ENCOLAR =
      "insert into trabajo (empresa_id, tipo, datos, clave_idempotencia) values ($1, $2, $3::jsonb, $4) on conflict do nothing";
    const encolar = (
      s: SesionDePrueba,
      tipo: string,
      datos: unknown,
      claveDeIdempotencia: string,
      empresa: string | null = null,
    ) => s.intentar(ENCOLAR, [empresa, tipo, JSON.stringify(datos), claveDeIdempotencia]);

    it("encola el correo de verificación de su solicitud con la clave y los datos exactos; repetirlo no duplica ni falla", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        const clave = `solicitud:${s1.id}:verificacion:1`;
        unaFila(
          await encolar(s, "enviar_verificacion_de_solicitud", { solicitudId: s1.id }, clave),
        );
        // la repetición con la misma clave: éxito sin escribir (idempotente)
        sinFilas(
          await encolar(s, "enviar_verificacion_de_solicitud", { solicitudId: s1.id }, clave),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      const { rows } = await dueno.query(
        "select empresa_id, tipo, datos, estado from trabajo where clave_idempotencia = $1",
        [`solicitud:${s1.id}:verificacion:1`],
      );
      expect(rows).toEqual([
        {
          empresa_id: null,
          tipo: "enviar_verificacion_de_solicitud",
          datos: { solicitudId: s1.id },
          estado: "PENDIENTE",
        },
      ]);
    });

    it("el número del correo no pasa de los envíos contados: un correo por cada envío, y el sexto no existe", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        const clave = (n: number) => `solicitud:${s1.id}:verificacion:${n}`;
        const verificacion = (n: number) =>
          encolar(s, "enviar_verificacion_de_solicitud", { solicitudId: s1.id }, clave(n));
        rechazado(await verificacion(2));
        rechazado(await verificacion(5));
        unaFila(await verificacion(1));
        for (let n = 2; n <= MAXIMO_DE_ENVIOS; n++) {
          rechazado(await verificacion(n));
          unaFila(
            await s.intentar(
              "update solicitud_de_alta set numero_de_envios = $2, ultimo_envio_en = $3 where id = $1",
              [s1.id, n, new Date(T.getTime() + n * 120_000)],
            ),
          );
          unaFila(await verificacion(n));
        }
        rechazado(await verificacion(6));
        rechazado(await verificacion(0));
        rechazado(await verificacion(10));
      });
    });

    it("no encola nada que no sea de su solicitud o que no tenga la forma exacta (42501)", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      const ajena = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        const t = "enviar_verificacion_de_solicitud";
        const clave = `solicitud:${s1.id}:verificacion:1`;
        // de una empresa
        rechazado(await encolar(s, t, { solicitudId: s1.id }, clave, mundo.empresa));
        // de otro tipo (incluidos los de la plataforma y los de la aplicación)
        for (const otro of [
          "enviar_invitacion",
          "mantenimiento",
          "evento",
          "",
          "enviar_verificacion_de_solicitud ",
        ]) {
          rechazado(await encolar(s, otro, { solicitudId: s1.id }, clave));
        }
        // datos con claves de más (un correo, un nombre), vacíos, o que no son un objeto
        rechazado(await encolar(s, t, { solicitudId: s1.id, email: a1.email }, clave));
        rechazado(await encolar(s, t, { solicitudId: s1.id, nombre: "Ana" }, clave));
        rechazado(await encolar(s, t, {}, clave));
        rechazado(await encolar(s, t, [s1.id], clave));
        rechazado(await encolar(s, t, s1.id, clave));
        rechazado(await encolar(s, t, null, clave));
        rechazado(await encolar(s, t, { solicitudId: 5 }, clave));
        // de la solicitud de otro (que no ve) o inexistente
        rechazado(
          await encolar(s, t, { solicitudId: ajena.id }, `solicitud:${ajena.id}:verificacion:1`),
        );
        rechazado(
          await encolar(
            s,
            t,
            { solicitudId: randomUUID() },
            `solicitud:${randomUUID()}:verificacion:1`,
          ),
        );
        // con la clave de otra solicitud
        rechazado(
          await encolar(s, t, { solicitudId: s1.id }, `solicitud:${ajena.id}:verificacion:1`),
        );
        // con claves que no son la forma exacta
        for (const mala of [
          `solicitud:${s1.id}:verificacion:1 `,
          ` solicitud:${s1.id}:verificacion:1`,
          `solicitud:${s1.id}:verificacion:01`,
          `solicitud:${s1.id}:verificacion:1:x`,
          `x:solicitud:${s1.id}:verificacion:1`,
          `solicitud:${s1.id}:envio:1`,
          `solicitud:${s1.id}:verificacion:`,
          `solicitud:${s1.id}`,
          `invitacion:${s1.id}:envio`,
          "verificacion:1",
          "",
        ]) {
          rechazado(await encolar(s, t, { solicitudId: s1.id }, mala));
        }
        // y no puede leer lo que encoló
        rechazado(await s.intentar("select 1 from trabajo"));
      });
    });

    it("el aviso al dueño solo se encola de una solicitud VERIFICADA (nadie avisa de lo no verificado) y una sola vez", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        const clave = `solicitud:${s1.id}:aviso`;
        rechazado(await encolar(s, "avisar_solicitud_verificada", { solicitudId: s1.id }, clave));
        unaFila(
          await s.intentar(
            "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1",
            [s1.id, T],
          ),
        );
        unaFila(await encolar(s, "avisar_solicitud_verificada", { solicitudId: s1.id }, clave));
        sinFilas(await encolar(s, "avisar_solicitud_verificada", { solicitudId: s1.id }, clave));
        // con datos de más o de otra clave, no
        rechazado(
          await encolar(
            s,
            "avisar_solicitud_verificada",
            { solicitudId: s1.id, email: "x@y.z" },
            clave,
          ),
        );
        rechazado(
          await encolar(
            s,
            "avisar_solicitud_verificada",
            { solicitudId: s1.id },
            `solicitud:${s1.id}:aviso:2`,
          ),
        );
      });
    });

    it("el evento a terceros solo se encola si la solicitud dio su consentimiento de medición", async () => {
      const sin = await crearSolicitud(dueno, { marca: principal, medicionConsentida: false });
      const con = await crearSolicitud(dueno, { marca: principal, medicionConsentida: true });
      await conCaptacion(b(), porId(sin), async (s) => {
        rechazado(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: sin.id, evento: "solicitud_enviada" },
            `solicitud:${sin.id}:evento:solicitud_enviada`,
          ),
        );
      });
      await conCaptacion(b(), porId(con), async (s) => {
        const clave = `solicitud:${con.id}:evento:solicitud_enviada`;
        unaFila(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: con.id, evento: "solicitud_enviada" },
            clave,
          ),
        );
        sinFilas(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: con.id, evento: "solicitud_enviada" },
            clave,
          ),
        );
        // el nombre del evento va en los datos y en la clave, iguales y con la forma permitida
        rechazado(
          await encolar(s, "evento_de_captacion", { solicitudId: con.id, evento: "otro" }, clave),
        );
        rechazado(await encolar(s, "evento_de_captacion", { solicitudId: con.id }, clave));
        rechazado(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: con.id, evento: "Mal Nombre" },
            `solicitud:${con.id}:evento:Mal Nombre`,
          ),
        );
        rechazado(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: con.id, evento: "a@b" },
            `solicitud:${con.id}:evento:a@b`,
          ),
        );
        // sin datos personales en los datos
        rechazado(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: con.id, evento: "solicitud_enviada", email: "x@y.z" },
            `solicitud:${con.id}:evento:solicitud_enviada`,
          ),
        );
        rechazado(
          await encolar(
            s,
            "evento_de_captacion",
            { solicitudId: con.id, evento: "x".repeat(41) },
            `solicitud:${con.id}:evento:${"x".repeat(41)}`,
          ),
        );
      });
    });

    // ---- auditoría ----------------------------------------------------------------------------------------

    const AUDITAR =
      "insert into auditoria_plataforma (actor, accion, entidad, entidad_id, antes, despues) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)";
    const auditar = (
      s: SesionDePrueba,
      o: {
        actor?: string;
        accion?: string;
        entidad?: string;
        entidadId: string;
        antes?: unknown;
        despues?: unknown;
      },
    ) =>
      s.intentar(AUDITAR, [
        o.actor ?? ACTOR_DE_AUDITORIA_DE_CAPTACION,
        o.accion ?? "SOLICITUD_RECIBIDA",
        o.entidad ?? ENTIDAD_DE_AUDITORIA,
        o.entidadId,
        o.antes === undefined || o.antes === null ? null : JSON.stringify(o.antes),
        o.despues === undefined || o.despues === null ? null : JSON.stringify(o.despues),
      ]);

    it("deja constancia de su solicitud, como actor `captacion`, con claves de la lista blanca; no puede leerla ni cambiarla", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        unaFila(
          await auditar(s, {
            entidadId: s1.id,
            despues: {
              estado: "NUEVA",
              marcaId: principal,
              rubro: "bar",
              provincia: "AR-B",
              campania: "verano",
              medicionConsentida: false,
              versionDeTerminos: "2026-10-13",
              versionDePrivacidad: "2026-10-13.1",
            },
          }),
        );
        rechazado(await s.intentar("select * from auditoria_plataforma"));
        rechazado(await s.intentar("update auditoria_plataforma set accion = 'x'"), [
          "42501",
          "42703",
        ]);
        rechazado(await s.intentar("delete from auditoria_plataforma"));
      });
    });

    it("la constancia sin datos (antes y después vacíos) también vale, para otra solicitud", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        unaFila(await auditar(s, { entidadId: s1.id, antes: null, despues: null }));
      });
    });

    it("a lo sumo una constancia de cada acción por solicitud, y de cada reenvío por su número (del 1 al 5): la landing no llena la auditoría", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        const repetida = async (o: Parameters<typeof auditar>[1]) => {
          const r = await auditar(s, o);
          expect(r.ok, "tenía que rechazarse").toBe(false);
          if (!r.ok) {
            expect(r.codigo).toBe("23505");
            expect(r.restriccion).toBe("auditoria_plataforma_captacion_uk");
          }
        };
        unaFila(await auditar(s, { entidadId: s1.id, despues: { estado: "NUEVA" } }));
        // la misma acción otra vez, con los mismos datos o con otros
        await repetida({ entidadId: s1.id, despues: { estado: "NUEVA" } });
        await repetida({ entidadId: s1.id });
        await repetida({ entidadId: s1.id, despues: { estado: "NUEVA", rubro: "bar" } });
        // los reenvíos: uno por número
        unaFila(
          await s.intentar(
            "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1",
            [s1.id, new Date(T.getTime() + 120_000)],
          ),
        );
        for (let n = 2; n <= MAXIMO_DE_ENVIOS; n++) {
          unaFila(
            await auditar(s, {
              entidadId: s1.id,
              accion: "SOLICITUD_REENVIO",
              despues: { numeroDeEnvio: n },
            }),
          );
          await repetida({
            entidadId: s1.id,
            accion: "SOLICITUD_REENVIO",
            despues: { numeroDeEnvio: n },
          });
        }
        // y ningún número fuera de rango, ni sin número como si fuera otro reenvío
        for (const mal of [0, 6, 7, 99, -1, 2.5, "2", null, true]) {
          rechazado(
            await auditar(s, {
              entidadId: s1.id,
              accion: "SOLICITUD_REENVIO",
              despues: { numeroDeEnvio: mal },
            }),
          );
        }
        // un reenvío sin número cuenta como uno más (el «sin número»), y también una sola vez
        unaFila(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_REENVIO" }));
        await repetida({ entidadId: s1.id, accion: "SOLICITUD_REENVIO" });
        await repetida({
          entidadId: s1.id,
          accion: "SOLICITUD_REENVIO",
          antes: { numeroDeEnvio: 3 },
        });
      });
    });

    it("solo las tres acciones de la landing, y cada una cuando el estado de la solicitud la respalda", async () => {
      expect(ACCIONES_DE_CAPTACION).toEqual([
        "SOLICITUD_RECIBIDA",
        "SOLICITUD_REENVIO",
        "SOLICITUD_VERIFICADA",
      ]);
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        // las de la plataforma no son suyas
        for (const accion of ACCIONES_DE_PLATAFORMA) {
          rechazado(await auditar(s, { entidadId: s1.id, accion }));
        }
        rechazado(await auditar(s, { entidadId: s1.id, accion: "OTRA" }));
        rechazado(await auditar(s, { entidadId: s1.id, accion: "" }));
        // recién creada: RECIBIDA sí; REENVIO (necesita más de un envío) y VERIFICADA (necesita estarlo), no
        unaFila(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_RECIBIDA" }));
        rechazado(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_REENVIO" }));
        rechazado(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_VERIFICADA" }));
        unaFila(
          await s.intentar(
            "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1",
            [s1.id, new Date(T.getTime() + 120_000)],
          ),
        );
        unaFila(
          await auditar(s, {
            entidadId: s1.id,
            accion: "SOLICITUD_REENVIO",
            despues: { numeroDeEnvio: 2 },
          }),
        );
        rechazado(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_VERIFICADA" }));
        unaFila(
          await s.intentar(
            "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1",
            [s1.id, T],
          ),
        );
        unaFila(
          await auditar(s, {
            entidadId: s1.id,
            accion: "SOLICITUD_VERIFICADA",
            antes: { estado: "NUEVA" },
            despues: { estado: "VERIFICADA" },
          }),
        );
        // ya no está NUEVA: ni RECIBIDA ni REENVIO
        rechazado(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_RECIBIDA" }));
        rechazado(await auditar(s, { entidadId: s1.id, accion: "SOLICITUD_REENVIO" }));
      });
    });

    it("no audita a nombre de otro actor, de otra entidad ni de una solicitud que no ve", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      const ajena = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        for (const actor of [
          ADMIN,
          SOPORTE,
          "sistema",
          "plataforma",
          "Captacion",
          "captacion ",
          "",
        ]) {
          rechazado(await auditar(s, { entidadId: s1.id, actor }));
        }
        for (const entidad of ["tenant", "empresa", "solicitud", "SOLICITUD_DE_ALTA", ""]) {
          rechazado(await auditar(s, { entidadId: s1.id, entidad }));
        }
        rechazado(await auditar(s, { entidadId: ajena.id }));
        rechazado(await auditar(s, { entidadId: randomUUID() }));
        rechazado(await auditar(s, { entidadId: "x" }));
        rechazado(await auditar(s, { entidadId: `${s1.id} ` }));
      });
    });

    it("la constancia no lleva datos personales: ni claves de fuera de la lista blanca ni valores con arroba, espacios o texto libre", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        for (const datos of [
          { email: s1.email },
          { correo: s1.email },
          { nombre: "Ana Pérez" },
          { nombreContacto: "Ana" },
          { nombreNegocio: "Café" },
          { telefono: "+5491112345678" },
          { cuit: "30703088534" },
          { notaInterna: "x" },
          { idDeMedicion: randomUUID() },
          { fbclid: "abc" },
          { estado: s1.email },
          { estado: "Ana Pérez" },
          { motivo: "texto libre con espacios" },
          { campania: "a@b" },
          { rubro: "" },
          { rubro: "x".repeat(201) },
          { estado: { email: s1.email } },
          { estado: [s1.email] },
        ]) {
          rechazado(await auditar(s, { entidadId: s1.id, despues: datos }));
          rechazado(await auditar(s, { entidadId: s1.id, antes: datos }));
        }
        // un JSON que no es un objeto
        rechazado(await auditar(s, { entidadId: s1.id, despues: [] }));
        rechazado(await auditar(s, { entidadId: s1.id, despues: "x" }));
        // y sin ninguna de las dos, todo bien
        unaFila(await auditar(s, { entidadId: s1.id }));
      });
    });

    // ---- contadores ---------------------------------------------------------------------------------------

    it("cuenta con la sentencia de producción (INSERT … ON CONFLICT DO UPDATE … RETURNING): 1, 2, 3, y no baja", async () => {
      const huella = randomBytes(32).toString("hex");
      const contar = (s: SesionDePrueba) =>
        s.intentar(
          `insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, 'HORA', $2, 1)
           on conflict (clave, ventana, ventana_inicio) do update set cuenta = limite_de_captacion.cuenta + 1
           returning cuenta`,
          [`ip:${huella}`, T],
        );
      await conCaptacion(b(), {}, async (s) => {
        for (const esperada of [1, 2, 3]) {
          const r = await contar(s);
          expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
          if (r.ok) expect(r.rows).toEqual([{ cuenta: esperada }]);
        }
        const baja = await s.intentar(
          "update limite_de_captacion set cuenta = 1 where clave = $1",
          [`ip:${huella}`],
        );
        rechazado(baja, ["23514"]);
        rechazado(await s.intentar("update limite_de_captacion set clave = 'global:solicitudes'"), [
          "42501",
        ]);
        rechazado(await s.intentar("update limite_de_captacion set ventana_inicio = now()"), [
          "42501",
        ]);
      });
    });

    it("las claves de los contadores tienen que ser un HMAC o una de las dos globales (nunca una IP ni un correo en claro)", async () => {
      await conCaptacion(b(), {}, async (s) => {
        for (const mala of ["ip:203.0.113.7", "correo:ana@prueba.test", "ip:", "x"]) {
          rechazado(
            await s.intentar(
              "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, 'HORA', $2, 1)",
              [mala, T],
            ),
            ["23514"],
          );
        }
      });
    });

    // ---- PS-A7 --------------------------------------------------------------------------------------------

    it("PS-A7: la landing purga los contadores de más de 8 días y NO puede borrar uno reciente ni por SQL directo", async () => {
      expect(RETENCION_DE_CONTADORES_EN_MS).toBe(8 * 86_400_000);
      const sufijo = randomBytes(30).toString("hex"); // 60 dígitos hex
      const viejo = (horas: number, n: number) =>
        dueno.query(
          `insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta)
           values ($1, 'DIA', now() - make_interval(hours => $2::int), 1)`,
          [`correo:${String(n).padStart(4, "0")}${sufijo}`, horas],
        );
      await viejo(24 * 9, 1); // hace 9 días: se borra
      await viejo(24 * 8 + 1, 2); // hace 8 días y una hora: se borra
      await viejo(24 * 8 - 1, 3); // hace 7 días y 23 horas: se queda
      await viejo(1, 4); // reciente: se queda
      await viejo(0, 5); // ahora: se queda
      await conCaptacion(b(), {}, async (s) => {
        const r = await s.intentar(
          "delete from limite_de_captacion where clave like $1 returning clave",
          [`correo:%${sufijo}`],
        );
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.rows.map((x) => (x["clave"] as string).slice(7, 11)).sort()).toEqual([
            "0001",
            "0002",
          ]);
        }
        // «todo» es lo mismo: solo se borran los vencidos
        sinFilas(
          await s.intentar("delete from limite_de_captacion where clave like $1", [
            `correo:%${sufijo}`,
          ]),
        );
        sinFilas(
          await s.intentar("delete from limite_de_captacion where cuenta >= 1 and clave like $1", [
            `correo:%${sufijo}`,
          ]),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      // sin contexto, ni los vencidos
      await viejo(24 * 30, 6);
      await conCaptacion(b(), null, async (s) => {
        sinFilas(
          await s.intentar("delete from limite_de_captacion where clave like $1", [
            `correo:%${sufijo}`,
          ]),
        );
      });
      const { rows } = await dueno.query<{ n: string }>(
        "select substr(clave, 8, 4) as n from limite_de_captacion where clave like $1 order by 1",
        [`correo:%${sufijo}`],
      );
      expect(rows.map((x) => x.n)).toEqual(["0003", "0004", "0005", "0006"]);
      await conCaptacion(b(), {}, async (s) => {
        rechazado(await s.intentar("truncate limite_de_captacion"));
      });
    });
  });

  // ==========================================================================================================
  // PS-S4: ningún otro rol toca la solicitud ni los contadores
  // ==========================================================================================================
  describe("PS-S4: la aplicación, el grupo, los trabajos, la autenticación y el público no tocan la solicitud ni los contadores", () => {
    const abrirComo = async (rol: string): Promise<SesionDePrueba> => {
      switch (rol) {
        case "app":
          return SesionDePrueba.abrir(
            b(),
            "zuluhub_app",
            comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
          );
        case "grupo":
          return SesionDePrueba.abrir(
            b(),
            "zuluhub_grupo",
            comoGrupo(tenantId(mundo.tenant), personaId(mundo.persona)),
          );
        case "trabajos":
          return SesionDePrueba.abrir(b(), "zuluhub_trabajos", comoTrabajos());
        case "autenticacion":
          return SesionDePrueba.abrir(b(), "zuluhub_autenticacion", null);
        default:
          return SesionDePrueba.abrir(b(), "zuluhub_publico", null);
      }
    };

    it.each(["app", "grupo", "trabajos", "autenticacion", "publico"])(
      "el rol %s recibe 42501 al leer, insertar, cambiar y borrar en las dos tablas, con su contexto normal",
      async (rol) => {
        const s = await abrirComo(rol);
        try {
          for (const tabla of ["solicitud_de_alta", "limite_de_captacion"]) {
            rechazado(await s.intentar(`select 1 from ${tabla}`));
            rechazado(await s.intentar(`select count(*) from ${tabla}`));
            rechazado(await s.intentar(`insert into ${tabla} default values`));
            rechazado(await s.intentar(`update ${tabla} set cuenta = 1`), ["42501", "42703"]);
            rechazado(await s.intentar(`delete from ${tabla}`));
            rechazado(await s.intentar(`truncate ${tabla}`));
          }
          // ni siquiera con un contexto de captación firmado a mano: el rol no tiene privilegios
          const token = firmarCargaDeCaptacion(b(), { u: `zuluhub_${rol}`, c: { s: a1.id } });
          await s.intentar("select set_config('app.ctx', $1, true)", [token]);
          rechazado(await s.intentar("select id from solicitud_de_alta"));
        } finally {
          await s.cerrar();
        }
      },
    );

    it("el rol de los trabajos lee los trabajos de la landing (los procesa), y nada de la solicitud", async () => {
      const s1 = await crearSolicitud(dueno, { marca: principal });
      await conCaptacion(b(), porId(s1), async (s) => {
        unaFila(
          await s.intentar(
            "insert into trabajo (empresa_id, tipo, datos, clave_idempotencia) values (null, 'enviar_verificacion_de_solicitud', $1::jsonb, $2)",
            [JSON.stringify({ solicitudId: s1.id }), `solicitud:${s1.id}:verificacion:1`],
          ),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      const t = await SesionDePrueba.abrir(b(), "zuluhub_trabajos", comoTrabajos());
      try {
        const r = await t.intentar("select datos from trabajo where clave_idempotencia = $1", [
          `solicitud:${s1.id}:verificacion:1`,
        ]);
        expect(r.ok && r.rows).toEqual([{ datos: { solicitudId: s1.id } }]);
        rechazado(await t.intentar("select id from solicitud_de_alta"));
      } finally {
        await t.cerrar();
      }
    });
  });

  // ==========================================================================================================
  // PS-S5: la plataforma — quién decide
  // ==========================================================================================================
  describe("PS-S5: en la plataforma decide solo un ADMIN, con su id; SOPORTE mira; `sistema` solo vence y anonimiza", () => {
    const comoActor = (
      actor: "ADMIN" | "SOPORTE" | "SISTEMA",
      id: string = actor === "ADMIN" ? ADMIN : SOPORTE,
    ) =>
      SesionDePrueba.abrir(
        b(),
        "zuluhub_plataforma",
        comoPlataforma(
          actor === "SISTEMA"
            ? { tipo: "SISTEMA", proceso: "barrido-de-solicitudes" }
            : { tipo: "ADMIN", id: adminPlataformaId(id) },
        ),
      );
    const conActor = async <R>(
      actor: "ADMIN" | "SOPORTE" | "SISTEMA",
      trabajo: (s: SesionDePrueba) => Promise<R>,
      id?: string,
    ): Promise<R> => {
      const s = await comoActor(actor, id);
      try {
        return await trabajo(s);
      } finally {
        await s.cerrar();
      }
    };

    it("un ADMIN y SOPORTE leen todas las solicitudes; el sistema también; sin actor vigente no se lee nada", async () => {
      for (const actor of ["ADMIN", "SOPORTE", "SISTEMA"] as const) {
        await conActor(actor, async (s) => {
          const r = await s.intentar(
            "select id, nombre_contacto, telefono, cuit from solicitud_de_alta",
          );
          expect(r.ok && r.rows.length).toBeGreaterThanOrEqual(6);
        });
      }
      // un administrador que no existe: ve 0 filas
      await conActor(
        "ADMIN",
        async (s) => sinFilas(await s.intentar("select 1 from solicitud_de_alta")),
        randomUUID(),
      );
      // sin contexto de plataforma
      const sinCtx = await SesionDePrueba.abrirConToken(b(), "zuluhub_plataforma", null);
      try {
        sinFilas(await sinCtx.intentar("select 1 from solicitud_de_alta"));
        sinFilas(await sinCtx.intentar("update solicitud_de_alta set estado = estado"));
      } finally {
        await sinCtx.cerrar();
      }
    });

    it("SOPORTE no decide: su UPDATE afecta 0 filas, para cualquier cambio (aprobar, rechazar, spam, anonimizar)", async () => {
      const v = await crearSolicitud(dueno, { marca: principal, estado: "VERIFICADA" });
      const n = await crearSolicitud(dueno, { marca: principal });
      const c = await crearSolicitud(dueno, { marca: principal, estado: "SPAM" });
      await conActor("SOPORTE", async (s) => {
        sinFilas(
          await s.intentar(
            "update solicitud_de_alta set estado = 'APROBADA', decidida_por = $2, decidida_en = $3 where id = $1",
            [v.id, SOPORTE, T],
          ),
        );
        sinFilas(
          await s.intentar(
            "update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'OTRO', decidida_por = $2, decidida_en = $3 where id = $1",
            [v.id, SOPORTE, T],
          ),
        );
        sinFilas(
          await s.intentar(
            "update solicitud_de_alta set estado = 'SPAM', decidida_por = $2, decidida_en = $3 where id = $1",
            [n.id, SOPORTE, T],
          ),
        );
        sinFilas(
          await s.intentar(
            `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null, nombre_negocio = null,
               telefono = null, cuit = null, id_de_medicion = null, nota_interna = null where id = $1`,
            [c.id, T],
          ),
        );
        sinFilas(
          await s.intentar("update solicitud_de_alta set nota_interna = 'x' where id = $1", [v.id]),
        );
      });
      expect((await filaDe(dueno, v.id))["estado"]).toBe("VERIFICADA");
      expect((await filaDe(dueno, c.id))["anonimizada_en"]).toBeNull();
    });

    it("un ADMIN decide con su id: aprobar a nombre de otro administrador o del sistema se rechaza (42501)", async () => {
      const v = await crearSolicitud(dueno, { marca: principal, estado: "VERIFICADA" });
      await conActor("ADMIN", async (s) => {
        const aprobar = (por: string) =>
          s.intentar(
            "update solicitud_de_alta set estado = 'APROBADA', decidida_por = $2, decidida_en = $3 where id = $1",
            [v.id, por, T],
          );
        rechazado(await aprobar(SOPORTE));
        rechazado(await aprobar("sistema"));
        rechazado(await aprobar(randomUUID()));
        unaFila(await aprobar(ADMIN));
        expect((await s.confirmar()).ok).toBe(true);
      });
      const fila = await filaDe(dueno, v.id);
      expect(fila).toMatchObject({ estado: "APROBADA", decidida_por: ADMIN });
    });

    it("un ADMIN no anonimiza (eso es del sistema) y no toca la fila sin decidir a su nombre", async () => {
      const c = await crearSolicitud(dueno, { marca: principal, estado: "SPAM" });
      await conActor("ADMIN", async (s) => {
        rechazado(
          await s.intentar(
            `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null, nombre_negocio = null,
               telefono = null, cuit = null, id_de_medicion = null, nota_interna = null, decidida_por = $3 where id = $1`,
            [c.id, T, ADMIN],
          ),
        );
        // ni siquiera con su id en la fila ya decidida
        rechazado(
          await s.intentar("update solicitud_de_alta set nota_interna = 'x' where id = $1", [c.id]),
          ["23514", "42501"],
        );
        // columnas que ningún cambio de la plataforma toca (sin GRANT)
        for (const set of [
          "rubro = 'bar'",
          "marca_id = gen_random_uuid()",
          "creada_en = now()",
          "numero_de_envios = 2",
          "verificada_en = now()",
          "version = 9",
        ]) {
          rechazado(await s.intentar(`update solicitud_de_alta set ${set} where id = $1`, [c.id]));
        }
        rechazado(await s.intentar("delete from solicitud_de_alta where id = $1", [c.id]));
        rechazado(await s.intentar("truncate solicitud_de_alta"));
        rechazado(await s.intentar("insert into solicitud_de_alta default values"));
      });
    });

    it("un ADMIN dado de baja pierde la lectura y la escritura aunque su token siga vigente", async () => {
      const efimero = randomUUID();
      await dueno.query("insert into admin_plataforma (id, email, rol) values ($1, $2, 'ADMIN')", [
        efimero,
        `efimero-${efimero.slice(0, 8)}@prueba.test`,
      ]);
      const v = await crearSolicitud(dueno, { marca: principal, estado: "VERIFICADA" });
      await conActor(
        "ADMIN",
        async (s) => {
          expect(
            filas(await s.intentar("select 1 from solicitud_de_alta where id = $1", [v.id])),
          ).toBe(1);
          await dueno.query("update admin_plataforma set activo = false where id = $1", [efimero]);
          sinFilas(await s.intentar("select 1 from solicitud_de_alta where id = $1", [v.id]));
          sinFilas(
            await s.intentar(
              "update solicitud_de_alta set estado = 'SPAM', decidida_por = $2, decidida_en = $3 where id = $1",
              [v.id, efimero, T],
            ),
          );
        },
        efimero,
      );
    });

    it("el sistema vence una NUEVA (NO_VERIFICADA) y la anonimiza en el mismo paso; no puede aprobar ni rechazar con otro motivo", async () => {
      const n = await crearSolicitud(dueno, { marca: principal, nota: null });
      const v = await crearSolicitud(dueno, { marca: principal, estado: "VERIFICADA" });
      await conActor("SISTEMA", async (s) => {
        // lo que no le corresponde
        rechazado(
          await s.intentar(
            "update solicitud_de_alta set estado = 'APROBADA', decidida_por = 'sistema', decidida_en = $2 where id = $1",
            [v.id, T],
          ),
        );
        rechazado(
          await s.intentar(
            "update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'OTRO', decidida_por = 'sistema', decidida_en = $2 where id = $1",
            [n.id, T],
          ),
        );
        rechazado(
          await s.intentar(
            "update solicitud_de_alta set estado = 'SPAM', decidida_por = 'sistema', decidida_en = $2 where id = $1",
            [n.id, T],
          ),
        );
        // rechazar por NO_VERIFICADA una que sí se verificó lo frena la CHECK, no solo la política
        rechazado(
          await s.intentar(
            "update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'NO_VERIFICADA', decidida_por = 'sistema', decidida_en = $2 where id = $1",
            [v.id, T],
          ),
          ["23514"],
        );
        // aunque lo haga a nombre de un administrador
        rechazado(
          await s.intentar(
            "update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'NO_VERIFICADA', decidida_por = $3, decidida_en = $2 where id = $1",
            [n.id, T, ADMIN],
          ),
        );
        // lo que sí: vencer y anonimizar
        unaFila(
          await s.intentar(
            "update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'NO_VERIFICADA', decidida_por = 'sistema', decidida_en = $2 where id = $1",
            [n.id, T],
          ),
        );
        unaFila(
          await s.intentar(
            `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null, nombre_negocio = null,
               telefono = null, cuit = null, id_de_medicion = null, nota_interna = null, atribucion = atribucion - 'fbclid'
             where id = $1`,
            [n.id, T],
          ),
        );
        // una abierta no se anonimiza
        rechazado(
          await s.intentar(
            `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null, nombre_negocio = null,
               telefono = null, cuit = null, id_de_medicion = null, nota_interna = null where id = $1`,
            [v.id, T],
          ),
          ["23514"],
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      const fila = await filaDe(dueno, n.id);
      expect(fila).toMatchObject({
        estado: "RECHAZADA",
        motivo_de_rechazo: "NO_VERIFICADA",
        decidida_por: "sistema",
        email: null,
        nombre_contacto: null,
        telefono: null,
        cuit: null,
        rubro: "cafeteria",
        provincia: "AR-B",
        atribucion: { utm_source: "meta", utm_campaign: "verano" },
      });
      expect(fila["anonimizada_en"]).toEqual(T);
    });

    it("el sistema anonimiza una cerrada de más de 90 días (cualquiera de las tres terminales) y quita el fbclid", async () => {
      await conActor("SISTEMA", async (s) => {
        for (const estado of ["ALTA_CREADA", "RECHAZADA", "SPAM"] as const) {
          const c = await crearSolicitud(dueno, {
            marca: principal,
            estado,
            medicionConsentida: true,
            atribucion: { utm_source: "meta", fbclid: "abc" },
            creadaEn: new Date(T.getTime() - 100 * 86_400_000),
          });
          unaFila(
            await s.intentar(
              `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null, nombre_negocio = null,
                 telefono = null, cuit = null, id_de_medicion = null, nota_interna = null, atribucion = atribucion - 'fbclid'
               where id = $1`,
              [c.id, T],
            ),
          );
        }
      });
    });
  });

  // ==========================================================================================================
  // El actor de cada transición: la tabla del dominio contra la base, rol por rol
  // ==========================================================================================================
  describe("quién hace cada transición: la base coincide con transicionPermitida del dominio", () => {
    type ActorDePrueba = ActorDeSolicitud | "SOPORTE";

    /** Lo que ese actor intentaría para llevar la solicitud a `hasta`, con los parámetros $2 = ahora, $3 = id, $4 = empresa. */
    const cambioDe = (actor: ActorDePrueba, hasta: EstadoDeSolicitud): string => {
      switch (actor) {
        case "CAPTACION":
          return hasta === "VERIFICADA"
            ? "estado = 'VERIFICADA', verificada_en = $2"
            : `estado = '${hasta}'`;
        case "SISTEMA":
          return `estado = '${hasta}', decidida_por = 'sistema', decidida_en = $2, motivo_de_rechazo = ${
            hasta === "RECHAZADA" ? "'NO_VERIFICADA'" : "null"
          }${hasta === "ALTA_CREADA" ? ", empresa_creada_id = $4" : ""}`;
        default: {
          // ADMIN y SOPORTE intentan lo mismo, cada uno con su id
          const decision =
            hasta === "NUEVA" || hasta === "VERIFICADA"
              ? ""
              : `, decidida_por = $3, decidida_en = $2, motivo_de_rechazo = ${
                  hasta === "RECHAZADA" ? "'OTRO'" : "null"
                }${hasta === "ALTA_CREADA" ? ", empresa_creada_id = $4" : ""}`;
          return `estado = '${hasta}'${hasta === "VERIFICADA" ? ", verificada_en = $2" : ""}${decision}`;
        }
      }
    };

    const parametrosDe = (texto: string, todos: unknown[]) =>
      todos.slice(0, Math.max(...[...texto.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))));

    it.each<ActorDePrueba>(["CAPTACION", "ADMIN", "SISTEMA", "SOPORTE"])(
      "%s: de los 30 pares (desde, hasta) logra exactamente los que el dominio le permite",
      async (actor) => {
        const s =
          actor === "CAPTACION"
            ? null
            : await SesionDePrueba.abrir(
                b(),
                "zuluhub_plataforma",
                comoPlataforma(
                  actor === "SISTEMA"
                    ? { tipo: "SISTEMA", proceso: "barrido-de-solicitudes" }
                    : { tipo: "ADMIN", id: adminPlataformaId(actor === "ADMIN" ? ADMIN : SOPORTE) },
                ),
              );
        const lograron: string[] = [];
        const esperados: string[] = [];
        try {
          for (const desde of ESTADOS_DE_SOLICITUD) {
            for (const hasta of ESTADOS_DE_SOLICITUD) {
              if (desde === hasta) continue;
              const fila = await crearSolicitud(dueno, { marca: principal, estado: desde });
              const empresa = (await crearMundoDeMarca(dueno, { marca: principal })).empresa;
              const texto = `update solicitud_de_alta set ${cambioDe(actor, hasta)} where id = $1`;
              const parametros = parametrosDe(texto, [
                fila.id,
                T,
                actor === "SOPORTE" ? SOPORTE : ADMIN,
                empresa,
              ]);
              const r =
                s === null
                  ? await (async () => {
                      const sc = await sesionDeCaptacion(b(), porId(fila));
                      try {
                        return await sc.intentar(texto, parametros);
                      } finally {
                        await sc.cerrar();
                      }
                    })()
                  : await s.intentar(texto, parametros);
              if (r.ok && r.filas === 1) lograron.push(`${desde}>${hasta}`);
              if (actor !== "SOPORTE" && transicionPermitida(desde, hasta, actor)) {
                esperados.push(`${desde}>${hasta}`);
              }
            }
          }
        } finally {
          await s?.cerrar();
        }
        expect(lograron.sort()).toEqual(esperados.sort());
        // el control no pasa por vacío: cada actor (salvo SOPORTE) logra algo
        if (actor !== "SOPORTE") expect(esperados.length).toBeGreaterThan(0);
      },
    );
  });
});
