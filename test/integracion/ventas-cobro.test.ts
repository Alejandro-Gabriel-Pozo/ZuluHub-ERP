import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearCasosDeUsoDeCierre, huellaDeControles } from "../../src/modulos/cierre/publico";
import { crearCasosDeUsoDeVentas } from "../../src/modulos/ventas/publico";
import { crearEntornoDePrueba } from "./entorno";
import {
  FECHA_DE_NEGOCIO,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Ventas (E4 fase B): `cobrar` y `venderYCobrar` con los casos de uso reales, el puerto real de caja y una base real con el rol de la aplicación.
 * Idempotencia (I7, I8, P4), el cobro dividido en varios medios, el centavo (P3), importes inválidos (P8), atomicidad contra una caja que
 * rechaza y contra una falla después del cobro (P5), caja sin sesión y en cierre (P10), precio que cambió (P13), fecha de negocio por sesión de
 * caja con la caja abierta pasada la hora de corte (P17), jornada en auditoría o cerrada (P26) y autorización y alcance. La concurrencia
 * (P6, P27c, cierre de caja a la vez) está en `ventas-cobro-concurrencia.test.ts`; la unión ticket-cobro (P24, P27g), en
 * `ventas-cobro-cierre.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

const en = (contexto: ContextoOperativo, instante: string): ContextoOperativo => ({
  ...contexto,
  ahora: new Date(instante),
});

const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("ventas: cobrar y venderYCobrar", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

  /** Una venta de mostrador de un producto de $1000: efectivo por el total (lo que arma la pantalla). */
  const pedido = (
    e: EscenarioDeVentas,
    caja: Caja,
    cambios: Partial<Parameters<MundoDeVentas["casos"]["venderYCobrar"]>[1]> = {},
  ): Parameters<MundoDeVentas["casos"]["venderYCobrar"]>[1] => ({
    claveIdempotencia: nuevaClave(),
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    sucursalId: e.sucursal,
    lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
    totalEsperado: monto("1000.00"),
    cobro: {
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: monto("1000.00"),
        },
      ],
    },
    ...cambios,
  });

  /** Un ticket cerrado SIN cobrar (el salón): lo que `cobrar` salda. */
  const ticketPorCobrar = async (
    e: EscenarioDeVentas,
    contexto: ContextoOperativo = e.gerente,
    cantidad = "1",
  ) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(contexto, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(contexto, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad,
      }),
    );
    const ejemplarId = nuevoId();
    const t = valorDe(await m.casos.cerrarCuenta(contexto, { cuentaId: cuenta, ejemplarId }));
    return { cuenta, ...t };
  };

  const entradaDeCobrar = (
    caja: Caja,
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    cobros: readonly Readonly<{ medio: string; importe: string; cuenta?: string | null }>[],
    claveIdempotencia = nuevaClave(),
  ) => ({
    claveIdempotencia,
    ticketId: t.ticketId,
    ejemplarId: t.ejemplarId,
    cajaId: caja.cajaId,
    cobros: cobros.map((c) => ({
      medioDePagoId: caja.medios[c.medio] as string,
      cuentaDeCobroId: c.cuenta ?? null,
      importe: monto(c.importe),
    })),
  });

  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const numerador = async (e: EscenarioDeVentas) =>
    (
      await m.filas<{ ultimo: number }>(
        "select ultimo from numerador_ticket where empresa_id = $1 and sucursal_id = $2",
        [e.empresa, e.sucursal],
      )
    )[0]?.ultimo ?? 0;
  /** Todo lo que un cobro fallido no puede haber movido: ventas, caja y auditoría. */
  const sinCambios = async (e: EscenarioDeVentas) => ({
    cuentas: await contar("cuenta_consumo", e.empresa),
    lineas: await contar("linea_cuenta", e.empresa),
    tickets: await contar("ticket", e.empresa),
    ejemplares: await contar("ticket_ejemplar", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    aplicaciones: await contar("aplicacion_de_cobro", e.empresa),
    movimientos: await contar("movimiento_caja", e.empresa),
    cobros: await contar("cobro", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
    ultimo: await numerador(e),
  });
  const ticketEn = async (id: string): Promise<Fila> =>
    (
      await m.filas(
        "select estado, fecha_negocio::text as fecha, sesion_de_caja_id, numero from ticket where id = $1",
        [id],
      )
    )[0] as Fila;

  // ---- la venta de mostrador ----------------------------------------------------------------------------------------------------

  it("venderYCobrar: una venta deja la cuenta cerrada, el ticket COBRADO con la fecha de la sesión, un cobro en caja, su aplicación y la auditoría", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const p = pedido(e, caja);
    const v = valorDe(await m.casos.venderYCobrar(e.gerente, p));
    expect(v).toMatchObject({
      numero: 1,
      estado: "COBRADO",
      fechaNegocio: FECHA_DE_NEGOCIO,
      total: monto("1000.00"),
      pendienteDeFacturar: true,
      yaExistia: false,
    });
    expect(v.cobros).toHaveLength(1);
    expect(await ticketEn(v.ticketId)).toMatchObject({
      estado: "COBRADO",
      fecha: FECHA_DE_NEGOCIO,
      sesion_de_caja_id: caja.sesionId,
    });
    expect(
      (await m.filas("select estado from cuenta_consumo where id = $1", [p.cuentaId]))[0],
    ).toMatchObject({ estado: "CERRADA" });
    const mov = await m.filas(
      "select clase, importe::text as importe, sesion_id from movimiento_caja where id = $1",
      [v.cobros[0]?.cobroId],
    );
    expect(mov).toMatchObject([{ clase: "COBRO", importe: "1000.00", sesion_id: caja.sesionId }]);
    expect(await contar("aplicacion_de_cobro", e.empresa)).toBe(1);
    const auditoria = await m.auditoria(e.empresa, "TICKET_COBRADO");
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ entidad: "ticket", entidad_id: v.ticketId });
  });

  it("cobrar: un ticket del salón se salda con dos medios; su ticket no cambia de fecha ni de sesión y cada cobro tiene su orden", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const t = await ticketPorCobrar(e);
    const r = valorDe(
      await m.casos.cobrar(
        e.gerente,
        entradaDeCobrar(caja, t, [
          { medio: "EFECTIVO", importe: "600.00" },
          { medio: "QR", importe: "400.00" },
        ]),
      ),
    );
    expect(r).toMatchObject({
      ticketId: t.ticketId,
      total: monto("1000.00"),
      sesionDeCajaId: caja.sesionId,
      fechaDeCobro: FECHA_DE_NEGOCIO,
      yaExistia: false,
    });
    expect(r.cobros.map((c) => c.orden)).toEqual([1, 2]);
    expect(await ticketEn(t.ticketId)).toMatchObject({
      estado: "COBRADO",
      sesion_de_caja_id: null,
    });
    const aplicaciones = await m.filas(
      "select orden, importe::text as importe from aplicacion_de_cobro where cobranza_id = $1 order by orden",
      [r.cobranzaId],
    );
    expect(aplicaciones.map((a) => a["importe"]).sort()).toEqual(["400.00", "600.00"]);
    // La identidad del cobro en caja es (origen, orden): la cobranza y su posición.
    const origenes = await m.filas(
      "select origen_tipo, origen_id, origen_orden from cobro where empresa_id = $1 order by origen_orden",
      [e.empresa],
    );
    expect(origenes).toMatchObject([
      { origen_tipo: "ventas.cobranza_de_ticket", origen_id: r.cobranzaId, origen_orden: 1 },
      { origen_tipo: "ventas.cobranza_de_ticket", origen_id: r.cobranzaId, origen_orden: 2 },
    ]);
  });

  // ---- idempotencia (I7, I8, P4) -----------------------------------------------------------------------------------------------

  it("I7: repetir cobrar con la misma clave cobra una vez y devuelve lo hecho; con otra huella, CLAVE_REUTILIZADA", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const t = await ticketPorCobrar(e);
    const clave = nuevaClave();
    const entrada = entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }], clave);
    const primera = valorDe(await m.casos.cobrar(e.gerente, entrada));
    const antes = await sinCambios(e);
    const segunda = valorDe(await m.casos.cobrar(e.gerente, entrada));
    expect(segunda).toEqual({ ...primera, yaExistia: true });
    expect(await sinCambios(e)).toEqual(antes);
    expect(await contar("cobranza_de_ticket", e.empresa)).toBe(1);
    expect(await contar("movimiento_caja", e.empresa)).toBe(2); // el fondo inicial y el cobro
    expect((await m.auditoria(e.empresa, "TICKET_COBRADO")).length).toBe(1);
    // La misma clave con otro contenido (otro medio): no es el mismo pedido.
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(caja, t, [{ medio: "QR", importe: "1000.00" }], clave),
        ),
      ),
    ).toBe("CLAVE_REUTILIZADA");
    // Otra clave sobre un ticket ya cobrado: dice cuál es la cobranza que lo cobró.
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
        ),
      ),
    ).toEqual({ error: "TICKET_YA_COBRADO", cobranzaId: primera.cobranzaId });
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("P4: los mismos cobros en otro orden son el mismo pedido (misma huella); la repetición no escribe ni audita", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const t = await ticketPorCobrar(e);
    const clave = nuevaClave();
    const primera = valorDe(
      await m.casos.cobrar(
        e.gerente,
        entradaDeCobrar(
          caja,
          t,
          [
            { medio: "EFECTIVO", importe: "300.00" },
            { medio: "QR", importe: "700.00" },
          ],
          clave,
        ),
      ),
    );
    const antes = await sinCambios(e);
    const otroOrden = valorDe(
      await m.casos.cobrar(
        e.gerente,
        entradaDeCobrar(
          caja,
          t,
          [
            { medio: "QR", importe: "700.00" },
            { medio: "EFECTIVO", importe: "300.00" },
          ],
          clave,
        ),
      ),
    );
    expect(otroOrden).toEqual({ ...primera, yaExistia: true });
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("I8: repetir venderYCobrar con la misma clave deja una venta, un ticket y un cobro, y devuelve yaExistia", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const p = pedido(e, caja);
    const primera = valorDe(await m.casos.venderYCobrar(e.gerente, p));
    const antes = await sinCambios(e);
    const segunda = valorDe(await m.casos.venderYCobrar(e.gerente, p));
    expect(segunda).toEqual({ ...primera, yaExistia: true });
    expect(await sinCambios(e)).toEqual(antes);
    expect(await contar("ticket", e.empresa)).toBe(1);
    expect(await contar("cobro", e.empresa)).toBe(1);
    // Aunque la caja ya no esté abierta, repetir devuelve lo hecho (no mira la caja ni la jornada de una venta que existe).
    const sesion = caja.sesionId;
    valorDe(await m.caja.iniciarCierre(e.gerente, { sesionId: sesion }));
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, p))).toEqual({
      ...primera,
      yaExistia: true,
    });
    // Con otra clave sobre la misma cuenta ya vendida: no se vende de nuevo, y dice cuál fue la venta.
    expect(
      falla(await m.casos.venderYCobrar(e.gerente, { ...p, claveIdempotencia: nuevaClave() })),
    ).toEqual({ error: "TICKET_YA_COBRADO", cobranzaId: primera.cobranzaId });
    // La misma clave con otro contenido de cobro: CLAVE_REUTILIZADA.
    expect(
      falla(
        await m.casos.venderYCobrar(e.gerente, {
          ...p,
          cobro: {
            ...p.cobro,
            cobros: [
              {
                medioDePagoId: caja.medios["QR"] as string,
                cuentaDeCobroId: null,
                importe: monto("1000.00"),
              },
            ],
          },
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
    // La misma clave con OTRA cuenta no es una repetición.
    expect(
      falla(
        await m.casos.venderYCobrar(e.gerente, {
          ...p,
          cuentaId: nuevoId(),
          ejemplarId: nuevoId(),
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
  });

  // ---- el centavo (P3) e importes inválidos (P8) ------------------------------------------------------------------------------

  it("P3: un cobro de un centavo de menos o de más no cuadra con el total y no escribe nada", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const t = await ticketPorCobrar(e);
    const antes = await sinCambios(e);
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "999.99" }]),
        ),
      ),
    ).toEqual({ error: "COBRO_NO_CUADRA", falta: "0.01" });
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.01" }]),
        ),
      ),
    ).toEqual({ error: "COBRO_NO_CUADRA", sobra: "0.01" });
    expect(
      falla(
        await m.casos.venderYCobrar(
          e.gerente,
          pedido(e, caja, {
            cobro: {
              cajaId: caja.cajaId,
              cobros: [
                {
                  medioDePagoId: caja.medios["EFECTIVO"] as string,
                  cuentaDeCobroId: null,
                  importe: monto("999.99"),
                },
              ],
            },
          }),
        ),
      ),
    ).toEqual({ error: "COBRO_NO_CUADRA", falta: "0.01" });
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("P8: importes inválidos (negativo, cero, con coma, texto, vacío, con notación científica, de más decimales o sobre la cota) dan IMPORTE_INVALIDO y no escriben nada", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const t = await ticketPorCobrar(e);
    const antes = await sinCambios(e);
    for (const malo of [
      "-1.00",
      "0",
      "0.00",
      "10,00",
      "abc",
      "",
      "1e3",
      "10.001",
      "1000000000.00",
      " 5",
      "+5",
    ]) {
      expect(
        falla(
          await m.casos.cobrar(
            e.gerente,
            entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: malo }]),
          ),
        ),
        `cobrar con «${malo}»`,
      ).toBe("IMPORTE_INVALIDO");
      expect(
        falla(
          await m.casos.venderYCobrar(
            e.gerente,
            pedido(e, caja, {
              cobro: {
                cajaId: caja.cajaId,
                cobros: [
                  {
                    medioDePagoId: caja.medios["EFECTIVO"] as string,
                    cuentaDeCobroId: null,
                    importe: monto(malo),
                  },
                ],
              },
            }),
          ),
        ),
        `venderYCobrar con «${malo}»`,
      ).toBe("IMPORTE_INVALIDO");
    }
    expect(
      falla(
        await m.casos.cobrar(e.gerente, {
          ...entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
          cobros: [],
        }),
      ),
    ).toBe("COBROS_INVALIDOS");
    expect(
      falla(
        await m.casos.cobrar(e.gerente, {
          ...entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: { moneda: "USD", monto: "1000.00" },
            },
          ],
        }),
      ),
    ).toBe("MONEDA_NO_SOPORTADA");
    expect(
      falla(
        await m.casos.cobrar(e.gerente, {
          ...entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
          claveIdempotencia: "corta",
        }),
      ),
    ).toBe("CLAVE_INVALIDA");
    expect(
      falla(
        await m.casos.cobrar(e.gerente, {
          ...entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
          ticketId: "no-es-un-uuid",
        }),
      ),
    ).toBe("IDENTIFICADOR_INVALIDO");
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("venderYCobrar rechaza una entrada mal formada sin escribir: sin líneas, líneas repetidas, total esperado inválido o en otra moneda", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const antes = await sinCambios(e);
    expect(falla(await m.casos.venderYCobrar(e.gerente, pedido(e, caja, { lineas: [] })))).toBe(
      "ENTRADA_INVALIDA",
    );
    const linea = { lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" };
    expect(
      falla(await m.casos.venderYCobrar(e.gerente, pedido(e, caja, { lineas: [linea, linea] }))),
    ).toBe("ENTRADA_INVALIDA");
    expect(
      falla(
        await m.casos.venderYCobrar(e.gerente, pedido(e, caja, { totalEsperado: monto("mil") })),
      ),
    ).toBe("IMPORTE_INVALIDO");
    expect(
      falla(
        await m.casos.venderYCobrar(
          e.gerente,
          pedido(e, caja, { totalEsperado: { moneda: "USD", monto: "1000.00" } }),
        ),
      ),
    ).toBe("MONEDA_NO_SOPORTADA");
    expect(falla(await m.casos.venderYCobrar(e.gerente, pedido(e, caja, { cuentaId: "x" })))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    expect(await sinCambios(e)).toEqual(antes);
  });

  // ---- el estado del ticket ------------------------------------------------------------------------------------------------------

  it("cobrar: un ticket anulado, una cortesía o un ejemplar que no es el vigente no se cobran; uno de otra empresa es inexistente", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const anulado = await ticketPorCobrar(e);
    valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: anulado.ticketId,
        ejemplarBaseId: anulado.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
      }),
    );
    const antes = await sinCambios(e);
    const cobro = [{ medio: "EFECTIVO", importe: "1000.00" }];
    expect(falla(await m.casos.cobrar(e.gerente, entradaDeCobrar(caja, anulado, cobro)))).toBe(
      "TICKET_ANULADO",
    );
    // Una cortesía (total 0): no hay nada que cobrar.
    const gratis = await m.productoVendible(e.empresa, "0");
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: gratis,
        opcionIds: [],
        cantidad: "1",
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    const cortesia = valorDe(
      await m.casos.cerrarCuenta(e.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    expect(cortesia.estado).toBe("CORTESIA");
    expect(falla(await m.casos.cobrar(e.gerente, entradaDeCobrar(caja, cortesia, cobro)))).toBe(
      "TICKET_NO_COBRABLE",
    );
    const t = await ticketPorCobrar(e);
    expect(
      falla(
        await m.casos.cobrar(e.gerente, {
          ...entradaDeCobrar(caja, t, cobro),
          ejemplarId: nuevoId(),
        }),
      ),
    ).toBe("EJEMPLAR_DESACTUALIZADO");
    expect(falla(await m.casos.cobrar(otra.gerente, entradaDeCobrar(caja, t, cobro)))).toBe(
      "TICKET_NO_ENCONTRADO",
    );
    expect((await sinCambios(e)).cobranzas).toBe(antes.cobranzas);
  });

  // ---- atomicidad (P5) -----------------------------------------------------------------------------------------------------------

  it("P5: sin sesión de caja abierta no queda cuenta, ticket, número consumido, cobro ni aplicación, y el siguiente ticket toma el mismo número", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    // Una caja SIN sesión.
    const { rows } = await m.dueno.query<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin sesión') returning id",
      [e.empresa, e.sucursal],
    );
    const sinSesion = { ...caja, cajaId: rows[0]?.id as string };
    const antes = await sinCambios(e);
    expect(falla(await m.casos.venderYCobrar(e.gerente, pedido(e, sinSesion)))).toEqual({
      codigo: "SIN_SESION_ABIERTA",
      cajaId: sinSesion.cajaId,
    });
    expect(await sinCambios(e)).toEqual(antes);
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, pedido(e, caja))).numero).toBe(1);
  });

  it("P5: una falla después del cobro deshace todo (ticket, número, cobro de caja, aplicación y auditoría)", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    let fallar = false;
    const reglas: ReglasDeEmpresa = {
      catalogo: {
        ...CATALOGO_DE_MODULOS,
        catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
        caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" },
        ventas: { ...CATALOGO_DE_MODULOS.ventas, estado: "disponible" },
      },
      permisos: PERMISOS_DE_EMPRESA,
    };
    const entorno = crearEntornoDePrueba(m.propia.base, 4, (tx) => ({
      ...tx,
      autorizacion: {
        ...tx.autorizacion,
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          return datos.rol === null
            ? datos
            : {
                ...datos,
                modulosActivados: [
                  ...datos.modulosActivados,
                  "catalogo",
                  "ventas",
                  "cierre",
                  "caja",
                ],
                modulosHabilitados: [
                  ...datos.modulosHabilitados,
                  "catalogo",
                  "ventas",
                  "cierre",
                  "caja",
                ],
              };
        },
      },
      auditoria: {
        ...tx.auditoria,
        registrar: async (registro) => {
          if (fallar && registro.accion === "TICKET_COBRADO") {
            throw new Error("falla inyectada después de cobrar");
          }
          await tx.auditoria.registrar(registro);
        },
      },
    }));
    try {
      const casos = crearCasosDeUsoDeVentas({ transacciones: entorno, reglas });
      const antes = await sinCambios(e);
      fallar = true;
      const p = pedido(e, caja);
      await expect(casos.venderYCobrar(e.gerente, p)).rejects.toThrow("falla inyectada");
      fallar = false;
      expect(await sinCambios(e)).toEqual(antes);
      // Sin la falla, la MISMA venta se hace y toma el número 1: nada quedó a medias.
      expect(valorDe(await casos.venderYCobrar(e.gerente, p))).toMatchObject({
        numero: 1,
        yaExistia: false,
      });
      expect(await contar("cobro", e.empresa)).toBe(1);
    } finally {
      await entorno.cerrar();
    }
  });

  // ---- caja sin sesión o en cierre (P10) -----------------------------------------------------------------------------------------

  it("P10: la lectura previa dice qué caja está abierta, en cierre o sin sesión; cobrar y vender contra una caja cerrada no escriben nada", async () => {
    const e = await m.escenario();
    const abierta = await m.cajaAbierta(e);
    const { rows } = await m.dueno.query<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin sesión') returning id",
      [e.empresa, e.sucursal],
    );
    const sinSesion = rows[0]?.id as string;
    const estado = valorDe(
      await m.consultas.estadoDeCajasParaCobrar(e.gerente, { sucursalId: e.sucursal }),
    );
    expect(estado.jornadaActual).toMatchObject({
      fechaDeNegocio: FECHA_DE_NEGOCIO,
      estado: "ABIERTA",
    });
    const porId = new Map(estado.cajas.map((c) => [c.cajaId, c]));
    expect(porId.get(abierta.cajaId)).toMatchObject({
      estado: "ABIERTA",
      sesionId: abierta.sesionId,
    });
    expect(porId.get(sinSesion)).toMatchObject({ estado: "SIN_SESION", sesionId: null });

    const t = await ticketPorCobrar(e);
    const antes = await sinCambios(e);
    // Sin sesión: el aviso «Abrí la caja para cobrar».
    const aCobrar = entradaDeCobrar({ ...abierta, cajaId: sinSesion }, t, [
      { medio: "EFECTIVO", importe: "1000.00" },
    ]);
    expect(falla(await m.casos.cobrar(e.gerente, aCobrar))).toEqual({
      codigo: "SIN_SESION_ABIERTA",
      cajaId: sinSesion,
    });
    expect(await sinCambios(e)).toEqual(antes);
    // La caja se cierra entre la lectura y el cobro: el servidor lo dice y no escribe.
    valorDe(await m.caja.iniciarCierre(e.gerente, { sesionId: abierta.sesionId }));
    const enCierre = {
      codigo: "CAJA_EN_CIERRE",
      cajaId: abierta.cajaId,
      sesionId: abierta.sesionId,
    };
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(abierta, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
        ),
      ),
    ).toEqual(enCierre);
    const antesDeVender = await sinCambios(e);
    expect(falla(await m.casos.venderYCobrar(e.gerente, pedido(e, abierta)))).toEqual(enCierre);
    expect(await sinCambios(e)).toEqual(antesDeVender);
    expect(
      valorDe(
        await m.consultas.estadoDeCajasParaCobrar(e.gerente, { sucursalId: e.sucursal }),
      ).cajas.find((c) => c.cajaId === abierta.cajaId),
    ).toMatchObject({ estado: "EN_CIERRE" });
    // Una caja que no existe en la sucursal.
    expect(
      falla(await m.casos.venderYCobrar(e.gerente, pedido(e, { ...abierta, cajaId: nuevoId() }))),
    ).toBe("CAJA_NO_ENCONTRADA_PARA_COBRAR");
  });

  // ---- el precio cambió (P13) ------------------------------------------------------------------------------------------------------

  it("P13: si el precio cambió con el carrito armado, no se cobra nada y dice el total de ahora", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const producto = await m.productoVendible(e.empresa, "1000");
    const p = pedido(e, caja, {
      lineas: [{ lineaId: nuevoId(), productoId: producto, opcionIds: [], cantidad: "2" }],
      totalEsperado: monto("2000.00"),
      cobro: {
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: monto("2000.00"),
          },
        ],
      },
    });
    await m.precio({ empresa: e.empresa, producto, precio: "1200", desde: "2026-11-09T14:00:00Z" });
    const antes = await sinCambios(e);
    const error = falla(await m.casos.venderYCobrar(e.gerente, p));
    expect(error).toMatchObject({ error: "PRECIO_CAMBIO", totalActual: monto("2400.00") });
    expect(await sinCambios(e)).toEqual(antes);
    // Con lo que muestra ahora la pantalla, se vende.
    const nuevo = {
      ...p,
      claveIdempotencia: nuevaClave(),
      totalEsperado: monto("2400.00"),
      cobro: {
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: monto("2400.00"),
          },
        ],
      },
    };
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, nuevo)).total).toEqual(monto("2400.00"));
  });

  it("una cortesía (total 0 con VENTA_A_CERO) no cobra ni toca la caja; sin la confirmación no se escribe nada", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const gratis = await m.productoVendible(e.empresa, "0");
    const p = pedido(e, caja, {
      lineas: [{ lineaId: nuevoId(), productoId: gratis, opcionIds: [], cantidad: "1" }],
      totalEsperado: monto("0.00"),
      cobro: { cajaId: caja.cajaId, cobros: [] },
    });
    const antes = await sinCambios(e);
    expect(falla(await m.casos.venderYCobrar(e.gerente, p))).toEqual({
      error: "CONFIRMACION_REQUERIDA",
      clave: "VENTA_A_CERO",
    });
    expect(await sinCambios(e)).toEqual(antes);
    const v = valorDe(
      await m.casos.venderYCobrar(e.gerente, { ...p, confirmaciones: ["VENTA_A_CERO"] }),
    );
    expect(v).toMatchObject({
      estado: "CORTESIA",
      cobranzaId: null,
      cobros: [],
      pendienteDeFacturar: false,
      yaExistia: false,
    });
    expect(await contar("cobro", e.empresa)).toBe(0);
    expect(await contar("cobranza_de_ticket", e.empresa)).toBe(0);
    // Repetir devuelve la misma cortesía.
    expect(
      valorDe(await m.casos.venderYCobrar(e.gerente, { ...p, confirmaciones: ["VENTA_A_CERO"] })),
    ).toEqual({ ...v, yaExistia: true });
    // Una cortesía con cobros de más es un cobro que sobra.
    expect(
      falla(
        await m.casos.venderYCobrar(e.gerente, {
          ...p,
          cuentaId: nuevoId(),
          ejemplarId: nuevoId(),
          claveIdempotencia: nuevaClave(),
          confirmaciones: ["VENTA_A_CERO"],
          cobro: {
            cajaId: caja.cajaId,
            cobros: [
              {
                medioDePagoId: caja.medios["EFECTIVO"] as string,
                cuentaDeCobroId: null,
                importe: monto("10.00"),
              },
            ],
          },
        }),
      ),
    ).toEqual({ error: "COBRO_NO_CUADRA", sobra: "10.00" });
  });

  // ---- la fecha de negocio por sesión (P17) ---------------------------------------------------------------------------------------

  it("P17: con la caja abierta pasada la hora de corte, venderYCobrar toma la jornada de la SESIÓN y cerrarCuenta sin cobro la del reloj", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e); // sesión del 2026-11-09
    // 00:30 del 10 en Argentina: el reloj ya dice 2026-11-10, la sesión sigue en el 09.
    const pasada = en(e.gerente, "2026-11-10T03:30:00Z");
    const v = valorDe(await m.casos.venderYCobrar(pasada, pedido(e, caja)));
    expect(v.fechaNegocio).toBe("2026-11-09");
    expect(await ticketEn(v.ticketId)).toMatchObject({
      fecha: "2026-11-09",
      sesion_de_caja_id: caja.sesionId,
    });
    const cobro = (
      await m.filas("select fecha_negocio::text as f from sesion_caja where id = $1", [
        caja.sesionId,
      ])
    )[0];
    expect(cobro).toMatchObject({ f: "2026-11-09" });
    // ticketsDeLaJornada(09) trae la venta.
    const delDia = valorDe(
      await m.consultas.listarTickets(e.gerente, {
        sucursalId: e.sucursal,
        fechaNegocio: "2026-11-09",
      }),
    );
    expect(delDia.map((t) => t.ticketId)).toContain(v.ticketId);
    // `cerrarCuenta` sin cobro, a la misma hora: por reloj, el 10.
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(pasada, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(pasada, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    const sinCobro = valorDe(
      await m.casos.cerrarCuenta(pasada, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    expect(sinCobro.fechaNegocio).toBe("2026-11-10");
    expect(await ticketEn(sinCobro.ticketId)).toMatchObject({
      fecha: "2026-11-10",
      sesion_de_caja_id: null,
    });
  });

  // ---- cierre del día (P26) ------------------------------------------------------------------------------------------------------

  it("P26: con la jornada de la sesión EN_AUDITORIA o CERRADA, cobrar y venderYCobrar no escriben nada", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const t = await ticketPorCobrar(e);
    const cierre = crearCasosDeUsoDeCierre({
      transacciones: m.entorno,
      reglas: {
        catalogo: {
          ...CATALOGO_DE_MODULOS,
          catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
          caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" },
          ventas: { ...CATALOGO_DE_MODULOS.ventas, estado: "disponible" },
        },
        permisos: PERMISOS_DE_EMPRESA,
      },
      aportes: [],
    });
    const entrada = { sucursalId: e.sucursal, fechaDeNegocio: FECHA_DE_NEGOCIO };
    valorDe(await cierre.iniciarAuditoria(e.gerente, entrada));
    const antes = await sinCambios(e);
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
        ),
      ),
    ).toBe("JORNADA_EN_AUDITORIA");
    expect(falla(await m.casos.venderYCobrar(e.gerente, pedido(e, caja)))).toBe(
      "JORNADA_EN_AUDITORIA",
    );
    expect(await sinCambios(e)).toEqual(antes);
    valorDe(
      await cierre.cerrarJornada(e.gerente, {
        ...entrada,
        huellaVista: huellaDeControles([]),
        reconocimientos: [],
        observacion: null,
      }),
    );
    const antesDeCerrada = await sinCambios(e);
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(caja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
        ),
      ),
    ).toBe("JORNADA_CERRADA");
    expect(falla(await m.casos.venderYCobrar(e.gerente, pedido(e, caja)))).toBe("JORNADA_CERRADA");
    expect(await sinCambios(e)).toEqual(antesDeCerrada);
  });

  // ---- autorización y alcance ---------------------------------------------------------------------------------------------------

  it("el operador cobra en su sucursal y no en otra; sin persona en el contexto no hay quién cobre", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const otraCaja = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    const antes = await sinCambios(e);
    expect(
      falla(
        await m.casos.venderYCobrar(
          e.operador,
          pedido(e, otraCaja, { sucursalId: e.otraSucursal }),
        ),
      ),
    ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(await sinCambios(e)).toEqual(antes);
    const v = valorDe(await m.casos.venderYCobrar(e.operador, pedido(e, caja)));
    expect(v.estado).toBe("COBRADO");
    const quien = (await m.auditoria(e.empresa, "TICKET_COBRADO"))[0];
    expect(quien?.["actor_persona_id"]).toBe(e.personaDelOperador);
    const anonimo: ContextoOperativo = { ...e.gerente, personaId: null };
    expect(falla(await m.casos.venderYCobrar(anonimo, pedido(e, caja)))).toBe("MODULO_NO_ACTIVO");
    // Un ticket de la otra sucursal, con la caja de la otra sucursal, no lo cobra el operador de la primera.
    const t = await ticketPorCobrar({ ...e, sucursal: e.otraSucursal }, e.gerente);
    expect(
      falla(
        await m.casos.cobrar(
          e.operador,
          entradaDeCobrar(otraCaja, t, [{ medio: "EFECTIVO", importe: "1000.00" }]),
        ),
      ),
    ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    // Una caja de otra sucursal para un ticket de ésta: lo rechaza caja.
    const propio = await ticketPorCobrar(e);
    expect(
      falla(
        await m.casos.cobrar(
          e.gerente,
          entradaDeCobrar(otraCaja, propio, [{ medio: "EFECTIVO", importe: "1000.00" }]),
        ),
      ),
    ).toBe("CAJA_DE_OTRA_SUCURSAL");
  });
});
