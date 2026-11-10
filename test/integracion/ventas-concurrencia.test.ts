import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import { crearCasosDeUsoDeCierre } from "../../src/modulos/cierre/publico";
import { aporteDeVentas, crearCasosDeUsoDeVentas } from "../../src/modulos/ventas/publico";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { Transacciones } from "../../src/puertos/transacciones";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { crearEntornoDePrueba, type TxDePrueba } from "./entorno";
import {
  FECHA_DE_NEGOCIO,
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * E4 fase A: concurrencia e idempotencia REALES de ventas (P1, P2, P7, P26 y P27 de la especificación, §5). Cada prueba lanza dos (o más)
 * transacciones a la vez con una barrera dentro de la transacción (tras leer la autorización, con el snapshot ya tomado) que fuerza que
 * TODAS hayan empezado antes de que cualquiera escriba, y se repite en rondas (`PEDERNAL_RONDAS`, 8 por defecto para no gastar el presupuesto del CI; al cerrar un tramo se corre con 50 o más).
 * Para ejercitar los TRES órdenes de la carrera, según la ronda: parejo, o uno de los dos espera 250 ms tras la barrera (así el otro
 * confirma primero y el demorado actúa con un snapshot viejo: es lo que dispara el reintento serializable).
 * Quien pierde puede recibir `ConcurrenciaAgotada` (el motor serializable repite 6 veces): se repite el MISMO pedido, seguro por su clave,
 * como en el resto de las pruebas de concurrencia. Después se mira la base con el rol del dueño (que evade RLS): nunca duplicados, huecos
 * ni estados a medias. Una carrera que devuelve un error de unicidad en lugar del resultado idempotente es un DEFECTO del código.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 900_000 });

const RONDAS = (() => {
  const crudo = process.env["PEDERNAL_RONDAS"];
  const n = crudo === undefined ? 8 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 8;
})();

const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    ventas: { ...CATALOGO_DE_MODULOS.ventas, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

type Cualquiera = Resultado<unknown, unknown>;
type Vista = Pick<MundoDeVentas, "casos" | "cierre">;

/** El código de un resultado: `ok`, el error si es texto, o su `codigo`, `error` o `tipo` si es un objeto tipado. */
function codigo(r: Cualquiera): string {
  if (r.ok) return "ok";
  const x = r.error;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x !== null) {
    if ("codigo" in x && typeof x.codigo === "string") return x.codigo;
    if ("error" in x && typeof x.error === "string") return x.error;
    if ("tipo" in x && typeof x.tipo === "string") return x.tipo;
  }
  return "otro";
}

const dormir = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** El pedido se repite si pierde por agotamiento: es el mismo pedido, seguro por su clave. */
const firme = <R extends Cualquiera>(trabajo: () => Promise<R>) =>
  repetirSiAgotada(trabajo, { esAgotada: agotadaEnElResultado });

function unico<T>(filas: readonly T[], que: string): T {
  const fila = filas[0];
  if (filas.length !== 1 || fila === undefined) {
    throw new Error(`se esperaba una sola fila de ${que} y hay ${filas.length}`);
  }
  return fila;
}

const rangoDe = (desde: number, cantidad: number) =>
  Array.from({ length: cantidad }, (_, k) => desde + k);

describe.skipIf(base === null)("ventas: concurrencia e idempotencia", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let normal: Vista;
  let lento: Vista;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16 });
    e = await m.escenario();
    normal = { casos: m.casos, cierre: m.cierre };
    // El mismo entorno, pero quien lo usa actúa 250 ms DESPUÉS de la barrera (solo en el primer intento de cada pedido).
    const transacciones: Transacciones<TxDePrueba> = {
      ejecutar: (opciones, trabajo) => {
        let demorada = false;
        return m.entorno.ejecutar(opciones, (tx) =>
          trabajo({
            ...tx,
            autorizacion: {
              ...tx.autorizacion,
              delActor: async (contexto) => {
                const datos = await tx.autorizacion.delActor(contexto);
                if (!demorada) {
                  demorada = true;
                  await dormir(250);
                }
                return datos;
              },
            },
          }),
        );
      },
    };
    lento = {
      casos: crearCasosDeUsoDeVentas({ transacciones, reglas: REGLAS }),
      cierre: crearCasosDeUsoDeCierre({ transacciones, reglas: REGLAS, aportes: [aporteDeVentas] }),
    };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  // ---------------------------------------------------------------------------------------------
  // Armado de la carrera
  // ---------------------------------------------------------------------------------------------

  /** Dos pedidos a la vez con la barrera armada. Cambia cuál sale primero según la ronda. */
  const aLaVez = async <A, B>(
    ronda: number,
    a: () => Promise<A>,
    b: () => Promise<B>,
  ): Promise<[A, B]> => {
    m.armarBarrera(2);
    try {
      if (ronda % 2 === 0) return await Promise.all([a(), b()]);
      const [y, x] = await Promise.all([b(), a()]);
      return [x, y];
    } finally {
      m.soltarBarrera();
    }
  };

  /** Dos pedidos en tres órdenes según la ronda: parejo, `a` demorado, `b` demorado. */
  const carrera = <A, B>(
    ronda: number,
    a: (v: Vista) => Promise<A>,
    b: (v: Vista) => Promise<B>,
  ): Promise<[A, B]> =>
    aLaVez(
      ronda,
      () => a(ronda % 3 === 1 ? lento : normal),
      () => b(ronda % 3 === 2 ? lento : normal),
    );

  /** `n` pedidos a la vez con una barrera de `n`. */
  const enParalelo = async <T>(pedidos: readonly (() => Promise<T>)[]): Promise<T[]> => {
    m.armarBarrera(pedidos.length);
    try {
      return await Promise.all(pedidos.map((p) => p()));
    } finally {
      m.soltarBarrera();
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Escenarios: una sucursal nueva aísla cada prueba (y cada ronda) de las demás
  // ---------------------------------------------------------------------------------------------

  /** Una sucursal sin actividad: su jornada todavía no existe. */
  const sucursalNueva = async (): Promise<EscenarioDeVentas> => {
    const fila = unico(
      await m.filas<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, `Suc ${nuevoId().slice(0, 8)}`],
      ),
      "la sucursal creada",
    );
    return { ...e, sucursal: sucursalId(fila.id) };
  };

  /** Una sucursal con la jornada ya creada (abre y anula una cuenta) y sin cuentas abiertas ni tickets. */
  const sucursalConJornada = async (): Promise<EscenarioDeVentas> => {
    const s = await sucursalNueva();
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }));
    valorDe(
      await m.casos.anularCuenta(s.gerente, { cuentaId: cuenta, motivo: "Prueba de armado" }),
    );
    return s;
  };

  /**
   * Una cuenta con una línea, para armar muchas a la vez: con tantas altas simultáneas el motor serializable puede agotar los reintentos
   * (ver el informe), así que el armado repite el mismo pedido, seguro por su id.
   */
  const cuentaLista = async (s: EscenarioDeVentas) => {
    const cuenta = nuevoId();
    valorDe(
      await firme(() =>
        m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }),
      ),
    );
    const linea = nuevoId();
    valorDe(
      await firme(() =>
        m.casos.agregarLinea(s.gerente, {
          cuentaId: cuenta,
          lineaId: linea,
          productoId: s.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      ),
    );
    return { cuenta, linea };
  };

  /** Una cuenta con una línea, cerrada: devuelve el ticket y su ejemplar original. */
  const ticketEmitido = async (s: EscenarioDeVentas) => {
    const { cuenta } = await cuentaConLinea(m, s, s.gerente);
    const cierre = valorDe(
      await m.casos.cerrarCuenta(s.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    return { cuenta, ticketId: cierre.ticketId, ejemplarId: cierre.ejemplarId };
  };

  // ---------------------------------------------------------------------------------------------
  // Lecturas del dueño para verificar
  // ---------------------------------------------------------------------------------------------

  const contarFilas = (texto: string, parametros: unknown[]) => m.contar(texto, parametros);

  const estadoDeJornada = async (s: EscenarioDeVentas): Promise<string | undefined> =>
    (
      await m.filas<{ estado: string }>(
        "select estado from jornada_de_sucursal where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3",
        [s.empresa, s.sucursal, FECHA_DE_NEGOCIO],
      )
    )[0]?.estado;

  const estadoDeCuenta = async (cuenta: string) =>
    unico(
      await m.filas<{ estado: string; total: string }>(
        "select estado, total_provisorio::text as total from cuenta_consumo where id = $1",
        [cuenta],
      ),
      "la cuenta",
    );

  const cuentasAbiertas = (s: EscenarioDeVentas) =>
    contarFilas(
      "select count(*) as n from cuenta_consumo where empresa_id = $1 and sucursal_id = $2 and estado = 'ABIERTA'",
      [s.empresa, s.sucursal],
    );

  const ticketsDeLaCuenta = (cuenta: string) =>
    contarFilas("select count(*) as n from ticket where cuenta_id = $1", [cuenta]);

  const auditoriasDe = (accion: string, entidadId: string) =>
    contarFilas(
      "select count(*) as n from auditoria_empresa where accion = $1 and entidad_id = $2",
      [accion, entidadId],
    );

  /** Los números de ticket de la sucursal, ordenados, y lo que dice el numerador. */
  const numeracion = async (s: EscenarioDeVentas) => {
    const numeros = (
      await m.filas<{ numero: number }>(
        "select numero from ticket where empresa_id = $1 and sucursal_id = $2 order by numero",
        [s.empresa, s.sucursal],
      )
    ).map((f) => f.numero);
    const ultimo = (
      await m.filas<{ ultimo: number }>(
        "select ultimo from numerador_ticket where empresa_id = $1 and sucursal_id = $2",
        [s.empresa, s.sucursal],
      )
    )[0]?.ultimo;
    return { numeros, ultimo: ultimo ?? 0 };
  };

  /**
   * La coherencia de una cuenta CERRADA: tiene UN ticket, su ejemplar original tiene exactamente las líneas VIGENTES de la cuenta (ninguna
   * línea vigente queda fuera del ticket) y el total del ticket es el del ejemplar, el de la suma de sus renglones y el de la cuenta.
   */
  const comprobarTicketCoherente = async (cuenta: string, ctx: string) => {
    const c = await estadoDeCuenta(cuenta);
    expect(c.estado, ctx).toBe("CERRADA");
    const t = unico(
      await m.filas<{ id: string; total: string }>(
        "select id, total::text as total from ticket where cuenta_id = $1",
        [cuenta],
      ),
      `el ticket (${ctx})`,
    );
    const vigentes = (
      await m.filas<{ id: string }>(
        "select id from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
        [cuenta],
      )
    )
      .map((f) => f.id)
      .sort();
    const enElTicket = (
      await m.filas<{ id: string }>(
        `select el.linea_cuenta_id as id from ejemplar_linea el
           join ticket_ejemplar ej on ej.id = el.ejemplar_id and ej.empresa_id = el.empresa_id
          where ej.ticket_id = $1 and ej.numero_de_ejemplar = 1`,
        [t.id],
      )
    )
      .map((f) => f.id)
      .sort();
    expect(enElTicket, `${ctx}: las líneas del ticket son las vigentes de la cuenta`).toEqual(
      vigentes,
    );
    const ejemplar = unico(
      await m.filas<{ total: string; suma: string }>(
        `select ej.total::text as total,
                (select coalesce(sum(el.importe), 0)::text from ejemplar_linea el where el.ejemplar_id = ej.id) as suma
           from ticket_ejemplar ej where ej.ticket_id = $1 and ej.numero_de_ejemplar = 1`,
        [t.id],
      ),
      `el ejemplar original (${ctx})`,
    );
    expect(ejemplar.total, `${ctx}: total del ticket = total del ejemplar`).toBe(t.total);
    expect(ejemplar.suma, `${ctx}: total del ejemplar = suma de sus renglones`).toBe(
      ejemplar.total,
    );
    expect(c.total, `${ctx}: total de la cuenta = total del ticket`).toBe(t.total);
    return { ticketId: t.id, total: t.total, lineas: enElTicket };
  };

  const ambosOk = <A, B>(a: Resultado<A, unknown>, b: Resultado<B, unknown>, ctx: string) => {
    expect([codigo(a), codigo(b)], ctx).toEqual(["ok", "ok"]);
    return [valorDe(a), valorDe(b)] as const;
  };

  // ---------------------------------------------------------------------------------------------
  // P1 y P2: cerrar
  // ---------------------------------------------------------------------------------------------

  it("P1: cerrar la misma cuenta dos veces a la vez (dos cajeros) deja un solo ticket, un solo número y el mismo ticketId", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const { cuenta } = await cuentaConLinea(m, s, s.gerente);
      const ejemplarA = nuevoId();
      // Doble clic (mismo id de ejemplar) en las rondas pares; dos cajeros (ids distintos) en las impares.
      const ejemplarB = i % 2 === 0 ? ejemplarA : nuevoId();
      const [a, b] = await carrera(
        i,
        (v) =>
          firme(() => v.casos.cerrarCuenta(s.gerente, { cuentaId: cuenta, ejemplarId: ejemplarA })),
        (v) =>
          firme(() =>
            v.casos.cerrarCuenta(s.administrador, { cuentaId: cuenta, ejemplarId: ejemplarB }),
          ),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect(va.ticketId, ctx).toBe(vb.ticketId);
      expect(va.numero, ctx).toBe(i + 1);
      expect(vb.numero, ctx).toBe(i + 1);
      expect(va.ejemplarId, ctx).toBe(vb.ejemplarId);
      expect([va.yaEstabaCerrada, vb.yaEstabaCerrada].sort(), ctx).toEqual([false, true]);
      expect(await ticketsDeLaCuenta(cuenta), ctx).toBe(1);
      expect(
        await contarFilas("select count(*) as n from ticket_ejemplar where ticket_id = $1", [
          va.ticketId,
        ]),
        ctx,
      ).toBe(1);
      expect(await auditoriasDe("TICKET_EMITIDO", va.ticketId), ctx).toBe(1);
      expect(await auditoriasDe("CUENTA_CERRADA", cuenta), ctx).toBe(1);
      await comprobarTicketCoherente(cuenta, ctx);
    }
    const n = await numeracion(s);
    expect(n.numeros).toEqual(rangoDe(1, RONDAS));
    expect(n.ultimo).toBe(RONDAS);
  });

  it("P2: ocho cierres simultáneos en una sucursal toman los números 1..N, sin repetidos ni huecos", async () => {
    const s = await sucursalConJornada();
    const TRABAJADORES = 8;
    for (let i = 0; i < RONDAS; i++) {
      const cuentas = await Promise.all(rangoDe(0, TRABAJADORES).map(() => cuentaLista(s)));
      const resultados = await enParalelo(
        cuentas.map(
          (c) => () =>
            firme(() =>
              m.casos.cerrarCuenta(s.gerente, { cuentaId: c.cuenta, ejemplarId: nuevoId() }),
            ),
        ),
      );
      const ctx = `ronda ${i}: ${resultados.map(codigo).join(",")}`;
      expect(new Set(resultados.map(codigo)), ctx).toEqual(new Set(["ok"]));
      const numeros = resultados.map((r) => valorDe(r).numero).sort((x, y) => x - y);
      expect(numeros, ctx).toEqual(rangoDe(i * TRABAJADORES + 1, TRABAJADORES));
      for (const [k, c] of cuentas.entries()) {
        const r = resultados[k];
        expect(r === undefined ? "sin resultado" : valorDe(r).yaEstabaCerrada, ctx).toBe(false);
        expect(await ticketsDeLaCuenta(c.cuenta), ctx).toBe(1);
      }
    }
    const n = await numeracion(s);
    expect(n.numeros).toEqual(rangoDe(1, RONDAS * TRABAJADORES));
    expect(n.ultimo).toBe(RONDAS * TRABAJADORES);
  });

  it("P2: ocho trabajadores cierran cinco cuentas cada uno, a la vez: números 1..40 sin repetidos ni huecos", async () => {
    const s = await sucursalConJornada();
    const TRABAJADORES = 8;
    const POR_TRABAJADOR = 5;
    for (let i = 0; i < Math.max(1, Math.ceil(RONDAS / 4)); i++) {
      const desde = (await numeracion(s)).ultimo;
      const lotes = await Promise.all(
        rangoDe(0, TRABAJADORES).map(() =>
          Promise.all(rangoDe(0, POR_TRABAJADOR).map(() => cuentaLista(s))),
        ),
      );
      const porTrabajador = await Promise.all(
        lotes.map(async (lote) => {
          const salidas = [];
          for (const c of lote) {
            salidas.push(
              await firme(() =>
                m.casos.cerrarCuenta(s.gerente, { cuentaId: c.cuenta, ejemplarId: nuevoId() }),
              ),
            );
          }
          return salidas;
        }),
      );
      const todos = porTrabajador.flat();
      const ctx = `repetición ${i}: ${todos.map(codigo).join(",")}`;
      expect(new Set(todos.map(codigo)), ctx).toEqual(new Set(["ok"]));
      const numeros = todos.map((r) => valorDe(r).numero).sort((x, y) => x - y);
      expect(numeros, ctx).toEqual(rangoDe(desde + 1, TRABAJADORES * POR_TRABAJADOR));
      // Cada trabajador ve números crecientes entre sus propios cierres.
      for (const salidas of porTrabajador) {
        const propios = salidas.map((r) => valorDe(r).numero);
        expect(propios, ctx).toEqual([...propios].sort((x, y) => x - y));
      }
    }
    const n = await numeracion(s);
    expect(n.numeros).toEqual(rangoDe(1, n.ultimo));
    expect(n.ultimo).toBe(TRABAJADORES * POR_TRABAJADOR * Math.max(1, Math.ceil(RONDAS / 4)));
  });

  // ---------------------------------------------------------------------------------------------
  // P7: las líneas y la cuenta
  // ---------------------------------------------------------------------------------------------

  it("P7: agregarLinea contra cerrarCuenta a la vez: la línea entra al ticket o recibe CUENTA_NO_ABIERTA, nunca queda vigente fuera del ticket", async () => {
    const s = await sucursalConJornada();
    const resultados = new Set<string>();
    for (let i = 0; i < RONDAS; i++) {
      const { cuenta } = await cuentaConLinea(m, s, s.gerente);
      const nueva = nuevoId();
      const [agregar, cerrar] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.agregarLinea(s.gerente, {
              cuentaId: cuenta,
              lineaId: nueva,
              productoId: s.producto,
              opcionIds: [],
              cantidad: "1",
            }),
          ),
        (v) =>
          firme(() =>
            v.casos.cerrarCuenta(s.administrador, { cuentaId: cuenta, ejemplarId: nuevoId() }),
          ),
      );
      const ctx = `ronda ${i}: agregar=${codigo(agregar)} cerrar=${codigo(cerrar)}`;
      expect(codigo(cerrar), ctx).toBe("ok");
      const ticket = await comprobarTicketCoherente(cuenta, ctx);
      const existe = await contarFilas("select count(*) as n from linea_cuenta where id = $1", [
        nueva,
      ]);
      if (agregar.ok) {
        resultados.add("entró");
        expect(ticket.lineas, ctx).toContain(nueva);
        expect(ticket.total, ctx).toBe("2000.00");
        expect(agregar.valor.yaExistia, ctx).toBe(false);
      } else {
        resultados.add("rechazada");
        expect(codigo(agregar), ctx).toBe("CUENTA_NO_ABIERTA");
        expect(existe, `${ctx}: la línea rechazada no existe`).toBe(0);
        expect(ticket.lineas, ctx).not.toContain(nueva);
        expect(ticket.total, ctx).toBe("1000.00");
      }
    }
    // Los dos órdenes tienen que haberse dado (las rondas demoradas fuerzan uno y otro).
    expect([...resultados].sort()).toEqual(
      RONDAS >= 3 ? ["entró", "rechazada"] : [...resultados].sort(),
    );
  });

  it("P7: anularLinea contra cerrarCuenta a la vez: el ticket tiene exactamente las líneas vigentes", async () => {
    const s = await sucursalConJornada();
    const resultados = new Set<string>();
    for (let i = 0; i < RONDAS; i++) {
      const { cuenta } = await cuentaConLinea(m, s, s.gerente);
      const segunda = nuevoId();
      valorDe(
        await m.casos.agregarLinea(s.gerente, {
          cuentaId: cuenta,
          lineaId: segunda,
          productoId: s.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      const [anular, cerrar] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.anularLinea(s.gerente, {
              cuentaId: cuenta,
              lineaId: segunda,
              motivo: "Se equivocó el pedido",
            }),
          ),
        (v) =>
          firme(() =>
            v.casos.cerrarCuenta(s.administrador, { cuentaId: cuenta, ejemplarId: nuevoId() }),
          ),
      );
      const ctx = `ronda ${i}: anularLinea=${codigo(anular)} cerrar=${codigo(cerrar)}`;
      expect(codigo(cerrar), ctx).toBe("ok");
      const ticket = await comprobarTicketCoherente(cuenta, ctx);
      const linea = unico(
        await m.filas<{ estado: string }>("select estado from linea_cuenta where id = $1", [
          segunda,
        ]),
        "la línea",
      );
      if (anular.ok) {
        resultados.add("anulada");
        expect(linea.estado, ctx).toBe("ANULADA");
        expect(ticket.lineas, ctx).not.toContain(segunda);
        expect(ticket.total, ctx).toBe("1000.00");
      } else {
        resultados.add("rechazada");
        expect(codigo(anular), ctx).toBe("CUENTA_NO_ABIERTA");
        expect(linea.estado, ctx).toBe("VIGENTE");
        expect(ticket.lineas, ctx).toContain(segunda);
        expect(ticket.total, ctx).toBe("2000.00");
      }
    }
    expect([...resultados].sort()).toEqual(
      RONDAS >= 3 ? ["anulada", "rechazada"] : [...resultados].sort(),
    );
  });

  it("P7: dos agregarLinea con el mismo lineaId a la vez dejan una línea; ambas ok y una con yaExistia", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }));
      const lineaId = nuevoId();
      const pedido = {
        cuentaId: cuenta,
        lineaId,
        productoId: s.producto,
        opcionIds: [],
        cantidad: "1",
      };
      const [a, b] = await carrera(
        i,
        (v) => firme(() => v.casos.agregarLinea(s.gerente, pedido)),
        (v) => firme(() => v.casos.agregarLinea(s.administrador, pedido)),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect([va.yaExistia, vb.yaExistia].sort(), ctx).toEqual([false, true]);
      expect(va.posicion, ctx).toBe(1);
      expect(vb.posicion, ctx).toBe(1);
      expect(
        await contarFilas("select count(*) as n from linea_cuenta where cuenta_id = $1", [cuenta]),
        ctx,
      ).toBe(1);
      expect((await estadoDeCuenta(cuenta)).total, ctx).toBe("1000.00");
      expect(await auditoriasDe("LINEA_AGREGADA", lineaId), ctx).toBe(1);
    }
  });

  it("P7: dos agregarLinea distintas a la vez toman las posiciones 1 y 2 y el total es la suma", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }));
      const entrada = (cantidad: string) => ({
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: s.producto,
        opcionIds: [],
        cantidad,
      });
      const primera = entrada("1");
      const segunda = entrada("2");
      const [a, b] = await carrera(
        i,
        (v) => firme(() => v.casos.agregarLinea(s.gerente, primera)),
        (v) => firme(() => v.casos.agregarLinea(s.administrador, segunda)),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect([va.posicion, vb.posicion].sort(), ctx).toEqual([1, 2]);
      expect([va.yaExistia, vb.yaExistia], ctx).toEqual([false, false]);
      // El que entró segundo ve las dos líneas; el primero, solo la suya.
      const [primero, ultimo] = va.posicion < vb.posicion ? [va, vb] : [vb, va];
      const montoDelPrimero = primero === va ? "1000.00" : "2000.00";
      expect(primero.totalProvisorio.monto, ctx).toBe(montoDelPrimero);
      expect(ultimo.totalProvisorio.monto, ctx).toBe("3000.00");
      const lineas = await m.filas<{ posicion: number; cantidad: string }>(
        "select posicion, cantidad::text as cantidad from linea_cuenta where cuenta_id = $1 order by posicion",
        [cuenta],
      );
      expect(
        lineas.map((l) => l.posicion),
        ctx,
      ).toEqual([1, 2]);
      const cuentaFila = unico(
        await m.filas<{ total: string; ultima: number }>(
          "select total_provisorio::text as total, ultima_posicion as ultima from cuenta_consumo where id = $1",
          [cuenta],
        ),
        "la cuenta",
      );
      expect(cuentaFila, ctx).toEqual({ total: "3000.00", ultima: 2 });
    }
  });

  it("P7: dos abrirCuenta con la misma ancla y ids distintos a la vez dejan una cuenta abierta y ambas devuelven la misma", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const ancla = { tipo: "salon.mesa", id: nuevoId() };
      const idA = nuevoId();
      const idB = nuevoId();
      const [a, b] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.abrirCuenta(s.gerente, { cuentaId: idA, sucursalId: s.sucursal, ancla }),
          ),
        (v) =>
          firme(() =>
            v.casos.abrirCuenta(s.administrador, { cuentaId: idB, sucursalId: s.sucursal, ancla }),
          ),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect(va.cuentaId, ctx).toBe(vb.cuentaId);
      expect([va.yaExistia, vb.yaExistia].sort(), ctx).toEqual([false, true]);
      expect([idA, idB], ctx).toContain(va.cuentaId);
      expect(
        await contarFilas(
          "select count(*) as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
          [ancla.id],
        ),
        ctx,
      ).toBe(1);
      expect(
        await contarFilas("select count(*) as n from cuenta_consumo where ancla_id = $1", [
          ancla.id,
        ]),
        ctx,
      ).toBe(1);
      expect(await auditoriasDe("CUENTA_ABIERTA", va.cuentaId), ctx).toBe(1);
    }
  });

  it("P7: dos abrirCuenta con el mismo id a la vez dejan una cuenta; ambas ok y una con yaExistia", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const cuenta = nuevoId();
      const pedido = { cuentaId: cuenta, sucursalId: s.sucursal, etiqueta: "Mesa 4" };
      const [a, b] = await carrera(
        i,
        (v) => firme(() => v.casos.abrirCuenta(s.gerente, pedido)),
        (v) => firme(() => v.casos.abrirCuenta(s.administrador, pedido)),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect([va.cuentaId, vb.cuentaId], ctx).toEqual([cuenta, cuenta]);
      expect([va.yaExistia, vb.yaExistia].sort(), ctx).toEqual([false, true]);
      expect(
        await contarFilas("select count(*) as n from cuenta_consumo where id = $1", [cuenta]),
        ctx,
      ).toBe(1);
      expect(await auditoriasDe("CUENTA_ABIERTA", cuenta), ctx).toBe(1);
    }
  });

  it("P7: varias abrirCuenta a la vez en una jornada que todavía no existe: todas ok y una sola jornada", async () => {
    for (let i = 0; i < Math.max(1, Math.ceil(RONDAS / 2)); i++) {
      const s = await sucursalNueva();
      const resultados = await enParalelo(
        rangoDe(0, 4).map(
          () => () =>
            firme(() =>
              m.casos.abrirCuenta(s.gerente, { cuentaId: nuevoId(), sucursalId: s.sucursal }),
            ),
        ),
      );
      const ctx = `ronda ${i}: ${resultados.map(codigo).join(",")}`;
      expect(new Set(resultados.map(codigo)), ctx).toEqual(new Set(["ok"]));
      expect(
        await contarFilas(
          "select count(*) as n from jornada_de_sucursal where empresa_id = $1 and sucursal_id = $2",
          [s.empresa, s.sucursal],
        ),
        ctx,
      ).toBe(1);
      expect(await cuentasAbiertas(s), ctx).toBe(4);
    }
  });

  it("P7: anularCuenta contra cerrarCuenta a la vez: gana una; cerrada con ticket, o anulada sin ticket y sin número consumido", async () => {
    const s = await sucursalConJornada();
    const resultados = new Set<string>();
    let cerradas = 0;
    for (let i = 0; i < RONDAS; i++) {
      const { cuenta } = await cuentaConLinea(m, s, s.gerente);
      const [anular, cerrar] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.anularCuenta(s.gerente, { cuentaId: cuenta, motivo: "Se fue el cliente" }),
          ),
        (v) =>
          firme(() =>
            v.casos.cerrarCuenta(s.administrador, { cuentaId: cuenta, ejemplarId: nuevoId() }),
          ),
      );
      const ctx = `ronda ${i}: anularCuenta=${codigo(anular)} cerrar=${codigo(cerrar)}`;
      // Nunca las dos.
      expect(anular.ok && cerrar.ok, ctx).toBe(false);
      expect(anular.ok || cerrar.ok, ctx).toBe(true);
      const c = await estadoDeCuenta(cuenta);
      if (cerrar.ok) {
        resultados.add("cerrada");
        cerradas += 1;
        expect(codigo(anular), ctx).toBe("CUENTA_CERRADA");
        expect(c.estado, ctx).toBe("CERRADA");
        expect(await ticketsDeLaCuenta(cuenta), ctx).toBe(1);
        await comprobarTicketCoherente(cuenta, ctx);
        expect(await auditoriasDe("CUENTA_ANULADA", cuenta), ctx).toBe(0);
      } else {
        resultados.add("anulada");
        expect(codigo(cerrar), ctx).toBe("CUENTA_ANULADA");
        expect(c.estado, ctx).toBe("ANULADA");
        expect(await ticketsDeLaCuenta(cuenta), ctx).toBe(0);
        expect(await auditoriasDe("CUENTA_ANULADA", cuenta), ctx).toBe(1);
        expect(await auditoriasDe("CUENTA_CERRADA", cuenta), ctx).toBe(0);
      }
      // El número solo se consume si hubo ticket: sin huecos.
      const n = await numeracion(s);
      expect(n.numeros, ctx).toEqual(rangoDe(1, cerradas));
      expect(n.ultimo, ctx).toBe(cerradas);
    }
    expect([...resultados].sort()).toEqual(
      RONDAS >= 3 ? ["anulada", "cerrada"] : [...resultados].sort(),
    );
  });

  it("P7: anularCuenta dos veces a la vez: ambas ok, una con yaEstabaAnulada, un solo asiento de auditoría", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(s.gerente, { cuentaId: cuenta, sucursalId: s.sucursal }));
      const [a, b] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.anularCuenta(s.gerente, { cuentaId: cuenta, motivo: "Se fue el cliente" }),
          ),
        (v) =>
          firme(() =>
            v.casos.anularCuenta(s.administrador, {
              cuentaId: cuenta,
              motivo: "Se fue el cliente",
            }),
          ),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect([va.yaEstabaAnulada, vb.yaEstabaAnulada].sort(), ctx).toEqual([false, true]);
      expect(await auditoriasDe("CUENTA_ANULADA", cuenta), ctx).toBe(1);
      expect((await estadoDeCuenta(cuenta)).estado, ctx).toBe("ANULADA");
    }
  });

  // ---------------------------------------------------------------------------------------------
  // P27: anular un ticket
  // ---------------------------------------------------------------------------------------------

  const ANULACION = "Error del cajero";

  /** Lo que tiene que quedar tras UNA anulación del ticket (y solo una). */
  const comprobarUnaAnulacion = async (ticketId: string, ctx: string) => {
    const t = unico(
      await m.filas<{ estado: string; ejemplar_vigente: number }>(
        "select estado, ejemplar_vigente from ticket where id = $1",
        [ticketId],
      ),
      "el ticket",
    );
    expect(t, ctx).toEqual({ estado: "ANULADO", ejemplar_vigente: 2 });
    expect(
      await contarFilas(
        "select count(*) as n from ticket_ejemplar where ticket_id = $1 and tipo = 'ANULACION'",
        [ticketId],
      ),
      `${ctx}: un solo ejemplar de anulación`,
    ).toBe(1);
    expect(
      await contarFilas("select count(*) as n from ticket_ejemplar where ticket_id = $1", [
        ticketId,
      ]),
      ctx,
    ).toBe(2);
    expect(
      await contarFilas("select count(*) as n from ticket_correccion where ticket_id = $1", [
        ticketId,
      ]),
      `${ctx}: un solo registro de corrección`,
    ).toBe(1);
    expect(await auditoriasDe("TICKET_ANULADO", ticketId), ctx).toBe(1);
  };

  it("P27 (a): anular el ticket con la misma clave dos veces a la vez es una sola anulación y un solo ejemplar de anulación", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const t = await ticketEmitido(s);
      const nuevo = nuevoId();
      const pedido = {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: nuevo,
        motivo: ANULACION,
      };
      const [a, b] = await carrera(
        i,
        (v) => firme(() => v.casos.anularTicket(s.gerente, pedido)),
        (v) => firme(() => v.casos.anularTicket(s.administrador, pedido)),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const [va, vb] = ambosOk(a, b, ctx);
      expect([va.yaExistia, vb.yaExistia].sort(), ctx).toEqual([false, true]);
      expect([va.ejemplarNuevoId, vb.ejemplarNuevoId], ctx).toEqual([nuevo, nuevo]);
      expect([va.numeroDeCorreccion, vb.numeroDeCorreccion], ctx).toEqual([1, 1]);
      await comprobarUnaAnulacion(t.ticketId, ctx);
    }
  });

  it("P27 (b): dos anulaciones con claves distintas a la vez: una gana y la otra recibe TICKET_ANULADO o EJEMPLAR_DESACTUALIZADO", async () => {
    const s = await sucursalConJornada();
    for (let i = 0; i < RONDAS; i++) {
      const t = await ticketEmitido(s);
      const pedido = (ejemplarNuevoId: string) => ({
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId,
        motivo: ANULACION,
      });
      const nuevoA = nuevoId();
      const nuevoB = nuevoId();
      const [a, b] = await carrera(
        i,
        (v) => firme(() => v.casos.anularTicket(s.gerente, pedido(nuevoA))),
        (v) => firme(() => v.casos.anularTicket(s.administrador, pedido(nuevoB))),
      );
      const ctx = `ronda ${i}: ${codigo(a)} / ${codigo(b)}`;
      const codigos = [codigo(a), codigo(b)];
      expect(
        codigos.filter((c) => c === "ok"),
        ctx,
      ).toHaveLength(1);
      const perdedor = codigos.find((c) => c !== "ok");
      expect(["TICKET_ANULADO", "EJEMPLAR_DESACTUALIZADO"], ctx).toContain(perdedor);
      const ganador = a.ok ? a.valor : b.ok ? b.valor : null;
      expect(ganador?.yaExistia, ctx).toBe(false);
      expect([nuevoA, nuevoB], ctx).toContain(ganador?.ejemplarNuevoId);
      await comprobarUnaAnulacion(t.ticketId, ctx);
      // El ejemplar del perdedor nunca existió.
      const perdido = ganador?.ejemplarNuevoId === nuevoA ? nuevoB : nuevoA;
      expect(
        await contarFilas("select count(*) as n from ticket_ejemplar where id = $1", [perdido]),
        ctx,
      ).toBe(0);
    }
  });

  it("P27 (d): una falla en la auditoría de anularTicket revierte todo: ni ejemplar nuevo ni estado ANULADO, y reintentar funciona", async () => {
    // Un entorno aparte sobre la MISMA base: la auditoría de TICKET_ANULADO falla (después de haber escrito todo lo demás).
    const roto = crearEntornoDePrueba(m.propia.base, 4, (tx) => ({
      ...tx,
      auditoria: {
        registrar: async (registro) => {
          if (registro.accion === "TICKET_ANULADO") throw new Error("falla inyectada");
          await tx.auditoria.registrar(registro);
        },
      },
      autorizacion: {
        ...tx.autorizacion,
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          return datos.rol === null
            ? datos
            : {
                ...datos,
                modulosActivados: [...datos.modulosActivados, "catalogo", "ventas", "cierre"],
                modulosHabilitados: [...datos.modulosHabilitados, "catalogo", "ventas", "cierre"],
              };
        },
      },
    }));
    try {
      const casosRotos = crearCasosDeUsoDeVentas({ transacciones: roto, reglas: REGLAS });
      const s = await sucursalConJornada();
      for (let i = 0; i < Math.max(1, Math.ceil(RONDAS / 2)); i++) {
        const t = await ticketEmitido(s);
        const pedido = {
          claveIdempotencia: nuevaClave(),
          ticketId: t.ticketId,
          ejemplarBaseId: t.ejemplarId,
          ejemplarNuevoId: nuevoId(),
          motivo: ANULACION,
        };
        await expect(casosRotos.anularTicket(s.gerente, pedido)).rejects.toThrow("falla inyectada");
        const ctx = `ronda ${i}`;
        const ticket = unico(
          await m.filas<{ estado: string; ejemplar_vigente: number }>(
            "select estado, ejemplar_vigente from ticket where id = $1",
            [t.ticketId],
          ),
          "el ticket",
        );
        expect(ticket, ctx).toEqual({ estado: "EMITIDO", ejemplar_vigente: 1 });
        expect(
          await contarFilas("select count(*) as n from ticket_ejemplar where ticket_id = $1", [
            t.ticketId,
          ]),
          ctx,
        ).toBe(1);
        expect(
          await contarFilas("select count(*) as n from ticket_ejemplar where id = $1", [
            pedido.ejemplarNuevoId,
          ]),
          ctx,
        ).toBe(0);
        expect(
          await contarFilas("select count(*) as n from ticket_correccion where ticket_id = $1", [
            t.ticketId,
          ]),
          ctx,
        ).toBe(0);
        expect(await auditoriasDe("TICKET_ANULADO", t.ticketId), ctx).toBe(0);
        // Nada quedó a medias: el mismo pedido, con el entorno sano, anula una vez.
        const hecho = valorDe(await m.casos.anularTicket(s.gerente, pedido));
        expect(hecho.yaExistia, ctx).toBe(false);
        await comprobarUnaAnulacion(t.ticketId, ctx);
      }
    } finally {
      await roto.cerrar();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // P26: venta contra iniciar la auditoría del día
  // ---------------------------------------------------------------------------------------------

  const entradaDeJornada = (s: EscenarioDeVentas) => ({
    sucursalId: s.sucursal,
    fechaDeNegocio: FECHA_DE_NEGOCIO,
  });

  it("P26: abrirCuenta contra iniciarAuditoria a la vez: o la cuenta entra y la auditoría la ve como impedimento, o la venta recibe JORNADA_EN_AUDITORIA", async () => {
    const resultados = new Set<string>();
    for (let i = 0; i < RONDAS; i++) {
      const s = await sucursalConJornada();
      const [abrir, iniciar] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.abrirCuenta(s.gerente, { cuentaId: nuevoId(), sucursalId: s.sucursal }),
          ),
        (v) => firme(() => v.cierre.iniciarAuditoria(s.administrador, entradaDeJornada(s))),
      );
      const ctx = `ronda ${i}: abrirCuenta=${codigo(abrir)} iniciarAuditoria=${codigo(iniciar)}`;
      const estado = await estadoDeJornada(s);
      if (abrir.ok) {
        resultados.add("entró la venta");
        expect(codigo(iniciar), ctx).toBe("JORNADA_CON_IMPEDIMENTOS");
        if (!iniciar.ok && typeof iniciar.error === "object" && iniciar.error !== null) {
          expect(JSON.stringify(iniciar.error), ctx).toContain("ventas.cuentas_abiertas");
        }
        expect(estado, ctx).toBe("ABIERTA");
        expect(await cuentasAbiertas(s), ctx).toBe(1);
      } else {
        resultados.add("ganó la auditoría");
        expect(codigo(abrir), ctx).toBe("JORNADA_EN_AUDITORIA");
        expect(iniciar.ok, ctx).toBe(true);
        expect(estado, ctx).toBe("EN_AUDITORIA");
        expect(await cuentasAbiertas(s), ctx).toBe(0);
      }
      // Nunca una cuenta abierta con la jornada ya en auditoría.
      if (estado === "EN_AUDITORIA") expect(await cuentasAbiertas(s), ctx).toBe(0);
    }
    expect([...resultados].sort()).toEqual(
      RONDAS >= 3 ? ["entró la venta", "ganó la auditoría"] : [...resultados].sort(),
    );
  });

  it("P26: cerrarCuenta contra iniciarAuditoria a la vez: el ticket entra antes de la auditoría, o la auditoría ve la cuenta como impedimento; nunca un ticket nuevo ya en auditoría", async () => {
    const resultados = new Set<string>();
    for (let i = 0; i < RONDAS; i++) {
      const s = await sucursalConJornada();
      const { cuenta } = await cuentaConLinea(m, s, s.gerente);
      const [cerrar, iniciar] = await carrera(
        i,
        (v) =>
          firme(() => v.casos.cerrarCuenta(s.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() })),
        (v) => firme(() => v.cierre.iniciarAuditoria(s.administrador, entradaDeJornada(s))),
      );
      const ctx = `ronda ${i}: cerrarCuenta=${codigo(cerrar)} iniciarAuditoria=${codigo(iniciar)}`;
      const estado = await estadoDeJornada(s);
      // La auditoría no puede confirmar con la cuenta todavía abierta: si confirmó, el ticket ya estaba.
      expect(cerrar.ok, ctx).toBe(true);
      if (iniciar.ok) {
        resultados.add("cerró y empezó la auditoría");
        expect(estado, ctx).toBe("EN_AUDITORIA");
        expect(await ticketsDeLaCuenta(cuenta), ctx).toBe(1);
        // El ticket se emitió ANTES que la auditoría (orden de los asientos de la misma base).
        const orden = await m.filas<{ accion: string; id: string }>(
          `select accion, id from auditoria_empresa
            where empresa_id = $1 and accion in ('TICKET_EMITIDO', 'JORNADA_EN_AUDITORIA')
              and (entidad_id = $2 or entidad_id = $3) order by id`,
          [s.empresa, cerrar.ok ? cerrar.valor.ticketId : "", `${s.sucursal}:${FECHA_DE_NEGOCIO}`],
        );
        expect(
          orden.map((f) => f.accion),
          ctx,
        ).toEqual(["TICKET_EMITIDO", "JORNADA_EN_AUDITORIA"]);
        // Y con la jornada en auditoría, una venta nueva ya no entra.
        const tarde = await m.casos.abrirCuenta(s.gerente, {
          cuentaId: nuevoId(),
          sucursalId: s.sucursal,
        });
        expect(codigo(tarde), ctx).toBe("JORNADA_EN_AUDITORIA");
      } else {
        resultados.add("la auditoría vio la cuenta");
        expect(codigo(iniciar), ctx).toBe("JORNADA_CON_IMPEDIMENTOS");
        expect(estado, ctx).toBe("ABIERTA");
      }
      await comprobarTicketCoherente(cuenta, ctx);
      if (estado === "EN_AUDITORIA") expect(await cuentasAbiertas(s), ctx).toBe(0);
    }
    expect([...resultados].length).toBeGreaterThan(0);
  });

  it("P26: agregarLinea contra iniciarAuditoria a la vez: la auditoría nunca confirma con una cuenta abierta", async () => {
    for (let i = 0; i < Math.max(1, Math.ceil(RONDAS / 2)); i++) {
      const s = await sucursalConJornada();
      const { cuenta } = await cuentaConLinea(m, s, s.gerente);
      const [agregar, iniciar] = await carrera(
        i,
        (v) =>
          firme(() =>
            v.casos.agregarLinea(s.gerente, {
              cuentaId: cuenta,
              lineaId: nuevoId(),
              productoId: s.producto,
              opcionIds: [],
              cantidad: "1",
            }),
          ),
        (v) => firme(() => v.cierre.iniciarAuditoria(s.administrador, entradaDeJornada(s))),
      );
      const ctx = `ronda ${i}: agregarLinea=${codigo(agregar)} iniciarAuditoria=${codigo(iniciar)}`;
      // La cuenta está abierta: la auditoría no puede empezar y la línea entra.
      expect(codigo(iniciar), ctx).toBe("JORNADA_CON_IMPEDIMENTOS");
      expect(codigo(agregar), ctx).toBe("ok");
      expect(await estadoDeJornada(s), ctx).toBe("ABIERTA");
      expect((await estadoDeCuenta(cuenta)).estado, ctx).toBe("ABIERTA");
    }
  });
});
