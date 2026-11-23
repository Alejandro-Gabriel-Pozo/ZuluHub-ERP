import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Ventas (mostrador, K7): los datos del cobro (cupón, últimos 4, marca, cuotas, DNI) viajan en `venderYCobrar` y `cobrar` y entran a la HUELLA de
 * idempotencia. Una escritura delicada, por eso: la misma clave con los mismos datos devuelve lo hecho sin duplicar ticket, cobranza ni cobro; con
 * datos distintos es `CLAVE_REUTILIZADA` (no un reuso silencioso); dos envíos a la vez con la misma clave dejan UN cobro; un dato inválido o no
 * habilitado no escribe nada (atomicidad); los valores llegan a la fila del cobro y NUNCA a la auditoría; y un cobro sin datos conserva la huella de
 * antes de que existieran los datos (la repetición de un cobro viejo sigue siendo la misma).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

describe.skipIf(base === null)("ventas: datos del cobro", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;
  type Datos = Readonly<{
    cupon?: string;
    ultimos4?: string;
    marcaDeTarjetaId?: string;
    cuotas?: number;
    dni?: string;
  }>;

  /** Una empresa con caja abierta y los medios habilitados para pedir datos (tarjeta: cupón, últimos 4 y marca; transferencia: DNI). */
  const mundo = async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    await m.dueno.query(
      "update medio_de_pago set pide_cupon = true, pide_ultimos4 = true, pide_marca = true where id = $1",
      [caja.medios["TARJETA_DEBITO"]],
    );
    await m.dueno.query("update medio_de_pago set pide_dni = true where id = $1", [
      caja.medios["TRANSFERENCIA"],
    ]);
    const visa = (
      await m.filas<{ id: string }>("select id from valor_de_lista where nombre = 'Visa'")
    )[0]?.id as string;
    return { e, caja, visa };
  };

  /** Venta de $1000 cobrada $600 con tarjeta (con `tarjeta`) y $400 por transferencia (con `transferencia`). */
  const venta = (
    e: EscenarioDeVentas,
    caja: Caja,
    datos: Readonly<{ tarjeta?: Datos; transferencia?: Datos }>,
    claves: Readonly<{ clave: string; cuenta: string; ejemplar: string; linea: string }>,
  ) => ({
    claveIdempotencia: claves.clave,
    cuentaId: claves.cuenta,
    ejemplarId: claves.ejemplar,
    sucursalId: e.sucursal,
    lineas: [{ lineaId: claves.linea, productoId: e.producto, opcionIds: [], cantidad: "1" }],
    totalEsperado: monto("1000.00"),
    cobro: {
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["TARJETA_DEBITO"] as string,
          cuentaDeCobroId: null,
          importe: monto("600.00"),
          ...(datos.tarjeta === undefined ? {} : { datos: datos.tarjeta }),
        },
        {
          medioDePagoId: caja.medios["TRANSFERENCIA"] as string,
          cuentaDeCobroId: null,
          importe: monto("400.00"),
          ...(datos.transferencia === undefined ? {} : { datos: datos.transferencia }),
        },
      ],
    },
  });
  const claves = () => ({
    clave: nuevaClave(),
    cuenta: nuevoId(),
    ejemplar: nuevoId(),
    linea: nuevoId(),
  });

  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const rastros = async (e: EscenarioDeVentas) => ({
    cuentas: await contar("cuenta_consumo", e.empresa),
    tickets: await contar("ticket", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    movimientos: await contar("movimiento_caja", e.empresa),
    cobros: await contar("cobro", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
  });

  it("los datos llegan a la fila de cada cobro, y la auditoría lleva qué se completó pero NUNCA los valores", async () => {
    const { e, caja, visa } = await mundo();
    const k = claves();
    const r = valorDe(
      await m.casos.venderYCobrar(
        e.gerente,
        venta(
          e,
          caja,
          {
            tarjeta: { cupon: "ZX-9981", ultimos4: "4242", marcaDeTarjetaId: visa },
            transferencia: { dni: "30123456" },
          },
          k,
        ),
      ),
    );
    expect(r.estado).toBe("COBRADO");
    const filas = await m.filas<Record<string, unknown>>(
      "select cupon, ultimos4, marca_de_tarjeta_id, cuotas, dni from cobro where empresa_id = $1 order by origen_orden",
      [e.empresa],
    );
    expect(filas).toHaveLength(2);
    expect(JSON.stringify(filas)).toContain("30123456");
    expect(filas.find((f) => f["dni"] === "30123456")).toBeDefined();
    expect(filas.find((f) => f["cupon"] === "ZX-9981")).toMatchObject({
      ultimos4: "4242",
      marca_de_tarjeta_id: visa,
    });
    const auditoria = JSON.stringify(
      await m.filas("select antes, despues from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    );
    // Los ids y las horas de la auditoría son hexadecimales y pueden contener «4242» por azar: los números se buscan como valor entero
    // (sin hexadecimales ni guiones pegados), no como pedazo de otro texto.
    for (const secreto of ["ZX-9981", k.clave]) {
      expect(auditoria.includes(secreto), secreto).toBe(false);
    }
    for (const secreto of ["4242", "30123456"]) {
      expect(
        new RegExp(`(?<![0-9a-f-])${secreto}(?![0-9a-f-])`, "i").test(auditoria),
        secreto,
      ).toBe(false);
    }
  });

  it("idempotencia: repetir la misma clave con los mismos datos devuelve lo hecho y no duplica ticket, cobranza, cobro ni movimiento", async () => {
    const { e, caja, visa } = await mundo();
    const k = claves();
    const pedido = venta(
      e,
      caja,
      {
        tarjeta: { cupon: "ZX-1", ultimos4: "4242", marcaDeTarjetaId: visa },
        transferencia: { dni: "30123456" },
      },
      k,
    );
    const primera = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    const antes = await rastros(e);
    const segunda = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(segunda).toEqual({ ...primera, yaExistia: true });
    expect(await rastros(e)).toEqual(antes);
    // El mismo pedido con los cobros en otro orden es el mismo pedido.
    const alReves = {
      ...pedido,
      cobro: { ...pedido.cobro, cobros: [...pedido.cobro.cobros].reverse() },
    };
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, alReves)).yaExistia).toBe(true);
    expect(await rastros(e)).toEqual(antes);
  });

  it("misma clave con datos distintos: CLAVE_REUTILIZADA, no se reusa en silencio ni se escribe nada", async () => {
    const { e, caja, visa } = await mundo();
    const k = claves();
    const datos = { cupon: "ZX-1", ultimos4: "4242", marcaDeTarjetaId: visa };
    valorDe(await m.casos.venderYCobrar(e.gerente, venta(e, caja, { tarjeta: datos }, k)));
    const antes = await rastros(e);
    for (const otros of [
      { tarjeta: { ...datos, cupon: "ZX-2" } },
      { tarjeta: { ...datos, ultimos4: "1111" } },
      { tarjeta: datos, transferencia: { dni: "30123456" } },
      {},
    ] as const) {
      expect(falla(await m.casos.venderYCobrar(e.gerente, venta(e, caja, otros, k)))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(await rastros(e)).toEqual(antes);
    }
  });

  it("concurrencia: dos envíos a la vez con la misma clave y los mismos datos dejan UN ticket, UNA cobranza y los cobros una sola vez", async () => {
    const { e, caja, visa } = await mundo();
    const k = claves();
    const pedido = venta(
      e,
      caja,
      { tarjeta: { cupon: "ZX-1", ultimos4: "4242", marcaDeTarjetaId: visa } },
      k,
    );
    m.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([
        m.casos.venderYCobrar(e.gerente, pedido),
        m.casos.venderYCobrar(e.gerente, pedido),
      ]);
    } finally {
      m.soltarBarrera();
    }
    const vistos = rs.map((r) => valorDe(r));
    expect(vistos.filter((v) => !v.yaExistia)).toHaveLength(1);
    expect(vistos[0]?.ticketId).toBe(vistos[1]?.ticketId);
    expect(await rastros(e)).toMatchObject({ tickets: 1, cobranzas: 1, cobros: 2 });
  });

  it("concurrencia: misma clave con datos distintos a la vez: uno gana, el otro es CLAVE_REUTILIZADA, y queda UNA venta", async () => {
    const { e, caja, visa } = await mundo();
    const k = claves();
    const con = (cupon: string) =>
      venta(e, caja, { tarjeta: { cupon, ultimos4: "4242", marcaDeTarjetaId: visa } }, k);
    m.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([
        m.casos.venderYCobrar(e.gerente, con("AAA-1")),
        m.casos.venderYCobrar(e.gerente, con("BBB-2")),
      ]);
    } finally {
      m.soltarBarrera();
    }
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error))).toEqual([
      "CLAVE_REUTILIZADA",
    ]);
    expect(await rastros(e)).toMatchObject({ tickets: 1, cobranzas: 1, cobros: 2 });
  });

  it("atomicidad: un dato mal escrito (cupón que parece número de tarjeta) o no habilitado para el medio no deja NADA escrito", async () => {
    const { e, caja, visa } = await mundo();
    const antes = await rastros(e);
    const numeroDeTarjeta = falla(
      await m.casos.venderYCobrar(
        e.gerente,
        venta(
          e,
          caja,
          { tarjeta: { cupon: "4509953566233704", marcaDeTarjetaId: visa } },
          claves(),
        ),
      ),
    );
    expect(numeroDeTarjeta).toMatchObject({ codigo: "DATO_DE_COBRO_INVALIDO", dato: "cupon" });
    const noHabilitado = falla(
      await m.casos.venderYCobrar(
        e.gerente,
        venta(e, caja, { tarjeta: { dni: "30123456" } }, claves()),
      ),
    );
    expect(noHabilitado).toMatchObject({ codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "dni" });
    const dniMalEscrito = falla(
      await m.casos.venderYCobrar(
        e.gerente,
        venta(e, caja, { transferencia: { dni: "12.345.678" } }, claves()),
      ),
    );
    expect(dniMalEscrito).toMatchObject({ codigo: "DATO_DE_COBRO_INVALIDO", dato: "dni" });
    expect(await rastros(e)).toEqual(antes);
  });

  it("compatibilidad: un cobro sin datos tiene la huella de siempre; repetirlo es lo mismo, y sumarle datos con la misma clave es CLAVE_REUTILIZADA", async () => {
    const { e, caja, visa } = await mundo();
    const k = claves();
    const sin = venta(e, caja, {}, k);
    const primera = valorDe(await m.casos.venderYCobrar(e.gerente, sin));
    const huella = (
      await m.filas<{ huella: string }>(
        "select huella from cobranza_de_ticket where empresa_id = $1",
        [e.empresa],
      )
    )[0]?.huella;
    // Construida a mano con la forma anterior a los datos: [ticket, ejemplar, caja, [[medio, cuenta, importe], …]] en orden canónico.
    const { createHash } = await import("node:crypto");
    const esperada = createHash("sha256")
      .update(
        JSON.stringify([
          primera.ticketId,
          k.ejemplar,
          caja.cajaId,
          [
            [caja.medios["TARJETA_DEBITO"], null, "600.00"],
            [caja.medios["TRANSFERENCIA"], null, "400.00"],
          ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ]),
      )
      .digest("hex");
    expect(huella).toBe(esperada);
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, sin)).yaExistia).toBe(true);
    expect(
      falla(
        await m.casos.venderYCobrar(
          e.gerente,
          venta(e, caja, { tarjeta: { cupon: "ZX-1", marcaDeTarjetaId: visa } }, k),
        ),
      ),
    ).toBe("CLAVE_REUTILIZADA");
  });
});
