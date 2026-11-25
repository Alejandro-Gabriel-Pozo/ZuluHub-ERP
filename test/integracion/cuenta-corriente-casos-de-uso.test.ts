import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import { armarTxDeSaldos } from "../../src/composicion/libro-de-saldos";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  ERRORES_DE_CUENTA_CORRIENTE_POR_RESTRICCION,
  type CuentaPublica,
} from "../../src/modulos/cuenta_corriente/publico";
import { registrarAsientoEnTx, type TxDeSaldos } from "../../src/modulos/saldos_de_partes/publico";
import { importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCuentaCorriente,
  crearClienteDePrueba,
  crearEntornoDeCuentaCorriente,
  crearMundoDeCuentaCorriente,
  sumarPersonaDeCuentaCorriente,
  type MundoDeCuentaCorriente,
  type OpcionesDeCliente,
  type TxDeCuentaCorrienteDePrueba,
} from "./cuenta-corriente-apoyo";
import { sucursalDe } from "./fixtures-identidad";

/**
 * La ficha de cuenta corriente de clientes (CC-1) con una base real y los roles reales: el guard primero (rol, módulo y repositorio sin tocar), la
 * validación, la idempotencia de habilitar (clave y huella) y de suspender, reactivar y cambiar condiciones (por estado y `SIN_CAMBIOS`), el control de
 * versión, la auditoría en la misma transacción, el aislamiento entre empresas, la lectura del saldo y el disponible desde el libro, y la concurrencia con DOS
 * actores a la vez. Previene: dos fichas para un cliente, un doble clic que duplica o audita dos veces, una ficha que cambia desde otra empresa, un permiso
 * que se decide en la pantalla y un saldo que se mezcla entre clientes.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("cuenta corriente de clientes: casos de uso y consulta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCuentaCorriente>;
  let entornoDelLibro: ReturnType<typeof crearTransacciones<TxDeSaldos>>;
  let dueno: pg.Client;
  let cc: ReturnType<typeof armarCuentaCorriente>;
  let m: MundoDeCuentaCorriente;
  let otra: MundoDeCuentaCorriente;
  let sucursal: string;
  const llamadasAlRepositorio: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCuentaCorriente(propia.base, 6);
    cc = armarCuentaCorriente(entorno);
    entornoDelLibro = crearTransacciones<TxDeSaldos>({
      urls: { OPERATIVO: propia.base.app },
      armar: armarTxDeSaldos,
      maximoDeConexiones: 2,
      clave: propia.base.clave,
    });
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundoDeCuentaCorriente(entornoBase, dueno);
    otra = await crearMundoDeCuentaCorriente(entornoBase, dueno);
    sucursal = await sucursalDe(dueno, m.empresa);
  });
  afterAll(async () => {
    await dueno.end();
    await entornoDelLibro.cerrar();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const auditorias = (mundo: MundoDeCuentaCorriente, accion: string, entidadId?: string) =>
    contar(
      `select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2
         and ($3::text is null or entidad_id = $3)`,
      [mundo.empresa, accion, entidadId ?? null],
    );
  const fichasDe = (parte: string) =>
    contar("select count(*) as n from cuenta_del_cliente where parte_id = $1", [parte]);
  const fichaEnBase = async (id: string) =>
    (
      await filas<{
        estado: string;
        version: number;
        plazo_dias: number;
        limite: string;
        motivo_de_suspension: string | null;
      }>(
        "select estado, version, plazo_dias, limite::text as limite, motivo_de_suspension from cuenta_del_cliente where id = $1",
        [id],
      )
    )[0];
  const cliente = (mundo: MundoDeCuentaCorriente = m, o: OpcionesDeCliente = {}) =>
    crearClienteDePrueba(dueno, mundo, o);
  const clave = () => randomUUID();
  const exito = <T>(r: Resultado<T, unknown>): T => {
    if (!r.ok) throw new Error(`falló: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const error = <E>(r: Resultado<unknown, E>): E => {
    if (r.ok) throw new Error("tenía que fallar");
    return r.error;
  };
  const habilitar = (
    parteId: string,
    o: Partial<{
      clave: string;
      plazoDias: number;
      limite: string;
      ctx: ContextoOperativo;
      casos: typeof cc.casos;
    }> = {},
  ) =>
    (o.casos ?? cc.casos).habilitarCuentaDelCliente(o.ctx ?? m.ctx(), {
      claveDeIdempotencia: o.clave ?? clave(),
      parteId,
      plazoDias: o.plazoDias ?? 30,
      limite: o.limite ?? "100000.00",
    });
  const habilitada = async (
    mundo: MundoDeCuentaCorriente = m,
  ): Promise<{ cuenta: CuentaPublica; parte: string }> => {
    const parte = await cliente(mundo);
    const { cuenta } = exito(await habilitar(parte, { ctx: mundo.ctx() }));
    return { cuenta, parte };
  };

  describe("habilitar", () => {
    it("un cliente con CUIT queda habilitado en pesos, con versión 1, y se audita en la misma transacción", async () => {
      const parte = await cliente();
      const r = exito(await habilitar(parte, { plazoDias: 60, limite: "250000.5" }));
      expect(r.yaExistia).toBe(false);
      expect(r.cuenta).toMatchObject({
        parteId: parte,
        plazoDias: 60,
        limite: { moneda: "ARS", monto: "250000.50" },
        estado: "HABILITADA",
        motivoDeSuspension: null,
        version: 1,
      });
      const guardada = await fichaEnBase(r.cuenta.id);
      expect(guardada).toMatchObject({
        estado: "HABILITADA",
        version: 1,
        plazo_dias: 60,
        limite: "250000.50",
      });
      const [constancia] = await filas<{
        actor_persona_id: string;
        antes: unknown;
        despues: unknown;
      }>(
        "select actor_persona_id, antes, despues from auditoria_empresa where empresa_id = $1 and accion = 'CUENTA_DEL_CLIENTE_HABILITADA' and entidad_id = $2",
        [m.empresa, r.cuenta.id],
      );
      expect(constancia?.actor_persona_id).toBe(m.persona);
      expect(constancia?.antes).toBeNull();
      expect(constancia?.despues).toEqual({
        parteId: parte,
        plazoDias: 60,
        limite: "250000.50",
        moneda: "ARS",
        estado: "HABILITADA",
      });
      // La clave y la huella no salen en la respuesta ni en la auditoría.
      expect(JSON.stringify(r)).not.toMatch(/huella|clave/i);
      expect(JSON.stringify(constancia)).not.toMatch(/huella|clave/i);
    });

    it("habilitar dos veces con la misma clave deja una ficha y una auditoría y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
      const parte = await cliente();
      const k = clave();
      const primera = exito(await habilitar(parte, { clave: k }));
      const segunda = exito(await habilitar(parte, { clave: k, limite: "100000" })); // «100000» y «100000.00» son el mismo pedido
      expect(segunda.yaExistia).toBe(true);
      expect(segunda.cuenta.id).toBe(primera.cuenta.id);
      expect(await fichasDe(parte)).toBe(1);
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", primera.cuenta.id)).toBe(1);
      // Otro límite, otro plazo u otro cliente con la misma clave: el pedido es otro.
      expect(error(await habilitar(parte, { clave: k, limite: "200000.00" }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(error(await habilitar(parte, { clave: k, plazoDias: 60 }))).toBe("CLAVE_REUTILIZADA");
      expect(error(await habilitar(await cliente(), { clave: k }))).toBe("CLAVE_REUTILIZADA");
      expect(await fichasDe(parte)).toBe(1);
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", primera.cuenta.id)).toBe(1);
    });

    it("repetir la misma clave después de otros cambios devuelve la ficha vigente, sin escribir", async () => {
      const parte = await cliente();
      const k = clave();
      const { cuenta } = exito(await habilitar(parte, { clave: k }));
      exito(
        await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Pagos vencidos",
        }),
      );
      const otraVez = exito(await habilitar(parte, { clave: k }));
      expect(otraVez.yaExistia).toBe(true);
      expect(otraVez.cuenta).toMatchObject({ estado: "SUSPENDIDA", version: 2 });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", cuenta.id)).toBe(1);
    });

    it("habilitar al mismo cliente con otra clave: YA_HABILITADA, sin segunda ficha ni auditoría", async () => {
      const { cuenta, parte } = await habilitada();
      expect(error(await habilitar(parte))).toBe("YA_HABILITADA");
      expect(await fichasDe(parte)).toBe(1);
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", cuenta.id)).toBe(1);
    });

    it.each([
      ["una clave con forma inválida", { clave: "corta" }, "CLAVE_INVALIDA"],
      ["un plazo de 0 días", { plazoDias: 0 }, "PLAZO_INVALIDO"],
      ["un plazo de 366 días", { plazoDias: 366 }, "PLAZO_INVALIDO"],
      ["un plazo con decimales", { plazoDias: 30.5 }, "PLAZO_INVALIDO"],
      ["un límite negativo", { limite: "-1" }, "LIMITE_INVALIDO"],
      ["un límite con más de 2 decimales", { limite: "10.123" }, "LIMITE_INVALIDO"],
      ["un límite sobre el tope", { limite: "1000000000" }, "LIMITE_INVALIDO"],
      ["un límite escrito con coma", { limite: "10,50" }, "LIMITE_INVALIDO"],
    ] as const)("rechaza %s, sin escribir ni auditar", async (_nombre, entrada, esperado) => {
      const parte = await cliente();
      const antes = await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA");
      expect(error(await habilitar(parte, entrada))).toBe(esperado);
      expect(await fichasDe(parte)).toBe(0);
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA")).toBe(antes);
    });

    it("el límite en cero y el plazo de 1 y de 365 días son válidos", async () => {
      for (const plazoDias of [1, 365]) {
        const { cuenta } = exito(await habilitar(await cliente(), { plazoDias, limite: "0" }));
        expect(cuenta).toMatchObject({ plazoDias, limite: { moneda: "ARS", monto: "0.00" } });
      }
    });

    it.each([
      [
        "sin CUIT (DNI)",
        { documento: "DNI", naturaleza: "HUMANA" },
        "PARTE_SIN_CUIT_O_RAZON_SOCIAL",
      ],
      ["sin documento", { documento: null }, "PARTE_SIN_CUIT_O_RAZON_SOCIAL"],
      ["que no es cliente (proveedor)", { rol: "PROVEEDOR" }, "PARTE_NO_ES_CLIENTE"],
      ["sin ningún rol", { rol: null }, "PARTE_NO_ES_CLIENTE"],
      ["inactiva", { estado: "INACTIVA" }, "PARTE_NO_ACTIVA"],
    ] as const)("no se habilita a una parte %s", async (_nombre, opciones, esperado) => {
      const parte = await cliente(m, opciones);
      expect(error(await habilitar(parte))).toBe(esperado);
      expect(await fichasDe(parte)).toBe(0);
    });

    it("una parte que no existe, que no es un UUID o que es de otra empresa es PARTE_NO_ENCONTRADA (sin oráculo de existencia)", async () => {
      const deOtra = await cliente(otra);
      expect(error(await habilitar(randomUUID()))).toBe("PARTE_NO_ENCONTRADA");
      expect(error(await habilitar("no-es-un-uuid"))).toBe("PARTE_NO_ENCONTRADA");
      expect(error(await habilitar(deOtra))).toBe("PARTE_NO_ENCONTRADA");
      expect(await fichasDe(deOtra)).toBe(0);
    });

    it("el mismo cliente se puede habilitar en cada empresa por separado: una ficha por cliente y empresa", async () => {
      const a = await habilitada(m);
      const b = await habilitada(otra);
      expect(a.cuenta.id).not.toBe(b.cuenta.id);
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", b.cuenta.id)).toBe(0);
    });
  });

  describe("suspender, reactivar y cambiar condiciones", () => {
    it("suspender dos veces: la segunda devuelve yaEstaba y no escribe ni audita", async () => {
      const { cuenta } = await habilitada();
      const primera = exito(
        await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Pagos vencidos",
        }),
      );
      expect(primera).toMatchObject({
        yaEstaba: false,
        cuenta: { estado: "SUSPENDIDA", motivoDeSuspension: "Pagos vencidos", version: 2 },
      });
      const segunda = exito(
        await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Pagos vencidos",
        }),
      );
      expect(segunda).toMatchObject({
        yaEstaba: true,
        cuenta: { estado: "SUSPENDIDA", version: 2 },
      });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_SUSPENDIDA", cuenta.id)).toBe(1);
      expect((await fichaEnBase(cuenta.id))?.version).toBe(2);
      const [constancia] = await filas<{ antes: unknown; despues: unknown }>(
        "select antes, despues from auditoria_empresa where accion = 'CUENTA_DEL_CLIENTE_SUSPENDIDA' and entidad_id = $1",
        [cuenta.id],
      );
      expect(constancia).toEqual({
        antes: { estado: "HABILITADA", motivo: null },
        despues: { estado: "SUSPENDIDA", motivo: "Pagos vencidos" },
      });
    });

    it("reactivar dos veces: la segunda devuelve yaEstaba y no escribe ni audita", async () => {
      const { cuenta } = await habilitada();
      exito(
        await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Pagos vencidos",
        }),
      );
      const primera = exito(
        await cc.casos.reactivarCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 2,
        }),
      );
      expect(primera).toMatchObject({
        yaEstaba: false,
        cuenta: { estado: "HABILITADA", motivoDeSuspension: null, version: 3 },
      });
      const segunda = exito(
        await cc.casos.reactivarCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 2,
        }),
      );
      expect(segunda).toMatchObject({
        yaEstaba: true,
        cuenta: { estado: "HABILITADA", version: 3 },
      });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_REACTIVADA", cuenta.id)).toBe(1);
      expect((await fichaEnBase(cuenta.id))?.version).toBe(3);
    });

    it("suspender exige un motivo válido; con versión vieja es VERSION_DESACTUALIZADA; una ficha ajena o inexistente es CUENTA_NO_ENCONTRADA", async () => {
      const { cuenta } = await habilitada();
      for (const motivo of ["", "a".repeat(301), "Dos\nlíneas"]) {
        expect(
          error(
            await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
              cuentaId: cuenta.id,
              versionEsperada: 1,
              motivo,
            }),
          ),
        ).toBe("MOTIVO_INVALIDO");
      }
      expect(
        error(
          await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
            cuentaId: cuenta.id,
            versionEsperada: 7,
            motivo: "Mora",
          }),
        ),
      ).toBe("VERSION_DESACTUALIZADA");
      expect(
        error(
          await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
            cuentaId: randomUUID(),
            versionEsperada: 1,
            motivo: "Mora",
          }),
        ),
      ).toBe("CUENTA_NO_ENCONTRADA");
      expect(
        error(
          await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
            cuentaId: "no-es-un-uuid",
            versionEsperada: 1,
            motivo: "Mora",
          }),
        ),
      ).toBe("CUENTA_NO_ENCONTRADA");
      expect(await fichaEnBase(cuenta.id)).toMatchObject({ estado: "HABILITADA", version: 1 });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_SUSPENDIDA", cuenta.id)).toBe(0);
    });

    it("reactivar vuelve a exigir que el cliente pueda deber: con la parte inactiva, PARTE_NO_ACTIVA y la cuenta sigue suspendida", async () => {
      const { cuenta, parte } = await habilitada();
      exito(
        await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Pagos vencidos",
        }),
      );
      await dueno.query("update parte set estado = 'INACTIVA' where id = $1", [parte]);
      expect(
        error(
          await cc.casos.reactivarCuentaDelCliente(m.ctx(), {
            cuentaId: cuenta.id,
            versionEsperada: 2,
          }),
        ),
      ).toBe("PARTE_NO_ACTIVA");
      expect(await fichaEnBase(cuenta.id)).toMatchObject({ estado: "SUSPENDIDA", version: 2 });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_REACTIVADA", cuenta.id)).toBe(0);
    });

    it("repetir el cambio de condiciones ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const { cuenta } = await habilitada();
      const cambio = { cuentaId: cuenta.id, versionEsperada: 1, plazoDias: 60, limite: "500000" };
      const primera = exito(await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), cambio));
      expect(primera).toMatchObject({
        sinCambios: false,
        cuenta: { plazoDias: 60, limite: { moneda: "ARS", monto: "500000.00" }, version: 2 },
      });
      const segunda = exito(await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), cambio));
      expect(segunda).toMatchObject({ sinCambios: true, cuenta: { plazoDias: 60, version: 2 } });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS", cuenta.id)).toBe(1);
      expect(await fichaEnBase(cuenta.id)).toMatchObject({
        version: 2,
        plazo_dias: 60,
        limite: "500000.00",
      });
      const [constancia] = await filas<{ antes: unknown; despues: unknown }>(
        "select antes, despues from auditoria_empresa where accion = 'CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS' and entidad_id = $1",
        [cuenta.id],
      );
      expect(constancia).toEqual({
        antes: { plazoDias: 30, limite: "100000.00" },
        despues: { plazoDias: 60, limite: "500000.00" },
      });
    });

    it("cambiar condiciones valida, controla la versión y no toca nada si falla; también se puede con la cuenta suspendida", async () => {
      const { cuenta } = await habilitada();
      const cambio = { cuentaId: cuenta.id, versionEsperada: 1, plazoDias: 90, limite: "1" };
      expect(
        error(await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), { ...cambio, plazoDias: 0 })),
      ).toBe("PLAZO_INVALIDO");
      expect(
        error(await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), { ...cambio, limite: "-5" })),
      ).toBe("LIMITE_INVALIDO");
      expect(
        error(
          await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), { ...cambio, versionEsperada: 9 }),
        ),
      ).toBe("VERSION_DESACTUALIZADA");
      expect(
        error(
          await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), {
            ...cambio,
            cuentaId: randomUUID(),
          }),
        ),
      ).toBe("CUENTA_NO_ENCONTRADA");
      expect(await fichaEnBase(cuenta.id)).toMatchObject({
        version: 1,
        plazo_dias: 30,
        limite: "100000.00",
      });
      exito(
        await cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Mora",
        }),
      );
      const sobreSuspendida = exito(
        await cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), { ...cambio, versionEsperada: 2 }),
      );
      expect(sobreSuspendida.cuenta).toMatchObject({
        estado: "SUSPENDIDA",
        plazoDias: 90,
        version: 3,
      });
    });
  });

  describe("aislamiento entre empresas", () => {
    it("la empresa B no ve, suspende, reactiva ni cambia la ficha de A: para ella no existe", async () => {
      const { cuenta, parte } = await habilitada(m);
      const deB = otra.ctx();
      expect(
        error(
          await cc.casos.suspenderCuentaDelCliente(deB, {
            cuentaId: cuenta.id,
            versionEsperada: 1,
            motivo: "Mora",
          }),
        ),
      ).toBe("CUENTA_NO_ENCONTRADA");
      expect(
        error(
          await cc.casos.reactivarCuentaDelCliente(deB, {
            cuentaId: cuenta.id,
            versionEsperada: 1,
          }),
        ),
      ).toBe("CUENTA_NO_ENCONTRADA");
      expect(
        error(
          await cc.casos.cambiarCondicionesDeLaCuenta(deB, {
            cuentaId: cuenta.id,
            versionEsperada: 1,
            plazoDias: 60,
            limite: "1",
          }),
        ),
      ).toBe("CUENTA_NO_ENCONTRADA");
      expect(error(await cc.consultas.verCuentaDelCliente(deB, { parteId: parte }))).toBe(
        "CUENTA_NO_ENCONTRADA",
      );
      expect(await fichaEnBase(cuenta.id)).toMatchObject({
        estado: "HABILITADA",
        version: 1,
        plazo_dias: 30,
      });
    });
  });

  describe("autorización: el servidor decide y el guard va primero", () => {
    const sinTocarElRepositorio = () => {
      const espiado = crearEntornoDeCuentaCorriente(
        propia.base,
        2,
        (tx: TxDeCuentaCorrienteDePrueba) => ({
          ...tx,
          cuentasDeClientes: new Proxy(tx.cuentasDeClientes, {
            get: (objetivo, propiedad, receptor) => {
              llamadasAlRepositorio.push(String(propiedad));
              return Reflect.get(objetivo, propiedad, receptor) as unknown;
            },
          }),
        }),
      );
      return { espiado, casos: armarCuentaCorriente(espiado) };
    };

    it("el operador (el cajero) no habilita, suspende, reactiva ni cambia, ni ve: SIN_PERMISO, y ni se consulta el repositorio", async () => {
      const { cuenta, parte } = await habilitada();
      const operador = await sumarPersonaDeCuentaCorriente(dueno, m, "OPERADOR");
      const { espiado, casos } = sinTocarElRepositorio();
      try {
        llamadasAlRepositorio.length = 0;
        expect(
          error(await habilitar(await cliente(), { ctx: operador(), casos: casos.casos })),
        ).toBe("SIN_PERMISO");
        expect(
          error(
            await casos.casos.suspenderCuentaDelCliente(operador(), {
              cuentaId: cuenta.id,
              versionEsperada: 1,
              motivo: "Mora",
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          error(
            await casos.casos.reactivarCuentaDelCliente(operador(), {
              cuentaId: cuenta.id,
              versionEsperada: 1,
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          error(
            await casos.casos.cambiarCondicionesDeLaCuenta(operador(), {
              cuentaId: cuenta.id,
              versionEsperada: 1,
              plazoDias: 60,
              limite: "1",
            }),
          ),
        ).toBe("SIN_PERMISO");
        expect(
          error(await casos.consultas.verCuentaDelCliente(operador(), { parteId: parte })),
        ).toBe("SIN_PERMISO");
        expect(llamadasAlRepositorio).toEqual([]);
      } finally {
        await espiado.cerrar();
      }
      expect(await fichaEnBase(cuenta.id)).toMatchObject({ estado: "HABILITADA", version: 1 });
    });

    it("el administrador y el gerente pueden; una persona de otra empresa o sin membresía no", async () => {
      const administrador = await sumarPersonaDeCuentaCorriente(dueno, m, "ADMINISTRADOR");
      exito(await habilitar(await cliente(), { ctx: administrador() }));
      exito(await habilitar(await cliente(), { ctx: m.ctx() }));
      // La persona de la empresa B actuando con el contexto de B sobre un cliente de A: la parte no existe para B.
      expect(error(await habilitar(await cliente(m), { ctx: otra.ctx() }))).toBe(
        "PARTE_NO_ENCONTRADA",
      );
      const ajena = { ...m.ctx(), personaId: otra.persona };
      // Sin membresía en esta empresa no hay rol ni módulos: el guard rechaza (el módulo no figura activo para quien no es de la empresa).
      expect(["SIN_PERMISO", "MODULO_NO_ACTIVO"]).toContain(
        error(await habilitar(await cliente(), { ctx: ajena })),
      );
    });

    it("con el catálogo real el módulo está en desarrollo: todos los roles reciben MODULO_EN_DESARROLLO (cerrado hasta la pantalla)", async () => {
      const reales: ReglasDeEmpresa = {
        catalogo: CATALOGO_DE_MODULOS,
        permisos: PERMISOS_DE_EMPRESA,
      };
      const real = armarCuentaCorriente(entorno, reales);
      expect(error(await habilitar(await cliente(), { casos: real.casos }))).toBe(
        "MODULO_EN_DESARROLLO",
      );
      expect(
        error(await real.consultas.verCuentaDelCliente(m.ctx(), { parteId: randomUUID() })),
      ).toBe("MODULO_EN_DESARROLLO");
    });

    it("sin el módulo activado en la empresa, MODULO_NO_ACTIVO", async () => {
      const sinModulo = await crearMundoDeCuentaCorriente(entornoBase, dueno, {
        plan: ["cuenta_corriente"],
        activados: [],
      });
      expect(error(await habilitar(await cliente(sinModulo), { ctx: sinModulo.ctx() }))).toBe(
        "MODULO_NO_ACTIVO",
      );
    });

    it("un rol con la acción delegada puede administrar aunque sea operador; sin la acción, no (el conjunto de acciones es el que decide)", async () => {
      const delegado = await sumarPersonaDeCuentaCorriente(dueno, m, "OPERADOR");
      const conAccion = (acciones: readonly string[]) =>
        crearEntornoDeCuentaCorriente(propia.base, 2, (tx: TxDeCuentaCorrienteDePrueba) => ({
          ...tx,
          autorizacion: {
            ...tx.autorizacion,
            delActor: async (contexto) => ({
              ...(await tx.autorizacion.delActor(contexto)),
              acciones,
            }),
          },
        }));
      const si = conAccion(["cuenta_corriente.administrar", "cuenta_corriente.ver"]);
      const no = conAccion(["cuenta_corriente.ver"]);
      try {
        const casosSi = armarCuentaCorriente(si);
        const casosNo = armarCuentaCorriente(no);
        expect(
          error(await habilitar(await cliente(), { ctx: delegado(), casos: casosNo.casos })),
        ).toBe("SIN_PERMISO");
        exito(await habilitar(await cliente(), { ctx: delegado(), casos: casosSi.casos }));
      } finally {
        await si.cerrar();
        await no.cerrar();
      }
    });
  });

  describe("verCuentaDelCliente: saldo y disponible desde el libro", () => {
    const cargo = async (
      parte: string,
      monto: string,
      mundo: MundoDeCuentaCorriente = m,
      centro = sucursal,
    ) => {
      const contexto = { ...mundo.ctx(), ahora: new Date("2026-11-21T15:00:00Z") };
      const importe = importeDesdeTexto(ARS, monto);
      const r = await entornoDelLibro.ejecutar({ contexto, aislamiento: "serializable" }, (tx) =>
        registrarAsientoEnTx(tx, contexto, {
          parteId: parte,
          sentido: "A_COBRAR",
          clase: monto.startsWith("-") ? "COBRANZA" : "CARGO_DE_VENTA_A_CUENTA",
          importe,
          origen: {
            tipo: monto.startsWith("-") ? "cobranzas.cobro" : "ventas.cargo",
            id: randomUUID(),
          },
          clave: randomUUID(),
          hechoEn: new Date("2026-11-21T12:00:00Z"),
          distribucion: [{ centroDeCosto: centro, importe }],
        }),
      );
      exito(r);
    };

    it("disponible = límite − saldo, sin mezclar el saldo de otro cliente de la misma empresa ni de otra empresa", async () => {
      const { cuenta, parte } = await habilitada();
      const { parte: vecino } = await habilitada();
      await cargo(parte, "30000.25");
      await cargo(vecino, "99999.00"); // otro cliente de la misma empresa
      const vista = exito(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: parte }));
      expect(vista).toMatchObject({
        cuenta: { id: cuenta.id, limite: { moneda: "ARS", monto: "100000.00" } },
        saldo: { moneda: "ARS", monto: "30000.25" },
        disponible: { moneda: "ARS", monto: "69999.75" },
        excedido: false,
      });
    });

    it("sin movimientos el saldo es cero y el disponible es el límite; una cobranza baja el saldo", async () => {
      const { parte } = await habilitada();
      expect(
        exito(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: parte })),
      ).toMatchObject({
        saldo: { monto: "0.00" },
        disponible: { monto: "100000.00" },
        excedido: false,
      });
      await cargo(parte, "40000.00");
      await cargo(parte, "-15000.50");
      expect(
        exito(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: parte })),
      ).toMatchObject({
        saldo: { monto: "24999.50" },
        disponible: { monto: "75000.50" },
      });
    });

    it("con el saldo por encima del límite el disponible es cero y figura excedido; con el saldo igual al límite, no", async () => {
      const parte = await cliente();
      exito(await habilitar(parte, { limite: "1000" }));
      await cargo(parte, "1000.00");
      expect(
        exito(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: parte })),
      ).toMatchObject({
        saldo: { monto: "1000.00" },
        disponible: { monto: "0.00" },
        excedido: false,
      });
      await cargo(parte, "0.01");
      expect(
        exito(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: parte })),
      ).toMatchObject({
        saldo: { monto: "1000.01" },
        disponible: { monto: "0.00" },
        excedido: true,
      });
    });

    it("una parte sin ficha (o que no es un UUID) es CUENTA_NO_ENCONTRADA, aunque tenga saldo", async () => {
      const sinFicha = await cliente();
      await cargo(sinFicha, "10.00");
      expect(error(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: sinFicha }))).toBe(
        "CUENTA_NO_ENCONTRADA",
      );
      expect(
        error(await cc.consultas.verCuentaDelCliente(m.ctx(), { parteId: "no-es-un-uuid" })),
      ).toBe("CUENTA_NO_ENCONTRADA");
    });

    it("la clase CREDITO_A_FAVOR de A_COBRAR no está sembrada: el libro la rechaza (una clase no sembrada no se usa)", async () => {
      const parte = await cliente();
      const contexto = m.ctx();
      const importe = importeDesdeTexto(ARS, "-10");
      const r = await entornoDelLibro.ejecutar({ contexto, aislamiento: "serializable" }, (tx) =>
        registrarAsientoEnTx(tx, contexto, {
          parteId: parte,
          sentido: "A_COBRAR",
          clase: "CREDITO_A_FAVOR",
          importe,
          origen: { tipo: "ventas.credito", id: randomUUID() },
          clave: randomUUID(),
          hechoEn: new Date("2026-11-21T12:00:00Z"),
          distribucion: [{ centroDeCosto: sucursal, importe }],
        }),
      );
      expect(r.ok).toBe(false);
    });
  });

  describe("concurrencia: dos actores a la vez", () => {
    it("dos habilitaciones simultáneas del mismo cliente con claves distintas: una gana y la otra recibe YA_HABILITADA, con una ficha y una auditoría", async () => {
      const parte = await cliente();
      const [a, b] = await Promise.all([habilitar(parte), habilitar(parte, { plazoDias: 60 })]);
      const resultados = [a, b];
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual([
        "YA_HABILITADA",
      ]);
      expect(await fichasDe(parte)).toBe(1);
      const [ficha] = await filas<{ id: string }>(
        "select id from cuenta_del_cliente where parte_id = $1",
        [parte],
      );
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", ficha?.id)).toBe(1);
    });

    it("dos habilitaciones simultáneas con la misma clave y el mismo pedido (doble clic): las dos responden con la misma ficha y queda una sola", async () => {
      const parte = await cliente();
      const k = clave();
      const [a, b] = await Promise.all([
        habilitar(parte, { clave: k }),
        habilitar(parte, { clave: k }),
      ]);
      const fichas = [exito(a), exito(b)];
      expect(new Set(fichas.map((f) => f.cuenta.id)).size).toBe(1);
      expect(fichas.filter((f) => f.yaExistia)).toHaveLength(1);
      expect(await fichasDe(parte)).toBe(1);
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_HABILITADA", fichas[0]?.cuenta.id)).toBe(1);
    });

    it("dos cambios de condiciones simultáneos con la misma versión: uno gana y el otro recibe VERSION_DESACTUALIZADA", async () => {
      const { cuenta } = await habilitada();
      const [a, b] = await Promise.all([
        cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          plazoDias: 60,
          limite: "1",
        }),
        cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          plazoDias: 90,
          limite: "2",
        }),
      ]);
      const resultados = [a, b];
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual([
        "VERSION_DESACTUALIZADA",
      ]);
      expect(await fichaEnBase(cuenta.id)).toMatchObject({ version: 2 });
      expect(await auditorias(m, "CUENTA_DEL_CLIENTE_CONDICIONES_CAMBIADAS", cuenta.id)).toBe(1);
    });

    it("suspender y cambiar el límite a la vez: gana uno, el otro VERSION_DESACTUALIZADA, y la ficha queda coherente", async () => {
      const { cuenta } = await habilitada();
      const [a, b] = await Promise.all([
        cc.casos.suspenderCuentaDelCliente(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          motivo: "Pagos vencidos",
        }),
        cc.casos.cambiarCondicionesDeLaCuenta(m.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: 1,
          plazoDias: 30,
          limite: "5",
        }),
      ]);
      const resultados = [a, b];
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual([
        "VERSION_DESACTUALIZADA",
      ]);
      const final = await fichaEnBase(cuenta.id);
      expect(final?.version).toBe(2);
      // El CHECK de suspensión se cumple: suspendida con motivo, o habilitada sin él.
      expect(final?.estado === "SUSPENDIDA").toBe(final?.motivo_de_suspension !== null);
    });
  });

  describe("el mapa de restricciones", () => {
    it("tiene exactamente las restricciones de la tabla y las que lanza su disparador: no falta ni sobra ninguna", async () => {
      const deLaTabla = await filas<{ nombre: string }>(
        "select conname as nombre from pg_constraint where conrelid = 'public.cuenta_del_cliente'::regclass",
      );
      const delDisparador = [
        "cuenta_cliente_parte_no_activa",
        "cuenta_cliente_sin_rol_cliente",
        "cuenta_cliente_sin_cuit",
        "cuenta_cliente_identidad_inmutable",
      ];
      const reales = [...deLaTabla.map((f) => f.nombre), ...delDisparador].sort();
      expect(Object.keys(ERRORES_DE_CUENTA_CORRIENTE_POR_RESTRICCION).sort()).toEqual(reales);
    });

    it("cada restricción que lanza el disparador figura en el código de la función de la base", async () => {
      const [{ src }] = (await filas<{ src: string }>(
        "select prosrc as src from pg_proc where proname = 'cuenta_del_cliente_validar'",
      )) as [{ src: string }];
      for (const nombre of [
        "cuenta_cliente_parte_no_activa",
        "cuenta_cliente_sin_rol_cliente",
        "cuenta_cliente_sin_cuit",
        "cuenta_cliente_identidad_inmutable",
        "cuenta_cliente_parte_fkey",
      ]) {
        expect(src, nombre).toContain(nombre);
      }
    });
  });
});
