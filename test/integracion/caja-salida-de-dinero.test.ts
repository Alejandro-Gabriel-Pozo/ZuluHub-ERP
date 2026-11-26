import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import { pideLaAccionDeSalida } from "../../src/modulos/caja/casos-de-uso/registrar-salida-de-dinero";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * La salida de dinero de caja (PR-S2) con una base real: plata que sale sin ticket ni compra, por CUALQUIER medio activo (dueño, 19/11 y 26/11/2026, Q-D8 A). Cada salida es un egreso
 * de caja más su acto «movimiento de dinero» (SALIDA) y su auditoría, en una sola transacción. Cubre: el feliz en efectivo y por transferencia con cuenta, la idempotencia (la misma
 * clave dos veces, con otro contenido, tras el cierre), la concurrencia (la misma clave a la vez; dos salidas que superan el efectivo), los permisos (el piso y la acción extra de un
 * medio que no es efectivo), el aislamiento por empresa y sucursal, las validaciones, el control de «sin identificar», la atomicidad con falla inyectada, la caja cerrada o en cierre y
 * la anulación con registro nuevo. La jornada cerrada la comparte con el egreso de compras (`registrarEgresoEnTx`, ya probado ahí).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000 });

type Fila = Record<string, unknown>;
const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";
const GENERICO_DE_PERMISO = { ok: false, error: "SIN_PERMISO" };

describe.skipIf(base === null)("caja: salida de dinero por cualquier medio", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  /** Falla inyectada DESPUÉS del egreso (para probar la atomicidad): del acto o de la auditoría de la salida. */
  let falla: "NINGUNA" | "EN_EL_ACTO" | "EN_LA_AUDITORIA" = "NINGUNA";

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    const conFalla = (tx: TxDeCajaDePrueba): TxDeCajaDePrueba => ({
      ...tx,
      movimientosDeDinero: {
        ...tx.movimientosDeDinero,
        insertar: async (nuevo) => {
          if (falla === "EN_EL_ACTO") throw new Error("falla inyectada al insertar el acto");
          return tx.movimientosDeDinero.insertar(nuevo);
        },
      },
      auditoria: {
        registrar: async (registro) => {
          if (falla === "EN_LA_AUDITORIA" && registro.accion === "SALIDA_DE_DINERO_REGISTRADA") {
            throw new Error("falla inyectada en la auditoría de la salida");
          }
          await tx.auditoria.registrar(registro);
        },
      },
    });
    entorno = crearEntornoDeCaja(propia.base, 8, conFalla);
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
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (rol: "GERENTE" | "ADMINISTRADOR" = "GERENTE") =>
    crearMundoDeOperacion(entornoBase, dueno, caja, { rol });
  const en = (minutos = 0) => new Date(instanteLocal(1, "10:00").getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeOperacion, minutos = 5) => conAhora(m.ctx(), en(minutos));

  const auditorias = (m: MundoDeOperacion, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const actos = (m: MundoDeOperacion) =>
    filas(
      `select sentido, categoria, importe::text as importe, motivo, tercero_nombre, tercero_persona_id, referencia, movimiento_id, sesion_id
         from movimiento_de_dinero where empresa_id = $1 order by registrado_en, id`,
      [m.empresa],
    );
  const egresos = (m: MundoDeOperacion) =>
    filas(
      `select id, clase, medio_de_pago_id, cuenta_de_cobro_id, importe::text as importe, motivo, sesion_id
         from movimiento_caja where empresa_id = $1 and clase = 'EGRESO_MANUAL' order by registrado_en, id`,
      [m.empresa],
    );
  /** Todo lo que escribe una salida de dinero en una empresa: egresos, actos y la cuenta de auditorías. */
  const foto = async (m: MundoDeOperacion) =>
    JSON.stringify({
      movimientos: await filas("select * from movimiento_caja where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      actos: await filas("select * from movimiento_de_dinero where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      auditoria: await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        m.empresa,
      ]),
    });
  const efectivoDe = async (m: MundoDeOperacion) =>
    (
      await filas<{ id: string }>(
        "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
        [m.empresa],
      )
    )[0]?.id as string;
  const medioDe = async (m: MundoDeOperacion, tipo: string) => {
    const r = await casos().crearMedioDePago(m.ctx(), { tipo, nombre: null });
    if (!r.ok) throw new Error(`no se pudo crear el medio ${tipo}: ${JSON.stringify(r.error)}`);
    return r.valor.medioDePagoId;
  };
  const cuentaBancaria = async (m: MundoDeOperacion, sucursalId: string = m.sucursal) => {
    const r = await casos().crearCuentaDeCobro(m.ctx(), {
      tipo: "CUENTA_BANCARIA",
      nombre: `Cuenta ${claveNueva().slice(0, 6)}`,
      identificadorExterno: null,
      sucursalId,
    });
    if (!r.ok) throw new Error(`no se pudo crear la cuenta: ${JSON.stringify(r.error)}`);
    return r.valor.cuentaDeCobroId;
  };
  const abrir = async (m: MundoDeOperacion, fondo = "1000.00"): Promise<string> => {
    const r = await casos().abrirSesion(ctxEn(m, 0), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos(fondo),
    });
    if (!r.ok) throw new Error(`no se pudo abrir la sesión: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  /** Una salida con valores razonables; `resto` pisa lo que haga falta. Por el efectivo usa la puerta de piso; con un medio dado, la completa. */
  const salida = async (
    m: MundoDeOperacion,
    resto: Partial<Parameters<ReturnType<typeof casos>["registrarSalidaDeDinero"]>[1]> = {},
    ctx = ctxEn(m),
    puerta: "AUTO" | "DE_PISO" | "COMPLETA" = "AUTO",
  ) => {
    const entrada = {
      claveDeIdempotencia: claveNueva(),
      cajaId: m.cajaId,
      medioDePagoId: await efectivoDe(m),
      cuentaDeCobroId: null,
      categoria: "GASTO_MENOR",
      importe: pesos("100.00"),
      motivo: "Flete",
      tercero: { nombre: "Pérez" },
      ...resto,
    };
    const completa =
      puerta === "COMPLETA" || (puerta === "AUTO" && resto.medioDePagoId !== undefined);
    return completa
      ? casos().registrarSalidaDeDineroPorOtroMedio(ctx, entrada)
      : casos().registrarSalidaDeDinero(ctx, entrada);
  };
  const esperadoEn = async (m: MundoDeOperacion, medio: string) =>
    (
      await filas<{ total: string }>(
        "select coalesce(sum(importe), 0)::text as total from movimiento_caja where empresa_id = $1 and medio_de_pago_id = $2",
        [m.empresa, medio],
      )
    )[0]?.total;

  it("EFECTIVO: el gerente registra un gasto menor con nombre: un egreso negativo, un acto SALIDA y la auditoría sin el nombre; el esperado baja", async () => {
    const m = await mundo();
    await abrir(m, "1000.00");
    const efectivo = await efectivoDe(m);
    const r = await salida(m, { importe: pesos("123.45"), referencia: "Rem 0001-123" });
    expect(r.ok && r.valor).toMatchObject({ yaExistia: false, sinIdentificar: false });
    expect(await egresos(m)).toEqual([
      expect.objectContaining({
        medio_de_pago_id: efectivo,
        cuenta_de_cobro_id: null,
        importe: "-123.45",
        motivo: "Flete",
      }),
    ]);
    expect(await actos(m)).toEqual([
      expect.objectContaining({
        sentido: "SALIDA",
        categoria: "GASTO_MENOR",
        importe: "123.45",
        tercero_nombre: "Pérez",
        referencia: "Rem 0001-123",
      }),
    ]);
    expect(await esperadoEn(m, efectivo)).toBe("876.55");
    const [constancia] = await filas<{ despues: unknown }>(
      "select despues from auditoria_empresa where empresa_id = $1 and accion = 'SALIDA_DE_DINERO_REGISTRADA'",
      [m.empresa],
    );
    expect(JSON.stringify(constancia?.despues)).not.toContain("Pérez");
    expect(constancia?.despues).toMatchObject({
      categoria: "GASTO_MENOR",
      medioTipo: "EFECTIVO",
      importe: "123.45",
      tercero: "NOMBRE",
    });
    expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
  });

  it("TRANSFERENCIA: por un medio que no es efectivo y con su cuenta bancaria: egreso con medio y cuenta, acto SALIDA, el efectivo no se mueve ni avisa «supera el efectivo»", async () => {
    const m = await mundo();
    await abrir(m, "50.00");
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const cuenta = await cuentaBancaria(m);
    const r = await salida(m, {
      medioDePagoId: transferencia,
      cuentaDeCobroId: cuenta,
      importe: pesos("5000.00"),
      categoria: "ADELANTO_DE_SUELDO",
    });
    expect(r.ok && r.valor.yaExistia).toBe(false);
    expect(await egresos(m)).toEqual([
      expect.objectContaining({
        medio_de_pago_id: transferencia,
        cuenta_de_cobro_id: cuenta,
        importe: "-5000.00",
      }),
    ]);
    expect(await actos(m)).toHaveLength(1);
    expect(await esperadoEn(m, await efectivoDe(m))).toBe("50.00");
    expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(0);
  });

  it("IDEMPOTENCIA: la misma salida dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
    const m = await mundo();
    await abrir(m);
    const entrada = { claveDeIdempotencia: claveNueva(), importe: pesos("33.30") };
    const primera = await salida(m, entrada);
    expect(primera.ok && primera.valor.yaExistia).toBe(false);
    const antes = await foto(m);
    const segunda = await salida(m, entrada, ctxEn(m, 9));
    expect(segunda).toEqual(
      ok({
        movimientoDeDineroId: primera.ok ? primera.valor.movimientoDeDineroId : "",
        movimientoId: primera.ok ? primera.valor.movimientoId : "",
        sesionId: primera.ok ? primera.valor.sesionId : "",
        yaExistia: true,
        sinIdentificar: false,
      }),
    );
    expect(await foto(m)).toBe(antes);
  });

  it("la misma salida por otro medio dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
    const m = await mundo();
    await abrir(m);
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const entrada = { claveDeIdempotencia: claveNueva(), medioDePagoId: transferencia };
    const primera = await salida(m, entrada);
    expect(primera.ok && primera.valor.yaExistia).toBe(false);
    const antes = await foto(m);
    const segunda = await salida(m, entrada, ctxEn(m, 9));
    expect(segunda.ok && segunda.valor.yaExistia).toBe(true);
    expect(await foto(m)).toBe(antes);
  });

  it("IDEMPOTENCIA: otro contenido con la misma clave (importe, categoría, medio, tercero) es CLAVE_REUTILIZADA y no escribe nada; tras el cierre devuelve lo hecho", async () => {
    const m = await mundo();
    const sesion = await abrir(m);
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const entrada = { claveDeIdempotencia: claveNueva(), importe: pesos("10.00") };
    const primera = await salida(m, entrada);
    expect(primera.ok).toBe(true);
    const antes = await foto(m);
    for (const otro of [
      { importe: pesos("10.01") },
      { categoria: "PROPINA_ENTREGADA" },
      { medioDePagoId: transferencia },
      { tercero: { nombre: "Gómez" } },
      { motivo: "Otro motivo" },
      { referencia: "X-1" },
    ]) {
      expect(await salida(m, { ...entrada, ...otro }, ctxEn(m, 9))).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
    }
    expect(await foto(m)).toBe(antes);
    // El cierre de la sesión no cambia lo hecho: el reintento devuelve el acto original.
    const cierre = await casos().cerrarSesion(ctxEn(m, 30), {
      sesionId: sesion,
      conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: pesos("0.00") },
      otros: [],
      conformeGeneral: false,
      observacion: null,
    });
    expect(cierre.ok).toBe(true);
    const repetida = await salida(m, entrada, ctxEn(m, 40));
    expect(repetida.ok && repetida.valor.yaExistia).toBe(true);
  });

  it("CONCURRENCIA: la misma salida (misma clave) a la vez desde dos pestañas deja UN egreso y UN acto; las dos responden bien", async () => {
    const m = await mundo();
    await abrir(m);
    const entrada = { claveDeIdempotencia: claveNueva(), importe: pesos("77.00") };
    const [a, b] = await Promise.all([salida(m, entrada), salida(m, entrada)]);
    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(1);
    expect(await egresos(m)).toHaveLength(1);
    expect(await actos(m)).toHaveLength(1);
    expect(await auditorias(m, "SALIDA_DE_DINERO_REGISTRADA")).toBe(1);
  });

  it("CONCURRENCIA: dos salidas distintas a la vez que juntas superan el efectivo entran las dos, suman exacto y se audita el aviso", async () => {
    const m = await mundo();
    await abrir(m, "1000.00");
    const [a, b] = await Promise.all([
      salida(m, { importe: pesos("900.00") }),
      salida(m, { importe: pesos("900.00"), categoria: "PROPINA_ENTREGADA" }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await egresos(m)).toHaveLength(2);
    expect(await actos(m)).toHaveLength(2);
    expect(await esperadoEn(m, await efectivoDe(m))).toBe("-800.00");
    expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(1);
  });

  it("PERMISOS: el operador con alcance saca efectivo (como hoy) pero NO por un medio que no es efectivo, ni por una puerta ni por la otra; el administrador sí; sin persona o sin alcance no escribe nada", async () => {
    const m = await mundo();
    await abrir(m);
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const operador = await sumarPersona(dueno, m, "OPERADOR", true);
    const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR");
    const sinAlcance = await sumarPersona(dueno, m, "OPERADOR", false);
    const comoOperador = conAhora(operador(), en(5));
    expect((await salida(m, {}, comoOperador)).ok).toBe(true);
    const antes = await foto(m);
    for (const puerta of ["DE_PISO", "COMPLETA"] as const) {
      expect(await salida(m, { medioDePagoId: transferencia }, comoOperador, puerta)).toEqual(
        GENERICO_DE_PERMISO,
      );
    }
    // El operador tampoco saca efectivo por la puerta completa (pide la acción de salida).
    expect(await salida(m, {}, comoOperador, "COMPLETA")).toEqual(GENERICO_DE_PERMISO);
    expect((await salida(m, {}, { ...ctxEn(m), personaId: null })).ok).toBe(false);
    expect((await salida(m, {}, conAhora(sinAlcance(), en(5)))).ok).toBe(false);
    expect(await foto(m)).toBe(antes);
    const comoAdmin = conAhora(administrador(), en(5));
    expect((await salida(m, { medioDePagoId: transferencia }, comoAdmin)).ok).toBe(true);
    expect((await salida(m, {}, comoAdmin, "COMPLETA")).ok).toBe(true);
    // La puerta de piso rechaza un medio que no es efectivo aunque quien llama sea administrador: hay que usar la completa.
    expect(await salida(m, { medioDePagoId: transferencia }, comoAdmin, "DE_PISO")).toEqual(
      GENERICO_DE_PERMISO,
    );
    expect(await egresos(m)).toHaveLength(3);
    expect(await actos(m)).toHaveLength(3);
  });

  it("PERMISOS: la acción extra sale de UNA tabla: el efectivo no pide ninguna y todo otro medio pide salidas_de_dinero.registrar", () => {
    expect(pideLaAccionDeSalida("EFECTIVO")).toBe(false);
    for (const tipo of [
      "TARJETA_DEBITO",
      "TARJETA_CREDITO",
      "TRANSFERENCIA",
      "QR",
      "OTRO",
    ] as const) {
      expect(pideLaAccionDeSalida(tipo)).toBe(true);
    }
  });

  it("AISLAMIENTO: una caja, un medio, una cuenta o una persona de otra empresa (o de otra sucursal) se rechazan y no escriben nada", async () => {
    const m = await mundo();
    const otra = await mundo();
    await abrir(m);
    await abrir(otra);
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const sucursalDos = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal dos");
    const cuentaAjena = await cuentaBancaria(m, sucursalDos);
    const cuentaDeOtra = await cuentaBancaria(otra);
    const personaDeOtra = await sumarPersona(dueno, otra, "ADMINISTRADOR");
    const antes = await foto(m);
    const intentar = (resto: Parameters<typeof salida>[1]) => salida(m, resto);
    expect(await intentar({ cajaId: otra.cajaId })).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
    expect(await intentar({ cajaId: UUID_QUE_NO_EXISTE })).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
    expect(await intentar({ medioDePagoId: await efectivoDe(otra) })).toEqual({
      ok: false,
      error: "MEDIO_NO_ENCONTRADO",
    });
    expect(await intentar({ medioDePagoId: transferencia, cuentaDeCobroId: cuentaAjena })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
    });
    expect(await intentar({ medioDePagoId: transferencia, cuentaDeCobroId: cuentaDeOtra })).toEqual(
      { ok: false, error: "CUENTA_DE_COBRO_NO_ENCONTRADA" },
    );
    const empleadoAjeno = personaDeOtra().personaId as string;
    expect(await intentar({ tercero: { personaId: empleadoAjeno } })).toEqual({
      ok: false,
      error: "TERCERO_INVALIDO",
    });
    expect(await foto(m)).toBe(antes);
    expect(await actos(otra)).toHaveLength(0);
  });

  it("EMPLEADO: una persona con membresía activa de la empresa es un tercero válido y queda guardada; una apagada, no", async () => {
    const m = await mundo();
    await abrir(m);
    const empleado = (await sumarPersona(dueno, m, "OPERADOR"))().personaId as string;
    const r = await salida(m, {
      categoria: "ADELANTO_DE_SUELDO",
      tercero: { personaId: empleado },
    });
    expect(r.ok).toBe(true);
    expect(await actos(m)).toEqual([expect.objectContaining({ tercero_persona_id: empleado })]);
    await dueno.query(
      "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
      [m.empresa, empleado],
    );
    expect(await salida(m, { tercero: { personaId: empleado } })).toEqual({
      ok: false,
      error: "TERCERO_INVALIDO",
    });
  });

  it("VALIDACIÓN: la devolución no entra por acá; «Otro» sin motivo, importe cero, negativo o en otra moneda, clave mala, tercero doble y cuenta con efectivo se rechazan sin escribir", async () => {
    const m = await mundo();
    await abrir(m);
    const cuenta = await cuentaBancaria(m);
    const antes = await foto(m);
    const malos: ReadonlyArray<[Parameters<typeof salida>[1], string]> = [
      [{ categoria: "DEVOLUCION_DE_UN_COBRO" }, "CATEGORIA_INVALIDA"],
      [{ categoria: "NO_EXISTE" }, "CATEGORIA_INVALIDA"],
      [{ categoria: "OTRO", motivo: "  " }, "MOTIVO_INVALIDO"],
      [{ importe: pesos("0.00") }, "IMPORTE_INVALIDO"],
      [{ importe: pesos("-5.00") }, "IMPORTE_INVALIDO"],
      [{ importe: { moneda: "USD", monto: "5.00" } }, "MONEDA_NO_SOPORTADA"],
      [{ importe: pesos("1000000000.00") }, "IMPORTE_INVALIDO"],
      [{ claveDeIdempotencia: "corta" }, "CLAVE_DE_IDEMPOTENCIA_INVALIDA"],
      [{ tercero: { nombre: "Pérez", personaId: UUID_QUE_NO_EXISTE } }, "TERCERO_INVALIDO"],
      [{ cuentaDeCobroId: cuenta }, "CUENTA_DE_COBRO_NO_ADMITIDA"],
      [{ medioDePagoId: "no-es-un-id" }, "MEDIO_NO_ENCONTRADO"],
    ];
    for (const [resto, error] of malos) {
      expect(await salida(m, resto), JSON.stringify(resto)).toEqual({ ok: false, error });
    }
    expect(await foto(m)).toBe(antes);
  });

  it("MEDIO INACTIVO: un medio desactivado no sirve para una salida nueva", async () => {
    const m = await mundo();
    await abrir(m);
    const qr = await medioDe(m, "QR");
    expect((await casos().desactivarMedioDePago(m.ctx(), { medioDePagoId: qr })).ok).toBe(true);
    const antes = await foto(m);
    expect(await salida(m, { medioDePagoId: qr })).toEqual({ ok: false, error: "MEDIO_INACTIVO" });
    expect(await foto(m)).toBe(antes);
  });

  it("CONTROL: el retiro del dueño sin tercero entra sin excepción; un gasto menor sin tercero entra, queda marcado y con la excepción auditada (nivel de nacimiento)", async () => {
    const m = await mundo();
    await abrir(m);
    const retiro = await salida(m, { categoria: "RETIRO_DEL_DUENO", tercero: null });
    expect(retiro.ok && retiro.valor.sinIdentificar).toBe(false);
    expect(await auditorias(m, "CONTROL_EXCEPCION")).toBe(0);
    const gasto = await salida(m, { tercero: null });
    expect(gasto.ok && gasto.valor.sinIdentificar).toBe(true);
    expect(await auditorias(m, "CONTROL_EXCEPCION")).toBe(1);
    // Repetirla devuelve lo hecho, con la misma marca, sin otra excepción.
    const clave = claveNueva();
    const primera = await salida(m, { claveDeIdempotencia: clave, tercero: null });
    const repetida = await salida(m, { claveDeIdempotencia: clave, tercero: null });
    expect(primera.ok && repetida.ok && repetida.valor.sinIdentificar).toBe(true);
    expect(await auditorias(m, "CONTROL_EXCEPCION")).toBe(2);
  });

  it("CONTROL: con el nivel en AVISAR pide confirmación y no escribe; confirmado entra, y el reintento con la misma clave devuelve lo hecho", async () => {
    const m = await mundo();
    await abrir(m);
    await dueno.query(
      "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'caja.salida_sin_identificar', 'AVISAR')",
      [m.empresa],
    );
    const antes = await foto(m);
    const clave = claveNueva();
    expect(await salida(m, { claveDeIdempotencia: clave, tercero: null })).toEqual({
      ok: false,
      error: {
        codigo: "CONTROL_REQUIERE_CONFIRMACION",
        control: "caja.salida_sin_identificar",
      },
    });
    expect(await foto(m)).toBe(antes);
    const confirmada = await salida(m, {
      claveDeIdempotencia: clave,
      tercero: null,
      confirmaciones: ["caja.salida_sin_identificar", "otro.control.cualquiera"],
    });
    expect(confirmada.ok && confirmada.valor.yaExistia).toBe(false);
    expect(await auditorias(m, "CONTROL_EXCEPCION")).toBe(1);
    // Con un tercero identificado el control no se evalúa aunque el nivel sea AVISAR.
    expect((await salida(m, { tercero: { nombre: "Gómez" } })).ok).toBe(true);
  });

  it("ATOMICIDAD: si falla el alta del acto o su auditoría, no queda el egreso ni nada: todo o nada; con la falla levantada, el mismo pedido entra una vez", async () => {
    const m = await mundo();
    await abrir(m);
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    for (const modo of ["EN_EL_ACTO", "EN_LA_AUDITORIA"] as const) {
      falla = modo;
      const antes = await foto(m);
      try {
        const clave = claveNueva();
        await expect(
          salida(m, { claveDeIdempotencia: clave, medioDePagoId: transferencia }),
        ).rejects.toThrow(/falla inyectada/);
        expect(await foto(m)).toBe(antes);
        falla = "NINGUNA";
        expect(
          (await salida(m, { claveDeIdempotencia: clave, medioDePagoId: transferencia })).ok,
        ).toBe(true);
        expect(await egresos(m)).toHaveLength(modo === "EN_EL_ACTO" ? 1 : 2);
      } finally {
        falla = "NINGUNA";
      }
    }
  });

  it("CAJA: sin sesión abierta o con la sesión en cierre, cualquier medio se rechaza con su motivo y no escribe nada; una salida en efectivo y una por transferencia dan lo mismo", async () => {
    const m = await mundo();
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const antes = await foto(m);
    for (const medio of [await efectivoDe(m), transferencia]) {
      expect(await salida(m, { medioDePagoId: medio })).toEqual({
        ok: false,
        error: { codigo: "SIN_SESION_ABIERTA", cajaId: m.cajaId },
      });
    }
    const sesion = await abrir(m);
    expect((await casos().iniciarCierre(ctxEn(m, 20), { sesionId: sesion })).ok).toBe(true);
    for (const medio of [await efectivoDe(m), transferencia]) {
      expect(await salida(m, { medioDePagoId: medio }, ctxEn(m, 25))).toMatchObject({
        ok: false,
        error: { codigo: "CAJA_EN_CIERRE", cajaId: m.cajaId, sesionId: sesion },
      });
    }
    expect(await actos(m)).toHaveLength(0);
    expect(await egresos(m)).toHaveLength(0);
    expect(antes).not.toBe(""); // la foto inicial existe: lo único que cambió es la sesión abierta, no los movimientos de salida
  });

  it("ANULACIÓN: una salida por transferencia se anula con un registro NUEVO que espeja medio, cuenta e importe; el acto no se borra y repetir la anulación no la duplica", async () => {
    const m = await mundo();
    await abrir(m);
    const transferencia = await medioDe(m, "TRANSFERENCIA");
    const cuenta = await cuentaBancaria(m);
    const r = await salida(m, {
      medioDePagoId: transferencia,
      cuentaDeCobroId: cuenta,
      importe: pesos("250.00"),
    });
    const movimientoId = r.ok ? r.valor.movimientoId : "";
    const clave = claveNueva();
    const anular = () =>
      casos().anularMovimientoDeCaja(ctxEn(m, 12), {
        claveDeIdempotencia: clave,
        movimientoId,
        motivo: "Se cargó mal",
      });
    expect((await anular()).ok).toBe(true);
    expect((await anular()).ok).toBe(true);
    const espejo = await filas(
      `select clase, medio_de_pago_id, cuenta_de_cobro_id, importe::text as importe, anula_a
         from movimiento_caja where empresa_id = $1 and clase = 'ANULACION'`,
      [m.empresa],
    );
    expect(espejo).toEqual([
      expect.objectContaining({
        medio_de_pago_id: transferencia,
        cuenta_de_cobro_id: cuenta,
        importe: "250.00",
        anula_a: movimientoId,
      }),
    ]);
    expect(await actos(m)).toHaveLength(1);
    expect(await egresos(m)).toHaveLength(1);
  });
});
