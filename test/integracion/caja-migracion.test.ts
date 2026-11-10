import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { comoPlataforma, crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import {
  acepta,
  check,
  clave,
  conAppDe,
  conPlataformaDe,
  crearMundo,
  denegado,
  filas,
  referencia,
  type Mundo,
} from "./fiscal-apoyo";
import {
  AHORA,
  DESPUES,
  HUELLA,
  TIPOS_DE_MEDIO,
  abrirSesion,
  asegurarJornada,
  claveNueva,
  cerrarSesion,
  cobrar,
  crearCaja,
  crearEscenario,
  fechaDeNegocioEn,
  filaDeCobro,
  filasDe,
  movimiento,
  textoDe,
  type Escenario,
  type TipoDeMedio,
} from "./caja-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * La migración 0027 (caja y cobros, E3 §5.3 «Base con SQL directo»): con el rol de la aplicación y su contexto firmado se prueba cada
 * defensa de la base sin pasar por el módulo (que todavía no existe en este tramo): la sesión y su sello, el movimiento y su signo, la
 * anulación espejo, el cobro y sus datos, el medio y la cuenta, el arqueo y el cierre completo, la solo inserción (también para el dueño),
 * las listas del sistema, el aislamiento entre empresas y la reversión. Lo diferido (cierre completo, cobro sin fila) se prueba con
 * `set constraints all immediate` o confirmando.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

/** Lo que falla al confirmar (una restricción diferida) o al adelantarla. */
const alConfirmar = async (s: SesionDePrueba): Promise<Intento> => s.confirmar();
const adelantar = (s: SesionDePrueba): Promise<Intento> =>
  s.intentar("set constraints all immediate");

describe.skipIf(base === null)(
  "migración 0027: caja y cobros (SQL directo, rol de la aplicación)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let m: Mundo;
    let otra: Mundo;
    let esc: Escenario;
    let escOtra: Escenario;
    let cajaDos: string;
    let sucursalDos: string;
    let terminalDeOtraSucursal: string;
    let marcaInactiva: string;
    let marcaVisa: string;
    let motivoDeRechazo: string;
    /** Una sesión cerrada con cobros, arqueo y billetes, ya confirmada: para lo que el dueño intenta sobre datos ya guardados. */
    let cerradaConfirmada: string;

    const b = () => propia.base;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      m = await crearMundo(dueno);
      otra = await crearMundo(dueno);
      esc = await crearEscenario(dueno, m);
      escOtra = await crearEscenario(dueno, otra);
      cajaDos = await crearCaja(dueno, m, "Caja 2");
      sucursalDos = (
        await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Sucursal dos') returning id",
          [m.empresa],
        )
      ).rows[0]?.id as string;
      terminalDeOtraSucursal = (
        await dueno.query<{ id: string }>(
          `insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Terminal 2', $2) returning id`,
          [m.empresa, sucursalDos],
        )
      ).rows[0]?.id as string;
      // Una marca desactivada (la plataforma la desactivó después de usarse) para probar el cobro nuevo; la dueña de la base puede escribir la lista.
      marcaInactiva = (
        await dueno.query<{ id: string }>(
          `insert into valor_de_lista (lista, nombre, activo) values ('MARCAS_DE_TARJETA', 'Marca vieja', false) returning id`,
        )
      ).rows[0]?.id as string;
      marcaVisa = (
        await dueno.query<{ id: string }>(
          `select id from valor_de_lista where lista = 'MARCAS_DE_TARJETA' and nombre = 'Visa'`,
        )
      ).rows[0]?.id as string;
      motivoDeRechazo = (
        await dueno.query<{ id: string }>(
          `select id from valor_de_lista where lista = 'MOTIVOS_DE_RECHAZO' and nombre = 'Temperatura'`,
        )
      ).rows[0]?.id as string;

      // Jornadas de otras fechas, confirmadas: una CERRADA (a corregir) y una EN_AUDITORIA.
      await conAppDe(b(), m, async (s) => {
        await asegurarJornada(s, m, "2026-10-01");
        await asegurarJornada(s, m, "2026-10-02");
        for (const fecha of ["2026-10-01", "2026-10-02"]) {
          acepta(
            await s.intentar(
              `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $3, auditoria_iniciada_por = $4
              where empresa_id = $1 and fecha_negocio = $2`,
              [m.empresa, fecha, AHORA, m.persona],
            ),
          );
        }
        acepta(
          await s.intentar(
            `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, huella_de_cierre = $4
            where empresa_id = $1 and fecha_negocio = '2026-10-01'`,
            [m.empresa, DESPUES, m.persona, HUELLA],
          ),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });

      // La sesión cerrada y confirmada de la caja dos: flujo completo de apertura, cobros y cierre (el diferido de cierre pasa).
      await conAppDe(b(), m, async (s) => {
        const { sesion } = await abrirSesion(s, esc, { caja: cajaDos, fondo: "1000.00" });
        cerradaConfirmada = sesion;
        await cobrar(s, esc, sesion, { medio: "EFECTIVO", importe: "500.00" });
        await cobrar(s, esc, sesion, {
          medio: "TARJETA_DEBITO",
          cuenta: esc.cuentas.terminal,
          importe: "18400.00",
        });
        await cerrarSesion(s, esc, sesion, { billetes: { 1000: 1, 500: 1 }, monedas: "0.00" });
        const r = await s.confirmar();
        expect(r.ok, r.ok ? "" : `${r.restriccion}: ${r.mensaje}`).toBe(true);
      });
    });
    afterAll(async () => {
      await dueno.end();
      await propia.destruir();
    });

    /** Una sesión abierta y su caja libre: dentro de la transacción de la prueba, que se deshace sola. */
    const conSesion = async <T>(
      trabajo: (s: SesionDePrueba, sesion: string, fecha: string) => Promise<T>,
      opciones: { abiertaEn?: string; fondo?: string } = {},
    ): Promise<T> =>
      conAppDe(b(), m, async (s) => {
        const { sesion, fecha } = await abrirSesion(s, esc, opciones);
        return trabajo(s, sesion, fecha);
      });

    const insertarSesion = (
      s: SesionDePrueba,
      campos: Partial<{
        caja: string;
        fecha: string;
        corte: string;
        zona: string;
        abiertaEn: string;
        persona: string;
        estado: string;
      }> = {},
      e: Escenario = esc,
    ) =>
      s.intentar(
        `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                               clave_idempotencia, huella)
       values ($1, $2, $3, $4::time, $5, $6, $7, $8, $9) returning id`,
        [
          e.m.empresa,
          campos.caja ?? e.caja,
          campos.fecha ?? "2026-11-09",
          campos.corte ?? "00:00:00",
          campos.zona ?? "America/Argentina/Buenos_Aires",
          campos.abiertaEn ?? AHORA,
          campos.persona ?? e.m.persona,
          claveNueva(),
          HUELLA,
        ],
      );

    // ---------------------------------------------------------------------------------------------
    describe("estructura y privilegios", () => {
      it("las quince tablas existen con RLS activa y forzada, y el grupo y los trabajos no tienen nada", async () => {
        const { rows } = await dueno.query<{ relname: string; on: boolean; forzada: boolean }>(
          `select relname, relrowsecurity as on, relforcerowsecurity as forzada from pg_class
          where relname = any($1) order by relname`,
          [
            [
              "caja",
              "medio_de_pago",
              "cuenta_de_cobro",
              "sesion_caja",
              "movimiento_caja",
              "cobro",
              "arqueo_caja",
              "arqueo_billete",
              "valor_de_lista",
              "correccion_de_medio",
              "declaracion_de_total",
              "conforme_de_jornada",
              "cierre_de_caja_de_jornada",
              "conciliacion_de_jornada",
              "conciliacion_de_cobro_por_origen",
            ],
          ],
        );
        expect(rows).toHaveLength(15);
        for (const t of rows) expect(t, t.relname).toMatchObject({ on: true, forzada: true });
        for (const rol of ["pedernal_grupo", "pedernal_trabajos", "pedernal_publico"]) {
          for (const t of rows) {
            const { rows: p } = await dueno.query<{ ok: boolean }>(
              "select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') as ok",
              [rol, t.relname],
            );
            expect(p[0]?.ok, `${rol} sobre ${t.relname}`).toBe(false);
          }
        }
      });

      it("nadie borra ni vacía: la aplicación ni la plataforma tienen DELETE ni TRUNCATE sobre ninguna", async () => {
        const { rows } = await dueno.query<{ rol: string; tabla: string }>(
          `select r.rolname as rol, c.relname as tabla
           from pg_roles r cross join pg_class c
          where r.rolname in ('pedernal_app', 'pedernal_plataforma') and c.relnamespace = 'public'::regnamespace
            and c.relname in ('caja', 'medio_de_pago', 'cuenta_de_cobro', 'sesion_caja', 'movimiento_caja', 'cobro', 'arqueo_caja',
                              'arqueo_billete', 'valor_de_lista', 'correccion_de_medio', 'declaracion_de_total',
                              'conforme_de_jornada', 'cierre_de_caja_de_jornada', 'conciliacion_de_jornada',
                              'conciliacion_de_cobro_por_origen')
            and has_table_privilege(r.rolname, c.oid, 'DELETE, TRUNCATE')`,
        );
        expect(rows).toEqual([]);
      });

      it("la plataforma solo toca las listas, y la aplicación solo las lee", async () => {
        const { rows } = await dueno.query<{ rol: string; tabla: string }>(
          `select r.rolname as rol, c.relname as tabla
           from pg_roles r cross join pg_class c
          where r.rolname = 'pedernal_plataforma' and c.relnamespace = 'public'::regnamespace
            and c.relname in ('caja', 'medio_de_pago', 'cuenta_de_cobro', 'sesion_caja', 'movimiento_caja', 'cobro', 'arqueo_caja',
                              'arqueo_billete', 'correccion_de_medio', 'declaracion_de_total', 'conforme_de_jornada',
                              'cierre_de_caja_de_jornada', 'conciliacion_de_jornada', 'conciliacion_de_cobro_por_origen')
            and has_table_privilege(r.rolname, c.oid, 'SELECT')`,
        );
        expect(rows).toEqual([]);
        const { rows: app } = await dueno.query<{ puede: boolean }>(
          `select has_table_privilege('pedernal_app', 'valor_de_lista', 'INSERT') or has_table_privilege('pedernal_app', 'valor_de_lista', 'UPDATE') as puede`,
        );
        expect(app[0]?.puede).toBe(false);
      });

      it("el sello de la sesión no tiene UPDATE para nadie, ni las tablas de solo inserción", async () => {
        const { rows } = await dueno.query<{ tabla: string; columna: string }>(
          `select table_name as tabla, column_name as columna from information_schema.column_privileges
          where table_schema = 'public' and grantee = 'pedernal_app' and privilege_type = 'UPDATE'
            and (table_name in ('movimiento_caja', 'cobro', 'arqueo_caja', 'arqueo_billete', 'correccion_de_medio', 'declaracion_de_total',
                                'conforme_de_jornada', 'cierre_de_caja_de_jornada', 'conciliacion_de_jornada',
                                'conciliacion_de_cobro_por_origen')
                 or (table_name = 'sesion_caja' and column_name in ('fecha_negocio', 'hora_de_corte', 'zona_horaria', 'abierta_en',
                                                                    'abierta_por', 'caja_id', 'clave_idempotencia', 'huella'))
                 or (table_name = 'medio_de_pago' and column_name in ('tipo', 'empresa_id'))
                 or (table_name = 'caja' and column_name in ('sucursal_id', 'empresa_id')))`,
        );
        expect(rows).toEqual([]);
      });

      it("toda función nueva fija su search_path y ninguna es SECURITY DEFINER ni ejecutable por PUBLIC", async () => {
        const { rows } = await dueno.query<{
          proname: string;
          fijo: boolean;
          definer: boolean;
          publica: boolean;
        }>(
          `select p.proname,
                coalesce('search_path=pg_catalog, public, pg_temp' = any (p.proconfig), false) as fijo,
                p.prosecdef as definer,
                (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) as publica
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('fecha_de_negocio', 'cuenta_admitida_por_medio', 'par_de_cobro_validar', 'caja_validar_cambio',
                              'medio_de_pago_validar_cambio', 'cuenta_de_cobro_validar_cambio', 'sesion_caja_validar_alta',
                              'sesion_caja_validar_cambio', 'movimiento_caja_validar_alta', 'movimiento_caja_verificar_documento',
                              'valor_de_lista_validar_cambio', 'cobro_validar_alta', 'arqueo_caja_validar_alta',
                              'arqueo_billete_validar_alta', 'arqueo_verificar_sesion_cerrada', 'sesion_caja_verificar_cierre',
                              'correccion_de_medio_validar_alta', 'declaracion_de_total_validar_alta',
                              'conforme_de_jornada_validar_alta', 'cierre_de_caja_validar_alta',
                              'conciliacion_de_jornada_validar_alta', 'conciliacion_de_cobro_validar_alta',
                              'cierre_de_caja_verificar')`,
        );
        expect(rows).toHaveLength(23);
        for (const f of rows) {
          expect(f, f.proname).toMatchObject({ fijo: true, definer: false, publica: false });
        }
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("sesión de caja: el sello, la jornada y las transiciones", () => {
      it("una sesión nace ABIERTA con su sello, su fondo y su jornada, y repetir la clave no la duplica", async () => {
        await conAppDe(b(), m, async (s) => {
          const { sesion, fecha } = await abrirSesion(s, esc);
          expect(fecha).toBe("2026-11-09");
          const leida = filasDe(
            await s.intentar(
              "select estado, fecha_negocio::text as f, hora_de_corte::text as corte, zona_horaria, version from sesion_caja where id = $1",
              [sesion],
            ),
          );
          expect(leida).toEqual([
            {
              estado: "ABIERTA",
              f: "2026-11-09",
              corte: "00:00:00",
              zona_horaria: "America/Argentina/Buenos_Aires",
              // Versión 2: el fondo, cargado en `read committed`, toca la sesión (ver `movimiento_caja_validar_alta`).
              version: 2,
            },
          ]);
          const claveDuplicada = await s.intentar(
            `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                   clave_idempotencia, huella)
           select empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por, clave_idempotencia, huella
             from sesion_caja where id = $1`,
            [sesion],
          );
          clave(claveDuplicada, "sesion_caja_clave_uk");
        });
      });

      it("una sola sesión no cerrada por caja (sesion_caja_vigente_uk); en otra caja sí", async () => {
        await conSesion(async (s) => {
          clave(await insertarSesion(s), "sesion_caja_vigente_uk");
          acepta(await insertarSesion(s, { caja: cajaDos }));
        });
      });

      it("el sello tiene que ser el vigente: otra hora de corte, otra zona o una fecha que no da la fórmula se rechazan", async () => {
        await conAppDe(b(), m, async (s) => {
          await asegurarJornada(s, m, "2026-11-09");
          check(await insertarSesion(s, { corte: "06:00:00" }), "sesion_caja_sello_invalido");
          check(
            await insertarSesion(s, { zona: "America/Montevideo" }),
            "sesion_caja_sello_invalido",
          );
          check(
            await insertarSesion(s, { fecha: "2026-11-08" }),
            "sesion_caja_fecha_negocio_invalida",
          );
          check(
            await insertarSesion(s, { fecha: "2026-11-10" }),
            "sesion_caja_fecha_negocio_invalida",
          );
          acepta(await insertarSesion(s));
        });
      });

      it("con corte 06:00 en la sucursal, abrir a las 05:30 es la jornada del día anterior; el sello lo exige la base", async () => {
        const mundo = await crearMundo(dueno);
        const e = await crearEscenario(dueno, mundo);
        await dueno.query("update sucursal set hora_de_corte = '06:00' where id = $1", [
          mundo.sucursal,
        ]);
        await conAppDe(b(), mundo, async (s) => {
          // 05:30 en Buenos Aires = 08:30Z
          const instante = "2026-11-10T08:30:00Z";
          const { fecha } = await fechaDeNegocioEn(s, mundo, instante);
          expect(fecha).toBe("2026-11-09");
          await asegurarJornada(s, mundo, "2026-11-09");
          await asegurarJornada(s, mundo, "2026-11-10");
          check(
            await insertarSesion(
              s,
              { corte: "06:00:00", fecha: "2026-11-10", abiertaEn: instante },
              e,
            ),
            "sesion_caja_fecha_negocio_invalida",
          );
          check(
            await insertarSesion(
              s,
              { corte: "00:00:00", fecha: "2026-11-10", abiertaEn: instante },
              e,
            ),
            "sesion_caja_sello_invalido",
          );
          acepta(
            await insertarSesion(
              s,
              { corte: "06:00:00", fecha: "2026-11-09", abiertaEn: instante },
              e,
            ),
          );
        });
      });

      it("la caja o la sucursal desactivadas no abren; la persona del contexto es quien abre", async () => {
        await conAppDe(b(), m, async (s) => {
          await asegurarJornada(s, m, "2026-11-09");
          acepta(await s.intentar("update caja set activa = false where id = $1", [esc.caja]));
          check(await insertarSesion(s), "sesion_caja_caja_inactiva");
          acepta(await s.intentar("update caja set activa = true where id = $1", [esc.caja]));
          check(await insertarSesion(s, { persona: otra.persona }), "sesion_caja_actor_invalido");
        });
        const mundo = await crearMundo(dueno);
        const e = await crearEscenario(dueno, mundo);
        const segunda = (
          await dueno.query<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Otra sucursal') returning id",
            [mundo.empresa],
          )
        ).rows[0]?.id as string;
        const cajaDeLaSegunda = await crearCaja(
          dueno,
          { empresa: mundo.empresa, sucursal: segunda },
          "Caja S2",
        );
        await dueno.query("update sucursal set activa = false where id = $1", [segunda]);
        await conAppDe(b(), mundo, async (s) => {
          await asegurarJornada(
            s,
            { empresa: mundo.empresa, sucursal: segunda },
            "2026-11-09",
          ).catch(() => undefined);
          check(
            await insertarSesion(s, { caja: cajaDeLaSegunda }, e),
            "sesion_caja_sucursal_inactiva",
          );
        });
      });

      it("sin jornada ABIERTA no se abre caja: inexistente, EN_AUDITORIA o CERRADA (sesion_caja_jornada_no_abierta)", async () => {
        await conAppDe(b(), m, async (s) => {
          // 2026-10-03: no hay jornada. 2026-10-02: EN_AUDITORIA. 2026-10-01: CERRADA.
          check(
            await insertarSesion(s, { fecha: "2026-10-03", abiertaEn: "2026-10-03T15:00:00Z" }),
            "sesion_caja_jornada_no_abierta",
          );
          check(
            await insertarSesion(s, { fecha: "2026-10-02", abiertaEn: "2026-10-02T15:00:00Z" }),
            "sesion_caja_jornada_no_abierta",
          );
          check(
            await insertarSesion(s, { fecha: "2026-10-01", abiertaEn: "2026-10-01T15:00:00Z" }),
            "sesion_caja_jornada_no_abierta",
          );
        });
      });

      it("una sesión no nace en otro estado que ABIERTA, ni con marcas de cierre, ni con una huella o clave inválidas", async () => {
        await conAppDe(b(), m, async (s) => {
          await asegurarJornada(s, m, "2026-11-09");
          denegado(
            await s.intentar(
              `insert into sesion_caja (empresa_id, caja_id, estado, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                     clave_idempotencia, huella)
             values ($1, $2, 'CERRADA', '2026-11-09', '00:00', 'America/Argentina/Buenos_Aires', $3, $4, $5, $6)`,
              [m.empresa, esc.caja, AHORA, m.persona, claveNueva(), HUELLA],
            ),
          );
          check(
            await s.intentar(
              `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                     clave_idempotencia, huella)
             values ($1, $2, '2026-11-09', '00:00', 'America/Argentina/Buenos_Aires', $3, $4, 'corta', $5)`,
              [m.empresa, esc.caja, AHORA, m.persona, HUELLA],
            ),
            "sesion_caja_clave_ck",
          );
          check(
            await s.intentar(
              `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                     clave_idempotencia, huella)
             values ($1, $2, '2026-11-09', '00:00', 'America/Argentina/Buenos_Aires', $3, $4, $5, 'xyz')`,
              [m.empresa, esc.caja, AHORA, m.persona, claveNueva()],
            ),
            "sesion_caja_huella_ck",
          );
        });
      });

      it("transiciones exactas de la sesión: ABIERTA → EN_CIERRE | CERRADA y EN_CIERRE → ABIERTA | CERRADA, y nada más", async () => {
        const PERMITIDAS = new Set([
          "ABIERTA>EN_CIERRE",
          "ABIERTA>CERRADA",
          // El toque sin cambios que hace un movimiento cargado fuera de `serializable` (hueco de dinero del cierre).
          "ABIERTA>ABIERTA",
          "EN_CIERRE>ABIERTA",
          "EN_CIERRE>CERRADA",
        ]);
        const ESTADOS = ["ABIERTA", "EN_CIERRE", "CERRADA"] as const;
        const iniciar = (s: SesionDePrueba, sesion: string) =>
          s.intentar(
            `update sesion_caja set estado = 'EN_CIERRE', cierre_iniciado_en = $2, cierre_iniciado_por = $3 where id = $1`,
            [sesion, AHORA, m.persona],
          );
        const cancelar = (s: SesionDePrueba, sesion: string) =>
          s.intentar(
            `update sesion_caja set estado = 'ABIERTA', cierre_iniciado_en = null, cierre_iniciado_por = null where id = $1`,
            [sesion],
          );
        const cerrar = (s: SesionDePrueba, sesion: string, desde: string) =>
          s.intentar(
            desde === "ABIERTA"
              ? `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $2, cierre_iniciado_por = $3, cerrada_en = $2,
                                       cerrada_por = $3 where id = $1`
              : `update sesion_caja set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3 where id = $1`,
            [sesion, DESPUES, m.persona],
          );
        // El toque de una sesión abierta no admite ningún cambio de datos.
        await conSesion(async (s, sesion) => {
          check(
            await s.intentar(
              "update sesion_caja set cerrada_en = $2 where id = $1 and estado = 'ABIERTA'",
              [sesion, DESPUES],
            ),
            "sesion_caja_transicion_invalida",
          );
          check(
            await s.intentar(
              "update sesion_caja set estado = 'ABIERTA', observacion = 'x' where id = $1",
              [sesion],
            ),
            "sesion_caja_transicion_invalida",
          );
        });
        for (const desde of ESTADOS) {
          for (const hacia of ESTADOS) {
            await conSesion(async (s, sesion) => {
              if (desde !== "ABIERTA") acepta(await iniciar(s, sesion));
              if (desde === "CERRADA") {
                // Se llega a CERRADA desde EN_CIERRE (queda EN_CIERRE → CERRADA).
                acepta(await cerrar(s, sesion, "EN_CIERRE"));
              }
              const r =
                hacia === "EN_CIERRE"
                  ? await iniciar(s, sesion)
                  : hacia === "ABIERTA"
                    ? await cancelar(s, sesion)
                    : await cerrar(s, sesion, desde);
              // Desde CERRADA la política de UPDATE ni siquiera deja ver la fila (0 filas); el disparador es la segunda barrera
              // (ver «el sello y la apertura son inmutables y una sesión CERRADA queda congelada»).
              const cambio = r.ok && r.filas === 1;
              expect(cambio, `${desde} → ${hacia}`).toBe(PERMITIDAS.has(`${desde}>${hacia}`));
            });
          }
        }
      });

      it("quien inicia el cierre y quien cierra es la persona del contexto, y un cierre directo toma el inicio del cierre", async () => {
        await conSesion(async (s, sesion) => {
          check(
            await s.intentar(
              `update sesion_caja set estado = 'EN_CIERRE', cierre_iniciado_en = $2, cierre_iniciado_por = $3 where id = $1`,
              [sesion, AHORA, otra.persona],
            ),
            "sesion_caja_actor_invalido",
          );
          check(
            await s.intentar(
              `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $2, cierre_iniciado_por = $3, cerrada_en = $2, cerrada_por = $4
              where id = $1`,
              [sesion, DESPUES, m.persona, otra.persona],
            ),
            "sesion_caja_actor_invalido",
          );
          // Un cierre directo con otro instante de inicio no es un cierre directo.
          check(
            await s.intentar(
              `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $2, cierre_iniciado_por = $3, cerrada_en = $4, cerrada_por = $3
              where id = $1`,
              [sesion, AHORA, m.persona, DESPUES],
            ),
            "sesion_caja_transicion_invalida",
          );
        });
      });

      it("el sello y la apertura son inmutables y una sesión CERRADA queda congelada, también para el dueño de la base", async () => {
        await dueno.query("begin");
        try {
          for (const cambio of [
            "set fecha_negocio = '2026-11-08'",
            "set hora_de_corte = '06:00'",
            "set zona_horaria = 'UTC'",
            "set abierta_en = now()",
            "set clave_idempotencia = 'otra-clave-valida-123456'",
          ]) {
            await dueno.query("savepoint s");
            const e = await dueno
              .query(`update sesion_caja ${cambio} where id = $1`, [cerradaConfirmada])
              .then(
                () => null,
                (x: { code?: string; constraint?: string }) => x,
              );
            await dueno.query("rollback to savepoint s");
            expect(e?.constraint, cambio).toBe("sesion_caja_inmutable");
          }
          for (const cambio of [
            "set observacion = 'cambiada'",
            "set version = 99",
            "set estado = 'ABIERTA'",
          ]) {
            await dueno.query("savepoint s");
            const e = await dueno
              .query(`update sesion_caja ${cambio} where id = $1`, [cerradaConfirmada])
              .then(
                () => null,
                (x: { code?: string; constraint?: string }) => x,
              );
            await dueno.query("rollback to savepoint s");
            expect(e?.constraint, cambio).toBe("sesion_caja_cerrada_congelada");
          }
        } finally {
          await dueno.query("rollback");
        }
        await conAppDe(b(), m, async (s) => {
          denegado(
            await s.intentar("update sesion_caja set fecha_negocio = '2026-11-08' where id = $1", [
              cerradaConfirmada,
            ]),
          );
          // Una sesión CERRADA ni siquiera la ve el UPDATE de la aplicación (la política exige `estado <> 'CERRADA'`).
          filas(
            await s.intentar("update sesion_caja set observacion = null where id = $1", [
              cerradaConfirmada,
            ]),
            0,
          );
        });
      });

      it("la observación solo se escribe al cerrar y respeta la lista de permitidos", async () => {
        await conSesion(async (s, sesion) => {
          // Una observación suelta, sin cerrar, no es una transición permitida.
          check(
            await s.intentar("update sesion_caja set observacion = 'x' where id = $1", [sesion]),
            "sesion_caja_transicion_invalida",
          );
          acepta(
            await s.intentar(
              `update sesion_caja set estado = 'EN_CIERRE', cierre_iniciado_en = $2, cierre_iniciado_por = $3 where id = $1`,
              [sesion, AHORA, m.persona],
            ),
          );
          for (const observacion of ["a\nb", "x".repeat(501), " con borde", "con <etiqueta>"]) {
            check(
              await s.intentar(
                `update sesion_caja set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, observacion = $4 where id = $1`,
                [sesion, DESPUES, m.persona, observacion],
              ),
              "sesion_caja_observacion_ck",
            );
          }
          acepta(
            await s.intentar(
              `update sesion_caja set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, observacion = $4 where id = $1`,
              [sesion, DESPUES, m.persona, "Faltó un billete de mil"],
            ),
          );
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("movimientos de caja", () => {
      it("el alta de un movimiento exige la sesión ABIERTA: en cierre o cerrada se rechaza", async () => {
        await conSesion(async (s, sesion) => {
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "10.00",
              motivo: "Cambio",
            }),
          );
          acepta(
            await s.intentar(
              `update sesion_caja set estado = 'EN_CIERRE', cierre_iniciado_en = $2, cierre_iniciado_por = $3 where id = $1`,
              [sesion, AHORA, m.persona],
            ),
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "10.00",
              motivo: "Cambio",
            }),
            "movimiento_caja_sesion_no_abierta",
          );
          acepta(
            await s.intentar(
              `update sesion_caja set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3 where id = $1`,
              [sesion, DESPUES, m.persona],
            ),
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "10.00",
              motivo: "Cambio",
            }),
            "movimiento_caja_sesion_no_abierta",
          );
        });
        // Con la sesión ya CERRADA y confirmada (otra transacción), tampoco: el `FOR SHARE` no la encuentra.
        await conAppDe(b(), m, async (s) => {
          check(
            await movimiento(s, esc, cerradaConfirmada, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "10.00",
              motivo: "Cambio",
            }),
            "movimiento_caja_sesion_no_abierta",
          );
          check(
            await movimiento(s, esc, cerradaConfirmada, {
              clase: "COBRO",
              medio: "EFECTIVO",
              importe: "10.00",
            }),
            "movimiento_caja_sesion_no_abierta",
          );
        });
      });

      it("con la jornada de la sesión EN_AUDITORIA o CERRADA no entra ningún movimiento (cobrar contra auditar)", async () => {
        await conSesion(async (s, sesion, fecha) => {
          acepta(
            await s.intentar(
              `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $3, auditoria_iniciada_por = $4
              where empresa_id = $1 and sucursal_id = $5 and fecha_negocio = $2`,
              [m.empresa, fecha, AHORA, m.persona, m.sucursal],
            ),
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "EFECTIVO",
              importe: "10.00",
            }),
            "movimiento_caja_jornada_no_abierta",
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "10.00",
              motivo: "Cambio",
            }),
            "movimiento_caja_jornada_no_abierta",
          );
        });
      });

      it("el signo depende de la clase", async () => {
        await conSesion(async (s, sesion) => {
          const intento = (
            clase: "COBRO" | "INGRESO_MANUAL" | "EGRESO_MANUAL" | "FONDO_INICIAL" | "AJUSTE",
            importe: string,
          ) =>
            movimiento(s, esc, sesion, {
              clase,
              medio: "EFECTIVO",
              importe,
              motivo: clase === "COBRO" || clase === "FONDO_INICIAL" ? null : "Motivo",
              sinClave: clase === "FONDO_INICIAL",
            });
          check(await intento("COBRO", "-1.00"), "movimiento_caja_signo_ck");
          check(await intento("COBRO", "0.00"), "movimiento_caja_signo_ck");
          check(await intento("INGRESO_MANUAL", "-5.00"), "movimiento_caja_signo_ck");
          check(await intento("INGRESO_MANUAL", "0.00"), "movimiento_caja_signo_ck");
          check(await intento("EGRESO_MANUAL", "5.00"), "movimiento_caja_signo_ck");
          check(await intento("EGRESO_MANUAL", "0.00"), "movimiento_caja_signo_ck");
          check(await intento("AJUSTE", "0.00"), "movimiento_caja_signo_ck");
          acepta(await intento("AJUSTE", "-3.50"));
          acepta(await intento("AJUSTE", "3.50"));
          acepta(await intento("EGRESO_MANUAL", "-5.00"));
          acepta(await intento("INGRESO_MANUAL", "5.00"));
        });
        await conAppDe(b(), m, async (s) => {
          const { sesion } = await abrirSesion(s, esc, { fondo: "0.00" }); // un fondo en cero es válido
          expect(sesion).toBeTruthy();
        });
      });

      it("el fondo no es negativo, no lleva clave y es uno solo por sesión; la clase DEVOLUCION no existe", async () => {
        await conSesion(async (s, sesion) => {
          check(
            await movimiento(s, esc, sesion, {
              clase: "FONDO_INICIAL",
              medio: "EFECTIVO",
              importe: "-1.00",
              sinClave: true,
            }),
            "movimiento_caja_signo_ck",
          );
          clave(
            await movimiento(s, esc, sesion, {
              clase: "FONDO_INICIAL",
              medio: "EFECTIVO",
              importe: "5.00",
              sinClave: true,
            }),
            "movimiento_caja_fondo_uk",
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "FONDO_INICIAL",
              medio: "EFECTIVO",
              importe: "5.00",
            }),
            "movimiento_caja_idempotencia_ck",
          );
          check(
            await s.intentar(
              `insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, motivo, registrado_en, registrado_por,
                                          clave_idempotencia, huella)
             values ($1, $2, 'DEVOLUCION', $3, -5, 'x', $4, $5, $6, $7)`,
              [m.empresa, sesion, esc.medios.EFECTIVO, AHORA, m.persona, claveNueva(), HUELLA],
            ),
            "movimiento_caja_clase_ck",
          );
        });
      });

      it("el tope: 999.999.999,99 entra y un centavo más no; sin más de dos decimales", async () => {
        await conSesion(async (s, sesion) => {
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "999999999.99",
              motivo: "Tope",
            }),
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "1000000000.00",
              motivo: "Tope",
            }),
            "movimiento_caja_tope_ck",
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "EGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "-1000000000.00",
              motivo: "Tope",
            }),
            "movimiento_caja_tope_ck",
          );
          // numeric(18,2) no guarda centavos de más: 10.001 se redondea a 10.00 en la base (el parser de la frontera lo rechaza antes).
          const r = await movimiento(s, esc, sesion, {
            clase: "INGRESO_MANUAL",
            medio: "EFECTIVO",
            importe: "10.004",
            motivo: "Redondeo",
          });
          expect(
            textoDe(
              await s.intentar("select importe::text as i from movimiento_caja where id = $1", [
                textoDe(r, "id"),
              ]),
              "i",
            ),
          ).toBe("10.00");
        });
      });

      it("el motivo es obligatorio en ingreso, egreso, ajuste y anulación, y respeta la lista de permitidos y el largo", async () => {
        await conSesion(async (s, sesion) => {
          for (const [clase, importe] of [
            ["INGRESO_MANUAL", "5.00"],
            ["EGRESO_MANUAL", "-5.00"],
            ["AJUSTE", "5.00"],
          ] as const) {
            check(
              await movimiento(s, esc, sesion, { clase, medio: "EFECTIVO", importe, motivo: null }),
              "movimiento_caja_motivo_requerido_ck",
            );
            for (const motivo of [
              "",
              "  ",
              "con\nsalto",
              "con <etiqueta>",
              " con borde",
              "x".repeat(501),
            ]) {
              const r = await movimiento(s, esc, sesion, {
                clase,
                medio: "EFECTIVO",
                importe,
                motivo,
              });
              expect(r.ok, `${clase} «${motivo.slice(0, 12)}»`).toBe(false);
              expect(!r.ok && r.restriccion).toMatch(/^movimiento_caja_motivo(_requerido)?_ck$/);
            }
            acepta(
              await movimiento(s, esc, sesion, {
                clase,
                medio: "EFECTIVO",
                importe,
                motivo: "x".repeat(500),
              }),
            );
          }
        });
      });

      it("ingresos y egresos manuales y el fondo, solo en efectivo", async () => {
        await conSesion(async (s, sesion) => {
          for (const tipo of ["TARJETA_DEBITO", "TRANSFERENCIA", "QR", "OTRO"] as const) {
            check(
              await movimiento(s, esc, sesion, {
                clase: "INGRESO_MANUAL",
                medio: tipo,
                importe: "5.00",
                motivo: "No",
              }),
              "movimiento_caja_solo_efectivo",
            );
            check(
              await movimiento(s, esc, sesion, {
                clase: "EGRESO_MANUAL",
                medio: tipo,
                importe: "-5.00",
                motivo: "No",
              }),
              "movimiento_caja_solo_efectivo",
            );
          }
          // El ajuste sí vale en cualquier medio.
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "AJUSTE",
              medio: "TARJETA_DEBITO",
              cuenta: esc.cuentas.terminal,
              importe: "-5.00",
              motivo: "Ajuste de terminal",
            }),
          );
        });
      });

      it("el movimiento lo registra la persona del contexto y el medio tiene que estar activo", async () => {
        await conSesion(async (s, sesion) => {
          check(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "EFECTIVO",
              importe: "5.00",
              persona: otra.persona,
            }),
            "movimiento_caja_actor_invalido",
          );
          acepta(
            await s.intentar("update medio_de_pago set activo = false where id = $1", [
              esc.medios.OTRO,
            ]),
          );
          check(
            await movimiento(s, esc, sesion, { clase: "COBRO", medio: "OTRO", importe: "5.00" }),
            "movimiento_caja_medio_inactivo",
          );
        });
      });

      it("el efectivo no se desactiva y no hay un segundo efectivo", async () => {
        await conAppDe(b(), m, async (s) => {
          check(
            await s.intentar("update medio_de_pago set activo = false where id = $1", [
              esc.medios.EFECTIVO,
            ]),
            "medio_de_pago_efectivo_activo_ck",
          );
          clave(
            await s.intentar(
              "insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'EFECTIVO', 'Caja chica')",
              [m.empresa],
            ),
            "medio_de_pago_efectivo_uk",
          );
        });
      });

      it("medio y cuenta de cobro (e3 §3.3): las cinco combinaciones por tipo, y sin cuenta se puede (salvo el efectivo, que nunca lleva)", async () => {
        const cuentas = {
          terminal: esc.cuentas.terminal,
          qr: esc.cuentas.qr,
          banco: esc.cuentas.banco,
        };
        const ADMITE: Record<TipoDeMedio, readonly (keyof typeof cuentas)[]> = {
          EFECTIVO: [],
          TARJETA_DEBITO: ["terminal"],
          TARJETA_CREDITO: ["terminal"],
          TRANSFERENCIA: ["banco"],
          QR: ["qr", "terminal"],
          OTRO: ["terminal", "qr", "banco"],
        };
        await conSesion(async (s, sesion) => {
          for (const tipo of TIPOS_DE_MEDIO) {
            for (const [nombre, id] of Object.entries(cuentas)) {
              const r = await movimiento(s, esc, sesion, {
                clase: "AJUSTE",
                medio: tipo,
                cuenta: id,
                importe: "1.00",
                motivo: "Prueba",
              });
              const admitida = ADMITE[tipo].includes(nombre as keyof typeof cuentas);
              if (admitida) acepta(r);
              else if (tipo === "EFECTIVO") check(r, "movimiento_caja_cuenta_no_admitida");
              else check(r, "movimiento_caja_cuenta_incompatible");
            }
            // Sin cuenta: pasa en todos los medios (dec. 151).
            acepta(
              await movimiento(s, esc, sesion, {
                clase: "AJUSTE",
                medio: tipo,
                cuenta: null,
                importe: "1.00",
                motivo: "Sin cuenta",
              }),
            );
          }
        });
      });

      it("la cuenta tiene que estar activa y ser de la sucursal de la caja", async () => {
        await conSesion(async (s, sesion) => {
          check(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "TARJETA_DEBITO",
              cuenta: terminalDeOtraSucursal,
              importe: "5.00",
            }),
            "movimiento_caja_cuenta_de_otra_sucursal",
          );
          acepta(
            await s.intentar("update cuenta_de_cobro set activa = false where id = $1", [
              esc.cuentas.terminal,
            ]),
          );
          check(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "TARJETA_DEBITO",
              cuenta: esc.cuentas.terminal,
              importe: "5.00",
            }),
            "movimiento_caja_cuenta_inactiva",
          );
        });
      });

      it("anular es un movimiento espejo: mismo medio, misma cuenta, importe opuesto y motivo; solo de la misma sesión; una sola vez", async () => {
        await conSesion(async (s, sesion) => {
          const ingreso = textoDe(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "50.00",
              motivo: "Cambio",
            }),
            "id",
          );
          const ajusteDeTerminal = textoDe(
            await movimiento(s, esc, sesion, {
              clase: "AJUSTE",
              medio: "TARJETA_DEBITO",
              cuenta: esc.cuentas.terminal,
              importe: "7.00",
              motivo: "Terminal",
            }),
            "id",
          );
          const anula = (
            anulaA: string,
            medio: TipoDeMedio,
            importe: string,
            cuenta: string | null = null,
            motivo: string | null = "Error",
          ) =>
            movimiento(s, esc, sesion, {
              clase: "ANULACION",
              medio,
              cuenta,
              importe,
              anulaA,
              motivo,
            });
          // No espejo: otro importe, el mismo signo, otro medio, otra cuenta, o sin cuenta.
          check(await anula(ingreso, "EFECTIVO", "-49.00"), "movimiento_caja_anulacion_invalida");
          check(await anula(ingreso, "EFECTIVO", "50.00"), "movimiento_caja_anulacion_invalida");
          check(
            await anula(ajusteDeTerminal, "TARJETA_CREDITO", "-7.00", esc.cuentas.terminal),
            "movimiento_caja_anulacion_invalida",
          );
          check(
            await anula(ajusteDeTerminal, "TARJETA_DEBITO", "-7.00", null),
            "movimiento_caja_anulacion_invalida",
          );
          // Sin motivo.
          check(
            await anula(ingreso, "EFECTIVO", "-50.00", null, null),
            "movimiento_caja_motivo_requerido_ck",
          );
          const anulacion = textoDe(await anula(ingreso, "EFECTIVO", "-50.00"), "id");
          acepta(await anula(ajusteDeTerminal, "TARJETA_DEBITO", "-7.00", esc.cuentas.terminal));
          // Una sola vez.
          clave(await anula(ingreso, "EFECTIVO", "-50.00"), "movimiento_caja_anula_uk");
          // Ni el fondo ni una anulación se anulan.
          const fondo = textoDe(
            await s.intentar(
              "select id from movimiento_caja where sesion_id = $1 and clase = 'FONDO_INICIAL'",
              [sesion],
            ),
            "id",
          );
          check(await anula(fondo, "EFECTIVO", "-1000.00"), "movimiento_caja_anulacion_invalida");
          check(await anula(anulacion, "EFECTIVO", "50.00"), "movimiento_caja_anulacion_invalida");
          // La anulación neutraliza: el esperado de efectivo vuelve al fondo.
          const suma = await s.intentar(
            "select sum(importe)::text as t from movimiento_caja where sesion_id = $1 and medio_de_pago_id = $2",
            [sesion, esc.medios.EFECTIVO],
          );
          expect(textoDe(suma, "t")).toBe("1000.00");
        });
      });

      it("anular un movimiento de otra sesión se rechaza (clave foránea compuesta)", async () => {
        const caja3 = await crearCaja(dueno, m, "Caja 3");
        await conAppDe(b(), m, async (s) => {
          const a = await abrirSesion(s, esc);
          const c = await abrirSesion(s, esc, { caja: caja3 });
          const ingreso = textoDe(
            await movimiento(s, esc, a.sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "5.00",
              motivo: "Cambio",
            }),
            "id",
          );
          referencia(
            await movimiento(s, esc, c.sesion, {
              clase: "ANULACION",
              medio: "EFECTIVO",
              importe: "-5.00",
              anulaA: ingreso,
              motivo: "Otra sesión",
            }),
            "movimiento_caja_anula_fkey",
          );
        });
      });

      it("un cobro con origen no se anula desde caja (movimiento_caja_anulacion_con_origen)", async () => {
        await conSesion(async (s, sesion) => {
          const cobro = await cobrar(s, esc, sesion, { medio: "EFECTIVO", importe: "100.00" });
          check(
            await movimiento(s, esc, sesion, {
              clase: "ANULACION",
              medio: "EFECTIVO",
              importe: "-100.00",
              anulaA: cobro,
              motivo: "Quiero anularlo",
            }),
            "movimiento_caja_anulacion_con_origen",
          );
        });
      });

      it("un cobro sin su fila de cobro no se confirma (movimiento_caja_sin_documento) y con ella sí", async () => {
        await conSesion(async (s, sesion) => {
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "EFECTIVO",
              importe: "100.00",
            }),
          );
          const r = await adelantar(s);
          expect(!r.ok && r.restriccion).toBe("movimiento_caja_sin_documento");
        });
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, { medio: "EFECTIVO", importe: "100.00" });
          acepta(await adelantar(s));
        });
      });

      it("movimientos, cobros, arqueos y billetes son de solo inserción: UPDATE, DELETE y TRUNCATE se rechazan, también para el dueño", async () => {
        await dueno.query("begin");
        try {
          for (const [tabla, cambio] of [
            ["movimiento_caja", "update movimiento_caja set importe = importe"],
            ["movimiento_caja", "delete from movimiento_caja"],
            ["cobro", "update cobro set origen_orden = 2"],
            ["cobro", "delete from cobro"],
            ["arqueo_caja", "update arqueo_caja set esperado = 0"],
            ["arqueo_caja", "delete from arqueo_caja"],
            ["arqueo_billete", "update arqueo_billete set cantidad = 0"],
            ["arqueo_billete", "delete from arqueo_billete"],
            ["movimiento_caja", "truncate movimiento_caja"],
            ["cobro", "truncate cobro"],
            ["arqueo_caja", "truncate arqueo_caja"],
            ["arqueo_billete", "truncate arqueo_billete"],
          ] as const) {
            await dueno.query("savepoint s");
            const e = await dueno.query(cambio).then(
              () => null,
              (x: { code?: string }) => x,
            );
            await dueno.query("rollback to savepoint s");
            // `truncate` de una tabla referenciada por claves foráneas ya lo frena Postgres (0A000); el disparador es la segunda barrera.
            expect(["42501", "0A000"], `${tabla}: ${cambio}`).toContain(e?.code);
          }
        } finally {
          await dueno.query("rollback");
        }
        await conAppDe(b(), m, async (s) => {
          for (const sentencia of [
            "update movimiento_caja set importe = importe",
            "delete from movimiento_caja",
            "update cobro set origen_orden = 2",
            "delete from cobro",
            "update arqueo_caja set esperado = 0",
            "delete from arqueo_caja",
            "update arqueo_billete set cantidad = 0",
            "delete from arqueo_billete",
          ]) {
            denegado(await s.intentar(sentencia));
          }
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("ajuste que corrige una jornada cerrada (e3 §3.11.3)", () => {
      const ajuste = (s: SesionDePrueba, sesion: string, corrige: string | null) =>
        movimiento(s, esc, sesion, {
          clase: "AJUSTE",
          medio: "EFECTIVO",
          importe: "-20.00",
          motivo: "Corrige una jornada",
          corrigeJornada: corrige,
        });

      it("corrige_jornada solo en un AJUSTE, y solo hacia una jornada CERRADA anterior", async () => {
        await conSesion(async (s, sesion) => {
          acepta(await ajuste(s, sesion, "2026-10-01"));
          acepta(await ajuste(s, sesion, null));
          check(
            await ajuste(s, sesion, "2026-10-02"),
            "movimiento_caja_corrige_jornada_no_cerrada",
          ); // EN_AUDITORIA
          check(
            await ajuste(s, sesion, "2026-09-15"),
            "movimiento_caja_corrige_jornada_inexistente",
          );
          // La de hoy no es anterior (la jornada de hoy está ABIERTA, y aunque estuviera cerrada no es anterior).
          check(
            await ajuste(s, sesion, "2026-11-09"),
            "movimiento_caja_corrige_jornada_no_cerrada",
          );
          // En otra clase, el CHECK de la tabla.
          for (const clase of ["INGRESO_MANUAL", "COBRO"] as const) {
            check(
              await movimiento(s, esc, sesion, {
                clase,
                medio: "EFECTIVO",
                importe: "5.00",
                motivo: "x",
                corrigeJornada: "2026-10-01",
              }),
              "movimiento_caja_corrige_jornada_ck",
            );
          }
        });
      });

      it("una jornada cerrada de una fecha igual o posterior no es «anterior»", async () => {
        // Una sesión de la fecha 2026-09-30 cuya jornada está CERRADA no se puede abrir; para probar «no anterior» se usa una jornada
        // cerrada POSTERIOR: la del 2026-12-01, cerrada y confirmada ahora.
        await conAppDe(b(), m, async (s) => {
          await asegurarJornada(s, m, "2026-12-01");
          acepta(
            await s.intentar(
              `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $3, auditoria_iniciada_por = $4
              where empresa_id = $1 and fecha_negocio = $2`,
              [m.empresa, "2026-12-01", AHORA, m.persona],
            ),
          );
          acepta(
            await s.intentar(
              `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $2, cerrada_por = $3, huella_de_cierre = $4
              where empresa_id = $1 and fecha_negocio = '2026-12-01'`,
              [m.empresa, DESPUES, m.persona, HUELLA],
            ),
          );
          await s.confirmar();
        });
        await conSesion(async (s, sesion) => {
          check(
            await ajuste(s, sesion, "2026-12-01"),
            "movimiento_caja_corrige_jornada_no_anterior",
          );
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("datos del cobro (decisión 129)", () => {
      /** Habilita en un medio los datos pedidos (la aplicación puede: es el UPDATE de `editarMedioDePago`). */
      const habilitar = async (
        s: SesionDePrueba,
        tipo: TipoDeMedio,
        datos: Partial<Record<"cupon" | "ultimos4" | "marca" | "cuotas" | "dni", boolean>>,
      ) =>
        s.intentar(
          `update medio_de_pago set pide_cupon = $2, pide_ultimos4 = $3, pide_marca = $4, pide_cuotas = $5, pide_dni = $6 where id = $1`,
          [
            esc.medios[tipo],
            !!datos.cupon,
            !!datos.ultimos4,
            !!datos.marca,
            !!datos.cuotas,
            !!datos.dni,
          ],
        );
      const cobroDe = async (
        s: SesionDePrueba,
        sesion: string,
        tipo: TipoDeMedio,
        datos: Parameters<typeof filaDeCobro>[4],
      ) => {
        const id = textoDe(
          await movimiento(s, esc, sesion, {
            clase: "COBRO",
            medio: tipo,
            cuenta:
              tipo === "TARJETA_CREDITO" || tipo === "TARJETA_DEBITO" ? esc.cuentas.terminal : null,
            importe: "10.00",
          }),
          "id",
        );
        return filaDeCobro(s, esc, id, {}, datos);
      };

      it("un medio nuevo nace sin datos habilitados y cada tipo admite solo los suyos (medio_de_pago_datos_ck)", async () => {
        await conAppDe(b(), m, async (s) => {
          const nuevo = filasDe(
            await s.intentar(
              `insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'TARJETA_CREDITO', 'Crédito visa') returning pide_cupon, pide_ultimos4, pide_marca, pide_cuotas, pide_dni`,
              [m.empresa],
            ),
          );
          expect(nuevo).toEqual([
            {
              pide_cupon: false,
              pide_ultimos4: false,
              pide_marca: false,
              pide_cuotas: false,
              pide_dni: false,
            },
          ]);
          const TODOS = ["cupon", "ultimos4", "marca", "cuotas", "dni"] as const;
          const ADMITE: Record<TipoDeMedio, readonly (typeof TODOS)[number][]> = {
            EFECTIVO: [],
            QR: [],
            OTRO: [],
            TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
            TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
            TRANSFERENCIA: ["dni"],
          };
          for (const tipo of TIPOS_DE_MEDIO) {
            for (const dato of TODOS) {
              const r = await habilitar(s, tipo, { [dato]: true });
              if (ADMITE[tipo].includes(dato)) acepta(r);
              else check(r, "medio_de_pago_datos_ck");
            }
          }
        });
      });

      it("un dato que el medio no habilitó se rechaza; habilitado, entra (cobro_dato_no_habilitado)", async () => {
        await conSesion(async (s, sesion) => {
          check(
            await cobroDe(s, sesion, "TARJETA_DEBITO", { cupon: "ABC123" }),
            "cobro_dato_no_habilitado",
          );
          check(
            await cobroDe(s, sesion, "TARJETA_DEBITO", { ultimos4: "1234" }),
            "cobro_dato_no_habilitado",
          );
          check(
            await cobroDe(s, sesion, "TARJETA_DEBITO", { marca: marcaVisa }),
            "cobro_dato_no_habilitado",
          );
          check(
            await cobroDe(s, sesion, "TARJETA_CREDITO", { cuotas: 3 }),
            "cobro_dato_no_habilitado",
          );
          check(
            await cobroDe(s, sesion, "TRANSFERENCIA", { dni: "30111222" }),
            "cobro_dato_no_habilitado",
          );
          // Todo vacío cobra igual.
          acepta(await cobroDe(s, sesion, "TARJETA_DEBITO", {}));
          acepta(
            await habilitar(s, "TARJETA_DEBITO", { cupon: true, ultimos4: true, marca: true }),
          );
          acepta(
            await cobroDe(s, sesion, "TARJETA_DEBITO", {
              cupon: "ABC123",
              ultimos4: "1234",
              marca: marcaVisa,
            }),
          );
          // Los datos del cobro se habilitan por medio: el crédito sigue sin cuotas.
          check(
            await cobroDe(s, sesion, "TARJETA_CREDITO", { cuotas: 3 }),
            "cobro_dato_no_habilitado",
          );
        });
      });

      it("la marca es de la lista de marcas y está activa; el cobro viejo conserva la que se desactivó después", async () => {
        await conSesion(async (s, sesion) => {
          acepta(await habilitar(s, "TARJETA_DEBITO", { marca: true }));
          check(
            await cobroDe(s, sesion, "TARJETA_DEBITO", { marca: marcaInactiva }),
            "cobro_marca_invalida",
          );
          check(
            await cobroDe(s, sesion, "TARJETA_DEBITO", { marca: motivoDeRechazo }),
            "cobro_marca_invalida",
          );
          acepta(await cobroDe(s, sesion, "TARJETA_DEBITO", { marca: marcaVisa }));
        });
        // Desactivar una marca ya usada no toca el cobro (la marca se guarda por id).
        const mundo = await crearMundo(dueno);
        const e = await crearEscenario(dueno, mundo);
        await dueno.query("update medio_de_pago set pide_marca = true where id = $1", [
          e.medios.TARJETA_DEBITO,
        ]);
        await conAppDe(b(), mundo, async (s) => {
          const { sesion } = await abrirSesion(s, e);
          await cobrar(
            s,
            e,
            sesion,
            { medio: "TARJETA_DEBITO", cuenta: e.cuentas.terminal, importe: "10.00" },
            { marca: marcaVisa },
          );
          await s.confirmar();
        });
        // (el valor global se desactiva y se reactiva, sin dejar rastro, para no cambiar las semillas)
        await dueno.query("update valor_de_lista set activo = false where id = $1", [marcaVisa]);
        try {
          const { rows } = await dueno.query<{ marca_de_tarjeta_id: string }>(
            "select marca_de_tarjeta_id from cobro where empresa_id = $1",
            [mundo.empresa],
          );
          expect(rows.map((r) => r.marca_de_tarjeta_id)).toEqual([marcaVisa]);
        } finally {
          await dueno.query("update valor_de_lista set activo = true where id = $1", [marcaVisa]);
        }
      });

      it("cupón: nunca un número de tarjeta (con o sin separadores), sin espacios ni solo separadores", async () => {
        await conSesion(async (s, sesion) => {
          acepta(
            await habilitar(s, "TARJETA_CREDITO", {
              cupon: true,
              ultimos4: true,
              marca: true,
              cuotas: true,
            }),
          );
          for (const malo of [
            "4509 9535 6623 3704",
            "4509-9535-6623-3704",
            "4509.9535.6623.3704",
            "4509/9535/6623/3704",
            "4509953566233704",
            "1234567890123",
            "ABC 123",
            "---",
            "...",
            "",
            "a".repeat(33),
            "cupón",
            "AB\nC",
          ]) {
            const r = await cobroDe(s, sesion, "TARJETA_CREDITO", { cupon: malo });
            expect(r.ok, `cupón «${malo}»`).toBe(false);
            expect(!r.ok && r.restriccion, `cupón «${malo}»`).toBe("cobro_cupon_ck");
          }
          for (const bueno of [
            "A",
            "ABC123",
            "1234567890-12",
            "123456789012",
            "a".repeat(32),
            "A.B_C/D-1",
          ]) {
            acepta(await cobroDe(s, sesion, "TARJETA_CREDITO", { cupon: bueno }));
          }
        });
      });

      it("últimos cuatro: exactamente cuatro dígitos (nunca se trunca); cuotas de 1 a 36; DNI de 6 a 9 dígitos sin puntos", async () => {
        await conSesion(async (s, sesion) => {
          acepta(
            await habilitar(s, "TARJETA_CREDITO", {
              cupon: true,
              ultimos4: true,
              marca: true,
              cuotas: true,
            }),
          );
          for (const malo of ["1234567890123456", "12a4", "123", "12345", "    ", "١٢٣٤"]) {
            const r = await cobroDe(s, sesion, "TARJETA_CREDITO", { ultimos4: malo });
            expect(r.ok, `últimos 4 «${malo}»`).toBe(false);
          }
          acepta(await cobroDe(s, sesion, "TARJETA_CREDITO", { ultimos4: "0042" }));
          for (const mala of [0, 37, -1, 100]) {
            check(await cobroDe(s, sesion, "TARJETA_CREDITO", { cuotas: mala }), "cobro_cuotas_ck");
          }
          acepta(await cobroDe(s, sesion, "TARJETA_CREDITO", { cuotas: 1 }));
          acepta(await cobroDe(s, sesion, "TARJETA_CREDITO", { cuotas: 36 }));
          acepta(await habilitar(s, "TRANSFERENCIA", { dni: true }));
          for (const malo of ["abcdefg", "12.345.678", "12345", "1234567890", "12 345 678", ""]) {
            const r = await cobroDe(s, sesion, "TRANSFERENCIA", { dni: malo });
            expect(r.ok, `DNI «${malo}»`).toBe(false);
            expect(!r.ok && r.restriccion, `DNI «${malo}»`).toBe("cobro_dni_ck");
          }
          acepta(await cobroDe(s, sesion, "TRANSFERENCIA", { dni: "30111222" }));
          acepta(await cobroDe(s, sesion, "TRANSFERENCIA", { dni: "123456" }));
        });
      });

      it("la fila de cobro es de un movimiento COBRO, con origen válido y única por (origen, orden)", async () => {
        await conSesion(async (s, sesion) => {
          const ingreso = textoDe(
            await movimiento(s, esc, sesion, {
              clase: "INGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "5.00",
              motivo: "Cambio",
            }),
            "id",
          );
          check(await filaDeCobro(s, esc, ingreso), "cobro_clase_invalida");
          const cobro = textoDe(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "EFECTIVO",
              importe: "5.00",
            }),
            "id",
          );
          check(
            await filaDeCobro(s, esc, cobro, { tipo: "Ventas.Cobranza" }),
            "cobro_origen_tipo_ck",
          );
          check(await filaDeCobro(s, esc, cobro, { orden: 0 }), "cobro_origen_orden_ck");
          check(await filaDeCobro(s, esc, cobro, { orden: 51 }), "cobro_origen_orden_ck");
          const origen = { id: "00000000-0000-4000-8000-000000000001", orden: 1 };
          acepta(await filaDeCobro(s, esc, cobro, origen));
          // El mismo (origen, orden) en otro movimiento es el mismo cobro: la identidad es única.
          const otroCobro = textoDe(
            await movimiento(s, esc, sesion, {
              clase: "COBRO",
              medio: "EFECTIVO",
              importe: "5.00",
            }),
            "id",
          );
          clave(await filaDeCobro(s, esc, otroCobro, origen), "cobro_origen_uk");
          acepta(await filaDeCobro(s, esc, otroCobro, { ...origen, orden: 2 }));
          // Un movimiento tiene una sola fila de cobro.
          clave(
            await filaDeCobro(s, esc, otroCobro, { id: "00000000-0000-4000-8000-000000000002" }),
            "cobro_pkey",
          );
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("arqueo y cierre completo", () => {
      /** Cierra la sesión sin escribir el arqueo (para armar las líneas a mano). */
      const cerrarSinArqueo = async (s: SesionDePrueba, sesion: string) =>
        acepta(
          await s.directo(
            `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $2, cierre_iniciado_por = $3, cerrada_en = $2, cerrada_por = $3
            where id = $1`,
            [sesion, DESPUES, m.persona],
          ),
        );
      const linea = (
        s: SesionDePrueba,
        sesion: string,
        c: Partial<{
          medio: TipoDeMedio;
          cuenta: string | null;
          esperado: string;
          contado: string | null;
          monedas: string | null;
          conforme: boolean;
          por: string | null;
          en: string | null;
        }> = {},
      ) =>
        s.intentar(
          `insert into arqueo_caja (empresa_id, sesion_id, medio_de_pago_id, cuenta_de_cobro_id, esperado, contado, contado_monedas,
                                  conforme, conforme_por, conforme_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            m.empresa,
            sesion,
            esc.medios[c.medio ?? "EFECTIVO"],
            c.cuenta ?? null,
            c.esperado ?? "1000.00",
            c.contado === undefined ? "1000.00" : c.contado,
            c.monedas === undefined
              ? (c.medio ?? "EFECTIVO") === "EFECTIVO"
                ? "0.00"
                : null
              : c.monedas,
            c.conforme ?? false,
            c.por ?? null,
            c.en ?? null,
          ],
        );
      const billete = (s: SesionDePrueba, sesion: string, denominacion: number, cantidad: number) =>
        s.intentar(
          "insert into arqueo_billete (empresa_id, sesion_id, denominacion, cantidad) values ($1, $2, $3, $4)",
          [m.empresa, sesion, denominacion, cantidad],
        );

      it("un cierre completo se confirma: una línea por medio y cuenta con movimientos más el efectivo; la diferencia la genera la base", async () => {
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, {
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "300.00",
          });
          await cobrar(s, esc, sesion, { medio: "QR", importe: "40.00" }); // sin cuenta (dec. 151)
          await cerrarSesion(s, esc, sesion, {
            billetes: { 500: 1, 200: 2, 100: 1 },
            monedas: "7.50",
          });
          acepta(await adelantar(s));
          const { rows } = (await s.intentar(
            `select a.medio_de_pago_id, a.cuenta_de_cobro_id, a.esperado::text as esperado, a.contado::text as contado, a.diferencia::text as diferencia
             from arqueo_caja a where a.sesion_id = $1 order by a.esperado`,
            [sesion],
          )) as { ok: true; rows: Record<string, unknown>[] };
          expect(rows).toHaveLength(3);
          const efectivo = rows.find((r) => r["medio_de_pago_id"] === esc.medios.EFECTIVO);
          // Fondo 1000, contado 500 + 400 + 100 + 7,50 = 1007,50: sobran 7,50.
          expect(efectivo).toMatchObject({
            esperado: "1000.00",
            contado: "1007.50",
            diferencia: "7.50",
          });
          const qr = rows.find((r) => r["medio_de_pago_id"] === esc.medios.QR);
          expect(qr).toMatchObject({
            cuenta_de_cobro_id: null,
            esperado: "40.00",
            diferencia: "0.00",
          });
        });
      });

      it("cerrar sin arqueo, sin la línea de efectivo o con una línea de más se rechaza", async () => {
        await conSesion(async (s, sesion) => {
          await cerrarSinArqueo(s, sesion);
          const r = await adelantar(s);
          expect(!r.ok && r.restriccion).toBe("sesion_caja_arqueo_incompleto");
        });
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, {
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "300.00",
          });
          await cerrarSinArqueo(s, sesion);
          acepta(await billete(s, sesion, 1000, 1));
          acepta(
            await linea(s, sesion, {
              medio: "TARJETA_DEBITO",
              cuenta: esc.cuentas.terminal,
              esperado: "300.00",
              contado: "300.00",
            }),
          );
          const r = await adelantar(s); // falta la línea de efectivo
          expect(!r.ok && r.restriccion).toBe("sesion_caja_arqueo_incompleto");
        });
        await conSesion(async (s, sesion) => {
          await cerrarSinArqueo(s, sesion);
          acepta(await billete(s, sesion, 1000, 1));
          acepta(await linea(s, sesion, {}));
          // Una línea de un medio sin movimientos sobra.
          acepta(await linea(s, sesion, { medio: "QR", esperado: "0.00", contado: "0.00" }));
          const r = await adelantar(s);
          expect(!r.ok && r.restriccion).toBe("sesion_caja_arqueo_incompleto");
        });
      });

      it("un esperado falso se rechaza al confirmar (se recalcula con los movimientos reales)", async () => {
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, { medio: "EFECTIVO", importe: "100.00" });
          await cerrarSinArqueo(s, sesion);
          acepta(await billete(s, sesion, 1000, 1));
          acepta(await linea(s, sesion, { esperado: "1000.00", contado: "1000.00" })); // falta el cobro de 100
          const r = await adelantar(s);
          expect(!r.ok && r.restriccion).toBe("sesion_caja_arqueo_no_cuadra");
        });
      });

      it("los billetes y las monedas tienen que sumar el contado del efectivo (sesion_caja_conteo_no_cuadra)", async () => {
        await conSesion(async (s, sesion) => {
          await cerrarSinArqueo(s, sesion);
          acepta(await billete(s, sesion, 1000, 1));
          acepta(await linea(s, sesion, { contado: "1005.00", monedas: "0.00" }));
          const r = await adelantar(s);
          expect(!r.ok && r.restriccion).toBe("sesion_caja_conteo_no_cuadra");
        });
        await conSesion(async (s, sesion) => {
          await cerrarSinArqueo(s, sesion);
          acepta(await billete(s, sesion, 1000, 1));
          acepta(await linea(s, sesion, { contado: "1005.00", monedas: "5.00" }));
          acepta(await adelantar(s));
        });
      });

      it("el efectivo se cuenta siempre y no admite conforme; los demás llevan contado O conforme; las monedas son solo del efectivo", async () => {
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, {
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "300.00",
          });
          await cerrarSinArqueo(s, sesion);
          check(
            await linea(s, sesion, {
              contado: null,
              monedas: null,
              conforme: true,
              por: m.persona,
              en: DESPUES,
            }),
            "arqueo_caja_efectivo_conforme",
          );
          check(
            await linea(s, sesion, { contado: null, monedas: null }),
            "arqueo_caja_efectivo_sin_contar",
          );
          check(await linea(s, sesion, { monedas: null }), "arqueo_caja_efectivo_sin_contar");
          check(
            await linea(s, sesion, { cuenta: esc.cuentas.terminal }),
            "arqueo_caja_efectivo_sin_contar",
          );
          const debito = {
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            esperado: "300.00",
          } as const;
          check(await linea(s, sesion, { ...debito, contado: null }), "arqueo_caja_conforme_ck"); // ni contado ni conforme
          check(
            await linea(s, sesion, { ...debito, contado: "300.00", monedas: "1.00" }),
            "arqueo_caja_monedas_solo_efectivo",
          );
          check(
            await linea(s, sesion, {
              ...debito,
              contado: "300.00",
              conforme: true,
              por: m.persona,
              en: DESPUES,
            }),
            "arqueo_caja_conforme_ck",
          );
          check(
            await linea(s, sesion, {
              ...debito,
              contado: null,
              conforme: true,
              por: otra.persona,
              en: DESPUES,
            }),
            "arqueo_caja_actor_invalido",
          );
          check(
            await linea(s, sesion, {
              ...debito,
              contado: null,
              conforme: true,
              por: m.persona,
              en: null,
            }),
            "arqueo_caja_conforme_ck",
          );
          check(await linea(s, sesion, { ...debito, contado: "-1.00" }), "arqueo_caja_contado_ck");
          acepta(
            await linea(s, sesion, {
              ...debito,
              contado: null,
              conforme: true,
              por: m.persona,
              en: DESPUES,
            }),
          );
        });
      });

      it("el conforme es de quien cerró y del instante del cierre; el conforme anota quién y cuándo y se muestra sin diferencia", async () => {
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, {
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "300.00",
          });
          await cerrarSinArqueo(s, sesion);
          acepta(await billete(s, sesion, 1000, 1));
          acepta(await linea(s, sesion, {}));
          acepta(
            await linea(s, sesion, {
              medio: "TARJETA_DEBITO",
              cuenta: esc.cuentas.terminal,
              esperado: "300.00",
              contado: null,
              conforme: true,
              por: m.persona,
              en: AHORA, // no es el instante del cierre
            }),
          );
          const r = await adelantar(s);
          expect(!r.ok && r.restriccion).toBe("sesion_caja_conforme_invalido");
        });
        await conSesion(async (s, sesion) => {
          await cobrar(s, esc, sesion, {
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "300.00",
          });
          await cerrarSesion(s, esc, sesion, { billetes: { 1000: 1 }, conforme: true });
          acepta(await adelantar(s));
          const l = filasDe(
            await s.intentar(
              "select conforme, conforme_por, diferencia::text as diferencia from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2",
              [sesion, esc.medios.TARJETA_DEBITO],
            ),
          );
          expect(l).toEqual([{ conforme: true, conforme_por: m.persona, diferencia: null }]);
        });
      });

      it("el arqueo se escribe al cerrar, no después ni suelto: una sesión cerrada en otra transacción no admite arqueo ni billetes", async () => {
        await conAppDe(b(), m, async (s) => {
          check(
            await s.intentar(
              `insert into arqueo_caja (empresa_id, sesion_id, medio_de_pago_id, esperado, contado, contado_monedas)
             values ($1, $2, $3, 0, 0, 0)`,
              [m.empresa, cerradaConfirmada, esc.medios.QR],
            ),
            "arqueo_caja_sesion_invalida",
          );
          check(await billete(s, cerradaConfirmada, 100, 1), "arqueo_caja_sesion_invalida");
        });
        // Una línea con la sesión todavía abierta, sin cerrarla: al confirmar no hay arqueos sueltos.
        await conSesion(async (s, sesion) => {
          acepta(await billete(s, sesion, 1000, 1));
          acepta(await linea(s, sesion, {}));
          const r = await alConfirmar(s);
          expect(!r.ok && r.restriccion).toBe("arqueo_caja_sesion_invalida");
        });
      });

      it("denominaciones y cantidades válidas: solo las siete denominaciones, de 0 a 99.999 billetes, una fila por denominación", async () => {
        await conSesion(async (s, sesion) => {
          await cerrarSinArqueo(s, sesion);
          check(await billete(s, sesion, 50, 1), "arqueo_billete_denominacion_ck");
          check(await billete(s, sesion, 1000, -1), "arqueo_billete_cantidad_ck");
          check(await billete(s, sesion, 1000, 100000), "arqueo_billete_cantidad_ck");
          acepta(await billete(s, sesion, 20000, 99999));
          acepta(await billete(s, sesion, 100, 0));
          clave(await billete(s, sesion, 100, 1), "arqueo_billete_pkey");
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("configuración: caja, medio de pago y cuenta de cobro", () => {
      it("una caja no se desactiva con una sesión sin cerrar y su sucursal no cambia", async () => {
        await conSesion(async (s) => {
          check(
            await s.intentar("update caja set activa = false where id = $1", [esc.caja]),
            "caja_con_sesion_vigente",
          );
          denegado(
            await s.intentar("update caja set sucursal_id = $2 where id = $1", [
              esc.caja,
              sucursalDos,
            ]),
          );
        });
        await conAppDe(b(), m, async (s) => {
          // Sin sesión vigente (la caja dos tiene la suya cerrada) se desactiva y se reactiva.
          acepta(await s.intentar("update caja set activa = false where id = $1", [cajaDos]));
          acepta(await s.intentar("update caja set activa = true where id = $1", [cajaDos]));
        });
      });

      it("el nombre de la caja es único por sucursal sin distinguir mayúsculas y respeta la lista de permitidos", async () => {
        await conAppDe(b(), m, async (s) => {
          clave(
            await s.intentar(
              "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'CAJA 1')",
              [m.empresa, m.sucursal],
            ),
            "caja_nombre_uk",
          );
          acepta(
            await s.intentar(
              "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'CAJA 1')",
              [m.empresa, sucursalDos],
            ),
          );
          for (const nombre of ["", " Caja", "Caja ", "Caja\n2", "Caja <b>", "x".repeat(101)]) {
            check(
              await s.intentar(
                "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, $3)",
                [m.empresa, m.sucursal, nombre],
              ),
              "caja_nombre_ck",
            );
          }
        });
      });

      it("el tipo de un medio o una cuenta no cambia, y los nombres son únicos por empresa", async () => {
        await conAppDe(b(), m, async (s) => {
          denegado(
            await s.intentar("update medio_de_pago set tipo = 'QR' where id = $1", [
              esc.medios.OTRO,
            ]),
          );
          denegado(
            await s.intentar("update cuenta_de_cobro set tipo = 'QR' where id = $1", [
              esc.cuentas.terminal,
            ]),
          );
          acepta(
            await s.intentar(
              "insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'QR', 'Mercado Pago')",
              [m.empresa],
            ),
          );
          clave(
            await s.intentar(
              "insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'QR', 'mercado pago')",
              [m.empresa],
            ),
            "medio_de_pago_nombre_uk",
          );
          clave(
            await s.intentar("insert into medio_de_pago (empresa_id, tipo) values ($1, 'QR')", [
              m.empresa,
            ]),
            "medio_de_pago_sin_nombre_uk",
          );
          clave(
            await s.intentar(
              "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'terminal 1', $2)",
              [m.empresa, m.sucursal],
            ),
            "cuenta_de_cobro_nombre_uk",
          );
          // La sucursal de la cuenta es obligatoria y el identificador no admite credenciales raras.
          check(
            await s.intentar(
              "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id, identificador_externo) values ($1, 'QR', 'QR 9', $2, 'clave=secreta;')",
              [m.empresa, m.sucursal],
            ),
            "cuenta_de_cobro_identificador_ck",
          );
          expect(
            (
              await s.intentar(
                "insert into cuenta_de_cobro (empresa_id, tipo, nombre) values ($1, 'QR', 'QR 10')",
                [m.empresa],
              )
            ).ok,
          ).toBe(false);
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("listas del sistema (valor_de_lista)", () => {
      it("las semillas están: seis marcas (Otra fija) y cuatro motivos de rechazo", async () => {
        const { rows } = await dueno.query<{ lista: string; nombre: string; fija: boolean }>(
          `select lista, nombre, fija from valor_de_lista where nombre <> 'Marca vieja' order by lista, nombre`,
        );
        expect(rows).toEqual([
          { lista: "MARCAS_DE_TARJETA", nombre: "American Express", fija: false },
          { lista: "MARCAS_DE_TARJETA", nombre: "Cabal", fija: false },
          { lista: "MARCAS_DE_TARJETA", nombre: "Mastercard", fija: false },
          { lista: "MARCAS_DE_TARJETA", nombre: "Naranja X", fija: false },
          { lista: "MARCAS_DE_TARJETA", nombre: "Otra", fija: true },
          { lista: "MARCAS_DE_TARJETA", nombre: "Visa", fija: false },
          { lista: "MOTIVOS_DE_RECHAZO", nombre: "Envase dañado", fija: false },
          { lista: "MOTIVOS_DE_RECHAZO", nombre: "No es lo pedido", fija: false },
          { lista: "MOTIVOS_DE_RECHAZO", nombre: "Temperatura", fija: false },
          { lista: "MOTIVOS_DE_RECHAZO", nombre: "Vencida", fija: false },
        ]);
      });

      it("el nombre es único por lista sin distinguir mayúsculas ni acentos, y la «Otra» fija es una sola", async () => {
        await dueno.query("begin");
        try {
          const intento = async (texto: string) => {
            await dueno.query("savepoint s");
            const e = await dueno.query(texto).then(
              () => null,
              (x: { code?: string; constraint?: string }) => x,
            );
            await dueno.query("rollback to savepoint s");
            return e;
          };
          for (const nombre of ["visa", "VISA", "Vísa", "víSA", "naranja x", "NARANJA X"]) {
            const e = await intento(
              `insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', '${nombre}')`,
            );
            expect(e?.constraint, nombre).toBe("valor_de_lista_nombre_uk");
          }
          // La misma palabra en la otra lista sí.
          expect(
            await intento(
              `insert into valor_de_lista (lista, nombre) values ('MOTIVOS_DE_RECHAZO', 'Visa')`,
            ),
          ).toBeNull();
          // Con otra letra, no es lo mismo.
          expect(
            await intento(
              `insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Visas')`,
            ),
          ).toBeNull();
          expect(
            (
              await intento(
                `insert into valor_de_lista (lista, nombre, fija) values ('MARCAS_DE_TARJETA', 'Otra marca', true)`,
              )
            )?.constraint,
          ).toBe("valor_de_lista_otra_uk");
          // Lista, nombre y activo válidos.
          expect(
            (await intento(`insert into valor_de_lista (lista, nombre) values ('PAISES', 'Chile')`))
              ?.constraint,
          ).toBe("valor_de_lista_lista_ck");
          expect(
            (
              await intento(
                `insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', ' Chile')`,
              )
            )?.constraint,
          ).toBe("valor_de_lista_nombre_ck");
          expect(
            (
              await intento(
                `insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', '${"x".repeat(41)}')`,
              )
            )?.constraint,
          ).toBe("valor_de_lista_nombre_ck");
          expect(
            (
              await intento(
                `insert into valor_de_lista (lista, nombre, fija, activo) values ('MARCAS_DE_TARJETA', 'Z', true, false)`,
              )
            )?.constraint,
          ).toBe("valor_de_lista_fija_ck");
        } finally {
          await dueno.query("rollback");
        }
      });

      it("«Otra» no se renombra ni se desactiva; lista, id y fija no cambian; el resto se renombra y se desactiva", async () => {
        await dueno.query("begin");
        try {
          const intento = async (texto: string) => {
            await dueno.query("savepoint s");
            const e = await dueno.query(texto).then(
              () => null,
              (x: { code?: string; constraint?: string }) => x,
            );
            await dueno.query("rollback to savepoint s");
            return e;
          };
          expect(
            (await intento(`update valor_de_lista set nombre = 'Otras' where nombre = 'Otra'`))
              ?.constraint,
          ).toBe("valor_de_lista_fija");
          expect(
            (await intento(`update valor_de_lista set activo = false where nombre = 'Otra'`))
              ?.constraint,
          ).toBe("valor_de_lista_fija");
          expect(
            (
              await intento(
                `update valor_de_lista set lista = 'MOTIVOS_DE_RECHAZO' where nombre = 'Visa'`,
              )
            )?.constraint,
          ).toBe("valor_de_lista_inmutable");
          expect(
            (await intento(`update valor_de_lista set fija = true where nombre = 'Visa'`))
              ?.constraint,
          ).toBe("valor_de_lista_inmutable");
          expect(
            await intento(`update valor_de_lista set nombre = 'Visa Débito' where nombre = 'Visa'`),
          ).toBeNull();
          expect(
            await intento(`update valor_de_lista set activo = false where nombre = 'Visa'`),
          ).toBeNull();
          const antes = await dueno.query<{ version: number }>(
            `select version from valor_de_lista where nombre = 'Visa'`,
          );
          const v = await dueno.query<{ version: number }>(
            `update valor_de_lista set nombre = 'Visa 2' where nombre = 'Visa' returning version`,
          );
          expect(v.rows[0]?.version).toBe((antes.rows[0]?.version ?? 0) + 1);
        } finally {
          await dueno.query("rollback");
        }
      });

      it("la plataforma: un ADMIN agrega y cambia (nombre y activo); SOPORTE y SISTEMA solo leen; nadie da de alta una fija ni cambia la lista", async () => {
        await conPlataformaDe(b(), "ADMIN", async (s) => {
          acepta(
            await s.intentar(
              "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Diners')",
            ),
          );
          // Sin distinguir mayúsculas ni acentos, también desde la plataforma.
          clave(
            await s.intentar(
              "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'dínERS')",
            ),
            "valor_de_lista_nombre_uk",
          );
          // `fija`, `activo` y `id` no se dan de alta a mano; la lista no se cambia.
          denegado(
            await s.intentar(
              "insert into valor_de_lista (lista, nombre, fija) values ('MARCAS_DE_TARJETA', 'Otra más', true)",
            ),
          );
          denegado(
            await s.intentar(
              "insert into valor_de_lista (lista, nombre, activo) values ('MARCAS_DE_TARJETA', 'Inactiva', false)",
            ),
          );
          denegado(await s.intentar("update valor_de_lista set lista = 'MOTIVOS_DE_RECHAZO'"));
          denegado(await s.intentar("update valor_de_lista set fija = true"));
          denegado(await s.intentar("delete from valor_de_lista"));
          filas(
            await s.intentar(
              "update valor_de_lista set nombre = 'Diners Club' where nombre = 'Diners'",
            ),
            1,
          );
          filas(
            await s.intentar(
              "update valor_de_lista set activo = false where nombre = 'Diners Club'",
            ),
            1,
          );
          // «Otra» sigue siendo fija para todos.
          check(
            await s.intentar("update valor_de_lista set activo = false where nombre = 'Otra'"),
            "valor_de_lista_fija",
          );
        });
        for (const actor of ["SOPORTE", "SISTEMA"] as const) {
          await conPlataformaDe(b(), actor, async (s) => {
            expect(
              filasDe(await s.intentar("select count(*)::int as n from valor_de_lista"))[0]?.["n"],
              actor,
            ).toBeGreaterThanOrEqual(10);
            const r = await s.intentar(
              "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Maestro')",
            );
            expect(r.ok, actor).toBe(false);
            filas(await s.intentar("update valor_de_lista set nombre = 'x'"), 0);
          });
        }
        // Sin un actor firmado vigente, la plataforma no ve nada.
        const sinActor = await SesionDePrueba.abrir(
          b(),
          "pedernal_plataforma",
          comoPlataforma({ tipo: "ADMIN", id: "00000000-0000-4000-8000-000000000000" as never }),
        );
        try {
          expect(
            filasDe(await sinActor.intentar("select count(*)::int as n from valor_de_lista"))[0]?.[
              "n"
            ],
          ).toBe(0);
        } finally {
          await sinActor.cerrar();
        }
      });

      it("una empresa lee todas las listas y no escribe ninguna (RLS y privilegios)", async () => {
        await conAppDe(b(), m, async (s) => {
          expect(
            filasDe(
              await s.intentar(
                "select count(*)::int as n from valor_de_lista where nombre <> 'Marca vieja'",
              ),
            )[0]?.["n"],
          ).toBe(10);
          denegado(
            await s.intentar(
              "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Mía')",
            ),
          );
          denegado(await s.intentar("update valor_de_lista set nombre = 'x'"));
          denegado(await s.intentar("delete from valor_de_lista"));
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("aislamiento entre empresas", () => {
      it("la empresa A no ve ni escribe cajas, medios, cuentas, sesiones, movimientos, cobros ni arqueos de B", async () => {
        // Datos de B, confirmados.
        let sesionDeB = "";
        await conAppDe(b(), otra, async (s) => {
          const r = await abrirSesion(s, escOtra);
          sesionDeB = r.sesion;
          await cobrar(s, escOtra, r.sesion, { medio: "EFECTIVO", importe: "100.00" });
          await s.confirmar();
        });
        await conAppDe(b(), m, async (s) => {
          for (const tabla of [
            "caja",
            "medio_de_pago",
            "cuenta_de_cobro",
            "sesion_caja",
            "movimiento_caja",
            "cobro",
            "arqueo_caja",
          ]) {
            const vistas = filasDe(
              await s.intentar(`select count(*)::int as n from ${tabla} where empresa_id = $1`, [
                otra.empresa,
              ]),
            );
            expect(vistas[0]?.["n"], tabla).toBe(0);
          }
          // Un movimiento en la sesión de B, con la empresa de A o con la de B: ni lo permite la política ni la clave foránea compuesta.
          const intento = (empresa: string) =>
            s.intentar(
              `insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, motivo, registrado_en, registrado_por,
                                          clave_idempotencia, huella)
             values ($1, $2, 'INGRESO_MANUAL', $3, 5, 'x', $4, $5, $6, $7)`,
              [
                empresa,
                sesionDeB,
                empresa === m.empresa ? esc.medios.EFECTIVO : escOtra.medios.EFECTIVO,
                AHORA,
                m.persona,
                claveNueva(),
                HUELLA,
              ],
            );
          expect((await intento(m.empresa)).ok).toBe(false);
          expect((await intento(otra.empresa)).ok).toBe(false);
          // Una sesión de A sobre la caja de B, o un movimiento de A con un medio de B.
          expect((await insertarSesion(s, { caja: escOtra.caja })).ok).toBe(false);
          expect(
            (
              await s.intentar(
                `insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Intrusa')`,
                [m.empresa, otra.sucursal],
              )
            ).ok,
          ).toBe(false);
          filas(
            await s.intentar("update medio_de_pago set activo = false where empresa_id = $1", [
              otra.empresa,
            ]),
            0,
          );
          filas(
            await s.intentar("update caja set nombre = 'x' where empresa_id = $1", [otra.empresa]),
            0,
          );
        });
      });

      it("con la empresa suspendida nada escribe", async () => {
        const suspendida = await crearMundo(dueno, { estado: "SUSPENDED" });
        const e = await crearEscenario(dueno, suspendida);
        await conAppDe(b(), suspendida, async (s) => {
          expect(
            (
              await s.intentar(
                "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Nueva')",
                [suspendida.empresa, suspendida.sucursal],
              )
            ).ok,
          ).toBe(false);
          expect(
            (
              await s.intentar("update medio_de_pago set activo = false where id = $1", [
                e.medios.OTRO,
              ])
            ).ok,
          ).toBe(true);
          filas(
            await s.intentar("update medio_de_pago set activo = false where id = $1", [
              e.medios.OTRO,
            ]),
            0,
          );
          expect((await abrirSesion(s, e).catch(() => "no")) === "no").toBe(true);
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("reversión", () => {
      const rutaDeReversion = () =>
        join(CARPETA_DE_MIGRACIONES, "reversiones", "0027_revertir_caja.sql");

      it("se niega con una sola fila guardada y no cambia nada", async () => {
        const sql = await readFile(rutaDeReversion(), "utf8");
        await dueno.query("begin");
        try {
          const error = await dueno.query(sql).then(
            () => null,
            (e: { code?: string; message?: string }) => e,
          );
          expect(error?.code).toBe("55000");
          expect(error?.message).toMatch(/solo corre con las tablas vacías/);
        } finally {
          await dueno.query("rollback");
        }
        const { rows } = await dueno.query<{ n: string }>(
          "select count(*)::text as n from sesion_caja",
        );
        expect(Number(rows[0]?.n)).toBeGreaterThan(0);
      });

      it("con tablas vacías y las listas sin tocar deja el catálogo sin nada de caja, borra su fila del registro y se puede repetir", async () => {
        const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
        const c = new pg.Client({ connectionString: aparte.base.dueno });
        await c.connect();
        try {
          const sql = await readFile(rutaDeReversion(), "utf8");
          await c.query("begin");
          await c.query(sql);
          await c.query(sql); // repetirla no cambia nada
          const { rows } = await c.query<{ n: string }>(
            `select count(*)::text as n from pg_class where relname in ('caja', 'medio_de_pago', 'cuenta_de_cobro', 'sesion_caja',
            'movimiento_caja', 'cobro', 'arqueo_caja', 'arqueo_billete', 'valor_de_lista', 'correccion_de_medio', 'declaracion_de_total',
            'conforme_de_jornada', 'cierre_de_caja_de_jornada', 'conciliacion_de_jornada', 'conciliacion_de_cobro_por_origen')`,
          );
          expect(rows[0]?.n).toBe("0");
          const { rows: funciones } = await c.query<{ n: string }>(
            `select count(*)::text as n from pg_proc where proname in ('fecha_de_negocio', 'cuenta_admitida_por_medio',
            'par_de_cobro_validar', 'sesion_caja_validar_alta', 'cierre_de_caja_verificar', 'movimiento_caja_validar_alta')`,
          );
          expect(funciones[0]?.n).toBe("0");
          const { rows: ordenes } = await c.query<{ n: string }>(
            "select count(*)::text as n from pg_collation where collname = 'valor_de_lista_nombre_ci'",
          );
          expect(ordenes[0]?.n).toBe("0");
          const { rows: registro } = await c.query<{ n: string }>(
            "select count(*)::text as n from migracion where nombre like '%\\_caja.sql' escape '\\'",
          );
          expect(registro[0]?.n).toBe("0");
          await c.query("rollback");
        } finally {
          await c.end();
          await aparte.destruir();
        }
      });

      it("se niega si la plataforma cambió una lista (una semilla renombrada o un valor agregado)", async () => {
        const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
        const c = new pg.Client({ connectionString: aparte.base.dueno });
        await c.connect();
        try {
          const sql = await readFile(rutaDeReversion(), "utf8");
          await c.query("begin");
          await c.query(
            "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Diners')",
          );
          const error = await c.query(sql).then(
            () => null,
            (e: { code?: string; message?: string }) => e,
          );
          expect(error?.code).toBe("55000");
          expect(error?.message).toMatch(/listas del sistema/);
          await c.query("rollback");
        } finally {
          await c.end();
          await aparte.destruir();
        }
      });
    });
  },
);
