import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { comoEmpresa } from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
} from "./fixtures-identidad";
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
 * E4 fase A: las consultas de ventas (`ventas.ver`; E4 §3.12, §3.13 y §3.15) y lo que ventas aporta al cierre del día, con una base real.
 * Cada consulta: guard primero (sin permiso o sin módulo, rechazo ANTES de mirar lo pedido), aislamiento entre empresas, alcance de
 * sucursales del operador y que no escribe nada. Un ticket COBRADO se arma con SQL del dueño (el cobro es de la fase B): una cobranza
 * con su aplicación que suma el total del ejemplar vigente, y el estado, en una sola transacción, como exigen los disparadores.
 * Lo que se prueba pasa siempre por el rol real; el dueño solo arma ese escenario y mira.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Cualquiera = Resultado<unknown, unknown>;

const DIA_09 = "2026-11-09T15:00:00Z"; // 12:00 en Argentina: jornada del 2026-11-09
const DIA_10 = "2026-11-10T15:00:00Z";
const DIA_08 = "2026-11-08T15:00:00Z";
const DIA_07 = "2026-11-07T15:00:00Z";
const MOTIVOS_DE_RECHAZO = [
  "MODULO_EN_DESARROLLO",
  "MODULO_NO_ACTIVO",
  "MODULO_EN_SOLO_LECTURA",
  "SIN_CAPACIDAD",
  "SIN_PERMISO",
];

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

function unico<T>(filas: readonly T[], que: string): T {
  const fila = filas[0];
  if (filas.length !== 1 || fila === undefined) {
    throw new Error(`se esperaba una sola fila de ${que} y hay ${filas.length}`);
  }
  return fila;
}

/** El mismo contexto, a otra hora. */
const a = (contexto: ContextoOperativo, ahora: string): ContextoOperativo => ({
  ...contexto,
  ahora: new Date(ahora),
});

describe.skipIf(base === null)("ventas: consultas y aporte al cierre del día", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let e2: EscenarioDeVentas;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 8 });
    e = await m.escenario();
    e2 = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  // ---------------------------------------------------------------------------------------------
  // Armado del escenario
  // ---------------------------------------------------------------------------------------------

  /** Una sucursal nueva (sin actividad): aísla una prueba de las demás. */
  const sucursalNueva = async (
    escenario: EscenarioDeVentas,
    asignarAlOperador = false,
  ): Promise<EscenarioDeVentas> => {
    const fila = unico(
      await m.filas<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [escenario.empresa, `Suc ${nuevoId().slice(0, 8)}`],
      ),
      "la sucursal creada",
    );
    if (asignarAlOperador) {
      await crearAsignacionDeBase(
        m.dueno,
        escenario.empresa,
        escenario.personaDelOperador,
        fila.id,
      );
    }
    return { ...escenario, sucursal: sucursalId(fila.id) };
  };

  type LineaAAgregar = Readonly<{
    productoId: string;
    varianteId?: string;
    opcionIds?: readonly string[];
    cantidad?: string;
    confirmaciones?: readonly string[];
  }>;

  /** Abre una cuenta y le agrega las líneas; devuelve el id de cada una. */
  const cuentaCon = async (
    s: EscenarioDeVentas,
    ctx: ContextoOperativo,
    lineas: readonly LineaAAgregar[],
    datos: { etiqueta?: string; ancla?: { tipo: string; id: string } } = {},
  ) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(ctx, { cuentaId: cuenta, sucursalId: s.sucursal, ...datos }));
    const ids: string[] = [];
    for (const l of lineas) {
      const id = nuevoId();
      valorDe(
        await m.casos.agregarLinea(ctx, {
          cuentaId: cuenta,
          lineaId: id,
          productoId: l.productoId,
          ...(l.varianteId === undefined ? {} : { varianteId: l.varianteId }),
          opcionIds: l.opcionIds ?? [],
          cantidad: l.cantidad ?? "1",
          ...(l.confirmaciones === undefined ? {} : { confirmaciones: l.confirmaciones }),
        }),
      );
      ids.push(id);
    }
    return { cuenta, lineas: ids };
  };

  const cerrar = async (
    ctx: ContextoOperativo,
    cuenta: string,
    confirmaciones?: readonly string[],
  ) =>
    valorDe(
      await m.casos.cerrarCuenta(ctx, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        ...(confirmaciones === undefined ? {} : { confirmaciones }),
      }),
    );

  /** Una cuenta con UNA línea del producto de la empresa, cerrada: el ticket queda EMITIDO. */
  const emitir = async (
    s: EscenarioDeVentas,
    ctx: ContextoOperativo = s.gerente,
    cantidad = "1",
  ) => {
    const { cuenta } = await cuentaConLinea(m, s, ctx, cantidad);
    const cierre = await cerrar(ctx, cuenta);
    return { cuenta, ...cierre };
  };

  /**
   * Cobra el ticket con SQL del dueño (el cobro real es de la fase B): cobranza + aplicación que suma el total del ejemplar + estado
   * COBRADO, en UNA transacción (los disparadores lo exigen: cobranza con ticket EMITIDO y su ejemplar vigente, aplicaciones en la misma
   * transacción, suma igual al total).
   */
  const cobrar = async (
    s: EscenarioDeVentas,
    ticket: Readonly<{ ticketId: string; ejemplarId: string; total: Readonly<{ monto: string }> }>,
    ahora: string = DIA_09,
  ) => {
    const cobranzaId = nuevoId();
    const cobroId = nuevoId();
    await m.dueno.query("begin");
    try {
      await m.dueno.query(
        `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          cobranzaId,
          s.empresa,
          ticket.ticketId,
          ticket.ejemplarId,
          nuevoId(),
          nuevaClave(),
          "a".repeat(64),
          s.personaDelOperador,
          new Date(ahora),
        ],
      );
      await m.dueno.query(
        `insert into aplicacion_de_cobro (empresa_id, cobranza_id, orden, cobro_id, importe) values ($1, $2, 1, $3, $4)`,
        [s.empresa, cobranzaId, cobroId, ticket.total.monto],
      );
      await m.dueno.query(
        "update ticket set estado = 'COBRADO' where id = $1 and empresa_id = $2",
        [ticket.ticketId, s.empresa],
      );
      await m.dueno.query("commit");
    } catch (error) {
      await m.dueno.query("rollback");
      throw error;
    }
    return { cobranzaId, cobroId };
  };

  const anular = async (
    ctx: ContextoOperativo,
    ticket: Readonly<{ ticketId: string; ejemplarId: string }>,
    motivo = "Error del cajero",
  ) =>
    valorDe(
      await m.casos.anularTicket(ctx, {
        claveIdempotencia: nuevaClave(),
        ticketId: ticket.ticketId,
        ejemplarBaseId: ticket.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo,
      }),
    );

  const jornada = (s: EscenarioDeVentas, fecha = FECHA_DE_NEGOCIO) => ({
    sucursalId: s.sucursal,
    fechaNegocio: fecha,
  });
  const jornadaDeCierre = (s: EscenarioDeVentas, fecha = FECHA_DE_NEGOCIO) => ({
    sucursalId: s.sucursal,
    fechaDeNegocio: fecha,
  });

  /** Una persona de la empresa con un rol, sin asignaciones a sucursales. */
  const personaConRol = async (
    escenario: EscenarioDeVentas,
    rol: "GERENTE" | "OPERADOR",
    activa = true,
  ): Promise<ContextoOperativo> => {
    const p = await crearPersonaDeBase(m.dueno);
    await crearMembresiaDeBase(m.dueno, escenario.empresa, p.id, rol, activa);
    return {
      ...comoEmpresa(escenario.gerente.empresaId, personaId(p.id)),
      ahora: new Date(DIA_09),
    };
  };

  /** Una huella de TODO lo que escribe ventas: si cambia una sola fila, cambia. */
  const huellaDeVentas = async (): Promise<string> => {
    const tablas = [
      "cuenta_consumo",
      "linea_cuenta",
      "linea_cuenta_opcion",
      "numerador_ticket",
      "ticket",
      "ticket_ejemplar",
      "ejemplar_grupo",
      "ejemplar_linea",
      "cobranza_de_ticket",
      "aplicacion_de_cobro",
      "ticket_correccion",
    ];
    const partes: string[] = [];
    for (const t of tablas) {
      const fila = unico(
        await m.filas<{ h: string; n: string }>(
          `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::text as n from ${t} x`,
        ),
        t,
      );
      partes.push(`${t}:${fila.n}:${fila.h}`);
    }
    const auditoria = unico(
      await m.filas<{ n: string }>("select count(*)::text as n from auditoria_empresa"),
      "auditoria",
    );
    partes.push(`auditoria:${auditoria.n}`);
    return partes.join("\n");
  };

  // ---------------------------------------------------------------------------------------------
  // Un día con de todo: la sucursal «J» (la del operador también), para las consultas de la jornada
  // ---------------------------------------------------------------------------------------------

  type Dia = Awaited<ReturnType<typeof armarElDia>>;
  let J: EscenarioDeVentas;
  let dia: Dia;
  let producto2: Readonly<{ producto: string; grande: string; queso: string }>;
  let productoACero: string;

  /**
   * T1 emitido ($1000, con una línea extra anulada antes de cerrar), T2 cobrado ($2000), T3 cortesía TOTAL, T4 emitido con una línea a $0
   * (cortesía PARCIAL), T5 emitido y anulado, T6 cobrado y anulado, más una cuenta anulada. Todo el día 2026-11-09.
   */
  async function armarElDia() {
    const s = await sucursalNueva(e, true);
    productoACero = await m.productoVendible(e.empresa, "0");

    const c1 = await cuentaCon(s, s.gerente, [
      { productoId: e.producto },
      { productoId: e.producto },
    ]);
    const anuladaAntes = c1.lineas[1] as string;
    valorDe(
      await m.casos.anularLinea(s.administrador, {
        cuentaId: c1.cuenta,
        lineaId: anuladaAntes,
        motivo: "Se equivocó el pedido",
      }),
    );
    const t1 = { cuenta: c1.cuenta, ...(await cerrar(s.gerente, c1.cuenta)) };

    const t2 = await emitir(s, s.gerente, "2");
    const cobro2 = await cobrar(s, t2);

    const c3 = await cuentaCon(s, s.gerente, [
      { productoId: productoACero, confirmaciones: ["VENTA_A_CERO"] },
    ]);
    const t3 = { cuenta: c3.cuenta, ...(await cerrar(s.gerente, c3.cuenta, ["VENTA_A_CERO"])) };

    const c4 = await cuentaCon(s, s.gerente, [
      { productoId: productoACero, confirmaciones: ["VENTA_A_CERO"] },
      { productoId: e.producto },
    ]);
    const t4 = { cuenta: c4.cuenta, ...(await cerrar(s.gerente, c4.cuenta)) };

    const t5 = await emitir(s);
    await anular(s.administrador, t5, "Cliente se arrepintió");

    const t6 = await emitir(s);
    const cobro6 = await cobrar(s, t6);
    await anular(s.gerente, t6, "Cobrado por error");

    const cuentaAnulada = await cuentaCon(s, s.gerente, [{ productoId: e.producto }]);
    valorDe(
      await m.casos.anularCuenta(s.operador, {
        cuentaId: cuentaAnulada.cuenta,
        motivo: "Se fue el cliente",
      }),
    );
    return { s, t1, t2, t3, t4, t5, t6, cobro2, cobro6, c1, c3, c4, anuladaAntes, cuentaAnulada };
  }

  /** Un producto con tamaño «Grande» ($1500) y un adicional «Extra queso» (+$200): una línea con ambos vale $1700. */
  async function productoConOpciones() {
    const p = await m.productoVendible(e.empresa, "1000");
    const gv = await m.grupoDeBase(e.empresa, p, {
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
    });
    const grande = await m.opcionDeBase(e.empresa, p, gv, { nombre: "Grande" });
    await m.precio({
      empresa: e.empresa,
      producto: p,
      opcion: grande.opcion,
      precio: "1500",
      desde: "2026-01-01T00:00:00Z",
    });
    const ga = await m.grupoDeBase(e.empresa, p, { clase: "ADICIONAL", nombre: "Extras" });
    const queso = await m.opcionDeBase(e.empresa, p, ga, { nombre: "Extra queso", recargo: "200" });
    return { producto: p, grande: grande.opcion, queso: queso.opcion };
  }

  beforeAll(async () => {
    if (base === null) return;
    dia = await armarElDia();
    J = dia.s;
    producto2 = await productoConOpciones();
  });

  // ---------------------------------------------------------------------------------------------
  // Guard, aislamiento y «no escriben» de TODAS las consultas
  // ---------------------------------------------------------------------------------------------

  type DatosDeConsulta = Readonly<{
    sucursal: string;
    fecha: string;
    cuenta: string;
    ticket: string;
    cobranza: string;
    producto: string;
  }>;

  /** Las doce consultas con una entrada dada (la misma lista para guard, aislamiento y lectura pura), de a una. */
  const correrTodas = async (ctx: ContextoOperativo, d: DatosDeConsulta) => {
    const jornadaDe = { sucursalId: d.sucursal, fechaNegocio: d.fecha };
    const llamadas: ReadonlyArray<readonly [string, () => Promise<Cualquiera>]> = [
      [
        "cotizarVentaRapida",
        () =>
          m.consultas.cotizarVentaRapida(ctx, {
            sucursalId: d.sucursal,
            lineas: [{ productoId: d.producto, opcionIds: [], cantidad: "1" }],
          }),
      ],
      ["fichaDeCuenta", () => m.consultas.fichaDeCuenta(ctx, { cuentaId: d.cuenta })],
      ["fichaDeTicket", () => m.consultas.fichaDeTicket(ctx, { ticketId: d.ticket })],
      ["listarTickets", () => m.consultas.listarTickets(ctx, jornadaDe)],
      ["ticketsDeLaJornada", () => m.consultas.ticketsDeLaJornada(ctx, jornadaDe)],
      ["anulacionesDeLaJornada", () => m.consultas.anulacionesDeLaJornada(ctx, jornadaDe)],
      ["correccionesDeLaJornada", () => m.consultas.correccionesDeLaJornada(ctx, jornadaDe)],
      ["cortesiasDeLaJornada", () => m.consultas.cortesiasDeLaJornada(ctx, jornadaDe)],
      ["resumenDeVentasDeLaJornada", () => m.consultas.resumenDeVentasDeLaJornada(ctx, jornadaDe)],
      [
        "ticketsPorCobranza",
        () => m.consultas.ticketsPorCobranza(ctx, { cobranzaIds: [d.cobranza] }),
      ],
      [
        "ticketsPendientesDeFacturar",
        () => m.consultas.ticketsPendientesDeFacturar(ctx, { sucursalId: d.sucursal }),
      ],
      ["ticketParaFacturar", () => m.consultas.ticketParaFacturar(ctx, { ticketId: d.ticket })],
    ];
    const resultados = new Map<string, Cualquiera>();
    for (const [nombre, llamar] of llamadas) {
      resultados.set(
        nombre,
        await llamar().catch((error: unknown) => {
          throw new Error(`${nombre} lanzó: ${String(error)}`);
        }),
      );
    }
    return resultados;
  };

  describe("guard, aislamiento y lectura pura", () => {
    it("sin permiso o sin módulo, TODAS las consultas rechazan ANTES de mirar lo pedido (aunque lo pedido sea inválido)", async () => {
      const p = await crearPersonaDeBase(m.dueno);
      const sinMembresia = {
        ...comoEmpresa(e.gerente.empresaId, personaId(p.id)),
        ahora: new Date(DIA_09),
      };
      const inactiva = await personaConRol(e, "GERENTE", false);
      const sinPersona = { ...comoEmpresa(e.gerente.empresaId, null), ahora: new Date(DIA_09) };
      const basura = {
        sucursal: "no-es-un-uuid",
        fecha: "no-es-una-fecha",
        cuenta: "no-es-un-uuid",
        ticket: "no-es-un-uuid",
        cobranza: "no-es-un-uuid",
        producto: "no-es-un-uuid",
      };
      for (const [quien, ctx] of [
        ["sin membresía", sinMembresia],
        ["membresía inactiva", inactiva],
        ["sin persona", sinPersona],
      ] as const) {
        for (const [nombre, r] of await correrTodas(ctx, basura)) {
          expect(r.ok, `${nombre} (${quien})`).toBe(false);
          expect(MOTIVOS_DE_RECHAZO, `${nombre} (${quien}): ${codigo(r)}`).toContain(codigo(r));
        }
      }
    });

    it("sin permiso tampoco se filtra qué existe: lo existente y lo inexistente dan el mismo rechazo", async () => {
      const p = await crearPersonaDeBase(m.dueno);
      const ctx = { ...comoEmpresa(e.gerente.empresaId, personaId(p.id)), ahora: new Date(DIA_09) };
      const existente = await m.consultas.fichaDeTicket(ctx, { ticketId: dia.t1.ticketId });
      const inexistente = await m.consultas.fichaDeTicket(ctx, { ticketId: nuevoId() });
      expect(existente).toEqual(inexistente);
    });

    it("una empresa nunca ve lo de otra: cuentas y tickets ajenos no existen; las listas vienen vacías", async () => {
      const { cuenta } = await cuentaConLinea(m, e);
      const cobradoAjeno = await emitir(e);
      const cobranza = await cobrar(e, cobradoAjeno);
      const datos = {
        sucursal: J.sucursal as string,
        fecha: FECHA_DE_NEGOCIO,
        cuenta,
        ticket: dia.t2.ticketId,
        cobranza: dia.cobro2.cobranzaId,
        producto: e.producto,
      };
      const r = await correrTodas(e2.gerente, datos);
      expect(codigo(r.get("fichaDeCuenta") as Cualquiera)).toBe("CUENTA_NO_ENCONTRADA");
      expect(codigo(r.get("fichaDeTicket") as Cualquiera)).toBe("TICKET_NO_ENCONTRADO");
      expect(codigo(r.get("ticketParaFacturar") as Cualquiera)).toBe("TICKET_NO_ENCONTRADO");
      expect(codigo(r.get("cotizarVentaRapida") as Cualquiera)).toBe("PRODUCTO_NO_ENCONTRADO");
      for (const nombre of [
        "listarTickets",
        "ticketsDeLaJornada",
        "anulacionesDeLaJornada",
        "correccionesDeLaJornada",
        "cortesiasDeLaJornada",
        "ticketsPorCobranza",
      ]) {
        const x = r.get(nombre) as Cualquiera;
        expect(x.ok && x.valor, nombre).toEqual([]);
      }
      const resumen = valorDe(await m.consultas.resumenDeVentasDeLaJornada(e2.gerente, jornada(J)));
      expect(resumen).toEqual({
        emitidos: { cantidad: 0, total: "0.00" },
        cobrados: { cantidad: 0, total: "0.00" },
        cortesias: { cantidad: 0, total: "0.00" },
        anulados: { cantidad: 0, total: "0.00" },
        ticketsConLineaACero: 0,
        cuentasAnuladas: 0,
        lineasAnuladas: 0,
        correcciones: 0,
        totalCobradoPorTickets: "0.00",
      });
      const pendientes = valorDe(await m.consultas.ticketsPendientesDeFacturar(e2.gerente, {}));
      expect(pendientes.tickets).toEqual([]);
      const deLaOtra = valorDe(
        await m.consultas.ticketsPorCobranza(e2.gerente, {
          cobranzaIds: [cobranza.cobranzaId, dia.cobro2.cobranzaId],
        }),
      );
      expect(deLaOtra).toEqual([]);
    });

    it("ninguna consulta escribe: con datos de verdad, todas juntas dejan la base idéntica", async () => {
      const antes = await huellaDeVentas();
      const datos = {
        sucursal: J.sucursal as string,
        fecha: FECHA_DE_NEGOCIO,
        cuenta: dia.t1.cuenta,
        ticket: dia.t2.ticketId,
        cobranza: dia.cobro2.cobranzaId,
        producto: e.producto,
      };
      for (const ctx of [e.gerente, e.operador]) {
        await correrTodas(ctx, datos);
      }
      expect(await huellaDeVentas()).toBe(antes);
    });

    it("el operador solo mira sus sucursales: la ajena es SUCURSAL_FUERA_DE_ALCANCE en toda consulta que la nombra o la tiene", async () => {
      const ajena = { ...e, sucursal: e.otraSucursal };
      const enAjena = await emitir(ajena, e.gerente);
      const cobroAjeno = await cobrar(ajena, enAjena);
      const cuentaAjena = await cuentaCon(ajena, e.gerente, [{ productoId: e.producto }]);
      const datos = {
        sucursal: e.otraSucursal as string,
        fecha: FECHA_DE_NEGOCIO,
        cuenta: cuentaAjena.cuenta,
        ticket: enAjena.ticketId,
        cobranza: cobroAjeno.cobranzaId,
        producto: e.producto,
      };
      const r = await correrTodas(e.operador, datos);
      for (const [nombre, x] of r) {
        if (nombre === "ticketsPorCobranza") continue;
        expect(codigo(x), nombre).toBe("SUCURSAL_FUERA_DE_ALCANCE");
      }
      // La cobranza de una sucursal ajena no se devuelve (no se distingue de lo inexistente).
      expect(
        valorDe(
          await m.consultas.ticketsPorCobranza(e.operador, {
            cobranzaIds: [cobroAjeno.cobranzaId],
          }),
        ),
      ).toEqual([]);
      // El gerente, con alcance TODAS, sí lo ve.
      expect(
        codigo(await m.consultas.fichaDeTicket(e.gerente, { ticketId: enAjena.ticketId })),
      ).toBe("ok");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // fichaDeCuenta
  // ---------------------------------------------------------------------------------------------

  describe("fichaDeCuenta", () => {
    it("trae la cabecera, las líneas vigentes y anuladas (con quién, cuándo y por qué) y la foto de las opciones", async () => {
      const s = await sucursalNueva(e, true);
      const ancla = { tipo: "salon.mesa", id: nuevoId() };
      const { cuenta, lineas } = await cuentaCon(
        s,
        s.gerente,
        [
          {
            productoId: producto2.producto,
            varianteId: producto2.grande,
            opcionIds: [producto2.queso],
            cantidad: "2",
          },
          { productoId: e.producto },
        ],
        { etiqueta: "Mesa 4", ancla },
      );
      valorDe(
        await m.casos.anularLinea(a(s.administrador, DIA_10), {
          cuentaId: cuenta,
          lineaId: lineas[1] as string,
          motivo: "Se equivocó el pedido",
        }),
      );
      const f = valorDe(await m.consultas.fichaDeCuenta(s.operador, { cuentaId: cuenta }));
      expect(f).toMatchObject({
        cuentaId: cuenta,
        sucursalId: s.sucursal,
        estado: "ABIERTA",
        etiqueta: "Mesa 4",
        ancla,
        totalProvisorio: { moneda: "ARS", monto: "3400.00" },
      });
      expect(f.version).toBeGreaterThanOrEqual(1);
      expect(f.lineas.map((l) => [l.posicion, l.estado])).toEqual([
        [1, "VIGENTE"],
        [2, "ANULADA"],
      ]);
      const [conOpciones, anulada] = f.lineas;
      expect(conOpciones).toMatchObject({
        id: lineas[0],
        productoId: producto2.producto,
        varianteOpcionId: producto2.grande,
        varianteNombre: "Grande",
        precioBase: "1500.000000",
        precioUnitario: "1700.000000",
        cantidad: "2.0000",
        unidadDeVenta: "UNIDAD",
        alicuota: "21",
        anuladaPor: null,
        anuladaEn: null,
        motivoDeAnulacion: null,
        creadaPor: s.gerente.personaId,
      });
      expect(conOpciones?.opciones).toEqual([
        expect.objectContaining({
          orden: 1,
          opcionId: producto2.queso,
          nombreDeGrupo: "Extras",
          nombre: "Extra queso",
          clase: "ADICIONAL",
          recargo: "200.000000",
        }),
      ]);
      expect(anulada).toMatchObject({
        id: lineas[1],
        estado: "ANULADA",
        anuladaPor: s.administrador.personaId,
        motivoDeAnulacion: "Se equivocó el pedido",
      });
      expect(anulada?.anuladaEn).toEqual(new Date(DIA_10));
      // El total solo cuenta las vigentes.
      expect(f.totalProvisorio.monto).toBe("3400.00");
    });

    it("la foto de la línea no cambia cuando cambia el catálogo (nombre, recargo ni precio)", async () => {
      const s = await sucursalNueva(e, true);
      const propio = await productoConOpciones();
      const { cuenta } = await cuentaCon(s, s.gerente, [
        {
          productoId: propio.producto,
          varianteId: propio.grande,
          opcionIds: [propio.queso],
        },
      ]);
      const antes = valorDe(await m.consultas.fichaDeCuenta(s.gerente, { cuentaId: cuenta }));
      // Una versión nueva de la opción y un precio nuevo, vigentes desde antes de ahora.
      await m.dueno.query(
        `insert into version_de_opcion (id, empresa_id, opcion_id, numero, nombre, recargo, factor_de_tamano, creado_en)
         values ($1, $2, $3, 2, 'Queso doble', 999, 1, now())`,
        [nuevoId(), e.empresa, propio.queso],
      );
      await m.precio({
        empresa: e.empresa,
        producto: propio.producto,
        opcion: propio.grande,
        precio: "9999",
        desde: "2026-06-01T00:00:00Z",
      });
      const despues = valorDe(await m.consultas.fichaDeCuenta(s.gerente, { cuentaId: cuenta }));
      expect(despues.lineas).toEqual(antes.lineas);
      expect(despues.lineas[0]?.opciones[0]?.nombre).toBe("Extra queso");
      expect(despues.lineas[0]?.precioUnitario).toBe("1700.000000");
    });

    it("una cuenta cerrada o anulada también se ve, con su estado; una inexistente o con id inválido, no", async () => {
      expect(
        valorDe(await m.consultas.fichaDeCuenta(J.gerente, { cuentaId: dia.t1.cuenta })).estado,
      ).toBe("CERRADA");
      expect(
        valorDe(await m.consultas.fichaDeCuenta(J.gerente, { cuentaId: dia.cuentaAnulada.cuenta }))
          .estado,
      ).toBe("ANULADA");
      expect(codigo(await m.consultas.fichaDeCuenta(J.gerente, { cuentaId: nuevoId() }))).toBe(
        "CUENTA_NO_ENCONTRADA",
      );
      expect(codigo(await m.consultas.fichaDeCuenta(J.gerente, { cuentaId: "x" }))).toBe(
        "IDENTIFICADOR_INVALIDO",
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // fichaDeTicket
  // ---------------------------------------------------------------------------------------------

  describe("fichaDeTicket", () => {
    it("un ticket sin corregir es el original: rótulo 0, un solo ejemplar vigente, sin cobranza ni pendiente de facturar", async () => {
      const f = valorDe(await m.consultas.fichaDeTicket(J.operador, { ticketId: dia.t1.ticketId }));
      expect(f).toMatchObject({
        ticketId: dia.t1.ticketId,
        numero: dia.t1.numero,
        numeroDeCorreccion: 0,
        estado: "EMITIDO",
        fechaNegocio: FECHA_DE_NEGOCIO,
        total: { moneda: "ARS", monto: "1000.00" },
        cobranza: null,
        pendienteDeFacturar: false,
      });
      expect(f.ejemplares).toEqual([
        {
          ejemplarId: dia.t1.ejemplarId,
          tipo: "ORIGINAL",
          numeroDeCorreccion: 0,
          total: { moneda: "ARS", monto: "1000.00" },
          quien: J.gerente.personaId,
          cuando: new Date(DIA_09),
          vigente: true,
        },
      ]);
      expect(f.renglones).toHaveLength(1);
      expect(f.renglones[0]).toMatchObject({
        cantidad: "1.0000",
        unidadDeVenta: "UNIDAD",
        precioUnitario: "1000.000000",
        alicuota: "21",
        importe: "1000.00",
        varianteNombre: null,
        opciones: [],
      });
    });

    it("tras anular: rótulo 1, el historial va del más nuevo al más viejo y solo el primero es vigente; el vigente no tiene renglones", async () => {
      const f = valorDe(await m.consultas.fichaDeTicket(J.gerente, { ticketId: dia.t5.ticketId }));
      expect(f.numeroDeCorreccion).toBe(1);
      expect(f.estado).toBe("ANULADO");
      expect(f.total).toEqual({ moneda: "ARS", monto: "1000.00" });
      expect(f.ejemplares.map((x) => [x.tipo, x.numeroDeCorreccion, x.vigente])).toEqual([
        ["ANULACION", 1, true],
        ["ORIGINAL", 0, false],
      ]);
      expect(f.ejemplares[0]?.total).toEqual({ moneda: "ARS", monto: "0.00" });
      expect(f.ejemplares[1]?.ejemplarId).toBe(dia.t5.ejemplarId);
      expect(f.ejemplares[0]?.quien).toBe(J.administrador.personaId);
      expect(f.renglones).toEqual([]);
      expect(f.pendienteDeFacturar).toBe(false);
    });

    it("pendienteDeFacturar solo si el ticket está COBRADO; con su cobranza y sus aplicaciones", async () => {
      const f = valorDe(await m.consultas.fichaDeTicket(J.gerente, { ticketId: dia.t2.ticketId }));
      expect(f.estado).toBe("COBRADO");
      expect(f.pendienteDeFacturar).toBe(true);
      expect(f.cobranza).toMatchObject({
        id: dia.cobro2.cobranzaId,
        creadaEn: new Date(DIA_09),
        aplicaciones: [
          { orden: 1, cobroId: dia.cobro2.cobroId, cuentaDeCobroId: null, importe: "2000.00" },
        ],
      });
      // Cobrado y después anulado: ya no está pendiente, pero la cobranza queda a la vista.
      const anulado = valorDe(
        await m.consultas.fichaDeTicket(J.gerente, { ticketId: dia.t6.ticketId }),
      );
      expect(anulado.estado).toBe("ANULADO");
      expect(anulado.pendienteDeFacturar).toBe(false);
      expect(anulado.cobranza?.id).toBe(dia.cobro6.cobranzaId);
      // Cortesía: tampoco.
      expect(
        valorDe(await m.consultas.fichaDeTicket(J.gerente, { ticketId: dia.t3.ticketId }))
          .pendienteDeFacturar,
      ).toBe(false);
    });

    it("un ticket inexistente, con id inválido o de otra empresa es TICKET_NO_ENCONTRADO", async () => {
      for (const id of [nuevoId(), "x", ""]) {
        expect(codigo(await m.consultas.fichaDeTicket(J.gerente, { ticketId: id }))).toBe(
          "TICKET_NO_ENCONTRADO",
        );
      }
      expect(
        codigo(await m.consultas.fichaDeTicket(e2.gerente, { ticketId: dia.t1.ticketId })),
      ).toBe("TICKET_NO_ENCONTRADO");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // listarTickets y ticketsDeLaJornada
  // ---------------------------------------------------------------------------------------------

  describe("listarTickets y ticketsDeLaJornada", () => {
    it("listarTickets: los tickets de la jornada por número, con su rótulo y el total vigente", async () => {
      const l = valorDe(await m.consultas.listarTickets(J.gerente, jornada(J)));
      expect(l.map((t) => [t.numero, t.estado, t.numeroDeCorreccion, t.total.monto])).toEqual([
        [dia.t1.numero, "EMITIDO", 0, "1000.00"],
        [dia.t2.numero, "COBRADO", 0, "2000.00"],
        [dia.t3.numero, "CORTESIA", 0, "0.00"],
        [dia.t4.numero, "EMITIDO", 0, "1000.00"],
        [dia.t5.numero, "ANULADO", 1, "0.00"],
        [dia.t6.numero, "ANULADO", 1, "0.00"],
      ]);
      expect(l.map((t) => t.ticketId)).toEqual(
        [dia.t1, dia.t2, dia.t3, dia.t4, dia.t5, dia.t6].map((t) => t.ticketId),
      );
      // Números consecutivos desde 1 en la sucursal.
      expect(l.map((t) => t.numero)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("ticketsDeLaJornada: totalOriginal, totalVigente, totalCobrado y diferencia de cada ticket", async () => {
      const filas = valorDe(await m.consultas.ticketsDeLaJornada(J.gerente, jornada(J)));
      const de = (t: Readonly<{ ticketId: string }>) =>
        filas.find((f) => f.ticketId === t.ticketId);
      // Cobrado y sin corrección: la diferencia es 0.
      expect(de(dia.t2)).toMatchObject({
        numero: dia.t2.numero,
        estado: "COBRADO",
        totalOriginal: "2000.00",
        totalVigente: "2000.00",
        totalCobrado: "2000.00",
        diferencia: "0.00",
        cobranzaId: dia.cobro2.cobranzaId,
        cobros: [{ cobroId: dia.cobro2.cobroId, origenOrden: 1, importe: "2000.00" }],
        numeroDeCorreccion: 0,
        emitidoPor: J.gerente.personaId,
        emitidoEn: new Date(DIA_09),
      });
      expect(de(dia.t2)?.ejemplarVigenteId).toBe(dia.t2.ejemplarId);
      // P24: cobrado y luego anulado → totalVigente 0 y la diferencia es lo cobrado.
      expect(de(dia.t6)).toMatchObject({
        estado: "ANULADO",
        totalOriginal: "1000.00",
        totalVigente: "0.00",
        totalCobrado: "1000.00",
        diferencia: "1000.00",
        numeroDeCorreccion: 1,
        cobranzaId: dia.cobro6.cobranzaId,
      });
      expect(de(dia.t6)?.ejemplarVigenteId).not.toBe(dia.t6.ejemplarId);
      // Anulado sin haber cobrado: nada cobrado de más.
      expect(de(dia.t5)).toMatchObject({
        estado: "ANULADO",
        totalVigente: "0.00",
        totalCobrado: "0.00",
        diferencia: "0.00",
        cobranzaId: null,
        cobros: [],
      });
      // Cortesía: todo en cero.
      expect(de(dia.t3)).toMatchObject({
        estado: "CORTESIA",
        totalOriginal: "0.00",
        totalVigente: "0.00",
        totalCobrado: "0.00",
        diferencia: "0.00",
      });
      // Emitido sin cobrar: el total vigente es el del ticket y no hay nada cobrado.
      expect(de(dia.t1)).toMatchObject({
        estado: "EMITIDO",
        totalOriginal: "1000.00",
        totalVigente: "1000.00",
        totalCobrado: "0.00",
        cobranzaId: null,
      });
    });

    it("P24: la diferencia es cobrado menos vigente, y ningún ticket sin corrección que se cobró entero tiene diferencia", async () => {
      const filas = valorDe(await m.consultas.ticketsDeLaJornada(J.gerente, jornada(J)));
      for (const f of filas.filter((x) => x.estado === "COBRADO")) {
        expect(f.diferencia, `ticket ${f.numero}`).toBe("0.00");
        expect(f.totalCobrado).toBe(f.totalVigente);
      }
      for (const f of filas.filter((x) => x.cobranzaId !== null)) {
        const cobrado = BigInt(f.totalCobrado.replace(".", ""));
        const vigente = BigInt(f.totalVigente.replace(".", ""));
        expect(BigInt(f.diferencia.replace(".", "")), `ticket ${f.numero}`).toBe(cobrado - vigente);
      }
    });

    it("otra jornada (otra fecha) o sin actividad no trae nada; los tickets son de la jornada de su emisión", async () => {
      expect(valorDe(await m.consultas.listarTickets(J.gerente, jornada(J, "2026-11-10")))).toEqual(
        [],
      );
      expect(
        valorDe(await m.consultas.ticketsDeLaJornada(J.gerente, jornada(J, "2026-01-01"))),
      ).toEqual([]);
    });

    it("una entrada inválida: sucursal que no es uuid, fecha que no existe", async () => {
      expect(
        codigo(
          await m.consultas.listarTickets(J.gerente, {
            sucursalId: "x",
            fechaNegocio: FECHA_DE_NEGOCIO,
          }),
        ),
      ).toBe("IDENTIFICADOR_INVALIDO");
      for (const fecha of ["2026-13-01", "2026-02-30", "hoy", ""]) {
        expect(
          codigo(
            await m.consultas.ticketsDeLaJornada(J.gerente, {
              sucursalId: J.sucursal,
              fechaNegocio: fecha,
            }),
          ),
          fecha,
        ).toBe("FECHA_INVALIDA");
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  // ticketsPorCobranza (P24)
  // ---------------------------------------------------------------------------------------------

  describe("ticketsPorCobranza", () => {
    it("devuelve el ticket correcto de cada cobranza, nunca mezcla empresas y se salta lo que no es uuid o no existe", async () => {
      // Otra empresa con su propio cobrado.
      const ajeno = await emitir(e2, e2.gerente);
      const cobroAjeno = await cobrar(e2, ajeno);
      const pedido = [
        dia.cobro2.cobranzaId,
        dia.cobro6.cobranzaId,
        cobroAjeno.cobranzaId,
        "esto-no-es-un-uuid",
        "",
        nuevoId(),
      ];
      const r = valorDe(await m.consultas.ticketsPorCobranza(e.gerente, { cobranzaIds: pedido }));
      expect(r.map((x) => x.cobranzaId).sort()).toEqual(
        [dia.cobro2.cobranzaId, dia.cobro6.cobranzaId].sort(),
      );
      const de = (id: string) => r.find((x) => x.cobranzaId === id);
      expect(de(dia.cobro2.cobranzaId)).toEqual({
        cobranzaId: dia.cobro2.cobranzaId,
        ticketId: dia.t2.ticketId,
        numero: dia.t2.numero,
        estado: "COBRADO",
        numeroDeCorreccion: 0,
        ejemplarVigente: 1,
        ejemplarVigenteId: dia.t2.ejemplarId,
        totalVigente: "2000.00",
        totalCobrado: "2000.00",
      });
      // Cobrado y anulado: el total vigente es 0 y sigue figurando lo cobrado.
      expect(de(dia.cobro6.cobranzaId)).toMatchObject({
        ticketId: dia.t6.ticketId,
        estado: "ANULADO",
        numeroDeCorreccion: 1,
        totalVigente: "0.00",
        totalCobrado: "1000.00",
      });
      // Del otro lado, la otra empresa ve solo lo suyo.
      const alReves = valorDe(
        await m.consultas.ticketsPorCobranza(e2.gerente, {
          cobranzaIds: [cobroAjeno.cobranzaId, dia.cobro2.cobranzaId],
        }),
      );
      expect(alReves.map((x) => x.ticketId)).toEqual([ajeno.ticketId]);
    });

    it("sin ids, o con puros ids inválidos, es una lista vacía", async () => {
      expect(valorDe(await m.consultas.ticketsPorCobranza(e.gerente, { cobranzaIds: [] }))).toEqual(
        [],
      );
      expect(
        valorDe(await m.consultas.ticketsPorCobranza(e.gerente, { cobranzaIds: ["a", "b"] })),
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Anulaciones, correcciones, cortesías y resumen de la jornada
  // ---------------------------------------------------------------------------------------------

  describe("anulaciones, correcciones, cortesías y resumen", () => {
    it("anulacionesDeLaJornada: la cuenta y la línea anuladas con producto, importe, motivo, quién y cuándo", async () => {
      const r = valorDe(await m.consultas.anulacionesDeLaJornada(J.gerente, jornada(J)));
      expect(r).toHaveLength(2);
      const cuenta = r.find((x) => x.tipo === "CUENTA");
      const linea = r.find((x) => x.tipo === "LINEA");
      expect(cuenta).toEqual({
        tipo: "CUENTA",
        cuentaId: dia.cuentaAnulada.cuenta,
        lineaId: null,
        producto: null,
        importe: "1000.00",
        motivo: "Se fue el cliente",
        quien: J.operador.personaId,
        cuando: new Date(DIA_09),
      });
      expect(linea).toMatchObject({
        tipo: "LINEA",
        cuentaId: dia.c1.cuenta,
        lineaId: dia.anuladaAntes,
        importe: "1000.00",
        motivo: "Se equivocó el pedido",
        quien: J.administrador.personaId,
        cuando: new Date(DIA_09),
      });
      expect(typeof linea?.producto).toBe("string");
    });

    it("correccionesDeLaJornada: las anulaciones de ticket con motivo, diferencia, quién y cuándo", async () => {
      const r = valorDe(await m.consultas.correccionesDeLaJornada(J.gerente, jornada(J)));
      expect(r.map((x) => x.ticketId)).toEqual([dia.t5.ticketId, dia.t6.ticketId]);
      expect(r[0]).toEqual({
        ticketId: dia.t5.ticketId,
        numero: dia.t5.numero,
        numeroDeCorreccion: 1,
        ejemplarVigente: 2,
        tipo: "ANULACION",
        motivo: "Cliente se arrepintió",
        diferencia: "0.00",
        quien: J.administrador.personaId,
        cuando: new Date(DIA_09),
      });
      expect(r[1]).toMatchObject({
        tipo: "ANULACION",
        motivo: "Cobrado por error",
        diferencia: "1000.00",
        quien: J.gerente.personaId,
      });
    });

    it("la jornada de una anulación es la del reloj de la anulación, no la del ticket ni la de la cuenta", async () => {
      const s = await sucursalNueva(e, true);
      // El día 9: dos cuentas (una con dos líneas) y un ticket.
      const dosLineas = await cuentaCon(s, s.gerente, [
        { productoId: e.producto },
        { productoId: e.producto },
      ]);
      const aAnular = await cuentaCon(s, s.gerente, [{ productoId: e.producto }]);
      const ticket = await emitir(s);
      // El día 10 se anulan la línea, la cuenta y el ticket.
      const hoy = a(s.gerente, DIA_10);
      valorDe(
        await m.casos.anularLinea(hoy, {
          cuentaId: dosLineas.cuenta,
          lineaId: dosLineas.lineas[1] as string,
          motivo: "Se equivocó el pedido",
        }),
      );
      valorDe(
        await m.casos.anularCuenta(hoy, { cuentaId: aAnular.cuenta, motivo: "Se fue el cliente" }),
      );
      await anular(hoy, ticket, "Cliente se arrepintió");

      expect(
        valorDe(await m.consultas.anulacionesDeLaJornada(s.gerente, jornada(s, "2026-11-09"))),
      ).toEqual([]);
      expect(
        valorDe(await m.consultas.correccionesDeLaJornada(s.gerente, jornada(s, "2026-11-09"))),
      ).toEqual([]);
      const del10 = valorDe(
        await m.consultas.anulacionesDeLaJornada(s.gerente, jornada(s, "2026-11-10")),
      );
      expect(del10.map((x) => x.tipo).sort()).toEqual(["CUENTA", "LINEA"]);
      expect(
        valorDe(await m.consultas.correccionesDeLaJornada(s.gerente, jornada(s, "2026-11-10"))).map(
          (x) => x.ticketId,
        ),
      ).toEqual([ticket.ticketId]);
      // El ticket sigue siendo de la jornada del 9 (la de su emisión), con rótulo 1.
      const tickets9 = valorDe(
        await m.consultas.listarTickets(s.gerente, jornada(s, "2026-11-09")),
      );
      expect(tickets9.map((t) => [t.ticketId, t.estado, t.numeroDeCorreccion])).toEqual([
        [ticket.ticketId, "ANULADO", 1],
      ]);
      expect(valorDe(await m.consultas.listarTickets(s.gerente, jornada(s, "2026-11-10")))).toEqual(
        [],
      );
      // El resumen del día 10 cuenta lo que se hizo ese día.
      const resumen10 = valorDe(
        await m.consultas.resumenDeVentasDeLaJornada(s.gerente, jornada(s, "2026-11-10")),
      );
      expect(resumen10).toMatchObject({ cuentasAnuladas: 1, lineasAnuladas: 1, correcciones: 1 });
      expect(resumen10.anulados).toEqual({ cantidad: 0, total: "0.00" });
    });

    it("cortesiasDeLaJornada: TOTAL (todo a $0) y PARCIAL (una línea a $0 dentro de un total mayor), con sus líneas", async () => {
      const r = valorDe(await m.consultas.cortesiasDeLaJornada(J.gerente, jornada(J)));
      expect(r).toEqual([
        {
          ticketId: dia.t3.ticketId,
          numero: dia.t3.numero,
          numeroDeCorreccion: 0,
          ejemplarVigente: 1,
          tipo: "TOTAL",
          lineas: [dia.c3.lineas[0]],
          quien: J.gerente.personaId,
          cuando: new Date(DIA_09),
        },
        {
          ticketId: dia.t4.ticketId,
          numero: dia.t4.numero,
          numeroDeCorreccion: 0,
          ejemplarVigente: 1,
          tipo: "PARCIAL",
          lineas: [dia.c4.lineas[0]],
          quien: J.gerente.personaId,
          cuando: new Date(DIA_09),
        },
      ]);
      expect(dia.t3.estado).toBe("CORTESIA");
      expect(dia.t4.estado).toBe("EMITIDO");
    });

    it("resumenDeVentasDeLaJornada: conteos y totales de emitidos, cobrados, cortesías y anulados", async () => {
      const r = valorDe(await m.consultas.resumenDeVentasDeLaJornada(J.gerente, jornada(J)));
      expect(r).toEqual({
        emitidos: { cantidad: 2, total: "2000.00" },
        cobrados: { cantidad: 1, total: "2000.00" },
        cortesias: { cantidad: 1, total: "0.00" },
        anulados: { cantidad: 2, total: "2000.00" },
        ticketsConLineaACero: 2,
        cuentasAnuladas: 1,
        lineasAnuladas: 1,
        correcciones: 2,
        totalCobradoPorTickets: "3000.00",
      });
    });

    it("una jornada sin nada tiene el resumen en cero", async () => {
      const r = valorDe(
        await m.consultas.resumenDeVentasDeLaJornada(J.gerente, jornada(J, "2026-01-01")),
      );
      expect(r.emitidos).toEqual({ cantidad: 0, total: "0.00" });
      expect(r.totalCobradoPorTickets).toBe("0.00");
      expect(r.correcciones).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // cotizarVentaRapida
  // ---------------------------------------------------------------------------------------------

  describe("cotizarVentaRapida", () => {
    it("hace la misma cuenta que el cierre: mismo total y mismos renglones, y no escribe nada", async () => {
      const lineas = [
        {
          productoId: producto2.producto,
          varianteId: producto2.grande,
          opcionIds: [producto2.queso],
          cantidad: "2",
        },
        { productoId: e.producto, opcionIds: [], cantidad: "3" },
        {
          productoId: producto2.producto,
          varianteId: producto2.grande,
          opcionIds: [],
          cantidad: "1",
        },
      ];
      const antes = await huellaDeVentas();
      const cotizada = valorDe(
        await m.consultas.cotizarVentaRapida(e.operador, { sucursalId: e.sucursal, lineas }),
      );
      expect(await huellaDeVentas()).toBe(antes);
      expect(cotizada.lineas.map((l) => l.importe.monto)).toEqual([
        "3400.00",
        "3000.00",
        "1500.00",
      ]);
      expect(cotizada.lineas.map((l) => l.precioUnitario.monto)).toEqual([
        "1700.000000",
        "1000.000000",
        "1500.000000",
      ]);
      expect(cotizada.total).toEqual({ moneda: "ARS", monto: "7900.00" });

      // El cierre de verdad, con las mismas líneas.
      const s = await sucursalNueva(e, true);
      const real = await cuentaCon(
        s,
        s.operador,
        lineas.map((l) => ({
          productoId: l.productoId,
          ...("varianteId" in l ? { varianteId: l.varianteId } : {}),
          opcionIds: l.opcionIds,
          cantidad: l.cantidad,
        })),
      );
      const cierre = await cerrar(s.operador, real.cuenta);
      expect(cierre.total).toEqual(cotizada.total);
      const importes = await m.filas<{ importe: string }>(
        `select el.importe::text as importe from ejemplar_linea el join linea_cuenta l on l.id = el.linea_cuenta_id
          where el.ejemplar_id = $1 order by l.posicion`,
        [cierre.ejemplarId],
      );
      expect(importes.map((x) => x.importe)).toEqual(cotizada.lineas.map((l) => l.importe.monto));
    });

    it("un producto en precio abierto es PRODUCTO_SIN_PRECIO", async () => {
      const abierto = await m.productoVendible(e.empresa, null);
      expect(
        codigo(
          await m.consultas.cotizarVentaRapida(e.gerente, {
            sucursalId: e.sucursal,
            lineas: [
              { productoId: e.producto, opcionIds: [], cantidad: "1" },
              { productoId: abierto, opcionIds: [], cantidad: "1" },
            ],
          }),
        ),
      ).toBe("PRODUCTO_SIN_PRECIO");
    });

    it("la cantidad inválida se rechaza: no es decimal, cero, negativa, fuera de la cota o con demasiados decimales", async () => {
      for (const cantidad of ["abc", "0", "-1", "10000", "", "1e3", "1.00001"]) {
        expect(
          codigo(
            await m.consultas.cotizarVentaRapida(e.gerente, {
              sucursalId: e.sucursal,
              lineas: [{ productoId: e.producto, opcionIds: [], cantidad }],
            }),
          ),
          `cantidad «${cantidad}»`,
        ).toBe("CANTIDAD_INVALIDA");
      }
      // Un decimal válido que no es múltiplo del paso del producto lo rechaza el catálogo.
      expect(
        codigo(
          await m.consultas.cotizarVentaRapida(e.gerente, {
            sucursalId: e.sucursal,
            lineas: [{ productoId: e.producto, opcionIds: [], cantidad: "0.5" }],
          }),
        ),
      ).toBe("CANTIDAD_NO_ES_MULTIPLO_DEL_PASO");
    });

    it("ids inválidos, sucursal ajena o inexistente y producto de otra empresa", async () => {
      expect(
        codigo(await m.consultas.cotizarVentaRapida(e.gerente, { sucursalId: "x", lineas: [] })),
      ).toBe("IDENTIFICADOR_INVALIDO");
      expect(
        codigo(
          await m.consultas.cotizarVentaRapida(e.gerente, {
            sucursalId: e.sucursal,
            lineas: [{ productoId: "x", opcionIds: [], cantidad: "1" }],
          }),
        ),
      ).toBe("IDENTIFICADOR_INVALIDO");
      expect(
        codigo(
          await m.consultas.cotizarVentaRapida(e.operador, {
            sucursalId: e.otraSucursal,
            lineas: [],
          }),
        ),
      ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
      expect(
        codigo(
          await m.consultas.cotizarVentaRapida(e2.gerente, {
            sucursalId: e2.sucursal,
            lineas: [{ productoId: e.producto, opcionIds: [], cantidad: "1" }],
          }),
        ),
      ).toBe("PRODUCTO_NO_ENCONTRADO");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // ticketsPendientesDeFacturar (P28)
  // ---------------------------------------------------------------------------------------------

  describe("ticketsPendientesDeFacturar (P28)", () => {
    type Pendiente = Readonly<{
      ticketId: string;
      numero: number;
      sucursal: string;
      fecha: string;
      cobradoEn: string;
    }>;
    let e3: EscenarioDeVentas;
    let esperados: Pendiente[];
    let operadorSinAsignacion: ContextoOperativo;

    const enOrden = (x: Pendiente, y: Pendiente) =>
      x.fecha < y.fecha
        ? -1
        : x.fecha > y.fecha
          ? 1
          : x.numero !== y.numero
            ? x.numero - y.numero
            : x.sucursal < y.sucursal
              ? -1
              : x.sucursal > y.sucursal
                ? 1
                : 0;

    /** Un ticket cobrado en esa sucursal el día indicado (la fecha de negocio sale del reloj de la emisión). */
    const cobradoEl = async (s: EscenarioDeVentas, ahora: string, fecha: string) => {
      const t = await emitir(s, a(s.gerente, ahora));
      await cobrar(s, t, ahora);
      const p: Pendiente = {
        ticketId: t.ticketId,
        numero: t.numero,
        sucursal: s.sucursal,
        fecha,
        cobradoEn: ahora,
      };
      return p;
    };

    beforeAll(async () => {
      if (base === null) return;
      e3 = await m.escenario();
      const A = e3;
      const B: EscenarioDeVentas = { ...e3, sucursal: e3.otraSucursal };
      // A: (11-08, 1), (11-08, 2), (11-09, 3); B: (11-08, 1), (11-09, 2), (11-09, 3). Hay empates de (fecha, número) entre sucursales.
      esperados = [
        await cobradoEl(A, DIA_08, "2026-11-08"),
        await cobradoEl(A, DIA_08, "2026-11-08"),
        await cobradoEl(A, DIA_09, "2026-11-09"),
        await cobradoEl(B, DIA_08, "2026-11-08"),
        await cobradoEl(B, DIA_09, "2026-11-09"),
        await cobradoEl(B, DIA_09, "2026-11-09"),
      ];
      // Lo que NO es pendiente: emitido sin cobrar, cortesía, y cobrado que se anuló.
      await emitir(A);
      const cero = await m.productoVendible(e3.empresa, "0");
      const c = await cuentaCon(A, A.gerente, [
        { productoId: cero, confirmaciones: ["VENTA_A_CERO"] },
      ]);
      await cerrar(A.gerente, c.cuenta, ["VENTA_A_CERO"]);
      const cobradoYAnulado = await emitir(B);
      await cobrar(B, cobradoYAnulado);
      await anular(B.gerente, cobradoYAnulado);
      operadorSinAsignacion = await personaConRol(e3, "OPERADOR");
    });

    const lista = async (
      ctx: ContextoOperativo,
      entrada: Parameters<MundoDeVentas["consultas"]["ticketsPendientesDeFacturar"]>[1] = {},
    ) => valorDe(await m.consultas.ticketsPendientesDeFacturar(ctx, entrada));

    it("solo los COBRADOS, ordenados por fecha de negocio, número y sucursal, con total, rótulo y cuándo se cobró", async () => {
      const r = await lista(e3.gerente);
      const orden = [...esperados].sort(enOrden);
      expect(r.tickets.map((t) => t.ticketId)).toEqual(orden.map((t) => t.ticketId));
      expect(r.siguiente).toBeNull();
      for (const [i, t] of r.tickets.entries()) {
        expect(t).toEqual({
          ticketId: orden[i]?.ticketId,
          numero: orden[i]?.numero,
          numeroDeCorreccion: 0,
          sucursalId: orden[i]?.sucursal,
          fechaNegocio: orden[i]?.fecha,
          total: { moneda: "ARS", monto: "1000.00" },
          cobradoEn: new Date(orden[i]?.cobradoEn ?? ""),
          motivo: "SIN_COMPROBANTE",
        });
      }
    });

    it("no entran los emitidos, las cortesías ni los anulados (aunque se hayan cobrado)", async () => {
      const r = await lista(e3.gerente);
      expect(r.tickets).toHaveLength(esperados.length);
      const estados = await m.filas<{ estado: string; n: string }>(
        "select estado, count(*)::text as n from ticket where empresa_id = $1 group by estado order by estado",
        [e3.empresa],
      );
      expect(estados).toEqual([
        { estado: "ANULADO", n: "1" },
        { estado: "COBRADO", n: String(esperados.length) },
        { estado: "CORTESIA", n: "1" },
        { estado: "EMITIDO", n: "1" },
      ]);
    });

    it("la paginación con cursor `despuesDe`/`siguiente` es estable: dos páginas dan la lista completa, sin repetir ni saltear", async () => {
      const orden = [...esperados].sort(enOrden);
      const p1 = await lista(e3.gerente, { limite: 4 });
      expect(p1.tickets.map((t) => t.ticketId)).toEqual(orden.slice(0, 4).map((t) => t.ticketId));
      expect(p1.siguiente).toEqual({
        fechaNegocio: orden[3]?.fecha,
        numero: orden[3]?.numero,
        sucursalId: orden[3]?.sucursal,
      });
      const p2 = await lista(e3.gerente, { limite: 4, despuesDe: p1.siguiente ?? undefined });
      expect(p2.tickets.map((t) => t.ticketId)).toEqual(orden.slice(4).map((t) => t.ticketId));
      expect(p2.siguiente).toBeNull();
      // Una por una: 6 páginas de 1, mismo orden, sin empates mal cortados.
      const vistos: string[] = [];
      let cursor: Parameters<
        MundoDeVentas["consultas"]["ticketsPendientesDeFacturar"]
      >[1]["despuesDe"];
      for (let i = 0; i < orden.length + 1; i++) {
        const p = await lista(e3.gerente, { limite: 1, despuesDe: cursor });
        vistos.push(...p.tickets.map((t) => t.ticketId));
        if (p.siguiente === null) break;
        cursor = p.siguiente;
      }
      expect(vistos).toEqual(orden.map((t) => t.ticketId));
      // Pedir exactamente lo que hay no deja cursor.
      expect((await lista(e3.gerente, { limite: orden.length })).siguiente).toBeNull();
      // Por defecto trae hasta 50.
      expect((await lista(e3.gerente)).tickets).toHaveLength(orden.length);
    });

    it("filtra por sucursal y por rango de fechas de negocio", async () => {
      const deA = esperados.filter((t) => t.sucursal === e3.sucursal).sort(enOrden);
      expect(
        (await lista(e3.gerente, { sucursalId: e3.sucursal })).tickets.map((t) => t.ticketId),
      ).toEqual(deA.map((t) => t.ticketId));
      const del09 = esperados.filter((t) => t.fecha === "2026-11-09").sort(enOrden);
      const r09 = await lista(e3.gerente, { fechaDesde: "2026-11-09" });
      expect(r09.tickets.map((t) => t.ticketId)).toEqual(del09.map((t) => t.ticketId));
      const r08 = await lista(e3.gerente, { fechaHasta: "2026-11-08" });
      expect(r08.tickets.map((t) => t.fechaNegocio)).toEqual([
        "2026-11-08",
        "2026-11-08",
        "2026-11-08",
      ]);
      const rUno = await lista(e3.gerente, {
        sucursalId: e3.otraSucursal,
        fechaDesde: "2026-11-09",
        fechaHasta: "2026-11-09",
      });
      expect(rUno.tickets).toHaveLength(2);
      expect(rUno.tickets.every((t) => t.sucursalId === e3.otraSucursal)).toBe(true);
      const vacio = await lista(e3.gerente, { fechaDesde: "2026-11-10" });
      expect(vacio.tickets).toEqual([]);
    });

    it("el operador solo ve SUS sucursales: sin sucursalId, las asignadas (nunca todas); una ajena es SUCURSAL_FUERA_DE_ALCANCE; sin asignaciones, la lista vacía", async () => {
      const deA = esperados.filter((t) => t.sucursal === e3.sucursal).sort(enOrden);
      const suyo = await lista(e3.operador);
      expect(suyo.tickets.map((t) => t.ticketId)).toEqual(deA.map((t) => t.ticketId));
      expect(suyo.tickets.every((t) => t.sucursalId === e3.sucursal)).toBe(true);
      expect(
        codigo(
          await m.consultas.ticketsPendientesDeFacturar(e3.operador, {
            sucursalId: e3.otraSucursal,
          }),
        ),
      ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
      expect(
        codigo(
          await m.consultas.ticketsPendientesDeFacturar(e3.operador, { sucursalId: e3.sucursal }),
        ),
      ).toBe("ok");
      const sin = await lista(operadorSinAsignacion);
      expect(sin).toEqual({ tickets: [], siguiente: null });
      expect(
        codigo(
          await m.consultas.ticketsPendientesDeFacturar(operadorSinAsignacion, {
            sucursalId: e3.sucursal,
          }),
        ),
      ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    });

    it("el motivo COMPROBANTE_ANULADO no tiene nada que listar; SIN_COMPROBANTE es lo de siempre", async () => {
      expect(await lista(e3.gerente, { motivo: "COMPROBANTE_ANULADO" })).toEqual({
        tickets: [],
        siguiente: null,
      });
      expect((await lista(e3.gerente, { motivo: "SIN_COMPROBANTE" })).tickets).toHaveLength(
        esperados.length,
      );
    });

    it("el límite tiene que ser un entero entre 1 y 100", async () => {
      for (const limite of [0, 101, -1, 1.5, Number.NaN]) {
        expect(
          codigo(await m.consultas.ticketsPendientesDeFacturar(e3.gerente, { limite })),
          `límite ${limite}`,
        ).toBe("LIMITE_INVALIDO");
      }
      for (const limite of [1, 100]) {
        expect(codigo(await m.consultas.ticketsPendientesDeFacturar(e3.gerente, { limite }))).toBe(
          "ok",
        );
      }
    });

    it("entradas inválidas: sucursal que no es uuid, fechas que no existen y cursor roto", async () => {
      expect(
        codigo(await m.consultas.ticketsPendientesDeFacturar(e3.gerente, { sucursalId: "x" })),
      ).toBe("IDENTIFICADOR_INVALIDO");
      expect(
        codigo(
          await m.consultas.ticketsPendientesDeFacturar(e3.gerente, { fechaDesde: "2026-02-30" }),
        ),
      ).toBe("FECHA_INVALIDA");
      expect(
        codigo(await m.consultas.ticketsPendientesDeFacturar(e3.gerente, { fechaHasta: "mañana" })),
      ).toBe("FECHA_INVALIDA");
      expect(
        codigo(
          await m.consultas.ticketsPendientesDeFacturar(e3.gerente, {
            despuesDe: { fechaNegocio: "2026-11-09", numero: 1, sucursalId: "x" },
          }),
        ),
      ).toBe("IDENTIFICADOR_INVALIDO");
      expect(
        codigo(
          await m.consultas.ticketsPendientesDeFacturar(e3.gerente, {
            despuesDe: { fechaNegocio: "no-es-fecha", numero: 1, sucursalId: e3.sucursal },
          }),
        ),
      ).toBe("IDENTIFICADOR_INVALIDO");
    });

    it("nunca mezcla empresas: lo cobrado en otra empresa no aparece, ni en la lista ni en la página siguiente", async () => {
      const ajeno = await emitir(e2, e2.gerente);
      await cobrar(e2, ajeno);
      const mia = await lista(e3.gerente);
      expect(mia.tickets.some((t) => t.ticketId === ajeno.ticketId)).toBe(false);
      const suya = await lista(e2.gerente);
      expect(suya.tickets.some((t) => t.ticketId === ajeno.ticketId)).toBe(true);
      expect(suya.tickets.every((t) => esperados.every((x) => x.ticketId !== t.ticketId))).toBe(
        true,
      );
    });

    it("el cursor no se corre cuando entra un ticket que va ANTES: la página siguiente sigue donde estaba", async () => {
      const orden = [...esperados].sort(enOrden);
      const p1 = await lista(e3.gerente, { limite: 3 });
      expect(p1.tickets.map((t) => t.ticketId)).toEqual(orden.slice(0, 3).map((t) => t.ticketId));
      // Entra, ya cobrado, un ticket del día 7: ordena primero.
      const nuevo = await cobradoEl(e3, DIA_07, "2026-11-07");
      const p2 = await lista(e3.gerente, { limite: 3, despuesDe: p1.siguiente ?? undefined });
      expect(p2.tickets.map((t) => t.ticketId)).toEqual(orden.slice(3).map((t) => t.ticketId));
      const completa = await lista(e3.gerente);
      expect(completa.tickets[0]?.ticketId).toBe(nuevo.ticketId);
      esperados.push(nuevo);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // ticketParaFacturar
  // ---------------------------------------------------------------------------------------------

  describe("ticketParaFacturar", () => {
    it("un ticket COBRADO trae los renglones del ejemplar vigente con descripción, tamaño, opciones, cantidad, unidad, precio, alícuota e importe", async () => {
      const s = await sucursalNueva(e, true);
      const { cuenta, lineas } = await cuentaCon(s, s.gerente, [
        {
          productoId: producto2.producto,
          varianteId: producto2.grande,
          opcionIds: [producto2.queso],
          cantidad: "2",
        },
        { productoId: e.producto, cantidad: "3" },
      ]);
      const cierre = await cerrar(s.gerente, cuenta);
      await cobrar(s, cierre);
      const nombres = await m.filas<{ id: string; nombre: string }>(
        "select id, nombre from producto where id = any($1::uuid[])",
        [[producto2.producto, e.producto]],
      );
      const nombreDe = (id: string) => nombres.find((n) => n.id === id)?.nombre;

      const f = valorDe(
        await m.consultas.ticketParaFacturar(s.operador, { ticketId: cierre.ticketId }),
      );
      expect(f).toMatchObject({
        ticketId: cierre.ticketId,
        numero: cierre.numero,
        numeroDeCorreccion: 0,
        ejemplarVigenteId: cierre.ejemplarId,
        total: { moneda: "ARS", monto: "6400.00" },
        // Pedido de E1: la sucursal del ticket (para validar el punto de venta) y el total vigente.
        sucursalId: s.sucursal,
        totalVigente: { moneda: "ARS", monto: "6400.00" },
      });
      expect(f.lineas).toEqual([
        {
          lineaCuentaId: lineas[0],
          descripcion: nombreDe(producto2.producto),
          varianteNombre: "Grande",
          opciones: [{ grupo: "Extras", nombre: "Extra queso", recargo: "200.000000" }],
          cantidad: "2.0000",
          unidadDeVenta: "UNIDAD",
          unidadSimbolo: "u",
          precioUnitario: "1700.000000",
          alicuota: "21",
          importe: "3400.00",
        },
        {
          lineaCuentaId: lineas[1],
          descripcion: nombreDe(e.producto),
          varianteNombre: null,
          opciones: [],
          cantidad: "3.0000",
          unidadDeVenta: "UNIDAD",
          unidadSimbolo: "u",
          precioUnitario: "1000.000000",
          alicuota: "21",
          importe: "3000.00",
        },
      ]);
    });

    it("solo se factura lo COBRADO: emitido, cortesía y anulado (aunque se cobró) son TICKET_NO_FACTURABLE", async () => {
      for (const [que, t] of [
        ["emitido", dia.t1],
        ["cortesía", dia.t3],
        ["anulado sin cobrar", dia.t5],
        ["anulado después de cobrar", dia.t6],
      ] as const) {
        expect(
          codigo(await m.consultas.ticketParaFacturar(J.gerente, { ticketId: t.ticketId })),
          que,
        ).toBe("TICKET_NO_FACTURABLE");
      }
      expect(
        codigo(await m.consultas.ticketParaFacturar(J.gerente, { ticketId: dia.t2.ticketId })),
      ).toBe("ok");
    });

    it("de otra empresa, inexistente o con id inválido es TICKET_NO_ENCONTRADO; la sucursal ajena del operador, SUCURSAL_FUERA_DE_ALCANCE", async () => {
      expect(
        codigo(await m.consultas.ticketParaFacturar(e2.gerente, { ticketId: dia.t2.ticketId })),
      ).toBe("TICKET_NO_ENCONTRADO");
      expect(codigo(await m.consultas.ticketParaFacturar(e.gerente, { ticketId: nuevoId() }))).toBe(
        "TICKET_NO_ENCONTRADO",
      );
      expect(codigo(await m.consultas.ticketParaFacturar(e.gerente, { ticketId: "x" }))).toBe(
        "TICKET_NO_ENCONTRADO",
      );
      const sinAsignar = await sucursalNueva(e);
      const t = await emitir(sinAsignar);
      await cobrar(sinAsignar, t);
      expect(
        codigo(await m.consultas.ticketParaFacturar(e.operador, { ticketId: t.ticketId })),
      ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
      expect(
        codigo(await m.consultas.ticketParaFacturar(e.gerente, { ticketId: t.ticketId })),
      ).toBe("ok");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Lo que ventas aporta al cierre del día
  // ---------------------------------------------------------------------------------------------

  describe("aporte al cierre del día", () => {
    const controles = async (s: EscenarioDeVentas, fecha = FECHA_DE_NEGOCIO) =>
      valorDe(await m.consultasDeCierre.controlesDeLaJornada(s.gerente, jornadaDeCierre(s, fecha)));
    const control = async (s: EscenarioDeVentas, clave: string, fecha = FECHA_DE_NEGOCIO) => {
      const c = (await controles(s, fecha)).controles.find((x) => x.clave === clave);
      if (c === undefined) throw new Error(`el control ${clave} no figura`);
      return c;
    };
    const iniciar = (s: EscenarioDeVentas, fecha = FECHA_DE_NEGOCIO) =>
      m.cierre.iniciarAuditoria(s.gerente, jornadaDeCierre(s, fecha));
    const cerrarElDia = async (
      s: EscenarioDeVentas,
      reconocer: readonly string[] = [],
      fecha = FECHA_DE_NEGOCIO,
    ) =>
      m.cierre.cerrarJornada(s.gerente, {
        ...jornadaDeCierre(s, fecha),
        huellaVista: (await controles(s, fecha)).huella,
        reconocimientos: reconocer.map((clave) => ({ modulo: "ventas", clave, texto: null })),
        observacion: null,
      });

    /** Una sucursal con la jornada creada y sin nada abierto (abre y anula una cuenta: cuenta como una anulación). */
    const conJornada = async () => {
      const s = await sucursalNueva(e);
      const { cuenta } = await cuentaCon(s, s.gerente, []);
      valorDe(
        await m.casos.anularCuenta(s.gerente, { cuentaId: cuenta, motivo: "Prueba de armado" }),
      );
      return s;
    };

    it("los seis controles de ventas, con su severidad: cuentas abiertas BLOQUEA; por cobrar y cortesías RECONOCIBLE; el resto INFORMA", async () => {
      const s = await conJornada();
      const r = await controles(s);
      expect(r.estado).toBe("ABIERTA");
      const porClave = new Map(r.controles.map((c) => [c.clave, c]));
      expect([...porClave.keys()].sort()).toEqual(
        [
          "ventas.anulaciones",
          "ventas.correcciones",
          "ventas.cortesias",
          "ventas.cuentas_abiertas",
          "ventas.pendientes_de_facturar",
          "ventas.tickets_por_cobrar",
        ].sort(),
      );
      expect(porClave.get("ventas.cuentas_abiertas")?.severidad).toBe("BLOQUEA");
      expect(porClave.get("ventas.tickets_por_cobrar")?.severidad).toBe("RECONOCIBLE");
      expect(porClave.get("ventas.cortesias")?.severidad).toBe("RECONOCIBLE");
      for (const k of [
        "ventas.anulaciones",
        "ventas.correcciones",
        "ventas.pendientes_de_facturar",
      ]) {
        expect(porClave.get(k)?.severidad, k).toBe("INFORMA");
      }
      for (const c of r.controles) expect(c.modulo).toBe("ventas");
      // Sin hallazgos, salvo la cuenta anulada del armado.
      expect(r.controles.filter((c) => c.cantidad > 0).map((c) => c.clave)).toEqual([
        "ventas.anulaciones",
      ]);
    });

    it("una cuenta abierta BLOQUEA (cantidad 1) e iniciarAuditoria devuelve el impedimento; anulada la cuenta, se puede iniciar", async () => {
      const s = await conJornada();
      const { cuenta } = await cuentaCon(s, s.gerente, [{ productoId: e.producto }]);
      const c = await control(s, "ventas.cuentas_abiertas");
      expect(c).toMatchObject({
        severidad: "BLOQUEA",
        cantidad: 1,
        referencias: [`ventas.cuenta:${cuenta}`],
      });

      const rechazo = await iniciar(s);
      expect(rechazo.ok).toBe(false);
      expect(!rechazo.ok && rechazo.error).toEqual({
        codigo: "JORNADA_CON_IMPEDIMENTOS",
        impedimentos: [
          {
            modulo: "ventas",
            clave: "ventas.cuentas_abiertas",
            cantidad: 1,
            referencias: [`ventas.cuenta:${cuenta}`],
          },
        ],
      });
      expect((await controles(s)).estado).toBe("ABIERTA");

      // Con dos cuentas abiertas, la cantidad es 2.
      const otra = await cuentaCon(s, s.gerente, []);
      expect((await control(s, "ventas.cuentas_abiertas")).cantidad).toBe(2);
      valorDe(
        await m.casos.anularCuenta(s.gerente, {
          cuentaId: otra.cuenta,
          motivo: "Se fue el cliente",
        }),
      );

      // La salida: anularla.
      valorDe(
        await m.casos.anularCuenta(s.gerente, { cuentaId: cuenta, motivo: "Se fue el cliente" }),
      );
      expect((await control(s, "ventas.cuentas_abiertas")).cantidad).toBe(0);
      expect(valorDe(await iniciar(s))).toEqual({ yaEstabaEnAuditoria: false });
      expect((await controles(s)).estado).toBe("EN_AUDITORIA");
    });

    it("una cortesía es RECONOCIBLE: exige reconocimiento para cerrar el día", async () => {
      const s = await conJornada();
      const c = await cuentaCon(s, s.gerente, [
        { productoId: productoACero, confirmaciones: ["VENTA_A_CERO"] },
      ]);
      const t = await cerrar(s.gerente, c.cuenta, ["VENTA_A_CERO"]);
      expect(await control(s, "ventas.cortesias")).toMatchObject({
        severidad: "RECONOCIBLE",
        cantidad: 1,
        referencias: [`ventas.ticket:${t.ticketId}`],
      });
      valorDe(await iniciar(s));

      const sin = await cerrarElDia(s);
      expect(!sin.ok && sin.error).toEqual({
        codigo: "CONTROLES_SIN_RECONOCER",
        claves: ["ventas.cortesias"],
      });
      // Reconocer lo que no se puede reconocer (informa) se rechaza.
      const mal = await cerrarElDia(s, ["ventas.anulaciones"]);
      expect(!mal.ok && mal.error).toBe("RECONOCIMIENTO_INVALIDO");
      const bien = valorDe(await cerrarElDia(s, ["ventas.cortesias"]));
      expect(bien.yaEstabaCerrada).toBe(false);
      expect(bien.controles.find((x) => x.clave === "ventas.cortesias")).toMatchObject({
        reconocido: true,
        reconocidoPor: s.gerente.personaId,
      });
      expect((await controles(s)).estado).toBe("CERRADA");
    });

    it("un ticket EMITIDO sin cobrar es `tickets_por_cobrar` (RECONOCIBLE) y también exige reconocimiento", async () => {
      const s = await conJornada();
      const t = await emitir(s);
      expect(await control(s, "ventas.tickets_por_cobrar")).toMatchObject({
        severidad: "RECONOCIBLE",
        cantidad: 1,
        referencias: [`ventas.ticket:${t.ticketId}`],
      });
      expect((await control(s, "ventas.pendientes_de_facturar")).cantidad).toBe(0);
      valorDe(await iniciar(s));
      const sin = await cerrarElDia(s);
      expect(!sin.ok && sin.error).toEqual({
        codigo: "CONTROLES_SIN_RECONOCER",
        claves: ["ventas.tickets_por_cobrar"],
      });
      expect(valorDe(await cerrarElDia(s, ["ventas.tickets_por_cobrar"])).yaEstabaCerrada).toBe(
        false,
      );
    });

    it("anulaciones, correcciones y pendientes de facturar solo INFORMAN: el día se cierra sin reconocer nada", async () => {
      const s = await sucursalNueva(e);
      // Una línea anulada, una cuenta anulada, un ticket cobrado, y otro cobrado y anulado.
      const c = await cuentaCon(s, s.gerente, [
        { productoId: e.producto },
        { productoId: e.producto },
      ]);
      valorDe(
        await m.casos.anularLinea(s.gerente, {
          cuentaId: c.cuenta,
          lineaId: c.lineas[1] as string,
          motivo: "Se equivocó el pedido",
        }),
      );
      const cobrado = await cerrar(s.gerente, c.cuenta);
      await cobrar(s, cobrado);
      const b = await cuentaCon(s, s.gerente, []);
      valorDe(
        await m.casos.anularCuenta(s.gerente, { cuentaId: b.cuenta, motivo: "Se fue el cliente" }),
      );
      const aAnular = await emitir(s);
      await cobrar(s, aAnular);
      await anular(s.gerente, aAnular);

      expect(await control(s, "ventas.anulaciones")).toMatchObject({
        severidad: "INFORMA",
        cantidad: 2,
      });
      expect(await control(s, "ventas.correcciones")).toMatchObject({
        severidad: "INFORMA",
        cantidad: 1,
        referencias: [`ventas.ticket:${aAnular.ticketId}`],
      });
      expect(await control(s, "ventas.pendientes_de_facturar")).toMatchObject({
        severidad: "INFORMA",
        cantidad: 1,
        referencias: [`ventas.ticket:${cobrado.ticketId}`],
      });
      expect((await control(s, "ventas.cuentas_abiertas")).cantidad).toBe(0);
      expect((await control(s, "ventas.tickets_por_cobrar")).cantidad).toBe(0);
      expect((await control(s, "ventas.cortesias")).cantidad).toBe(0);

      valorDe(await iniciar(s));
      const cierre = valorDe(await cerrarElDia(s));
      expect(cierre.yaEstabaCerrada).toBe(false);
      // La foto guardada conserva las cantidades y ninguna está reconocida.
      const foto = (await controles(s)).controles;
      expect(foto.find((x) => x.clave === "ventas.anulaciones")?.cantidad).toBe(2);
      expect(foto.filter((x) => x.modulo === "ventas").every((x) => x.reconocido === false)).toBe(
        true,
      );
    });

    it("la misma jornada da la misma huella (dos lecturas seguidas, a otra hora) y cambia al agregar un ticket", async () => {
      const s = await conJornada();
      await emitir(s);
      const lectura = async (ahora?: string) =>
        valorDe(
          await m.consultasDeCierre.controlesDeLaJornada(
            ahora === undefined ? s.gerente : a(s.gerente, ahora),
            jornadaDeCierre(s),
          ),
        );
      const uno = await lectura();
      const dos = await lectura();
      const tarde = await lectura(DIA_10);
      expect(dos.huella).toBe(uno.huella);
      expect(tarde.huella).toBe(uno.huella);
      expect(dos.controles).toEqual(uno.controles);
      // Un ticket más cambia la huella (y el detalle por cobrar).
      const otro = await emitir(s);
      const tres = await lectura();
      expect(tres.huella).not.toBe(uno.huella);
      expect(tres.controles.find((x) => x.clave === "ventas.tickets_por_cobrar")?.cantidad).toBe(2);
      // Cobrarlo cambia el detalle: pasa de por cobrar a pendiente de facturar.
      await cobrar(s, otro);
      const cuatro = await lectura();
      expect(cuatro.huella).not.toBe(tres.huella);
      expect(
        cuatro.controles.find((x) => x.clave === "ventas.pendientes_de_facturar")?.cantidad,
      ).toBe(1);
      expect((await lectura()).huella).toBe(cuatro.huella);
    });

    it("el detalle de cada control cambia cuando cambia lo suyo y no cuando cambia otra cosa", async () => {
      const s = await conJornada();
      const huellas = async () =>
        new Map(
          (await controles(s)).controles.map((c) => [
            c.clave,
            JSON.stringify([c.cantidad, c.referencias]),
          ]),
        );
      const antes = await huellas();
      await emitir(s);
      const despues = await huellas();
      expect(despues.get("ventas.tickets_por_cobrar")).not.toBe(
        antes.get("ventas.tickets_por_cobrar"),
      );
      for (const k of [
        "ventas.cortesias",
        "ventas.correcciones",
        "ventas.anulaciones",
        "ventas.pendientes_de_facturar",
      ]) {
        expect(despues.get(k), k).toBe(antes.get(k));
      }
    });

    it("congelarEnTx no escribe: cerrar el día no cambia ninguna tabla de ventas ni agrega asientos de ventas", async () => {
      const s = await conJornada();
      await emitir(s);
      const cobrado = await emitir(s);
      await cobrar(s, cobrado);
      valorDe(await iniciar(s));
      const antes = await huellaDeVentas();
      const asientosDeVentas = () =>
        m.contar(
          `select count(*) as n from auditoria_empresa where entidad in ('cuenta_consumo', 'linea_cuenta', 'ticket')`,
        );
      const asientosAntes = await asientosDeVentas();
      const cierre = valorDe(await cerrarElDia(s, ["ventas.tickets_por_cobrar"]));
      expect(cierre.yaEstabaCerrada).toBe(false);
      expect((await controles(s)).estado).toBe("CERRADA");
      const despues = await huellaDeVentas();
      // Todo igual salvo el asiento de auditoría del cierre de la jornada (que es de cierre, no de ventas).
      expect(despues.split("\n").filter((l) => !l.startsWith("auditoria:"))).toEqual(
        antes.split("\n").filter((l) => !l.startsWith("auditoria:")),
      );
      expect(await asientosDeVentas()).toBe(asientosAntes);
    });

    it("una jornada es (sucursal, fecha de negocio): los controles de otra sucursal no se mezclan", async () => {
      const sA = await conJornada();
      const sB = await conJornada();
      const enB = await cuentaCon(sB, sB.gerente, [{ productoId: e.producto }]);
      const tA = await emitir(sA);
      // A no ve la cuenta abierta de B: puede empezar a auditar; B no.
      expect((await control(sA, "ventas.cuentas_abiertas")).cantidad).toBe(0);
      expect((await control(sB, "ventas.cuentas_abiertas")).cantidad).toBe(1);
      expect((await control(sB, "ventas.tickets_por_cobrar")).cantidad).toBe(0);
      expect((await control(sA, "ventas.tickets_por_cobrar")).referencias).toEqual([
        `ventas.ticket:${tA.ticketId}`,
      ]);
      expect(valorDe(await iniciar(sA))).toEqual({ yaEstabaEnAuditoria: false });
      const bloqueada = await iniciar(sB);
      expect(!bloqueada.ok && codigo(bloqueada)).toBe("JORNADA_CON_IMPEDIMENTOS");
      expect((await controles(sB)).estado).toBe("ABIERTA");
      valorDe(
        await m.casos.anularCuenta(sB.gerente, {
          cuentaId: enB.cuenta,
          motivo: "Se fue el cliente",
        }),
      );
      expect(valorDe(await iniciar(sB))).toEqual({ yaEstabaEnAuditoria: false });
    });

    it("tampoco se mezclan las fechas: lo emitido un día no cuenta en el control de otro día de la misma sucursal", async () => {
      const s = await conJornada();
      const del9 = await emitir(s);
      const del10 = await emitir(s, a(s.gerente, DIA_10));
      const c9 = await control(s, "ventas.tickets_por_cobrar", "2026-11-09");
      const c10 = await control(s, "ventas.tickets_por_cobrar", "2026-11-10");
      expect(c9.referencias).toEqual([`ventas.ticket:${del9.ticketId}`]);
      expect(c10.referencias).toEqual([`ventas.ticket:${del10.ticketId}`]);
      // Un día sin actividad no tiene controles.
      expect(await controles(s, "2026-11-12")).toMatchObject({
        estado: "SIN_ACTIVIDAD",
        controles: [],
      });
    });

    it("otra empresa no mezcla sus controles: la sucursal ajena no existe para quien pide", async () => {
      const s = await conJornada();
      await emitir(s);
      const r = await m.consultasDeCierre.controlesDeLaJornada(e2.gerente, jornadaDeCierre(s));
      // Para la otra empresa esa jornada no tiene actividad: ni controles ni tickets de la nuestra.
      expect(r.ok && r.valor.estado).toBe("SIN_ACTIVIDAD");
      expect(r.ok && r.valor.controles).toEqual([]);
    });
  });
});
