import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { clavesDe } from "../../src/capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../src/capacidades/permisos/empresa";
import { TIPOS_DE_MEDIO } from "../../src/modulos/caja/publico";
import { ok } from "../../src/primitivas/resultado/resultado";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  REGLAS_DE_CAJA,
  armarCaja,
  crearEntornoDeCaja,
  crearMundoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type MundoDeCaja,
  type OpcionesDeMundoDeCaja,
} from "./caja-configuracion-apoyo";

/**
 * La configuración de caja (E3, tramo 3) con los roles limitados y una base real: el guard por módulo y por rol, la empresa opera, el
 * alcance de sucursal, cada caso de uso (cajas, medios de pago y cuentas de cobro) con su validación, su idempotencia por estado, su
 * auditoría en la misma transacción y el aislamiento entre empresas; el límite del plan; «solo lectura» por baja de plan; y las consultas
 * (que no escriben). La concurrencia está en `caja-configuracion-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

type Fila = Record<string, unknown>;
const NADA = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
const cualquierTexto = expect.any(String) as unknown;
const HUELLA = "a".repeat(64);
const AHORA_DE_LA_SESION = "2026-11-09T22:00:00Z";

describe.skipIf(base === null)("configuración de caja: casos de uso y consultas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const casos = () => caja.casos;
  const consultas = () => caja.consultas;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeCaja(entornoBase, dueno, opciones);
  const auditorias = (m: MundoDeCaja, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const constancias = (m: MundoDeCaja, accion: string) =>
    filas<{ entidad_id: string; actor_persona_id: string; antes: unknown; despues: unknown }>(
      `select entidad_id, actor_persona_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and accion = $2 order by id`,
      [m.empresa, accion],
    );
  /** Todo lo que escribe la configuración de una empresa (filas con sus versiones, más la cuenta de auditorías `CAJA_*`...). */
  const foto = async (m: MundoDeCaja) =>
    JSON.stringify({
      cajas: await filas("select * from caja where empresa_id = $1 order by id", [m.empresa]),
      medios: await filas("select * from medio_de_pago where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      cuentas: await filas("select * from cuenta_de_cobro where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      auditoria: await contar(
        `select count(*) as n from auditoria_empresa where empresa_id = $1
           and (accion like 'CAJA\\_%' or accion like 'MEDIO\\_DE\\_PAGO\\_%' or accion like 'CUENTA\\_DE\\_COBRO\\_%')`,
        [m.empresa],
      ),
    });
  const cajaDe = async (m: MundoDeCaja, nombre: string) => {
    const r = await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre });
    if (!r.ok) throw new Error(`no se pudo crear la caja ${nombre}: ${JSON.stringify(r.error)}`);
    return r.valor.cajaId;
  };
  const medioDe = async (m: MundoDeCaja, tipo: string, nombre: string | null) => {
    const r = await casos().crearMedioDePago(m.ctx(), { tipo, nombre });
    if (!r.ok) throw new Error(`no se pudo crear el medio ${tipo}: ${JSON.stringify(r.error)}`);
    return r.valor.medioDePagoId;
  };
  const cuentaDe = async (
    m: MundoDeCaja,
    nombre: string,
    tipo = "TERMINAL",
    identificadorExterno: string | null = null,
    sucursalId: string = m.sucursal,
  ) => {
    const r = await casos().crearCuentaDeCobro(m.ctx(), {
      tipo,
      nombre,
      identificadorExterno,
      sucursalId,
    });
    if (!r.ok) throw new Error(`no se pudo crear la cuenta ${nombre}: ${JSON.stringify(r.error)}`);
    return r.valor.cuentaDeCobroId;
  };
  const versionDe = async (tabla: "caja" | "medio_de_pago" | "cuenta_de_cobro", id: string) =>
    Number(
      (await filas<{ version: number }>(`select version from ${tabla} where id = $1`, [id]))[0]
        ?.version,
    );
  const suspenderEmpresa = (empresa: string) =>
    dueno.query("update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
      empresa,
    ]);
  const suspenderTenant = (tenant: string) =>
    dueno.query("update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
      tenant,
    ]);

  /** Abre una sesión de caja como la aplicación (la base exige la persona del contexto): deja la caja con una sesión sin cerrar. */
  const abrirUnaSesion = async (m: MundoDeCaja, cajaId: string) => {
    await dueno.query(
      `insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio)
       select c.empresa_id, c.sucursal_id, fecha_de_negocio($2::timestamptz, e.zona_horaria, s.hora_de_corte)
         from caja c join sucursal s on s.id = c.sucursal_id join empresa e on e.id = c.empresa_id
        where c.id = $1 on conflict do nothing`,
      [cajaId, AHORA_DE_LA_SESION],
    );
    const r = await entorno.ejecutar({ contexto: m.ctx() }, async (tx) => {
      await sql`insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                         clave_idempotencia, huella)
                select c.empresa_id, c.id, fecha_de_negocio(${AHORA_DE_LA_SESION}::timestamptz, e.zona_horaria, s.hora_de_corte),
                       s.hora_de_corte, e.zona_horaria, ${AHORA_DE_LA_SESION}::timestamptz, ${m.persona}::uuid,
                       ${`clave-de-prueba-${cajaId}`}, ${HUELLA}
                  from caja c join sucursal s on s.id = c.sucursal_id join empresa e on e.id = c.empresa_id
                 where c.id = ${cajaId}::uuid`.execute(tx.db);
      return ok(null);
    });
    expect(r.ok).toBe(true);
  };

  // =============================================================================================
  describe("guard, módulos y empresa", () => {
    it("el rol decide cada caso (e3 §3.8): gerente, administrador y operador, y sin permiso no se escribe nada", async () => {
      const m = await mundo({ rol: "GERENTE" });
      const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR", true);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const roles = { GERENTE: m.ctx, ADMINISTRADOR: administrador, OPERADOR: operador } as const;
      const intentos = {
        "cajas.crear": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().crearCaja(ctx(), { sucursalId: m.sucursal, nombre: "Caja de prueba" }),
        "cajas.editar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().editarCaja(ctx(), {
            cajaId: "00000000-0000-4000-8000-000000000000",
            versionEsperada: 1,
            nombre: "X",
          }),
        "cajas.desactivar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().desactivarCaja(ctx(), { cajaId: "00000000-0000-4000-8000-000000000000" }),
        "cajas.reactivar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().reactivarCaja(ctx(), { cajaId: "00000000-0000-4000-8000-000000000000" }),
        "medios_de_pago.crear": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().crearMedioDePago(ctx(), { tipo: "QR", nombre: null }),
        "medios_de_pago.editar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().editarMedioDePago(ctx(), {
            medioDePagoId: "00000000-0000-4000-8000-000000000000",
            versionEsperada: 1,
            nombre: null,
            datos: NADA,
          }),
        "medios_de_pago.desactivar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().desactivarMedioDePago(ctx(), {
            medioDePagoId: "00000000-0000-4000-8000-000000000000",
          }),
        "medios_de_pago.reactivar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().reactivarMedioDePago(ctx(), {
            medioDePagoId: "00000000-0000-4000-8000-000000000000",
          }),
        "cuentas_de_cobro.crear": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().crearCuentaDeCobro(ctx(), {
            tipo: "TERMINAL",
            nombre: "T9",
            identificadorExterno: null,
            sucursalId: m.sucursal,
          }),
        "cuentas_de_cobro.editar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().editarCuentaDeCobro(ctx(), {
            cuentaDeCobroId: "00000000-0000-4000-8000-000000000000",
            versionEsperada: 1,
            nombre: "T9",
            identificadorExterno: null,
            sucursalId: m.sucursal,
          }),
        "cuentas_de_cobro.desactivar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().desactivarCuentaDeCobro(ctx(), {
            cuentaDeCobroId: "00000000-0000-4000-8000-000000000000",
          }),
        "cuentas_de_cobro.reactivar": (ctx: () => ReturnType<typeof m.ctx>) =>
          casos().reactivarCuentaDeCobro(ctx(), {
            cuentaDeCobroId: "00000000-0000-4000-8000-000000000000",
          }),
      } as const;
      for (const [accion, intentar] of Object.entries(intentos)) {
        const permitidos = PERMISOS_DE_EMPRESA[accion as keyof typeof PERMISOS_DE_EMPRESA];
        for (const [rol, ctx] of Object.entries(roles)) {
          const antes = await foto(m);
          const r = await intentar(ctx);
          const puede = (permitidos as readonly string[]).includes(rol);
          if (puede) {
            expect(r.ok ? null : r.error, `${accion} ${rol}`).not.toBe("SIN_PERMISO");
          } else {
            expect(r, `${accion} ${rol}`).toEqual({ ok: false, error: "SIN_PERMISO" });
            expect(await foto(m), `${accion} ${rol}`).toBe(antes);
          }
          // Una vez creadas, las cosas existen: el siguiente rol ya no crea, pero el guard va igual primero.
        }
      }
    });

    it("sin persona en el contexto no hay permiso: sin rol el actor no trae ni módulos, así que el guard rechaza y nada se escribe", async () => {
      const m = await mundo();
      const sinPersona = { ...m.ctx(), personaId: null };
      const antes = await foto(m);
      const rechazos = [
        await casos().crearCaja(sinPersona, { sucursalId: m.sucursal, nombre: "Caja 1" }),
        await casos().crearMedioDePago(sinPersona, { tipo: "QR", nombre: null }),
        await consultas().listarMediosDePago(sinPersona),
        await consultas().listarCajas(sinPersona, { sucursalId: m.sucursal }),
      ];
      for (const rechazo of rechazos) {
        expect(rechazo.ok).toBe(false);
        expect(["SIN_PERMISO", "MODULO_NO_ACTIVO"]).toContain(rechazo.ok ? null : rechazo.error);
      }
      expect(await foto(m)).toBe(antes);
    });

    it("con el catálogo real, caja está en desarrollo: todo se rechaza con MODULO_EN_DESARROLLO (todo nace cerrado)", async () => {
      expect(CATALOGO_DE_MODULOS.caja.estado).toBe("en_desarrollo");
      const m = await mundo();
      const real = armarCaja(entorno, REGLAS_DE_EMPRESA);
      const antes = await foto(m);
      for (const r of [
        await real.casos.crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
        await real.casos.crearMedioDePago(m.ctx(), { tipo: "QR", nombre: null }),
        await real.consultas.listarMediosDePago(m.ctx()),
        await real.consultas.listarCajas(m.ctx(), { sucursalId: m.sucursal }),
      ]) {
        expect(r).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
      }
      expect(await foto(m)).toBe(antes);
    });

    it("sin el módulo caja activado en la empresa da MODULO_NO_ACTIVO, también en las consultas", async () => {
      const m = await mundo({ plan: ["caja"], activados: [] });
      const antes = await foto(m);
      expect(
        await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
      ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      expect(await consultas().listarCuentasDeCobro(m.ctx())).toEqual({
        ok: false,
        error: "MODULO_NO_ACTIVO",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("solo lectura por baja de plan: se bloquea crear, editar y reactivar; se permite desactivar y mirar (e3 §3.8)", async () => {
      // Primero con el plan completo: quedan una caja activa, un medio y una cuenta activos, y un medio y una caja desactivados.
      const m = await mundo({ limiteDeCajas: 3 });
      const cajaActiva = await cajaDe(m, "Caja 1");
      const cajaInactiva = await cajaDe(m, "Caja 2");
      expect((await casos().desactivarCaja(m.ctx(), { cajaId: cajaInactiva })).ok).toBe(true);
      const medioActivo = await medioDe(m, "QR", "QR 1");
      const medioInactivo = await medioDe(m, "OTRO", "Otro 1");
      expect(
        (await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: medioInactivo })).ok,
      ).toBe(true);
      const cuentaActiva = await cuentaDe(m, "Terminal 1");
      const cuentaInactiva = await cuentaDe(m, "Terminal 2");
      expect(
        (await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: cuentaInactiva })).ok,
      ).toBe(true);
      // Ahora la baja de plan: sin `caja` en el techo (la empresa lo conserva activado).
      const { crearPlanPublicado, asignarPlan } = await import("./marcas-apoyo");
      const { version } = await crearPlanPublicado(dueno, { modulos: [] });
      await asignarPlan(dueno, m.tenant, version, { desdeSegundos: -5 });

      const antes = await foto(m);
      const bloqueados = [
        await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 9" }),
        await casos().editarCaja(m.ctx(), { cajaId: cajaActiva, versionEsperada: 1, nombre: "X" }),
        await casos().reactivarCaja(m.ctx(), { cajaId: cajaInactiva }),
        await casos().crearMedioDePago(m.ctx(), { tipo: "OTRO", nombre: "Otro 9" }),
        await casos().editarMedioDePago(m.ctx(), {
          medioDePagoId: medioActivo,
          versionEsperada: 1,
          nombre: "X",
          datos: NADA,
        }),
        await casos().reactivarMedioDePago(m.ctx(), { medioDePagoId: medioInactivo }),
        await casos().crearCuentaDeCobro(m.ctx(), {
          tipo: "TERMINAL",
          nombre: "T9",
          identificadorExterno: null,
          sucursalId: m.sucursal,
        }),
        await casos().editarCuentaDeCobro(m.ctx(), {
          cuentaDeCobroId: cuentaActiva,
          versionEsperada: 1,
          nombre: "X",
          identificadorExterno: null,
          sucursalId: m.sucursal,
        }),
        await casos().reactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: cuentaInactiva }),
      ];
      for (const r of bloqueados) expect(r).toEqual({ ok: false, error: "MODULO_EN_SOLO_LECTURA" });
      expect(await foto(m)).toBe(antes);

      // Lo que cierra sigue permitido, y las consultas también.
      expect(await casos().desactivarCaja(m.ctx(), { cajaId: cajaActiva })).toEqual({
        ok: true,
        valor: { yaEstabaInactiva: false },
      });
      expect(await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: medioActivo })).toEqual({
        ok: true,
        valor: { yaEstabaInactivo: false },
      });
      expect(
        await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: cuentaActiva }),
      ).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
      const lista = await consultas().listarCajas(m.ctx(), {
        sucursalId: m.sucursal,
        incluirInactivas: true,
      });
      expect(lista.ok && lista.valor.cajas).toHaveLength(2);
    });

    for (const caso of [
      { nombre: "suspendida", motivo: "EMPRESA_SUSPENDIDA", donde: "empresa" },
      { nombre: "con el tenant suspendido", motivo: "TENANT_SUSPENDIDO", donde: "tenant" },
    ] as const) {
      it(`una empresa ${caso.nombre} no configura caja: EMPRESA_NO_OPERA y nada escrito`, async () => {
        const m = await mundo();
        const medio = await medioDe(m, "QR", "QR 1");
        if (caso.donde === "empresa") await suspenderEmpresa(m.empresa);
        else await suspenderTenant(m.tenant);
        const antes = await foto(m);
        const esperado = {
          ok: false,
          error: { codigo: "EMPRESA_NO_OPERA", empresaId: m.empresa, motivo: caso.motivo },
        };
        expect(
          await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
        ).toEqual(esperado);
        expect(await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: medio })).toEqual(
          esperado,
        );
        expect(
          await casos().crearCuentaDeCobro(m.ctx(), {
            tipo: "TERMINAL",
            nombre: "T1",
            identificadorExterno: null,
            sucursalId: m.sucursal,
          }),
        ).toEqual(esperado);
        expect(await foto(m)).toBe(antes);
      });
    }
  });

  // =============================================================================================
  describe("alcance de sucursal", () => {
    /** Reglas en las que el OPERADOR puede configurar caja: así se prueba el alcance, que el gerente (todas) no ejercita. */
    const reglasConOperador: ReglasDeEmpresa = {
      catalogo: REGLAS_DE_CAJA.catalogo,
      permisos: Object.fromEntries(
        clavesDe(PERMISOS_DE_EMPRESA).map((accion) => [
          accion,
          accion.startsWith("cajas.") ||
          accion.startsWith("medios_de_pago.") ||
          accion.startsWith("cuentas_de_cobro.")
            ? ["GERENTE", "ADMINISTRADOR", "OPERADOR"]
            : PERMISOS_DE_EMPRESA[accion],
        ]),
      ) as unknown as ReglasDeEmpresa["permisos"],
    };

    it("el operador solo opera en las sucursales que tiene asignadas (cajas y cuentas)", async () => {
      const m = await mundo({ rol: "OPERADOR", asignarALaSucursal: true, limiteDeCajas: 5 });
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal ajena");
      const propios = armarCaja(entorno, reglasConOperador);
      // Lo de la sucursal asignada pasa.
      const propia = await propios.casos.crearCaja(m.ctx(), {
        sucursalId: m.sucursal,
        nombre: "Mía",
      });
      expect(propia).toEqual({ ok: true, valor: { cajaId: cualquierTexto, yaExistia: false } });
      const cuentaPropia = await propios.casos.crearCuentaDeCobro(m.ctx(), {
        tipo: "TERMINAL",
        nombre: "Terminal mía",
        identificadorExterno: null,
        sucursalId: m.sucursal,
      });
      expect(cuentaPropia.ok).toBe(true);
      // Una caja y una cuenta de la otra sucursal (las deja el dueño de la base).
      const ajena = (
        await filas<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Ajena') returning id",
          [m.empresa, otra],
        )
      )[0]?.id as string;
      const cuentaAjena = (
        await filas<{ id: string }>(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Terminal ajena', $2) returning id",
          [m.empresa, otra],
        )
      )[0]?.id as string;
      const antes = await foto(m);
      const fuera = { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" };
      expect(await propios.casos.crearCaja(m.ctx(), { sucursalId: otra, nombre: "Otra" })).toEqual(
        fuera,
      );
      expect(
        await propios.casos.editarCaja(m.ctx(), { cajaId: ajena, versionEsperada: 1, nombre: "Z" }),
      ).toEqual(fuera);
      expect(await propios.casos.desactivarCaja(m.ctx(), { cajaId: ajena })).toEqual(fuera);
      expect(await propios.casos.reactivarCaja(m.ctx(), { cajaId: ajena })).toEqual(fuera);
      expect(
        await propios.casos.crearCuentaDeCobro(m.ctx(), {
          tipo: "TERMINAL",
          nombre: "Nueva",
          identificadorExterno: null,
          sucursalId: otra,
        }),
      ).toEqual(fuera);
      expect(
        await propios.casos.editarCuentaDeCobro(m.ctx(), {
          cuentaDeCobroId: cuentaAjena,
          versionEsperada: 1,
          nombre: "Z",
          identificadorExterno: null,
          sucursalId: otra,
        }),
      ).toEqual(fuera);
      // Mover una cuenta propia a la sucursal ajena también está fuera de alcance.
      expect(
        await propios.casos.editarCuentaDeCobro(m.ctx(), {
          cuentaDeCobroId: cuentaPropia.ok ? cuentaPropia.valor.cuentaDeCobroId : "",
          versionEsperada: 1,
          nombre: "Terminal mía",
          identificadorExterno: null,
          sucursalId: otra,
        }),
      ).toEqual(fuera);
      expect(
        await propios.casos.desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: cuentaAjena }),
      ).toEqual(fuera);
      expect(
        await propios.casos.reactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: cuentaAjena }),
      ).toEqual(fuera);
      expect(await foto(m)).toBe(antes);
    });

    it("las consultas muestran al operador solo sus sucursales; el gerente, todas; un operador sin sucursales, ninguna", async () => {
      const m = await mundo({ rol: "OPERADOR", asignarALaSucursal: true });
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal ajena");
      await dueno.query(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'C1')",
        [m.empresa, m.sucursal],
      );
      await dueno.query(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'C2')",
        [m.empresa, otra],
      );
      for (const [nombre, sucursal] of [
        ["T propia", m.sucursal],
        ["T ajena", otra],
      ] as const) {
        await dueno.query(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', $2, $3)",
          [m.empresa, nombre, sucursal],
        );
      }
      const gerente = await sumarPersona(dueno, m, "GERENTE");
      const sinAsignar = await sumarPersona(dueno, m, "OPERADOR", false);
      const fueraDeAlcance = { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" };

      // El operador asignado: su sucursal sí, la otra no, y sin elegir sucursal ve las cuentas de la suya (nunca las de la otra).
      expect((await consultas().listarCajas(m.ctx(), { sucursalId: m.sucursal })).ok).toBe(true);
      expect(await consultas().listarCajas(m.ctx(), { sucursalId: otra })).toEqual(fueraDeAlcance);
      const suyas = await consultas().listarCuentasDeCobro(m.ctx());
      expect(suyas.ok && suyas.valor.cuentas.map((c) => c.nombre)).toEqual(["T propia"]);
      expect(await consultas().listarCuentasDeCobro(m.ctx(), { sucursalId: otra })).toEqual(
        fueraDeAlcance,
      );
      // El gerente ve todas.
      const todas = await consultas().listarCuentasDeCobro(gerente());
      expect(todas.ok && todas.valor.cuentas.map((c) => c.nombre).sort()).toEqual([
        "T ajena",
        "T propia",
      ]);
      const deLaOtra = await consultas().listarCajas(gerente(), { sucursalId: otra });
      expect(deLaOtra.ok && deLaOtra.valor.cajas.map((c) => c.nombre)).toEqual(["C2"]);
      // Un operador sin asignaciones no llega a ninguna sucursal.
      expect(await consultas().listarCajas(sinAsignar(), { sucursalId: m.sucursal })).toEqual(
        fueraDeAlcance,
      );
      expect(await consultas().listarCuentasDeCobro(sinAsignar())).toEqual({
        ok: true,
        valor: { cuentas: [] },
      });
    });
  });

  // =============================================================================================
  describe("crearCaja", () => {
    it("el gerente crea una caja: queda activa, en su sucursal, asegura el efectivo y deja su auditoría", async () => {
      const m = await mundo();
      const r = await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "  Caja   1 " });
      expect(r).toEqual({ ok: true, valor: { cajaId: cualquierTexto, yaExistia: false } });
      if (!r.ok) return;
      expect(
        await filas(
          "select empresa_id, sucursal_id, nombre, activa, version from caja where id = $1",
          [r.valor.cajaId],
        ),
      ).toEqual([
        {
          empresa_id: m.empresa,
          sucursal_id: m.sucursal,
          nombre: "Caja 1",
          activa: true,
          version: 1,
        },
      ]);
      // El efectivo de la empresa, sin nombre y activo; y la constancia de cada cosa en la misma transacción.
      expect(
        await filas("select tipo, nombre, activo from medio_de_pago where empresa_id = $1", [
          m.empresa,
        ]),
      ).toEqual([{ tipo: "EFECTIVO", nombre: null, activo: true }]);
      expect(await constancias(m, "CAJA_CREADA")).toEqual([
        {
          entidad_id: r.valor.cajaId,
          actor_persona_id: m.persona,
          antes: null,
          despues: { nombre: "Caja 1", sucursalId: m.sucursal, activa: true },
        },
      ]);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
    });

    it("crear la misma caja dos veces: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      const primera = await casos().crearCaja(m.ctx(), {
        sucursalId: m.sucursal,
        nombre: "Caja 1",
      });
      expect(primera.ok).toBe(true);
      const antes = await foto(m);
      const segunda = await casos().crearCaja(m.ctx(), {
        sucursalId: m.sucursal,
        nombre: "Caja 1",
      });
      expect(segunda).toEqual({
        ok: true,
        valor: { cajaId: primera.ok ? primera.valor.cajaId : "", yaExistia: true },
      });
      // Sin distinguir mayúsculas ni blancos de más (y sin pasar por el límite del plan: ya estaba hecha).
      expect(
        await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: " CAJA  1 " }),
      ).toEqual(segunda);
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
    });

    it("la segunda caja no vuelve a crear el efectivo ni lo audita", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      await cajaDe(m, "Caja 1");
      await cajaDe(m, "Caja 2");
      expect(
        await contar("select count(*) as n from medio_de_pago where empresa_id = $1", [m.empresa]),
      ).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(2);
    });

    it("el nombre se valida con la lista de permitidos y se mide en caracteres", async () => {
      const m = await mundo({ limiteDeCajas: "ILIMITADO" });
      const antes = await foto(m);
      for (const malo of [
        "",
        "   ",
        "a".repeat(101),
        "Caja\n1",
        "Caja <1>",
        "Caja 😀",
        "a=b",
        "a@b",
      ]) {
        expect(
          await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: malo }),
          JSON.stringify(malo),
        ).toEqual({ ok: false, error: "NOMBRE_DE_CAJA_INVALIDO" });
      }
      expect(await foto(m)).toBe(antes);
      expect(
        (await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "a".repeat(100) })).ok,
      ).toBe(true);
    });

    it("una sucursal inexistente, de otra empresa o que no es un UUID da SUCURSAL_NO_ENCONTRADA; una desactivada, SUCURSAL_INACTIVA", async () => {
      const m = await mundo();
      const otraEmpresa = await mundo();
      const antes = await foto(m);
      const noEncontrada = { ok: false, error: "SUCURSAL_NO_ENCONTRADA" };
      for (const sucursalId of [
        "00000000-0000-4000-8000-000000000000",
        otraEmpresa.sucursal,
        "no-es-un-uuid",
        "",
      ]) {
        expect(
          await casos().crearCaja(m.ctx(), { sucursalId, nombre: "Caja 1" }),
          sucursalId,
        ).toEqual(noEncontrada);
      }
      const cerrada = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal cerrada");
      await dueno.query("update sucursal set activa = false where id = $1", [cerrada]);
      expect(await casos().crearCaja(m.ctx(), { sucursalId: cerrada, nombre: "Caja 1" })).toEqual({
        ok: false,
        error: "SUCURSAL_INACTIVA",
      });
      expect(await foto(m)).toBe(antes);
      expect(await foto(otraEmpresa)).toBe(await foto(otraEmpresa));
    });

    it("una caja desactivada con ese nombre no se duplica: CAJA_INACTIVA_CON_ESE_NOMBRE", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      const id = await cajaDe(m, "Caja 1");
      await casos().desactivarCaja(m.ctx(), { cajaId: id });
      const antes = await foto(m);
      expect(
        await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "caja 1" }),
      ).toEqual({
        ok: false,
        error: "CAJA_INACTIVA_CON_ESE_NOMBRE",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("el mismo nombre en otra sucursal o en otra empresa es otra caja", async () => {
      const m = await mundo({ limiteDeCajas: 2 });
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
      const otraEmpresa = await mundo();
      const a = await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" });
      const b = await casos().crearCaja(m.ctx(), { sucursalId: otra, nombre: "Caja 1" });
      const c = await casos().crearCaja(otraEmpresa.ctx(), {
        sucursalId: otraEmpresa.sucursal,
        nombre: "Caja 1",
      });
      for (const r of [a, b, c]) {
        expect(r).toEqual({ ok: true, valor: { cajaId: cualquierTexto, yaExistia: false } });
      }
    });

    describe("el límite del plan (cajas_por_sucursal)", () => {
      it("la base es 1: la segunda caja activa de la sucursal da LIMITE_DEL_PLAN y no escribe nada", async () => {
        const m = await mundo();
        await cajaDe(m, "Caja 1");
        const antes = await foto(m);
        expect(
          await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 2" }),
        ).toEqual({
          ok: false,
          error: {
            codigo: "LIMITE_DEL_PLAN",
            perilla: "cajas_por_sucursal",
            limite: 1,
            usoActual: 1,
          },
        });
        expect(await foto(m)).toBe(antes);
      });

      it("cuenta por sucursal: otra sucursal tiene su propio cupo", async () => {
        const m = await mundo();
        const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
        await cajaDe(m, "Caja 1");
        expect((await casos().crearCaja(m.ctx(), { sucursalId: otra, nombre: "Caja 1" })).ok).toBe(
          true,
        );
      });

      it("el plan lo sube, un ajuste de plataforma lo cambia y ILIMITADO no tiene tope", async () => {
        const dos = await mundo({ limiteDeCajas: 2 });
        await cajaDe(dos, "Caja 1");
        await cajaDe(dos, "Caja 2");
        expect(
          await casos().crearCaja(dos.ctx(), { sucursalId: dos.sucursal, nombre: "Caja 3" }),
        ).toMatchObject({ ok: false, error: { codigo: "LIMITE_DEL_PLAN", limite: 2 } });

        const { ajustarPerilla } = await import("./marcas-apoyo");
        await ajustarPerilla(dueno, dos.tenant, "cajas_por_sucursal", "3");
        expect(
          (await casos().crearCaja(dos.ctx(), { sucursalId: dos.sucursal, nombre: "Caja 3" })).ok,
        ).toBe(true);
        await ajustarPerilla(dueno, dos.tenant, "cajas_por_sucursal", "ILIMITADO");
        for (const n of [4, 5, 6]) await cajaDe(dos, `Caja ${n}`);
        await ajustarPerilla(dueno, dos.tenant, "cajas_por_sucursal", "0");
        expect(
          await casos().crearCaja(dos.ctx(), { sucursalId: dos.sucursal, nombre: "Caja 7" }),
        ).toMatchObject({ ok: false, error: { codigo: "LIMITE_DEL_PLAN", limite: 0 } });
      });

      it("desactivar una caja libera el cupo; reactivarla vuelve a contar", async () => {
        const m = await mundo();
        const primera = await cajaDe(m, "Caja 1");
        await casos().desactivarCaja(m.ctx(), { cajaId: primera });
        const segunda = await cajaDe(m, "Caja 2");
        // Reactivar la primera haría dos activas: el límite también rige al reactivar.
        expect(await casos().reactivarCaja(m.ctx(), { cajaId: primera })).toEqual({
          ok: false,
          error: {
            codigo: "LIMITE_DEL_PLAN",
            perilla: "cajas_por_sucursal",
            limite: 1,
            usoActual: 1,
          },
        });
        expect(
          await contar("select count(*) as n from caja where id = $1 and activa", [primera]),
        ).toBe(0);
        await casos().desactivarCaja(m.ctx(), { cajaId: segunda });
        expect(await casos().reactivarCaja(m.ctx(), { cajaId: primera })).toEqual({
          ok: true,
          valor: { yaEstabaActiva: false },
        });
      });
    });
  });

  // =============================================================================================
  describe("editarCaja, desactivarCaja y reactivarCaja", () => {
    it("editar cambia el nombre, sube la versión y audita el antes y el después", async () => {
      const m = await mundo();
      const id = await cajaDe(m, "Caja 1");
      expect(
        await casos().editarCaja(m.ctx(), {
          cajaId: id,
          versionEsperada: 1,
          nombre: " Caja  principal ",
        }),
      ).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      expect(await filas("select nombre, version from caja where id = $1", [id])).toEqual([
        { nombre: "Caja principal", version: 2 },
      ]);
      expect(await constancias(m, "CAJA_EDITADA")).toEqual([
        {
          entidad_id: id,
          actor_persona_id: m.persona,
          antes: { nombre: "Caja 1" },
          despues: { nombre: "Caja principal" },
        },
      ]);
      // Cambiar solo las mayúsculas también es un cambio.
      expect(
        await casos().editarCaja(m.ctx(), {
          cajaId: id,
          versionEsperada: 2,
          nombre: "CAJA PRINCIPAL",
        }),
      ).toEqual({
        ok: true,
        valor: { version: 3 },
      });
    });

    it("repetir la edición ya aplicada de una caja devuelve la versión vigente y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cajaDe(m, "Caja 1");
      await casos().editarCaja(m.ctx(), { cajaId: id, versionEsperada: 1, nombre: "Caja 2" });
      const antes = await foto(m);
      // La misma edición, con la versión vieja que tenía la pantalla (un corte de conexión): mismo resultado, nada nuevo.
      expect(
        await casos().editarCaja(m.ctx(), { cajaId: id, versionEsperada: 1, nombre: "Caja 2" }),
      ).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CAJA_EDITADA")).toBe(1);
    });

    it("con otra versión da VERSION_DESACTUALIZADA; un nombre ya usado, CAJA_DUPLICADA; una caja ajena o inexistente, CAJA_NO_ENCONTRADA", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      const otraEmpresa = await mundo();
      const uno = await cajaDe(m, "Caja 1");
      await cajaDe(m, "Caja 2");
      const ajena = await cajaDe(otraEmpresa, "Caja ajena");
      const antes = await foto(m);
      const antesAjena = await foto(otraEmpresa);
      expect(
        await casos().editarCaja(m.ctx(), { cajaId: uno, versionEsperada: 7, nombre: "Otra" }),
      ).toEqual({
        ok: false,
        error: "VERSION_DESACTUALIZADA",
      });
      expect(
        await casos().editarCaja(m.ctx(), { cajaId: uno, versionEsperada: 1, nombre: "caja 2" }),
      ).toEqual({
        ok: false,
        error: "CAJA_DUPLICADA",
      });
      expect(
        await casos().editarCaja(m.ctx(), { cajaId: uno, versionEsperada: 1, nombre: "" }),
      ).toEqual({
        ok: false,
        error: "NOMBRE_DE_CAJA_INVALIDO",
      });
      for (const cajaId of [ajena, "00000000-0000-4000-8000-000000000000", "no-es-un-uuid"]) {
        expect(
          await casos().editarCaja(m.ctx(), { cajaId, versionEsperada: 1, nombre: "X" }),
        ).toEqual({
          ok: false,
          error: "CAJA_NO_ENCONTRADA",
        });
        expect(await casos().desactivarCaja(m.ctx(), { cajaId })).toEqual({
          ok: false,
          error: "CAJA_NO_ENCONTRADA",
        });
        expect(await casos().reactivarCaja(m.ctx(), { cajaId })).toEqual({
          ok: false,
          error: "CAJA_NO_ENCONTRADA",
        });
      }
      expect(await foto(m)).toBe(antes);
      expect(await foto(otraEmpresa)).toBe(antesAjena);
    });

    it("desactivar una caja dos veces: la segunda devuelve yaEstabaInactiva y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cajaDe(m, "Caja 1");
      expect(await casos().desactivarCaja(m.ctx(), { cajaId: id })).toEqual({
        ok: true,
        valor: { yaEstabaInactiva: false },
      });
      const antes = await foto(m);
      expect(await casos().desactivarCaja(m.ctx(), { cajaId: id })).toEqual({
        ok: true,
        valor: { yaEstabaInactiva: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CAJA_DESACTIVADA")).toBe(1);
      expect(await constancias(m, "CAJA_DESACTIVADA")).toEqual([
        {
          entidad_id: id,
          actor_persona_id: m.persona,
          antes: { nombre: "Caja 1", activa: true },
          despues: { nombre: "Caja 1", activa: false },
        },
      ]);
      // Nada se borra: la caja conserva su nombre.
      expect(await filas("select nombre, activa from caja where id = $1", [id])).toEqual([
        { nombre: "Caja 1", activa: false },
      ]);
    });

    it("reactivar una caja dos veces: la segunda devuelve yaEstabaActiva y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cajaDe(m, "Caja 1");
      expect(await casos().reactivarCaja(m.ctx(), { cajaId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActiva: true },
      });
      await casos().desactivarCaja(m.ctx(), { cajaId: id });
      expect(await casos().reactivarCaja(m.ctx(), { cajaId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActiva: false },
      });
      const antes = await foto(m);
      expect(await casos().reactivarCaja(m.ctx(), { cajaId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActiva: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CAJA_REACTIVADA")).toBe(1);
    });

    it("una caja con una sesión sin cerrar no se desactiva: CAJA_CON_SESION_VIGENTE y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cajaDe(m, "Caja 1");
      await abrirUnaSesion(m, id);
      const antes = await foto(m);
      expect(await casos().desactivarCaja(m.ctx(), { cajaId: id })).toEqual({
        ok: false,
        error: "CAJA_CON_SESION_VIGENTE",
      });
      expect(await foto(m)).toBe(antes);
      expect(await filas("select activa from caja where id = $1", [id])).toEqual([
        { activa: true },
      ]);
    });
  });

  // =============================================================================================
  describe("medios de pago", () => {
    it("crear un medio: nace activo y sin pedir ningún dato (decisión 129), y deja su auditoría", async () => {
      const m = await mundo();
      const r = await casos().crearMedioDePago(m.ctx(), {
        tipo: "TARJETA_CREDITO",
        nombre: " Visa  crédito ",
      });
      expect(r).toEqual({ ok: true, valor: { medioDePagoId: cualquierTexto, yaExistia: false } });
      if (!r.ok) return;
      expect(
        await filas(
          `select tipo, nombre, activo, pide_cupon, pide_ultimos4, pide_marca, pide_cuotas, pide_dni, version
             from medio_de_pago where id = $1`,
          [r.valor.medioDePagoId],
        ),
      ).toEqual([
        {
          tipo: "TARJETA_CREDITO",
          nombre: "Visa crédito",
          activo: true,
          pide_cupon: false,
          pide_ultimos4: false,
          pide_marca: false,
          pide_cuotas: false,
          pide_dni: false,
          version: 1,
        },
      ]);
      expect(await constancias(m, "MEDIO_DE_PAGO_CREADO")).toEqual([
        {
          entidad_id: r.valor.medioDePagoId,
          actor_persona_id: m.persona,
          antes: null,
          despues: { tipo: "TARJETA_CREDITO", nombre: "Visa crédito", activo: true },
        },
      ]);
    });

    it("crear el mismo medio de pago dos veces: el segundo devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const primero = await casos().crearMedioDePago(m.ctx(), {
        tipo: "QR",
        nombre: "QR del salón",
      });
      expect(primero.ok).toBe(true);
      const antes = await foto(m);
      const id = primero.ok ? primero.valor.medioDePagoId : "";
      expect(
        await casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre: "QR del salón" }),
      ).toEqual({
        ok: true,
        valor: { medioDePagoId: id, yaExistia: true },
      });
      // Sin distinguir mayúsculas ni blancos de más.
      expect(
        await casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre: " qr  DEL salón " }),
      ).toEqual({
        ok: true,
        valor: { medioDePagoId: id, yaExistia: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
    });

    it("un medio sin nombre es uno por tipo; el mismo pedido ya existía y otro tipo sin nombre es otro medio", async () => {
      const m = await mundo();
      const a = await casos().crearMedioDePago(m.ctx(), { tipo: "TRANSFERENCIA", nombre: null });
      const b = await casos().crearMedioDePago(m.ctx(), { tipo: "TRANSFERENCIA", nombre: null });
      const c = await casos().crearMedioDePago(m.ctx(), { tipo: "OTRO", nombre: null });
      expect(a.ok && a.valor.yaExistia).toBe(false);
      expect(b).toEqual({
        ok: true,
        valor: { medioDePagoId: a.ok ? a.valor.medioDePagoId : "", yaExistia: true },
      });
      expect(c.ok && c.valor.yaExistia).toBe(false);
    });

    it("un nombre que usa un medio de otro tipo es MEDIO_DUPLICADO; el de uno desactivado, MEDIO_INACTIVO_CON_ESE_NOMBRE", async () => {
      const m = await mundo();
      const visa = await medioDe(m, "TARJETA_DEBITO", "Visa");
      const antes = await foto(m);
      expect(
        await casos().crearMedioDePago(m.ctx(), { tipo: "TARJETA_CREDITO", nombre: "visa" }),
      ).toEqual({
        ok: false,
        error: "MEDIO_DUPLICADO",
      });
      await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: visa });
      const despues = await foto(m);
      expect(despues).not.toBe(antes);
      expect(
        await casos().crearMedioDePago(m.ctx(), { tipo: "TARJETA_DEBITO", nombre: "Visa" }),
      ).toEqual({
        ok: false,
        error: "MEDIO_INACTIVO_CON_ESE_NOMBRE",
      });
      expect(await casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre: "Visa" })).toEqual({
        ok: false,
        error: "MEDIO_DUPLICADO",
      });
      expect(await foto(m)).toBe(despues);
    });

    it("el tipo y el nombre se validan", async () => {
      const m = await mundo();
      const antes = await foto(m);
      for (const tipo of ["", "efectivo", "DEVOLUCION", "TERMINAL", "constructor"]) {
        expect(await casos().crearMedioDePago(m.ctx(), { tipo, nombre: null }), tipo).toEqual({
          ok: false,
          error: "TIPO_DE_MEDIO_INVALIDO",
        });
      }
      for (const nombre of ["", "   ", "a".repeat(61), "Vi\nsa", "Visa <1>", "😀"]) {
        expect(await casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre }), nombre).toEqual({
          ok: false,
          error: "NOMBRE_DE_MEDIO_INVALIDO",
        });
      }
      expect(await foto(m)).toBe(antes);
      expect(
        (await casos().crearMedioDePago(m.ctx(), { tipo: "QR", nombre: "a".repeat(60) })).ok,
      ).toBe(true);
    });

    it("hay un solo efectivo por empresa: lo asegura crearCaja; pedirlo igual ya existía y con otro nombre es EFECTIVO_YA_EXISTE", async () => {
      const m = await mundo();
      // Sin efectivo, se puede crear explícitamente (y crearCaja ya no lo vuelve a crear).
      const efectivo = await casos().crearMedioDePago(m.ctx(), { tipo: "EFECTIVO", nombre: null });
      expect(efectivo).toEqual({
        ok: true,
        valor: { medioDePagoId: cualquierTexto, yaExistia: false },
      });
      await cajaDe(m, "Caja 1");
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
      expect(
        await contar("select count(*) as n from medio_de_pago where empresa_id = $1", [m.empresa]),
      ).toBe(1);
      expect(await casos().crearMedioDePago(m.ctx(), { tipo: "EFECTIVO", nombre: null })).toEqual({
        ok: true,
        valor: { medioDePagoId: efectivo.ok ? efectivo.valor.medioDePagoId : "", yaExistia: true },
      });
      const antes = await foto(m);
      expect(
        await casos().crearMedioDePago(m.ctx(), { tipo: "EFECTIVO", nombre: "Caja chica" }),
      ).toEqual({
        ok: false,
        error: "EFECTIVO_YA_EXISTE",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("editar cambia el nombre y los datos que pide, sube la versión y audita el antes y el después", async () => {
      const m = await mundo();
      const id = await medioDe(m, "TARJETA_CREDITO", "Visa");
      const datos = { ...NADA, cupon: true, ultimos4: true, cuotas: true };
      expect(
        await casos().editarMedioDePago(m.ctx(), {
          medioDePagoId: id,
          versionEsperada: 1,
          nombre: "Visa crédito",
          datos,
        }),
      ).toEqual({ ok: true, valor: { version: 2 } });
      expect(
        await filas(
          "select nombre, pide_cupon, pide_ultimos4, pide_marca, pide_cuotas, pide_dni, version from medio_de_pago where id = $1",
          [id],
        ),
      ).toEqual([
        {
          nombre: "Visa crédito",
          pide_cupon: true,
          pide_ultimos4: true,
          pide_marca: false,
          pide_cuotas: true,
          pide_dni: false,
          version: 2,
        },
      ]);
      expect(await constancias(m, "MEDIO_DE_PAGO_EDITADO")).toEqual([
        {
          entidad_id: id,
          actor_persona_id: m.persona,
          antes: { nombre: "Visa", pide: NADA },
          despues: { nombre: "Visa crédito", pide: datos },
        },
      ]);
      // Solo datos (sin tocar el nombre): la constancia lleva solo lo que cambió.
      await casos().editarMedioDePago(m.ctx(), {
        medioDePagoId: id,
        versionEsperada: 2,
        nombre: "Visa crédito",
        datos: { ...datos, marca: true },
      });
      const ultima = (await constancias(m, "MEDIO_DE_PAGO_EDITADO"))[1];
      expect(ultima?.antes).toEqual({ pide: datos });
      expect(ultima?.despues).toEqual({ pide: { ...datos, marca: true } });
      // El nombre puede quedar en blanco (sin nombre propio).
      expect(
        await casos().editarMedioDePago(m.ctx(), {
          medioDePagoId: id,
          versionEsperada: 3,
          nombre: null,
          datos: { ...datos, marca: true },
        }),
      ).toEqual({ ok: true, valor: { version: 4 } });
      expect(await filas("select nombre from medio_de_pago where id = $1", [id])).toEqual([
        { nombre: null },
      ]);
    });

    it("repetir la edición ya aplicada de un medio de pago devuelve la versión vigente y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await medioDe(m, "TARJETA_DEBITO", "Maestro");
      const pedido = {
        medioDePagoId: id,
        versionEsperada: 1,
        nombre: "Maestro débito",
        datos: { ...NADA, cupon: true },
      };
      expect(await casos().editarMedioDePago(m.ctx(), pedido)).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      const antes = await foto(m);
      expect(await casos().editarMedioDePago(m.ctx(), pedido)).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "MEDIO_DE_PAGO_EDITADO")).toBe(1);
    });

    it("cada tipo admite solo los datos de la decisión 129: otro se rechaza con el dato y no escribe nada", async () => {
      const m = await mundo();
      const admitidos: Record<string, readonly string[]> = {
        EFECTIVO: [],
        QR: [],
        OTRO: [],
        TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
        TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
        TRANSFERENCIA: ["dni"],
      };
      for (const tipo of TIPOS_DE_MEDIO) {
        if (tipo === "EFECTIVO") await cajaDe(m, "Caja 1");
        const id = await medioDe(m, tipo, tipo === "EFECTIVO" ? null : `Medio ${tipo}`);
        for (const dato of ["cupon", "ultimos4", "marca", "cuotas", "dni"] as const) {
          const antes = await foto(m);
          const r = await casos().editarMedioDePago(m.ctx(), {
            medioDePagoId: id,
            versionEsperada: await versionDe("medio_de_pago", id),
            nombre: tipo === "EFECTIVO" ? null : `Medio ${tipo}`,
            datos: { ...NADA, [dato]: true },
          });
          if (admitidos[tipo]?.includes(dato) === true) {
            expect(r.ok, `${tipo} ${dato}`).toBe(true);
            // Se deja como estaba para el dato siguiente.
            await casos().editarMedioDePago(m.ctx(), {
              medioDePagoId: id,
              versionEsperada: await versionDe("medio_de_pago", id),
              nombre: tipo === "EFECTIVO" ? null : `Medio ${tipo}`,
              datos: NADA,
            });
          } else {
            expect(r, `${tipo} ${dato}`).toEqual({
              ok: false,
              error: { codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato },
            });
            expect(await foto(m), `${tipo} ${dato}`).toBe(antes);
          }
        }
      }
    });

    it("con otra versión da VERSION_DESACTUALIZADA; un nombre ya usado, MEDIO_DUPLICADO; uno ajeno o inexistente, MEDIO_NO_ENCONTRADO", async () => {
      const m = await mundo();
      const otraEmpresa = await mundo();
      const a = await medioDe(m, "QR", "QR 1");
      await medioDe(m, "OTRO", "Otro 1");
      const ajeno = await medioDe(otraEmpresa, "QR", "QR ajeno");
      const antes = await foto(m);
      const antesAjeno = await foto(otraEmpresa);
      const pedido = { medioDePagoId: a, versionEsperada: 1, nombre: "QR nuevo", datos: NADA };
      expect(await casos().editarMedioDePago(m.ctx(), { ...pedido, versionEsperada: 9 })).toEqual({
        ok: false,
        error: "VERSION_DESACTUALIZADA",
      });
      expect(await casos().editarMedioDePago(m.ctx(), { ...pedido, nombre: "otro 1" })).toEqual({
        ok: false,
        error: "MEDIO_DUPLICADO",
      });
      expect(await casos().editarMedioDePago(m.ctx(), { ...pedido, nombre: "" })).toEqual({
        ok: false,
        error: "NOMBRE_DE_MEDIO_INVALIDO",
      });
      for (const medioDePagoId of [ajeno, "00000000-0000-4000-8000-000000000000", "basura"]) {
        expect(await casos().editarMedioDePago(m.ctx(), { ...pedido, medioDePagoId })).toEqual({
          ok: false,
          error: "MEDIO_NO_ENCONTRADO",
        });
        expect(await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId })).toEqual({
          ok: false,
          error: "MEDIO_NO_ENCONTRADO",
        });
        expect(await casos().reactivarMedioDePago(m.ctx(), { medioDePagoId })).toEqual({
          ok: false,
          error: "MEDIO_NO_ENCONTRADO",
        });
      }
      expect(await foto(m)).toBe(antes);
      expect(await foto(otraEmpresa)).toBe(antesAjeno);
    });

    it("desactivar un medio de pago dos veces: el segundo devuelve yaEstabaInactivo y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await medioDe(m, "QR", "QR 1");
      const otro = await medioDe(m, "OTRO", "Otro 1");
      expect(await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: id })).toEqual({
        ok: true,
        valor: { yaEstabaInactivo: false },
      });
      const antes = await foto(m);
      expect(await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: id })).toEqual({
        ok: true,
        valor: { yaEstabaInactivo: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "MEDIO_DE_PAGO_DESACTIVADO")).toBe(1);
      // Los otros medios no se tocan y lo desactivado conserva su nombre.
      expect(await filas("select activo from medio_de_pago where id = $1", [otro])).toEqual([
        { activo: true },
      ]);
      expect(await filas("select nombre, activo from medio_de_pago where id = $1", [id])).toEqual([
        { nombre: "QR 1", activo: false },
      ]);
    });

    it("reactivar un medio de pago dos veces: el segundo devuelve yaEstabaActivo y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await medioDe(m, "QR", "QR 1");
      expect(await casos().reactivarMedioDePago(m.ctx(), { medioDePagoId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActivo: true },
      });
      await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: id });
      expect(await casos().reactivarMedioDePago(m.ctx(), { medioDePagoId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActivo: false },
      });
      const antes = await foto(m);
      expect(await casos().reactivarMedioDePago(m.ctx(), { medioDePagoId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActivo: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "MEDIO_DE_PAGO_REACTIVADO")).toBe(1);
    });

    it("el efectivo no se desactiva nunca: EFECTIVO_NO_SE_DESACTIVA y nada escrito", async () => {
      const m = await mundo();
      await cajaDe(m, "Caja 1");
      const efectivo = (
        await filas<{ id: string }>("select id from medio_de_pago where empresa_id = $1", [
          m.empresa,
        ])
      )[0]?.id as string;
      const antes = await foto(m);
      for (let i = 0; i < 2; i++) {
        expect(await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: efectivo })).toEqual({
          ok: false,
          error: "EFECTIVO_NO_SE_DESACTIVA",
        });
      }
      expect(await foto(m)).toBe(antes);
    });
  });

  // =============================================================================================
  describe("cuentas de cobro", () => {
    it("crear una cuenta: nace activa, en su sucursal; la auditoría no lleva el identificador externo", async () => {
      const m = await mundo();
      const r = await casos().crearCuentaDeCobro(m.ctx(), {
        tipo: "TERMINAL",
        nombre: " Terminal  del salón ",
        identificadorExterno: " T-100/a ",
        sucursalId: m.sucursal,
      });
      expect(r).toEqual({ ok: true, valor: { cuentaDeCobroId: cualquierTexto, yaExistia: false } });
      if (!r.ok) return;
      expect(
        await filas(
          "select empresa_id, tipo, nombre, identificador_externo, sucursal_id, activa, version from cuenta_de_cobro where id = $1",
          [r.valor.cuentaDeCobroId],
        ),
      ).toEqual([
        {
          empresa_id: m.empresa,
          tipo: "TERMINAL",
          nombre: "Terminal del salón",
          identificador_externo: "T-100/a",
          sucursal_id: m.sucursal,
          activa: true,
          version: 1,
        },
      ]);
      const [constancia] = await constancias(m, "CUENTA_DE_COBRO_CREADA");
      expect(constancia).toEqual({
        entidad_id: r.valor.cuentaDeCobroId,
        actor_persona_id: m.persona,
        antes: null,
        despues: {
          tipo: "TERMINAL",
          nombre: "Terminal del salón",
          sucursalId: m.sucursal,
          conIdentificadorExterno: true,
          activa: true,
        },
      });
      expect(JSON.stringify(constancia)).not.toContain("T-100");
    });

    it("crear la misma cuenta de cobro dos veces: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const pedido = {
        tipo: "QR",
        nombre: "QR del mostrador",
        identificadorExterno: "alias.qr",
        sucursalId: m.sucursal,
      };
      const primera = await casos().crearCuentaDeCobro(m.ctx(), pedido);
      expect(primera.ok).toBe(true);
      const antes = await foto(m);
      expect(await casos().crearCuentaDeCobro(m.ctx(), pedido)).toEqual({
        ok: true,
        valor: {
          cuentaDeCobroId: primera.ok ? primera.valor.cuentaDeCobroId : "",
          yaExistia: true,
        },
      });
      expect(
        await casos().crearCuentaDeCobro(m.ctx(), { ...pedido, nombre: " QR del  MOSTRADOR " }),
      ).toEqual({
        ok: true,
        valor: {
          cuentaDeCobroId: primera.ok ? primera.valor.cuentaDeCobroId : "",
          yaExistia: true,
        },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CUENTA_DE_COBRO_CREADA")).toBe(1);
    });

    it("el nombre es único en la empresa: otra cuenta (o la misma desactivada) con ese nombre es CUENTA_DUPLICADA", async () => {
      const m = await mundo();
      const id = await cuentaDe(m, "Terminal 1", "TERMINAL", "T-1");
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
      const antes = await foto(m);
      const duplicada = { ok: false, error: "CUENTA_DUPLICADA" };
      for (const cambio of [
        { tipo: "QR" },
        { identificadorExterno: "T-2" },
        { identificadorExterno: null },
        { sucursalId: otra as string },
      ]) {
        expect(
          await casos().crearCuentaDeCobro(m.ctx(), {
            tipo: "TERMINAL",
            nombre: "terminal 1",
            identificadorExterno: "T-1",
            sucursalId: m.sucursal,
            ...cambio,
          }),
          JSON.stringify(cambio),
        ).toEqual(duplicada);
      }
      await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id });
      const desactivada = await foto(m);
      expect(
        await casos().crearCuentaDeCobro(m.ctx(), {
          tipo: "TERMINAL",
          nombre: "Terminal 1",
          identificadorExterno: "T-1",
          sucursalId: m.sucursal,
        }),
      ).toEqual(duplicada);
      expect(await foto(m)).toBe(desactivada);
      expect(desactivada).not.toBe(antes);
    });

    it("el tipo, el nombre, el identificador y la sucursal se validan", async () => {
      const m = await mundo();
      const otraEmpresa = await mundo();
      const antes = await foto(m);
      const buena = {
        tipo: "TERMINAL",
        nombre: "Terminal 1",
        identificadorExterno: null,
        sucursalId: m.sucursal as string,
      };
      for (const tipo of ["", "EFECTIVO", "terminal", "CUENTA BANCARIA"]) {
        expect(await casos().crearCuentaDeCobro(m.ctx(), { ...buena, tipo }), tipo).toEqual({
          ok: false,
          error: "TIPO_DE_CUENTA_INVALIDO",
        });
      }
      for (const nombre of ["", "   ", "a".repeat(61), "T\n1", "T<1>", "😀"]) {
        expect(await casos().crearCuentaDeCobro(m.ctx(), { ...buena, nombre }), nombre).toEqual({
          ok: false,
          error: "NOMBRE_DE_CUENTA_INVALIDO",
        });
      }
      for (const identificadorExterno of [
        "",
        "   ",
        "a".repeat(41),
        "a;b",
        "á",
        "a\nb",
        "token=",
      ]) {
        expect(
          await casos().crearCuentaDeCobro(m.ctx(), { ...buena, identificadorExterno }),
          identificadorExterno,
        ).toEqual({ ok: false, error: "IDENTIFICADOR_EXTERNO_INVALIDO" });
      }
      for (const sucursalId of [
        "00000000-0000-4000-8000-000000000000",
        otraEmpresa.sucursal as string,
        "basura",
      ]) {
        expect(
          await casos().crearCuentaDeCobro(m.ctx(), { ...buena, sucursalId }),
          sucursalId,
        ).toEqual({
          ok: false,
          error: "SUCURSAL_NO_ENCONTRADA",
        });
      }
      expect(await foto(m)).toBe(antes);
      expect(
        (
          await casos().crearCuentaDeCobro(m.ctx(), {
            ...buena,
            nombre: "a".repeat(60),
            identificadorExterno: "a".repeat(40),
          })
        ).ok,
      ).toBe(true);
    });

    it("editar cambia el nombre, el identificador y la sucursal; la auditoría dice qué cambió sin el identificador", async () => {
      const m = await mundo();
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
      const id = await cuentaDe(m, "Terminal 1", "TERMINAL", "T-1");
      expect(
        await casos().editarCuentaDeCobro(m.ctx(), {
          cuentaDeCobroId: id,
          versionEsperada: 1,
          nombre: "Terminal norte",
          identificadorExterno: "T-99",
          sucursalId: otra,
        }),
      ).toEqual({ ok: true, valor: { version: 2 } });
      expect(
        await filas(
          "select nombre, identificador_externo, sucursal_id, tipo, version from cuenta_de_cobro where id = $1",
          [id],
        ),
      ).toEqual([
        {
          nombre: "Terminal norte",
          identificador_externo: "T-99",
          sucursal_id: otra,
          tipo: "TERMINAL",
          version: 2,
        },
      ]);
      const [constancia] = await constancias(m, "CUENTA_DE_COBRO_EDITADA");
      expect(constancia).toEqual({
        entidad_id: id,
        actor_persona_id: m.persona,
        antes: { nombre: "Terminal 1", sucursalId: m.sucursal, conIdentificadorExterno: true },
        despues: {
          nombre: "Terminal norte",
          sucursalId: otra,
          conIdentificadorExterno: true,
          cambioElIdentificadorExterno: true,
        },
      });
      expect(JSON.stringify(constancia)).not.toContain("T-99");
      // Quitar el identificador.
      await casos().editarCuentaDeCobro(m.ctx(), {
        cuentaDeCobroId: id,
        versionEsperada: 2,
        nombre: "Terminal norte",
        identificadorExterno: null,
        sucursalId: otra,
      });
      expect(
        await filas("select identificador_externo from cuenta_de_cobro where id = $1", [id]),
      ).toEqual([{ identificador_externo: null }]);
    });

    it("repetir la edición ya aplicada de una cuenta de cobro devuelve la versión vigente y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cuentaDe(m, "Terminal 1");
      const pedido = {
        cuentaDeCobroId: id,
        versionEsperada: 1,
        nombre: "Terminal 2",
        identificadorExterno: "T-2",
        sucursalId: m.sucursal as string,
      };
      expect(await casos().editarCuentaDeCobro(m.ctx(), pedido)).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      const antes = await foto(m);
      expect(await casos().editarCuentaDeCobro(m.ctx(), pedido)).toEqual({
        ok: true,
        valor: { version: 2 },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CUENTA_DE_COBRO_EDITADA")).toBe(1);
    });

    it("con otra versión da VERSION_DESACTUALIZADA; un nombre ya usado, CUENTA_DUPLICADA; una ajena o inexistente, CUENTA_DE_COBRO_NO_ENCONTRADA", async () => {
      const m = await mundo();
      const otraEmpresa = await mundo();
      const a = await cuentaDe(m, "Terminal 1");
      await cuentaDe(m, "Terminal 2");
      const ajena = await cuentaDe(otraEmpresa, "Terminal ajena");
      const antes = await foto(m);
      const antesAjena = await foto(otraEmpresa);
      const pedido = {
        cuentaDeCobroId: a,
        versionEsperada: 1,
        nombre: "Terminal nueva",
        identificadorExterno: null,
        sucursalId: m.sucursal as string,
      };
      expect(await casos().editarCuentaDeCobro(m.ctx(), { ...pedido, versionEsperada: 5 })).toEqual(
        {
          ok: false,
          error: "VERSION_DESACTUALIZADA",
        },
      );
      expect(
        await casos().editarCuentaDeCobro(m.ctx(), { ...pedido, nombre: "TERMINAL 2" }),
      ).toEqual({
        ok: false,
        error: "CUENTA_DUPLICADA",
      });
      expect(await casos().editarCuentaDeCobro(m.ctx(), { ...pedido, nombre: "" })).toEqual({
        ok: false,
        error: "NOMBRE_DE_CUENTA_INVALIDO",
      });
      expect(
        await casos().editarCuentaDeCobro(m.ctx(), { ...pedido, identificadorExterno: "a;b" }),
      ).toEqual({
        ok: false,
        error: "IDENTIFICADOR_EXTERNO_INVALIDO",
      });
      expect(
        await casos().editarCuentaDeCobro(m.ctx(), { ...pedido, sucursalId: otraEmpresa.sucursal }),
      ).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      for (const cuentaDeCobroId of [ajena, "00000000-0000-4000-8000-000000000000", "basura"]) {
        const noEncontrada = { ok: false, error: "CUENTA_DE_COBRO_NO_ENCONTRADA" };
        expect(await casos().editarCuentaDeCobro(m.ctx(), { ...pedido, cuentaDeCobroId })).toEqual(
          noEncontrada,
        );
        expect(await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId })).toEqual(
          noEncontrada,
        );
        expect(await casos().reactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId })).toEqual(
          noEncontrada,
        );
      }
      expect(await foto(m)).toBe(antes);
      expect(await foto(otraEmpresa)).toBe(antesAjena);
    });

    it("desactivar una cuenta de cobro dos veces: la segunda devuelve yaEstabaInactiva y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cuentaDe(m, "Terminal 1");
      expect(await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id })).toEqual({
        ok: true,
        valor: { yaEstabaInactiva: false },
      });
      const antes = await foto(m);
      expect(await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id })).toEqual({
        ok: true,
        valor: { yaEstabaInactiva: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CUENTA_DE_COBRO_DESACTIVADA")).toBe(1);
      expect(await filas("select nombre, activa from cuenta_de_cobro where id = $1", [id])).toEqual(
        [{ nombre: "Terminal 1", activa: false }],
      );
    });

    it("reactivar una cuenta de cobro dos veces: la segunda devuelve yaEstabaActiva y no escribe ni audita", async () => {
      const m = await mundo();
      const id = await cuentaDe(m, "Terminal 1");
      expect(await casos().reactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActiva: true },
      });
      await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id });
      expect(await casos().reactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActiva: false },
      });
      const antes = await foto(m);
      expect(await casos().reactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: id })).toEqual({
        ok: true,
        valor: { yaEstabaActiva: true },
      });
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "CUENTA_DE_COBRO_REACTIVADA")).toBe(1);
    });
  });

  // =============================================================================================
  describe("atomicidad y aislamiento", () => {
    it("si la auditoría falla, no queda nada escrito (caja, efectivo ni constancia)", async () => {
      const m = await mundo();
      const conFalla = crearEntornoDeCaja(propia.base, 2, (tx) => ({
        ...tx,
        auditoria: {
          registrar: () => Promise.reject(new Error("falla inyectada de la auditoría")),
        },
      }));
      try {
        const rotos = armarCaja(conFalla);
        await expect(
          rotos.casos.crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" }),
        ).rejects.toThrow("falla inyectada de la auditoría");
        await expect(
          rotos.casos.crearMedioDePago(m.ctx(), { tipo: "QR", nombre: "QR 1" }),
        ).rejects.toThrow("falla inyectada de la auditoría");
      } finally {
        await conFalla.cerrar();
      }
      expect(
        await contar("select count(*) as n from caja where empresa_id = $1", [m.empresa]),
      ).toBe(0);
      expect(
        await contar("select count(*) as n from medio_de_pago where empresa_id = $1", [m.empresa]),
      ).toBe(0);
    });

    it("cada empresa ve solo lo suyo: las consultas no cruzan empresas y lo de una no toca lo de la otra", async () => {
      const a = await mundo({ limiteDeCajas: 2 });
      const b = await mundo({ limiteDeCajas: 2 });
      await cajaDe(a, "Caja A");
      await cajaDe(b, "Caja B");
      await medioDe(a, "QR", "QR A");
      await medioDe(b, "QR", "QR B");
      await cuentaDe(a, "Terminal A");
      await cuentaDe(b, "Terminal B");
      const cajasDeA = await consultas().listarCajas(a.ctx(), { sucursalId: a.sucursal });
      expect(cajasDeA.ok && cajasDeA.valor.cajas.map((c) => c.nombre)).toEqual(["Caja A"]);
      // La sucursal de la otra empresa no es del alcance del gerente de esta: no se ve nada.
      const cruzada = await consultas().listarCajas(a.ctx(), { sucursalId: b.sucursal });
      expect(cruzada.ok && cruzada.valor.cajas).toEqual([]);
      const mediosDeA = await consultas().listarMediosDePago(a.ctx());
      expect(mediosDeA.ok && mediosDeA.valor.medios.map((x) => x.nombre).sort()).toEqual([
        "QR A",
        null,
      ]);
      const cuentasDeA = await consultas().listarCuentasDeCobro(a.ctx());
      expect(cuentasDeA.ok && cuentasDeA.valor.cuentas.map((c) => c.nombre)).toEqual([
        "Terminal A",
      ]);
      const cruzadas = await consultas().listarCuentasDeCobro(a.ctx(), { sucursalId: b.sucursal });
      expect(cruzadas.ok && cruzadas.valor.cuentas).toEqual([]);
    });
  });

  // =============================================================================================
  describe("consultas", () => {
    it("listarCajas no escribe: sin cajas devuelve cajas: [] y no deja filas, ni efectivo ni auditoría", async () => {
      const m = await mundo();
      const antes = await foto(m);
      expect(await consultas().listarCajas(m.ctx(), { sucursalId: m.sucursal })).toEqual({
        ok: true,
        valor: { cajas: [] },
      });
      expect(await foto(m)).toBe(antes);
      expect(
        await contar("select count(*) as n from medio_de_pago where empresa_id = $1", [m.empresa]),
      ).toBe(0);
    });

    it("listarCajas devuelve las activas ordenadas por nombre, y con incluirInactivas también las desactivadas; con su versión", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      const b = await cajaDe(m, "Beta");
      await cajaDe(m, "Alfa");
      const c = await cajaDe(m, "Gama");
      await casos().desactivarCaja(m.ctx(), { cajaId: c });
      await casos().editarCaja(m.ctx(), { cajaId: b, versionEsperada: 1, nombre: "Beta 2" });
      const activas = await consultas().listarCajas(m.ctx(), { sucursalId: m.sucursal });
      expect(activas).toEqual({
        ok: true,
        valor: {
          cajas: [
            {
              id: cualquierTexto,
              sucursalId: m.sucursal,
              nombre: "Alfa",
              activa: true,
              version: 1,
            },
            { id: b, sucursalId: m.sucursal, nombre: "Beta 2", activa: true, version: 2 },
          ],
        },
      });
      const todas = await consultas().listarCajas(m.ctx(), {
        sucursalId: m.sucursal,
        incluirInactivas: true,
      });
      expect(todas.ok && todas.valor.cajas.map((x) => [x.nombre, x.activa])).toEqual([
        ["Alfa", true],
        ["Beta 2", true],
        ["Gama", false],
      ]);
    });

    it("listarCajas pide una sucursal elegida: un UUID inválido es SUCURSAL_NO_ENCONTRADA y nunca se asumen todas", async () => {
      const m = await mundo();
      for (const sucursalId of ["", "basura", "00000000-0000-4000-8000-00000000000G"]) {
        expect(await consultas().listarCajas(m.ctx(), { sucursalId }), sucursalId).toEqual({
          ok: false,
          error: "SUCURSAL_NO_ENCONTRADA",
        });
      }
    });

    it("listarMediosDePago muestra tipo, nombre, estado, los datos que pide y la versión; los inactivos solo si se piden", async () => {
      const m = await mundo();
      const visa = await medioDe(m, "TARJETA_DEBITO", "Visa débito");
      const qr = await medioDe(m, "QR", "QR 1");
      await casos().editarMedioDePago(m.ctx(), {
        medioDePagoId: visa,
        versionEsperada: 1,
        nombre: "Visa débito",
        datos: { ...NADA, cupon: true, marca: true },
      });
      await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: qr });
      const activos = await consultas().listarMediosDePago(m.ctx());
      expect(activos).toEqual({
        ok: true,
        valor: {
          medios: [
            {
              id: visa,
              tipo: "TARJETA_DEBITO",
              nombre: "Visa débito",
              activo: true,
              datos: { ...NADA, cupon: true, marca: true },
              version: 2,
            },
          ],
        },
      });
      const todos = await consultas().listarMediosDePago(m.ctx(), { incluirInactivos: true });
      expect(todos.ok && todos.valor.medios.map((x) => [x.tipo, x.activo])).toEqual([
        ["QR", false],
        ["TARJETA_DEBITO", true],
      ]);
    });

    it("listarCuentasDeCobro muestra cada cuenta con su versión, por sucursal; las inactivas solo si se piden", async () => {
      const m = await mundo();
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
      const a = await cuentaDe(m, "Terminal 1", "TERMINAL", "T-1");
      await cuentaDe(m, "QR 1", "QR", null, otra);
      const c = await cuentaDe(m, "Banco 1", "CUENTA_BANCARIA", "alias.banco");
      await casos().desactivarCuentaDeCobro(m.ctx(), { cuentaDeCobroId: c });
      await casos().editarCuentaDeCobro(m.ctx(), {
        cuentaDeCobroId: a,
        versionEsperada: 1,
        nombre: "Terminal 1",
        identificadorExterno: "T-2",
        sucursalId: m.sucursal,
      });
      const deLaSucursal = await consultas().listarCuentasDeCobro(m.ctx(), {
        sucursalId: m.sucursal,
      });
      expect(deLaSucursal).toEqual({
        ok: true,
        valor: {
          cuentas: [
            {
              id: a,
              tipo: "TERMINAL",
              nombre: "Terminal 1",
              identificadorExterno: "T-2",
              sucursalId: m.sucursal,
              activa: true,
              version: 2,
            },
          ],
        },
      });
      const todas = await consultas().listarCuentasDeCobro(m.ctx(), { incluirInactivas: true });
      expect(todas.ok && todas.valor.cuentas.map((x) => x.nombre).sort()).toEqual([
        "Banco 1",
        "QR 1",
        "Terminal 1",
      ]);
      expect(await consultas().listarCuentasDeCobro(m.ctx(), { sucursalId: "basura" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
    });
  });
});
