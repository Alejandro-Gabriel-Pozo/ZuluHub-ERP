import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { crearBaseAparte, nombreAlAzar } from "./entorno";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  revocarDeBase,
  tokenAlAzar,
} from "./fixtures-identidad";
import { adminInexistente, crearAdminDeBase, esperarAccesoDenegado } from "./plataforma-apoyo";
import { crearConsultasDeSoporte, crearEntornoDeSoporte } from "./soporte-apoyo";
import {
  plataformaEn,
  sembrarEmpresa,
  sembrarTenant,
  sembrarTrabajoFallido,
  suspenderTenant,
} from "./soporte-datos";

/**
 * Consultas de soporte de nivel 1 (H5 §B.5.7 y §B.5.9) contra una base real, con el rol de plataforma
 * y el contexto firmado (nunca el dueño, salvo para armar el escenario): quién puede, qué devuelve,
 * cómo pagina, y que NUNCA aparece un dato operativo ni un secreto. Base propia de este archivo.
 */

const base = inject("baseDePruebas");
const HORA = 3_600_000;
// El `ahora` de estas pruebas: las altas y las invitaciones se fechan respecto de él.
const AHORA = new Date("2026-10-11T12:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * HORA);
const en = (horas: number) => new Date(AHORA.getTime() + horas * HORA);

function esperar<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`no esperaba el error ${JSON.stringify(r.error)}`);
  return r.valor;
}

const MARCA_OPERATIVA = "MARCA-OPERATIVA-NO-DEBE-SALIR";
const SECRETO = "SECRETO-NO-DEBE-SALIR";

describe.skipIf(base === null)("soporte de plataforma: consultas de nivel 1", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDeSoporte>;
  let consultas: ReturnType<typeof crearConsultasDeSoporte>;
  let dueno: pg.Client;
  let bajaId: ReturnType<typeof adminInexistente>;

  // Lo sembrado.
  const s = {
    tenantActivo: "",
    tenantSuspendido: "",
    empresaActiva: "",
    empresaSuspendida: "",
    empresaDelTenantSuspendido: "",
    altaSinInvitacion: "",
    altaVigente: "",
    altaVencida: "",
    invitacionAlta: "",
    invitacionAltaVieja: "",
    invitacionUsuario: "",
    invitacionRevocada: "",
    hashDeLaAlta: "",
    trabajoLimpio: "",
    trabajoConSecreto: "",
    claveDeUnTrabajo: "",
  };

  const admin = plataformaEn(AHORA);
  const soporte = plataformaEn(AHORA, { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeSoporte(propia.base, 10);
    consultas = crearConsultasDeSoporte(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    bajaId = (await crearAdminDeBase(dueno, { activo: false })).id;

    s.tenantActivo = await sembrarTenant(dueno, { nombre: "Tenant Activo" });
    s.tenantSuspendido = await sembrarTenant(dueno, { nombre: "Tenant Suspendido" });
    s.empresaActiva = await sembrarEmpresa(dueno, s.tenantActivo, {
      razonSocial: "Empresa Activa",
    });
    s.empresaSuspendida = await sembrarEmpresa(dueno, s.tenantActivo, {
      estado: "SUSPENDED",
      razonSocial: "Empresa Suspendida",
    });
    s.empresaDelTenantSuspendido = await sembrarEmpresa(dueno, s.tenantSuspendido, {
      estado: "PROVISIONING",
      razonSocial: "Empresa del Tenant Suspendido",
    });
    await suspenderTenant(dueno, s.tenantSuspendido);

    // Altas pendientes: sin invitación, con una vigente y con una vencida (más de 72 h).
    s.altaSinInvitacion = await sembrarEmpresa(dueno, s.tenantActivo, {
      estado: "PROVISIONING",
      creadoEn: hace(10),
      razonSocial: "Alta sin invitación",
    });
    s.altaVigente = await sembrarEmpresa(dueno, s.tenantActivo, {
      estado: "PROVISIONING",
      creadoEn: hace(20),
      razonSocial: "Alta vigente",
    });
    s.altaVencida = await sembrarEmpresa(dueno, s.tenantActivo, {
      estado: "PROVISIONING",
      creadoEn: hace(80),
      razonSocial: "Alta vencida",
    });
    const token = tokenAlAzar();
    s.hashDeLaAlta = token.tokenHash;
    const alta = await crearInvitacionDeBase(dueno, {
      tenant: s.tenantActivo,
      tipo: "ALTA_GERENTE",
      tokenHash: token.tokenHash,
      emitidaEn: hace(20),
      venceEn: en(4),
    });
    await incluirEmpresa(dueno, alta, s.altaVigente, "GERENTE");
    s.invitacionAlta = alta.id;
    // El alta vencida tiene DOS invitaciones: la vieja (revocada) y la última, ya vencida.
    const vieja = await crearInvitacionDeBase(dueno, {
      tenant: s.tenantActivo,
      tipo: "ALTA_GERENTE",
      emitidaEn: hace(79),
      venceEn: hace(55),
    });
    await incluirEmpresa(dueno, vieja, s.altaVencida, "GERENTE");
    await revocarDeBase(dueno, vieja);
    s.invitacionAltaVieja = vieja.id;
    const ultima = await crearInvitacionDeBase(dueno, {
      tenant: s.tenantActivo,
      tipo: "ALTA_GERENTE",
      emitidaEn: hace(78),
      venceEn: hace(54),
    });
    await incluirEmpresa(dueno, ultima, s.altaVencida, "GERENTE");

    // Invitaciones de usuario: una pendiente y una revocada.
    const usuario = await crearInvitacionDeBase(dueno, {
      tenant: s.tenantActivo,
      emitidaEn: hace(5),
      venceEn: en(100),
    });
    await incluirEmpresa(dueno, usuario, s.empresaActiva, "OPERADOR");
    s.invitacionUsuario = usuario.id;
    const revocada = await crearInvitacionDeBase(dueno, { tenant: s.tenantActivo });
    await incluirEmpresa(dueno, revocada, s.empresaActiva, "ADMINISTRADOR");
    await revocarDeBase(dueno, revocada);
    s.invitacionRevocada = revocada.id;

    // Datos operativos que la plataforma NO debe ver.
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
      [s.empresaActiva, MARCA_OPERATIVA],
    );
    const persona = await crearPersonaDeBase(dueno, `${MARCA_OPERATIVA.toLowerCase()}@prueba.test`);
    await crearMembresiaDeBase(dueno, s.empresaActiva, persona.id, "GERENTE");
    await dueno.query(
      `insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)`,
      [s.empresaActiva, persona.id, rows[0]?.id],
    );
    await dueno.query(
      `insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id, despues)
       values ($1, 'SUCURSAL_CREADA', 'sucursal', $2, $3)`,
      [s.empresaActiva, rows[0]?.id, JSON.stringify({ nombre: MARCA_OPERATIVA })],
    );

    // Trabajos fallidos: uno limpio y uno cuyos datos parecen llevar un secreto (escrito sin pasar por la cola).
    s.trabajoLimpio = await sembrarTrabajoFallido(dueno, {
      empresa: s.empresaActiva,
      datos: { invitacionId: s.invitacionUsuario },
    });
    s.trabajoConSecreto = await sembrarTrabajoFallido(dueno, { datos: { token: SECRETO } });
    // Y uno que NO falló: no debe aparecer.
    await dueno.query(
      `insert into trabajo (tipo, clave_idempotencia, estado) values ('enviar_invitacion', $1, 'PENDIENTE')`,
      [nombreAlAzar("clave-pendiente")],
    );
    s.claveDeUnTrabajo = (
      await dueno.query<{ clave_idempotencia: string }>(
        "select clave_idempotencia from trabajo where id = $1",
        [s.trabajoLimpio],
      )
    ).rows[0]?.clave_idempotencia as string;

    // La auditoría de plataforma: filas escritas por el puerto real, con actores distintos.
    for (const [contexto, entidadId, accion] of [
      [admin, "tenant-1", "TENANT_ALTA"],
      [admin, "tenant-1", "TENANT_SUSPENDIDO"],
      [soporte, "empresa-1", "ALTA_INVITACION_REENVIADA"],
      [admin, "empresa-1", "EMPRESA_ALTA"],
      [admin, "empresa-2", "EMPRESA_ALTA"],
    ] as const) {
      await entorno.ejecutar({ contexto }, async ({ auditoriaDePlataforma }) => {
        await auditoriaDePlataforma.registrar({
          accion,
          entidad: entidadId.split("-")[0] ?? "x",
          entidadId,
          despues: { nota: `fila de ${accion}` },
        });
        return { ok: true as const, valor: null };
      });
    }
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  // ===========================================================================================
  // Quién puede
  // ===========================================================================================
  describe("quién puede consultar", () => {
    const todas = (contexto: ContextoDePlataforma) =>
      [
        ["listarTenants", () => consultas.listarTenants(contexto, {})],
        ["listarEmpresas", () => consultas.listarEmpresas(contexto, {})],
        ["listarAltasPendientes", () => consultas.listarAltasPendientes(contexto, {})],
        ["listarInvitaciones", () => consultas.listarInvitaciones(contexto, {})],
        ["listarTrabajosFallidos", () => consultas.listarTrabajosFallidos(contexto, {})],
        ["consultarAuditoria", () => consultas.consultarAuditoria(contexto, {})],
        ["verConfiguracion", () => consultas.verConfiguracion(contexto)],
        [
          "buscarReferencia",
          () => consultas.buscarReferencia(contexto, { referencia: "PD-0000-0000" }),
        ],
      ] as const;

    it("un ADMIN y un SOPORTE activos pueden todas", async () => {
      for (const contexto of [admin, soporte]) {
        for (const [nombre, consultar] of todas(contexto)) {
          expect((await consultar()).ok, nombre).toBe(true);
        }
      }
    });

    it("un administrador de baja, uno inexistente y `sistema` reciben SIN_PERMISO en todas", async () => {
      const sinPermiso = [
        plataformaEn(AHORA, { tipo: "ADMIN", id: bajaId }),
        plataformaEn(AHORA, { tipo: "ADMIN", id: adminInexistente() }),
        plataformaEn(AHORA, { tipo: "SISTEMA", proceso: "barrido" }),
      ];
      for (const contexto of sinPermiso) {
        for (const [nombre, consultar] of todas(contexto)) {
          expect(await consultar(), nombre).toEqual({ ok: false, error: "SIN_PERMISO" });
        }
      }
    });
  });

  // ===========================================================================================
  // Tenants y empresas
  // ===========================================================================================
  describe("tenants y empresas", () => {
    it("lista los tenants con su estado", async () => {
      const { filas } = esperar(await consultas.listarTenants(admin, { limite: 100 }));
      const activo = filas.find((t) => t.id === s.tenantActivo);
      const suspendido = filas.find((t) => t.id === s.tenantSuspendido);
      expect(activo).toMatchObject({
        nombre: "Tenant Activo",
        estado: "ACTIVE",
        motivoEstado: null,
      });
      expect(suspendido).toMatchObject({
        nombre: "Tenant Suspendido",
        estado: "SUSPENDED",
        motivoEstado: "prueba",
      });
    });

    it("pagina de forma estable: cada tenant aparece una vez, ordenado por id, aunque lleguen nuevos", async () => {
      const todos = esperar(await consultas.listarTenants(admin, { limite: 100 })).filas.map(
        (t) => t.id,
      );
      expect(todos).toEqual([...todos].sort());
      const vistos: string[] = [];
      let despuesDeId: string | undefined;
      let paginas = 0;
      for (;;) {
        const pagina = esperar(await consultas.listarTenants(admin, { limite: 1, despuesDeId }));
        vistos.push(...pagina.filas.map((t) => t.id));
        paginas += 1;
        // Llega un tenant nuevo en medio de la paginación: no duplica ni salta ninguno de los ya vistos.
        if (paginas === 1) await sembrarTenant(dueno, { nombre: nombreAlAzar("nuevo") });
        if (pagina.siguienteDespuesDeId === null) break;
        despuesDeId = pagina.siguienteDespuesDeId;
      }
      expect(new Set(vistos).size).toBe(vistos.length);
      expect(vistos).toEqual([...vistos].sort());
      for (const id of todos) expect(vistos).toContain(id);
    });

    it("lista las empresas con su estado efectivo y filtra por tenant y por estado", async () => {
      const { filas } = esperar(await consultas.listarEmpresas(admin, { limite: 100 }));
      const porId = (id: string) => filas.find((e) => e.id === id);
      expect(porId(s.empresaActiva)).toMatchObject({
        estado: "ACTIVE",
        estadoDelTenant: "ACTIVE",
        estadoEfectivo: "OPERA",
        razonSocial: "Empresa Activa",
        zonaHoraria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
      });
      expect(porId(s.empresaSuspendida)?.estadoEfectivo).toBe("EMPRESA_SUSPENDIDA");
      expect(porId(s.empresaDelTenantSuspendido)).toMatchObject({
        estado: "PROVISIONING",
        estadoDelTenant: "SUSPENDED",
        estadoEfectivo: "TENANT_SUSPENDIDO",
      });
      expect(porId(s.altaVigente)?.estadoEfectivo).toBe("EMPRESA_EN_ALTA");

      const deUnTenant = esperar(
        await consultas.listarEmpresas(admin, { tenantId: s.tenantSuspendido }),
      );
      expect(deUnTenant.filas.map((e) => e.id)).toEqual([s.empresaDelTenantSuspendido]);
      const enAlta = esperar(await consultas.listarEmpresas(admin, { estado: "PROVISIONING" }));
      expect(enAlta.filas.every((e) => e.estado === "PROVISIONING")).toBe(true);
      expect(enAlta.filas.map((e) => e.id)).toEqual(
        expect.arrayContaining([s.altaSinInvitacion, s.altaVigente, s.altaVencida]),
      );
    });

    it("no devuelve ningún dato operativo de las empresas", async () => {
      const texto = JSON.stringify([
        await consultas.listarEmpresas(admin, { limite: 100 }),
        await consultas.listarTenants(admin, { limite: 100 }),
      ]);
      expect(texto).not.toContain(MARCA_OPERATIVA);
      expect(texto.toLowerCase()).not.toContain(MARCA_OPERATIVA.toLowerCase());
    });
  });

  // ===========================================================================================
  // Altas pendientes
  // ===========================================================================================
  describe("altas pendientes", () => {
    it("dice cómo está la invitación de cada alta y cuántas horas quedan", async () => {
      const { filas } = esperar(await consultas.listarAltasPendientes(admin, { limite: 100 }));
      const alta = (id: string) => filas.find((a) => a.empresaId === id);
      expect(alta(s.altaSinInvitacion)).toMatchObject({
        estadoDeLaInvitacion: "SIN_INVITACION",
        invitacionVenceEn: null,
        msRestantes: 62 * HORA,
        horasRestantes: 62,
        vencida: false,
      });
      expect(alta(s.altaVigente)).toMatchObject({
        estadoDeLaInvitacion: "VIGENTE",
        invitacionVenceEn: en(4),
        msRestantes: 52 * HORA,
        horasRestantes: 52,
        vencida: false,
        razonSocial: "Alta vigente",
      });
      // La última invitación del alta (la de `emitida_en` más reciente) manda, no la revocada.
      expect(alta(s.altaVencida)).toMatchObject({
        estadoDeLaInvitacion: "VENCIDA",
        invitacionVenceEn: hace(54),
        msRestantes: 0,
        horasRestantes: 0,
        vencida: true,
      });
    });

    it("solo muestra empresas en alta", async () => {
      const { filas } = esperar(await consultas.listarAltasPendientes(admin, { limite: 100 }));
      const ids = filas.map((a) => a.empresaId);
      expect(ids).not.toContain(s.empresaActiva);
      expect(ids).not.toContain(s.empresaSuspendida);
    });

    it("una alta con la invitación aceptada o revocada se informa tal cual", async () => {
      const revocada = await sembrarEmpresa(dueno, s.tenantActivo, {
        estado: "PROVISIONING",
        creadoEn: hace(1),
      });
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: s.tenantActivo,
        tipo: "ALTA_GERENTE",
        emitidaEn: hace(1),
        venceEn: en(23),
      });
      await incluirEmpresa(dueno, inv, revocada, "GERENTE");
      await revocarDeBase(dueno, inv);
      const { filas } = esperar(await consultas.listarAltasPendientes(admin, { limite: 100 }));
      expect(filas.find((a) => a.empresaId === revocada)?.estadoDeLaInvitacion).toBe("REVOCADA");
    });
  });

  // ===========================================================================================
  // Invitaciones
  // ===========================================================================================
  describe("invitaciones", () => {
    it("lista las invitaciones con el estado guardado y el efectivo, sin sucursales ni hash del token", async () => {
      const r = await consultas.listarInvitaciones(admin, { limite: 100 });
      const { filas } = esperar(r);
      const por = (id: string) => filas.find((i) => i.id === id);
      expect(por(s.invitacionUsuario)).toMatchObject({
        tipo: "USUARIO",
        estado: "PENDIENTE",
        estadoEfectivo: "PENDIENTE",
        tenantId: s.tenantActivo,
        empresas: [{ empresaId: s.empresaActiva, rol: "OPERADOR" }],
      });
      expect(por(s.invitacionRevocada)).toMatchObject({
        estado: "REVOCADA",
        estadoEfectivo: "REVOCADA",
      });
      // Pendiente en la base, pero ya pasó su vencimiento con la hora del contexto.
      expect(por(s.invitacionAlta)).toMatchObject({
        tipo: "ALTA_GERENTE",
        estado: "PENDIENTE",
        estadoEfectivo: "PENDIENTE",
      });
      const tarde = esperar(
        await consultas.listarInvitaciones(plataformaEn(en(10)), { limite: 100 }),
      ).filas;
      expect(tarde.find((i) => i.id === s.invitacionAlta)).toMatchObject({
        estado: "PENDIENTE",
        estadoEfectivo: "VENCIDA",
      });
      const texto = JSON.stringify(r);
      expect(texto).not.toContain(s.hashDeLaAlta);
      expect(texto).not.toMatch(/token|hash|sucursal/i);
    });

    it("filtra por tenant, por empresa y por estado", async () => {
      const deLaEmpresa = esperar(
        await consultas.listarInvitaciones(admin, { empresaId: s.empresaActiva, limite: 100 }),
      ).filas.map((i) => i.id);
      expect(deLaEmpresa.sort()).toEqual([s.invitacionUsuario, s.invitacionRevocada].sort());

      const revocadas = esperar(await consultas.listarInvitaciones(admin, { estado: "REVOCADA" }));
      expect(revocadas.filas.every((i) => i.estado === "REVOCADA")).toBe(true);
      expect(revocadas.filas.map((i) => i.id)).toEqual(
        expect.arrayContaining([s.invitacionRevocada, s.invitacionAltaVieja]),
      );

      const deOtroTenant = esperar(
        await consultas.listarInvitaciones(admin, { tenantId: s.tenantSuspendido }),
      );
      expect(deOtroTenant.filas).toEqual([]);

      const combinado = esperar(
        await consultas.listarInvitaciones(admin, {
          empresaId: s.empresaActiva,
          estado: "PENDIENTE",
          tenantId: s.tenantActivo,
        }),
      );
      expect(combinado.filas.map((i) => i.id)).toEqual([s.invitacionUsuario]);
    });

    it("pagina por id sin repetir", async () => {
      const vistos: string[] = [];
      let despuesDeId: string | undefined;
      for (;;) {
        const pagina = esperar(
          await consultas.listarInvitaciones(admin, { limite: 2, despuesDeId }),
        );
        vistos.push(...pagina.filas.map((i) => i.id));
        if (pagina.siguienteDespuesDeId === null) break;
        despuesDeId = pagina.siguienteDespuesDeId;
      }
      expect(new Set(vistos).size).toBe(vistos.length);
      expect(vistos).toEqual([...vistos].sort());
      expect(vistos).toEqual(
        expect.arrayContaining([s.invitacionAlta, s.invitacionUsuario, s.invitacionRevocada]),
      );
    });
  });

  // ===========================================================================================
  // Trabajos fallidos
  // ===========================================================================================
  describe("trabajos fallidos", () => {
    it("devuelve solo los FALLIDOS, con tipo, empresa, intentos, último error y datos, sin la clave de idempotencia", async () => {
      const r = await consultas.listarTrabajosFallidos(soporte, { limite: 100 });
      const { filas } = esperar(r);
      expect(filas.map((t) => t.id).sort()).toEqual([s.trabajoLimpio, s.trabajoConSecreto].sort());
      expect(filas.find((t) => t.id === s.trabajoLimpio)).toMatchObject({
        tipo: "enviar_invitacion",
        empresaId: s.empresaActiva,
        intentos: 5,
        ultimoError: "MAIL_RECHAZADO",
        datos: { invitacionId: s.invitacionUsuario },
        datosOcultos: false,
      });
      expect(JSON.stringify(r)).not.toContain(s.claveDeUnTrabajo);
      expect(JSON.stringify(r)).not.toContain("clave-secreta");
    });

    it("unos datos con apariencia de secreto no se devuelven", async () => {
      const r = await consultas.listarTrabajosFallidos(admin, { limite: 100 });
      const fila = esperar(r).filas.find((t) => t.id === s.trabajoConSecreto);
      expect(fila).toMatchObject({ empresaId: null, datos: null, datosOcultos: true });
      expect(JSON.stringify(r)).not.toContain(SECRETO);
    });
  });

  // ===========================================================================================
  // Auditoría
  // ===========================================================================================
  describe("auditoría de plataforma", () => {
    it("devuelve las filas con su actor, ordenadas por id", async () => {
      const { filas } = esperar(await consultas.consultarAuditoria(admin, { limite: 100 }));
      expect(filas.length).toBeGreaterThanOrEqual(5);
      expect(filas.map((f) => BigInt(f.id))).toEqual(
        filas.map((f) => BigInt(f.id)).sort((a, b) => (a < b ? -1 : 1)),
      );
      const reenvio = filas.find((f) => f.accion === "ALTA_INVITACION_REENVIADA");
      expect(reenvio).toMatchObject({
        actor: SOPORTE_DE_PRUEBA,
        entidad: "empresa",
        entidadId: "empresa-1",
        antes: null,
        despues: { nota: "fila de ALTA_INVITACION_REENVIADA" },
      });
      expect(filas.every((f) => f.actor === ADMIN_DE_PRUEBA || f.actor === SOPORTE_DE_PRUEBA)).toBe(
        true,
      );
    });

    it("pagina de forma estable: sin repetir ni saltear, aunque se escriban filas nuevas", async () => {
      const total = esperar(await consultas.consultarAuditoria(admin, { limite: 100 })).filas.map(
        (f) => f.id,
      );
      const vistos: string[] = [];
      let despuesDeId: string | undefined;
      let primera = true;
      for (;;) {
        const pagina = esperar(
          await consultas.consultarAuditoria(admin, { limite: 2, despuesDeId }),
        );
        vistos.push(...pagina.filas.map((f) => f.id));
        if (primera) {
          primera = false;
          await entorno.ejecutar({ contexto: admin }, async ({ auditoriaDePlataforma }) => {
            await auditoriaDePlataforma.registrar({
              accion: "EMPRESA_ALTA",
              entidad: "nuevo",
              entidadId: "llego-en-medio",
            });
            return { ok: true as const, valor: null };
          });
        }
        if (pagina.siguienteDespuesDeId === null) break;
        despuesDeId = pagina.siguienteDespuesDeId;
      }
      expect(new Set(vistos).size).toBe(vistos.length);
      expect(vistos.slice(0, total.length)).toEqual(total);
      expect(vistos.length).toBe(total.length + 1);
    });

    it("filtra por entidad, por id de la entidad y por rango de fechas", async () => {
      const deTenant = esperar(await consultas.consultarAuditoria(admin, { entidad: "tenant" }));
      expect(deTenant.filas.map((f) => f.accion)).toEqual(["TENANT_ALTA", "TENANT_SUSPENDIDO"]);
      const deUna = esperar(
        await consultas.consultarAuditoria(admin, { entidad: "empresa", entidadId: "empresa-2" }),
      );
      expect(deUna.filas.map((f) => f.entidadId)).toEqual(["empresa-2"]);

      // Los extremos son inclusivos. La base guarda microsegundos y una `Date` solo milisegundos, así
      // que las ventanas llevan un milisegundo de margen para no depender del redondeo del driver.
      const instante = (
        await dueno.query<{ creado_en: Date }>(
          "select creado_en from auditoria_plataforma where entidad_id = 'empresa-2'",
        )
      ).rows[0]?.creado_en as Date;
      const antes = new Date(instante.getTime() - 1);
      const despues = new Date(instante.getTime() + 1);
      const ids = async (filtro: { desde?: Date; hasta?: Date }) =>
        esperar(await consultas.consultarAuditoria(admin, { ...filtro, limite: 100 })).filas.map(
          (f) => f.entidadId,
        );
      expect(await ids({ desde: antes })).toContain("empresa-2");
      expect(await ids({ hasta: despues })).toContain("empresa-2");
      expect(await ids({ desde: antes, hasta: despues })).toContain("empresa-2");
      // Una ventana que no la incluye, no la trae.
      expect(
        await ids({ desde: despues, hasta: new Date(despues.getTime() + 1000) }),
      ).not.toContain("empresa-2");
      expect(await ids({ hasta: new Date(antes.getTime() - 1000) })).not.toContain("empresa-2");
      expect(await ids({ desde: new Date(8.64e15) })).toEqual([]);
      expect(await ids({ hasta: new Date(0) })).toEqual([]);
    });

    it("el límite es de 100 como máximo", async () => {
      expect(await consultas.consultarAuditoria(admin, { limite: 101 })).toEqual({
        ok: false,
        error: "LIMITE_INVALIDO",
      });
      expect((await consultas.consultarAuditoria(admin, { limite: 100 })).ok).toBe(true);
    });

    it("consultar la auditoría no deja constancia", async () => {
      const antes = await dueno.query("select count(*)::int as n from auditoria_plataforma");
      await consultas.consultarAuditoria(admin, {});
      await consultas.listarTenants(admin, {});
      const despues = await dueno.query("select count(*)::int as n from auditoria_plataforma");
      expect(despues.rows[0]).toEqual(antes.rows[0]);
    });
  });

  // ===========================================================================================
  // Configuración
  // ===========================================================================================
  describe("configuración", () => {
    it("muestra el catálogo de módulos del código", async () => {
      const { modulos } = esperar(await consultas.verConfiguracion(soporte));
      expect(modulos.map((m) => m.clave)).toEqual([
        "administracion",
        "catalogo",
        "facturacion",
        "stock",
        "vidriera",
      ]);
      expect(modulos[0]).toMatchObject({ estado: "disponible", obligatorio: true });
      for (const modulo of modulos.slice(1)) {
        expect(modulo, modulo.clave).toMatchObject({ estado: "en_desarrollo", obligatorio: false });
      }
    });
  });

  // ===========================================================================================
  // Aislamiento: el soporte no ve datos operativos
  // ===========================================================================================
  describe("aislamiento", () => {
    it("ninguna respuesta de ninguna consulta contiene datos operativos ni secretos", async () => {
      const respuestas = JSON.stringify([
        await consultas.listarTenants(admin, { limite: 100 }),
        await consultas.listarEmpresas(admin, { limite: 100 }),
        await consultas.listarAltasPendientes(admin, { limite: 100 }),
        await consultas.listarInvitaciones(admin, { limite: 100 }),
        await consultas.listarTrabajosFallidos(admin, { limite: 100 }),
        await consultas.consultarAuditoria(admin, { limite: 100 }),
        await consultas.verConfiguracion(admin),
      ]).toLowerCase();
      for (const prohibido of [
        MARCA_OPERATIVA,
        SECRETO,
        s.hashDeLaAlta,
        s.claveDeUnTrabajo,
        "clave-secreta",
      ]) {
        expect(respuestas).not.toContain(prohibido.toLowerCase());
      }
    });

    it("el rol de plataforma no puede leer las tablas operativas, ni siquiera por su cuenta", async () => {
      for (const tabla of [
        "sucursal",
        "asignacion_sucursal",
        "invitacion_sucursal",
        "auditoria_empresa",
      ]) {
        const r = await entorno.ejecutar({ contexto: admin }, async ({ db }) => {
          const filas = await sql`select * from ${sql.table(tabla)}`.execute(db);
          return { ok: true as const, valor: filas.rows.length };
        });
        esperarAccesoDenegado(r);
      }
    });

    it("sin un actor vigente las lecturas no devuelven nada (la base lo impone)", async () => {
      const lectura = await entorno.ejecutar(
        { contexto: plataformaEn(AHORA, { tipo: "ADMIN", id: bajaId }) },
        async ({ soporte: lecturas }) => {
          return {
            ok: true as const,
            valor: await lecturas.listarTenants(
              { marcaId: null, planId: null, buscar: null },
              { limite: 100, despuesDeId: null },
              AHORA,
            ),
          };
        },
      );
      expect(lectura).toEqual({ ok: true, valor: [] });
    });
  });
});
