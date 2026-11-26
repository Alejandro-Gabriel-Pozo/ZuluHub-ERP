import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { check, clave, conAppDe, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { ajustarPerilla, CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { cuentaConLinea, montarVentas, nuevoId, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura as nuevaClave,
  receptorConsumidorFinal,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * Migración 0108 (R-05b, facturar antes de cobrar): `documento_validar_alta` deja de exigir COBRADO y pasa a aceptar EMITIDO o COBRADO. Prueba, con la base real y el rol de la
 * aplicación: que el cuerpo de la función es IDÉNTICO al de 0029 salvo la condición del estado (y el de la reversión es el de 0029 literal), que un EMITIDO y un COBRADO se facturan,
 * que ANULADO, CORTESIA, un ticket inexistente o de otra empresa NO se facturan ni directo contra la base, que siguen en pie el ejemplar vigente, el documento que nace vigente y las
 * cuatro unicidades (un solo documento vigente por ticket, clave, intento y comprobante), que los documentos ya emitidos no se tocan, y que la reversión frena (55000) con facturas
 * vigentes sobre tickets no cobrados, vuelve a la función de 0029 sin ellas, se puede repetir y se puede volver a aplicar 0108. Previene: aflojar de más una restricción fiscal y una
 * reversión que deje la base en un estado que la función vieja no sabe tratar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Fila = Record<string, unknown>;

const leer = (archivo: string) => readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");

/** El texto de `documento_validar_alta` entre los `$$` de un archivo de migración (el único bloque que la define). */
function cuerpoDeLaFuncion(sql: string): string {
  const m =
    /CREATE (?:OR REPLACE )?FUNCTION documento_validar_alta\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(
      sql,
    );
  if (m?.[1] === undefined) throw new Error("no se encontró documento_validar_alta en el archivo");
  return m[1];
}

const CONDICION_DE_0029 = `  IF v_estado IS DISTINCT FROM 'COBRADO' THEN
    RAISE EXCEPTION 'documento_ticket_no_facturable: el ticket % no está cobrado', NEW.ticket_id
`;
const CONDICION_DE_0108 = `  IF v_estado IS NULL OR v_estado NOT IN ('EMITIDO', 'COBRADO') THEN
    RAISE EXCEPTION 'documento_ticket_no_facturable: el ticket % está en estado %', NEW.ticket_id, coalesce(v_estado, 'inexistente')
`;

describe.skipIf(base === null)("0108: facturar antes de cobrar (documento_validar_alta)", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;
  let e: EscenarioDeFacturacionDeTickets;
  let otra: EscenarioDeFacturacionDeTickets;
  let caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;
  let sqlNuevo: string;
  let sqlReversion: string;

  /** Cada ticket con su ejemplar vigente, y los comprobantes de los dos facturados. */
  const t = {} as Record<
    "emitidoFacturado" | "cobradoFacturado" | "emitidoLibre" | "anulado" | "cortesia" | "noVigente",
    { ticketId: string; ejemplarId: string }
  >;
  const comprobante = {} as Record<"emitido" | "cobrado" | "noVigente", string>;

  const ctx = (esc: EscenarioDeFacturacionDeTickets) => ({
    ...esc.gerente,
    ahora: fiscal.reloj.ahora(),
  });
  const facturar = (esc: EscenarioDeFacturacionDeTickets, ticketId: string) =>
    m.casos.emitirComprobanteDeTicket(ctx(esc), {
      ticketId,
      receptor: receptorConsumidorFinal(),
      puntoDeVentaId: esc.pv,
      clave: nuevaClave(),
    });
  const encender = async (esc: EscenarioDeFacturacionDeTickets) => {
    const fila = (
      await m.filas<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
        esc.empresa,
      ])
    )[0];
    await ajustarPerilla(m.dueno, String(fila?.tenant_id), "facturar_antes_de_cobrar", "1", {
      empresa: esc.empresa,
    });
  };
  const emitido = async (esc: EscenarioDeFacturacionDeTickets) => {
    const { cuenta } = await cuentaConLinea(m, esc);
    return valorDe(
      await m.casos.cerrarCuenta(esc.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
  };
  const cobrar = async (tk: { ticketId: string; ejemplarId: string }) =>
    valorDe(
      await m.casos.cobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: tk.ticketId,
        ejemplarId: tk.ejemplarId,
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: { moneda: "ARS", monto: "1000.00" },
          },
        ],
      }),
    );

  beforeAll(async () => {
    if (base === null) return;
    sqlNuevo = await leer("0108_facturar_antes_de_cobrar.sql");
    sqlReversion = await leer("reversiones/0108_revertir_facturar_antes_de_cobrar.sql");
    m = await montarVentas(base, { facturacion: true, conexiones: 12 });
    fiscal = crearFiscalDePrueba(m);
    e = await escenarioFacturable(m);
    otra = await escenarioFacturable(m);
    caja = await m.cajaAbierta(e);
    await encender(e);
    fiscal.adelantar();
    t.emitidoFacturado = await emitido(e);
    t.cobradoFacturado = await emitido(e);
    await cobrar(t.cobradoFacturado);
    t.emitidoLibre = await emitido(e);
    t.noVigente = await emitido(e);
    t.anulado = await emitido(e);
    valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.anulado.ticketId,
        ejemplarBaseId: t.anulado.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Cargado por error",
        sucursalDeTrabajo: e.sucursal,
      }),
    );
    const productoACero = await m.productoVendible(e.empresa, "0");
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: productoACero,
        opcionIds: [],
        cantidad: "1",
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    t.cortesia = valorDe(
      await m.casos.cerrarCuenta(e.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    comprobante.emitido = valorDe(await facturar(e, t.emitidoFacturado.ticketId)).comprobanteId;
    comprobante.cobrado = valorDe(await facturar(e, t.cobradoFacturado.ticketId)).comprobanteId;
    comprobante.noVigente = valorDe(await facturar(e, t.noVigente.ticketId)).comprobanteId;
    // El documento de `noVigente` deja de valer (lo único que se le puede cambiar a un documento): el dueño de la base lo marca.
    await m.dueno.query(
      "update documento_de_ticket set vigente = false, no_vigente_en = now() where ticket_id = $1",
      [t.noVigente.ticketId],
    );
  });
  afterAll(async () => {
    if (base === null) return;
    await fiscal.cerrar();
    await m.cerrar();
  });

  const estado = async (ticketId: string) =>
    (await m.filas<Fila>("select estado from ticket where id = $1", [ticketId]))[0]?.["estado"];
  const funcion = async () =>
    (
      await m.filas<Fila>(
        "select prosrc, prosecdef, proconfig from pg_proc where proname = 'documento_validar_alta'",
      )
    )[0] as { prosrc: string; prosecdef: boolean; proconfig: string[] };

  /** Un alta directa de un documento con el rol de la aplicación de esa empresa (no pasa por el caso de uso). */
  const altaDirecta = (
    esc: EscenarioDeFacturacionDeTickets,
    d: {
      ticketId: string;
      ejemplarId: string;
      intento?: number;
      clave?: string;
      comprobanteId?: string;
    },
  ) =>
    conAppDe(m.propia.base, { empresa: esc.empresa, persona: esc.personaDelOperador }, async (s) =>
      s.intentar(
        `insert into documento_de_ticket (empresa_id, ticket_id, ejemplar_id, intento, clave, comprobante_id, creado_en, creado_por)
           values ($1, $2, $3, $4, $5, $6, now(), $7)`,
        [
          esc.empresa,
          d.ticketId,
          d.ejemplarId,
          d.intento ?? 1,
          d.clave ?? randomUUID(),
          d.comprobanteId ?? randomUUID(),
          esc.personaDelOperador,
        ],
      ),
    );

  // ---- la función ---------------------------------------------------------------------------------------------------------------

  it("el cuerpo de la función es el de 0029 salvo la condición del estado; la reversión trae el de 0029 literal y la base tiene el de 0108", async () => {
    const de0029 = cuerpoDeLaFuncion(await leer("0029_facturacion.sql"));
    const de0108 = cuerpoDeLaFuncion(sqlNuevo);
    expect(de0029).toContain(CONDICION_DE_0029);
    expect(de0029.replace(CONDICION_DE_0029, CONDICION_DE_0108)).toBe(de0108);
    expect(cuerpoDeLaFuncion(sqlReversion)).toBe(de0029);
    const enLaBase = await funcion();
    expect(enLaBase.prosrc).toBe(de0108);
    // Mismos atributos que 0029: ni SECURITY DEFINER ni otro search_path.
    expect(enLaBase.prosecdef).toBe(false);
    expect(enLaBase.proconfig).toEqual(["search_path=pg_catalog, public, pg_temp"]);
    // La migración no reescribe el disparador `documento_alta` (sigue siendo de ALTA y por fila).
    const disparador = await m.filas<Fila>(
      "select pg_get_triggerdef(oid) as def from pg_trigger where tgname = 'documento_alta'",
    );
    expect(disparador[0]?.["def"]).toContain("BEFORE INSERT ON public.documento_de_ticket");
  });

  // ---- lo que se factura ---------------------------------------------------------------------------------------------------------

  it("un ticket EMITIDO y uno COBRADO tienen su factura vigente; facturar no cambió el estado del EMITIDO", async () => {
    expect(await estado(t.emitidoFacturado.ticketId)).toBe("EMITIDO");
    expect(await estado(t.cobradoFacturado.ticketId)).toBe("COBRADO");
    const vigentes = await m.filas<Fila>(
      "select ticket_id from documento_de_ticket where vigente and ticket_id = any($1::uuid[])",
      [[t.emitidoFacturado.ticketId, t.cobradoFacturado.ticketId]],
    );
    expect(vigentes).toHaveLength(2);
  });

  it("ANULADO, CORTESIA, un ticket inexistente y uno de otra empresa NO se facturan, ni directo contra la base con el rol de la aplicación", async () => {
    expect(await estado(t.anulado.ticketId)).toBe("ANULADO");
    expect(await estado(t.cortesia.ticketId)).toBe("CORTESIA");
    for (const [que, esc, ticketId, ejemplarId] of [
      ["anulado", e, t.anulado.ticketId, t.anulado.ejemplarId],
      ["cortesía", e, t.cortesia.ticketId, t.cortesia.ejemplarId],
      ["inexistente", e, randomUUID(), randomUUID()],
      // El ticket es de `e`; quien pide es `otra`: para su empresa ese ticket no existe.
      ["de otra empresa", otra, t.emitidoLibre.ticketId, t.emitidoLibre.ejemplarId],
    ] as const) {
      const r = await altaDirecta(esc, { ticketId, ejemplarId });
      expect(r.ok, que).toBe(false);
      if (!r.ok) {
        expect(r.codigo, `${que}: ${r.mensaje}`).toBe("23514");
        expect(r.restriccion, que).toBe("documento_ticket_no_facturable");
      }
    }
    expect(
      await m.contar(
        "select count(*) as n from documento_de_ticket where ticket_id = any($1::uuid[])",
        [[t.anulado.ticketId, t.cortesia.ticketId]],
      ),
    ).toBe(0);
  });

  it("sigue en pie: el ejemplar facturado es el vigente y un documento nace vigente", async () => {
    // Un ticket EMITIDO con el ejemplar de otro ticket: no es el suyo.
    check(
      await altaDirecta(e, {
        ticketId: t.emitidoLibre.ticketId,
        ejemplarId: t.emitidoFacturado.ejemplarId,
      }),
      "documento_ejemplar_no_vigente",
    );
    // La aplicación ni siquiera puede escribir `vigente` (solo inserta vigente); el dueño de la base tampoco logra un documento que nazca no vigente: el disparador lo rechaza.
    check(
      await sinConfirmar(m.dueno, () =>
        intentoDelDueno(
          m.dueno,
          `insert into documento_de_ticket (empresa_id, ticket_id, ejemplar_id, intento, clave, comprobante_id, vigente, no_vigente_en, creado_en, creado_por)
           values ($1, $2, $3, 1, $4, $5, false, now(), now(), $6)`,
          [
            e.empresa,
            t.emitidoLibre.ticketId,
            t.emitidoLibre.ejemplarId,
            randomUUID(),
            randomUUID(),
            e.personaDelOperador,
          ],
        ),
      ),
      "documento_cambio_invalido",
    );
  });

  it("sigue en pie: un solo documento vigente por ticket, y la clave, el intento y el comprobante no se repiten", async () => {
    const delEmitido = (
      await m.filas<Fila>(
        "select clave, intento from documento_de_ticket where ticket_id = $1 and vigente",
        [t.emitidoFacturado.ticketId],
      )
    )[0] as { clave: string; intento: number };
    // Otro documento vigente para el mismo ticket (un intento nuevo con clave y comprobante propios).
    clave(await altaDirecta(e, { ...t.emitidoFacturado, intento: 2 }), "documento_vigente_uk");
    // La misma clave de idempotencia en otro ticket.
    clave(
      await altaDirecta(e, { ...t.emitidoLibre, clave: delEmitido.clave }),
      "documento_clave_uk",
    );
    // El mismo comprobante en otro ticket.
    clave(
      await altaDirecta(e, { ...t.emitidoLibre, comprobanteId: comprobante.emitido }),
      "documento_comprobante_uk",
    );
    // El mismo intento del mismo ticket cuando el documento anterior ya no vale (así no lo tapa la unicidad del vigente).
    clave(await altaDirecta(e, { ...t.noVigente, intento: 1 }), "documento_intento_uk");
    expect(
      await m.contar("select count(*) as n from documento_de_ticket where ticket_id = $1", [
        t.emitidoLibre.ticketId,
      ]),
    ).toBe(0);
  });

  it("un EMITIDO con factura vigente no se anula (la guarda de ventas rige igual que para COBRADO): el documento sigue sobre el ejemplar vigente y no se escribe otro ejemplar", async () => {
    const ejemplares = () =>
      m.contar("select count(*) as n from ticket_ejemplar where ticket_id = $1", [
        t.emitidoFacturado.ticketId,
      ]);
    const antes = await ejemplares();
    const r = await m.casos.anularTicket(e.gerente, {
      claveIdempotencia: nuevaClave(),
      ticketId: t.emitidoFacturado.ticketId,
      ejemplarBaseId: t.emitidoFacturado.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Cargado por error",
      sucursalDeTrabajo: e.sucursal,
    });
    expect(r.ok ? "ok" : (r.error as { error?: string }).error).toBe(
      "TICKET_CON_COMPROBANTE_VIGENTE",
    );
    expect(await estado(t.emitidoFacturado.ticketId)).toBe("EMITIDO");
    expect(await ejemplares()).toBe(antes);
    const fila = (
      await m.filas<Fila>(
        `select e.numero_de_ejemplar = k.ejemplar_vigente as es_el_vigente
           from documento_de_ticket d join ticket k on k.id = d.ticket_id and k.empresa_id = d.empresa_id
           join ticket_ejemplar e on e.id = d.ejemplar_id and e.empresa_id = d.empresa_id
          where d.ticket_id = $1 and d.vigente`,
        [t.emitidoFacturado.ticketId],
      )
    )[0];
    expect(fila?.["es_el_vigente"]).toBe(true);
  });

  // ---- la reversión -----------------------------------------------------------------------------------------------------------------

  describe("reversión (destructiva para la base de esta prueba: va al final)", () => {
    const aplicarComoDueno = async (sql: string) => {
      await m.dueno.query("begin");
      try {
        await m.dueno.query(sql);
        await m.dueno.query("commit");
      } catch (error) {
        await m.dueno.query("rollback");
        throw error;
      }
    };
    const documentos = () =>
      m.filas<Fila>(
        "select id, ticket_id, ejemplar_id, intento, clave, comprobante_id, vigente, creado_en, creado_por, no_vigente_en from documento_de_ticket order by id",
      );

    it("sin el rol que evade RLS la reversión no corre (55000): el conteo no vería las facturas de otras empresas", async () => {
      const app = new pg.Client({ connectionString: m.propia.base.app });
      await app.connect();
      try {
        await app.query("begin");
        await expect(app.query(sqlReversion)).rejects.toMatchObject({ code: "55000" });
        await app.query("rollback");
      } finally {
        await app.end();
      }
      expect((await funcion()).prosrc).toBe(cuerpoDeLaFuncion(sqlNuevo));
    });

    it("FRENA (55000) con una factura vigente sobre un ticket no cobrado y no cambia nada", async () => {
      const antes = await documentos();
      const frena = await sinConfirmar(m.dueno, () => intentoDelDueno(m.dueno, sqlReversion));
      expect(frena.ok).toBe(false);
      if (!frena.ok) {
        expect(frena.codigo).toBe("55000");
        expect(frena.mensaje).toContain("documentos vigentes sobre tickets no cobrados");
      }
      expect((await funcion()).prosrc).toBe(cuerpoDeLaFuncion(sqlNuevo));
      expect(await documentos()).toEqual(antes);
    });

    it("sin facturas sobre tickets no cobrados vuelve a la función de 0029 sin tocar los documentos; se puede repetir y volver a aplicar 0108", async () => {
      // El ticket EMITIDO facturado se cobra: la factura ya no es «anticipada».
      await cobrar(t.emitidoFacturado);
      expect(await estado(t.emitidoFacturado.ticketId)).toBe("COBRADO");
      const antes = await documentos();
      await aplicarComoDueno(sqlReversion);
      expect((await funcion()).prosrc).toBe(cuerpoDeLaFuncion(sqlReversion));
      expect(await documentos()).toEqual(antes);
      // El registro de migraciones ya no tiene 0108 (se puede volver a aplicar).
      expect(
        await m.contar(
          "select count(*) as n from migracion where nombre = '0108_facturar_antes_de_cobrar.sql'",
        ),
      ).toBe(0);
      // Con la función vieja un EMITIDO no se factura (la base lo rechaza con TICKET_NO_FACTURABLE) y un COBRADO sí.
      expect(
        (
          await m.casos.emitirComprobanteDeTicket(ctx(e), {
            ticketId: t.emitidoLibre.ticketId,
            receptor: receptorConsumidorFinal(),
            puntoDeVentaId: e.pv,
            clave: nuevaClave(),
          })
        ).ok,
      ).toBe(false);
      expect(await estado(t.emitidoLibre.ticketId)).toBe("EMITIDO");
      // Repetirla no cambia nada.
      await aplicarComoDueno(sqlReversion);
      expect((await funcion()).prosrc).toBe(cuerpoDeLaFuncion(sqlReversion));
      expect(await documentos()).toEqual(antes);
      // Volver a aplicar 0108: pasa su guarda (la función es la de 0029) y deja la de 0108; los documentos siguen igual.
      await aplicarComoDueno(sqlNuevo);
      expect((await funcion()).prosrc).toBe(cuerpoDeLaFuncion(sqlNuevo));
      expect(await documentos()).toEqual(antes);
      valorDe(await facturar(e, t.emitidoLibre.ticketId));
      expect(await estado(t.emitidoLibre.ticketId)).toBe("EMITIDO");
    });

    it("0108 no se aplica sobre una función que ya no es la de 0029 (frena en vez de pisarla)", async () => {
      // Aplicada otra vez encima de sí misma: la función ya no exige COBRADO.
      const frena = await sinConfirmar(m.dueno, () => intentoDelDueno(m.dueno, sqlNuevo));
      expect(frena.ok).toBe(false);
      if (!frena.ok) expect(frena.codigo).toBe("55000");
    });
  });
});
