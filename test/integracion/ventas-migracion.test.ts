import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fechaDeNegocio } from "../../src/primitivas/tiempo/fecha-de-negocio";
import { productoDeBase } from "./catalogo-apoyo";
import { crearBaseAparte, cuitAlAzar } from "./entorno";
import { acepta, check, conAppDe, denegado, filas, intentoDelDueno } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import type { SesionDePrueba } from "./sesiones";
import {
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * La migración 0028 (E4 fase A: la cuenta y el ticket interno) contra el rol REAL de la aplicación y el dueño de la base. Se prueba: RLS
 * activa y forzada, otros roles sin acceso, nada se borra ni se vacía (ni el dueño), la inmutabilidad (precio, cantidad, número, fecha,
 * total, ejemplares, aplicaciones), la fecha de negocio que fija la base, el numerador sin huecos, los cuadres diferidos (cuenta, línea,
 * ejemplar, cobranza: aun saltándose el código con SQL directo), las transiciones del ticket y de la cuenta, el ancla única, el
 * aislamiento entre empresas y la reversión.
 *
 * Los datos se arman con los casos de uso (committed) o con SQL del rol de la aplicación en una transacción con su contexto firmado. Ojo:
 * la base exige que la foto de opciones, los ejemplares y las aplicaciones entren en la MISMA transacción que su padre (`xmin`), así que
 * el armado va con `directo` (sin savepoint: un savepoint cambia el `xmin` de lo que escribe) y cada sesión prueba UNA violación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
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
] as const;
/** Las de solo inserción: ni el dueño las modifica. */
const SOLO_INSERCION = [
  "linea_cuenta_opcion",
  "ticket_ejemplar",
  "ejemplar_grupo",
  "ejemplar_linea",
  "aplicacion_de_cobro",
  "ticket_correccion",
] as const;
const OTROS_ROLES = [
  "pedernal_plataforma",
  "pedernal_grupo",
  "pedernal_trabajos",
  "pedernal_publico",
  "pedernal_autenticacion",
  "pedernal_captacion",
] as const;
const HUELLA = "a".repeat(64);
const AHORA = "2026-11-09T15:00:00Z"; // jornada del 2026-11-09
const FECHA = "2026-11-09";

type Mundo = Readonly<{ empresa: string; sucursal: string; persona: string }>;
const mundoDe = (e: EscenarioDeVentas): Mundo => ({
  empresa: e.empresa,
  sucursal: e.sucursal,
  persona: e.gerente.personaId as string,
});

describe.skipIf(base === null)("migración 0028: ventas", () => {
  let m: MundoDeVentas;
  let dueno: pg.Client;
  let a: EscenarioDeVentas;
  let b: EscenarioDeVentas;
  /** Lo que hay guardado (committed) en la empresa A, armado con los casos de uso y el dueño. */
  const f = {
    abierta: { cuenta: "", linea: "", opcion: "" },
    emitido: { cuenta: "", ticket: "", ejemplar: "", linea: "" },
    cortesia: { ticket: "", ejemplar: "" },
    anulado: { ticket: "", ejemplar: "", ejemplarDeAnulacion: "" },
    cobrado: { ticket: "", ejemplar: "", cobranza: "" },
    cuentaAnulada: "",
    ancla: { tipo: "salon.mesa", id: nuevoId() },
  };

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    dueno = m.dueno;
    a = await m.escenario();
    b = await m.escenario();
    const g = a.gerente;
    // Una cuenta abierta con una línea que tiene foto de opciones, y con ancla.
    const producto = await productoDeBase(dueno, a.empresa);
    const tamano = await m.grupoDeBase(a.empresa, producto, {
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
    });
    const chico = await m.opcionDeBase(a.empresa, producto, tamano, { nombre: "Chico" });
    const extras = await m.grupoDeBase(a.empresa, producto, {
      clase: "ADICIONAL",
      nombre: "Extras",
      admiteVarias: true,
    });
    const leche = await m.opcionDeBase(a.empresa, producto, extras, {
      nombre: "Leche",
      recargo: "600",
    });
    await m.precio({
      empresa: a.empresa,
      producto,
      opcion: chico.opcion,
      precio: "3000",
      desde: "2026-01-01T00:00:00Z",
    });
    f.abierta.cuenta = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(g, {
        cuentaId: f.abierta.cuenta,
        sucursalId: a.sucursal,
        ancla: f.ancla,
        etiqueta: "Mesa 1",
      }),
    );
    f.abierta.linea = nuevoId();
    valorDe(
      await m.casos.agregarLinea(g, {
        cuentaId: f.abierta.cuenta,
        lineaId: f.abierta.linea,
        productoId: producto,
        varianteId: chico.opcion,
        opcionIds: [leche.opcion],
        cantidad: "2",
      }),
    );
    f.abierta.opcion = leche.opcion;
    // Un ticket EMITIDO.
    const emitido = await cuentaConLinea(m, a, g, "2");
    const e = valorDe(
      await m.casos.cerrarCuenta(g, { cuentaId: emitido.cuenta, ejemplarId: nuevoId() }),
    );
    Object.assign(f.emitido, {
      cuenta: emitido.cuenta,
      ticket: e.ticketId,
      ejemplar: e.ejemplarId,
      linea: emitido.linea,
    });
    // Una CORTESIA.
    const gratis = await m.productoVendible(a.empresa, "0");
    const cc = nuevoId();
    valorDe(await m.casos.abrirCuenta(g, { cuentaId: cc, sucursalId: a.sucursal }));
    valorDe(
      await m.casos.agregarLinea(g, {
        cuentaId: cc,
        lineaId: nuevoId(),
        productoId: gratis,
        opcionIds: [],
        cantidad: "1",
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    const c = valorDe(
      await m.casos.cerrarCuenta(g, {
        cuentaId: cc,
        ejemplarId: nuevoId(),
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    Object.assign(f.cortesia, { ticket: c.ticketId, ejemplar: c.ejemplarId });
    // Un ticket ANULADO (con su ejemplar de anulación y su registro de corrección).
    const anulado = await cuentaConLinea(m, a, g);
    const t = valorDe(
      await m.casos.cerrarCuenta(g, { cuentaId: anulado.cuenta, ejemplarId: nuevoId() }),
    );
    const an = valorDe(
      await m.casos.anularTicket(g, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
      }),
    );
    Object.assign(f.anulado, {
      ticket: t.ticketId,
      ejemplar: t.ejemplarId,
      ejemplarDeAnulacion: an.ejemplarNuevoId,
    });
    // Una cuenta anulada.
    const ca = await cuentaConLinea(m, a, g);
    valorDe(await m.casos.anularCuenta(g, { cuentaId: ca.cuenta, motivo: "Se fue" }));
    f.cuentaAnulada = ca.cuenta;
    // Un ticket COBRADO (la cobranza la arma el dueño: cobrar es de la fase B, pero la base ya impone sus reglas).
    const cobrado = await cuentaConLinea(m, a, g, "3");
    const k = valorDe(
      await m.casos.cerrarCuenta(g, { cuentaId: cobrado.cuenta, ejemplarId: nuevoId() }),
    );
    f.cobrado.cobranza = randomUUID();
    await dueno.query("begin");
    await dueno.query(
      `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        f.cobrado.cobranza,
        a.empresa,
        k.ticketId,
        k.ejemplarId,
        randomUUID(),
        nuevaClave(),
        HUELLA,
        g.personaId,
        AHORA,
      ],
    );
    await dueno.query(
      `insert into aplicacion_de_cobro (empresa_id, cobranza_id, orden, cobro_id, importe) values ($1, $2, 1, $3, 2000), ($1, $2, 2, $4, 1000)`,
      [a.empresa, f.cobrado.cobranza, randomUUID(), randomUUID()],
    );
    await dueno.query("update ticket set estado = 'COBRADO' where id = $1", [k.ticketId]);
    await dueno.query("commit");
    Object.assign(f.cobrado, { ticket: k.ticketId, ejemplar: k.ejemplarId });
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const b0 = () => m.propia.base;
  /** Una sesión del rol de la aplicación en la empresa A (con su gerente); todo se deshace al terminar. */
  const conA = <T>(trabajo: (s: SesionDePrueba) => Promise<T>) =>
    conAppDe(b0(), mundoDe(a), trabajo);
  const conB = <T>(trabajo: (s: SesionDePrueba) => Promise<T>) =>
    conAppDe(b0(), mundoDe(b), trabajo);

  /** Un paso del armado: tiene que salir bien (si no, el mensaje dice cuál y por qué). */
  const paso = async (s: SesionDePrueba, texto: string, parametros: unknown[] = []) => {
    const r = await s.directo(texto, parametros);
    acepta(r);
    return r.ok ? r.rows : [];
  };

  // ---- armado por SQL del rol de la aplicación --------------------------------------------------------------------------------

  type LineaSql = Readonly<{
    unitario: string;
    cantidad: string;
    /** Por defecto, vigente. */
    anulada?: boolean;
    base?: string;
    paso?: string;
  }>;
  type Armado = Readonly<{
    cuenta: string;
    lineas: readonly string[];
    ticket: string;
    ejemplar: string;
    numero: number;
  }>;
  const cuentaSql = async (
    s: SesionDePrueba,
    w: Mundo,
    ancla: { tipo: string; id: string } | null = null,
  ) => {
    const id = randomUUID();
    await paso(
      s,
      `insert into cuenta_consumo (id, empresa_id, sucursal_id, ancla_tipo, ancla_id, abierta_por, abierta_en)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, w.empresa, w.sucursal, ancla?.tipo ?? null, ancla?.id ?? null, w.persona, AHORA],
    );
    return id;
  };
  /** Reserva la posición (como `agregarLinea`) y agrega la línea, con el precio como se le dice. */
  const lineaSql = async (s: SesionDePrueba, w: Mundo, cuenta: string, l: LineaSql) => {
    const id = randomUUID();
    const [{ ultima_posicion: posicion }] = (await paso(
      s,
      "update cuenta_consumo set ultima_posicion = ultima_posicion + 1 where id = $1 and estado = 'ABIERTA' returning ultima_posicion",
      [cuenta],
    )) as [{ ultima_posicion: number }];
    await paso(
      s,
      `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en)
       values ($1, $2, $3, $4, $5, 'Producto', $6, 'EMPRESA', $7, $8, $9, 'UNIDAD', $10, '21', false, $11, $12)`,
      [
        id,
        w.empresa,
        cuenta,
        posicion,
        randomUUID(),
        randomUUID(),
        l.base ?? l.unitario,
        l.unitario,
        l.cantidad,
        l.paso ?? "1",
        w.persona,
        AHORA,
      ],
    );
    if (l.anulada === true) {
      await paso(
        s,
        `update linea_cuenta set estado = 'ANULADA', anulada_por = $2, anulada_en = $3, motivo_de_anulacion = 'Error' where id = $1`,
        [id, w.persona, AHORA],
      );
    }
    return id;
  };
  const totalSql = (s: SesionDePrueba, cuenta: string, total: string) =>
    paso(s, "update cuenta_consumo set total_provisorio = $2 where id = $1", [cuenta, total]);
  const cerrarSql = (s: SesionDePrueba, w: Mundo, cuenta: string) =>
    paso(
      s,
      "update cuenta_consumo set estado = 'CERRADA', resuelta_por = $2, resuelta_en = $3 where id = $1",
      [cuenta, w.persona, AHORA],
    );
  const numeroSql = async (s: SesionDePrueba, w: Mundo) => {
    await paso(
      s,
      "insert into numerador_ticket (empresa_id, sucursal_id) values ($1, $2) on conflict do nothing",
      [w.empresa, w.sucursal],
    );
    const filasDelNumerador = (await paso(
      s,
      "update numerador_ticket set ultimo = ultimo + 1 where empresa_id = $1 and sucursal_id = $2 returning ultimo",
      [w.empresa, w.sucursal],
    )) as { ultimo: number }[];
    return filasDelNumerador[0]?.ultimo as number;
  };
  const ticketSql = (
    s: SesionDePrueba,
    w: Mundo,
    cuenta: string,
    numero: number,
    total: string,
    extra: Partial<{
      estado: string;
      sesion: string | null;
      id: string;
      emitidoEn: string;
    }> = {},
  ) =>
    s.directo(
      `insert into ticket (id, empresa_id, sucursal_id, cuenta_id, numero, estado, total, sesion_de_caja_id, emitido_por, emitido_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        extra.id ?? randomUUID(),
        w.empresa,
        w.sucursal,
        cuenta,
        numero,
        extra.estado ?? "EMITIDO",
        total,
        extra.sesion ?? null,
        w.persona,
        extra.emitidoEn ?? AHORA,
      ],
    );
  const ejemplarSql = (
    s: SesionDePrueba,
    w: Mundo,
    ticket: string,
    id: string,
    total: string,
    extra: Partial<{ numero: number; tipo: string; base: string | null }> = {},
  ) =>
    s.directo(
      `insert into ticket_ejemplar (id, empresa_id, ticket_id, numero_de_ejemplar, tipo, total, ejemplar_base_id, creado_por, creado_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        w.empresa,
        ticket,
        extra.numero ?? 1,
        extra.tipo ?? "ORIGINAL",
        total,
        extra.base ?? null,
        w.persona,
        AHORA,
      ],
    );
  const grupoSql = (s: SesionDePrueba, w: Mundo, ejemplar: string, total: string) =>
    s.directo(
      "insert into ejemplar_grupo (empresa_id, ejemplar_id, orden, total) values ($1, $2, 1, $3)",
      [w.empresa, ejemplar, total],
    );
  const renglonSql = (
    s: SesionDePrueba,
    w: Mundo,
    ejemplar: string,
    linea: string,
    cantidad: string,
    importe: string,
  ) =>
    s.directo(
      `insert into ejemplar_linea (empresa_id, ejemplar_id, grupo_orden, linea_cuenta_id, cantidad, importe) values ($1, $2, 1, $3, $4, $5)`,
      [w.empresa, ejemplar, linea, cantidad, importe],
    );

  /**
   * Una venta completa por SQL: cuenta, líneas, total, cierre, número, ticket, ejemplar original, grupo y renglones. Lo correcto por
   * defecto; cada prueba desvía UNA cosa y comprueba qué dice la base (al confirmar, si el cuadre es diferido).
   */
  const armarVenta = async (
    s: SesionDePrueba,
    w: Mundo,
    o: Readonly<{
      lineas: readonly LineaSql[];
      total: string;
      totalCuenta?: string;
      totalTicket?: string;
      totalEjemplar?: string;
      totalGrupo?: string;
      /** El importe de cada renglón (por línea VIGENTE, en orden); `null` = no se escribe ese renglón. */
      renglones?: readonly (string | null)[];
      cantidades?: readonly (string | null)[];
    }>,
  ): Promise<Armado> => {
    const cuenta = await cuentaSql(s, w);
    const lineas: string[] = [];
    for (const l of o.lineas) lineas.push(await lineaSql(s, w, cuenta, l));
    await totalSql(s, cuenta, o.totalCuenta ?? o.total);
    await cerrarSql(s, w, cuenta);
    const numero = await numeroSql(s, w);
    const ticket = randomUUID();
    acepta(await ticketSql(s, w, cuenta, numero, o.totalTicket ?? o.total, { id: ticket }));
    const ejemplar = randomUUID();
    acepta(await ejemplarSql(s, w, ticket, ejemplar, o.totalEjemplar ?? o.total));
    acepta(await grupoSql(s, w, ejemplar, o.totalGrupo ?? o.total));
    const vigentes = o.lineas
      .map((l, i) => ({ l, id: lineas[i] as string }))
      .filter((x) => x.l.anulada !== true);
    for (const [i, { l, id }] of vigentes.entries()) {
      const importe =
        o.renglones === undefined
          ? (
              (
                await paso(s, "select round($1::numeric * $2::numeric, 2)::text as x", [
                  l.unitario,
                  l.cantidad,
                ])
              )[0] as {
                x: string;
              }
            ).x
          : o.renglones[i];
      const cantidad = o.cantidades === undefined ? l.cantidad : o.cantidades[i];
      if (importe === null || importe === undefined || cantidad === null || cantidad === undefined)
        continue;
      acepta(await renglonSql(s, w, ejemplar, id, cantidad, importe));
    }
    return { cuenta, lineas, ticket, ejemplar, numero };
  };

  // ---- tablas, RLS y privilegios ----------------------------------------------------------------------------------------------

  it("las once tablas existen con RLS activa y forzada, sin DELETE ni TRUNCATE para nadie y sin acceso para los demás roles", async () => {
    const { rows } = await dueno.query<{ relname: string; on: boolean; forzada: boolean }>(
      `select relname, relrowsecurity as on, relforcerowsecurity as forzada from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1) order by relname`,
      [[...TABLAS]],
    );
    expect(rows.map((r) => r.relname)).toEqual([...TABLAS].sort());
    for (const r of rows) expect(r, r.relname).toMatchObject({ on: true, forzada: true });
    for (const tabla of TABLAS) {
      for (const rol of OTROS_ROLES) {
        const { rows: p } = await dueno.query<{ t: boolean; c: boolean }>(
          `select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as t,
                  has_any_column_privilege($1, $2, 'SELECT, INSERT, UPDATE, REFERENCES') as c`,
          [rol, tabla],
        );
        expect(p[0], `${rol} sobre ${tabla}`).toEqual({ t: false, c: false });
      }
      // La aplicación lee, pero nunca borra ni vacía.
      const { rows: app } = await dueno.query<{ r: boolean; d: boolean; t: boolean }>(
        `select has_table_privilege('pedernal_app', $1, 'SELECT') as r, has_table_privilege('pedernal_app', $1, 'DELETE') as d,
                has_table_privilege('pedernal_app', $1, 'TRUNCATE') as t`,
        [tabla],
      );
      expect(app[0], tabla).toEqual({ r: true, d: false, t: false });
      // Nada para PUBLIC.
      const { rows: publico } = await dueno.query<{ n: string }>(
        `select count(*) as n from pg_class c, aclexplode(c.relacl) a where c.oid = $1::regclass and a.grantee = 0`,
        [tabla],
      );
      expect(Number(publico[0]?.n), `PUBLIC sobre ${tabla}`).toBe(0);
    }
    // Ninguna política de DELETE, y las tablas de solo inserción no tienen política de UPDATE.
    const { rows: politicas } = await dueno.query<{
      tablename: string;
      cmd: string;
      roles: string[];
    }>(
      "select tablename, cmd, roles::text[] as roles from pg_policies where schemaname = 'public' and tablename = any($1)",
      [[...TABLAS]],
    );
    expect(politicas.filter((p) => p.cmd === "DELETE" || p.cmd === "ALL")).toEqual([]);
    for (const p of politicas) expect(p.roles, `${p.tablename} ${p.cmd}`).toEqual(["pedernal_app"]);
    for (const tabla of SOLO_INSERCION) {
      expect(
        politicas.filter((p) => p.tablename === tabla && p.cmd === "UPDATE"),
        tabla,
      ).toEqual([]);
    }
    for (const tabla of TABLAS) {
      expect(
        politicas.filter((p) => p.tablename === tabla && p.cmd === "SELECT").length,
        `SELECT de ${tabla}`,
      ).toBe(1);
      expect(
        politicas.filter((p) => p.tablename === tabla && p.cmd === "INSERT").length,
        `INSERT de ${tabla}`,
      ).toBe(1);
    }
  });

  it("los privilegios son por columna: la aplicación no puede escribir lo que la base fija o lo que se congela", async () => {
    const puede = async (tabla: string, columna: string, privilegio: "INSERT" | "UPDATE") =>
      (
        await dueno.query<{ ok: boolean }>(
          "select has_column_privilege('pedernal_app', $1, $2, $3) as ok",
          [tabla, columna, privilegio],
        )
      ).rows[0]?.ok;
    // La fecha de negocio la fija la base (ticket y corrección): ni se inserta ni se cambia.
    for (const [tabla, columna] of [
      ["ticket", "fecha_negocio"],
      ["ticket_correccion", "fecha_negocio"],
    ] as const) {
      expect(await puede(tabla, columna, "INSERT"), `${tabla}.${columna}`).toBe(false);
      expect(await puede(tabla, columna, "UPDATE"), `${tabla}.${columna}`).toBe(false);
    }
    // Lo congelado no se actualiza.
    for (const [tabla, columna] of [
      ["ticket", "total"],
      ["ticket", "numero"],
      ["ticket", "cuenta_id"],
      ["linea_cuenta", "precio_unitario"],
      ["linea_cuenta", "precio_base"],
      ["linea_cuenta", "cantidad"],
      ["linea_cuenta", "paso_de_cantidad"],
      ["linea_cuenta", "posicion"],
      ["cuenta_consumo", "etiqueta"],
      ["cuenta_consumo", "ancla_id"],
      ["cuenta_consumo", "sucursal_id"],
      ["numerador_ticket", "empresa_id"],
      ["cobranza_de_ticket", "ejemplar_id"],
    ] as const) {
      expect(await puede(tabla, columna, "UPDATE"), `${tabla}.${columna}`).toBe(false);
    }
    // Lo que sí se actualiza es exactamente lo que cambia de estado.
    for (const [tabla, columna] of [
      ["ticket", "estado"],
      ["ticket", "ejemplar_vigente"],
      ["cuenta_consumo", "estado"],
      ["cuenta_consumo", "total_provisorio"],
      ["linea_cuenta", "estado"],
      ["numerador_ticket", "ultimo"],
      ["cobranza_de_ticket", "resultado"],
    ] as const) {
      expect(await puede(tabla, columna, "UPDATE"), `${tabla}.${columna}`).toBe(true);
    }
    // Las de solo inserción no tienen ninguna columna actualizable.
    for (const tabla of SOLO_INSERCION) {
      const { rows } = await dueno.query<{ n: string }>(
        `select count(*) as n from information_schema.columns c where c.table_schema = 'public' and c.table_name = $1
            and has_column_privilege('pedernal_app', $1, c.column_name, 'UPDATE')`,
        [tabla],
      );
      expect(Number(rows[0]?.n), tabla).toBe(0);
    }
  });

  // ---- nada se borra ni se vacía ----------------------------------------------------------------------------------------------

  it("nadie puede DELETE ni TRUNCATE: ni la aplicación, ni el dueño de la base (los frenan los disparadores)", async () => {
    // Todas las tablas tienen filas guardadas en la empresa A.
    for (const tabla of TABLAS) {
      expect(
        await m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [a.empresa]),
        tabla,
      ).toBeGreaterThan(0);
    }
    await conA(async (s) => {
      for (const tabla of TABLAS) {
        denegado(await s.intentar(`delete from ${tabla}`));
        denegado(await s.intentar(`truncate ${tabla}`));
      }
    });
    await dueno.query("begin");
    try {
      for (const tabla of TABLAS) {
        const borrado = await intentoDelDueno(dueno, `delete from ${tabla}`);
        denegado(borrado);
        if (!borrado.ok)
          expect(borrado.mensaje, tabla).toMatch(/no admite borrados|solo inserción/);
        // Una tabla a la que apunta una clave foránea no se vacía sola (0A000: lo frena Postgres antes que el disparador).
        const vaciado = await intentoDelDueno(dueno, `truncate ${tabla}`);
        expect(vaciado.ok, tabla).toBe(false);
        if (!vaciado.ok)
          expect(["42501", "0A000"], `${tabla}: ${vaciado.mensaje}`).toContain(vaciado.codigo);
      }
      // Las once juntas (y el puntero de facturación que apunta a ellas, 0029) sí pasan el control de claves foráneas: ahí es el disparador
      // de cada tabla el que frena.
      const todas = await intentoDelDueno(
        dueno,
        `truncate ${[...TABLAS, "documento_de_ticket"].join(", ")}`,
      );
      denegado(todas);
      if (!todas.ok) expect(todas.mensaje).toMatch(/no admite borrados|solo inserción/);
    } finally {
      await dueno.query("rollback");
    }
    for (const tabla of TABLAS) {
      expect(
        await m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [a.empresa]),
        tabla,
      ).toBeGreaterThan(0);
    }
  });

  // ---- inmutabilidad (P16) ----------------------------------------------------------------------------------------------------

  /** Cada cambio prohibido sobre lo guardado, con lo que dice el disparador cuando lo intenta el dueño (que no tiene los límites de columna). */
  const CAMBIOS = (): readonly Readonly<{
    nombre: string;
    sql: string;
    parametros: unknown[];
    restriccion: string | null;
  }>[] => [
    {
      nombre: "precio_unitario de una línea",
      sql: "update linea_cuenta set precio_unitario = precio_unitario + 1 where id = $1",
      parametros: [f.emitido.linea],
      restriccion: "linea_inmutable",
    },
    {
      nombre: "precio_base de una línea",
      sql: "update linea_cuenta set precio_base = precio_base + 1 where id = $1",
      parametros: [f.emitido.linea],
      restriccion: "linea_inmutable",
    },
    {
      nombre: "cantidad de una línea",
      sql: "update linea_cuenta set cantidad = cantidad + 1 where id = $1",
      parametros: [f.emitido.linea],
      restriccion: "linea_inmutable",
    },
    {
      nombre: "paso de una línea",
      sql: "update linea_cuenta set paso_de_cantidad = 0.5 where id = $1",
      parametros: [f.emitido.linea],
      restriccion: "linea_inmutable",
    },
    {
      nombre: "descripción de una línea",
      sql: "update linea_cuenta set descripcion = 'Otra cosa' where id = $1",
      parametros: [f.emitido.linea],
      restriccion: "linea_inmutable",
    },
    {
      nombre: "posición de una línea",
      sql: "update linea_cuenta set posicion = 2 where id = $1",
      parametros: [f.emitido.linea],
      restriccion: "linea_inmutable",
    },
    {
      nombre: "número de un ticket",
      sql: "update ticket set numero = numero + 100 where id = $1",
      parametros: [f.emitido.ticket],
      restriccion: "ticket_inmutable",
    },
    {
      nombre: "fecha de negocio de un ticket",
      sql: "update ticket set fecha_negocio = fecha_negocio + 1 where id = $1",
      parametros: [f.emitido.ticket],
      restriccion: "ticket_inmutable",
    },
    {
      nombre: "total de un ticket",
      sql: "update ticket set total = total + 1 where id = $1",
      parametros: [f.emitido.ticket],
      restriccion: "ticket_inmutable",
    },
    {
      nombre: "cuenta de un ticket",
      sql: "update ticket set cuenta_id = $2 where id = $1",
      parametros: [f.emitido.ticket, f.abierta.cuenta],
      restriccion: "ticket_inmutable",
    },
    {
      nombre: "quién emitió un ticket",
      sql: "update ticket set emitido_por = $2 where id = $1",
      parametros: [f.emitido.ticket, b.gerente.personaId],
      restriccion: "ticket_inmutable",
    },
    {
      nombre: "etiqueta de una cuenta",
      sql: "update cuenta_consumo set etiqueta = 'Otra' where id = $1",
      parametros: [f.abierta.cuenta],
      restriccion: "cuenta_inmutable",
    },
    {
      nombre: "ancla de una cuenta",
      sql: "update cuenta_consumo set ancla_id = $2 where id = $1",
      parametros: [f.abierta.cuenta, nuevoId()],
      restriccion: "cuenta_inmutable",
    },
    {
      nombre: "sucursal de una cuenta",
      sql: "update cuenta_consumo set sucursal_id = $2 where id = $1",
      parametros: [f.abierta.cuenta, a.otraSucursal],
      restriccion: "cuenta_inmutable",
    },
    {
      nombre: "total de una cuenta cerrada",
      sql: "update cuenta_consumo set total_provisorio = total_provisorio + 1 where id = $1",
      parametros: [f.emitido.cuenta],
      restriccion: "cuenta_resuelta_congelada",
    },
    {
      nombre: "estado de una cuenta cerrada",
      sql: "update cuenta_consumo set estado = 'ABIERTA', resuelta_en = null, resuelta_por = null where id = $1",
      parametros: [f.emitido.cuenta],
      restriccion: "cuenta_resuelta_congelada",
    },
    {
      nombre: "estado de una cuenta anulada",
      sql: "update cuenta_consumo set estado = 'ABIERTA', resuelta_en = null, resuelta_por = null, motivo = null where id = $1",
      parametros: [f.cuentaAnulada],
      restriccion: "cuenta_resuelta_congelada",
    },
    {
      nombre: "un ejemplar",
      sql: "update ticket_ejemplar set total = total + 1 where id = $1",
      parametros: [f.emitido.ejemplar],
      restriccion: null,
    },
    {
      nombre: "un grupo de ejemplar",
      sql: "update ejemplar_grupo set total = total + 1 where ejemplar_id = $1",
      parametros: [f.emitido.ejemplar],
      restriccion: null,
    },
    {
      nombre: "un renglón de ejemplar",
      sql: "update ejemplar_linea set importe = importe + 1 where ejemplar_id = $1",
      parametros: [f.emitido.ejemplar],
      restriccion: null,
    },
    {
      nombre: "la foto de opciones de una línea",
      sql: "update linea_cuenta_opcion set recargo = 0 where linea_id = $1",
      parametros: [f.abierta.linea],
      restriccion: null,
    },
    {
      nombre: "una aplicación de cobro",
      sql: "update aplicacion_de_cobro set importe = importe + 1 where cobranza_id = $1",
      parametros: [f.cobrado.cobranza],
      restriccion: null,
    },
    {
      nombre: "un registro de corrección",
      sql: "update ticket_correccion set motivo = 'Otro' where ticket_id = $1",
      parametros: [f.anulado.ticket],
      restriccion: null,
    },
    {
      nombre: "la clave de una cobranza",
      sql: "update cobranza_de_ticket set clave = 'otra-clave-12345678' where id = $1",
      parametros: [f.cobrado.cobranza],
      restriccion: "cobranza_inmutable",
    },
  ];

  it("P16: un UPDATE de precio, cantidad, número, fecha, total, ejemplar, renglón o aplicación se rechaza con el rol de la aplicación", async () => {
    await conA(async (s) => {
      for (const c of CAMBIOS()) {
        const r = await s.intentar(c.sql, c.parametros);
        expect(r.ok, c.nombre).toBe(false);
        // Lo que la aplicación no tiene concedido es `42501`; lo que sí (p. ej. el total de una cuenta cerrada) lo frena un disparador.
        if (!r.ok) expect(["42501", "23514"], `${c.nombre}: ${r.mensaje}`).toContain(r.codigo);
      }
    });
  });

  it("P16: lo mismo para el DUEÑO de la base, que no tiene límites de columna: lo frenan los disparadores", async () => {
    await dueno.query("begin");
    try {
      for (const c of CAMBIOS()) {
        const r = await intentoDelDueno(dueno, c.sql, c.parametros);
        expect(r.ok, c.nombre).toBe(false);
        if (r.ok) continue;
        if (c.restriccion === null) {
          // Las tablas de solo inserción: 42501 de `solo_insercion()`.
          expect(r.codigo, `${c.nombre}: ${r.mensaje}`).toBe("42501");
          expect(r.mensaje, c.nombre).toMatch(/solo inserción/);
        } else {
          expect(r.codigo, `${c.nombre}: ${r.mensaje}`).toBe("23514");
          expect(r.restriccion, c.nombre).toBe(c.restriccion);
        }
      }
    } finally {
      await dueno.query("rollback");
    }
    // Nada cambió.
    expect(
      (
        await m.filas<{ total: string }>("select total::text as total from ticket where id = $1", [
          f.emitido.ticket,
        ])
      )[0]?.total,
    ).toBe("2000.00");
  });

  it("una línea no se edita: anularla es lo único que cambia, con la persona del contexto y solo en una cuenta abierta", async () => {
    await conA(async (s) => {
      // La persona que anula tiene que ser la del contexto.
      check(
        await s.intentar(
          `update linea_cuenta set estado = 'ANULADA', anulada_por = $2, anulada_en = $3, motivo_de_anulacion = 'Error' where id = $1`,
          [f.abierta.linea, b.gerente.personaId, AHORA],
        ),
        "linea_persona_del_contexto",
      );
      // Una línea de una cuenta cerrada no se anula.
      check(
        await s.intentar(
          `update linea_cuenta set estado = 'ANULADA', anulada_por = $2, anulada_en = $3, motivo_de_anulacion = 'Error' where id = $1`,
          [f.emitido.linea, a.gerente.personaId, AHORA],
        ),
        "linea_cuenta_no_abierta",
      );
      // La marca de anulación sin el estado, o el estado sin motivo, no pasan el CHECK.
      check(
        await s.intentar(
          `update linea_cuenta set estado = 'ANULADA', anulada_por = $2, anulada_en = $3 where id = $1`,
          [f.abierta.linea, a.gerente.personaId, AHORA],
        ),
        "linea_anulada_ck",
      );
      // Anular bien: se puede, y después queda congelada.
      filas(
        await s.intentar(
          `update linea_cuenta set estado = 'ANULADA', anulada_por = $2, anulada_en = $3, motivo_de_anulacion = 'Error' where id = $1`,
          [f.abierta.linea, a.gerente.personaId, AHORA],
        ),
        1,
      );
      check(
        await s.intentar(
          "update linea_cuenta set motivo_de_anulacion = 'Otro motivo' where id = $1",
          [f.abierta.linea],
        ),
        "linea_anulada_congelada",
      );
      check(
        await s.intentar(
          `update linea_cuenta set estado = 'VIGENTE', anulada_por = null, anulada_en = null, motivo_de_anulacion = null where id = $1`,
          [f.abierta.linea],
        ),
        "linea_anulada_congelada",
      );
    });
    // Una línea que ya estaba anulada en la base (la de la cuenta anulada) tampoco se reactiva.
    await conA(async (s) => {
      const anulada = (
        await m.filas<{ id: string }>("select id from linea_cuenta where cuenta_id = $1", [
          f.cuentaAnulada,
        ])
      )[0]?.id;
      expect(anulada).toBeDefined();
      // Esa línea quedó VIGENTE (anular la cuenta no anula sus líneas): no hay nada que reactivar; probar con la del ticket anulado.
      check(
        await s.intentar(
          `update linea_cuenta set estado = 'ANULADA', anulada_por = $2, anulada_en = $3, motivo_de_anulacion = 'Error' where id = $1`,
          [anulada, a.gerente.personaId, AHORA],
        ),
        "linea_cuenta_no_abierta",
      );
    });
  });

  it("una línea solo entra a una cuenta abierta, con una posición reservada, y nace vigente", async () => {
    await conA(async (s) => {
      const w = mundoDe(a);
      const insertar = (cuenta: string, posicion: number) =>
        s.intentar(
          `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                    precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en)
           values ($1, $2, $3, $4, $5, 'X', $6, 'EMPRESA', 1, 1, 1, 'UNIDAD', 1, '21', false, $7, $8)`,
          [randomUUID(), w.empresa, cuenta, posicion, randomUUID(), randomUUID(), w.persona, AHORA],
        );
      // Una cuenta cerrada, una anulada y una inexistente.
      check(await insertar(f.emitido.cuenta, 3), "linea_cuenta_no_abierta");
      check(await insertar(f.cuentaAnulada, 3), "linea_cuenta_no_abierta");
      check(await insertar(nuevoId(), 1), "linea_cuenta_no_abierta");
      // La cuenta abierta tiene reservada la posición 1: la 2 no está reservada.
      check(await insertar(f.abierta.cuenta, 2), "linea_posicion_no_reservada");
      // La posición 1 ya está tomada.
      expect(await insertar(f.abierta.cuenta, 1)).toMatchObject({
        ok: false,
        codigo: "23505",
        restriccion: "linea_posicion_uk",
      });
      // El estado no se puede fijar al insertar (la columna no está concedida).
      denegado(
        await s.intentar(
          `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                    precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, creada_por, creada_en, estado)
           values ($1, $2, $3, 1, $4, 'X', $5, 'EMPRESA', 1, 1, 1, 'UNIDAD', 1, '21', $6, $7, 'ANULADA')`,
          [randomUUID(), w.empresa, f.abierta.cuenta, randomUUID(), randomUUID(), w.persona, AHORA],
        ),
      );
    });
  });

  it("la cantidad y el precio de una línea respetan sus CHECK: múltiplo del paso, cota 9999, precio mínimo la base, sin NaN", async () => {
    await conA(async (s) => {
      const w = mundoDe(a);
      const cuenta = await cuentaSql(s, w);
      const probar = async (l: Partial<LineaSql>, restriccion: string) => {
        // Cada intento reserva su propia posición dentro de un savepoint: sirve porque solo importa el CHECK inmediato.
        const [{ ultima_posicion: p }] = (await paso(
          s,
          "update cuenta_consumo set ultima_posicion = ultima_posicion + 1 where id = $1 returning ultima_posicion",
          [cuenta],
        )) as [{ ultima_posicion: number }];
        check(
          await s.intentar(
            `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                      precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en)
             values ($1, $2, $3, $4, $5, 'X', $6, 'EMPRESA', $7, $8, $9, 'UNIDAD', $10, '21', false, $11, $12)`,
            [
              randomUUID(),
              w.empresa,
              cuenta,
              p,
              randomUUID(),
              randomUUID(),
              l.base ?? "100",
              l.unitario ?? "100",
              l.cantidad ?? "1",
              l.paso ?? "1",
              w.persona,
              AHORA,
            ],
          ),
          restriccion,
        );
      };
      await probar({ cantidad: "0.5" }, "linea_cantidad_multiplo_ck");
      await probar({ cantidad: "1.5", paso: "1" }, "linea_cantidad_multiplo_ck");
      await probar({ cantidad: "0.25", paso: "0.5" }, "linea_cantidad_multiplo_ck");
      await probar({ cantidad: "10000" }, "linea_cantidad_ck");
      await probar({ cantidad: "0" }, "linea_cantidad_ck");
      await probar({ cantidad: "-1" }, "linea_cantidad_ck");
      await probar({ cantidad: "NaN" }, "linea_cantidad_ck");
      await probar({ unitario: "99", base: "100" }, "linea_precio_unitario_minimo_ck");
      await probar({ unitario: "-1", base: "-1" }, "linea_precio_base_ck");
      await probar({ unitario: "NaN", base: "NaN" }, "linea_precio_base_ck");
      await probar({ unitario: "1000000000", base: "1000000000" }, "linea_precio_base_ck");
      // Con paso 0, `cantidad % paso` divide por cero (22012) antes de llegar al CHECK del paso: se rechaza igual, pero sin nombre.
      const [{ ultima_posicion: p0 }] = (await paso(
        s,
        "update cuenta_consumo set ultima_posicion = ultima_posicion + 1 where id = $1 returning ultima_posicion",
        [cuenta],
      )) as [{ ultima_posicion: number }];
      const conPasoCero = await s.intentar(
        `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                  precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, 'X', $6, 'EMPRESA', 100, 100, 1, 'UNIDAD', 0, '21', false, $7, $8)`,
        [randomUUID(), w.empresa, cuenta, p0, randomUUID(), randomUUID(), w.persona, AHORA],
      );
      expect(conPasoCero.ok).toBe(false);
      if (!conPasoCero.ok) expect(["23514", "22012"]).toContain(conPasoCero.codigo);
    });
  });

  // ---- numerador sin huecos (V3) ----------------------------------------------------------------------------------------------

  it("numerador_sin_huecos: incrementar el numerador sin crear el ticket falla al confirmar", async () => {
    const e = await m.escenario();
    await conAppDe(b0(), mundoDe(e), async (s) => {
      const w = mundoDe(e);
      await numeroSql(s, w);
      check(await s.confirmar(), "numerador_sin_huecos");
    });
    // Nada quedó: la transacción se revirtió y no hay numerador.
    expect(
      await m.contar("select count(*) as n from numerador_ticket where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(0);
  });

  it("numerador_sin_huecos: con el ticket que toma ese número, confirma; el siguiente vuelve a exigirlo", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    await conAppDe(b0(), w, async (s) => {
      const v = await armarVenta(s, w, {
        lineas: [{ unitario: "100", cantidad: "1" }],
        total: "100.00",
      });
      expect(v.numero).toBe(1);
      acepta(await s.confirmar());
    });
    await conAppDe(b0(), w, async (s) => {
      // Un segundo incremento sin ticket: el 2 no tiene ticket.
      await paso(
        s,
        "update numerador_ticket set ultimo = ultimo + 1 where empresa_id = $1 and sucursal_id = $2",
        [w.empresa, w.sucursal],
      );
      check(await s.confirmar(), "numerador_sin_huecos");
    });
    expect(
      await m.contar("select ultimo as n from numerador_ticket where empresa_id = $1", [e.empresa]),
    ).toBe(1);
  });

  it("el ticket tiene que tomar exactamente el número que acaba de dar el numerador (ticket_numero_invalido)", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    // Con otro número que el del numerador.
    for (const delta of [-1, 1, 5]) {
      await conAppDe(b0(), w, async (s) => {
        const cuenta = await cuentaSql(s, w);
        await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
        await totalSql(s, cuenta, "100.00");
        await cerrarSql(s, w, cuenta);
        const numero = await numeroSql(s, w);
        // `numero + delta` deja un hueco o repite: el disparador lo frena antes de insertar.
        const r = await ticketSql(
          s,
          w,
          cuenta,
          Math.max(1, numero + delta + (delta === -1 ? 1 : 0)),
          "100.00",
        );
        if (numero + delta + (delta === -1 ? 1 : 0) === numero) acepta(r);
        else check(r, "ticket_numero_invalido");
      });
    }
    // Sin pasar por el numerador: no hay número que tomar.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      check(await ticketSql(s, w, cuenta, 1, "100.00"), "ticket_numero_invalido");
    });
  });

  it("el numerador solo sube de a uno, arranca en cero y no se puede escribir su valor al crearlo", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    await conAppDe(b0(), w, async (s) => {
      denegado(
        await s.intentar(
          "insert into numerador_ticket (empresa_id, sucursal_id, ultimo) values ($1, $2, 5)",
          [w.empresa, w.sucursal],
        ),
      );
      await paso(s, "insert into numerador_ticket (empresa_id, sucursal_id) values ($1, $2)", [
        w.empresa,
        w.sucursal,
      ]);
      const salto = (valor: string) =>
        s.intentar(
          `update numerador_ticket set ultimo = ${valor} where empresa_id = $1 and sucursal_id = $2`,
          [w.empresa, w.sucursal],
        );
      check(await salto("ultimo + 2"), "numerador_solo_sube_de_a_uno");
      check(await salto("ultimo - 1"), "numerador_solo_sube_de_a_uno");
      check(await salto("ultimo"), "numerador_solo_sube_de_a_uno");
      check(await salto("2000000000"), "numerador_solo_sube_de_a_uno");
      filas(await salto("ultimo + 1"), 1);
    });
    // El numerador de una sucursal que no es de la empresa no existe (FK compuesta).
    await conAppDe(b0(), w, async (s) => {
      expect(
        await s.intentar("insert into numerador_ticket (empresa_id, sucursal_id) values ($1, $2)", [
          w.empresa,
          b.sucursal,
        ]),
      ).toMatchObject({ ok: false, codigo: "23503", restriccion: "numerador_sucursal_fkey" });
    });
  });

  // ---- la fecha de negocio la fija la base (V5) -------------------------------------------------------------------------------

  it("la base fija la fecha de negocio del ticket con el reloj y la zona de la empresa: la aplicación no la puede mandar", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    await conAppDe(b0(), w, async (s) => {
      const v = await armarVenta(s, w, {
        lineas: [{ unitario: "100", cantidad: "1" }],
        total: "100.00",
      });
      const leida = await paso(s, "select fecha_negocio::text as f from ticket where id = $1", [
        v.ticket,
      ]);
      expect(leida).toEqual([{ f: FECHA }]);
    });
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      // La columna `fecha_negocio` no está concedida: ni con la fecha correcta.
      denegado(
        await s.intentar(
          `insert into ticket (id, empresa_id, sucursal_id, cuenta_id, numero, fecha_negocio, estado, total, emitido_por, emitido_en)
           values ($1, $2, $3, $4, $5, '2026-11-09', 'EMITIDO', 100, $6, $7)`,
          [randomUUID(), w.empresa, w.sucursal, cuenta, numero, w.persona, AHORA],
        ),
      );
    });
    // La corrección también se fecha sola.
    await conAppDe(b0(), mundoDe(a), async (s) => {
      denegado(
        await s.intentar(
          `insert into ticket_correccion (id, empresa_id, ticket_id, ejemplar_base_id, ejemplar_nuevo_id, tipo, motivo, clave, huella, resultado, hecha_por, hecha_en, fecha_negocio)
           values ($1, $2, $3, $4, $5, 'ANULACION', 'Error', $6, $7, '{}'::jsonb, $8, $9, '2020-01-01')`,
          [
            randomUUID(),
            a.empresa,
            f.emitido.ticket,
            f.emitido.ejemplar,
            nuevoId(),
            nuevaClave(),
            HUELLA,
            a.gerente.personaId,
            AHORA,
          ],
        ),
      );
    });
  });

  it("P17: la fórmula de la base (fecha_de_negocio_de) coincide con la de TypeScript para varios cortes, zonas e instantes", async () => {
    const e = await m.escenario();
    const instantes = [
      "2026-11-10T02:59:00Z",
      "2026-11-10T03:00:00Z",
      "2026-11-10T04:25:00Z",
      "2026-11-10T08:59:00Z",
      "2026-11-10T09:00:00Z",
      "2026-03-29T00:30:00Z",
      "2026-03-29T01:30:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-25T01:30:00Z",
      "2026-12-31T23:59:00Z",
      "2027-01-01T02:00:00Z",
    ];
    const cortes = ["00:00", "04:00", "06:00", "12:30", "23:59"];
    await dueno.query("begin");
    try {
      for (const zona of [
        "America/Argentina/Buenos_Aires",
        "Europe/Madrid",
        "Asia/Kolkata",
        "UTC",
      ]) {
        await dueno.query("update empresa set zona_horaria = $2 where id = $1", [e.empresa, zona]);
        for (const corte of cortes) {
          await dueno.query("update sucursal set hora_de_corte = $2 where id = $1", [
            e.sucursal,
            corte,
          ]);
          for (const instante of instantes) {
            const { rows } = await dueno.query<{ f: string }>(
              "select fecha_de_negocio_de($1, $2, $3::timestamptz)::text as f",
              [e.empresa, e.sucursal, instante],
            );
            const esperada = fechaDeNegocio(new Date(instante), zona, corte);
            expect(esperada.ok, `${zona} ${corte} ${instante}`).toBe(true);
            expect(rows[0]?.f, `${zona} corte ${corte} ${instante}`).toBe(
              esperada.ok ? esperada.valor : null,
            );
          }
        }
      }
      // Una sucursal que no es de la empresa no tiene fecha: nunca se inventa una.
      const { rows } = await dueno.query<{ f: string | null }>(
        "select fecha_de_negocio_de($1, $2, now())::text as f",
        [e.empresa, b.sucursal],
      );
      expect(rows[0]?.f).toBeNull();
    } finally {
      await dueno.query("rollback");
    }
  });

  it("fase B: un ticket con sesión de caja toma la fecha de ESA sesión (también pasada la hora de corte); la sesión tiene que existir, ser de su empresa y sucursal y no de una jornada futura", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    const otraEmpresa = await m.escenario();
    const propia = await m.cajaAbierta(e); // sesión del 2026-11-09
    const deOtraSucursal = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    const deOtraEmpresa = await m.cajaAbierta(otraEmpresa);
    const futura = await m.cajaAbierta(e, {
      contexto: { ...e.gerente, ahora: new Date("2026-11-10T15:00:00Z") },
    });
    expect(futura.fechaDeNegocio).toBe("2026-11-10");
    const armar = async (s: SesionDePrueba) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      return { cuenta, numero: await numeroSql(s, w) };
    };
    // Pasada la hora de corte (00:30 del 10 en Argentina) el reloj dice el 10, pero la sesión es del 09: el ticket es del 09.
    await conAppDe(b0(), w, async (s) => {
      const { cuenta, numero } = await armar(s);
      const id = randomUUID();
      acepta(
        await ticketSql(s, w, cuenta, numero, "100.00", {
          id,
          sesion: propia.sesionId,
          emitidoEn: "2026-11-10T03:30:00Z",
        }),
      );
      expect(
        await paso(s, "select fecha_negocio::text as f from ticket where id = $1", [id]),
      ).toEqual([{ f: "2026-11-09" }]);
    });
    // Sin sesión, a la misma hora, rige el reloj: el 10.
    await conAppDe(b0(), w, async (s) => {
      const { cuenta, numero } = await armar(s);
      const id = randomUUID();
      acepta(
        await ticketSql(s, w, cuenta, numero, "100.00", { id, emitidoEn: "2026-11-10T03:30:00Z" }),
      );
      expect(
        await paso(s, "select fecha_negocio::text as f from ticket where id = $1", [id]),
      ).toEqual([{ f: "2026-11-10" }]);
    });
    // Una sesión que no existe, de otra sucursal, de otra empresa o de una jornada posterior a la del reloj: se rechaza.
    for (const [nombre, sesion] of [
      ["inexistente", randomUUID()],
      ["de otra sucursal", deOtraSucursal.sesionId],
      ["de otra empresa", deOtraEmpresa.sesionId],
      ["de una jornada futura", futura.sesionId],
    ] as const) {
      await conAppDe(b0(), w, async (s) => {
        const { cuenta, numero } = await armar(s);
        check(
          await ticketSql(s, w, cuenta, numero, "100.00", { sesion }),
          "ticket_fecha_de_sesion_invalida",
        );
      }).catch((error: unknown) => {
        throw new Error(`sesión ${nombre}: ${String(error)}`);
      });
    }
  });

  // ---- cuadres diferidos ------------------------------------------------------------------------------------------------------

  it("cuenta_total_cuadra: el total de la cuenta es SIEMPRE el redondeo de la suma exacta de sus líneas vigentes (al confirmar)", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    // Un total de más, de menos y sin líneas.
    for (const total of ["100.01", "99.99", "0.00", "200.00"]) {
      await conAppDe(b0(), w, async (s) => {
        const cuenta = await cuentaSql(s, w);
        await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
        await totalSql(s, cuenta, total);
        check(await s.confirmar(), "cuenta_total_cuadra");
      });
    }
    // Una línea sin actualizar el total de la cuenta.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      check(await s.confirmar(), "cuenta_total_cuadra");
    });
    // Una línea anulada ya no suma: dejar el total viejo no cuadra.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1", anulada: true });
      await totalSql(s, cuenta, "100.00");
      check(await s.confirmar(), "cuenta_total_cuadra");
    });
    // El redondeo es uno solo, sobre la suma exacta (0,5 × 9,95 + 0,5 × 9,95 = 9,95; no 9,96) y mitad hacia arriba.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "9.95", cantidad: "0.5", paso: "0.5" });
      await lineaSql(s, w, cuenta, { unitario: "9.95", cantidad: "0.5", paso: "0.5" });
      await totalSql(s, cuenta, "9.96");
      check(await s.confirmar(), "cuenta_total_cuadra");
    });
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "9.95", cantidad: "0.5", paso: "0.5" });
      await lineaSql(s, w, cuenta, { unitario: "9.95", cantidad: "0.5", paso: "0.5" });
      await totalSql(s, cuenta, "9.95");
      acepta(await s.confirmar());
    });
    await conAppDe(b0(), w, async (s) => {
      // 0,5 × 0,01 = 0,005 → redondea hacia arriba a 0,01.
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "0.01", cantidad: "0.5", paso: "0.5" });
      await totalSql(s, cuenta, "0.01");
      acepta(await s.confirmar());
    });
  });

  it("linea_precio_cuadra: el precio de la línea es el base más los recargos de las opciones fotografiadas (al confirmar)", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    const foto = (s: SesionDePrueba, linea: string, orden: number, recargo: string) =>
      s.directo(
        `insert into linea_cuenta_opcion (empresa_id, linea_id, orden, opcion_id, version_de_opcion_id, grupo_id, nombre_de_grupo, nombre, clase, recargo, origen_del_recargo)
         values ($1, $2, $3, $4, $5, $6, 'Extras', 'Leche', 'ADICIONAL', $7, 'EMPRESA')`,
        [w.empresa, linea, orden, randomUUID(), randomUUID(), randomUUID(), recargo],
      );
    // Sin opciones, el unitario tiene que ser la base.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { base: "100", unitario: "150", cantidad: "1" });
      await totalSql(s, cuenta, "150.00");
      check(await s.confirmar(), "linea_precio_cuadra");
    });
    // Con una opción de 50: 100 + 50 cuadra; 100 + 60 no.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      const linea = await lineaSql(s, w, cuenta, { base: "100", unitario: "150", cantidad: "1" });
      acepta(await foto(s, linea, 1, "50"));
      await totalSql(s, cuenta, "150.00");
      acepta(await s.confirmar());
    });
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      const linea = await lineaSql(s, w, cuenta, { base: "100", unitario: "150", cantidad: "1" });
      acepta(await foto(s, linea, 1, "60"));
      await totalSql(s, cuenta, "150.00");
      check(await s.confirmar(), "linea_precio_cuadra");
    });
  });

  it("la foto de opciones de una línea ya guardada no se puede agregar (linea_opcion_solo_con_la_linea) ni repetir", async () => {
    await conAppDe(b0(), mundoDe(a), async (s) => {
      const r = await s.intentar(
        `insert into linea_cuenta_opcion (empresa_id, linea_id, orden, opcion_id, version_de_opcion_id, grupo_id, nombre_de_grupo, nombre, clase, recargo, origen_del_recargo)
         values ($1, $2, 9, $3, $4, $5, 'Extras', 'Miel', 'ADICIONAL', 0, 'EMPRESA')`,
        [a.empresa, f.abierta.linea, randomUUID(), randomUUID(), randomUUID()],
      );
      check(r, "linea_opcion_solo_con_la_linea");
    });
  });

  it("ejemplar_cuadra: renglones que no suman el grupo, o grupos que no suman el total, fallan al confirmar aun saltándose el código", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    const una = { lineas: [{ unitario: "100", cantidad: "2" }], total: "200.00" } as const;
    const dos = {
      lineas: [
        { unitario: "100", cantidad: "1" },
        { unitario: "50", cantidad: "2" },
      ],
      total: "200.00",
    } as const;
    const casos: [string, Parameters<typeof armarVenta>[2]][] = [
      ["un renglón de menos un centavo", { ...una, renglones: ["199.99"] }],
      ["un renglón de más un centavo", { ...una, renglones: ["200.01"] }],
      ["el grupo no suma sus renglones", { ...una, totalGrupo: "199.99" }],
      [
        "el total del ejemplar no es el de sus grupos",
        { ...una, totalEjemplar: "199.00", totalTicket: "200.00" },
      ],
      ["dos renglones que suman otra cosa", { ...dos, renglones: ["100.00", "99.00"] }],
    ];
    for (const [nombre, o] of casos) {
      await conAppDe(b0(), w, async (s) => {
        await armarVenta(s, w, o);
        check(await s.confirmar(), "ejemplar_cuadra");
      }).catch((error: unknown) => {
        throw new Error(`${nombre}: ${String(error)}`);
      });
    }
    // Lo correcto confirma, con dos renglones.
    await conAppDe(b0(), w, async (s) => {
      await armarVenta(s, w, dos);
      acepta(await s.confirmar());
    });
  });

  it("el original refleja TODAS las líneas vigentes de la cuenta, con su cantidad, y solo ellas (ejemplar_original_no_refleja_la_cuenta)", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    const dos = [
      { unitario: "100", cantidad: "1" },
      { unitario: "50", cantidad: "2" },
    ];
    // Falta el renglón de una línea vigente, aunque el ejemplar cuadre consigo mismo (100 = 100).
    await conAppDe(b0(), w, async (s) => {
      await armarVenta(s, w, {
        lineas: dos,
        total: "200.00",
        renglones: ["100.00", null],
        totalGrupo: "100.00",
        totalEjemplar: "100.00",
      });
      check(await s.confirmar(), "ejemplar_original_no_refleja_la_cuenta");
    });
    // La cantidad del renglón no es la de la línea (1 de las 2 que se vendieron), con el ejemplar cuadrando.
    await conAppDe(b0(), w, async (s) => {
      await armarVenta(s, w, {
        lineas: [
          { unitario: "100", cantidad: "2" },
          { unitario: "50", cantidad: "1" },
        ],
        total: "250.00",
        cantidades: ["1", "1"],
        renglones: ["200.00", "50.00"],
      });
      check(await s.confirmar(), "ejemplar_original_no_refleja_la_cuenta");
    });
    // Un renglón de una línea ANULADA dentro del original (ticket y ejemplar con el mismo total: 150).
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      const vigente = await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      const anulada = await lineaSql(s, w, cuenta, {
        unitario: "50",
        cantidad: "1",
        anulada: true,
      });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      const ticket = randomUUID();
      acepta(await ticketSql(s, w, cuenta, numero, "100.00", { id: ticket }));
      const ejemplar = randomUUID();
      acepta(await ejemplarSql(s, w, ticket, ejemplar, "150.00"));
      acepta(await grupoSql(s, w, ejemplar, "150.00"));
      acepta(await renglonSql(s, w, ejemplar, vigente, "1", "100.00"));
      acepta(await renglonSql(s, w, ejemplar, anulada, "1", "50.00"));
      check(await s.confirmar(), "ejemplar_original_no_refleja_la_cuenta");
    });
    // Un renglón de una línea de OTRA cuenta (de la misma empresa).
    await conAppDe(b0(), w, async (s) => {
      const otra = await cuentaSql(s, w);
      const ajena = await lineaSql(s, w, otra, { unitario: "100", cantidad: "1" });
      await totalSql(s, otra, "100.00");
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      const ticket = randomUUID();
      acepta(await ticketSql(s, w, cuenta, numero, "100.00", { id: ticket }));
      const ejemplar = randomUUID();
      acepta(await ejemplarSql(s, w, ticket, ejemplar, "100.00"));
      acepta(await grupoSql(s, w, ejemplar, "100.00"));
      acepta(await renglonSql(s, w, ejemplar, ajena, "1", "100.00"));
      check(await s.confirmar(), "ejemplar_linea_ajena");
    });
    // Un renglón con más cantidad que la línea.
    await conAppDe(b0(), w, async (s) => {
      await armarVenta(s, w, {
        lineas: [{ unitario: "100", cantidad: "1" }],
        total: "100.00",
        cantidades: ["2"],
        renglones: ["100.00"],
      });
      check(await s.confirmar(), "ejemplar_linea_ajena");
    });
    // Lo correcto, con una línea anulada de por medio, confirma.
    await conAppDe(b0(), w, async (s) => {
      await armarVenta(s, w, {
        lineas: [
          { unitario: "100", cantidad: "1" },
          { unitario: "70", cantidad: "1", anulada: true },
          { unitario: "50", cantidad: "2" },
        ],
        total: "200.00",
      });
      acepta(await s.confirmar());
    });
  });

  it("el total del ejemplar ORIGINAL es el del ticket y el de la cuenta: un original que cuadra consigo mismo pero con otro total se rechaza", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    // El ticket y la cuenta dicen 100; el ejemplar original dice 150 (con su renglón de 150): cuadra por dentro, pero no es el ticket.
    await conAppDe(b0(), w, async (s) => {
      await armarVenta(s, w, {
        lineas: [{ unitario: "100", cantidad: "1" }],
        total: "100.00",
        totalEjemplar: "150.00",
        totalGrupo: "150.00",
        renglones: ["150.00"],
      });
      const r = await s.confirmar();
      expect(r.ok, "el original no puede tener otro total que el ticket").toBe(false);
    });
  });

  /** Cuenta con una línea, cerrada, con su número y su ticket, pero SIN ejemplar: para probar cómo entra el ejemplar original. */
  const ticketSinEjemplar = async (s: SesionDePrueba, w: Mundo) => {
    const cuenta = await cuentaSql(s, w);
    const linea = await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
    await totalSql(s, cuenta, "100.00");
    await cerrarSql(s, w, cuenta);
    const numero = await numeroSql(s, w);
    const ticket = randomUUID();
    acepta(await ticketSql(s, w, cuenta, numero, "100.00", { id: ticket }));
    return { cuenta, linea, ticket };
  };

  it("una corrección bien armada (ejemplar 2 que cuelga del 1, con sus renglones) confirma; si no cuadra, no", async () => {
    const w = mundoDe(a);
    for (const [importe, cuadra] of [
      ["1000.00", true],
      ["999.99", false],
    ] as const) {
      const t = await emitidoNuevo("2");
      const linea = (
        await m.filas<{ id: string }>("select id from linea_cuenta where cuenta_id = $1", [
          t.cuenta,
        ])
      )[0]?.id as string;
      await conA(async (s) => {
        const nuevo = randomUUID();
        await paso(s, "update ticket set ejemplar_vigente = 2 where id = $1", [t.ticketId]);
        acepta(
          await ejemplarSql(s, w, t.ticketId, nuevo, "1000.00", {
            numero: 2,
            tipo: "CORRECCION",
            base: t.ejemplarId,
          }),
        );
        acepta(await grupoSql(s, w, nuevo, "1000.00"));
        acepta(await renglonSql(s, w, nuevo, linea, "1", importe));
        if (cuadra) acepta(await s.confirmar());
        else check(await s.confirmar(), "ejemplar_cuadra");
      });
    }
  });

  it("una corrección no sube la cantidad de la línea ni la parte del paso (ejemplar_linea_ajena)", async () => {
    const w = mundoDe(a);
    for (const cantidad of ["3", "1.5"]) {
      const t = await emitidoNuevo("2");
      const linea = (
        await m.filas<{ id: string }>("select id from linea_cuenta where cuenta_id = $1", [
          t.cuenta,
        ])
      )[0]?.id as string;
      await conA(async (s) => {
        const nuevo = randomUUID();
        await paso(s, "update ticket set ejemplar_vigente = 2 where id = $1", [t.ticketId]);
        acepta(
          await ejemplarSql(s, w, t.ticketId, nuevo, "1000.00", {
            numero: 2,
            tipo: "CORRECCION",
            base: t.ejemplarId,
          }),
        );
        acepta(await grupoSql(s, w, nuevo, "1000.00"));
        acepta(await renglonSql(s, w, nuevo, linea, cantidad, "1000.00"));
        check(await s.confirmar(), "ejemplar_linea_ajena");
      });
    }
  });

  it("el ejemplar nuevo es el vigente del ticket, creado en la misma transacción, con su base inmediata, y el tipo va con el estado del ticket", async () => {
    const w = mundoDe(a);
    // Un ejemplar nuevo sin subir el ejemplar vigente del ticket.
    await conA(async (s) => {
      check(
        await ejemplarSql(s, w, f.emitido.ticket, randomUUID(), "1000.00", {
          numero: 2,
          tipo: "CORRECCION",
          base: f.emitido.ejemplar,
        }),
        "ejemplar_no_es_el_vigente",
      );
    });
    // Subiendo el vigente: una base que no es el ejemplar anterior de ese ticket, o una ANULACION sin anular.
    await conA(async (s) => {
      await paso(s, "update ticket set ejemplar_vigente = 2 where id = $1", [f.emitido.ticket]);
      check(
        await ejemplarSql(s, w, f.emitido.ticket, randomUUID(), "1000.00", {
          numero: 2,
          tipo: "CORRECCION",
          base: randomUUID(),
        }),
        "ejemplar_base_invalida",
      );
    });
    await conA(async (s) => {
      await paso(s, "update ticket set ejemplar_vigente = 2 where id = $1", [f.emitido.ticket]);
      check(
        await ejemplarSql(s, w, f.emitido.ticket, randomUUID(), "0.00", {
          numero: 2,
          tipo: "ANULACION",
          base: f.emitido.ejemplar,
        }),
        "ejemplar_anulacion_invalida",
      );
    });
    // Una base que es de OTRO ticket de la misma empresa tampoco vale.
    await conA(async (s) => {
      await paso(s, "update ticket set ejemplar_vigente = 2 where id = $1", [f.emitido.ticket]);
      check(
        await ejemplarSql(s, w, f.emitido.ticket, randomUUID(), "1000.00", {
          numero: 2,
          tipo: "CORRECCION",
          base: f.cortesia.ejemplar,
        }),
        "ejemplar_base_invalida",
      );
    });
    // Los grupos y renglones de un ejemplar ya guardado no entran después.
    await conA(async (s) => {
      check(
        await grupoSql(s, w, f.emitido.ejemplar, "1.00"),
        "ejemplar_contenido_solo_con_el_ejemplar",
      );
    });
    // Con el ticket nuevo de esta misma transacción, los CHECK de forma del ejemplar: el original no tiene base; la anulación no lleva importe.
    await conA(async (s) => {
      const t = await ticketSinEjemplar(s, w);
      check(
        await ejemplarSql(s, w, t.ticket, randomUUID(), "100.00", {
          numero: 1,
          tipo: "ORIGINAL",
          base: randomUUID(),
        }),
        "ejemplar_original_ck",
      );
    });
    await conA(async (s) => {
      const t = await ticketSinEjemplar(s, w);
      const original = randomUUID();
      acepta(await ejemplarSql(s, w, t.ticket, original, "100.00"));
      acepta(await grupoSql(s, w, original, "100.00"));
      acepta(await renglonSql(s, w, original, t.linea, "1", "100.00"));
      acepta(
        await s.directo(
          "update ticket set estado = 'ANULADO', ejemplar_vigente = 2 where id = $1",
          [t.ticket],
        ),
      );
      check(
        await ejemplarSql(s, w, t.ticket, randomUUID(), "5.00", {
          numero: 2,
          tipo: "ANULACION",
          base: original,
        }),
        "ejemplar_anulacion_ck",
      );
    });
    // Una anulación no lleva grupos ni renglones (ejemplar_hijo_validar_alta).
    await conA(async (s) => {
      const t = await ticketSinEjemplar(s, w);
      const original = randomUUID();
      acepta(await ejemplarSql(s, w, t.ticket, original, "100.00"));
      acepta(await grupoSql(s, w, original, "100.00"));
      acepta(await renglonSql(s, w, original, t.linea, "1", "100.00"));
      acepta(
        await s.directo(
          "update ticket set estado = 'ANULADO', ejemplar_vigente = 2 where id = $1",
          [t.ticket],
        ),
      );
      const anulacion = randomUUID();
      acepta(
        await ejemplarSql(s, w, t.ticket, anulacion, "0.00", {
          numero: 2,
          tipo: "ANULACION",
          base: original,
        }),
      );
      check(await grupoSql(s, w, anulacion, "0.00"), "ejemplar_contenido_solo_con_el_ejemplar");
    });
    // El ejemplar de un ticket de otra empresa no se escribe con el contexto de esta.
    await conB(async (s) => {
      const r = await ejemplarSql(s, mundoDe(b), f.emitido.ticket, randomUUID(), "1.00", {
        numero: 2,
        tipo: "CORRECCION",
        base: f.emitido.ejemplar,
      });
      expect(r.ok).toBe(false);
    });
  });

  // ---- cobranza (P3, parte base) ----------------------------------------------------------------------------------------------

  /** Cobra el ticket EMITIDO guardado (empresa A): la cobranza y sus aplicaciones, en la misma transacción. */
  const cobranza = async (
    s: SesionDePrueba,
    ticket: string,
    ejemplar: string,
    importes: readonly string[],
    extra: Partial<{ clave: string; id: string; ticketId: string }> = {},
  ) => {
    const id = extra.id ?? randomUUID();
    acepta(
      await s.directo(
        `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          a.empresa,
          ticket,
          ejemplar,
          randomUUID(),
          extra.clave ?? nuevaClave(),
          HUELLA,
          a.gerente.personaId,
          AHORA,
        ],
      ),
    );
    const resultados = [];
    for (const [i, importe] of importes.entries()) {
      resultados.push(
        await s.directo(
          "insert into aplicacion_de_cobro (empresa_id, cobranza_id, orden, cobro_id, importe) values ($1, $2, $3, $4, $5)",
          [a.empresa, id, i + 1, randomUUID(), importe],
        ),
      );
    }
    return { id, resultados };
  };
  /** Un ticket EMITIDO nuevo en la empresa A (committed), para cobrarlo en la prueba. */
  const emitidoNuevo = async (cantidad = "2") => {
    const c = await cuentaConLinea(m, a, a.gerente, cantidad);
    const t = valorDe(
      await m.casos.cerrarCuenta(a.gerente, { cuentaId: c.cuenta, ejemplarId: nuevoId() }),
    );
    return { ...t, cuenta: c.cuenta };
  };

  it("P3 (base): lo aplicado tiene que sumar, al centavo, el total del ejemplar cobrado: de menos o de más, falla al confirmar", async () => {
    for (const importes of [
      ["1999.99"],
      ["2000.01"],
      ["1000.00", "999.99"],
      ["1000.00", "1000.01"],
      ["1000.00"],
    ]) {
      const t = await emitidoNuevo("2");
      await conA(async (s) => {
        await cobranza(s, t.ticketId, t.ejemplarId, importes);
        check(await s.confirmar(), "cobranza_cuadra");
      });
    }
    // Una cobranza sin ninguna aplicación tampoco cuadra (el total es 2.000).
    const sinAplicar = await emitidoNuevo("2");
    await conA(async (s) => {
      await cobranza(s, sinAplicar.ticketId, sinAplicar.ejemplarId, []);
      check(await s.confirmar(), "cobranza_cuadra");
    });
    // Justo, con uno o con varios medios, confirma; y el ticket pasa a COBRADO con su cobranza.
    for (const importes of [["2000.00"], ["1500.50", "499.50"], ["0.01", "1999.99"]]) {
      const t = await emitidoNuevo("2");
      await conA(async (s) => {
        await cobranza(s, t.ticketId, t.ejemplarId, importes);
        await paso(s, "update ticket set estado = 'COBRADO' where id = $1", [t.ticketId]);
        acepta(await s.confirmar());
      });
      expect(
        (
          await m.filas<{ estado: string }>("select estado from ticket where id = $1", [t.ticketId])
        )[0]?.estado,
      ).toBe("COBRADO");
    }
  });

  it("una aplicación con importe menor o igual a cero, NaN o fuera de cota se rechaza (aplicacion_importe_ck)", async () => {
    const t = await emitidoNuevo("2");
    await conA(async (s) => {
      const { id } = await cobranza(s, t.ticketId, t.ejemplarId, ["2000.00"]);
      for (const importe of ["0", "-1", "-0.01", "NaN", "1000000000"]) {
        check(
          await s.intentar(
            "insert into aplicacion_de_cobro (empresa_id, cobranza_id, orden, cobro_id, importe) values ($1, $2, 9, $3, $4)",
            [a.empresa, id, randomUUID(), importe],
          ),
          "aplicacion_importe_ck",
        );
      }
      check(
        await s.intentar(
          "insert into aplicacion_de_cobro (empresa_id, cobranza_id, orden, cobro_id, importe) values ($1, $2, 51, $3, 1)",
          [a.empresa, id, randomUUID()],
        ),
        "aplicacion_orden_ck",
      );
    });
  });

  it("la cobranza cobra el ejemplar vigente DEL TICKET que se cobra: el de otro ticket de la empresa se rechaza", async () => {
    const t = await emitidoNuevo("1");
    const otro = await emitidoNuevo("1");
    await conA(async (s) => {
      // El ejemplar de `otro` es el número 1, como el vigente de `t`, y existe en la empresa: la clave foránea sola lo deja pasar.
      const r = await s.intentar(
        `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          a.empresa,
          t.ticketId,
          otro.ejemplarId,
          randomUUID(),
          nuevaClave(),
          HUELLA,
          a.gerente.personaId,
          AHORA,
        ],
      );
      expect(r.ok, "una cobranza no puede apuntar al ejemplar de otro ticket").toBe(false);
    });
  });

  it("de la cobranza solo se escribe el resultado, y una sola vez", async () => {
    const t = await emitidoNuevo("1");
    await conA(async (s) => {
      const { id } = await cobranza(s, t.ticketId, t.ejemplarId, ["1000.00"]);
      check(
        await s.intentar("update cobranza_de_ticket set resultado = null where id = $1", [id]),
        "cobranza_inmutable",
      );
      filas(
        await s.intentar(
          `update cobranza_de_ticket set resultado = '{"ok": true}'::jsonb where id = $1`,
          [id],
        ),
        1,
      );
      check(
        await s.intentar(
          `update cobranza_de_ticket set resultado = '{"ok": false}'::jsonb where id = $1`,
          [id],
        ),
        "cobranza_inmutable",
      );
      check(
        await s.intentar(`update cobranza_de_ticket set resultado = '[]'::jsonb where id = $1`, [
          id,
        ]),
        "cobranza_inmutable",
      );
    });
  });

  it("cobrar tiene sus reglas: solo un ticket EMITIDO con su ejemplar vigente; una cobranza por ticket; el cobro de caja no se aplica dos veces", async () => {
    // Un ticket ANULADO, uno COBRADO y una CORTESIA no se cobran.
    for (const [ticket, ejemplar] of [
      [f.anulado.ticket, f.anulado.ejemplar],
      [f.cobrado.ticket, f.cobrado.ejemplar],
      [f.cortesia.ticket, f.cortesia.ejemplar],
    ]) {
      await conA(async (s) => {
        check(
          await s.intentar(
            `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              randomUUID(),
              a.empresa,
              ticket,
              ejemplar,
              randomUUID(),
              nuevaClave(),
              HUELLA,
              a.gerente.personaId,
              AHORA,
            ],
          ),
          "cobranza_ticket_no_cobrable",
        );
      });
    }
    const t = await emitidoNuevo("1");
    // Una sola cobranza por ticket y una sola vez cada clave y cada cobro de caja.
    await conA(async (s) => {
      const primera = await cobranza(s, t.ticketId, t.ejemplarId, ["1000.00"]);
      expect(primera.resultados.every((r) => r.ok)).toBe(true);
      const otra = await s.intentar(
        `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          a.empresa,
          t.ticketId,
          t.ejemplarId,
          randomUUID(),
          nuevaClave(),
          HUELLA,
          a.gerente.personaId,
          AHORA,
        ],
      );
      expect(otra).toMatchObject({ ok: false, codigo: "23505", restriccion: "cobranza_ticket_uk" });
    });
    await conA(async (s) => {
      const otro = await emitidoNuevo("1");
      const clave = nuevaClave();
      await cobranza(s, t.ticketId, t.ejemplarId, ["1000.00"], { clave });
      const repetida = await s.intentar(
        `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          a.empresa,
          otro.ticketId,
          otro.ejemplarId,
          randomUUID(),
          clave,
          HUELLA,
          a.gerente.personaId,
          AHORA,
        ],
      );
      expect(repetida).toMatchObject({
        ok: false,
        codigo: "23505",
        restriccion: "cobranza_clave_uk",
      });
    });
    // Las aplicaciones solo entran con su cobranza, en la misma transacción.
    await conA(async (s) => {
      check(
        await s.intentar(
          "insert into aplicacion_de_cobro (empresa_id, cobranza_id, orden, cobro_id, importe) values ($1, $2, 3, $3, 1)",
          [a.empresa, f.cobrado.cobranza, randomUUID()],
        ),
        "aplicacion_solo_con_la_cobranza",
      );
    });
    // La clave y la huella tienen forma; el destino es solo el ticket (fase A).
    await conA(async (s) => {
      for (const [clave, huella, restriccion] of [
        ["corta", HUELLA, "cobranza_clave_ck"],
        [nuevaClave(), "xyz", "cobranza_huella_ck"],
        [nuevaClave(), "A".repeat(64), "cobranza_huella_ck"],
      ]) {
        check(
          await s.intentar(
            `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              randomUUID(),
              a.empresa,
              t.ticketId,
              t.ejemplarId,
              randomUUID(),
              clave,
              huella,
              a.gerente.personaId,
              AHORA,
            ],
          ),
          restriccion as string,
        );
      }
    });
  });

  it("un ticket solo pasa a COBRADO con su cobranza guardada y sin cambiar de ejemplar", async () => {
    const t = await emitidoNuevo("1");
    await conA(async (s) => {
      check(
        await s.intentar("update ticket set estado = 'COBRADO' where id = $1", [t.ticketId]),
        "ticket_cobrado_sin_cobranza",
      );
    });
    await conA(async (s) => {
      await cobranza(s, t.ticketId, t.ejemplarId, ["1000.00"]);
      check(
        await s.intentar(
          "update ticket set estado = 'COBRADO', ejemplar_vigente = 2 where id = $1",
          [t.ticketId],
        ),
        "ticket_cobrado_sin_cobranza",
      );
    });
  });

  // ---- transiciones del ticket ------------------------------------------------------------------------------------------------

  it("transiciones del ticket: solo EMITIDO→COBRADO/ANULADO, COBRADO→ANULADO y CORTESIA→ANULADO; ANULADO es final", async () => {
    const estados = ["EMITIDO", "COBRADO", "CORTESIA", "ANULADO"] as const;
    const guardado = {
      EMITIDO: f.emitido.ticket,
      COBRADO: f.cobrado.ticket,
      CORTESIA: f.cortesia.ticket,
      ANULADO: f.anulado.ticket,
    } as const;
    const permitidas = new Set([
      "EMITIDO>COBRADO",
      "EMITIDO>ANULADO",
      "COBRADO>ANULADO",
      "CORTESIA>ANULADO",
    ]);
    // El estado de partida de cada uno es el que dice el nombre.
    for (const estado of estados) {
      expect(
        (
          await m.filas<{ estado: string }>("select estado from ticket where id = $1", [
            guardado[estado],
          ])
        )[0]?.estado,
      ).toBe(estado);
    }
    for (const desde of estados) {
      for (const hasta of estados) {
        if (desde === hasta) continue;
        await conA(async (s) => {
          const ticket = guardado[desde];
          // Anular agrega un ejemplar (el vigente sube de a uno); el resto de las transiciones no lo toca.
          const cambio =
            hasta === "ANULADO"
              ? "estado = 'ANULADO', ejemplar_vigente = ejemplar_vigente + 1"
              : `estado = '${hasta}'`;
          const r = await s.intentar(`update ticket set ${cambio} where id = $1`, [ticket]);
          const nombre = `${desde}>${hasta}`;
          if (permitidas.has(nombre)) {
            // COBRADO desde EMITIDO exige su cobranza: el EMITIDO de la fixture no la tiene (se prueba aparte), así que aquí la base la pide.
            if (nombre === "EMITIDO>COBRADO") check(r, "ticket_cobrado_sin_cobranza");
            else acepta(r);
          } else if (hasta === "COBRADO" || hasta === "CORTESIA") {
            check(r, "ticket_transicion_invalida");
          } else {
            check(r, "ticket_transicion_invalida");
          }
        });
      }
    }
    // ANULADO es final: ni el ejemplar vigente se mueve.
    await conA(async (s) => {
      check(
        await s.intentar(
          "update ticket set ejemplar_vigente = ejemplar_vigente + 1 where id = $1",
          [f.anulado.ticket],
        ),
        "ticket_transicion_invalida",
      );
    });
    // El ejemplar vigente sube de a uno; anular sin subirlo no vale.
    await conA(async (s) => {
      check(
        await s.intentar(
          "update ticket set ejemplar_vigente = ejemplar_vigente + 2 where id = $1",
          [f.emitido.ticket],
        ),
        "ticket_ejemplar_vigente_salto",
      );
      check(
        await s.intentar("update ticket set estado = 'ANULADO' where id = $1", [f.emitido.ticket]),
        "ticket_ejemplar_vigente_salto",
      );
      check(
        await s.intentar("update ticket set ejemplar_vigente = 0 where id = $1", [
          f.emitido.ticket,
        ]),
        "ticket_ejemplar_vigente_salto",
      );
    });
  });

  it("anular un ticket sin su ejemplar de anulación falla al confirmar (ticket_ejemplar_vigente_existe); con él, confirma", async () => {
    const t = await emitidoNuevo("1");
    await conA(async (s) => {
      acepta(
        await s.directo(
          "update ticket set estado = 'ANULADO', ejemplar_vigente = 2 where id = $1",
          [t.ticketId],
        ),
      );
      check(await s.confirmar(), "ticket_ejemplar_vigente_existe");
    });
    await conA(async (s) => {
      acepta(
        await s.directo(
          "update ticket set estado = 'ANULADO', ejemplar_vigente = 2 where id = $1",
          [t.ticketId],
        ),
      );
      acepta(
        await ejemplarSql(s, mundoDe(a), t.ticketId, nuevoId(), "0.00", {
          numero: 2,
          tipo: "ANULACION",
          base: t.ejemplarId,
        }),
      );
      acepta(await s.confirmar());
    });
    expect(
      (
        await m.filas<{ estado: string; v: number }>(
          "select estado, ejemplar_vigente as v from ticket where id = $1",
          [t.ticketId],
        )
      )[0],
    ).toEqual({ estado: "ANULADO", v: 2 });
  });

  it("el ticket nace emitido o cortesía, de una cuenta cerrada de su sucursal y con su total (ticket_cuenta_invalida, ticket_alta_invalida)", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    // De una cuenta que sigue abierta.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      const numero = await numeroSql(s, w);
      check(await ticketSql(s, w, cuenta, numero, "100.00"), "ticket_cuenta_invalida");
    });
    // Con un total que no es el de la cuenta.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      check(await ticketSql(s, w, cuenta, numero, "99.00"), "ticket_cuenta_invalida");
    });
    // De una cuenta anulada.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await paso(
        s,
        "update cuenta_consumo set estado = 'ANULADA', resuelta_por = $2, resuelta_en = $3, motivo = 'Se fue' where id = $1",
        [cuenta, w.persona, AHORA],
      );
      const numero = await numeroSql(s, w);
      check(
        await ticketSql(s, w, cuenta, numero, "0.00", { estado: "CORTESIA" }),
        "ticket_cuenta_invalida",
      );
    });
    // Con un estado que no es de nacimiento.
    for (const estado of ["COBRADO", "ANULADO"]) {
      await conAppDe(b0(), w, async (s) => {
        const cuenta = await cuentaSql(s, w);
        await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
        await totalSql(s, cuenta, "100.00");
        await cerrarSql(s, w, cuenta);
        const numero = await numeroSql(s, w);
        check(await ticketSql(s, w, cuenta, numero, "100.00", { estado }), "ticket_alta_invalida");
      });
    }
    // Una cortesía con total > 0, o un ticket de total 0 que no es cortesía: ticket_cortesia_ck.
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "100", cantidad: "1" });
      await totalSql(s, cuenta, "100.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      check(
        await ticketSql(s, w, cuenta, numero, "100.00", { estado: "CORTESIA" }),
        "ticket_cortesia_ck",
      );
    });
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      await lineaSql(s, w, cuenta, { unitario: "0", cantidad: "1" });
      await totalSql(s, cuenta, "0.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      check(
        await ticketSql(s, w, cuenta, numero, "0.00", { estado: "EMITIDO" }),
        "ticket_cortesia_ck",
      );
    });
    // Un ticket por cuenta (ticket_cuenta_uk): la cuenta de un ticket guardado, sin poder reabrirse, ya no es cerrable de nuevo.
    await conA(async (s) => {
      const numero = await numeroSql(s, mundoDe(a));
      expect(await ticketSql(s, mundoDe(a), f.emitido.cuenta, numero, "2000.00")).toMatchObject({
        ok: false,
        codigo: "23505",
        restriccion: "ticket_cuenta_uk",
      });
    });
  });

  it("V6: una CORTESIA (total 0) nace por la base, y una cortesía se puede anular conservando su total 0", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    await conAppDe(b0(), w, async (s) => {
      const cuenta = await cuentaSql(s, w);
      const linea = await lineaSql(s, w, cuenta, { unitario: "0", cantidad: "1" });
      await totalSql(s, cuenta, "0.00");
      await cerrarSql(s, w, cuenta);
      const numero = await numeroSql(s, w);
      const ticket = randomUUID();
      acepta(await ticketSql(s, w, cuenta, numero, "0.00", { id: ticket, estado: "CORTESIA" }));
      const ejemplar = randomUUID();
      acepta(await ejemplarSql(s, w, ticket, ejemplar, "0.00"));
      acepta(await grupoSql(s, w, ejemplar, "0.00"));
      acepta(await renglonSql(s, w, ejemplar, linea, "1", "0.00"));
      acepta(await s.confirmar());
    });
  });

  // ---- la cuenta --------------------------------------------------------------------------------------------------------------

  it("una cuenta nace abierta, vacía, con quién la abre del contexto, y se resuelve con la persona del contexto", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    await conAppDe(b0(), w, async (s) => {
      // Ni el estado, ni el total, ni las posiciones se pueden fijar al insertar (columnas no concedidas).
      for (const columna of ["estado", "total_provisorio", "ultima_posicion"]) {
        denegado(
          await s.intentar(
            `insert into cuenta_consumo (id, empresa_id, sucursal_id, abierta_por, abierta_en, ${columna}) values ($1, $2, $3, $4, $5, ${columna === "estado" ? "'CERRADA'" : "5"})`,
            [randomUUID(), w.empresa, w.sucursal, w.persona, AHORA],
          ),
        );
      }
      // `abierta_por` es la persona del contexto: la política de RLS no deja poner a otra.
      denegado(
        await s.intentar(
          "insert into cuenta_consumo (id, empresa_id, sucursal_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5)",
          [randomUUID(), w.empresa, w.sucursal, b.gerente.personaId, AHORA],
        ),
      );
      const cuenta = await cuentaSql(s, w);
      // La persona que cierra tiene que ser la del contexto.
      check(
        await s.intentar(
          "update cuenta_consumo set estado = 'CERRADA', resuelta_por = $2, resuelta_en = $3 where id = $1",
          [cuenta, b.gerente.personaId, AHORA],
        ),
        "cuenta_persona_del_contexto",
      );
      // Al resolver no se cambia el total ni las posiciones en el mismo acto.
      check(
        await s.intentar(
          "update cuenta_consumo set estado = 'CERRADA', resuelta_por = $2, resuelta_en = $3, total_provisorio = 5 where id = $1",
          [cuenta, w.persona, AHORA],
        ),
        "cuenta_transicion_invalida",
      );
      // Las posiciones suben de a una.
      check(
        await s.intentar(
          "update cuenta_consumo set ultima_posicion = ultima_posicion + 2 where id = $1",
          [cuenta],
        ),
        "cuenta_posicion_invalida",
      );
      // Una anulada necesita su motivo, y una abierta no puede tener marcas de resuelta.
      check(
        await s.intentar(
          "update cuenta_consumo set estado = 'ANULADA', resuelta_por = $2, resuelta_en = $3 where id = $1",
          [cuenta, w.persona, AHORA],
        ),
        "cuenta_resuelta_ck",
      );
      check(
        await s.intentar(
          "update cuenta_consumo set resuelta_por = $2, resuelta_en = $3 where id = $1",
          [cuenta, w.persona, AHORA],
        ),
        "cuenta_resuelta_ck",
      );
      // Resolver antes de abrir tampoco.
      check(
        await s.intentar(
          "update cuenta_consumo set estado = 'CERRADA', resuelta_por = $2, resuelta_en = '2020-01-01T00:00:00Z' where id = $1",
          [cuenta, w.persona],
        ),
        "cuenta_resuelta_ck",
      );
      // Un motivo con HTML o con salto de línea no pasa la lista de permitidos.
      for (const motivo of ["<b>x</b>", "a\nb", " con espacio al borde ", "x".repeat(501)]) {
        check(
          await s.intentar(
            "update cuenta_consumo set estado = 'ANULADA', resuelta_por = $2, resuelta_en = $3, motivo = $4 where id = $1",
            [cuenta, w.persona, AHORA, motivo],
          ),
          "cuenta_motivo_ck",
        );
      }
      // Bien hecho, anular funciona.
      filas(
        await s.intentar(
          "update cuenta_consumo set estado = 'ANULADA', resuelta_por = $2, resuelta_en = $3, motivo = 'Se fue' where id = $1",
          [cuenta, w.persona, AHORA],
        ),
        1,
      );
    });
  });

  it("una única cuenta abierta por ancla (cuenta_ancla_abierta_uk); resuelta la primera, la ancla queda libre; el ancla es completa y de forma válida", async () => {
    const e = await m.escenario();
    const w = mundoDe(e);
    const ancla = { tipo: "salon.mesa", id: randomUUID() };
    await conAppDe(b0(), w, async (s) => {
      await cuentaSql(s, w, ancla);
      const otra = await s.intentar(
        "insert into cuenta_consumo (id, empresa_id, sucursal_id, ancla_tipo, ancla_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5, $6, $7)",
        [randomUUID(), w.empresa, w.sucursal, ancla.tipo, ancla.id, w.persona, AHORA],
      );
      expect(otra).toMatchObject({
        ok: false,
        codigo: "23505",
        restriccion: "cuenta_ancla_abierta_uk",
      });
      // Sin ancla pueden coexistir todas las que se quiera.
      await cuentaSql(s, w);
      await cuentaSql(s, w);
    });
    await conAppDe(b0(), w, async (s) => {
      const primera = await cuentaSql(s, w, ancla);
      await cerrarSql(s, w, primera);
      // Cerrada la primera, se puede abrir otra con la misma ancla.
      await cuentaSql(s, w, ancla);
    });
    // La misma ancla en OTRA empresa es otra cosa (la única incluye empresa_id).
    const otraEmpresa = mundoDe(b);
    await conAppDe(b0(), w, async (s) => {
      await cuentaSql(s, w, ancla);
    });
    await conAppDe(b0(), otraEmpresa, async (s) => {
      await cuentaSql(s, otraEmpresa, ancla);
    });
    await conAppDe(b0(), w, async (s) => {
      const insertar = (tipo: string | null, id: string | null) =>
        s.intentar(
          "insert into cuenta_consumo (id, empresa_id, sucursal_id, ancla_tipo, ancla_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5, $6, $7)",
          [randomUUID(), w.empresa, w.sucursal, tipo, id, w.persona, AHORA],
        );
      check(await insertar("salon.mesa", null), "cuenta_ancla_completa_ck");
      check(await insertar(null, randomUUID()), "cuenta_ancla_completa_ck");
      for (const tipo of [
        "Salon",
        "salon mesa",
        "salon.mesa.x",
        "a".repeat(41),
        "salon-mesa",
        "",
        "<b>",
      ]) {
        check(await insertar(tipo, randomUUID()), "cuenta_ancla_tipo_ck");
      }
    });
    // La etiqueta es una sola línea de la lista de permitidos.
    await conAppDe(b0(), w, async (s) => {
      for (const etiqueta of ["<b>Mesa</b>", "Mesa\n4", "x".repeat(41), "Mesa‮4"]) {
        check(
          await s.intentar(
            "insert into cuenta_consumo (id, empresa_id, sucursal_id, etiqueta, abierta_por, abierta_en) values ($1, $2, $3, $4, $5, $6)",
            [randomUUID(), w.empresa, w.sucursal, etiqueta, w.persona, AHORA],
          ),
          "cuenta_etiqueta_ck",
        );
      }
    });
  });

  // ---- corrección -------------------------------------------------------------------------------------------------------------

  it("el registro de corrección une el ejemplar base con el nuevo, del mismo tipo, creado en esta transacción; la clave es única y la jornada la fija la base", async () => {
    const t = await emitidoNuevo("1");
    const registro = (
      s: SesionDePrueba,
      ticket: string,
      base0: string,
      nuevo: string,
      extra: Partial<{ clave: string; motivo: string; tipo: string; huella: string }> = {},
    ) =>
      s.directo(
        `insert into ticket_correccion (id, empresa_id, ticket_id, ejemplar_base_id, ejemplar_nuevo_id, tipo, motivo, clave, huella, resultado, hecha_por, hecha_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10, $11)`,
        [
          nuevo,
          a.empresa,
          ticket,
          base0,
          nuevo,
          extra.tipo ?? "ANULACION",
          extra.motivo ?? "Error del cajero",
          extra.clave ?? nuevaClave(),
          extra.huella ?? HUELLA,
          a.gerente.personaId,
          "2026-11-10T04:25:00Z",
        ],
      );
    const anular = async (s: SesionDePrueba, nuevo: string) => {
      acepta(
        await s.directo(
          "update ticket set estado = 'ANULADO', ejemplar_vigente = 2 where id = $1",
          [t.ticketId],
        ),
      );
      acepta(
        await ejemplarSql(s, mundoDe(a), t.ticketId, nuevo, "0.00", {
          numero: 2,
          tipo: "ANULACION",
          base: t.ejemplarId,
        }),
      );
    };
    await conA(async (s) => {
      const nuevo = randomUUID();
      await anular(s, nuevo);
      acepta(await registro(s, t.ticketId, t.ejemplarId, nuevo));
      // La base la fijó: 01:25 del 10/11 con el corte por defecto (00:00) es el 10/11.
      expect(
        (
          await paso(s, "select fecha_negocio::text as f from ticket_correccion where id = $1", [
            nuevo,
          ])
        )[0],
      ).toEqual({ f: "2026-11-10" });
    });
    // Con el tipo que no es el del ejemplar nuevo, o con un ejemplar que no cuelga del base.
    await conA(async (s) => {
      const nuevo = randomUUID();
      await anular(s, nuevo);
      check(
        await registro(s, t.ticketId, t.ejemplarId, nuevo, { tipo: "CORRECCION" }),
        "correccion_ejemplares_invalidos",
      );
    });
    await conA(async (s) => {
      const nuevo = randomUUID();
      await anular(s, nuevo);
      check(await registro(s, t.ticketId, nuevo, nuevo), "correccion_ejemplares_invalidos");
    });
    // Un ejemplar que ya existía de antes (no creado en esta transacción).
    await conA(async (s) => {
      check(
        await registro(s, f.anulado.ticket, f.anulado.ejemplar, f.anulado.ejemplarDeAnulacion, {}),
        "correccion_ejemplares_invalidos",
      );
    });
    // La clave de idempotencia es única por empresa, y la forma de motivo, clave y huella está validada.
    await conA(async (s) => {
      const clave = (
        await m.filas<{ clave: string }>(
          "select clave from ticket_correccion where ticket_id = $1",
          [f.anulado.ticket],
        )
      )[0]?.clave as string;
      const nuevo = randomUUID();
      await anular(s, nuevo);
      expect(await registro(s, t.ticketId, t.ejemplarId, nuevo, { clave })).toMatchObject({
        ok: false,
        codigo: "23505",
        restriccion: "correccion_clave_uk",
      });
    });
    await conA(async (s) => {
      const nuevo = randomUUID();
      await anular(s, nuevo);
      const intento = (extra: Partial<{ clave: string; motivo: string; huella: string }>) =>
        s.intentar(
          `insert into ticket_correccion (id, empresa_id, ticket_id, ejemplar_base_id, ejemplar_nuevo_id, tipo, motivo, clave, huella, resultado, hecha_por, hecha_en)
           values ($1, $2, $3, $4, $5, 'ANULACION', $6, $7, $8, '{}'::jsonb, $9, $10)`,
          [
            nuevo,
            a.empresa,
            t.ticketId,
            t.ejemplarId,
            nuevo,
            extra.motivo ?? "ok",
            extra.clave ?? nuevaClave(),
            extra.huella ?? HUELLA,
            a.gerente.personaId,
            AHORA,
          ],
        );
      check(await intento({ motivo: "" }), "correccion_motivo_ck");
      check(await intento({ motivo: "<script>" }), "correccion_motivo_ck");
      check(await intento({ motivo: "a\nb" }), "correccion_motivo_ck");
      check(await intento({ clave: "corta" }), "correccion_clave_ck");
      check(await intento({ huella: "no" }), "correccion_huella_ck");
    });
  });

  // ---- aislamiento entre empresas (P14) ---------------------------------------------------------------------------------------

  it("P14: con el contexto de la empresa B, las filas de A no se ven ni se tocan, y no se puede escribir una fila con empresa_id de A", async () => {
    await conB(async (s) => {
      for (const tabla of TABLAS) {
        const r = await s.intentar(`select count(*) as n from ${tabla} where empresa_id = $1`, [
          a.empresa,
        ]);
        expect(r.ok && r.rows[0], tabla).toEqual({ n: "0" });
        const todo = await s.intentar(`select count(*) as n from ${tabla} where empresa_id <> $1`, [
          b.empresa,
        ]);
        expect(todo.ok && todo.rows[0], `${tabla}: ninguna de otra empresa`).toEqual({ n: "0" });
      }
      // Actualizar lo ajeno no afecta ninguna fila.
      filas(
        await s.intentar(
          "update ticket set estado = 'ANULADO', ejemplar_vigente = 2 where id = $1",
          [f.emitido.ticket],
        ),
        0,
      );
      filas(
        await s.intentar("update cuenta_consumo set total_provisorio = 0 where id = $1", [
          f.abierta.cuenta,
        ]),
        0,
      );
      filas(
        await s.intentar("update numerador_ticket set ultimo = ultimo + 1 where empresa_id = $1", [
          a.empresa,
        ]),
        0,
      );
      // Escribir con la empresa ajena lo frena la política (RLS), aunque la persona sea la propia.
      denegado(
        await s.intentar(
          "insert into cuenta_consumo (id, empresa_id, sucursal_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5)",
          [randomUUID(), a.empresa, a.sucursal, b.gerente.personaId, AHORA],
        ),
      );
      denegado(
        await s.intentar("insert into numerador_ticket (empresa_id, sucursal_id) values ($1, $2)", [
          a.empresa,
          a.sucursal,
        ]),
      );
    });
    // Y de A hacia B, lo mismo (hay datos en B).
    await conA(async (s) => {
      const r = await s.intentar("select count(*) as n from cuenta_consumo where empresa_id = $1", [
        b.empresa,
      ]);
      expect(r.ok && r.rows[0]).toEqual({ n: "0" });
    });
  });

  it("P14: las claves foráneas son compuestas: una fila no puede apuntar a la cuenta, la sucursal o el ticket de otra empresa (tampoco para el dueño)", async () => {
    await dueno.query("begin");
    try {
      const w = mundoDe(b);
      // La cuenta de B en una sucursal de A.
      expect(
        await intentoDelDueno(
          dueno,
          "insert into cuenta_consumo (id, empresa_id, sucursal_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5)",
          [randomUUID(), b.empresa, a.sucursal, w.persona, AHORA],
        ),
      ).toMatchObject({ ok: false, codigo: "23503", restriccion: "cuenta_sucursal_fkey" });
      // Una línea de B sobre una cuenta de A: la frena el disparador de alta (la cuenta no es de esa empresa) o la clave foránea.
      const linea = await intentoDelDueno(
        dueno,
        `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                  precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en)
         values ($1, $2, $3, 1, $4, 'X', $5, 'EMPRESA', 1, 1, 1, 'UNIDAD', 1, '21', false, $6, $7)`,
        [randomUUID(), b.empresa, f.abierta.cuenta, randomUUID(), randomUUID(), w.persona, AHORA],
      );
      expect(linea.ok).toBe(false);
      if (!linea.ok) expect(["23514", "23503"]).toContain(linea.codigo);
      // Un renglón de ejemplar de B sobre un ejemplar de A, un ticket de B sobre una cuenta de A y una cobranza de B sobre un ticket de A.
      const renglon = await intentoDelDueno(
        dueno,
        "insert into ejemplar_linea (empresa_id, ejemplar_id, grupo_orden, linea_cuenta_id, cantidad, importe) values ($1, $2, 1, $3, 1, 1)",
        [b.empresa, f.emitido.ejemplar, f.emitido.linea],
      );
      expect(renglon.ok).toBe(false);
      const ticket = await intentoDelDueno(
        dueno,
        `insert into ticket (empresa_id, sucursal_id, cuenta_id, numero, estado, total, emitido_por, emitido_en) values ($1, $2, $3, 1, 'EMITIDO', 1, $4, $5)`,
        [b.empresa, b.sucursal, f.emitido.cuenta, w.persona, AHORA],
      );
      expect(ticket.ok).toBe(false);
      const cobro = await intentoDelDueno(
        dueno,
        `insert into cobranza_de_ticket (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, creada_por, creada_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          b.empresa,
          f.emitido.ticket,
          f.emitido.ejemplar,
          randomUUID(),
          nuevaClave(),
          HUELLA,
          w.persona,
          AHORA,
        ],
      );
      expect(cobro.ok).toBe(false);
      // Un numerador de B para una sucursal de A.
      expect(
        await intentoDelDueno(
          dueno,
          "insert into numerador_ticket (empresa_id, sucursal_id) values ($1, $2)",
          [b.empresa, a.sucursal],
        ),
      ).toMatchObject({ ok: false, codigo: "23503", restriccion: "numerador_sucursal_fkey" });
    } finally {
      await dueno.query("rollback");
    }
  });

  // ---- reversión --------------------------------------------------------------------------------------------------------------

  describe("reversión", () => {
    const ruta = join(CARPETA_DE_MIGRACIONES, "reversiones", "0028_revertir_ventas.sql");
    // Con 0029 aplicada (el puntero `documento_de_ticket` apunta a ticket y ejemplar) hay que revertirla ANTES: las reversiones se hacen en orden inverso.
    const rutaDe0029 = join(CARPETA_DE_MIGRACIONES, "reversiones", "0029_revertir_facturacion.sql");

    it("se niega con filas guardadas (sin confirmar), no cambia nada y avisa cuántas son", async () => {
      const sql = await readFile(ruta, "utf8");
      await dueno.query("begin");
      try {
        const error = await dueno.query(sql).then(
          () => null,
          (e: { code?: string; message?: string }) => e,
        );
        expect(error?.code).toBe("55000");
        expect(error?.message).toMatch(/hay \d+ filas de ventas/);
        expect(error?.message).toMatch(/confirmar_reversion/);
      } finally {
        await dueno.query("rollback");
      }
      for (const tabla of TABLAS) {
        expect(await m.contar(`select count(*) as n from ${tabla}`), tabla).toBeGreaterThan(0);
      }
    });

    it("con una sola fila de ventas se niega, y con la confirmación explícita borra todo; sin ella no", async () => {
      const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const sql = await readFile(ruta, "utf8");
        // Una sola fila: el numerador de una sucursal (la tabla más chica).
        const { rows: t } = await c.query<{ id: string }>(
          "insert into tenant (nombre) values ('t') returning id",
        );
        const { rows: emp } = await c.query<{ id: string }>(
          "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'e') returning id",
          [t[0]?.id, cuitAlAzar()],
        );
        const { rows: suc } = await c.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'S') returning id",
          [emp[0]?.id],
        );
        await c.query("insert into numerador_ticket (empresa_id, sucursal_id) values ($1, $2)", [
          emp[0]?.id,
          suc[0]?.id,
        ]);
        await c.query("begin");
        const rechazada = await c.query(sql).then(
          () => null,
          (e: { code?: string; message?: string }) => e,
        );
        expect(rechazada?.code).toBe("55000");
        expect(rechazada?.message).toMatch(/hay 1 filas de ventas/);
        await c.query("rollback");
        // Una confirmación que no es exactamente 'SI' no cuenta.
        await c.query("begin");
        await c.query("set local pedernal.confirmar_reversion = 'si'");
        const minuscula = await c.query(sql).then(
          () => null,
          (e: { code?: string }) => e,
        );
        expect(minuscula?.code).toBe("55000");
        await c.query("rollback");
        // Con la confirmación: borra las once tablas.
        await c.query("begin");
        await c.query("set local pedernal.confirmar_reversion = 'SI'");
        await c.query(await readFile(rutaDe0029, "utf8"));
        await c.query(sql);
        const { rows } = await c.query<{ n: string }>(
          "select count(*)::text as n from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace",
          [[...TABLAS]],
        );
        expect(rows[0]?.n).toBe("0");
        await c.query("rollback");
        // Sin confirmar, todo sigue ahí.
        const { rows: siguen } = await c.query<{ n: string }>(
          "select count(*)::text as n from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace",
          [[...TABLAS]],
        );
        expect(siguen[0]?.n).toBe(String(TABLAS.length));
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });

    it("con las tablas vacías deja la base sin tablas ni funciones de ventas, borra su fila del registro y se puede repetir", async () => {
      const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const sql = await readFile(ruta, "utf8");
        const { rows: antes } = await c.query<{ n: string }>(
          "select count(*)::text as n from migracion where nombre like '%\\_ventas.sql' escape '\\'",
        );
        expect(antes[0]?.n).toBe("1");
        await c.query("begin");
        await c.query(await readFile(rutaDe0029, "utf8"));
        await c.query(sql);
        await c.query(sql); // repetirla no cambia nada
        const { rows } = await c.query<{ n: string }>(
          "select count(*)::text as n from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace",
          [[...TABLAS]],
        );
        expect(rows[0]?.n).toBe("0");
        const { rows: funciones } = await c.query<{ n: string }>(
          `select count(*)::text as n from pg_proc where pronamespace = 'public'::regnamespace and proname in
             ('fecha_de_negocio_de', 'cuenta_validar_alta', 'cuenta_validar_cambio', 'cuenta_total_cuadra', 'linea_validar_alta',
              'linea_validar_cambio', 'linea_precio_cuadra', 'linea_opcion_validar_alta', 'numerador_validar_alta', 'numerador_validar_cambio',
              'numerador_sin_huecos', 'ticket_validar_alta', 'ticket_validar_cambio', 'ticket_ejemplar_vigente_existe', 'ejemplar_validar_alta',
              'ejemplar_hijo_validar_alta', 'ejemplar_cuadra', 'cobranza_validar_alta', 'cobranza_validar_cambio', 'cobranza_cuadra',
              'aplicacion_validar_alta', 'correccion_validar_alta')`,
        );
        expect(funciones[0]?.n).toBe("0");
        const { rows: registro } = await c.query<{ n: string }>(
          "select count(*)::text as n from migracion where nombre like '%\\_ventas.sql' escape '\\'",
        );
        expect(registro[0]?.n).toBe("0");
        // Las funciones de base que ventas usaba siguen donde estaban (no las toca).
        const { rows: ajenas } = await c.query<{ n: string }>(
          "select count(*)::text as n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('sin_borrado', 'solo_insercion', 'texto_de_catalogo_valido', 'fijar_version_y_fecha')",
        );
        expect(ajenas[0]?.n).toBe("4");
        await c.query("rollback");
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });

    it("la reversión necesita un rol que evada RLS: con el de la aplicación se niega (si no, no vería las filas que va a borrar)", async () => {
      const sql = await readFile(ruta, "utf8");
      await conA(async (s) => {
        const r = await s.intentar(sql);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.codigo).toBe("55000");
          expect(r.mensaje).toMatch(/evada RLS/);
        }
      });
      for (const tabla of TABLAS) {
        expect(await m.contar(`select count(*) as n from ${tabla}`), tabla).toBeGreaterThan(0);
      }
    });
  });
});
