import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  TRABAJO_PARTE_ANONIMIZADA,
  claveDeParteAnonimizada,
} from "../../src/modulos/clientes/publico";
import {
  crearRepositorioDeAsientos,
  crearRepositorioDeImputaciones,
  crearRepositorioDeSaldos,
  registrarAsientoEnTx,
  type SaldosDb,
  type TxDeSaldos,
} from "../../src/modulos/saldos_de_partes/publico";
import { importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { codigoDe } from "./concurrencia-apoyo";
import {
  montarClientes,
  nombreUnico,
  nuevoId,
  valorDe,
  RONDAS,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";
import {
  armarCuentaCorriente,
  crearEntornoDeCuentaCorriente,
  crearMundoDeCuentaCorriente,
  type MundoDeCuentaCorriente,
} from "./cuenta-corriente-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Anonimizar una parte (derecho de supresión; dueño, 25/11/2026) contra la base real y con el libro de saldos real: solo el gerente, motivo cerrado, todo lo personal vacío
 * en UNA transacción, auditoría y aviso SIN datos de la parte, saldo distinto de cero impide, idempotencia, concurrencia de DOS actores (dos anonimizaciones; contra un asiento
 * de saldo), atomicidad con falla inyectada, aislamiento entre empresas y el respaldo de la base (cargo y piso).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const MOTIVO = "PEDIDO_DEL_TITULAR";
const CARGO = "CARGO_DE_FACTURA_DE_COMPRA";
const PAGO = "PAGO_A_PROVEEDOR";
const PERSONALES = [
  "nombre",
  "apellido",
  "alias",
  "documento_tipo",
  "documento_pais",
  "documento_numero",
  "condicion_iva",
  "email",
  "telefono",
  "dom_pais",
  "dom_calle",
  "dom_numero",
  "dom_piso",
  "dom_departamento",
  "dom_localidad",
  "dom_provincia",
  "dom_codigo_postal",
  "dom_texto",
  "nota",
] as const;
const IMPEDIDA = {
  error: "ANONIMIZACION_IMPEDIDA",
  impedimentos: [{ modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" }],
};

describe.skipIf(base === null)("clientes: anonimizar una parte", () => {
  let c: MontajeDeClientes;
  let e: EscenarioDeClientes;
  let libro: ReturnType<typeof crearLibro>;
  let centro: string;
  let otroCentro: string;

  const crearLibro = (url: string, clave: NonNullable<typeof base>["clave"]) =>
    crearTransacciones<TxDeSaldos>({
      urls: { OPERATIVO: url },
      armar: (db) => {
        const t = db.withTables<SaldosDb & AuditoriaDb>();
        return {
          asientos: crearRepositorioDeAsientos(t),
          imputaciones: crearRepositorioDeImputaciones(t),
          saldos: crearRepositorioDeSaldos(t),
          auditoria: crearAuditoriaDePostgres(t),
        };
      },
      maximoDeConexiones: 8,
      clave,
    });

  beforeAll(async () => {
    if (base === null) return;
    c = await montarClientes(base);
    e = await c.escenario();
    libro = crearLibro(c.propia.base.app, c.propia.base.clave);
    const sucursal = async (nombre: string) =>
      String(
        (
          await c.filas<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
            [e.empresa, nombre],
          )
        )[0]?.id,
      );
    centro = await sucursal("Central");
    otroCentro = await sucursal("Sur");
  });
  afterAll(async () => {
    if (base === null) return;
    await libro.cerrar();
    await c.cerrar();
  });

  // ---- apoyo ----------------------------------------------------------------------------------
  const persona = async (extra: Record<string, unknown> = {}) =>
    valorDe(
      await c.casos.crearParte(e.operador, {
        idempotencia: nuevoId(),
        naturaleza: "HUMANA",
        nombre: nombreUnico("Ramón"),
        apellido: "Quiroga",
        alias: "El Gaucho",
        documento: { tipo: "DNI", numero: String(10_000_000 + numeroUnico()) },
        condicionIva: "CONSUMIDOR_FINAL",
        email: "quiroga.privado@correo.com",
        telefono: "+54 11 4555-0199",
        domicilio: {
          pais: "AR",
          estructurado: { calle: "Mitre", numero: "1234", localidad: "Rosario", provincia: "AR-S" },
        },
        nota: "Pide factura A siempre",
        roles: ["CUSTOMER", "PROVEEDOR"],
        ...extra,
      }),
    ).parteId;
  const empresa = async () =>
    valorDe(
      await c.casos.crearParte(e.operador, {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: nombreUnico("Empresa"),
        documento: { tipo: "CUIT", numero: cuitUnico() },
        roles: ["PROVEEDOR"],
      }),
    ).parteId;
  const fila = async (id: string) =>
    (await c.filas("select * from parte where id = $1", [id]))[0] ?? null;
  const anonimizar = (parteId: string, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.casos.anonimizarParte(quien, { parteId, motivo: MOTIVO, ...extra });
  const auditadas = (id: string) =>
    c.filas(
      "select * from auditoria_empresa where entidad_id = $1 and accion = 'PARTE_ANONIMIZADA'",
      [id],
    );
  const avisos = (id: string) =>
    c.filas("select * from trabajo where empresa_id = $1 and clave_idempotencia = $2", [
      e.empresa,
      claveDeParteAnonimizada(id),
    ]);
  const roles = (id: string) =>
    c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [id]);
  const vinculos = (id: string) =>
    c.filas(
      "select parte_id, de_parte_id, cargo, activo from parte_vinculo where parte_id = $1 or de_parte_id = $1",
      [id],
    );
  const asentar = (parteId: string, clase: string, importe: string, donde = centro) => {
    const contexto: ContextoOperativo = { ...e.gerente, ahora: new Date() };
    const i = importeDesdeTexto(ARS, importe);
    return libro.ejecutar({ contexto }, (tx) =>
      registrarAsientoEnTx(tx, contexto, {
        parteId,
        sentido: "A_PAGAR",
        clase,
        importe: i,
        origen: { tipo: "compras.asiento", id: randomUUID() },
        clave: randomUUID(),
        hechoEn: new Date("2026-11-25T12:00:00Z"),
        distribucion: [{ centroDeCosto: donde, importe: i }],
      }),
    );
  };
  const saldoDe = async (id: string) =>
    String(
      (
        await c.filas<{ s: string }>(
          "select coalesce(sum(saldo), 0)::text as s from saldo_de_parte where parte_id = $1",
          [id],
        )
      )[0]?.s,
    );
  const intacta = async (id: string) => {
    expect(await fila(id)).toMatchObject({ estado: "ACTIVA" });
    expect(await roles(id)).toEqual([
      { rol: "CUSTOMER", activo: true },
      { rol: "PROVEEDOR", activo: true },
    ]);
    expect(await auditadas(id)).toEqual([]);
    expect(await avisos(id)).toEqual([]);
  };

  // ---- permisos y motivo ----------------------------------------------------------------------
  it("solo el gerente anonimiza (guard primero: ni se miran las copias); el motivo es de una lista cerrada", async () => {
    const id = await persona();
    const llamadas: string[] = [];
    c.pasosDeCopias.push((_, parteId) => {
      llamadas.push(parteId);
      return Promise.resolve(ok(null));
    });
    try {
      for (const quien of [e.administrador, e.operador]) {
        expect(await anonimizar(id, {}, quien)).toEqual({ ok: false, error: "SIN_PERMISO" });
      }
      for (const motivo of ["", "pedido_del_titular", "OTRO", "__proto__"]) {
        expect(await anonimizar(id, { motivo })).toEqual({
          ok: false,
          error: "MOTIVO_DE_ANONIMIZACION_INVALIDO",
        });
      }
      expect(llamadas).toEqual([]);
      await intacta(id);
      valorDe(await anonimizar(id, { motivo: "BAJA_DE_EMPRESA" }));
      expect(llamadas).toEqual([id]);
    } finally {
      c.pasosDeCopias.length = 0;
    }
  });

  // ---- anonimizar -----------------------------------------------------------------------------
  it("vacía TODO lo personal, apaga roles y vínculos con su cargo, libera el documento y la saca de la búsqueda; auditoría y aviso sin datos", async () => {
    const nombre = nombreUnico("Zulema");
    const documento = { tipo: "DNI", numero: "31.222.333" };
    const id = await persona({ nombre, documento });
    const jefa = await empresa();
    valorDe(
      await c.casos.vincularContacto(e.operador, {
        contactoId: id,
        deParteId: jefa,
        tipo: "CONTACTO",
        cargo: "Gerente comercial",
      }),
    );
    const antes = await fila(id);
    const buscar = async (texto: string) =>
      valorDe(await c.consultas.buscarPartes(e.gerente, { texto })).partes.map((p) => p.id);
    expect(await buscar(nombre)).toContain(id);

    expect(valorDe(await anonimizar(id, { conReferenciaDelPedido: true }))).toEqual({
      yaEstabaAnonimizada: false,
    });

    const despues = await fila(id);
    expect(despues).toMatchObject({ id, estado: "ANONIMIZADA", naturaleza: "HUMANA" });
    for (const columna of PERSONALES) expect(despues?.[columna], columna).toBeNull();
    expect(despues?.["anonimizada_en"]).toBeInstanceOf(Date);
    expect(Number(despues?.["version"])).toBeGreaterThan(Number(antes?.["version"]));
    expect(await roles(id)).toEqual([
      { rol: "CUSTOMER", activo: false },
      { rol: "PROVEEDOR", activo: false },
    ]);
    expect(await vinculos(id)).toEqual([
      { parte_id: id, de_parte_id: jefa, cargo: null, activo: false },
    ]);
    expect(await fila(jefa)).toMatchObject({ estado: "ACTIVA" });
    // El documento queda libre; la anonimizada no sale en la búsqueda; la ficha no devuelve nada personal.
    expect(await persona({ documento })).not.toBe(id);
    expect(await buscar(nombre)).not.toContain(id);
    expect(valorDe(await c.consultas.fichaDeParte(e.gerente, { parteId: id }))).toMatchObject({
      nombre: null,
      documento: null,
      email: null,
      activa: false,
      roles: [],
      vinculos: [],
    });

    const registros = await auditadas(id);
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      actor_persona_id: e.gerente.personaId,
      entidad: "parte",
      antes: { estado: "ACTIVA" },
      despues: {
        estado: "ANONIMIZADA",
        motivo: MOTIVO,
        conReferenciaDelPedido: true,
        rolesApagados: 2,
        vinculosApagados: 1,
      },
    });
    const trabajos = await avisos(id);
    expect(trabajos).toMatchObject([
      { tipo: TRABAJO_PARTE_ANONIMIZADA, datos: { parteId: id }, estado: "PENDIENTE" },
    ]);
    const guardado = JSON.stringify([registros, trabajos]);
    for (const dato of [
      nombre,
      "Quiroga",
      "quiroga.privado",
      "4555",
      "Gerente comercial",
      "Mitre",
    ]) {
      expect(guardado, dato).not.toContain(dato);
    }
  });

  it("una parte desactivada también se anonimiza", async () => {
    const id = await persona();
    valorDe(await c.casos.desactivarParte(e.gerente, { parteId: id }));
    valorDe(await anonimizar(id));
    expect((await auditadas(id))[0]?.["antes"]).toEqual({ estado: "INACTIVA" });
    expect(await fila(id)).toMatchObject({ estado: "ANONIMIZADA", nombre: null });
  });

  it("una parte inexistente, con un id que no es uno o de otra empresa es PARTE_NO_ENCONTRADA y no se toca", async () => {
    const otra = await c.escenario();
    const ajena = valorDe(
      await c.casos.crearParte(otra.operador, {
        idempotencia: nuevoId(),
        naturaleza: "HUMANA",
        nombre: nombreUnico("Ajena"),
        roles: ["CUSTOMER"],
      }),
    ).parteId;
    const antes = await fila(ajena);
    for (const parteId of [ajena, randomUUID(), "no-es-un-id"]) {
      expect(await anonimizar(parteId)).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
    }
    expect(await fila(ajena)).toEqual(antes);
    expect(valorDe(await anonimizar(ajena, {}, otra.gerente))).toEqual({
      yaEstabaAnonimizada: false,
    });
  });

  // ---- saldo ----------------------------------------------------------------------------------
  it("saldo distinto de cero impide (en contra, a favor, o en un centro aunque el total sea cero) sin cambiar nada; al saldar se puede", async () => {
    const enContra = await persona();
    expect((await asentar(enContra, CARGO, "100.00")).ok).toBe(true);
    expect(await anonimizar(enContra)).toEqual({ ok: false, error: IMPEDIDA });
    await intacta(enContra);
    expect((await asentar(enContra, PAGO, "-100.00")).ok).toBe(true);
    expect(await saldoDe(enContra)).toBe("0.00");
    expect(valorDe(await anonimizar(enContra))).toEqual({ yaEstabaAnonimizada: false });

    const aFavor = await persona();
    expect((await asentar(aFavor, PAGO, "-40.00")).ok).toBe(true);
    expect(await anonimizar(aFavor)).toEqual({ ok: false, error: IMPEDIDA });
    await intacta(aFavor);

    const porCentro = await persona();
    expect((await asentar(porCentro, CARGO, "100.00", centro)).ok).toBe(true);
    expect((await asentar(porCentro, PAGO, "-100.00", otroCentro)).ok).toBe(true);
    expect(await saldoDe(porCentro)).toBe("0.00");
    expect(await anonimizar(porCentro)).toEqual({ ok: false, error: IMPEDIDA });
    await intacta(porCentro);
  });

  it("falla CERRADO: si no se puede leer el libro de saldos no se anonimiza ni cambia nada", async () => {
    const id = await persona();
    await c.dueno.query("revoke select on saldo_de_parte from pedernal_app");
    try {
      const r = await anonimizar(id).catch((error: unknown) => ({ ok: false, error }));
      expect(r.ok).toBe(false);
    } finally {
      await c.dueno.query("grant select on saldo_de_parte to pedernal_app");
    }
    await intacta(id);
    expect(valorDe(await anonimizar(id))).toEqual({ yaEstabaAnonimizada: false });
  });

  // ---- idempotencia, concurrencia, atomicidad -------------------------------------------------
  it("I1: anonimizar dos veces es ok y la segunda no escribe, no audita y no encola otro aviso", async () => {
    const id = await persona();
    valorDe(await anonimizar(id));
    const despues = await fila(id);
    for (let i = 0; i < 2; i++) {
      expect(valorDe(await anonimizar(id, { motivo: "BAJA_DE_EMPRESA" }))).toEqual({
        yaEstabaAnonimizada: true,
      });
    }
    expect(await fila(id)).toEqual(despues);
    expect(await auditadas(id)).toHaveLength(1);
    expect(await avisos(id)).toHaveLength(1);
    expect((await auditadas(id))[0]?.["despues"]).toMatchObject({ motivo: MOTIVO });
  });

  it("dos anonimizaciones a la vez: una anonimiza y la otra ve que ya estaba; una auditoría y un aviso", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const id = await persona();
      const [a, b] = await Promise.all([anonimizar(id), anonimizar(id)]);
      expect(
        [codigoDe(a), codigoDe(b)].every((x) => x === "ok" || x === "ConcurrenciaAgotada"),
      ).toBe(true);
      const dicen = [a, b].flatMap((r) => (r.ok ? [r.valor.yaEstabaAnonimizada] : []));
      expect(dicen.filter((x) => !x)).toHaveLength(1);
      expect(await auditadas(id)).toHaveLength(1);
      expect(await avisos(id)).toHaveLength(1);
    }
  });

  it("anonimizar contra un asiento de saldo a la vez: o entra el asiento y queda impedida, o se anonimiza y el asiento falla; nunca anonimizada con saldo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const id = await persona();
      const [a, asiento] = await Promise.all([anonimizar(id), asentar(id, CARGO, "100.00")]);
      if ((await fila(id))?.["estado"] === "ANONIMIZADA") {
        expect([a.ok, asiento.ok]).toEqual([true, false]);
        expect(Number(await saldoDe(id))).toBe(0);
        for (const columna of PERSONALES) expect((await fila(id))?.[columna], columna).toBeNull();
      } else {
        expect(asiento.ok).toBe(true);
        expect(a).toMatchObject({ ok: false, error: { error: "ANONIMIZACION_IMPEDIDA" } });
        expect(await saldoDe(id)).toBe("100.00");
        await intacta(id);
      }
    }
  });

  it("si falla el paso de copias de otro módulo no queda nada (ni datos, roles, vínculos, auditoría ni aviso); el paso se llama una vez con la hora del contexto", async () => {
    const id = await persona();
    const jefa = await empresa();
    valorDe(
      await c.casos.vincularContacto(e.operador, {
        contactoId: id,
        deParteId: jefa,
        tipo: "AGENTE_DE",
        cargo: "Compras",
      }),
    );
    const antes = await fila(id);
    const falla = { tipo: "Inesperado", sqlstate: null, mensaje: "falla inyectada" } as const;
    c.pasosDeCopias.push(() => Promise.resolve(err(falla)));
    try {
      expect(await anonimizar(id)).toEqual({ ok: false, error: falla });
    } finally {
      c.pasosDeCopias.length = 0;
    }
    expect(await fila(id)).toEqual(antes);
    await intacta(id);

    const vistas: unknown[] = [];
    c.pasosDeCopias.push((empresa, parteId, ahora) => {
      vistas.push([empresa, parteId, ahora.toISOString()]);
      return Promise.resolve(ok(null));
    });
    try {
      valorDe(await anonimizar(id));
      valorDe(await anonimizar(id));
    } finally {
      c.pasosDeCopias.length = 0;
    }
    expect(vistas).toEqual([[e.empresa, id, e.gerente.ahora.toISOString()]]);
  });

  // ---- cuenta corriente de clientes (CC-1): cualquier ficha impide ------------------------------
  describe("cuenta corriente del cliente", () => {
    let mundo: MundoDeCuentaCorriente;
    let entornoCC: ReturnType<typeof crearEntornoDeCuentaCorriente>;
    let cc: ReturnType<typeof armarCuentaCorriente>;
    beforeAll(async () => {
      mundo = await crearMundoDeCuentaCorriente(c.entorno, c.dueno);
      entornoCC = crearEntornoDeCuentaCorriente(c.propia.base);
      cc = armarCuentaCorriente(entornoCC);
    });
    afterAll(async () => {
      await entornoCC.cerrar();
    });
    const cliente = async () =>
      valorDe(
        await c.casos.crearParte(mundo.ctx(), {
          idempotencia: nuevoId(),
          naturaleza: "JURIDICA",
          nombre: nombreUnico("Cliente"),
          documento: { tipo: "CUIT", numero: cuitUnico() },
          roles: ["CUSTOMER"],
        }),
      ).parteId;
    const habilitar = (parteId: string) =>
      cc.casos.habilitarCuentaDelCliente(mundo.ctx(), {
        claveDeIdempotencia: randomUUID(),
        parteId,
        plazoDias: 30,
        limite: "1000.00",
      });
    const IMPEDIDA_POR_CUENTA = {
      error: "ANONIMIZACION_IMPEDIDA",
      impedimentos: [{ modulo: "cuenta_corriente", motivo: "CUENTA_CORRIENTE_DEL_CLIENTE" }],
    };
    const fichas = (id: string) =>
      c.contar("select count(*) as n from cuenta_del_cliente where parte_id = $1", [id]);

    it("una ficha HABILITADA impide anonimizar, y también una SUSPENDIDA; la ficha y la parte no cambian", async () => {
      const id = await cliente();
      const { cuenta } = valorDe(await habilitar(id));
      expect(await c.casos.anonimizarParte(mundo.ctx(), { parteId: id, motivo: MOTIVO })).toEqual({
        ok: false,
        error: IMPEDIDA_POR_CUENTA,
      });
      valorDe(
        await cc.casos.suspenderCuentaDelCliente(mundo.ctx(), {
          cuentaId: cuenta.id,
          versionEsperada: cuenta.version,
          motivo: "Pidió pausar la cuenta",
        }),
      );
      expect(await c.casos.anonimizarParte(mundo.ctx(), { parteId: id, motivo: MOTIVO })).toEqual({
        ok: false,
        error: IMPEDIDA_POR_CUENTA,
      });
      expect(await fila(id)).toMatchObject({ estado: "ACTIVA" });
      expect(
        await c.filas("select estado from cuenta_del_cliente where parte_id = $1", [id]),
      ).toEqual([{ estado: "SUSPENDIDA" }]);
      expect(await auditadas(id)).toEqual([]);
    });

    it("anonimizar contra habilitar la ficha a la vez: gana uno; nunca una anonimizada con ficha", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const id = await cliente();
        const [a, h] = await Promise.all([
          c.casos.anonimizarParte(mundo.ctx(), { parteId: id, motivo: MOTIVO }),
          habilitar(id),
        ]);
        if ((await fila(id))?.["estado"] === "ANONIMIZADA") {
          expect([a.ok, h.ok, await fichas(id)]).toEqual([true, false, 0]);
        } else {
          expect(h.ok).toBe(true);
          expect(a).toEqual({ ok: false, error: IMPEDIDA_POR_CUENTA });
          expect(await fichas(id)).toBe(1);
        }
      }
    });
  });

  // ---- la base (0105) -------------------------------------------------------------------------
  it("la base no confirma una anonimización que deja el cargo de un vínculo; y la acción nace con el piso SOLO_GERENTE", async () => {
    const id = await persona();
    const jefa = await empresa();
    valorDe(
      await c.casos.vincularContacto(e.operador, {
        contactoId: id,
        deParteId: jefa,
        tipo: "AGENTE_DE",
        cargo: "Compras",
      }),
    );
    const vaciar = `update parte set estado = 'ANONIMIZADA', ${PERSONALES.map((p) => `${p} = null`).join(", ")} where id = $1`;
    const apagar = (conCargo: boolean) =>
      c.dueno.query(
        `update parte_vinculo set activo = false${conCargo ? "" : ", cargo = null"} where parte_id = $1`,
        [id],
      );
    await c.dueno.query("begin");
    await c.dueno.query("update parte_rol set activo = false where parte_id = $1", [id]);
    await apagar(true);
    await c.dueno.query(vaciar, [id]);
    await expect(c.dueno.query("commit")).rejects.toMatchObject({
      code: "23514",
      constraint: "parte_anonimizada_con_cargo",
    });
    expect(await fila(id)).toMatchObject({ estado: "ACTIVA" });
    await c.dueno.query("begin");
    await c.dueno.query("update parte_rol set activo = false where parte_id = $1", [id]);
    await apagar(false);
    await c.dueno.query(vaciar, [id]);
    await c.dueno.query("commit");
    expect(await fila(id)).toMatchObject({ estado: "ANONIMIZADA" });
    expect(
      await c.filas("select tipo from piso_de_plataforma where accion = 'partes.anonimizar'"),
    ).toEqual([{ tipo: "SOLO_GERENTE" }]);
  });
});
