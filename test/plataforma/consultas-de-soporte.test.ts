import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import {
  crearConsultasDePlataforma,
  type ConsultasDePlataforma,
} from "../../src/plataforma/consultas/consultas";
import type {
  AjusteDeUnTenant,
  FilaDeAuditoria,
  FilaDeTenant,
  FilaDeTrabajoFallido,
  TxDeConsultasDePlataforma,
} from "../../src/plataforma/consultas/contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "../../src/plataforma/consultas/declaraciones";
import {
  emailDesdeTexto,
  type EstadoGuardado,
  type Invitacion,
} from "../../src/modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  tenantId,
} from "../../src/primitivas/identificadores/marca";
import {
  AHORA,
  MARCA_DE_PRUEBA,
  PLAN_DE_PRUEBA,
  SIN_PLAN_VIGENTE,
  comoAdministrador,
  conRol,
  filaDeEmpresa,
  filaDeEmpresaAmpliada,
  lecturaFalsa,
  transaccionesDe,
  uuid,
  type DatosDeLecturaFalsa,
} from "./apoyo-de-soporte";

/**
 * Consultas de soporte de plataforma (H5 §B.5.7 y §B.5.9) sin base de datos: la forma de cada
 * respuesta, las validaciones y cómo se pide la transacción. El guard primero y la lectura real contra
 * la base están en `guard-primero-de-soporte.test.ts` y en `test/integracion/soporte-*.test.ts`.
 */

function armar(datos: DatosDeLecturaFalsa = {}) {
  const soporte = lecturaFalsa(datos);
  const tx: TxDeConsultasDePlataforma = {
    soporte,
    autorizacionDePlataforma: conRol("SOPORTE"),
  };
  const transacciones = transaccionesDe(tx);
  const consultas: ConsultasDePlataforma = crearConsultasDePlataforma({
    transacciones,
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeEmpresa: CATALOGO_DE_MODULOS,
    catalogoDePerillas: CATALOGO_DE_PERILLAS,
  });
  return { consultas, soporte, transacciones };
}

const fecha = new Date("2026-10-10T00:00:00Z");
/** Lo que lee la base de un tenant: con su marca, su plan vigente y cuántas empresas ocupan lugar. */
const tenant = (n: number, estado: "ACTIVE" | "SUSPENDED" = "ACTIVE"): FilaDeTenant => ({
  id: tenantId(uuid(n)),
  nombre: `Tenant ${n}`,
  estado,
  motivoEstado: estado === "SUSPENDED" ? "falta de pago" : null,
  creadoEn: fecha,
  ...MARCA_DE_PRUEBA,
  ...PLAN_DE_PRUEBA,
  empresasEnUso: 1,
  perillasDelPlan: null,
});
/** Lo que la consulta devuelve de ese tenant: sin las perillas crudas y con el límite resuelto. */
const vistaDe = (fila: FilaDeTenant, limiteDeEmpresas: number | "ILIMITADO" | null) => {
  const { perillasDelPlan: _crudas, ...resto } = fila;
  return { ...resto, limiteDeEmpresas };
};

describe("toda consulta es de solo lectura y se pide `read committed`", () => {
  it("las ocho piden la transacción con ese nivel y en solo lectura", async () => {
    const { consultas, transacciones } = armar();
    await consultas.listarTenants(comoAdministrador, {});
    await consultas.listarEmpresas(comoAdministrador, {});
    await consultas.listarAltasPendientes(comoAdministrador, {});
    await consultas.listarInvitaciones(comoAdministrador, {});
    await consultas.listarTrabajosFallidos(comoAdministrador, {});
    await consultas.consultarAuditoria(comoAdministrador, {});
    await consultas.verConfiguracion(comoAdministrador);
    await consultas.buscarReferencia(comoAdministrador, { referencia: "ZH-0000-0000" });
    expect(transacciones.pedidas).toHaveLength(8);
    for (const pedida of transacciones.pedidas) {
      expect(pedida).toEqual({
        contexto: comoAdministrador,
        aislamiento: "read committed",
        soloLectura: true,
      });
    }
  });

  it("cada consulta declara la acción que la matriz de plataforma le da a soporte", () => {
    for (const [nombre, { accion }] of Object.entries(DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA)) {
      expect(REGLAS_DE_PLATAFORMA.permisos[accion], nombre).toEqual(["ADMIN", "SOPORTE"]);
    }
  });
});

describe("listarTenants", () => {
  it("devuelve los tenants con su estado, su marca y su plan, y la página sigue si llegó llena", async () => {
    const filas = [tenant(1), tenant(2, "SUSPENDED")];
    const { consultas, soporte } = armar({ tenants: filas });
    const r = await consultas.listarTenants(comoAdministrador, { limite: 2 });
    expect(r).toEqual({
      ok: true,
      valor: {
        filas: [vistaDe(tenant(1), 1), vistaDe(tenant(2, "SUSPENDED"), 1)],
        siguienteDespuesDeId: uuid(2),
      },
    });
    expect(soporte.pedidos[0]).toEqual({
      metodo: "listarTenants",
      argumentos: [
        { marcaId: null, planId: null, buscar: null },
        { limite: 2, despuesDeId: null },
        AHORA,
      ],
    });
  });

  it("pasa el cursor normalizado y una página corta no tiene siguiente", async () => {
    const { consultas, soporte } = armar({ tenants: [tenant(1)] });
    const r = await consultas.listarTenants(comoAdministrador, {
      limite: 5,
      despuesDeId: uuid(1).toUpperCase(),
    });
    expect(r).toEqual({
      ok: true,
      valor: { filas: [vistaDe(tenant(1), 1)], siguienteDespuesDeId: null },
    });
    expect(soporte.pedidos[0]?.argumentos[1]).toEqual({ limite: 5, despuesDeId: uuid(1) });
  });

  it("un límite o un cursor inválidos son errores con nombre y no leen nada", async () => {
    const { consultas, soporte } = armar();
    expect(await consultas.listarTenants(comoAdministrador, { limite: 101 })).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    expect(await consultas.listarTenants(comoAdministrador, { despuesDeId: "x" })).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
    expect(soporte.pedidos).toEqual([]);
  });

  it("filtra por marca, por plan y por texto del nombre, normalizando los ids y recortando el texto", async () => {
    const { consultas, soporte } = armar();
    await consultas.listarTenants(comoAdministrador, {
      marcaId: uuid(11).toUpperCase(),
      planId: uuid(12).toUpperCase(),
      buscar: "  Bar-1 ",
    });
    expect(soporte.pedidos[0]?.argumentos[0]).toEqual({
      marcaId: uuid(11),
      planId: uuid(12),
      buscar: { texto: "Bar-1", cuit: "Bar1" },
    });
  });

  it("un id o un texto inválidos son errores con nombre y no leen nada; el rechazo de la página va primero", async () => {
    const { consultas, soporte } = armar();
    const pedir = (entrada: Parameters<typeof consultas.listarTenants>[1]) =>
      consultas.listarTenants(comoAdministrador, entrada);
    expect(await pedir({ marcaId: "x" })).toEqual({ ok: false, error: "ID_INVALIDO" });
    expect(await pedir({ planId: "x" })).toEqual({ ok: false, error: "ID_INVALIDO" });
    expect(await pedir({ buscar: "" })).toEqual({ ok: false, error: "FILTRO_INVALIDO" });
    expect(await pedir({ buscar: "x".repeat(201) })).toEqual({
      ok: false,
      error: "FILTRO_INVALIDO",
    });
    expect(await pedir({ limite: 0, marcaId: "x" })).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    expect(soporte.pedidos).toEqual([]);
  });

  describe("el límite de empresas efectivo, con UNA lectura de ajustes para toda la página", () => {
    const ajuste = (
      n: number,
      numero: number,
      valor: string,
      desdeHoras = -1,
    ): AjusteDeUnTenant => ({
      tenantId: tenantId(uuid(n)),
      perilla: "empresas_por_tenant",
      empresaId: null,
      numero,
      vigenteDesde: new Date(AHORA.getTime() + desdeHoras * 3_600_000),
      valor,
    });
    const conPlan = (n: number, limite: number | "ILIMITADO"): FilaDeTenant => ({
      ...tenant(n),
      perillasDelPlan: { empresas_por_tenant: { tipo: "LIMITE", limite } },
    });
    const limiteDe = async (fila: FilaDeTenant, ajustes: AjusteDeUnTenant[] = []) => {
      const { consultas } = armar({ tenants: [fila], ajustes });
      const r = await consultas.listarTenants(comoAdministrador, {});
      return r.ok ? r.valor.filas[0]?.limiteDeEmpresas : r.error;
    };

    it("sin plan ni ajuste rige la base del catálogo; con plan, el del plan", async () => {
      expect(await limiteDe({ ...tenant(1), ...SIN_PLAN_VIGENTE, perillasDelPlan: null })).toBe(1);
      expect(await limiteDe(tenant(1))).toBe(1);
      expect(await limiteDe(conPlan(1, 5))).toBe(5);
      expect(await limiteDe(conPlan(1, "ILIMITADO"))).toBe("ILIMITADO");
    });

    it("un ajuste vigente del tenant manda sobre el plan; uno programado todavía no; DEL_PLAN vuelve al plan", async () => {
      expect(await limiteDe(conPlan(1, 5), [ajuste(1, 1, "9")])).toBe(9);
      expect(await limiteDe(conPlan(1, 5), [ajuste(1, 1, "9", 24)])).toBe(5);
      expect(await limiteDe(conPlan(1, 5), [ajuste(1, 1, "9"), ajuste(1, 2, "DEL_PLAN")])).toBe(5);
      expect(await limiteDe(conPlan(1, 5), [ajuste(1, 1, "ILIMITADO")])).toBe("ILIMITADO");
    });

    it("el ajuste de otro tenant no cuenta", async () => {
      expect(await limiteDe(conPlan(1, 5), [ajuste(2, 1, "9")])).toBe(5);
    });

    it("lee los ajustes de TODOS los tenants de la página en una sola lectura, de la perilla del tope", async () => {
      const { consultas, soporte } = armar({
        tenants: [conPlan(1, 5), conPlan(2, 3), conPlan(3, 2)],
        ajustes: [ajuste(2, 1, "7")],
      });
      const r = await consultas.listarTenants(comoAdministrador, {});
      expect(r.ok && r.valor.filas.map((f) => f.limiteDeEmpresas)).toEqual([5, 7, 2]);
      expect(soporte.pedidos.map((p) => p.metodo)).toEqual(["listarTenants", "ajustesDeTenants"]);
      expect(soporte.pedidos[1]?.argumentos).toEqual([
        [tenantId(uuid(1)), tenantId(uuid(2)), tenantId(uuid(3))],
        "empresas_por_tenant",
      ]);
    });

    it("una página vacía no pide ajustes", async () => {
      const { consultas, soporte } = armar({ tenants: [] });
      await consultas.listarTenants(comoAdministrador, {});
      expect(soporte.pedidos.map((p) => p.metodo)).toEqual(["listarTenants"]);
    });

    it("el valor de plan que no es un límite se ignora y rige la base (falla cerrado)", async () => {
      const raro: FilaDeTenant = {
        ...tenant(1),
        perillasDelPlan: { empresas_por_tenant: { tipo: "INTERRUPTOR", encendida: true } },
      };
      expect(await limiteDe(raro)).toBe(1);
    });

    it("si el catálogo no conoce la perilla no hay límite que mostrar y no se piden ajustes", async () => {
      const soporte = lecturaFalsa({ tenants: [tenant(1)] });
      const consultas = crearConsultasDePlataforma({
        transacciones: transaccionesDe({ soporte, autorizacionDePlataforma: conRol("ADMIN") }),
        reglas: REGLAS_DE_PLATAFORMA,
        catalogoDeEmpresa: CATALOGO_DE_MODULOS,
        catalogoDePerillas: {},
      });
      const r = await consultas.listarTenants(comoAdministrador, {});
      expect(r.ok && r.valor.filas[0]?.limiteDeEmpresas).toBeNull();
      expect(soporte.pedidos.map((p) => p.metodo)).toEqual(["listarTenants"]);
    });
  });
});

/** Sin ningún criterio: la lista de siempre. */
const SIN_CRITERIOS = {
  tenantId: null,
  estado: null,
  marcaId: null,
  planId: null,
  estadosEfectivos: null,
  buscar: null,
};

describe("listarEmpresas", () => {
  it("agrega el estado efectivo, que combina el de la empresa con el del tenant", async () => {
    const empresas = [
      filaDeEmpresaAmpliada(1, "ACTIVE", "ACTIVE"),
      filaDeEmpresaAmpliada(2, "ACTIVE", "SUSPENDED"),
      filaDeEmpresaAmpliada(3, "PROVISIONING", "ACTIVE"),
      filaDeEmpresaAmpliada(4, "SUSPENDED", "ACTIVE"),
      filaDeEmpresaAmpliada(5, "CANCELLED", "SUSPENDED"),
    ];
    const { consultas } = armar({ empresas });
    const r = await consultas.listarEmpresas(comoAdministrador, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.filas.map((f) => f.estadoEfectivo)).toEqual([
      "OPERA",
      "TENANT_SUSPENDIDO",
      "EMPRESA_EN_ALTA",
      "EMPRESA_SUSPENDIDA",
      "EMPRESA_CANCELADA",
    ]);
    expect(r.valor.filas[0]).toMatchObject({ razonSocial: "Empresa 1", cuit: "20123456786" });
    expect(r.valor.siguienteDespuesDeId).toBeNull();
  });

  it("trae el nombre del tenant, su marca y su plan vigente tal como los lee la base", async () => {
    const sinPlan = { ...filaDeEmpresaAmpliada(2), ...SIN_PLAN_VIGENTE };
    const { consultas } = armar({ empresas: [filaDeEmpresaAmpliada(1), sinPlan] });
    const r = await consultas.listarEmpresas(comoAdministrador, {});
    expect(r.ok && r.valor.filas[0]).toMatchObject({
      tenantNombre: "Tenant de la empresa 1",
      ...MARCA_DE_PRUEBA,
      ...PLAN_DE_PRUEBA,
      estadoEfectivo: "OPERA",
    });
    expect(r.ok && r.valor.filas[1]).toMatchObject({ ...MARCA_DE_PRUEBA, ...SIN_PLAN_VIGENTE });
  });

  it("filtra por tenant y por estado, validándolos", async () => {
    const { consultas, soporte } = armar();
    await consultas.listarEmpresas(comoAdministrador, {
      tenantId: uuid(7).toUpperCase(),
      estado: "PROVISIONING",
      limite: 3,
    });
    expect(soporte.pedidos[0]?.argumentos).toEqual([
      { ...SIN_CRITERIOS, tenantId: uuid(7), estado: "PROVISIONING" },
      { limite: 3, despuesDeId: null },
      AHORA,
    ]);
    await consultas.listarEmpresas(comoAdministrador, {});
    expect(soporte.pedidos[1]?.argumentos[0]).toEqual(SIN_CRITERIOS);

    expect(await consultas.listarEmpresas(comoAdministrador, { tenantId: "x" })).toEqual({
      ok: false,
      error: "ID_INVALIDO",
    });
    for (const estado of ["activa", "", "constructor", "__proto__", "toString"]) {
      expect(await consultas.listarEmpresas(comoAdministrador, { estado }), estado).toEqual({
        ok: false,
        error: "ESTADO_INVALIDO",
      });
    }
    expect(soporte.pedidos).toHaveLength(2);
  });

  it("filtra por marca, plan, estado efectivo y texto; normaliza los ids y arma los pares de estado", async () => {
    const { consultas, soporte } = armar();
    await consultas.listarEmpresas(comoAdministrador, {
      marcaId: uuid(11).toUpperCase(),
      planId: uuid(12).toUpperCase(),
      estadoEfectivo: "TENANT_SUSPENDIDO",
      buscar: " 20-1234 ",
    });
    expect(soporte.pedidos[0]?.argumentos[0]).toEqual({
      ...SIN_CRITERIOS,
      marcaId: uuid(11),
      planId: uuid(12),
      estadosEfectivos: [
        { tenant: "SUSPENDED", empresa: "PROVISIONING" },
        { tenant: "SUSPENDED", empresa: "ACTIVE" },
        { tenant: "SUSPENDED", empresa: "SUSPENDED" },
      ],
      buscar: { texto: "20-1234", cuit: "201234" },
    });
  });

  it("los criterios nuevos inválidos son errores con nombre y no leen nada", async () => {
    const { consultas, soporte } = armar();
    const pedir = (entrada: Parameters<typeof consultas.listarEmpresas>[1]) =>
      consultas.listarEmpresas(comoAdministrador, entrada);
    expect(await pedir({ marcaId: "x" })).toEqual({ ok: false, error: "ID_INVALIDO" });
    expect(await pedir({ planId: "x" })).toEqual({ ok: false, error: "ID_INVALIDO" });
    for (const estadoEfectivo of ["opera", "", "ACTIVE", "constructor", "__proto__"]) {
      expect(await pedir({ estadoEfectivo }), estadoEfectivo).toEqual({
        ok: false,
        error: "ESTADO_EFECTIVO_INVALIDO",
      });
    }
    expect(await pedir({ buscar: "   " })).toEqual({ ok: false, error: "FILTRO_INVALIDO" });
    expect(soporte.pedidos).toEqual([]);
  });

  it("acepta cada estado efectivo", async () => {
    const { consultas } = armar();
    for (const estadoEfectivo of [
      "OPERA",
      "EMPRESA_EN_ALTA",
      "EMPRESA_SUSPENDIDA",
      "EMPRESA_CANCELADA",
      "EMPRESA_EN_BAJA",
      "TENANT_SUSPENDIDO",
    ]) {
      const r = await consultas.listarEmpresas(comoAdministrador, { estadoEfectivo });
      expect(r.ok, estadoEfectivo).toBe(true);
    }
  });

  it("acepta cada estado de empresa", async () => {
    const { consultas } = armar();
    for (const estado of ["PROVISIONING", "ACTIVE", "SUSPENDED", "CANCELLED", "DELETING"]) {
      expect((await consultas.listarEmpresas(comoAdministrador, { estado })).ok, estado).toBe(true);
    }
  });
});

const email = (texto: string) => {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new Error("email inválido");
  return r.valor;
};

function invitacion(
  n: number,
  datos: Partial<{
    estado: EstadoGuardado;
    tipo: "ALTA_GERENTE" | "USUARIO";
    venceEn: Date;
    aceptadaPor: string | null;
  }> = {},
): Invitacion {
  return {
    id: invitacionId(uuid(n)),
    tenantId: tenantId(uuid(900 + n)),
    tipo: datos.tipo ?? "USUARIO",
    email: email(`i${n}@x.test`),
    estado: datos.estado ?? "PENDIENTE",
    emitidaEn: fecha,
    venceEn: datos.venceEn ?? new Date(AHORA.getTime() + 3_600_000),
    empresas: [{ empresaId: empresaId(uuid(n)), rol: "OPERADOR", sucursales: [] }],
    aceptadaPor:
      datos.aceptadaPor === undefined || datos.aceptadaPor === null
        ? null
        : personaId(datos.aceptadaPor),
    reemplazadaPor: null,
    version: 3,
  };
}

describe("listarAltasPendientes", () => {
  it("arma la vista de cada alta con la hora del contexto", async () => {
    const sin = filaDeEmpresa(1, "PROVISIONING");
    const con = filaDeEmpresa(2, "PROVISIONING");
    const vencida = {
      ...filaDeEmpresa(3, "PROVISIONING"),
      creadoEn: new Date("2026-10-01T00:00:00Z"),
    };
    const { consultas } = armar({
      altas: [
        { empresa: sin, invitacion: null },
        {
          empresa: con,
          invitacion: invitacion(2, {
            tipo: "ALTA_GERENTE",
            venceEn: new Date("2026-10-11T18:00:00Z"),
          }),
        },
        {
          empresa: vencida,
          invitacion: invitacion(3, {
            tipo: "ALTA_GERENTE",
            venceEn: new Date("2026-10-02T00:00:00Z"),
          }),
        },
      ],
    });
    const r = await consultas.listarAltasPendientes(comoAdministrador, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.filas.map((v) => [v.empresaId, v.estadoDeLaInvitacion, v.vencida])).toEqual([
      [sin.id, "SIN_INVITACION", false],
      [con.id, "VIGENTE", false],
      [vencida.id, "VENCIDA", true],
    ]);
    // `AHORA` es 36 h después de las 00:00 del 10/10 para las dos primeras: quedan 36 h.
    expect(r.valor.filas[0]).toMatchObject({ msRestantes: 36 * 3_600_000, horasRestantes: 36 });
    expect(r.valor.filas[2]).toMatchObject({ msRestantes: 0, horasRestantes: 0 });
  });

  it("valida la página", async () => {
    const { consultas } = armar();
    expect(await consultas.listarAltasPendientes(comoAdministrador, { limite: 0 })).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
  });
});

describe("listarInvitaciones", () => {
  it("devuelve la vista sin sucursales, con el estado guardado y el efectivo", async () => {
    const vigente = invitacion(1);
    const vencida = invitacion(2, { venceEn: new Date(AHORA.getTime() - 1) });
    const aceptada = invitacion(3, { estado: "ACEPTADA", aceptadaPor: uuid(50) });
    const { consultas } = armar({ invitaciones: [vigente, vencida, aceptada] });
    const r = await consultas.listarInvitaciones(comoAdministrador, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.filas.map((v) => [v.estado, v.estadoEfectivo])).toEqual([
      ["PENDIENTE", "PENDIENTE"],
      ["PENDIENTE", "VENCIDA"],
      ["ACEPTADA", "ACEPTADA"],
    ]);
    expect(r.valor.filas[2]).toEqual({
      id: aceptada.id,
      tenantId: aceptada.tenantId,
      tipo: "USUARIO",
      email: "i3@x.test",
      estado: "ACEPTADA",
      estadoEfectivo: "ACEPTADA",
      emitidaEn: fecha,
      venceEn: aceptada.venceEn,
      empresas: [{ empresaId: empresaId(uuid(3)), rol: "OPERADOR" }],
      aceptadaPor: personaId(uuid(50)),
      reemplazadaPor: null,
    });
  });

  it("no expone nada que parezca un token ni las sucursales", async () => {
    const { consultas } = armar({ invitaciones: [invitacion(1)] });
    const r = await consultas.listarInvitaciones(comoAdministrador, {});
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/token|hash|sucursal/i);
  });

  it("filtra por tenant, empresa y estado guardado, validándolos", async () => {
    const { consultas, soporte } = armar();
    await consultas.listarInvitaciones(comoAdministrador, {
      tenantId: uuid(1),
      empresaId: uuid(2).toUpperCase(),
      estado: "REVOCADA",
    });
    expect(soporte.pedidos[0]?.argumentos[0]).toEqual({
      tenantId: uuid(1),
      empresaId: uuid(2),
      estado: "REVOCADA",
    });
    await consultas.listarInvitaciones(comoAdministrador, {});
    expect(soporte.pedidos[1]?.argumentos[0]).toEqual({
      tenantId: null,
      empresaId: null,
      estado: null,
    });
    for (const estado of ["VENCIDA", "pendiente", "", "constructor"]) {
      expect(await consultas.listarInvitaciones(comoAdministrador, { estado }), estado).toEqual({
        ok: false,
        error: "ESTADO_INVALIDO",
      });
    }
    expect(await consultas.listarInvitaciones(comoAdministrador, { tenantId: "x" })).toEqual({
      ok: false,
      error: "ID_INVALIDO",
    });
    expect(await consultas.listarInvitaciones(comoAdministrador, { empresaId: "x" })).toEqual({
      ok: false,
      error: "ID_INVALIDO",
    });
    expect(soporte.pedidos).toHaveLength(2);
  });
});

const trabajo = (n: number, datos: FilaDeTrabajoFallido["datos"]): FilaDeTrabajoFallido => ({
  id: uuid(n),
  tipo: "enviar_invitacion",
  empresaId: empresaId(uuid(100)),
  intentos: 5,
  ultimoError: "MAIL_RECHAZADO",
  datos,
  creadoEn: fecha,
  actualizadoEn: fecha,
});

describe("listarTrabajosFallidos", () => {
  it("devuelve tipo, empresa, intentos, último error y datos", async () => {
    const t = trabajo(1, { invitacionId: uuid(9) });
    const { consultas } = armar({ trabajos: [t] });
    const r = await consultas.listarTrabajosFallidos(comoAdministrador, {});
    expect(r).toEqual({
      ok: true,
      valor: { filas: [{ ...t, datosOcultos: false }], siguienteDespuesDeId: null },
    });
  });

  it("si los datos tienen un campo con apariencia de secreto, NO se devuelven", async () => {
    const limpios = trabajo(1, { a: { b: [1, 2] } });
    for (const campo of [
      "token",
      "claveSecreta",
      "passwordNueva",
      "firma",
      "hashDelToken",
      "CREDENCIAL",
    ]) {
      const sospechoso = trabajo(2, { adentro: [{ [campo]: "valor-que-no-debe-salir" }] });
      const { consultas } = armar({ trabajos: [limpios, sospechoso] });
      const r = await consultas.listarTrabajosFallidos(comoAdministrador, {});
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.filas[0]).toMatchObject({ datosOcultos: false, datos: { a: { b: [1, 2] } } });
      expect(r.valor.filas[1]).toMatchObject({
        datosOcultos: true,
        datos: null,
        id: sospechoso.id,
      });
      expect(JSON.stringify(r)).not.toContain("valor-que-no-debe-salir");
    }
  });

  it("valida la página", async () => {
    const { consultas } = armar();
    expect(await consultas.listarTrabajosFallidos(comoAdministrador, { despuesDeId: "1" })).toEqual(
      {
        ok: false,
        error: "CURSOR_INVALIDO",
      },
    );
  });
});

const auditoria = (n: number): FilaDeAuditoria => ({
  id: String(n),
  actor: uuid(1),
  accion: "TENANT_ALTA",
  entidad: "tenant",
  entidadId: uuid(n),
  antes: null,
  despues: { nombre: "ACME" },
  creadoEn: fecha,
});

describe("consultarAuditoria", () => {
  it("pagina por el id de la base, que es un entero", async () => {
    const filas = [auditoria(10), auditoria(11)];
    const { consultas, soporte } = armar({ auditoria: filas });
    const r = await consultas.consultarAuditoria(comoAdministrador, {
      limite: 2,
      despuesDeId: "9",
    });
    expect(r).toEqual({ ok: true, valor: { filas, siguienteDespuesDeId: "11" } });
    expect(soporte.pedidos[0]?.argumentos).toEqual([
      { entidad: null, entidadId: null, desde: null, hasta: null },
      { limite: 2, despuesDeId: "9" },
    ]);
  });

  it("pasa los filtros recortados y el rango", async () => {
    const desde = new Date("2026-10-01T00:00:00Z");
    const hasta = new Date("2026-10-02T00:00:00Z");
    const { consultas, soporte } = armar();
    await consultas.consultarAuditoria(comoAdministrador, {
      entidad: " empresa ",
      entidadId: ` ${uuid(5)} `,
      desde,
      hasta,
    });
    expect(soporte.pedidos[0]?.argumentos[0]).toEqual({
      entidad: "empresa",
      entidadId: uuid(5),
      desde,
      hasta,
    });
  });

  it("los errores de entrada tienen nombre y no leen nada", async () => {
    const { consultas, soporte } = armar();
    expect(await consultas.consultarAuditoria(comoAdministrador, { limite: 101 })).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    expect(await consultas.consultarAuditoria(comoAdministrador, { despuesDeId: uuid(1) })).toEqual(
      {
        ok: false,
        error: "CURSOR_INVALIDO",
      },
    );
    expect(await consultas.consultarAuditoria(comoAdministrador, { entidad: " " })).toEqual({
      ok: false,
      error: "FILTRO_INVALIDO",
    });
    expect(await consultas.consultarAuditoria(comoAdministrador, { entidadId: "" })).toEqual({
      ok: false,
      error: "FILTRO_INVALIDO",
    });
    expect(
      await consultas.consultarAuditoria(comoAdministrador, {
        desde: new Date("2026-10-02T00:00:00Z"),
        hasta: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toEqual({ ok: false, error: "RANGO_INVALIDO" });
    expect(soporte.pedidos).toEqual([]);
  });
});

describe("verConfiguracion", () => {
  it("muestra el catálogo del código, ordenado, solo con los nombres de las acciones", async () => {
    const { consultas, soporte } = armar();
    const r = await consultas.verConfiguracion(comoAdministrador);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.modulos.map((m) => m.clave)).toEqual([
      "administracion",
      "carta",
      "catalogo",
      "facturacion",
      "stock",
    ]);
    const modulo = r.valor.modulos.find((m) => m.clave === "administracion");
    const facturacion = r.valor.modulos.find((m) => m.clave === "facturacion");
    expect(modulo).toMatchObject({
      clave: "administracion",
      estado: "disponible",
      obligatorio: true,
      requiere: [],
      usaSiExiste: [],
    });
    expect(modulo?.acciones).toEqual(
      Object.keys(CATALOGO_DE_MODULOS.administracion.acciones).sort(),
    );
    expect(facturacion).toMatchObject({
      clave: "facturacion",
      estado: "en_desarrollo",
      obligatorio: false,
      requiere: ["administracion"],
      acciones: [
        "certificados.gestionar",
        "comprobantes.descartar",
        "comprobantes.emitir",
        "comprobantes.emitir_manual",
        "comprobantes.reintentar",
        "comprobantes.ver",
        "notas_de_credito.emitir",
        "puntos_de_venta.cambiar_ambiente",
        "series.resincronizar",
      ],
    });
    expect(soporte.pedidos).toEqual([]);
  });

  it("ordena varios módulos por clave", async () => {
    const definicion = {
      estado: "en_desarrollo",
      obligatorio: false,
      requiere: ["administracion"],
      usaSiExiste: [],
      datosRequeridos: [],
      implementadoPor: [],
      acciones: {
        "zeta.b": { capacidad: null, efecto: "LECTURA" },
        "zeta.a": { capacidad: null, efecto: "LECTURA" },
      },
    } as const;
    const soporte = lecturaFalsa();
    const consultas = crearConsultasDePlataforma({
      transacciones: transaccionesDe({ soporte, autorizacionDePlataforma: conRol("ADMIN") }),
      reglas: REGLAS_DE_PLATAFORMA,
      catalogoDeEmpresa: { zeta: definicion, alfa: definicion, mu: definicion },
      catalogoDePerillas: CATALOGO_DE_PERILLAS,
    });
    const r = await consultas.verConfiguracion(comoAdministrador);
    expect(r.ok && r.valor.modulos.map((m) => m.clave)).toEqual(["alfa", "mu", "zeta"]);
    expect(r.ok && r.valor.modulos[0]).toEqual({
      clave: "alfa",
      estado: "en_desarrollo",
      obligatorio: false,
      requiere: ["administracion"],
      usaSiExiste: [],
      acciones: ["zeta.a", "zeta.b"],
    });
  });
});

describe("buscarReferencia", () => {
  const referencia = {
    referencia: "ZH-AB12-CD34",
    accion: "usuarios.invitar",
    motivo: "SIN_PERMISO",
    empresaId: empresaId(uuid(1)),
    personaId: personaId(uuid(2)),
    creadoEn: fecha,
  };

  it("normaliza lo que dictó la persona y devuelve lo registrado, tal cual", async () => {
    const { consultas, soporte } = armar({ referencias: [referencia] });
    const r = await consultas.buscarReferencia(comoAdministrador, {
      referencia: "  zh-ab12-cd34 ",
    });
    expect(r).toEqual({ ok: true, valor: [referencia] });
    expect(soporte.pedidos).toEqual([
      { metodo: "buscarReferencias", argumentos: ["ZH-AB12-CD34"] },
    ]);
  });

  it("devuelve todas las coincidencias (dos errores pueden haber sorteado el mismo código)", async () => {
    const otra = { ...referencia, accion: "sucursales.crear", empresaId: null, personaId: null };
    const { consultas } = armar({ referencias: [referencia, otra] });
    const r = await consultas.buscarReferencia(comoAdministrador, { referencia: "ZH-AB12-CD34" });
    expect(r).toEqual({ ok: true, valor: [referencia, otra] });
  });

  it("una referencia que no existe es una lista vacía, no un error", async () => {
    const { consultas } = armar();
    expect(
      await consultas.buscarReferencia(comoAdministrador, { referencia: "ZH-0000-0000" }),
    ).toEqual({
      ok: true,
      valor: [],
    });
  });

  it("una referencia mal formada es REFERENCIA_INVALIDA y no lee nada", async () => {
    const { consultas, soporte } = armar();
    for (const mala of ["", "ZH-12-34", "ZH-GGGG-0000", "AB12-CD34", "ZH-AB12-CD34-0000"]) {
      expect(
        await consultas.buscarReferencia(comoAdministrador, { referencia: mala }),
        mala,
      ).toEqual({
        ok: false,
        error: "REFERENCIA_INVALIDA",
      });
    }
    expect(soporte.pedidos).toEqual([]);
  });
});
